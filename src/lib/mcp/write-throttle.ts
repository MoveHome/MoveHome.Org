import { createSupabaseAdminClient } from '@/lib/supabase-admin';

export interface RateCheckResult {
  allowed: boolean;
  reason?: string;
  retryAfterSeconds?: number;
}

/**
 * Rate limit check for MCP create_enquiry writes.
 * Keyed strictly on client_id (ignores X-Forwarded-For, CF-Connecting-IP, True-Client-IP).
 * Enforces:
 *   - 10 writes / minute per client_id
 *   - 3 writes / minute per client_id + listing_id
 * Fails closed (returns allowed: false) on DB error or lookup failure.
 */
export async function checkMcpWriteRate(clientId: string, raiaId: string): Promise<RateCheckResult> {
  if (!clientId) {
    return { allowed: false, reason: 'Missing client_id', retryAfterSeconds: 60 };
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    // Fail-closed on missing DB client
    return { allowed: false, reason: 'Database client unavailable', retryAfterSeconds: 60 };
  }

  const now = new Date();
  // Minute window aligned to the minute
  const windowStart = new Date(Math.floor(now.getTime() / 60000) * 60000).toISOString();

  try {
    // Cast to untyped supabase for tbl_mcp_write_rate until database.types.ts is regenerated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = supabase as any;

    // 1. Check total client_id count across all listings in current window
    const { data: clientRows, error: clientErr } = await client
      .from('tbl_mcp_write_rate')
      .select('count')
      .eq('client_id', clientId)
      .eq('window_start', windowStart);

    if (clientErr) {
      console.error('[write-throttle] DB error checking client rate:', clientErr);
      return { allowed: false, reason: 'Rate limit DB error', retryAfterSeconds: 60 };
    }

    const clientTotal = (clientRows || []).reduce((acc: number, r: { count: number }) => acc + (r.count || 0), 0);
    if (clientTotal >= 10) {
      return { allowed: false, reason: 'Client rate limit exceeded (10/min)', retryAfterSeconds: 60 };
    }

    // 2. Check client_id + listing_id burst cap (3/min)
    const { data: listingRows, error: listingErr } = await client
      .from('tbl_mcp_write_rate')
      .select('count')
      .eq('client_id', clientId)
      .eq('window_start', windowStart)
      .eq('listing_id', raiaId);

    if (listingErr) {
      console.error('[write-throttle] DB error checking listing rate:', listingErr);
      return { allowed: false, reason: 'Rate limit DB error', retryAfterSeconds: 60 };
    }

    const listingTotal = (listingRows || []).reduce((acc: number, r: { count: number }) => acc + (r.count || 0), 0);
    if (listingTotal >= 3) {
      return { allowed: false, reason: 'Per-listing burst limit exceeded (3/min)', retryAfterSeconds: 60 };
    }

    return { allowed: true };
  } catch (e) {
    console.error('[write-throttle] Unexpected error:', e);
    // Fail-closed
    return { allowed: false, reason: 'Rate limit system failure', retryAfterSeconds: 60 };
  }
}

/**
 * Record an accepted MCP write in tbl_mcp_write_rate.
 */
export async function recordMcpWrite(clientId: string, raiaId: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return;

  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / 60000) * 60000).toISOString();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = supabase as any;

    const { data: existing } = await client
      .from('tbl_mcp_write_rate')
      .select('count')
      .eq('client_id', clientId)
      .eq('window_start', windowStart)
      .eq('listing_id', raiaId)
      .maybeSingle();

    if (existing) {
      await client
        .from('tbl_mcp_write_rate')
        .update({ count: (existing.count || 0) + 1 })
        .eq('client_id', clientId)
        .eq('window_start', windowStart)
        .eq('listing_id', raiaId);
    } else {
      await client
        .from('tbl_mcp_write_rate')
        .insert({
          client_id: clientId,
          window_start: windowStart,
          listing_id: raiaId,
          count: 1
        });
    }
  } catch (e) {
    console.error('[write-throttle] Record error:', e);
  }
}
