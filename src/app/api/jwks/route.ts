// Publishes the public signing key(s) for the A2A Agent Card as a JWKS, reachable
// at /.well-known/jwks.json via a rewrite in next.config.js. The signed card's JWS
// protected header points here (`jku`), so any agent can verify the card is ours.
// Returns an empty key set when no signing key is configured.

import { NextResponse } from 'next/server';
import { publicJwks } from '@/lib/a2a/card-signing';

export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export function GET() {
  return NextResponse.json(publicJwks(), {
    headers: { ...CORS, 'Cache-Control': 'public, max-age=3600' }
  });
}
