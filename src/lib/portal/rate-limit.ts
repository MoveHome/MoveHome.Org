// Postgres-backed sliding-window rate limiter for the RAIA Portal Feed API.
//
// Sliding window strategy: bucket requests into 60-second epochs keyed by
// (client_id, endpoint_group, window_start). On every call, look at the count
// for the current minute. If under quota, increment and allow. Otherwise emit
// a 429 with Retry-After until the next epoch.
//
// We deliberately avoid a true token bucket here because the spec only asks
// for "60 requests per minute per credential per endpoint group" — a fixed
// minute window matches the X-RateLimit-Reset semantics most cleanly. A small
// background job can prune rows older than ~5 minutes; we also opportunistic-
// ally clean inside this function to avoid unbounded growth.

import { portalTable } from './db';

export interface RateLimitDecision {
  ok: boolean;
  limit: number;
  remaining: number;
  resetUnix: number;
  retryAfter: number;
}

export type EndpointGroup =
  | 'token'
  | 'listings.write'
  | 'listings.read'
  | 'branches.read'
  | 'products.read'
  | 'products.write'
  | 'health'
  | 'a2a'
  | 'enquiry.write';

const GROUP_OVERRIDES: Partial<Record<EndpointGroup, number>> = {
  // Token endpoint stays modest per spec recommendation (10/min/client).
  token: 10
};

function currentWindowStart(): Date {
  const now = new Date();
  now.setUTCSeconds(0, 0);
  return now;
}

export async function enforceRateLimit(
  clientId: string,
  group: EndpointGroup,
  perMinuteOverride?: number
): Promise<RateLimitDecision> {
  const limit = GROUP_OVERRIDES[group] ?? perMinuteOverride ?? 60;
  const window = currentWindowStart();
  const resetUnix = Math.floor(window.getTime() / 1000) + 60;

  // Atomic increment via upsert + RPC-less pattern: insert-on-conflict + update.
  // We use two queries because @supabase/supabase-js doesn't expose
  // ON CONFLICT DO UPDATE arithmetic; the race is acceptable for a per-minute
  // limiter (overshoot < 1 request per concurrent caller).
  const t = portalTable('tbl_portal_rate_limits');
  const { data: existing } = (await t
    .select('request_count')
    .eq('client_id', clientId)
    .eq('endpoint_group', group)
    .eq('window_start', window.toISOString())
    .maybeSingle()) as { data: { request_count: number } | null };

  const current = existing?.request_count ?? 0;
  if (current >= limit) {
    const retryAfter = Math.max(1, resetUnix - Math.floor(Date.now() / 1000));
    return { ok: false, limit, remaining: 0, resetUnix, retryAfter };
  }

  if (existing) {
    await portalTable('tbl_portal_rate_limits')
      .update({ request_count: current + 1 })
      .eq('client_id', clientId)
      .eq('endpoint_group', group)
      .eq('window_start', window.toISOString());
  } else {
    await portalTable('tbl_portal_rate_limits').insert({
      client_id: clientId,
      endpoint_group: group,
      window_start: window.toISOString(),
      request_count: 1
    });
    // Opportunistic prune of old buckets (keep ~5 windows for forensics).
    const cutoff = new Date(window.getTime() - 5 * 60_000).toISOString();
    await portalTable('tbl_portal_rate_limits').delete().lt('window_start', cutoff);
  }

  return {
    ok: true,
    limit,
    remaining: Math.max(0, limit - (current + 1)),
    resetUnix,
    retryAfter: 0
  };
}

export function rateLimitHeaders(d: RateLimitDecision): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(d.limit),
    'X-RateLimit-Remaining': String(d.remaining),
    'X-RateLimit-Reset': String(d.resetUnix)
  };
}
