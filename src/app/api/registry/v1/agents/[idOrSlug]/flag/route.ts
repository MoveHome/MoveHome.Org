// POST /api/registry/v1/agents/{id|slug}/flag — community flag for abuse/misfile.
// Increments flag_count; the store auto-hides + moves to 'pending' past a threshold.
// Per-IP rate limited so flagging can't be weaponised to spam-hide.

import { NextResponse } from 'next/server';
import { getAgent, flagAgent } from '@/lib/registry/store';
import { REGISTRY_CORS, ipKey, withCors, corsJson } from '@/lib/registry/http';
import { enforceRateLimit } from '@/lib/portal/rate-limit';
import { notFound, tooManyRequests, serverError } from '@/lib/portal/problem';

export const dynamic = 'force-dynamic';

const FLAG_PER_MIN = 5;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: REGISTRY_CORS });
}

export async function POST(req: Request, { params }: { params: Promise<{ idOrSlug: string }> }) {
  try {
    const decision = await enforceRateLimit(ipKey(req, 'registry-flag'), 'registry.write', FLAG_PER_MIN);
    if (!decision.ok) return withCors(tooManyRequests(decision.retryAfter, decision.limit, decision.resetUnix));
  } catch {
    /* fail open */
  }

  try {
    const { idOrSlug } = await params;
    const agent = await getAgent(idOrSlug);
    if (!agent) return withCors(notFound('No listed agent with that id or slug.'));
    await flagAgent(agent.id);
    return corsJson({ ok: true, message: 'Flag recorded. Thank you — our team will review.' });
  } catch (e) {
    console.error('[registry/flag]', e);
    return withCors(serverError('Could not record the flag.'));
  }
}
