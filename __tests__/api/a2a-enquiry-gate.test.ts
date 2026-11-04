// Phase 0 of the 1a write-path pilot (MoveHome/MoveHome.Org#34). Proves the
// architecture rulings on the A2A create_enquiry door:
//   #1/#5  flag-gated, default off; card hides the skill while off
//   #2     TEST-org fence rejects real prop-gb-rlf-* listings even with writes on
//   #3     write throttle fails closed; idempotent retries never double-send
//   #4     claimed vs verified attribution; verified never comes from the payload
// Supabase and the rate limiter are faked, so the suite needs no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Fakes ───────────────────────────────────────────────────────────────────
interface Row { [k: string]: unknown }
const db = {
  listings: new Map<string, Row>(),
  enquiries: new Map<string, Row>(),
  inserts: 0
};

// Minimal chainable stand-in for the supabase-js query builder, covering only
// the calls src/lib/enquiry.ts makes.
function fakeFrom(table: string) {
  const filters: Array<[string, unknown]> = [];
  let head = false;
  const rows = () => {
    const src = table === 'tbl_external_raia_listings' ? db.listings : db.enquiries;
    return [...src.values()].filter((r) => filters.every(([k, v]) => r[k] === v));
  };
  const builder: any = {
    select: (_cols?: string, opts?: { head?: boolean }) => {
      head = !!opts?.head;
      return builder;
    },
    eq: (k: string, v: unknown) => {
      filters.push([k, v]);
      return builder;
    },
    gte: () => builder,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => void) =>
      resolve(head ? { count: rows().length, error: null } : { data: rows(), error: null }),
    insert: async (row: Row) => {
      const id = row.enquiry_id as string;
      if (db.enquiries.has(id)) return { error: { code: '23505', message: 'duplicate key' } };
      db.enquiries.set(id, row);
      db.inserts++;
      return { error: null };
    },
    update: () => ({ eq: async () => ({ error: null }) })
  };
  return builder;
}
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: () => ({ from: fakeFrom }) }));

const enforceRateLimit = vi.fn();
vi.mock('@/lib/portal/rate-limit', () => ({
  enforceRateLimit,
  rateLimitHeaders: () => ({})
}));
vi.mock('@/lib/queries', () => ({ searchListings: vi.fn(), getListingByRaiaId: vi.fn() }));
vi.mock('@/lib/a2a/card-signing', () => ({ signAgentCard: async (c: unknown) => c }));

const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
vi.stubGlobal('fetch', fetchSpy);

const { POST } = await import('@/app/api/a2a/route');
const { buildAgentCard } = await import('@/lib/a2a/card');
const { createEnquiry } = await import('@/lib/enquiry');
const { buildAttribution, checkTestFence, enquiryIdForIdempotencyKey } = await import('@/lib/agent-write-policy');

// ── Fixtures ────────────────────────────────────────────────────────────────
// Real production listing id shape (RLF catalogue) — must ALWAYS be fenced.
const PROD = { raia_id: 'prop-gb-rlf-000528', agent_id: 'org-gb-07798821' };
const TEST = { raia_id: 'prop-gb-mhtest-000001', agent_id: 'org-gb-mhtest' };

function seed() {
  db.listings.clear();
  db.enquiries.clear();
  db.inserts = 0;
  for (const l of [PROD, TEST]) {
    db.listings.set(l.raia_id, {
      ...l,
      enquiry_endpoint: 'https://agent.example.com/enquiries',
      withdrawn_at: null,
      visibility: 'public'
    });
  }
}

const OK_DECISION = { ok: true, limit: 5, remaining: 4, resetAt: 0, retryAfter: 0 };

function enquiryBody(params: Record<string, unknown>) {
  return {
    jsonrpc: '2.0',
    id: 7,
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        role: 'user',
        messageId: 'm-1',
        parts: [{ kind: 'data', data: { skill: 'create_enquiry', params } }]
      }
    }
  };
}

function enquiryParams(raia_id: string, extra: Record<string, unknown> = {}) {
  return {
    raia_id,
    enquirer: { name: 'Pilot Tester', email: 'pilot@example.com' },
    message: 'Is this available?',
    ...extra
  };
}

async function send(params: Record<string, unknown>) {
  const res = await POST(
    new Request('http://localhost/api/a2a', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify(enquiryBody(params))
    })
  );
  return { res, body: (await res.json()) as any };
}

beforeEach(() => {
  seed();
  enforceRateLimit.mockReset().mockResolvedValue(OK_DECISION);
  fetchSpy.mockClear();
  delete process.env.AGENT_ENQUIRY_WRITES;
  delete process.env.AGENT_ENQUIRY_TEST_AGENT_IDS;
});
afterEach(() => {
  delete process.env.AGENT_ENQUIRY_WRITES;
  delete process.env.AGENT_ENQUIRY_TEST_AGENT_IDS;
});

// ── Ruling #1/#5: flag-gated, default off ───────────────────────────────────
describe('create_enquiry flag (default off)', () => {
  it('rejects A2A create_enquiry when the flag is unset, before any DB or limiter work', async () => {
    const { res, body } = await send(enquiryParams(TEST.raia_id));
    expect(res.status).toBe(403);
    expect(body.error.message).toMatch(/closed pilot/);
    expect(db.inserts).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    // only the shared read bucket ran; the write limiter never did
    expect(enforceRateLimit).not.toHaveBeenCalledWith(expect.anything(), 'enquiry.write', expect.anything());
  });

  it('treats any value other than "on" as off', async () => {
    process.env.AGENT_ENQUIRY_WRITES = 'true';
    const { res } = await send(enquiryParams(TEST.raia_id));
    expect(res.status).toBe(403);
  });

  it('hides create_enquiry from the Agent Card while off, shows it when on', () => {
    expect(buildAgentCard().skills.map((s) => s.id)).toEqual(['search_properties', 'get_property']);
    process.env.AGENT_ENQUIRY_WRITES = 'on';
    expect(buildAgentCard().skills.map((s) => s.id)).toContain('create_enquiry');
  });
});

// ── Ruling #2: TEST-org fence (must-fail fixtures on real RLF ids) ──────────
describe('TEST-org fence', () => {
  beforeEach(() => {
    process.env.AGENT_ENQUIRY_WRITES = 'on';
    process.env.AGENT_ENQUIRY_TEST_AGENT_IDS = TEST.agent_id;
  });

  it('MUST FAIL: a production prop-gb-rlf-* listing is rejected even with writes on', async () => {
    const { res, body } = await send(enquiryParams(PROD.raia_id));
    expect(res.status).toBe(200); // JSON-RPC envelope; the task itself fails
    expect(body.result.status.state).toBe('failed');
    expect(JSON.stringify(body.result.status.message)).toMatch(/designated test listings/);
    expect(db.inserts).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('MUST FAIL: an empty allowlist fences everything, including test listings', async () => {
    process.env.AGENT_ENQUIRY_TEST_AGENT_IDS = '';
    const { body } = await send(enquiryParams(TEST.raia_id));
    expect(body.result.status.state).toBe('failed');
    expect(db.inserts).toBe(0);
  });

  it('MUST FAIL: caller cannot widen the fence via params (strict schema)', async () => {
    const { body } = await send(enquiryParams(PROD.raia_id, { agent_id: TEST.agent_id }));
    expect(body.result.status.state).toBe('failed');
    expect(db.inserts).toBe(0);
  });

  it('accepts a write to an allow-listed TEST org listing', async () => {
    const { body } = await send(enquiryParams(TEST.raia_id));
    expect(body.result.status.state).toBe('completed');
    expect(db.inserts).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not fence the human web form path (no agent context)', async () => {
    const r = await createEnquiry({
      raia_id: PROD.raia_id,
      name: 'Human',
      email: 'human@example.com',
      message: 'Hello'
    });
    expect(r.ok).toBe(true);
  });

  it('checkTestFence uses only the DB-resolved org id', () => {
    expect(checkTestFence(PROD.agent_id, [TEST.agent_id]).ok).toBe(false);
    expect(checkTestFence(null, [TEST.agent_id]).ok).toBe(false);
    expect(checkTestFence(TEST.agent_id, [TEST.agent_id]).ok).toBe(true);
  });
});

// ── Ruling #3: fail-closed throttle + idempotency ───────────────────────────
describe('abuse controls', () => {
  beforeEach(() => {
    process.env.AGENT_ENQUIRY_WRITES = 'on';
    process.env.AGENT_ENQUIRY_TEST_AGENT_IDS = TEST.agent_id;
  });

  it('fails CLOSED when the write limiter is unavailable', async () => {
    enforceRateLimit.mockImplementation(async (_k: string, group: string) => {
      if (group === 'enquiry.write') throw new Error('limiter down');
      return OK_DECISION;
    });
    const { res } = await send(enquiryParams(TEST.raia_id));
    expect(res.status).toBe(503);
    expect(db.inserts).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 429 when the write limiter denies', async () => {
    enforceRateLimit.mockImplementation(async (_k: string, group: string) =>
      group === 'enquiry.write' ? { ...OK_DECISION, ok: false, remaining: 0, retryAfter: 30 } : OK_DECISION
    );
    const { res } = await send(enquiryParams(TEST.raia_id));
    expect(res.status).toBe(429);
    expect(db.inserts).toBe(0);
  });

  it('a retry with the same idempotency key returns the same receipt and never re-sends', async () => {
    const p = enquiryParams(TEST.raia_id, { idempotency_key: 'retry-key-0001' });
    const first = await send(p);
    const second = await send(p);
    const id = (b: any) => b.result.artifacts[0].parts[0].data.enquiry_id;
    expect(first.body.result.status.state).toBe('completed');
    expect(second.body.result.status.state).toBe('completed');
    expect(id(second.body)).toBe(id(first.body));
    expect(db.inserts).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('idempotency ids are deterministic, scoped, and UUID-shaped', () => {
    const a = enquiryIdForIdempotencyKey('a2a:x', 'k');
    expect(a).toBe(enquiryIdForIdempotencyKey('a2a:x', 'k'));
    expect(a).not.toBe(enquiryIdForIdempotencyKey('mcp:x', 'k'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

// ── Ruling #4: attribution honesty ──────────────────────────────────────────
describe('attribution', () => {
  beforeEach(() => {
    process.env.AGENT_ENQUIRY_WRITES = 'on';
    process.env.AGENT_ENQUIRY_TEST_AGENT_IDS = TEST.agent_id;
  });

  it('persists claimed_platform from the caller and verified_platform as null', async () => {
    await send(enquiryParams(TEST.raia_id, { claimed_platform: 'Grok' }));
    const row = [...db.enquiries.values()][0];
    expect(row.source).toMatchObject({
      origin: 'movehome.org',
      channel: 'a2a',
      claimed_platform: 'grok',
      verified_platform: null
    });
  });

  it('MUST FAIL: verified_platform cannot be supplied in the payload', async () => {
    const { body } = await send(enquiryParams(TEST.raia_id, { verified_platform: 'gemini' }));
    expect(body.result.status.state).toBe('failed');
    expect(db.inserts).toBe(0);
  });

  it('keeps the forwarded wire source within enquiry.json source_block', async () => {
    await send(enquiryParams(TEST.raia_id, { claimed_platform: 'muse' }));
    const wire = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(Object.keys(wire.source).sort()).toEqual(['origin']);
  });

  it('buildAttribution never derives verified from the claim', () => {
    expect(buildAttribution('a2a', 'gemini').verified_platform).toBeNull();
  });
});
