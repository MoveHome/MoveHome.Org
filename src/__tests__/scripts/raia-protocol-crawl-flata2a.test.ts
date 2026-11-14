import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

// DRY_RUN is derived from argv at require time; run the require as a write run.
process.argv = ['node', 'scripts/raia-protocol-crawl.cjs', '--write'];

const require = createRequire(import.meta.url);

type Summary = {
  agent_id: string;
  status: string;
  listings_seen: number;
  listings_upserted: number;
  listings_rejected: number;
  listings_withdrawn: number;
  error: string | null;
};
type FetchFn = (url: string, opts: Record<string, unknown>) => Promise<unknown>;

const { crawlAgent, setClient, setFetch } = require('../../../scripts/raia-protocol-crawl.cjs') as {
  crawlAgent: (agent: Record<string, unknown>) => Promise<Summary>;
  setClient: (client: unknown) => void;
  setFetch: (fn: FetchFn) => void;
};

const AGENT_CARD_URL = 'https://app.estateaigents.com/.well-known/agent.json';

const FLAT_CARD = {
  name: 'RAIA EA node',
  preferredTransport: 'JSONRPC',
  protocolVersion: '0.3.0',
  url: 'https://app.estateaigents.com/api/a2a',
};

// Verbatim shape of a live EA search_properties item (2026-11-01T21:19Z): A2A
// field names, location.un_locode nesting, no agent_id / service_type / synced_at.
function eaItem(raiaId: string) {
  return {
    raia_id: raiaId,
    raia_version: '0.2',
    agent_card_url: 'https://app.estateaigents.com/.well-known/raia.json',
    transaction_type: 'LETTINGS',
    status: 'LET_AGREED',
    property_type: 'FLAT',
    location: { district: 'SW1W', postcode_district: 'SW1W', un_locode: 'GBLON', lat: null, lng: null },
    headline: '1-bedroom flat to rent in SW1W',
    description: null,
    bedrooms: 1,
    bathrooms: 1,
    floor_area_sqm: null,
    available_from: '2026-10-09',
    // v0.3 price field (live EA shape 2026-11-14): MoveHome stored NULL rent
    // for every EA row while the mapper only read the v0.2 `rent_pcm`.
    asking_rent_pcm: 2882,
    rent_frequency: 'MONTHLY',
    currency: 'GBP',
    epc_rating: 'C',
    features: ['FURNISHED', 'BALCONY'],
    media: { photos: [{ url: 'https://cdn.example/1.jpg', order: 0 }] },
    listing_agent: { name: 'RLF' },
    enquiry_endpoint: 'https://app.estateaigents.com/api/raia/enquire',
    session_ttl_hours: 24,
  };
}

function envelope(props: unknown[]) {
  return {
    jsonrpc: '2.0',
    id: 'crawl-test',
    result: {
      status: { state: 'completed' },
      artifacts: [{ parts: [{ kind: 'data', data: { properties: props } }] }],
    },
  };
}

const LEGACY_CARD = {
  name: 'RAIA RLF node', // schemas/agent-card.json requires it
  agent_id: 'org-gb-rlf',
  schema_version: '0.2',
  endpoints: {
    search: 'https://legacy.example/raia/search',
    property: 'https://legacy.example/raia/property/{raia_id}',
  },
};

// A v0.2 protocol-shaped listing, as v0.1/v0.2 legacy cards publish it.
const LEGACY_LISTING = {
  raia_id: 'prop-gb-rlf-000427',
  agent_id: 'org-gb-rlf',
  agent_card_url: 'https://legacy.example/raia/agent-card.json', // schema-required
  un_locode: 'GBLON',
  service_type: 'long_term',
  synced_at: '2026-01-01T00:00:00Z',
  headline: 'Two bed riverside flat',
  property_type: 'flat',
  rent_pcm: 2450,
  currency: 'GBP',
  listing_status: 'available',
};

let upserts: Record<string, unknown>[] = [];
let staleScans = 0;

// In-memory Supabase stand-in: records upsert bodies and whether the
// stale-listing sweep was queried at all.
function fakeClient() {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    lt: async () => {
      staleScans++;
      return {
        data: [{ external_id: 'stale-1', raia_id: 'prop-gb-rlf-000427', last_seen_at: '2026-10-28T12:54:36Z' }],
        error: null,
      };
    },
    upsert: (row: Record<string, unknown>) => {
      upserts.push(row);
      return { select: () => ({ maybeSingle: async () => ({ data: { external_id: 'ext-1' }, error: null }) }) };
    },
    update: () => ({ in: async () => ({ error: null }) }),
  });
  return { from: () => chain };
}

const flatFetch = (props: unknown[]): FetchFn => async (url: string) =>
  url.includes('/.well-known/') ? FLAT_CARD : envelope(props);

const legacyFetch: FetchFn = async (url: string) => {
  // card URL heuristics: well-known (flat/live shape) or the legacy agent-card.json
  if (url.includes('/.well-known/') || url.includes('agent-card.json')) return LEGACY_CARD;
  if (url.includes('/property/')) return LEGACY_LISTING;
  return ['prop-gb-rlf-000427'];
};

beforeEach(() => {
  upserts = [];
  staleScans = 0;
  setClient(fakeClient());
});

describe('RAIA flat-A2A ingest (F8d)', () => {
  it('maps a real EA flat-card item into a full protocol row', async () => {
    setFetch(flatFetch([eaItem('prop-gb-rlf-000018'), eaItem('prop-gb-rlf-000024')]));
    const summary = await crawlAgent({
      agent_id: 'org-gb-07798821',
      agent_card_url: AGENT_CARD_URL,
      jurisdictions: ['GBLON'],
    });
    expect(summary.error).toBeNull();
    expect(summary.status).toBe('ok');
    expect(summary.listings_seen).toBe(2);
    expect(summary.listings_upserted).toBe(2);
    expect(summary.listings_rejected).toBe(0);
    expect(upserts).toHaveLength(2);
    const row = upserts[0];
    expect(row.agent_id).toBe('org-gb-07798821'); // registry context, not in the item
    expect(row.raia_id).toBe('prop-gb-rlf-000018');
    expect(row.un_locode).toBe('GBLON'); // lifted from location.un_locode
    expect(row.service_type).toBe('long_term'); // LETTINGS
    expect(typeof row.synced_at).toBe('string'); // registry-injected
    expect(Number.isNaN(Date.parse(row.synced_at as string))).toBe(false);
    expect(row.property_type).toBe('flat');
    expect(row.currency).toBe('GBP');
    expect(row.rent_pcm).toBe(2882); // v0.3 asking_rent_pcm
    expect(row.postcode_district).toBe('SW1W'); // v0.3 location.postcode_district
    expect(row.listing_status).toBe('let_agreed'); // v0.3 LET_AGREED -> CHECK-safe enum
    expect(row.photo_url).toBe('https://cdn.example/1.jpg');
    expect(staleScans).toBe(1); // sweep armed only because rows were written
  });

  it('rejects a malformed item and counts it instead of dropping it silently', async () => {
    setFetch(
      flatFetch([
        eaItem('prop-gb-rlf-000018'),
        { raia_id: 'prop-gb-rlf-000999', transaction_type: 'LETTINGS', status: 'LET_AGREED' },
      ]),
    );
    const summary = await crawlAgent({
      agent_id: 'org-gb-07798821',
      agent_card_url: AGENT_CARD_URL,
      jurisdictions: ['GBLON'],
    });
    expect(summary.listings_seen).toBe(2);
    expect(summary.listings_upserted).toBe(1);
    expect(summary.listings_rejected).toBe(1);
    expect(upserts.map((r) => r.raia_id)).toEqual(['prop-gb-rlf-000018']);
  });

  it('does not arm the withdrawal sweep when everything was rejected', async () => {
    setFetch(flatFetch([{ raia_id: 'prop-gb-rlf-000999', transaction_type: 'LETTINGS' }]));
    const summary = await crawlAgent({
      agent_id: 'org-gb-07798821',
      agent_card_url: AGENT_CARD_URL,
      jurisdictions: ['GBLON'],
    });
    expect(summary.listings_seen).toBe(1);
    expect(summary.listings_upserted).toBe(0);
    expect(summary.listings_rejected).toBe(1);
    expect(summary.listings_withdrawn).toBe(0);
    expect(staleScans).toBe(0); // the sweep was never queried
  });

  it('leaves the legacy endpoints.* card path producing the same row', async () => {
    setFetch(legacyFetch);
    const summary = await crawlAgent({
      agent_id: 'org-gb-rlf',
      agent_card_url: 'https://legacy.example/raia/agent-card.json',
      jurisdictions: [],
    });
    expect(summary.status).toBe('ok');
    expect(summary.listings_seen).toBe(1);
    expect(summary.listings_upserted).toBe(1);
    expect(summary.listings_rejected).toBe(0);
    const row = upserts[0];
    expect(row.agent_id).toBe('org-gb-rlf');
    expect(row.raia_id).toBe('prop-gb-rlf-000427');
    expect(row.service_type).toBe('long_term');
    expect(row.un_locode).toBe('GBLON');
    expect(row.synced_at).toBe(LEGACY_LISTING.synced_at); // item's own, not injected
    expect(row.agent_card_url).toBe('https://legacy.example/raia/agent-card.json');
    expect(row.raia_schema_version).toBe('0.2');
    expect(row.rent_pcm).toBe(2450);
  });
});
