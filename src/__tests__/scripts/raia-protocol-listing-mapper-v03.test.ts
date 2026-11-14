import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { normaliseListing, normaliseListingStatus } = require('../../../scripts/lib/raia-protocol-listing-mapper.cjs') as {
  normaliseListing: (l: Record<string, unknown>, ctx: Record<string, unknown>) => { row: Record<string, unknown>; warnings: string[] };
  normaliseListingStatus: (v: unknown, warnings?: string[]) => string | null;
};

const CTX = { agent_id: 'org-gb-07798821', agent_card_url: 'https://app.estateaigents.com/.well-known/agent.json' };

// v0.3 field names as the EA flat A2A card serves them (2026-11-14).
const v03 = (over: Record<string, unknown> = {}) => ({
  raia_id: 'prop-gb-rlf-000427',
  raia_version: '0.3',
  transaction_type: 'LETTINGS',
  status: 'AVAILABLE',
  property_type: 'FLAT',
  location: { district: 'NW7', postcode_district: 'NW7', un_locode: 'GBLON', lat: null, lng: null },
  asking_rent_pcm: 2271,
  rent_frequency: 'MONTHLY',
  currency: 'GBP',
  ...over,
});

describe('listing mapper — RAIA v0.3 fields (MoveHome.Org#56 parity)', () => {
  it('maps asking_rent_pcm, nested postcode_district and upper-case status', () => {
    const { row, warnings } = normaliseListing(v03(), CTX);
    expect(row.rent_pcm).toBe(2271);
    expect(row.currency).toBe('GBP');
    expect(row.postcode_district).toBe('NW7');
    expect(row.listing_status).toBe('available');
    expect(row.withdrawn_at).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('falls back to location.district when postcode_district is absent', () => {
    const { row } = normaliseListing(v03({ location: { district: 'ec1v', un_locode: 'GBLON' } }), CTX);
    expect(row.postcode_district).toBe('EC1V');
  });

  it('prefers the v0.2 top-level fields when both shapes are present', () => {
    const { row } = normaliseListing(v03({ rent_pcm: 2000, postcode_district: 'E2', listing_status: 'under_offer' }), CTX);
    expect(row.rent_pcm).toBe(2000);
    expect(row.postcode_district).toBe('E2');
    expect(row.listing_status).toBe('under_offer');
  });

  it('never puts asking_rent_pcm on a sale', () => {
    const { row } = normaliseListing(v03({ transaction_type: 'SALES', asking_price: 750000 }), CTX);
    expect(row.rent_pcm).toBeNull();
    expect(row.asking_price).toBe(750000);
  });

  it('warns rather than invents when a letting has no rent', () => {
    const { row, warnings } = normaliseListing(v03({ asking_rent_pcm: undefined }), CTX);
    expect(row.rent_pcm).toBeNull();
    expect(warnings).toContain('long_term listing has no rent_pcm');
  });

  it('withdraws on v0.3 WITHDRAWN', () => {
    const { row } = normaliseListing(v03({ status: 'WITHDRAWN' }), CTX);
    expect(row.listing_status).toBe('withdrawn');
    expect(typeof row.withdrawn_at).toBe('string');
  });

  it.each([
    ['AVAILABLE', 'available'],
    ['UNDER_OFFER', 'under_offer'],
    ['RESERVED', 'under_offer'],
    ['SOLD_STC', 'sale_agreed'],
    ['SOLD_STCM', 'sale_agreed'],
    ['LET_AGREED', 'let_agreed'],
    ['OFF_MARKET', 'paused'],
    ['WITHDRAWN', 'withdrawn'],
    ['let_agreed', 'let_agreed'],
  ])('status %s -> %s', (input, expected) => {
    expect(normaliseListingStatus(input)).toBe(expected);
  });

  it('drops an unknown status to NULL with a warning instead of failing the CHECK', () => {
    const warnings: string[] = [];
    expect(normaliseListingStatus('LIVE', warnings)).toBeNull();
    expect(warnings).toEqual(['Unmapped listing status: LIVE']);
  });
});
