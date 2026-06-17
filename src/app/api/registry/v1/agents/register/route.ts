// POST /api/registry/v1/agents/register  { "wellKnownURI": "https://…/.well-known/agent-card.json" }
// Fetches + validates the card, confirms it's a real-estate agent, and auto-lists it.
// Per-IP rate limited; idempotent-rejects duplicates with 409.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fetchAndValidateCard } from '@/lib/registry/ingest';
import { createAgent, existsByWellKnownUri } from '@/lib/registry/store';
import { REGISTRY_CORS, ipKey, ipHash, withCors, corsJson } from '@/lib/registry/http';
import { enforceRateLimit } from '@/lib/portal/rate-limit';
import { badRequest, conflict, tooManyRequests, serverError, problem } from '@/lib/portal/problem';

export const dynamic = 'force-dynamic';

const REGISTER_PER_MIN = 10;
const bodySchema = z.object({ wellKnownURI: z.string().url().max(500) }).strict();

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: REGISTRY_CORS });
}

export async function POST(req: Request) {
  try {
    const decision = await enforceRateLimit(ipKey(req, 'registry-register'), 'registry.write', REGISTER_PER_MIN);
    if (!decision.ok) return withCors(tooManyRequests(decision.retryAfter, decision.limit, decision.resetUnix));
  } catch {
    /* limiter unavailable — fail open */
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return withCors(badRequest('Request body must be JSON.'));
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return withCors(
      badRequest(
        'wellKnownURI is required and must be a URL.',
        parsed.error.issues.map((i) => ({ field: i.path.join('.') || 'wellKnownURI', message: i.message, code: i.code }))
      )
    );
  }

  const existing = await existsByWellKnownUri(parsed.data.wellKnownURI).catch(() => null);
  if (existing) {
    return withCors(
      conflict(`Agent already registered (slug=${existing.slug}). Use PUT /api/registry/v1/agents/${existing.id} to re-sync.`)
    );
  }

  const result = await fetchAndValidateCard(parsed.data.wellKnownURI);
  if (!result.ok) {
    return withCors(
      problem({ status: result.status, title: 'Agent card rejected', detail: result.error, validation_errors: result.validation_errors })
    );
  }

  try {
    const agent = await createAgent(result.card, { submittedByHash: ipHash(req) });
    return corsJson({ agent }, 201);
  } catch (e) {
    console.error('[registry/register]', e);
    return withCors(serverError('Could not register the agent.'));
  }
}
