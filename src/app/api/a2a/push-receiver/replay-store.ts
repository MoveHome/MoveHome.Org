// Durable (kid, nonce) replay guard for the A2A push receiver.
//
// An in-process Map is not a control on Vercel: a replayer just retries until
// the request lands on an instance with an empty map. The row lives in
// tbl_a2a_push_nonces (PRIMARY KEY (kid, nonce)), so the insert is the race —
// the loser gets 23505 and is rejected.
//
// Fails closed: if the store cannot be reached the receiver rejects the
// delivery (503) rather than accepting an unguarded replay.

import { createSupabaseAdminClient } from '@/lib/supabase-admin';

const TABLE = 'tbl_a2a_push_nonces';
export const REPLAY_TTL_MS = 10 * 60_000; // ADR-472: retain (kid, nonce) for >= 10 min
export const REPLAY_MAX = 10_000; // bounded: a flood cannot grow the table without limit

export type NonceVerdict = 'ok' | 'replayed' | 'unavailable';

export async function consumeNonce(kid: string, nonce: string): Promise<NonceVerdict> {
  let client;
  try {
    client = createSupabaseAdminClient();
  } catch {
    return 'unavailable';
  }
  // Untyped until database.types.ts is regenerated from the live schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = client as any;
  const nowMs = Date.now();

  try {
    // Prune on write so the table cannot grow without bound.
    await db.from(TABLE).delete().lt('expires_at', new Date(nowMs).toISOString());

    const { count } = await db.from(TABLE).select('nonce', { count: 'exact', head: true });
    if (typeof count === 'number' && count >= REPLAY_MAX) {
      const { data } = await db
        .from(TABLE)
        .select('expires_at')
        .order('expires_at', { ascending: true })
        .limit(count - REPLAY_MAX + 1);
      const cutoff = data?.[data.length - 1]?.expires_at;
      if (cutoff) await db.from(TABLE).delete().lte('expires_at', cutoff);
    }

    const { error } = await db
      .from(TABLE)
      .insert({ kid, nonce, expires_at: new Date(nowMs + REPLAY_TTL_MS).toISOString() });
    if (!error) return 'ok';
    return error.code === '23505' ? 'replayed' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
