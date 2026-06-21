// GET /api/registry/v1/agents — public, filterable list of listed real-estate agents.
// Query: q, location (UN/LOCODE), service_type, category, healthy=true, limit, offset.

import { NextResponse } from 'next/server';
import { listAgents } from '@/lib/registry/store';
import { REGISTRY_CORS, ipKey, withCors, corsJson } from '@/lib/registry/http';
import { enforceRateLimit } from '@/lib/portal/rate-limit';
import { tooManyRequests, serverError } from '@/lib/portal/problem';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: REGISTRY_CORS });
}

export async function GET(req: Request) {
  try {
    const decision = await enforceRateLimit(ipKey(req, 'registry-read'), 'registry.read');
    if (!decision.ok) return withCors(tooManyRequests(decision.retryAfter, decision.limit, decision.resetUnix));
  } catch {
    /* fail open */
  }

  const url = new URL(req.url);
  const num = (v: string | null, def: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : def;
  };
  const limit = num(url.searchParams.get('limit'), 20, 1, 50);
  const offset = num(url.searchParams.get('offset'), 0, 0, 100_000);

  try {
    const { agents, total } = await listAgents({
      search: url.searchParams.get('q') || undefined,
      location: url.searchParams.get('location')?.toUpperCase() || undefined,
      serviceType: url.searchParams.get('service_type') || undefined,
      category: url.searchParams.get('category') || undefined,
      skill: url.searchParams.get('skill') || undefined,
      healthyOnly: url.searchParams.get('healthy') === 'true',
      limit,
      offset
    });
    return corsJson({ agents, total, limit, offset }, 200, { 'Cache-Control': 'public, max-age=30' });
  } catch (e) {
    console.error('[registry/list]', e);
    return withCors(serverError('Could not list agents.'));
  }
}
