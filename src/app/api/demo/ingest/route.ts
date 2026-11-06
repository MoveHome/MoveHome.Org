// POST /api/demo/ingest — expo demo listing ingest.
//
// R2 (Fook): publishing a demo listing is an APPLICATION flow. It is never an
// MCP or A2A tool, so no agent can write a listing through the protocol.
// R1 (Fook): this route talks to the SEPARATE demo project only — its own URL
// and anon key. It never uses the production client and never a privileged key.
//
// Two callers, one write path:
//   * a venue session token (claims.venue_id) — the original demo flow;
//   * a Telegram token (scope 'demo_telegram') minted by
//     /api/telegram/webhook, which adds server-verified identity + update_id.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { jwtVerify } from 'jose';
import { z } from 'zod';
import { broadcastListingReceived } from '@/lib/demo/realtime';

export const dynamic = 'force-dynamic';

// Kill switch: false degrades the demo to read-only (map + search keep running).
function demoWritesEnabled(): boolean {
  return process.env.DEMO_WRITE_ENABLED === 'true';
}

// .strict() on both objects: any extra key — in particular a caller-supplied
// demo flag — is rejected outright rather than silently ignored.
const Listing = z
  .object({
    raia_id: z.string().min(1).max(64),
    headline: z.string().min(1).max(200),
    property_type: z.enum(['flat', 'house', 'studio', 'commercial', 'land', 'other']),
    service_type: z.enum(['long_term', 'short_term', 'sale']),
    bedrooms: z.number().int().min(0).max(50).optional(),
    rent_pcm: z.number().min(0).max(1_000_000).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    un_locode: z.string().regex(/^[A-Za-z]{2}[A-Za-z0-9]{3}$/).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional()
  })
  .strict();

const Body = z
  .object({
    venue_id: z.string().min(1).max(64),
    listing: Listing
  })
  .strict();

// The Telegram identity is server-verified: these come from the signed token,
// never from the request body.
const TelegramClaims = z.object({
  telegram_user_id: z.number().int().positive(),
  update_id: z.number().int().nonnegative(),
  chat_id: z.number().int(),
  correlation_id: z.string().min(1).max(64)
});

interface SessionClaims {
  venue_id: string;
  scope?: string;
  [key: string]: unknown;
}

// Venue-scoped signed session token (HS256, DEMO_SESSION_SECRET). Returns the
// claims, or null when the token is missing, expired or not ours.
async function claimsFromToken(request: Request): Promise<SessionClaims | null> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const secret = process.env.DEMO_SESSION_SECRET;
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
    return typeof payload.venue_id === 'string' && payload.venue_id.length > 0
      ? (payload as unknown as SessionClaims)
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!demoWritesEnabled()) {
    return NextResponse.json({ error: 'demo writes are disabled' }, { status: 403 });
  }

  const claims = await claimsFromToken(request);
  if (!claims) {
    return NextResponse.json({ error: 'venue token required' }, { status: 401 });
  }
  const venue = claims.venue_id;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  if (parsed.data.venue_id !== venue) {
    return NextResponse.json({ error: 'venue does not match the session token' }, { status: 403 });
  }

  const url = process.env.DEMO_SUPABASE_URL;
  const key = process.env.DEMO_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: 'demo project not provisioned' }, { status: 503 });
  }

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // ── Telegram branch ──────────────────────────────────────────────────────
  // Writes fail CLOSED: any refusal from the RPC denies the write outright.
  if (claims.scope === 'demo_telegram') {
    const identity = TelegramClaims.safeParse(claims);
    if (!identity.success) {
      return NextResponse.json({ error: 'incomplete telegram token' }, { status: 400 });
    }
    const { telegram_user_id, update_id, chat_id, correlation_id } = identity.data;

    const { data, error } = await db.rpc('demo_telegram_ingest', {
      p_chat_id: chat_id,
      p_telegram_user_id: telegram_user_id,
      p_telegram_update_id: update_id,
      p_correlation_id: correlation_id,
      p_listing: parsed.data.listing
    });
    if (error) {
      const status = error.code === '42501' ? 403 : error.code === 'PT429' ? 429 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    const row = data as {
      id: string;
      duplicate: boolean;
      headline?: string | null;
      bedrooms?: number | null;
      rent_pcm?: number | null;
      currency?: string | null;
      un_locode?: string | null;
      created_at?: string | null;
    };

    // A replayed update_id returns the existing row: exactly one row, and no
    // second broadcast.
    if (row.duplicate) {
      return NextResponse.json({ id: row.id, duplicate: true }, { status: 200 });
    }

    await broadcastListingReceived({ ...row, venue_id: venue, correlation_id });

    return NextResponse.json({ id: row.id, duplicate: false }, { status: 201 });
  }

  // ── venue session branch (unchanged) ─────────────────────────────────────
  const { data, error } = await db.rpc('demo_ingest_listing', {
    p_venue_id: venue,
    p_listing: parsed.data.listing
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ id: data }, { status: 201 });
}
