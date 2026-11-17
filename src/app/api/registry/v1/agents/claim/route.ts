// POST /api/registry/v1/agents/claim — two-phase claim of a registry card.
//   { phase: 'initiate', slug, contact_email, website_url? } → emails a one-time link
//   { phase: 'verify', slug, token, contact_email }          → publishes the card
// Cards are 'staged' until verified (migration 0019); the public view serves
// 'published' only, so a scraped card is never public before its agency claims it.
// Tokens are never logged and never echoed in a response body.

import { NextResponse } from 'next/server';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  CLAIM_MAX_ATTEMPTS,
  claimAttemptsInWindow,
  clearClaimToken,
  getClaimRow,
  issueClaimToken,
  publishClaimedCard,
  type ClaimRow
} from '@/lib/registry/store';
import { sendClaimEmail, emailProviderConfigured } from '@/lib/registry/email';
import { REGISTRY_CORS, ipKey, withCors, corsJson } from '@/lib/registry/http';
import { enforceRateLimit } from '@/lib/portal/rate-limit';
import { badRequest, conflict, notFound, problem, serverError, tooManyRequests } from '@/lib/portal/problem';

export const dynamic = 'force-dynamic';

const CLAIM_PER_MIN = 10;
const DAY_SECONDS = 24 * 60 * 60;
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://movehome.org';

const slug = z.string().trim().min(1).max(63);
const email = z.string().trim().email().max(200);

const bodySchema = z.discriminatedUnion('phase', [
  z
    .object({
      phase: z.literal('initiate'),
      slug,
      contact_email: email,
      website_url: z.string().trim().url().max(500).optional()
    })
    .strict(),
  z.object({ phase: z.literal('verify'), slug, token: z.string().trim().min(8).max(100), contact_email: email }).strict()
]);

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: REGISTRY_CORS });
}

/** Constant-time token compare (length mismatch short-circuits — tokens are fixed-format UUIDs). */
function tokenMatches(stored: string, supplied: string): boolean {
  const a = Buffer.from(stored, 'utf8');
  const b = Buffer.from(supplied, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function unconfiguredEmail(): NextResponse {
  return withCors(
    problem({
      status: 503,
      title: 'Email not configured',
      detail:
        'The registry cannot send claim emails yet (no email provider configured). Nothing was changed. Email admin@movehome.org to claim this card manually.'
    })
  );
}

function rateLimited(row: ClaimRow): NextResponse {
  const sentAt = row.claim_token_sent_at ? Date.parse(row.claim_token_sent_at) : Date.now();
  const retryAfter = Math.max(1, Math.ceil((sentAt + DAY_SECONDS * 1000 - Date.now()) / 1000));
  return withCors(tooManyRequests(retryAfter, CLAIM_MAX_ATTEMPTS, Math.floor((Date.now() + retryAfter * 1000) / 1000)));
}

async function initiate(input: { slug: string; contact_email: string; website_url?: string }): Promise<NextResponse> {
  // Checked before any write: no point burning a token we cannot deliver.
  if (!emailProviderConfigured()) return unconfiguredEmail();

  const row = await getClaimRow(input.slug);
  if (!row) return withCors(notFound('No registry card with that slug.'));
  if (row.claimed_at) return withCors(conflict('This card has already been claimed.'));

  const attempts = claimAttemptsInWindow(row);
  if (attempts >= CLAIM_MAX_ATTEMPTS) return rateLimited(row);

  const token = randomUUID();
  const claimUrl = `${BASE_URL}/registry/claim?slug=${encodeURIComponent(row.slug)}&token=${token}`;
  await issueClaimToken(row.id, token, { websiteUrl: input.website_url ?? null, attempts });

  const sent = await sendClaimEmail(input.contact_email, row.name, claimUrl);
  if (!sent) {
    // Never claim an email went out. Clear the token so the card stays claimable.
    await clearClaimToken(row.id);
    return unconfiguredEmail();
  }

  return corsJson(
    {
      status: 'email_sent',
      slug: row.slug,
      message: `Claim link sent to ${input.contact_email}. It expires in 72 hours.`
    },
    202
  );
}

async function verify(input: { slug: string; token: string; contact_email: string }): Promise<NextResponse> {
  const row = await getClaimRow(input.slug);
  if (!row) return withCors(notFound('No registry card with that slug.'));
  if (row.claimed_at) return withCors(conflict('This card has already been claimed.'));
  if (!row.claim_token || !row.claim_token_expires_at) {
    return withCors(badRequest('No pending claim for this card. Request a claim link first.'));
  }
  if (Date.parse(row.claim_token_expires_at) <= Date.now()) {
    return withCors(badRequest('This claim link has expired. Request a new one.'));
  }
  if (!tokenMatches(row.claim_token, input.token)) {
    return withCors(badRequest('That claim link is not valid for this card.'));
  }

  await publishClaimedCard(row.id, input.contact_email);
  return corsJson({
    status: 'published',
    slug: row.slug,
    agent_url: `${BASE_URL}/registry/${row.slug}`,
    message: 'Your card is live in the MoveHome registry.'
  });
}

export async function POST(req: Request) {
  try {
    const decision = await enforceRateLimit(ipKey(req, 'registry-claim'), 'registry.write', CLAIM_PER_MIN);
    if (!decision.ok) return withCors(tooManyRequests(decision.retryAfter, decision.limit, decision.resetUnix));
  } catch {
    /* limiter unavailable — fail open, as the other registry writes do */
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
        'phase must be "initiate" or "verify"; slug and a valid contact_email are required.',
        parsed.error.issues.map((i) => ({ field: i.path.join('.') || 'body', message: i.message, code: i.code }))
      )
    );
  }

  try {
    return parsed.data.phase === 'initiate' ? await initiate(parsed.data) : await verify(parsed.data);
  } catch (e) {
    console.error('[registry/claim]', e);
    return withCors(serverError('Could not process the claim.'));
  }
}
