// Telegram channel guards: server-verified identity, idempotent replays,
// write throttling enforced server-side (inside the RPC) and two deliberately
// different rate-check call sites — writes fail CLOSED, reads fail OPEN.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT, jwtVerify } from 'jose';

const { rpc, from, resolveSkillMock } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  resolveSkillMock: vi.fn()
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc, from }) }));
vi.mock('@/lib/a2a/skills', () => ({ resolveSkill: (id: string) => resolveSkillMock(id) }));

const SECRET = 'test-secret-test-secret-test-secret';
const WEBHOOK_SECRET = 'webhook-secret';
const VENUE = 'venue-a';

const { POST: ingest } = await import('@/app/api/demo/ingest/route');
const { POST: webhook } = await import('@/app/api/telegram/webhook/route');
const { extractListingIntent } = await import('@/lib/demo/intent');

const LISTING = {
  raia_id: 'demo-tg-1',
  headline: '2 bed flat in Shoreditch',
  property_type: 'flat',
  service_type: 'long_term',
  bedrooms: 2,
  rent_pcm: 1500,
  currency: 'GBP'
};

const fetchMock = vi.fn();

function sign(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('2m')
    .sign(new TextEncoder().encode(SECRET));
}

function telegramToken(overrides: Record<string, unknown> = {}) {
  return sign({
    venue_id: VENUE,
    scope: 'demo_telegram',
    telegram_user_id: 111,
    update_id: 7,
    chat_id: 5,
    correlation_id: 'corr-1',
    ...overrides
  });
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://demo.movehome.org${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

function webhookUpdate(body: Record<string, unknown>) {
  return post('/api/telegram/webhook', body, { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET });
}

const SESSION = {
  venue_id: VENUE,
  telegram_user_id: 111,
  session_exp: new Date(Date.now() + 3_600_000).toISOString()
};

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object' && 'url' in input) return String((input as { url: string }).url);
  return '';
}

function ingestCalls() {
  return fetchMock.mock.calls.filter(([u]) => urlOf(u).includes('/api/demo/ingest'));
}

function broadcastCalls() {
  return fetchMock.mock.calls.filter(([u]) => urlOf(u).includes('/realtime/v1/api/broadcast'));
}

function replies(): string[] {
  return fetchMock.mock.calls
    .filter(([u]) => urlOf(u).includes('api.telegram.org'))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)).text as string);
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  resolveSkillMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);

  fetchMock.mockImplementation(async (input: unknown) => {
    const url = urlOf(input);
    if (url.includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (url.includes('/api/demo/ingest')) return new Response(JSON.stringify({ id: 'row-1' }), { status: 201 });
    return new Response('{}', { status: 200 });
  });

  // The session row the webhook resolves the venue from.
  from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: SESSION, error: null }) }) }),
    upsert: async () => ({ error: null })
  }));

  process.env.DEMO_SESSION_SECRET = SECRET;
  process.env.DEMO_WRITE_ENABLED = 'true';
  process.env.DEMO_SUPABASE_URL = 'https://demo.example.supabase.co';
  process.env.DEMO_SUPABASE_ANON_KEY = 'demo-anon';
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('telegram ingest path', () => {
  it('telegram: ingest without a venue session token → 403, zero rows', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'no venue session for this chat' } });

    const res = await ingest(
      post(
        '/api/demo/ingest',
        { venue_id: VENUE, listing: LISTING },
        { authorization: `Bearer ${await telegramToken()}` }
      )
    );

    expect(res.status).toBe(403);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('demo_telegram_ingest');
    expect(broadcastCalls()).toHaveLength(0);
  });

  it('telegram: 4th listing inside 10min from one telegram_user_id → throttled', async () => {
    rpc
      .mockResolvedValueOnce({ data: { id: 'row-1', duplicate: false }, error: null })
      .mockResolvedValueOnce({ data: { id: 'row-2', duplicate: false }, error: null })
      .mockResolvedValueOnce({ data: { id: 'row-3', duplicate: false }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'PT429', message: 'rate limit is 3 listings per 10 minutes' } });

    const statuses: number[] = [];
    for (let i = 1; i <= 4; i += 1) {
      const res = await ingest(
        post(
          '/api/demo/ingest',
          { venue_id: VENUE, listing: LISTING },
          { authorization: `Bearer ${await telegramToken({ update_id: i })}` }
        )
      );
      statuses.push(res.status);
    }

    expect(statuses).toEqual([201, 201, 201, 429]);
    // Three rows written, three broadcasts — the throttled 4th wrote nothing.
    expect(broadcastCalls()).toHaveLength(3);
  });

  it('telegram: replayed update_id → exactly one row', async () => {
    rpc.mockResolvedValueOnce({ data: { id: 'row-1', duplicate: true }, error: null });

    const res = await ingest(
      post(
        '/api/demo/ingest',
        { venue_id: VENUE, listing: LISTING },
        { authorization: `Bearer ${await telegramToken()}` }
      )
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'row-1', duplicate: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    // No second broadcast for a replay.
    expect(broadcastCalls()).toHaveLength(0);
  });

  it('telegram: rate check error fails CLOSED for writes', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'rate ledger unavailable' } });

    const res = await ingest(
      post(
        '/api/demo/ingest',
        { venue_id: VENUE, listing: LISTING },
        { authorization: `Bearer ${await telegramToken()}` }
      )
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(broadcastCalls()).toHaveLength(0);
  });
});

describe('telegram search path', () => {
  it('telegram: rate check error fails OPEN for reads', async () => {
    rpc.mockRejectedValue(new Error('read ledger unavailable'));
    resolveSkillMock.mockReturnValue(async () => ({ summary: 'Found 2 listings.', artifacts: [] }));

    const res = await webhook(
      webhookUpdate({
        update_id: 11,
        message: { chat: { id: 5 }, from: { id: 111 }, text: '2 bed flat in london' }
      })
    );

    expect(res.status).toBe(200);
    expect(replies().some((text) => text.includes('Found 2 listings'))).toBe(true);
  });

  it('telegram: search reply is served by the existing search handler', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const handler = vi.fn(async () => ({ summary: 'Found 1 listing.', artifacts: [] }));
    resolveSkillMock.mockReturnValue(handler);

    await webhook(
      webhookUpdate({
        update_id: 12,
        message: { chat: { id: 5 }, from: { id: 111 }, text: '2 bed flat in london' }
      })
    );

    expect(resolveSkillMock).toHaveBeenCalledWith('search_properties');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(replies()).toContain('Found 1 listing.');
  });
});

describe('telegram intent extractor', () => {
  it('telegram: caption extraction fills the slots and marks the rest missing', async () => {
    const full = await extractListingIntent({ text: '£1500 2 bed flat in Shoreditch', photo: [{ file_id: 'p' }] });
    expect(full).toMatchObject({ rent_pcm: 1500, bedrooms: 2, property_type: 'flat', service_type: 'long_term' });
    expect(full.missing).toEqual([]);

    const partial = await extractListingIntent({ text: 'nice studio' });
    expect(partial.property_type).toBe('studio');
    expect(partial.missing).toEqual(['photo', 'price']);
  });
});

describe('telegram identity', () => {
  it('telegram: rate-limit key comes from the verified token, not the body', async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    await webhook(
      webhookUpdate({
        update_id: 21,
        // A caller-supplied identity must be ignored outright.
        telegram_user_id: 999999,
        message: {
          chat: { id: 5 },
          from: { id: 111 },
          text: '£1500 2 bed flat in Shoreditch',
          photo: [{ file_id: 'photo-1' }]
        }
      })
    );

    const [call] = ingestCalls();
    expect(call).toBeDefined();
    const token = new Headers((call[1] as RequestInit).headers as HeadersInit)
      .get('authorization')
      ?.slice(7) ?? '';
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET), { algorithms: ['HS256'] });

    expect(payload.telegram_user_id).toBe(111);
    expect(payload.update_id).toBe(21);
    // The write path never consults the read ledger (distinct call sites).
    expect(rpc).not.toHaveBeenCalledWith('demo_telegram_read_allowed', expect.anything());
  });
});
