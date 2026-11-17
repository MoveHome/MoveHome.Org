// Claim lifecycle (migration 0019): a card is private ('staged') until the agency
// verifies a one-time token. Supabase is mocked — no live calls, no email sent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const tables: Record<string, Record<string, unknown>[]> = {
    tbl_a2a_registry: [],
    vw_a2a_registry_public: []
  };
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];

  function builder(name: string) {
    tables[name] ??= [];
    const rows = tables[name];
    const filters: [string, unknown][] = [];
    let mode: 'read' | 'write' = 'read';
    let patch: Record<string, unknown> = {};
    const match = () => rows.filter((r) => filters.every(([c, v]) => r[c] === v));

    // The chain is thenable so `await q.update(p).eq(...)` lands the write, the way
    // supabase-js resolves the PostgREST builder.
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => {
        filters.push([c, v]);
        return q;
      },
      is: () => q,
      order: () => q,
      limit: () => q,
      range: async () => ({ data: [], count: 0, error: null }),
      maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
      single: async () => ({ data: match()[0] ?? null, error: null }),
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        // UUID-shaped: getAgent() keys off the id format to pick id vs slug.
        const id = `00000000-0000-4000-8000-00000000000${inserts.length}`;
        const created = { ...row, id };
        rows.push(created);
        return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
      },
      update: (p: Record<string, unknown>) => {
        mode = 'write';
        patch = p;
        updates.push(p);
        return q;
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (mode === 'write') for (const r of match()) Object.assign(r, patch);
        return resolve({ data: null, error: null });
      }
    };
    return q;
  }

  return { tables, updates, inserts, builder };
});

vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => ({ from: (name: string) => h.builder(name) })
}));

vi.mock('@/lib/portal/rate-limit', () => ({
  enforceRateLimit: vi.fn(async () => ({ ok: true, limit: 10, remaining: 9, resetUnix: 0, retryAfter: 0 }))
}));

const { POST } = await import('@/app/api/registry/v1/agents/claim/route');
const { createAgent } = await import('@/lib/registry/store');

const SLUG = 'acme-estates';
const TOKEN = 'aaaaaaaa-1111-4111-8111-111111111111';

function seedRow(over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id: 'row-1',
    slug: SLUG,
    name: 'Acme Estates',
    publication_status: 'staged',
    status: 'pending',
    hidden: true,
    claimed_at: null,
    claimed_by_email: null,
    claim_token: null,
    claim_token_sent_at: null,
    claim_token_expires_at: null,
    claim_attempts: 0,
    verified_website_url: null,
    last_synced_at: null,
    ...over
  };
  h.tables.tbl_a2a_registry.push(row);
  return row;
}

function call(body: unknown) {
  return POST(
    new Request('https://movehome.org/api/registry/v1/agents/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify(body)
    })
  );
}

function row() {
  return h.tables.tbl_a2a_registry[0];
}

beforeEach(() => {
  h.tables.tbl_a2a_registry.length = 0;
  h.tables.vw_a2a_registry_public.length = 0;
  h.updates.length = 0;
  h.inserts.length = 0;
  process.env.RESEND_API_KEY = 'test-key';
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  vi.unstubAllGlobals();
});

describe('claim · initiate', () => {
  it('issues a token, emails the link, and never echoes the token', async () => {
    seedRow();
    const res = await call({ phase: 'initiate', slug: SLUG, contact_email: 'ops@acme.test', website_url: 'https://acme.test' });
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.status).toBe('email_sent');
    expect(JSON.stringify(body)).not.toContain(String(row().claim_token));
    expect(row().claim_token).toBeTruthy();
    expect(row().claim_attempts).toBe(1);
    expect(row().verified_website_url).toBe('https://acme.test');
    expect(String(row().claim_token_expires_at)).toBeTruthy();
    // The token reaches the agency by email only.
    expect(String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body)).toContain(String(row().claim_token));
  });

  it('refuses an already-claimed card with 409', async () => {
    seedRow({ claimed_at: '2026-11-01T00:00:00.000Z', publication_status: 'published' });
    const res = await call({ phase: 'initiate', slug: SLUG, contact_email: 'ops@acme.test' });
    expect(res.status).toBe(409);
    expect(h.updates).toHaveLength(0);
  });

  it('rate-limits after 5 initiate attempts in 24h', async () => {
    seedRow({ claim_attempts: 5, claim_token_sent_at: new Date().toISOString() });
    const res = await call({ phase: 'initiate', slug: SLUG, contact_email: 'ops@acme.test' });
    expect(res.status).toBe(429);
    expect(h.updates).toHaveLength(0);
  });

  it('returns 503 and mutates nothing when the email provider is not configured', async () => {
    delete process.env.RESEND_API_KEY;
    seedRow();
    const res = await call({ phase: 'initiate', slug: SLUG, contact_email: 'ops@acme.test' });
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.detail).toMatch(/email/i);
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await call({ phase: 'initiate', slug: 'nope-nope', contact_email: 'ops@acme.test' });
    expect(res.status).toBe(404);
  });
});

describe('claim · verify', () => {
  const pending = () =>
    seedRow({
      claim_token: TOKEN,
      claim_token_sent_at: new Date().toISOString(),
      claim_token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      claim_attempts: 1
    });

  it('publishes the card and burns the token on a matching token', async () => {
    pending();
    const res = await call({ phase: 'verify', slug: SLUG, token: TOKEN, contact_email: 'ops@acme.test' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('published');
    expect(row().publication_status).toBe('published');
    expect(row().status).toBe('listed');
    expect(row().hidden).toBe(false);
    expect(row().claim_token).toBeNull();
    expect(row().claimed_at).toBeTruthy();
    expect(row().claimed_by_email).toBe('ops@acme.test');
    expect(row().last_synced_at).toBeTruthy();
  });

  it('rejects a wrong token and leaves the card staged', async () => {
    pending();
    const res = await call({
      phase: 'verify',
      slug: SLUG,
      token: 'bbbbbbbb-2222-4222-8222-222222222222',
      contact_email: 'ops@acme.test'
    });

    expect(res.status).toBe(400);
    expect(row().publication_status).toBe('staged');
    expect(row().claim_token).toBe(TOKEN);
    expect(h.updates).toHaveLength(0);
  });

  it('rejects an expired token', async () => {
    seedRow({
      claim_token: TOKEN,
      claim_token_sent_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      claim_token_expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      claim_attempts: 1
    });
    const res = await call({ phase: 'verify', slug: SLUG, token: TOKEN, contact_email: 'ops@acme.test' });

    expect(res.status).toBe(400);
    expect(row().publication_status).toBe('staged');
    expect(h.updates).toHaveLength(0);
  });

  it('rejects verify on an already-claimed card with 409', async () => {
    pending();
    Object.assign(row(), { claimed_at: '2026-11-01T00:00:00.000Z', publication_status: 'published' });
    const res = await call({ phase: 'verify', slug: SLUG, token: TOKEN, contact_email: 'ops@acme.test' });
    expect(res.status).toBe(409);
  });
});

describe('createAgent · publication gate', () => {
  it('inserts explicitly staged, never published', async () => {
    const card = {
      slug_base: 'acme-estates',
      well_known_uri: 'https://acme.test/.well-known/agent-card.json',
      a2a_url: null,
      name: 'Acme Estates',
      description: null,
      provider_org: null,
      provider_url: null,
      protocol_version: null,
      preferred_transport: null,
      capabilities: null,
      skills: [],
      icon_url: null,
      documentation_url: null,
      raw_card: null,
      signature_verified: false,
      locations: null,
      service_types: null,
      categories: []
    };

    await createAgent(card, { submittedByHash: null });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].publication_status).toBe('staged');
  });
});
