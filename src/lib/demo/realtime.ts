// Realtime wake-up ping for the TV lane: one venue-scoped topic, one event.
// The broadcast is only a nudge — the TV's authoritative rows come from its own
// venue-scoped feed RPC — so a failed ping is logged and never fails the write.

import { createClient } from '@supabase/supabase-js';

export interface ListingBroadcast {
  id: string;
  venue_id: string;
  headline?: string | null;
  bedrooms?: number | null;
  rent_pcm?: number | null;
  currency?: string | null;
  un_locode?: string | null;
  created_at?: string | null;
  correlation_id: string;
}

// DEMO anon key only: service_role must never appear on this path.
export async function broadcastListingReceived(listing: ListingBroadcast): Promise<boolean> {
  const url = process.env.DEMO_SUPABASE_URL;
  const key = process.env.DEMO_SUPABASE_ANON_KEY;
  if (!url || !key) return false;

  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: key,
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `venue:${listing.venue_id}`,
            event: 'listing.received',
            payload: { ...listing, source: 'telegram' }
          }
        ]
      })
    });
    return res.ok;
  } catch (error) {
    console.error('demo broadcast failed', { correlation_id: listing.correlation_id, error });
    return false;
  }
}

// Receive-only join for the TV screen. The join result is deliberately not
// exposed: a JOINED/SUBSCRIBED reply proves nothing about the data, so the
// caller treats every broadcast as a wake-up ping and lets reconciliation
// decide whether what is on screen is current. Without NEXT_PUBLIC_DEMO_*
// the screen runs reconciliation-only, which is the safe direction.
export function tvChannel(
  venueId: string,
  onListingReceived: (listing: ListingBroadcast) => void
): { close: () => void } {
  const url = process.env.NEXT_PUBLIC_DEMO_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_DEMO_SUPABASE_ANON_KEY;
  if (!url || !key) return { close: () => {} };

  const channel = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).channel(
    `venue:${venueId}`,
    { config: { broadcast: { self: false } } }
  );
  channel.on('broadcast', { event: 'listing.received' }, ({ payload }) =>
    onListingReceived(payload as ListingBroadcast)
  );
  channel.subscribe();

  return {
    close: () => {
      void channel.unsubscribe();
    }
  };
}
