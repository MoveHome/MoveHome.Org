// A2A 1.0 on /api/a2a. The card advertises 1.0 and 0.3; until this adapter a 1.0
// SendMessage answered "Method not found". Real route, real SDK transport and
// executor; only the data layer and the rate limiter are faked. No network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const searchListings = vi.fn();
vi.mock('@/lib/queries', () => ({ searchListings, getListingByRaiaId: vi.fn() }));
const enforceRateLimit = vi.fn();
vi.mock('@/lib/portal/rate-limit', () => ({ enforceRateLimit, rateLimitHeaders: () => ({}) }));
vi.mock('@/lib/a2a/card-signing', () => ({ signAgentCard: async (c: unknown) => c }));
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: () => ({ from: () => { throw new Error('no db in this test'); } }) }));
const createEnquiry = vi.fn();
vi.mock('@/lib/enquiry', () => ({ createEnquiry }));

const { POST } = await import('@/app/api/a2a/route');
const { buildAgentCard } = await import('@/lib/a2a/card');

function call(body: unknown, version?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (version) headers['A2A-Version'] = version;
  return POST(new Request('https://movehome.org/api/a2a', { method: 'POST', headers, body: JSON.stringify(body) }))
    .then(async (r) => ({ status: r.status, body: await r.json() }));
}

const searchV1 = {
  jsonrpc: '2.0', id: 1, method: 'SendMessage',
  params: { message: { role: 'ROLE_USER', messageId: 'm1', parts: [{ data: { skill: 'search_properties', params: { un_locode: 'GBLON', service_type: 'long_term', rent_pcm_max: 3000 } } }] } }
};
const searchLegacy = {
  jsonrpc: '2.0', id: 2, method: 'message/send',
  params: { message: { kind: 'message', role: 'user', messageId: 'm2', parts: [{ kind: 'data', data: { skill: 'search_properties', params: { un_locode: 'GBLON' } } }] } }
};
const enquiryV1 = {
  jsonrpc: '2.0', id: 3, method: 'SendMessage',
  params: { message: { role: 'ROLE_USER', messageId: 'm3', parts: [{ data: { skill: 'create_enquiry', params: {
    raia_id: 'prop-gb-rlf-000528', enquirer: { name: 'Jane', email: 'jane@example.com' }, message: 'Still available?'
  } } }] } }
};

beforeEach(() => {
  enforceRateLimit.mockReset().mockResolvedValue({ ok: true, retryAfter: 0 });
  searchListings.mockReset().mockResolvedValue({ results: [], total: 0 });
  createEnquiry.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('A2A 1.0 on /api/a2a', () => {
  it('serves SendMessage under A2A-Version 1.0 in the 1.0 wire shape', async () => {
    const { status, body } = await call(searchV1, '1.0');
    expect(status).toBe(200);
    const task = body.result.task;
    expect(task.status.state).toBe('TASK_STATE_COMPLETED');
    expect(task.status.message.role).toBe('ROLE_AGENT');
    expect(task.status.message.parts[0]).toEqual({ text: 'No listings matched the search criteria.' });
    expect(task.artifacts[0].parts[0]).toHaveProperty('data');
    expect(task.artifacts[0].parts[0]).not.toHaveProperty('kind');
    expect(searchListings).toHaveBeenCalledWith(expect.objectContaining({ un_locode: 'GBLON', rent_pcm_max: 3000 }));
  });

  it('keeps headerless and 0.3 / 0.3.0 clients on the 0.3 shape', async () => {
    for (const v of [undefined, '0.3', '0.3.0']) {
      const { body } = await call(searchLegacy, v);
      expect(body.result.kind).toBe('task');
      expect(body.result.status.state).toBe('completed');
    }
  });

  it('refuses a version/method mismatch with -32601 in both directions', async () => {
    expect((await call(searchLegacy, '1.0')).body.error.code).toBe(-32601);
    expect((await call(searchV1)).body.error.code).toBe(-32601);
    expect(searchListings).not.toHaveBeenCalled();
  });

  it('refuses an unknown version with -32009 and an unsupported 1.0 method with -32601', async () => {
    const v2 = await call(searchV1, '2.0');
    expect(v2.body.error.code).toBe(-32009);
    expect(v2.body.error.message).toContain('Supported versions: 1.0, 0.3');
    expect((await call({ jsonrpc: '2.0', id: 9, method: 'SendStreamingMessage', params: {} }, '1.0')).body.error.code).toBe(-32601);
  });

  it('a failed skill comes back as TASK_STATE_FAILED with its reason', async () => {
    const bad = structuredClone(searchV1);
    bad.params.message.parts[0].data.skill = 'no_such_skill';
    const { body } = await call(bad, '1.0');
    expect(body.result.task.status.state).toBe('TASK_STATE_FAILED');
    expect(body.result.task.status.message.parts[0].text).toContain('Unknown skill: no_such_skill');
  });

  it('1.0 cannot bypass the write switch: create_enquiry is refused while writes are off', async () => {
    vi.stubEnv('AGENT_ENQUIRY_WRITES', 'off');
    const { status, body } = await call(enquiryV1, '1.0');
    expect(status).toBe(403);
    expect(body.error.code).toBe(-32601);
    expect(createEnquiry).not.toHaveBeenCalled();
  });

  it('1.0 create_enquiry gets the same fail-closed write throttle as 0.3', async () => {
    vi.stubEnv('AGENT_ENQUIRY_WRITES', 'on');
    enforceRateLimit.mockImplementation(async (_key: string, bucket: string) => {
      if (bucket === 'enquiry.write') throw new Error('limiter down');
      return { ok: true, retryAfter: 0 };
    });
    const { status } = await call(enquiryV1, '1.0');
    expect(status).toBe(503);
    expect(createEnquiry).not.toHaveBeenCalled();
  });

  it('the card gives every advertised interface its endpoint URL', () => {
    const card = buildAgentCard();
    expect(card.supportedInterfaces?.map((i) => [i.protocolVersion, i.url])).toEqual([
      ['1.0', 'https://movehome.org/api/a2a'],
      ['0.3', 'https://movehome.org/api/a2a']
    ]);
  });
});
