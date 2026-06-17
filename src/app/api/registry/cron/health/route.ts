// Internal health-check trigger, invoked by Supabase pg_cron + pg_net every ~30 min.
// Protected by REGISTRY_CRON_SECRET (Bearer header preferred; ?secret= accepted).
// Not part of the public API — no CORS, returns plain JSON.

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { runHealthChecks } from '@/lib/registry/health';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function tokenOf(req: Request): string {
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '');
  return bearer || new URL(req.url).searchParams.get('secret') || '';
}

function authorized(req: Request): boolean {
  const secret = process.env.REGISTRY_CRON_SECRET;
  if (!secret) return false; // unconfigured → deny (fail closed)
  const provided = tokenOf(req);
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await runHealthChecks();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[registry/cron/health]', e);
    return NextResponse.json({ error: 'health run failed' }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
