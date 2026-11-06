// POST /api/demo/retract — remove a demo listing with its 4-digit code.
//
// Same envelope as ingest: demo project only (R1), app flow only (R2), gated on
// the kill switch and on a venue-scoped signed session token. Seeded rows are
// read-only — the RPC refuses them, so this route reports 404.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { jwtVerify } from 'jose';
import { z } from 'zod';
import { retractListing, type RetractClient } from '@/lib/demo/retract';

export const dynamic = 'force-dynamic';

function demoWritesEnabled(): boolean {
  return process.env.DEMO_WRITE_ENABLED === 'true';
}

const Body = z
  .object({
    venue_id: z.string().min(1).max(64),
    id: z.string().uuid(),
    retract_code: z.string().regex(/^[0-9]{4}$/)
  })
  .strict();

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
  // Budget: 60 s end to end (RETRACT_BUDGET_MS) — the row and its media go in
  // one demo beat, so the audience watches the deletion happen.
  const outcome = await retractListing(db as unknown as RetractClient, {
    venue_id: venue,
    id: parsed.data.id,
    retract_code: parsed.data.retract_code
  });
  if (!outcome.retracted) {
    const status = outcome.reason === 'over_budget' ? 504 : outcome.reason === 'refused' ? 404 : 400;
    return NextResponse.json({ error: outcome.message }, { status });
  }

  return NextResponse.json(
    { retracted: parsed.data.id, elapsed_ms: outcome.elapsed_ms, media_removed: outcome.media_removed },
    { status: 200 }
  );
}
