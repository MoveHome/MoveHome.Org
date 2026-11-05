// POST /api/demo/ingest — expo demo listing ingest.
//
// R2 (Fook): publishing a demo listing is an APPLICATION flow. It is never an
// MCP or A2A tool, so no agent can write a listing through the protocol.
// R1 (Fook): this route talks to the SEPARATE demo project only — its own URL
// and anon key. It never uses the production client and never a privileged key.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { jwtVerify } from 'jose';
import { z } from 'zod';

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

// Venue-scoped signed session token (HS256, DEMO_SESSION_SECRET). Returns the
// venue id, or null when the token is missing, expired or not ours.
async function venueFromToken(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const secret = process.env.DEMO_SESSION_SECRET;
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
    return typeof payload.venue_id === 'string' && payload.venue_id.length > 0 ? payload.venue_id : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!demoWritesEnabled()) {
    return NextResponse.json({ error: 'demo writes are disabled' }, { status: 403 });
  }

  const venue = await venueFromToken(request);
  if (!venue) {
    return NextResponse.json({ error: 'venue token required' }, { status: 401 });
  }

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
  const { data, error } = await db.rpc('demo_ingest_listing', {
    p_venue_id: venue,
    p_listing: parsed.data.listing
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ id: data }, { status: 201 });
}
