// Serves the A2A Agent Card. Reachable at the spec well-known locations via
// rewrites in next.config.js:
//   /.well-known/agent.json       → /api/agent-card
//   /.well-known/agent-card.json  → /api/agent-card
// CORS is open because anonymous agents fetch the card cross-origin.

import { NextResponse } from 'next/server';
import { buildAgentCard } from '@/lib/a2a/card';
import { signAgentCard } from '@/lib/a2a/card-signing';

export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  return NextResponse.json(await signAgentCard(buildAgentCard()), {
    status: 200,
    headers: { ...CORS, 'Cache-Control': 'public, max-age=300' }
  });
}
