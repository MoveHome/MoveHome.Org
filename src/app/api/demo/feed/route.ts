// /api/demo/feed — the TV's only read path (GET) and its reconciliation post (POST).
//
// R1 (Fook): the demo project only — its own URL and anon key, never the
// production client and never a privileged key.
// The venue comes from the signed session token ONLY, never from the query
// string, and rows come from the SECURITY DEFINER RPC: anon holds no table
// grant, so there is no table read here to fall back on.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { jwtVerify } from 'jose';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 200;
const NO_STORE = { 'cache-control': 'no-store' };

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

function demoDb() {
  const url = process.env.DEMO_SUPABASE_URL;
  const key = process.env.DEMO_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(request: Request) {
  const venue = await venueFromToken(request);
  if (!venue) return NextResponse.json({ error: 'venue token required' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const since = Number(params.get('since') ?? '0');
  const asked = Number(params.get('limit') ?? MAX_LIMIT);
  if (!Number.isInteger(since) || since < 0) {
    return NextResponse.json({ error: 'invalid since cursor' }, { status: 400 });
  }
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : MAX_LIMIT;

  const db = demoDb();
  if (!db) return NextResponse.json({ error: 'demo project not provisioned' }, { status: 503 });

  const { data, error } = await db.rpc('demo_tv_feed', {
    p_venue_id: venue,
    p_after_seq: since,
    p_limit: limit
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });

  return NextResponse.json({ rows: data ?? [], since, venue_id: venue }, { headers: NO_STORE });
}

// Reconciliation: the TV posts the fingerprint of the rows it is showing and the
// server answers with its own authoritative one. A mismatch means the screen is
// out of date, so the TV refetches and raises the STALE banner. This — not the
// socket state, and not /api/health — is the liveness signal the display trusts.
export async function POST(request: Request) {
  const venue = await venueFromToken(request);
  if (!venue) return NextResponse.json({ error: 'venue token required' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { count?: unknown; last_id?: unknown; hash?: unknown; correlation_id?: unknown }
    | null;
  const count = Number(body?.count);
  const hash = typeof body?.hash === 'string' ? body.hash : '';
  const last_id = typeof body?.last_id === 'string' ? body.last_id : '';
  const correlation_id = typeof body?.correlation_id === 'string' ? body.correlation_id : '';
  if (!Number.isInteger(count) || !hash) {
    return NextResponse.json({ error: 'count, last_id and hash are required' }, { status: 400 });
  }

  const db = demoDb();
  if (!db) return NextResponse.json({ error: 'demo project not provisioned' }, { status: 503 });

  const { data, error } = await db.rpc('demo_feed_fingerprint', { p_venue_id: venue });
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });

  const row = (Array.isArray(data) ? data[0] : data) as { count?: number; last_seq?: number; hash?: string } | null;
  const server = { count: Number(row?.count ?? 0), last_seq: Number(row?.last_seq ?? 0), hash: String(row?.hash ?? '') };
  const ok = server.count === count && server.hash === hash;

  // The server-side reconciliation log carries the same correlation_id the TV
  // footer shows, so one event is traceable end to end.
  console.error(
    `demo tv reconcile ${ok ? 'ok' : 'mismatch'}`,
    JSON.stringify({ venue_id: venue, correlation_id, tv: { count, last_id, hash }, server })
  );

  return NextResponse.json({ ok, stale: !ok, server, correlation_id }, { headers: NO_STORE });
}
