import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildSearchRequest,
  extractItems,
  collectSearchPages,
} = require('../../../scripts/raia-protocol-crawl.cjs') as {
  buildSearchRequest: (card: unknown, params?: unknown, credentials?: unknown) =>
    { url: string; method: string; headers: Record<string, string>; body: any };
  extractItems: (payload: unknown) => { items: unknown[]; total: number | null } | null;
  collectSearchPages: (
    card: unknown,
    params: unknown,
    credentials: unknown,
    fetchPage: (req: { url: string; method: string; headers: Record<string, string>; body: any }) => Promise<unknown>,
  ) => Promise<unknown[]>;
};

// The live EA A2A card shape (https://app.estateaigents.com/.well-known/agent.json).
const flatCard = {
  protocolVersion: '0.3.0',
  name: 'EstateAigents RAIA Property Agent',
  url: 'https://app.estateaigents.com/api/a2a',
  preferredTransport: 'JSONRPC',
  version: '0.2.0',
  skills: [{ id: 'search_properties' }],
};

const legacyCard = {
  schema_version: '0.2',
  agent_id: 'org-gb-rlf',
  endpoints: {
    search: 'https://agents.example/api/raia/search',
  },
};

describe('buildSearchRequest', () => {
  it('POSTs a JSON-RPC 2.0 message/send to a flat card url with no auth by default', () => {
    const req = buildSearchRequest(flatCard, { un_locode: 'GBLON', transaction_type: 'LETTINGS', limit: 50 });

    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://app.estateaigents.com/api/a2a');
    expect(req.headers.Authorization).toBeUndefined();
    expect(req.body).toMatchObject({
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ kind: 'data', data: { skill: 'search_properties', params: { un_locode: 'GBLON', transaction_type: 'LETTINGS', limit: 50 } } }],
        },
      },
    });
  });

  it('keeps the legacy endpoints.search GET shape', () => {
    const req = buildSearchRequest(legacyCard, { limit: 50, offset: 100 });

    expect(req.method).toBe('GET');
    expect(req.body).toBeNull();
    const url = new URL(req.url);
    expect(url.origin + url.pathname).toBe('https://agents.example/api/raia/search');
    expect(url.searchParams.get('offset')).toBe('100');
    expect(req.headers.Authorization).toBeUndefined();
  });

  it('attaches Bearer only when a credential is present', () => {
    expect(buildSearchRequest(flatCard, {}, { token: 'tok-123' }).headers.Authorization).toBe('Bearer tok-123');
    expect(buildSearchRequest(legacyCard, {}, { token: 'tok-123' }).headers.Authorization).toBe('Bearer tok-123');
    expect(buildSearchRequest(flatCard, {}, null).headers.Authorization).toBeUndefined();
    expect(buildSearchRequest(flatCard, {}, {}).headers.Authorization).toBeUndefined();
  });
});

describe('extractItems', () => {
  it('unwraps the JSON-RPC task envelope with properties', () => {
    const payload = {
      jsonrpc: '2.0',
      id: 'movehome-crawl-0',
      result: {
        kind: 'task',
        status: { state: 'completed', message: { kind: 'message', parts: [{ kind: 'data', data: { properties: [{ raia_id: 'prop-gb-rlf-000031' }] } }] } },
      },
    };
    expect(extractItems(payload)?.items).toHaveLength(1);
  });

  it('accepts properties, results and listings keys, and bare arrays', () => {
    expect(extractItems({ properties: [1] })?.items).toEqual([1]);
    expect(extractItems({ results: [1, 2] })?.total).toBeNull();
    expect(extractItems({ listings: [1], total: 9 })).toEqual({ items: [1], total: 9 });
    expect(extractItems([1, 2, 3])).toEqual({ items: [1, 2, 3], total: 3 });
    expect(extractItems({ nope: [] })).toBeNull();
  });

  it('throws on a failed JSON-RPC task instead of returning empty results', () => {
    const payload = {
      jsonrpc: '2.0',
      id: 1,
      result: { status: { state: 'failed', message: { parts: [{ kind: 'text', text: 'Invalid parameters' }] } } },
    };
    expect(() => extractItems(payload)).toThrow(/Invalid parameters/);
  });
});

describe('collectSearchPages', () => {
  it('advances offset on successive legacy requests until a short page', async () => {
    const seen: string[] = [];
    const pages: unknown[] = [
      { results: Array.from({ length: 50 }, (_, i) => ({ raia_id: `prop-gb-rlf-${1000 + i}` })) },
      { results: [{ raia_id: 'prop-gb-rlf-2000' }] },
    ];

    const items = await collectSearchPages(legacyCard, { limit: 50 }, null, async (req) => {
      seen.push(new URL(req.url).searchParams.get('offset') ?? '');
      return pages.shift();
    });

    expect(seen).toEqual(['0', '50']);
    expect(items).toHaveLength(51);
  });

  it('stops after one page for a JSON-RPC card (skill has no offset)', async () => {
    let calls = 0;
    const items = await collectSearchPages(flatCard, { limit: 50 }, null, async () => {
      calls++;
      return { properties: Array.from({ length: 50 }, (_, i) => ({ raia_id: `p-${i}` })) };
    });

    expect(calls).toBe(1);
    expect(items).toHaveLength(50);
  });
});
