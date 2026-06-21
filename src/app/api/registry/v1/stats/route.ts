// GET /api/registry/v1/stats — public registry statistics (totals + top facets).

import { NextResponse } from 'next/server';
import { getStats } from '@/lib/registry/store';
import { REGISTRY_CORS, ipKey, withCors, corsJson } from '@/lib/registry/http';
import { enforceRateLimit } from '@/lib/portal/rate-limit';
import { tooManyRequests, serverError } from '@/lib/portal/problem';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: REGISTRY_CORS });
}

export async function GET(req: Request) {
  try {
    const d = await enforceRateLimit(ipKey(req, 'registry-read'), 'registry.read');
    if (!d.ok) return withCors(tooManyRequests(d.retryAfter, d.limit, d.resetUnix));
  } catch {
    /* fail open */
  }
  try {
    const stats = await getStats();
    return corsJson(stats, 200, { 'Cache-Control': 'public, max-age=60' });
  } catch (e) {
    console.error('[registry/stats]', e);
    return withCors(serverError('Could not compute registry stats.'));
  }
}
