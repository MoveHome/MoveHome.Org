// POST /api/telegram/webhook — @MoveHomeDemoBot.
//
// D1: thin Next route, raw Bot API over fetch — no bot SDK, no side service.
// D2: Telegram's secret header is required on every request; anything else is
//     401 and writes nothing.
// D6: identity (telegram_user_id, update_id) comes only from the verified token
//     claims minted here — never from a request body, never from a proxy header.
// D9: writes fail CLOSED, reads fail OPEN. Two call sites, deliberately unlike.

import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';
import { resolveSkill } from '@/lib/a2a/skills';
import { extractListingIntent } from '@/lib/demo/intent';

export const dynamic = 'force-dynamic';

const BOT = 'MoveHomeDemoBot';
const SESSION_RE = /^v1\.([A-Za-z0-9_-]{1,24})\.([0-9a-z]{1,12})\.([A-Za-z0-9_-]{16})$/;
const DEMO_SITE = 'https://demo.movehome.org';

function demoDb() {
  const url = process.env.DEMO_SUPABASE_URL;
  const key = process.env.DEMO_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function sameTag(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// v1.<venue_id>.<exp_base36>.<hmac16> — Telegram caps start payloads at 64
// chars, so the QR carries this tag instead of a JWT.
function venueFromSessionCode(code: string): { venue_id: string; session_exp: string } | null {
  const m = SESSION_RE.exec(code);
  const secret = process.env.DEMO_SESSION_SECRET;
  if (!m || !secret) return null;
  const [, venue_id, expBase36, tag] = m;
  const expected = createHmac('sha256', secret).update(`v1.${venue_id}.${expBase36}`).digest('base64url').slice(0, 16);
  if (!sameTag(tag, expected)) return null;
  const exp = parseInt(expBase36, 36);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) return null;
  return { venue_id, session_exp: new Date(exp * 1000).toISOString() };
}

interface VenueSession {
  venue_id: string;
  telegram_user_id: number;
}

// The demo_telegram_sessions table has RLS on and no API grant at all, so both
// directions go through its definer functions. The venue for a message is ONLY
// that row — never the message content.
async function sessionFor(chatId: number): Promise<VenueSession | null> {
  const db = demoDb();
  if (!db) return null;
  const { data, error } = await db.rpc('demo_telegram_session_for', { p_chat_id: chatId });
  if (error || !data) return null;
  const row = data as { venue_id?: string; telegram_user_id?: number | string };
  if (!row.venue_id) return null;
  return { venue_id: row.venue_id, telegram_user_id: Number(row.telegram_user_id) };
}

async function bindSession(chatId: number, telegramUserId: number, session: { venue_id: string; session_exp: string }) {
  const db = demoDb();
  if (!db) return false;
  const { error } = await db.rpc('demo_telegram_bind_session', {
    p_chat_id: chatId,
    p_telegram_user_id: telegramUserId,
    p_venue_id: session.venue_id,
    p_session_exp: session.session_exp
  });
  return !error;
}

// Telegram sends every size of the same photo; the last entry is the largest.
function photoFileId(photo: unknown): string | undefined {
  const sizes = Array.isArray(photo) ? photo : [];
  const last = sizes[sizes.length - 1] as { file_id?: unknown } | undefined;
  return typeof last?.file_id === 'string' ? last.file_id : undefined;
}

async function reply(chatId: number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch {
    // A failed reply must not fail the update: Telegram would retry the write.
  }
}

// Reads fail OPEN: a broken read ledger still answers the search.
async function readAllowed(chatId: number): Promise<boolean> {
  const db = demoDb();
  if (!db) return true;
  try {
    const { data, error } = await db.rpc('demo_telegram_read_allowed', { p_chat_id: chatId });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

// Writes fail CLOSED: nothing is written and nothing is claimed on any error.
async function postListing(
  origin: string,
  token: string,
  venueId: string,
  listing: Record<string, unknown>
): Promise<Response | null> {
  try {
    return await fetch(`${origin}/api/demo/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ venue_id: venueId, listing })
    });
  } catch (error) {
    console.error('telegram ingest unreachable', { error });
    return null;
  }
}

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as
    | { update_id?: number; message?: { chat?: { id?: number }; from?: { id?: number }; text?: string; caption?: string; photo?: unknown[] } }
    | null;
  const message = update?.message;
  if (!message?.chat?.id || typeof update?.update_id !== 'number') {
    return NextResponse.json({ ok: true });
  }

  const chatId = Number(message.chat.id);
  const telegramUserId = Number(message.from?.id ?? chatId);
  const updateId = update.update_id;
  const text = (message.text ?? message.caption ?? '').trim();
  const correlationId = randomUUID();
  console.log('telegram update', { update_id: updateId, correlation_id: correlationId });

  if (text.startsWith('/start')) {
    const code = text.slice('/start'.length).trim();
    const session = code ? venueFromSessionCode(code) : null;
    if (!session) {
      await reply(chatId, `Scan the booth QR to start: https://t.me/${BOT}?start=<code>`);
      return NextResponse.json({ ok: true });
    }
    const ok = await bindSession(chatId, telegramUserId, session);
    await reply(
      chatId,
      ok
        ? `Welcome to ${session.venue_id}! Send a photo with a caption (price, bedrooms, property type) to publish a demo listing, or type what you are looking for.`
        : 'Could not start the session — please scan the booth QR again.'
    );
    return NextResponse.json({ ok: true });
  }

  const session = await sessionFor(chatId);
  if (!session) {
    await reply(chatId, 'Your venue session expired or never started — scan the booth QR to start again.');
    return NextResponse.json({ ok: true });
  }

  const photo = photoFileId(message.photo);
  const intent = await extractListingIntent({ text, photo });
  // Photo-led (D2): a caption alone is a search, even when it quotes a price.
  const looksLikeListing = Boolean(photo);

  if (!looksLikeListing) {
    if (!(await readAllowed(chatId))) {
      await reply(chatId, 'One moment — try that search again in a minute.');
      return NextResponse.json({ ok: true });
    }
    try {
      // D15: the existing handler, never a reimplementation of search.
      const handler = resolveSkill('search_properties');
      if (!handler) throw new Error('search_properties skill unavailable');
      const result = await handler({
        limit: 3,
        ...(intent.bedrooms !== undefined ? { bedrooms_min: intent.bedrooms } : {}),
        ...(intent.rent_pcm !== undefined ? { rent_pcm_max: intent.rent_pcm } : {})
      });
      await reply(chatId, result.summary);
    } catch (error) {
      console.error('telegram search failed', { correlation_id: correlationId, error });
      await reply(chatId, 'Search is unavailable right now — try again shortly.');
    }
    return NextResponse.json({ ok: true });
  }

  if (intent.missing.length > 0) {
    await reply(chatId, `Almost there! Which ${intent.missing.join(', ')}?`);
    return NextResponse.json({ ok: true });
  }

  const tokenSecret = process.env.DEMO_SESSION_SECRET;
  if (!tokenSecret) {
    await reply(chatId, 'Demo ingest is not configured.');
    return NextResponse.json({ ok: true });
  }

  const token = await new SignJWT({
    venue_id: session.venue_id,
    telegram_user_id: telegramUserId,
    update_id: updateId,
    chat_id: chatId,
    correlation_id: correlationId,
    scope: 'demo_telegram'
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('120s')
    .sign(new TextEncoder().encode(tokenSecret));

  const origin = (process.env.DEMO_PUBLIC_ORIGIN ?? new URL(request.url).origin).replace(/\/$/, '');
  const res = await postListing(origin, token, session.venue_id, {
    raia_id: `demo-tg-${updateId}`,
    headline: intent.headline as string,
    property_type: intent.property_type,
    service_type: intent.service_type,
    ...(intent.bedrooms !== undefined ? { bedrooms: intent.bedrooms } : {}),
    ...(intent.rent_pcm !== undefined ? { rent_pcm: intent.rent_pcm } : {}),
    currency: intent.currency,
    ...(photo ? { photo_file_id: photo } : {})
  });

  // 5xx, not 200: a failed write must be retried by Telegram, and a replay
  // returns duplicate:true instead of a second row.
  if (!res) {
    await reply(chatId, 'Could not save that listing — please try again.');
    return NextResponse.json({ error: 'ingest unreachable' }, { status: 502 });
  }
  if (res.status === 429) {
    await reply(chatId, 'That is 3 listings in 10 minutes per person — give it a few minutes.');
    return NextResponse.json({ ok: true });
  }
  if (!res.ok) {
    console.error('telegram ingest refused', { correlation_id: correlationId, status: res.status });
    await reply(chatId, 'Could not save that listing — please try again.');
    return NextResponse.json({ error: 'ingest refused' }, { status: 502 });
  }

  const data = (await res.json().catch(() => ({}))) as { id?: string };
  await reply(
    chatId,
    data.id ? `Live on the demo board: ${DEMO_SITE}/l/${data.id}` : 'Saved, but the link is not ready yet.'
  );
  return NextResponse.json({ ok: true });
}
