// POST /api/registry/v1/agents/{id|slug}/verify-domain — DNS TXT domain-control check.
// First call issues the agent's token; the operator publishes the returned TXT record
// and calls again. Each call re-checks DNS and stores the result. The token is not a
// secret (the TXT record is public), so returning it is safe; an existing token is
// never replaced, so nobody can invalidate a record the operator already published.
// The health worker re-checks on every run, so verification lapses if the record goes.

import { NextResponse } from 'next/server';
import { checkDomainTxt, verificationRecord } from '@/lib/registry/domain';
import { ensureVerificationToken, recordDomainCheck } from '@/lib/registry/store';
import { REGISTRY_CORS, ipKey, withCors, corsJson } from '@/lib/registry/http';
import { enforceRateLimit } from '@/lib/portal/rate-limit';
import { notFound, tooManyRequests, serverError } from '@/lib/portal/problem';

export const dynamic = 'force-dynamic';

const VERIFY_PER_MIN = 5;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: REGISTRY_CORS });
}

export async function POST(req: Request, { params }: { params: Promise<{ idOrSlug: string }> }) {
  try {
    const decision = await enforceRateLimit(ipKey(req, 'registry-verify-domain'), 'registry.write', VERIFY_PER_MIN);
    if (!decision.ok) return withCors(tooManyRequests(decision.retryAfter, decision.limit, decision.resetUnix));
  } catch {
    /* limiter unavailable — fail open, as the other registry writes do */
  }

  try {
    const { idOrSlug } = await params;
    const target = await ensureVerificationToken(idOrSlug);
    if (!target) return withCors(notFound('No listed agent with that id or slug.'));

    const record = verificationRecord(target.well_known_uri, target.verification_token);
    const domainVerified = await checkDomainTxt(target.well_known_uri, target.verification_token);
    await recordDomainCheck(target.id, domainVerified);

    return corsJson({
      slug: target.slug,
      domain_verified: domainVerified,
      method: 'dns',
      record,
      message: domainVerified
        ? 'Domain verified. It is re-checked on every registry health check.'
        : `Publish a DNS TXT record named ${record.name} with value "${record.value}", then call this endpoint again. DNS changes can take a few minutes to propagate.`
    });
  } catch (e) {
    console.error('[registry/verify-domain]', e);
    return withCors(serverError('Could not run domain verification.'));
  }
}
