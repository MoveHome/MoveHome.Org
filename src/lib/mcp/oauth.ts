import { createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT, importJWK, jwtVerify, type JWK, type CryptoKey } from 'jose';

/**
 * Phase 1a MCP write-door OAuth (ADR-477 D2): confidential `client_credentials`
 * clients, 15-minute ES256 access tokens signed with a dedicated key,
 * `scope=enquiry:write`, audience `movehome-mcp-write`.
 *
 * Fail closed. Nothing here has a fallback value: this repository is public, so
 * any default secret or key is known to everyone. With the signing key or a
 * client's secret unset, no token is issued and no token verifies.
 *
 * Env:
 *   MCP_TOKEN_SIGNING_JWK      private EC P-256 JWK (JSON) — the dedicated ES256 key
 *   MCP_PILOT_GROK_SECRET      per-client secrets (one per registered client)
 *   MCP_PILOT_GEMINI_SECRET
 *   MCP_PILOT_MUSE_SECRET
 */

export const WRITE_SCOPE = 'enquiry:write';
const ALG = 'ES256';
const AUDIENCE = 'movehome-mcp-write';
const ISSUER = 'https://movehome.org';
const TOKEN_TTL_SECONDS = 15 * 60;

export interface PilotClientRegistration {
  client_id: string;
  organisation_id: string;
  platform: 'grok' | 'gemini' | 'muse';
  /** Env var holding this client's secret. Unset → the client cannot authenticate. */
  secretEnv: string;
}

// Manually registered pilot clients. Each binds to exactly one organisation (ADR-477 D2).
const REGISTERED_CLIENTS: Record<string, PilotClientRegistration> = {
  'grok-pilot-1': { client_id: 'grok-pilot-1', organisation_id: 'org-gb-mcptest', platform: 'grok', secretEnv: 'MCP_PILOT_GROK_SECRET' },
  'gemini-pilot-1': { client_id: 'gemini-pilot-1', organisation_id: 'org-gb-mcptest', platform: 'gemini', secretEnv: 'MCP_PILOT_GEMINI_SECRET' },
  'muse-pilot-1': { client_id: 'muse-pilot-1', organisation_id: 'org-gb-mcptest', platform: 'muse', secretEnv: 'MCP_PILOT_MUSE_SECRET' },
};

export function getClientRegistration(clientId: string): PilotClientRegistration | null {
  return Object.prototype.hasOwnProperty.call(REGISTERED_CLIENTS, clientId) ? REGISTERED_CLIENTS[clientId] : null;
}

/** Constant-time secret check. An unset or empty configured secret never matches. */
export function clientSecretMatches(reg: PilotClientRegistration, presented: string): boolean {
  const configured = process.env[reg.secretEnv]?.trim();
  if (!configured || !presented) return false;
  const a = createHash('sha256').update(configured).digest();
  const b = createHash('sha256').update(presented).digest();
  return timingSafeEqual(a, b);
}

interface SigningKeys { privateKey: CryptoKey; publicKey: CryptoKey; kid?: string }

let cachedKeys: { source: string; keys: SigningKeys } | null = null;

/** The dedicated ES256 key pair, or null when unset or invalid (→ fail closed). */
export async function getSigningKeys(): Promise<SigningKeys | null> {
  const raw = process.env.MCP_TOKEN_SIGNING_JWK?.trim();
  if (!raw) return null;
  if (cachedKeys && cachedKeys.source === raw) return cachedKeys.keys;
  try {
    const jwk = JSON.parse(raw) as JWK;
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || !jwk.x || !jwk.y) return null;
    const { d: _private, ...publicJwk } = jwk;
    const keys: SigningKeys = {
      privateKey: (await importJWK(jwk, ALG)) as CryptoKey,
      publicKey: (await importJWK(publicJwk, ALG)) as CryptoKey,
      kid: jwk.kid,
    };
    cachedKeys = { source: raw, keys };
    return keys;
  } catch {
    return null;
  }
}

export class TokenIssueError extends Error {
  constructor(public readonly code: 'invalid_scope' | 'server_error', message: string) {
    super(message);
  }
}

export async function issueMcpToken(
  clientId: string,
  requestedScope?: string | null,
): Promise<{ access_token: string; expires_in: number; scope: string }> {
  const reg = getClientRegistration(clientId);
  if (!reg) throw new Error('Unknown client_id');
  // Phase 1a grants exactly one scope; anything else is refused rather than copied into the token.
  const scope = requestedScope?.trim() || WRITE_SCOPE;
  if (scope !== WRITE_SCOPE) throw new TokenIssueError('invalid_scope', `Only scope=${WRITE_SCOPE} is available.`);

  const keys = await getSigningKeys();
  if (!keys) throw new TokenIssueError('server_error', 'Token signing key is not configured.');

  const access_token = await new SignJWT({
    client_id: clientId,
    organisation_id: reg.organisation_id,
    platform: reg.platform,
    scope,
  })
    .setProtectedHeader({ alg: ALG, ...(keys.kid ? { kid: keys.kid } : {}) })
    .setSubject(clientId)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(keys.privateKey);

  return { access_token, expires_in: TOKEN_TTL_SECONDS, scope };
}

export interface VerifiedMcpToken {
  client_id: string;
  organisation_id: string;
  platform: string;
  scope: string;
}

export function hasWriteScope(token: VerifiedMcpToken): boolean {
  return token.scope.split(/\s+/).includes(WRITE_SCOPE);
}

/**
 * A verified token, or null for anything missing, malformed, expired, forged, signed
 * with another key or algorithm, or for a client that is no longer registered.
 * The tenant binding is re-read from the registry, never trusted from the token.
 */
export async function verifyMcpToken(authHeader: string | null): Promise<VerifiedMcpToken | null> {
  if (!authHeader) return null;
  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;

  const keys = await getSigningKeys();
  if (!keys) return null;

  try {
    const { payload } = await jwtVerify(parts[1], keys.publicKey, {
      algorithms: [ALG],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.client_id !== 'string' || payload.sub !== payload.client_id) return null;
    const reg = getClientRegistration(payload.client_id);
    if (!reg || payload.organisation_id !== reg.organisation_id) return null;
    return {
      client_id: reg.client_id,
      organisation_id: reg.organisation_id,
      platform: reg.platform,
      scope: typeof payload.scope === 'string' ? payload.scope : '',
    };
  } catch {
    return null;
  }
}
