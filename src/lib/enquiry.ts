// Shared enquiry pipeline: resolve listing → persist to tbl_enquiries → forward
// to the source agent's enquiry_endpoint (SSRF-guarded). Used by both the REST
// route (POST /api/enquire) and the A2A create_enquiry skill so the wire format
// and forwarding behaviour stay identical across both entry points.
//
// Wire payload mirrors RAIA Protocol v0.2 enquiry.json.

import { randomUUID } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import type { Json } from '@/lib/database.types';

export interface ViewingRequest {
  preferred_dates: string[];
  party_size?: number;
}

export interface CreateEnquiryInput {
  raia_id: string;
  name: string;
  email: string;
  phone?: string | null;
  preferred_contact?: string | null;
  message: string;
  viewing_request?: ViewingRequest | null;
  userId?: string | null;
  ipCountry?: string | null;
}

export type CreateEnquiryResult =
  | { ok: true; enquiry_id: string; status: 'received' }
  | { ok: false; httpStatus: number; error: string };

// ── Anti-spam thresholds ───────────────────────────────────────────────────
// Applied inside createEnquiry, so they protect BOTH the public form
// (POST /api/enquire) and the A2A create_enquiry skill identically — neither
// entry point can bypass them. Every check fails open: a counting error must
// never turn away a legitimate enquirer.
const DUP_WINDOW_MINUTES = 10; // same email + same listing within this window = duplicate
const EMAIL_HOURLY_LIMIT = 20; // max enquiries per email address per rolling hour (across all listings)

// SSRF guard for the agent-supplied enquiry_endpoint: only forward to public
// HTTPS hosts. Blocks loopback / private / link-local IPs + cloud metadata so a
// malicious listing can't make the server reach internal services.
export function isForwardableEndpoint(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return false;
  }
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (
      a === 0 ||
      a === 127 ||
      a === 10 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254) // link-local + cloud metadata (169.254.169.254)
    ) {
      return false;
    }
  }
  if (host.includes(':')) {
    // IPv6 literal — block loopback (::1), link-local (fe80::/10), ULA (fc00::/7)
    if (
      host === '::1' ||
      host.startsWith('fe8') ||
      host.startsWith('fe9') ||
      host.startsWith('fea') ||
      host.startsWith('feb') ||
      host.startsWith('fc') ||
      host.startsWith('fd')
    ) {
      return false;
    }
  }
  return true;
}

export async function createEnquiry(input: CreateEnquiryInput): Promise<CreateEnquiryResult> {
  const admin = createSupabaseAdminClient();

  // ── Resolve listing → agent_id + enquiry_endpoint ──────────────────────
  const { data: listing, error: listingError } = await admin
    .from('tbl_external_raia_listings')
    .select('agent_id, enquiry_endpoint, raia_id, withdrawn_at, visibility')
    .eq('raia_id', input.raia_id)
    .maybeSingle();

  if (listingError) {
    console.error('[enquiry] listing lookup', listingError.message);
    return { ok: false, httpStatus: 500, error: 'Listing lookup failed' };
  }
  if (!listing || listing.withdrawn_at || listing.visibility !== 'public') {
    return { ok: false, httpStatus: 404, error: 'Listing not found' };
  }

  // Normalise the email once so storage and the abuse counters below agree
  // (case/whitespace variants would otherwise dodge the per-sender limits).
  const email = input.email.trim().toLowerCase();

  // ── Anti-spam guards (best-effort; fail open) ──────────────────────────
  try {
    const now = Date.now();

    // 1. Duplicate: same enquirer + same listing inside the dedup window.
    //    Stops accidental double-submits and cheap repeat spam to one agent.
    const dupSince = new Date(now - DUP_WINDOW_MINUTES * 60_000).toISOString();
    const { count: dupCount } = await admin
      .from('tbl_enquiries')
      .select('enquiry_id', { count: 'exact', head: true })
      .eq('raia_id', input.raia_id)
      .eq('enquirer_email', email)
      .gte('submitted_at', dupSince);
    if ((dupCount ?? 0) > 0) {
      return {
        ok: false,
        httpStatus: 429,
        error: 'You already enquired about this listing in the last few minutes. Please wait before sending another.'
      };
    }

    // 2. Volume: one email address across all listings per rolling hour.
    //    Bounds a single actor spraying many listings; set well above normal
    //    human browsing so genuine movers are never caught.
    const hourSince = new Date(now - 60 * 60_000).toISOString();
    const { count: emailCount } = await admin
      .from('tbl_enquiries')
      .select('enquiry_id', { count: 'exact', head: true })
      .eq('enquirer_email', email)
      .gte('submitted_at', hourSince);
    if ((emailCount ?? 0) >= EMAIL_HOURLY_LIMIT) {
      return {
        ok: false,
        httpStatus: 429,
        error: 'Too many enquiries from this email address in the last hour. Please try again later.'
      };
    }
  } catch (e) {
    // A failed counter must not block a legitimate enquiry — log and continue.
    console.error('[enquiry] abuse check failed (allowing)', e instanceof Error ? e.message : e);
  }

  // ── Compose enquiry.json v0.2 payload ──────────────────────────────────
  const enquiry_id = randomUUID();
  const submitted_at = new Date().toISOString();
  const phone = input.phone || null;
  const preferred_contact = input.preferred_contact || null;
  const viewing_request = input.viewing_request ?? null;

  const source = {
    origin: 'movehome.org',
    ...(input.ipCountry ? { ip_country: input.ipCountry } : {})
  };

  const wirePayload = {
    enquiry_id,
    raia_id: input.raia_id,
    enquirer: {
      name: input.name,
      email,
      ...(phone ? { phone } : {}),
      ...(preferred_contact ? { preferred_contact } : {})
    },
    message: input.message,
    ...(viewing_request ? { viewing_request } : {}),
    source,
    submitted_at
  };

  // ── Insert into tbl_enquiries ──────────────────────────────────────────
  const { error: insertError } = await admin.from('tbl_enquiries').insert({
    enquiry_id,
    raia_id: input.raia_id,
    agent_id: listing.agent_id,
    user_id: input.userId ?? null,
    enquirer_name: input.name,
    enquirer_email: email,
    enquirer_phone: phone,
    preferred_contact,
    message: input.message,
    viewing_request: viewing_request as unknown as Json,
    source: source as unknown as Json,
    status: 'new',
    submitted_at
  });

  if (insertError) {
    console.error('[enquiry] insert', insertError.message);
    return { ok: false, httpStatus: 500, error: 'Could not record enquiry' };
  }

  // ── Forward to agent endpoint (best-effort) ────────────────────────────
  // The enquiry is already persisted, so nothing below may turn a successful
  // submission into an error — that would prompt the caller to retry and create
  // a duplicate enquiry/forward. Any throw here (including from the bookkeeping
  // updates) is logged and swallowed.
  try {
    if (listing.enquiry_endpoint && !isForwardableEndpoint(listing.enquiry_endpoint)) {
      // SSRF guard: non-HTTPS or private/internal host — record, never fetch.
      await admin
        .from('tbl_enquiries')
        .update({ forwarded_response: { error: 'endpoint_blocked_unsafe_url' } })
        .eq('enquiry_id', enquiry_id);
    } else if (listing.enquiry_endpoint) {
      const agentResponse = await fetch(listing.enquiry_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'movehome.org/0.1' },
        body: JSON.stringify(wirePayload),
        signal: AbortSignal.timeout(10_000)
      });

      const responseBody = await agentResponse.text().catch(() => '');
      const forwardedResult = {
        status: agentResponse.status,
        ok: agentResponse.ok,
        body: responseBody.slice(0, 4000)
      };

      await admin
        .from('tbl_enquiries')
        .update({
          status: agentResponse.ok ? 'forwarded' : 'new',
          forwarded_at: agentResponse.ok ? new Date().toISOString() : null,
          forwarded_response: forwardedResult
        })
        .eq('enquiry_id', enquiry_id);
    }
  } catch (e) {
    console.error('[enquiry] forwarding failed', e instanceof Error ? e.message : e);
  }

  return { ok: true, enquiry_id, status: 'received' };
}
