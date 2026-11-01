import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

// DRY_RUN is derived from argv at require time; run the require as a write run.
process.argv = ['node', 'scripts/raia-protocol-crawl.cjs', '--write'];

const require = createRequire(import.meta.url);
const { upsertListing, setClient } = require('../../../scripts/raia-protocol-crawl.cjs') as {
  upsertListing: (row: Record<string, unknown>) => Promise<void>;
  setClient: (client: unknown) => void;
};
const { normaliseListing } = require('../../../scripts/lib/raia-protocol-listing-mapper.cjs') as {
  normaliseListing: (
    listing: Record<string, unknown>,
    ctx: Record<string, unknown>,
  ) => { row: Record<string, unknown>; warnings: string[] };
};

type UpsertCall = { table: string; row: Record<string, unknown>; onConflict: string };

let calls: UpsertCall[] = [];

// In-memory stand-in for the Supabase table builder; records the exact write body.
function fakeClient() {
  return {
    from(table: string) {
      return {
        upsert(row: Record<string, unknown>, opts: { onConflict: string }) {
          calls.push({ table, row, onConflict: opts.onConflict });
          return {
            select: () => ({
              maybeSingle: async () => ({ data: { external_id: 'ext-1' }, error: null }),
            }),
          };
        },
      };
    },
  };
}

const CTX = {
  agent_id: 'org-gb-rlf',
  agent_card_url: 'https://agents.example/.well-known/raia-agent.json',
  schema_version: '0.2',
};

function payload(listingStatus: string) {
  return {
    raia_id: 'prop-gb-rlf-000427',
    agent_id: 'org-gb-rlf',
    agent_card_url: CTX.agent_card_url,
    un_locode: 'GBLON',
    service_type: 'long_term',
    synced_at: '2026-11-01T10:00:00Z',
    headline: 'Two bed riverside flat',
    marketing_description: 'Bright flat with river views.',
    property_type: 'flat',
    bedrooms: 2,
    bathrooms: 1,
    rent_pcm: 2450,
    currency: 'GBP',
    postcode_full: 'SE1 9AA',
    listing_status: listingStatus,
    visibility: 'public',
    media: { photos: [{ url: 'https://cdn.example/1.jpg', order: 1 }] },
    provenance: { source: 'rlf' },
  };
}

beforeEach(() => {
  calls = [];
  setClient(fakeClient());
});

describe('MoveHome re-crawl status truth (F11)', () => {
  it('propagates available -> let_agreed for the same agent_id,raia_id', async () => {
    await upsertListing(normaliseListing(payload('available'), CTX).row);
    await upsertListing(normaliseListing(payload('let_agreed'), CTX).row);

    expect(calls).toHaveLength(2);
    expect(calls[1].table).toBe('tbl_external_raia_listings');
    expect(calls[1].onConflict).toBe('agent_id,raia_id');
    // Same conflict key, so the second write replaces the first row in place.
    expect(calls[0].row.agent_id).toBe(calls[1].row.agent_id);
    expect(calls[0].row.raia_id).toBe(calls[1].row.raia_id);
    expect(calls[0].row.listing_status).toBe('available');
    expect(calls[1].row.listing_status).toBe('let_agreed');
  });

  it('upserts the full row, never a partial patch of changed fields', async () => {
    const { row } = normaliseListing(payload('let_agreed'), CTX);
    await upsertListing(row);

    // Body handed to .upsert is the whole mapped row — every column supplied.
    expect(calls[0].row).toEqual(row);
    expect(calls[0].row).toMatchObject({
      source: 'raia_protocol',
      agent_id: 'org-gb-rlf',
      raia_id: 'prop-gb-rlf-000427',
      headline: 'Two bed riverside flat',
      service_type: 'long_term',
      rent_pcm: 2450,
      currency: 'GBP',
      un_locode: 'GBLON',
      listing_status: 'let_agreed',
    });
    // A partial upsert would leave the other columns at their previous values.
    for (const key of Object.keys(row)) expect(calls[0].row).toHaveProperty(key);
  });

  it('passes available and let_agreed through mapping without collapsing them', async () => {
    const available = normaliseListing(payload('available'), CTX).row;
    const letAgreed = normaliseListing(payload('let_agreed'), CTX).row;

    expect(available.listing_status).toBe('available');
    expect(letAgreed.listing_status).toBe('let_agreed');
    expect(letAgreed.listing_status).not.toBe(available.listing_status);
    // Neither status is a withdrawal.
    expect(available.withdrawn_at).toBeNull();
    expect(letAgreed.withdrawn_at).toBeNull();
  });
});
