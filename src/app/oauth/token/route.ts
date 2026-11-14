import { NextResponse } from 'next/server';
import { getClientRegistration, issueMcpToken } from '@/lib/mcp/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let grantType: string | null = null;
  let clientId: string | null = null;
  let clientSecret: string | null = null;
  let scope = 'enquiry:write';

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

  const reg = getClientRegistration(clientId);
  if (!reg || (reg.secret && reg.secret !== clientSecret)) {
    return NextResponse.json(
      { error: 'invalid_client', error_description: 'Invalid client credentials.' },
      { status: 401 }
    );
  }

  try {
    const tokenInfo = await issueMcpToken(clientId, scope);
    return NextResponse.json(
      {
        access_token: tokenInfo.access_token,
        token_type: 'Bearer',
        expires_in: tokenInfo.expires_in,
        scope
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
    console.error('[/oauth/token] Error issuing token:', e);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to issue token.' },
      { status: 500 }
    );
  }
}
