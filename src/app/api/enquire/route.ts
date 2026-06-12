// POST /api/enquire — accept enquiry from MoveHome UI, persist to
// tbl_enquiries, forward to source agent's enquiry_endpoint.
//
// Wire payload mirrors RAIA Protocol v0.2 enquiry.json — see
// estateaigents.org/schemas/enquiry.json.

import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createEnquiry, type ViewingRequest } from '@/lib/enquiry';
import { enforceRateLimit, rateLimitHeaders } from '@/lib/portal/rate-limit';

interface IncomingPayload {
  raia_id?: unknown;
  enquirer?: {
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    preferred_contact?: unknown;
  };
  message?: unknown;
  viewing_request?: {
    preferred_dates?: unknown;
    party_size?: unknown;
  };
  // Honeypot — a hidden form field real users never fill. Bots that auto-fill
  // every input trip it; see the silent-accept below.
  company?: unknown;
}

// Public form is unauthenticated, so we throttle per client IP. Generous enough
// for a human (one enquiry per page visit) but cuts off scripted floods.
const ENQUIRY_PER_MIN = 5;

function clientIpKey(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = fwd || request.headers.get('x-real-ip') || 'unknown';
  return `enquire:${createHash('sha256').update(ip).digest('hex').slice(0, 32)}`;
}

const RAIA_ID_RE = /^prop-[a-z]{2}-[a-z0-9-]{2,32}-[0-9]{4,}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PREFERRED_CONTACTS = new Set(['email', 'phone', 'whatsapp']);
// ISO 8601 date or datetime, e.g. 2026-06-15 or 2026-06-15T14:30:00Z.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

export async function POST(request: Request) {
  // ── Per-IP rate limit ─────────────────────────────────────────────────
  // Fail open if the limiter store is unavailable (e.g. local dev without the
  // portal tables) so the form keeps working.
  let rlHeaders: Record<string, string> = {};
  try {
    const decision = await enforceRateLimit(clientIpKey(request), 'enquiry.write', ENQUIRY_PER_MIN);
    rlHeaders = rateLimitHeaders(decision);
    if (!decision.ok) {
      return NextResponse.json(
        { error: 'Too many enquiries. Please wait a moment and try again.' },
        { status: 429, headers: { ...rlHeaders, 'Retry-After': String(decision.retryAfter) } }
      );
    }
  } catch {
    /* limiter unavailable — fail open */
  }

  let body: IncomingPayload;
  try {
    body = (await request.json()) as IncomingPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: rlHeaders });
  }

  // ── Honeypot ──────────────────────────────────────────────────────────
  // A filled hidden field means a bot. Return a plausible success so it doesn't
  // probe further, but record and forward nothing.
  if (typeof body.company === 'string' && body.company.trim() !== '') {
    return NextResponse.json(
      { enquiry_id: randomUUID(), status: 'received' },
      { status: 201, headers: rlHeaders }
    );
  }

  // ── Validate ────────────────────────────────────────────────────────────
  const raia_id = typeof body.raia_id === 'string' ? body.raia_id : '';
  if (!RAIA_ID_RE.test(raia_id)) {
    return NextResponse.json({ error: 'Invalid raia_id' }, { status: 400 });
  }

  const name = typeof body.enquirer?.name === 'string' ? body.enquirer.name.trim() : '';
  const email = typeof body.enquirer?.email === 'string' ? body.enquirer.email.trim() : '';
  if (!name || name.length > 200) {
    return NextResponse.json({ error: 'enquirer.name required (1-200 chars)' }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'enquirer.email invalid' }, { status: 400 });
  }

  const phone = typeof body.enquirer?.phone === 'string' ? body.enquirer.phone.trim() : null;
  if (phone && phone.length > 40) {
    return NextResponse.json({ error: 'enquirer.phone too long (max 40 chars)' }, { status: 400 });
  }
  const preferred_contact_raw =
    typeof body.enquirer?.preferred_contact === 'string' ? body.enquirer.preferred_contact : null;
  const preferred_contact =
    preferred_contact_raw && PREFERRED_CONTACTS.has(preferred_contact_raw)
      ? preferred_contact_raw
      : null;

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length < 1 || message.length > 2000) {
    return NextResponse.json({ error: 'message required (1-2000 chars)' }, { status: 400 });
  }

  const viewing_request: ViewingRequest | null =
    body.viewing_request &&
    Array.isArray(body.viewing_request.preferred_dates) &&
    body.viewing_request.preferred_dates.length > 0
      ? {
          preferred_dates: (body.viewing_request.preferred_dates as unknown[])
            .filter((d): d is string => typeof d === 'string' && d.length <= 40 && ISO_DATE_RE.test(d))
            .slice(0, 3),
          ...(typeof body.viewing_request.party_size === 'number'
            ? { party_size: body.viewing_request.party_size }
            : {})
        }
      : null;

  // ── Optional auth — link enquiry to user if signed in ──────────────────
  const sb = await createSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();

  const result = await createEnquiry({
    raia_id,
    name,
    email,
    phone,
    preferred_contact,
    message,
    viewing_request,
    userId: user?.id ?? null,
    ipCountry: request.headers.get('x-vercel-ip-country')
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.httpStatus, headers: rlHeaders });
  }

  return NextResponse.json(
    { enquiry_id: result.enquiry_id, status: result.status },
    { status: 201, headers: rlHeaders }
  );
}
