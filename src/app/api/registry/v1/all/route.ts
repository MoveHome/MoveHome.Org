// GET /api/registry/v1/all  (also served at /registry.json via a rewrite)
// Machine-readable bulk export of every listed agent — a single fetch for agents
// and tooling that want the whole registry without paginating.

import { NextResponse } from 'next/server';
import { listAllAgents } from '@/lib/registry/store';
import { REGISTRY_CORS, withCors, corsJson } from '@/lib/registry/http';
import { serverError } from '@/lib/portal/problem';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: REGISTRY_CORS });
}

export async function GET() {
  try {
    const agents = await listAllAgents();
    return corsJson(
      {
        registry: 'movehome-a2a-registry',
        url: 'https://movehome.org/registry',
        generated_at: new Date().toISOString(),
        count: agents.length,
        agents
      },
      200,
      { 'Cache-Control': 'public, max-age=120' }
    );
  } catch (e) {
    console.error('[registry/all]', e);
    return withCors(serverError('Could not export the registry.'));
  }
}
