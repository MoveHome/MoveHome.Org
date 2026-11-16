// POST /api/a2a/push-receiver — inbound A2A push notifications from RAIA.
//
// Ships DARK: nothing registers this URL and `capabilities.pushNotifications`
// stays false until the operator flips RAIA_A2A_PUSH_VERIFIED. The wire contract
// is ADR-472 §C: `X-A2A-Signature` is a compact detached ES256 JWS
// (`protected..signature`) over the RFC 8785 (JCS) canonical body, and each
// protocol version is bound to exactly one media type and body variant —
// `0.3` / `application/json` / bare Task, `1.0` / `application/a2a+json` /
// StreamResponse. The received bytes must BE the canonical bytes, so
// duplicate-member or re-ordered mutations cannot pass.
//
// Verification fails closed: alg/kid/jku/nonce/iat are checked, the key comes
// from RAIA's fixed jku (never a caller-supplied URL), and a replayed
// (kid, nonce) is rejected for 10 minutes — durably, across instances (see
// ./replay-store). Logs carry request id + nonce + verdict only — never bodies
// or key material.

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import canonicalize from 'canonicalize';
import { flattenedVerify, importJWK, type JWK } from 'jose';
import { consumeNonce } from './replay-store';

export const dynamic = 'force-dynamic';

const RAIA_JKU = process.env.A2A_PUSH_JKU || 'https://app.estateaigents.com/.well-known/jwks.json';
const MAX_SKEW_S = 300; // ADR-472: reject anything older/newer than 5 minutes
const JWKS_TTL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 5_000;
// Unauthenticated endpoint: bound memory and parsing work before auth.
const MAX_BODY_BYTES = 256 * 1024;
const MAX_BODY_DEPTH = 32;

// ADR-472 §C pairs the version with one media type and one body variant, so a
// cross-pairing cannot slip through as two independent checks.
const WIRE = {
  '0.3': { media: 'application/json', body: 'an A2A 0.3 Task (kind:"task", id, status)' },
  '1.0': {
    media: 'application/a2a+json',
    body: 'an A2A 1.0 StreamResponse (exactly one of task, message, statusUpdate, artifactUpdate)'
  }
} as const;

const STREAM_MEMBERS = ['task', 'message', 'statusUpdate', 'artifactUpdate'] as const;

type Version = keyof typeof WIRE;

type ProtectedHeader = {
  alg?: unknown;
  kid?: unknown;
  jku?: unknown;
  nonce?: unknown;
  iat?: unknown;
  timestamp?: unknown;
};

let jwksCache: { at: number; keys: JWK[] } | null = null;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function log(verdict: string, requestId: string, nonce?: string) {
  console.info('[a2a-push]', JSON.stringify({ requestId, nonce: nonce ?? null, verdict }));
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function tooDeep(v: unknown, depth = 0): boolean {
  if (depth > MAX_BODY_DEPTH) return true;
  if (Array.isArray(v)) return v.some((x) => tooDeep(x, depth + 1));
  if (isObject(v)) return Object.values(v).some((x) => tooDeep(x, depth + 1));
  return false;
}

// The SDK body variant the version is allowed to carry.
function matchesVersion(version: Version, p: Record<string, unknown>): boolean {
  if (version === '0.3') return p.kind === 'task' && typeof p.id === 'string' && isObject(p.status);
  const present = STREAM_MEMBERS.filter((m) => p[m] !== undefined);
  return present.length === 1 && isObject(p[present[0]]);
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

  const declaredLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return fail(413, 'body_too_large', `Body must be at most ${MAX_BODY_BYTES} bytes.`);
  }

  const version = req.headers.get('a2a-version')?.trim() ?? '';
  if (!(version in WIRE)) {
    return fail(400, 'unsupported_version', 'A2A-Version must be exactly 0.3 or 1.0.');
  }
  const wire = WIRE[version as Version];

  const contentType = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== wire.media) {
    return fail(400, 'unsupported_content_type', `A2A-Version ${version} requires Content-Type ${wire.media}.`);
  }

  const signatureHeader = req.headers.get('x-a2a-signature');
  if (!signatureHeader) return fail(401, 'missing_signature', 'X-A2A-Signature is required.');

  const [protectedB64, payloadB64, signatureB64] = signatureHeader.split('.');
  if (!protectedB64 || payloadB64 !== '' || !signatureB64) {
    return fail(401, 'malformed_signature', 'X-A2A-Signature must be a compact detached JWS.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(protectedB64, 'base64url').toString('utf8'));
  } catch {
    return fail(401, 'malformed_signature', 'JWS protected header is not valid JSON.');
  }
  // A JSON `null`/scalar/array here would throw on property access.
  if (!isObject(parsed)) return fail(401, 'malformed_signature', 'JWS protected header must be a JSON object.');

  const hdr = parsed as ProtectedHeader;
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

  // shortcut: the body is buffered before this check; the content-length
  // pre-check bounds memory and this bounds parse/JCS work. Upgrade to a
  // streamed reader if the platform ever admits much larger bodies.
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return fail(413, 'body_too_large', `Body must be at most ${MAX_BODY_BYTES} bytes.`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return fail(400, 'invalid_body', 'Body is not valid JSON.');
  }
  if (!isObject(payload)) return fail(400, 'invalid_body', 'Body must be a JSON object.');
  if (tooDeep(payload)) return fail(400, 'invalid_body', `Body must be at most ${MAX_BODY_DEPTH} levels deep.`);

  // The signed bytes ARE the received bytes: a body that does not serialize
  // back to itself carries duplicate, re-ordered or padded members and is not
  // the body the sender signed.
  const jcs = canonicalize(payload);
  if (!jcs) return fail(400, 'invalid_body', 'Body could not be canonicalized.');
  if (jcs !== raw) {
    return fail(400, 'non_canonical_body', 'Body must be the exact canonical bytes that were signed.');
  }

  if (!matchesVersion(version as Version, payload)) {
    return fail(400, 'invalid_body', `Body is not ${wire.body}.`);
  }

  let candidates: JWK[];
  try {
    candidates = (await keys()).filter(
      (k) => k.kid === hdr.kid && k.kty === 'EC' && (!k.alg || k.alg === 'ES256')
    );
  } catch {
    return fail(503, 'jwks_unavailable', 'Could not fetch RAIA\'s signing keys.');
  }
  if (candidates.length === 0) return fail(401, 'unknown_kid', 'No RAIA key matches the JWS kid.');
  // An ambiguous kid in the trusted JWKS must fail closed, not pick a key.
  if (candidates.length > 1) {
    return fail(401, 'ambiguous_kid', 'RAIA\'s JWKS holds more than one key with this kid.');
  }

  try {
    const key = await importJWK(candidates[0], 'ES256');
    await flattenedVerify(
      {
        protected: protectedB64,
        payload: Buffer.from(raw, 'utf8').toString('base64url'),
        signature: signatureB64
      },
      key
    );
  } catch {
    return fail(401, 'signature_mismatch', 'JWS signature does not match the body.');
  }

  // Only consume the nonce after the signature verifies, so a forged request
  // cannot burn a genuine nonce.
  const verdict = await consumeNonce(hdr.kid, hdr.nonce);
  if (verdict === 'replayed') {
    return fail(401, 'replayed_nonce', 'This (kid, nonce) pair was already delivered.');
  }
  if (verdict === 'unavailable') {
    return fail(503, 'replay_store_unavailable', 'Could not record the delivery nonce.');
  }

  log('accepted', requestId, nonce);
  return json({ ok: true, requestId }, 200);
}
