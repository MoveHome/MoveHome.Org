// Publication gate + registry hygiene. The DB is stubbed with a thenable query
// builder so the gate's decisions (and nothing about SQL) are under test.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type DbResult = { data?: unknown; error?: { message: string } | null; count?: number };
const responses: Record<string, DbResult> = {};

function chainFor(table: string) {
  const result = (): DbResult => responses[table] ?? { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'contains', 'or', 'order', 'range', 'limit', 'in']) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = async () => result();
  chain.single = async () => result();
  chain.then = (resolve: (v: DbResult) => unknown) => resolve(result());
  return chain;
}

vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => ({ from: (table: string) => chainFor(table) })
}));

const { isDirectoryEntityPublic } = await import('@/lib/registry/publication');
const { isOrganisationAgent, listAgents } = await import('@/lib/registry/store');
const A2A = 'tbl_a2a_registry';
const RAIA = 'tbl_raia_agent_registry';
const VIEW = 'vw_a2a_registry_public';

beforeEach(() => {
  for (const key of Object.keys(responses)) delete responses[key];
});

describe('isDirectoryEntityPublic', () => {
  it('is false for a staged row (throne/shannon shape)', async () => {
    responses[A2A] = { data: null, error: null };
    responses[RAIA] = { data: null, error: null };
    await expect(isDirectoryEntityPublic('agt-gb-shannon')).resolves.toBe(false);
  });

  it('is true for a published A2A row keyed by raw_card.agent_id (org-gb-rlf)', async () => {
    responses[A2A] = { data: [{ id: 'row-1' }], error: null };
    responses[RAIA] = { data: null, error: null };
    await expect(isDirectoryEntityPublic('org-gb-rlf')).resolves.toBe(true);
  });

  it('is true for an approved, non-revoked RAIA row', async () => {
    responses[A2A] = { data: null, error: null };
    responses[RAIA] = { data: { verification_status: 'approved', revoked_at: null }, error: null };
    await expect(isDirectoryEntityPublic('org-gb-07798821')).resolves.toBe(true);
  });

  it('is false for a revoked RAIA row', async () => {
    responses[A2A] = { data: null, error: null };
    responses[RAIA] = {
      data: { verification_status: 'approved', revoked_at: '2026-11-01T22:52:24+00:00' },
      error: null
    };
    await expect(isDirectoryEntityPublic('org-th-0105561135324')).resolves.toBe(false);
  });

  it('stays true when two published A2A rows share the agent_id', async () => {
    responses[A2A] = { data: [{ id: 'row-1' }, { id: 'row-2' }], error: null };
    responses[RAIA] = { data: null, error: null };
    await expect(isDirectoryEntityPublic('org-gb-rlf')).resolves.toBe(true);
  });

  it('is false for an empty A2A result set', async () => {
    responses[A2A] = { data: [], error: null };
    responses[RAIA] = { data: null, error: null };
    await expect(isDirectoryEntityPublic('org-gb-throne')).resolves.toBe(false);
  });

  it('fails closed and warns once on a DB error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    responses[A2A] = { data: null, error: { message: 'boom' } };
    responses[RAIA] = { data: null, error: null };
    await expect(isDirectoryEntityPublic('org-gb-07798821')).resolves.toBe(false);
    await expect(isDirectoryEntityPublic('org-gb-07798821')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('rejects ids that are not safe PostgREST filter values', async () => {
    await expect(isDirectoryEntityPublic('org-gb-rlf%2Cor')).resolves.toBe(false);
  });
});

describe('registry listing hygiene', () => {
  // Shape of the seeded Shannon row: generic property categories, individual
  // agent card served at /agent/agt-gb-shannon/agent.json.
  const shannon = {
    id: '2',
    slug: 'shannon',
    name: 'Shannon Agent',
    provider_org: 'Shannon',
    well_known_uri: 'https://movehome.org/agent/agt-gb-shannon/agent.json',
    categories: ['property', 'real-estate', 'letting', 'rent', 'estate', 'flat'],
    description: null,
    a2a_url: 'https://movehome.org/api/a2a',
    protocol_version: '0.3.0',
    preferred_transport: null,
    capabilities: null,
    skills: [],
    icon_url: null,
    documentation_url: null,
    signature_verified: true,
    locations: null,
    service_types: null,
    domain_verified: false,
    is_healthy: null,
    last_health_check: null,
    last_response_ms: null,
    avg_response_ms: null,
    uptime_percentage: null,
    task_conformance: null,
    created_at: '2026-11-16T00:00:00Z',
    updated_at: '2026-11-16T00:00:00Z',
    last_synced_at: null
  };
  const partner = {
    ...shannon,
    id: '1',
    slug: 'rentlondonflat-com-ltd',
    name: 'RentLondonFlat.com Ltd Agent',
    provider_org: 'RentLondonFlat.com Ltd',
    well_known_uri: 'https://movehome.org/agent/org-gb-rlf/agent.json'
  };

  it('does not treat an individual negotiator card as an organisation', () => {
    expect(isOrganisationAgent(shannon)).toBe(false);
    expect(isOrganisationAgent(partner)).toBe(true);
  });

  it('keeps the negotiator card out of the /registry org list', async () => {
    responses[VIEW] = { data: [partner, shannon], count: 2, error: null };
    const { agents } = await listAgents({ orgOnly: true, limit: 24, offset: 0 });
    expect(agents.map((a) => a.slug)).toEqual(['rentlondonflat-com-ltd']);
  });

  it('dedupes organisation cards sharing provider_org, preferring the canonical slug', async () => {
    const partner2 = {
      ...partner,
      id: '3',
      slug: 'rentlondonflat-com-ltd-07798821',
      well_known_uri: 'https://movehome.org/agent/org-gb-07798821/agent.json',
      // Live ordering is created_at DESC: the CH-suffixed duplicate is the newer row.
      created_at: '2026-11-17T00:00:00Z'
    };
    responses[VIEW] = { data: [partner2, partner], count: 2, error: null };
    const { agents } = await listAgents({ orgOnly: true, limit: 24, offset: 0 });
    expect(agents.map((a) => a.slug)).toEqual(['rentlondonflat-com-ltd']);
  });
});
