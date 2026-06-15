// Signs the A2A Agent Card so consumers can verify it is authentically MoveHome's
// (A2A v0.3 signed AgentCard). Per the A2A spec the signature is a JWS (RFC 7515)
// over the RFC 8785 (JCS) canonicalization of the card with its `signatures` field
// removed; verifiers fetch the public key from the `jku` JWKS by `kid`.
//
// This is a NO-OP unless a signing key is configured via A2A_CARD_SIGNING_JWK, so
// unsigned dev/prod deploys keep serving exactly the card they do today. The signed
// card is computed once per server instance and cached (the card is static per deploy).

import canonicalize from 'canonicalize';
import { importJWK, FlattenedSign } from 'jose';
import type { AgentCard, AgentCardSignature } from './types';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://movehome.org').replace(/\/$/, '');
const KID = process.env.A2A_CARD_SIGNING_KID || 'movehome-a2a-1';
const JKU = `${SITE_URL}/.well-known/jwks.json`;
const ALG = 'ES256';

type Jwk = Record<string, unknown>;

function privateJwk(): Jwk | null {
  const raw = process.env.A2A_CARD_SIGNING_JWK;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Jwk;
  } catch {
    console.error('[a2a] A2A_CARD_SIGNING_JWK is set but is not valid JSON; serving unsigned card.');
    return null;
  }
}

// JCS-canonical bytes of the card with `signatures` excluded (spec requirement).
function canonicalPayload(card: AgentCard): Uint8Array {
  const { signatures: _drop, ...unsigned } = card as AgentCard & { signatures?: unknown };
  const jcs = canonicalize(unsigned);
  if (jcs === undefined) throw new Error('card canonicalization produced no output');
  return new TextEncoder().encode(jcs);
}

let cached: Promise<AgentCard> | null = null;

// Returns the card with a `signatures` array attached, or the card unchanged when
// no signing key is configured (a valid state for a public, no-auth agent).
export function signAgentCard(card: AgentCard): Promise<AgentCard> {
  if (!cached) cached = computeSignedCard(card);
  return cached;
}

async function computeSignedCard(card: AgentCard): Promise<AgentCard> {
  const jwk = privateJwk();
  if (!jwk) return card;
  try {
    const key = await importJWK(jwk, ALG);
    const jws = await new FlattenedSign(canonicalPayload(card))
      .setProtectedHeader({ alg: ALG, typ: 'JOSE', kid: KID, jku: JKU })
      .sign(key);
    const signature: AgentCardSignature = { protected: jws.protected!, signature: jws.signature };
    return { ...card, signatures: [signature] };
  } catch (e) {
    // Never let a signing failure take down discovery — fall back to the unsigned card.
    console.error('[a2a] agent card signing failed; serving unsigned card.', e);
    return card;
  }
}

// Public JWKS for /.well-known/jwks.json. Whitelists only the public EC members
// (kty/crv/x/y) so no private/secret component can ever be emitted, even if the
// configured key's format changes. Empty when no key is configured.
export function publicJwks(): { keys: Jwk[] } {
  const jwk = privateJwk();
  if (!jwk) return { keys: [] };
  const { kty, crv, x, y } = jwk as Record<'kty' | 'crv' | 'x' | 'y', unknown>;
  return { keys: [{ kty, crv, x, y, kid: KID, alg: ALG, use: 'sig' }] };
}
