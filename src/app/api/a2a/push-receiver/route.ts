// POST /api/a2a/push-receiver — inbound A2A push notifications from RAIA.
//
// Ships DARK: nothing registers this URL and `capabilities.pushNotifications`
// stays false until the operator flips RAIA_A2A_PUSH_VERIFIED. The wire contract
// is ADR-472 §C: `X-A2A-Signature` is a compact detached ES256 JWS
// (`protected..signature`) over the RFC 8785 (JCS) canonical body, `A2A-Version`
// is 0.3 or 1.0, and the body is `application/json` (0.3) or
// `application/a2a+json` (1.0).
//
// Verification fails closed: alg/kid/jku/nonce/iat are checked, the key comes
// from RAIA's fixed jku (never a caller-supplied URL), and a replayed
// (kid, nonce) is rejected for 10 minutes. Logs carry request id + nonce +
// verdict only — never bodies or key material.

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import canonicalize from 'canonicalize';
import { flattenedVerify, importJWK, type JWK } from 'jose';

export const dynamic = 'force-dynamic';

const RAIA_JKU = process.env.A2A_PUSH_JKU || 'https://app.estateaigents.com/.well-known/jwks.json';
const MAX_SKEW_S = 300; // ADR-472: reject anything older/newer than 5 minutes
const REPLAY_TTL_MS = 10 * 60_000; // ADR-472: retain (kid, nonce) for >= 10 min
const REPLAY_MAX = 10_000; // bounded: a flood cannot grow the map without limit
const JWKS_TTL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 5_000;

const CONTENT_TYPES = new Set(['application/json', 'application/a2a+json']);

type ProtectedHeader = {
  alg?: unknown;
  kid?: unknown;
  jku?: unknown;
  nonce?: unknown;
  iat?: unknown;
  timestamp?: unknown;
};

// (kid, nonce) -> expiry. Per-instance only: a replay across cold lambdas is
// caught by RAIA's own attempt uniqueness, not here.
const replay = new Map<string, number>();
let jwksCache: { at: number; keys: JWK[] } | null = null;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function log(verdict: string, requestId: string, nonce?: string) {
  console.info('[a2a-push]', JSON.stringify({ requestId, nonce: nonce ?? null, verdict }));
}

async function keys(): Promise<JWK[]> {
  if (jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  // redirect:'manual' — the jku is a fixed RAIA URL, so a 3xx is an attack.
  const res = await fetch(RAIA_JKU, {
    redirect: 'manual',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys?: unknown };
  const list = Array.isArray(body.keys) ? (body.keys as JWK[]) : [];
  jwksCache = { at: Date.now(), keys: list };
  return list;
}

// iat (epoch seconds) or the RFC 3339 `timestamp` the RAIA sender emits.
function issuedAt(hdr: ProtectedHeader): number {
  if (typeof hdr.iat === 'number' && Number.isFinite(hdr.iat)) return hdr.iat;
  if (typeof hdr.timestamp === 'string') return Date.parse(hdr.timestamp) / 1000;
  return NaN;
}

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') || randomUUID();
  let nonce: string | undefined;
  const fail = (status: number, error: string, message: string) => {
    log(error, requestId, nonce);
    return json({ error, message, requestId }, status);
  };

  const version = req.headers.get('a2a-version')?.trim() ?? '';
  if (!/^(0\.3|1\.0)(\.\d+)?$/.test(version)) {
    return fail(400, 'unsupported_version', 'A2A-Version must be 0.3 or 1.0.');
  }

  const contentType = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!CONTENT_TYPES.has(contentType)) {
    return fail(400, 'unsupported_content_type', 'Content-Type must be application/json or application/a2a+json.');
  }

  const signatureHeader = req.headers.get('x-a2a-signature');
  if (!signatureHeader) return fail(401, 'missing_signature', 'X-A2A-Signature is required.');

  const [protectedB64, payloadB64, signatureB64] = signatureHeader.split('.');
  if (!protectedB64 || payloadB64 !== '' || !signatureB64) {
    return fail(401, 'malformed_signature', 'X-A2A-Signature must be a compact detached JWS.');
  }

  let hdr: ProtectedHeader;
  try {
    hdr = JSON.parse(Buffer.from(protectedB64, 'base64url').toString('utf8')) as ProtectedHeader;
  } catch {
    return fail(401, 'malformed_signature', 'JWS protected header is not valid JSON.');
  }

  if (hdr.alg !== 'ES256') return fail(401, 'unsupported_alg', 'JWS alg must be ES256.');
  if (typeof hdr.kid !== 'string' || !hdr.kid) {
    return fail(401, 'malformed_signature', 'JWS header must name a kid.');
  }
  if (hdr.jku !== RAIA_JKU) {
    return fail(401, 'untrusted_jku', 'JWS jku is not RAIA\'s notification JWKS.');
  }
  if (typeof hdr.nonce !== 'string' || !hdr.nonce) {
    return fail(401, 'malformed_signature', 'JWS header must carry a nonce.');
  }
  nonce = hdr.nonce;

  const iat = issuedAt(hdr);
  if (!Number.isFinite(iat)) {
    return fail(401, 'missing_timestamp', 'JWS header must carry iat or timestamp.');
  }
  if (Math.abs(Date.now() / 1000 - iat) > MAX_SKEW_S) {
    return fail(401, 'stale_timestamp', `JWS timestamp is outside the ${MAX_SKEW_S}s window.`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await req.text());
  } catch {
    return fail(400, 'invalid_body', 'Body is not valid JSON.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail(400, 'invalid_body', 'Body must be a JSON object.');
  }

  // Re-canonicalize so formatting differences cannot invalidate a genuine
  // delivery; the sender signs the same JCS bytes.
  const jcs = canonicalize(payload as Record<string, unknown>);
  if (!jcs) return fail(400, 'invalid_body', 'Body could not be canonicalized.');

  let jwk: JWK | undefined;
  try {
    jwk = (await keys()).find((k) => k.kid === hdr.kid);
  } catch {
    return fail(503, 'jwks_unavailable', 'Could not fetch RAIA\'s signing keys.');
  }
  if (!jwk) return fail(401, 'unknown_kid', 'No RAIA key matches the JWS kid.');

  try {
    const key = await importJWK(jwk, 'ES256');
    await flattenedVerify(
      {
        protected: protectedB64,
        payload: Buffer.from(jcs, 'utf8').toString('base64url'),
        signature: signatureB64
      },
      key
    );
  } catch {
    return fail(401, 'signature_mismatch', 'JWS signature does not match the body.');
  }

  // Only consume the nonce after the signature verifies, so a forged request
  // cannot burn a genuine nonce.
  const now = Date.now();
  for (const [k, exp] of replay) if (exp <= now) replay.delete(k);
  const replayKey = `${hdr.kid}:${hdr.nonce}`;
  if (replay.has(replayKey)) {
    return fail(401, 'replayed_nonce', 'This (kid, nonce) pair was already delivered.');
  }
  if (replay.size >= REPLAY_MAX) replay.delete(replay.keys().next().value as string);
  replay.set(replayKey, now + REPLAY_TTL_MS);

  log('accepted', requestId, nonce);
  return json({ ok: true, requestId }, 200);
}
