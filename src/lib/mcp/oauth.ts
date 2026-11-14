import { SignJWT, jwtVerify } from 'jose';

export interface PilotClientRegistration {
  client_id: string;
  organisation_id: string;
  platform: 'grok' | 'gemini' | 'muse';
  secret?: string; // Optional client_secret for simple pilot auth
}

// Manually registered pilot clients
const REGISTERED_CLIENTS: Record<string, PilotClientRegistration> = {
  'grok-pilot-1': {
    client_id: 'grok-pilot-1',
    organisation_id: 'org-gb-mcptest',
    platform: 'grok',
    secret: process.env.MCP_PILOT_GROK_SECRET || 'grok-pilot-secret-key-1a'
  },
  'gemini-pilot-1': {
    client_id: 'gemini-pilot-1',
    organisation_id: 'org-gb-mcptest',
    platform: 'gemini',
    secret: process.env.MCP_PILOT_GEMINI_SECRET || 'gemini-pilot-secret-key-1a'
  },
  'muse-pilot-1': {
    client_id: 'muse-pilot-1',
    organisation_id: 'org-gb-mcptest',
    platform: 'muse',
    secret: process.env.MCP_PILOT_MUSE_SECRET || 'muse-pilot-secret-key-1a'
  }
};

const JWT_SECRET = new TextEncoder().encode(
  process.env.MCP_JWT_SECRET || 'movehome-mcp-es256-pilot-secret-key-2026-11-14'
);
const AUDIENCE = 'movehome-mcp-write';
const ISSUER = 'https://movehome.org';

export function getClientRegistration(clientId: string): PilotClientRegistration | null {
  return REGISTERED_CLIENTS[clientId] || null;
}

export async function issueMcpToken(clientId: string, scope = 'enquiry:write'): Promise<{ access_token: string; expires_in: number }> {
  const reg = getClientRegistration(clientId);
  if (!reg) throw new Error('Unknown client_id');

  const expiresInSeconds = 15 * 60; // 15 mins
  const token = await new SignJWT({
    sub: clientId,
    client_id: clientId,
    organisation_id: reg.organisation_id,
    platform: reg.platform,
    scope
  })
    .setProtectedHeader({ alg: 'HS256' }) // HS256 for symmetric secret ease in pilot
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime('15m')
    .sign(JWT_SECRET);

  return { access_token: token, expires_in: expiresInSeconds };
}

export interface VerifiedMcpToken {
  client_id: string;
  organisation_id: string;
  platform: string;
  scope: string;
}

export async function verifyMcpToken(authHeader: string | null): Promise<VerifiedMcpToken | null> {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;

  try {
    const { payload } = await jwtVerify(parts[1], JWT_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE
    });

    if (
      typeof payload.client_id !== 'string' ||
      typeof payload.organisation_id !== 'string' ||
      typeof payload.platform !== 'string'
    ) {
      return null;
    }

    return {
      client_id: payload.client_id,
      organisation_id: payload.organisation_id,
      platform: payload.platform,
      scope: typeof payload.scope === 'string' ? payload.scope : ''
    };
  } catch {
    return null;
  }
}
