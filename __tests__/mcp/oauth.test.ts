// Phase 1a MCP OAuth (ADR-477 D2, G-AUTH-03/10): ES256 with a dedicated key, no
// fallback secrets, constant-time client secrets, enquiry:write only. No network.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, decodeProtectedHeader } from 'jose';

const SECRET = 'test-only-grok-secret-' + 'x'.repeat(24);
let signingJwk: string;
let otherKey: CryptoKey;

beforeAll(async () => {
  const kp = await generateKeyPair('ES256', { extractable: true });
  signingJwk = JSON.stringify({ ...(await exportJWK(kp.privateKey)), kid: 'mcp-test-1' });
  otherKey = (await generateKeyPair('ES256')).privateKey as CryptoKey;
});

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('MCP_TOKEN_SIGNING_JWK', signingJwk);
  vi.stubEnv('MCP_PILOT_GROK_SECRET', SECRET);
});
afterEach(() => vi.unstubAllEnvs());

const oauth = () => import('@/lib/mcp/oauth');

async function tokenRoute(body: Record<string, string>) {
  const { POST } = await import('@/app/oauth/token/route');
  const res = await POST(new Request('https://movehome.org/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  }));
  return { status: res.status, body: await res.json() };
}

const claims = { client_id: 'grok-pilot-1', organisation_id: 'org-gb-mcptest', platform: 'grok', scope: 'enquiry:write' };

describe('MCP OAuth — issue', () => {
  it('issues a 15-minute ES256 token for a registered client with the right secret', async () => {
    const { status, body } = await tokenRoute({ grant_type: 'client_credentials', client_id: 'grok-pilot-1', client_secret: SECRET });
    expect(status).toBe(200);
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 900, scope: 'enquiry:write' });
    expect(decodeProtectedHeader(body.access_token)).toMatchObject({ alg: 'ES256', kid: 'mcp-test-1' });
    const verified = await (await oauth()).verifyMcpToken(`Bearer ${body.access_token}`);
    expect(verified).toEqual(claims);
  });

  it('refuses the old public default secret', async () => {
    const r = await tokenRoute({ grant_type: 'client_credentials', client_id: 'grok-pilot-1', client_secret: 'grok-pilot-secret-key-1a' });
    expect(r.status).toBe(401);
  });

  it('refuses every client when its secret env is unset (no fallback)', async () => {
    vi.stubEnv('MCP_PILOT_GROK_SECRET', '');
    const r = await tokenRoute({ grant_type: 'client_credentials', client_id: 'grok-pilot-1', client_secret: '' });
    expect(r.status).toBe(401);
    const r2 = await tokenRoute({ grant_type: 'client_credentials', client_id: 'gemini-pilot-1', client_secret: 'gemini-pilot-secret-key-1a' });
    expect(r2.status).toBe(401);
  });

  it('issues nothing when the signing key is unset (503, fail closed)', async () => {
    vi.stubEnv('MCP_TOKEN_SIGNING_JWK', '');
    const r = await tokenRoute({ grant_type: 'client_credentials', client_id: 'grok-pilot-1', client_secret: SECRET });
    expect(r.status).toBe(503);
    expect(r.body.access_token).toBeUndefined();
  });

  it('refuses any scope other than enquiry:write instead of copying it into the token', async () => {
    const r = await tokenRoute({ grant_type: 'client_credentials', client_id: 'grok-pilot-1', client_secret: SECRET, scope: 'admin' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_scope');
  });

  it('does not treat prototype keys as registered clients', async () => {
    const r = await tokenRoute({ grant_type: 'client_credentials', client_id: 'constructor', client_secret: SECRET });
    expect(r.status).toBe(401);
  });
});

describe('MCP OAuth — verify (G-AUTH-03 must-fail)', () => {
  it('rejects a token forged with the old public HS256 key', async () => {
    const forged = await new SignJWT({ ...claims, sub: 'grok-pilot-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('https://movehome.org').setAudience('movehome-mcp-write').setIssuedAt().setExpirationTime('15m')
      .sign(new TextEncoder().encode('movehome-mcp-es256-pilot-secret-key-2026-11-14'));
    expect(await (await oauth()).verifyMcpToken(`Bearer ${forged}`)).toBeNull();
  });

  it('rejects a token signed with another ES256 key', async () => {
    const wrongKey = await new SignJWT({ ...claims, sub: 'grok-pilot-1' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer('https://movehome.org').setAudience('movehome-mcp-write').setIssuedAt().setExpirationTime('15m')
      .sign(otherKey);
    expect(await (await oauth()).verifyMcpToken(`Bearer ${wrongKey}`)).toBeNull();
  });

  it('rejects wrong audience, expired, unregistered-client and tenant-mismatch tokens', async () => {
    const { getSigningKeys, verifyMcpToken } = await oauth();
    const { privateKey } = (await getSigningKeys())!;
    const mint = (c: Record<string, string>, aud = 'movehome-mcp-write', exp: string | number = '15m') =>
      new SignJWT(c).setProtectedHeader({ alg: 'ES256' }).setSubject(c.client_id)
        .setIssuer('https://movehome.org').setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(privateKey);
    expect(await verifyMcpToken(`Bearer ${await mint(claims, 'raia-mcp-write')}`)).toBeNull();
    expect(await verifyMcpToken(`Bearer ${await mint(claims, 'movehome-mcp-write', Math.floor(Date.now() / 1000) - 60)}`)).toBeNull();
    expect(await verifyMcpToken(`Bearer ${await mint({ ...claims, client_id: 'evil-client' })}`)).toBeNull();
    expect(await verifyMcpToken(`Bearer ${await mint({ ...claims, organisation_id: 'org-gb-realagency' })}`)).toBeNull();
  });

  it('verifies nothing when the signing key is unset', async () => {
    const { getSigningKeys, verifyMcpToken } = await oauth();
    const { privateKey } = (await getSigningKeys())!;
    const good = await new SignJWT(claims).setProtectedHeader({ alg: 'ES256' }).setSubject('grok-pilot-1')
      .setIssuer('https://movehome.org').setAudience('movehome-mcp-write').setIssuedAt().setExpirationTime('15m').sign(privateKey);
    vi.stubEnv('MCP_TOKEN_SIGNING_JWK', '');
    vi.resetModules();
    expect(await (await oauth()).verifyMcpToken(`Bearer ${good}`)).toBeNull();
  });

  it('a verified token without enquiry:write lacks write scope (route answers 403)', async () => {
    const { hasWriteScope } = await oauth();
    expect(hasWriteScope({ ...claims, scope: 'enquiry:read' })).toBe(false);
    expect(hasWriteScope(claims)).toBe(true);
  });
});
