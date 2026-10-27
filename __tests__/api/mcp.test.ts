// End-to-end tests for the hosted MCP server (src/app/api/mcp/route.ts), driven
// by real JSON-RPC 2.0 requests through the route handlers — the same surface an
// MCP client hits. The data layer is mocked so the suite runs without Supabase.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Listing } from '@/lib/types';

const searchListings = vi.fn();
const getListingByRaiaId = vi.fn();
vi.mock('@/lib/queries', () => ({ searchListings, getListingByRaiaId }));

const { POST, GET, OPTIONS } = await import('@/app/api/mcp/route');

const LISTING = {
  raia_id: 'prop-gb-rlf-000528',
  agent_id: 'org-gb-07798821',
  headline: 'Menara Point',
  marketing_description: null,
  property_type: 'flat',
  service_type: 'long_term',
  listing_status: 'available',
  bedrooms: 2,
  visibility: 'public',
  rent_pcm: 2400,
  currency: 'GBP'
} as unknown as Listing;

function call(body: unknown) {
  return POST(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  );
}

async function rpc(method: string, params?: unknown, id: number | undefined = 1) {
  const res = await call({ jsonrpc: '2.0', id, method, params });
  return { res, body: (await res.json()) as any };
}

// tools/call results are in-band: content[0].text is "<summary>\n\n<json>".
function payload(text: string) {
  return JSON.parse(text.slice(text.indexOf('\n\n') + 2));
}

beforeEach(() => {
  searchListings.mockReset();
  getListingByRaiaId.mockReset();
});

describe('initialize', () => {
  it('negotiates the requested protocol version and advertises tools', async () => {
    const { res, body } = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' }
    });
    expect(res.status).toBe(200);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe('2025-06-18');
    expect(body.result.capabilities.tools.listChanged).toBe(false);
    expect(body.result.serverInfo).toEqual({ name: 'movehome-property', version: '1.0.0' });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('falls back to the default protocol version when none is requested', async () => {
    const { body } = await rpc('initialize', {});
    expect(body.result.protocolVersion).toBe('2025-06-18');
  });

  it('acks notifications with 202 and no body', async () => {
    const res = await call({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('answers ping', async () => {
    const { body } = await rpc('ping');
    expect(body.result).toEqual({});
  });
});

describe('tools/list', () => {
  it('exposes exactly the two read-only tools with JSON schemas', async () => {
    const { body } = await rpc('tools/list');
    const tools = body.result.tools as { name: string; inputSchema: any }[];
    expect(tools.map((t) => t.name)).toEqual(['search_properties', 'get_property']);
    // The write path (which emails an agent) must never be reachable over MCP.
    expect(tools.map((t) => t.name)).not.toContain('create_enquiry');
    expect(tools[1].inputSchema.required).toEqual(['raia_id']);
    expect(tools[0].inputSchema.properties.limit.maximum).toBe(50);
  });
});

describe('tools/call search_properties', () => {
  it('returns listings and forwards the filter to the data layer', async () => {
    searchListings.mockResolvedValue({ results: [LISTING], total: 45 });
    const { body } = await rpc('tools/call', {
      name: 'search_properties',
      arguments: { un_locode: 'GBLON', service_type: 'long_term', limit: 1 }
    });
    expect(body.result.isError).toBeUndefined();
    expect(searchListings).toHaveBeenCalledWith({ un_locode: 'GBLON', service_type: 'long_term', limit: 1 });
    const data = payload(body.result.content[0].text);
    expect(data.total).toBe(45);
    expect(data.count).toBe(1);
    expect(data.listings[0]).toMatchObject({
      raia_id: 'prop-gb-rlf-000528',
      url: 'https://movehome.org/property/prop-gb-rlf-000528',
      status: 'available'
    });
    expect(body.result.content[0].text).toContain('Found 45 listings');
  });

  it('defaults limit to 24 and reports an empty result set cleanly', async () => {
    searchListings.mockResolvedValue({ results: [], total: 0 });
    const { body } = await rpc('tools/call', { name: 'search_properties', arguments: {} });
    expect(searchListings).toHaveBeenCalledWith({ limit: 24 });
    const data = payload(body.result.content[0].text);
    expect(data.listings).toEqual([]);
    expect(body.result.content[0].text).toContain('No listings matched');
  });

  it('reports a bad argument in-band as isError, not a 5xx', async () => {
    const { res, body } = await rpc('tools/call', {
      name: 'search_properties',
      arguments: { un_locode: 'nope' }
    });
    expect(res.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/un_locode/);
    expect(searchListings).not.toHaveBeenCalled();
  });
});

describe('tools/call get_property', () => {
  it('returns the full public listing', async () => {
    getListingByRaiaId.mockResolvedValue(LISTING);
    const { body } = await rpc('tools/call', {
      name: 'get_property',
      arguments: { raia_id: 'prop-gb-rlf-000528' }
    });
    expect(getListingByRaiaId).toHaveBeenCalledWith('prop-gb-rlf-000528');
    const data = payload(body.result.content[0].text);
    expect(data.listing.raia_id).toBe('prop-gb-rlf-000528');
    expect(body.result.content[0].text).toContain('Listing: Menara Point');
    expect(body.result.isError).toBeUndefined();
  });

  it('reports a missing or non-public listing as an error', async () => {
    getListingByRaiaId.mockResolvedValue(null);
    const { body } = await rpc('tools/call', {
      name: 'get_property',
      arguments: { raia_id: 'prop-gb-rlf-000999' }
    });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('No public listing found');
  });
});

describe('protocol errors', () => {
  it('rejects an unknown tool with -32602', async () => {
    const { body } = await rpc('tools/call', { name: 'delete_everything', arguments: {} });
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain('delete_everything');
  });

  it('rejects an unknown method with -32601', async () => {
    const { body } = await rpc('resources/list');
    expect(body.error.code).toBe(-32601);
  });

  it('rejects malformed JSON with -32700', async () => {
    const res = await POST(
      new Request('http://localhost/api/mcp', { method: 'POST', body: '{not json' })
    );
    expect(((await res.json()) as any).error.code).toBe(-32700);
  });

  it('answers CORS preflight with 204', async () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('GET describes the server and its tools', async () => {
    const body = (await GET().json()) as any;
    expect(body.tools).toEqual(['search_properties', 'get_property']);
    expect(body.service).toBe('movehome-property');
  });
});
