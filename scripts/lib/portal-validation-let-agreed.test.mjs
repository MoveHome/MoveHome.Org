// node --test scripts/lib/portal-validation-let-agreed.test.mjs
//
// Owner decision 2026-10-28: a Let Agreed card is published price-less, so the
// feed must accept a LETTINGS payload without asking_rent_pcm for LET_AGREED and
// still reject it for every other status. Node strips the TS types on import.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListingPayload } from '../../src/lib/portal/validation.ts';

const base = {
  kind: 'residential',
  transaction_type: 'LETTINGS',
  status: 'LET_AGREED',
  property_type: 'FLAT',
  headline: '2-bed flat, Mill Hill NW7',
  address: { display_address: '13 Medawar Drive', postcode: 'NW7 1WG', country: 'GB' }
};

test('a LET_AGREED letting is accepted with no asking rent', () => {
  const r = parseListingPayload({ ...base });
  assert.equal(r.ok, true);
});

test('a LET_AGREED letting that still carries a rent is accepted', () => {
  const r = parseListingPayload({ ...base, asking_rent_pcm: 2271, currency: 'GBP' });
  assert.equal(r.ok, true);
});

test('an AVAILABLE letting with no asking rent is still rejected', () => {
  const r = parseListingPayload({ ...base, status: 'AVAILABLE' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'asking_rent_pcm'));
});

test('a SALES listing with no asking price is still rejected', () => {
  const r = parseListingPayload({ ...base, transaction_type: 'SALES', status: 'SOLD_STC' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'asking_price'));
});
