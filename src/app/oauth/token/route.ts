import { NextResponse } from 'next/server';
import { clientSecretMatches, getClientRegistration, issueMcpToken, TokenIssueError } from '@/lib/mcp/oauth';
import { issuePortalAccessToken } from '@/lib/portal/jwt';
import { verifyClientSecret } from '@/lib/portal/secrets';
import { portalTable, type PortalCredentialRow } from '@/lib/portal/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_PORTAL_SCOPES = ['feed.read', 'feed.write', 'products.write'] as const;

export async function POST(req: Request) {
  let grantType: string | null = null;
  let clientId: string | null = null;
  let clientSecret: string | null = null;
  let scope: string | null = null;

  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    grantType = params.get('grant_type');
    clientId = params.get('client_id');
    clientSecret = params.get('client_secret');
    if (params.get('scope')) scope = params.get('scope')!;
  } else if (contentType.includes('application/json')) {
    try {
      const json = await req.json();
      grantType = json.grant_type;
      clientId = json.client_id;
      clientSecret = json.client_secret;
      if (json.scope) scope = json.scope;
    } catch {
      /* ignore */
    }
  }

  // Check HTTP Basic Auth if header present
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('basic ')) {
    try {
      const b64 = authHeader.slice(6).trim();
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx >= 0) {
        clientId = decoded.slice(0, idx);
        clientSecret = decoded.slice(idx + 1);
      }
    } catch {
      /* ignore */
    }
  }

  if (grantType !== 'client_credentials') {
    return NextResponse.json(
      { error: 'unsupported_grant_type', error_description: 'Only grant_type=client_credentials is supported.' },
      { status: 400 }
    );
  }

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'invalid_client', error_description: 'Missing client_id or client_secret.' },
      { status: 401 }
    );
  }

  // Portal Feed credentials (pcid_*)
  if (clientId.startsWith('pcid_')) {
    let cred: PortalCredentialRow | null = null;
    try {
      const { data } = await portalTable('tbl_portal_credentials')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();
      cred = data as unknown as PortalCredentialRow | null;
    } catch (e) {
      console.error('[/oauth/token] portal credential lookup error:', e);
      return NextResponse.json(
        { error: 'server_error', error_description: 'Credential lookup failed.' },
        { status: 500 }
      );
    }

    const verified = cred && !cred.revoked_at ? verifyClientSecret(clientSecret, cred.secret_hash) : false;
    if (!cred || cred.revoked_at || !verified) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: 'Invalid client credentials.' },
        { status: 401 }
      );
    }

    const requestedList = (scope || cred.allowed_scopes.join(' ')).split(/\s+/).filter(Boolean);
    const granted: string[] = [];
    for (const s of requestedList) {
      if ((ALLOWED_PORTAL_SCOPES as readonly string[]).includes(s) && cred.allowed_scopes.includes(s)) {
        if (!granted.includes(s)) granted.push(s);
      }
    }

    if (granted.length === 0) {
      return NextResponse.json(
        { error: 'invalid_scope', error_description: 'No requested scopes are permitted for this credential.' },
        { status: 400 }
      );
    }

    try {
      const { token, expiresAt } = issuePortalAccessToken({
        sub: cred.client_id,
        scope: granted.join(' '),
        agent_id: cred.agent_id,
        branch_id: cred.default_branch_id ?? undefined,
        expiresInSeconds: 3600
      });

      return NextResponse.json(
        {
          access_token: token,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: granted.join(' ')
        },
        {
          status: 200,
          headers: {
            'Cache-Control': 'no-store',
            Pragma: 'no-cache'
          }
        }
      );
    } catch (e) {
      console.error('[/oauth/token] portal token issue error:', e);
      return NextResponse.json(
        { error: 'server_error', error_description: 'Failed to issue portal token.' },
        { status: 500 }
      );
    }
  }

  // MCP Pilot credentials
  const reg = getClientRegistration(clientId);
  if (!reg || !clientSecretMatches(reg, clientSecret)) {
    return NextResponse.json(
      { error: 'invalid_client', error_description: 'Invalid client credentials.' },
      { status: 401 }
    );
  }

  try {
    const tokenInfo = await issueMcpToken(clientId, scope ?? 'enquiry:write');
    return NextResponse.json(
      {
        access_token: tokenInfo.access_token,
        token_type: 'Bearer',
        expires_in: tokenInfo.expires_in,
        scope: tokenInfo.scope
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          Pragma: 'no-cache'
        }
      }
    );
  } catch (e) {
    if (e instanceof TokenIssueError && e.code === 'invalid_scope') {
      return NextResponse.json({ error: 'invalid_scope', error_description: e.message }, { status: 400 });
    }
    if (e instanceof TokenIssueError && e.code === 'server_error') {
      console.error('[/oauth/token] signing key not configured');
      return NextResponse.json(
        { error: 'temporarily_unavailable', error_description: 'Token issuance is not configured.' },
        { status: 503 }
      );
    }
    console.error('[/oauth/token] Error issuing token:', e);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to issue token.' },
      { status: 500 }
    );
  }
}
