// GET /api/registry/v1/agents/{id|slug} — agent detail.
// PUT  /api/registry/v1/agents/{id}     — re-sync the card from its wellKnownURI.

import { NextResponse } from 'next/server';
import { fetchAndValidateCard } from '@/lib/registry/ingest';
import { getAgent, updateAgentCard } from '@/lib/registry/store';
import { REGISTRY_CORS, ipKey, withCors, corsJson } from '@/lib/registry/http';
import { enforceRateLimit } from '@/lib/portal/rate-limit';
import { notFound, tooManyRequests, serverError, problem } from '@/lib/portal/problem';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: REGISTRY_CORS });
}

export async function GET(_req: Request, { params }: { params: Promise<{ idOrSlug: string }> }) {
  try {
    const { idOrSlug } = await params;
    const agent = await getAgent(idOrSlug);
    if (!agent) return withCors(notFound('No listed agent with that id or slug.'));
    return corsJson({ agent }, 200, { 'Cache-Control': 'public, max-age=30' });
  } catch (e) {
    console.error('[registry/detail]', e);
    return withCors(serverError('Could not load the agent.'));
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ idOrSlug: string }> }) {
  try {
    const decision = await enforceRateLimit(ipKey(req, 'registry-resync'), 'registry.write');
    if (!decision.ok) return withCors(tooManyRequests(decision.retryAfter, decision.limit, decision.resetUnix));
  } catch {
    /* fail open */
  }

  const { idOrSlug } = await params;
  const agent = await getAgent(idOrSlug).catch(() => null);
  if (!agent) return withCors(notFound('No listed agent with that id or slug.'));

  const result = await fetchAndValidateCard(agent.well_known_uri);
  if (!result.ok) {
    return withCors(
      problem({ status: result.status, title: 'Agent card rejected', detail: result.error, validation_errors: result.validation_errors })
    );
  }

  try {
    const updated = await updateAgentCard(agent.id, result.card);
    return corsJson({ agent: updated }, 200);
  } catch (e) {
    console.error('[registry/resync]', e);
    return withCors(serverError('Could not re-sync the agent.'));
  }
}
