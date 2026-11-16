import { describe, expect, it } from 'vitest';
import type { Listing } from '@/lib/types';
import {
  clusterOf,
  plainText,
  priceLabel,
  specGroups,
  statusLabel,
  viewingSlots
} from '@/lib/property-card';

function listing(over: Partial<Listing> = {}): Listing {
  return {
    raia_id: 'prop-th-bkk-lifeone-0001',
    agent_id: 'agent-1',
    service_type: 'long_term',
    currency: 'THB',
    rent_pcm: 34000,
    jurisdiction: 'TH',
    un_locode: 'THBKK',
    suburb: 'Phloen Chit',
    listing_status: 'available',
    photos: [],
    features: [],
    ...over
  } as unknown as Listing;
}

describe('priceLabel', () => {
  it('renders Thai rent per month', () => {
    expect(priceLabel(listing())).toBe('฿34,000/mo');
  });

  it('renders UK rent pcm', () => {
    expect(priceLabel(listing({ currency: 'GBP', rent_pcm: 1764, jurisdiction: 'GB', un_locode: 'GBLON' }))).toBe(
      '£1,764 pcm'
    );
  });

  it('falls back when no price', () => {
    expect(priceLabel(listing({ rent_pcm: null }))).toBe('Price on application');
  });
});

describe('specGroups', () => {
  it('drops nulls instead of rendering NA', () => {
    expect(specGroups(listing({ bedrooms: 1, bathrooms: null, floor_area_sqm: null, floor: null }))).toEqual([
      '1 Bed ✓'
    ]);
  });

  it('groups rooms and size', () => {
    expect(specGroups(listing({ bedrooms: 1, bathrooms: 1, floor_area_sqm: 38, floor: 41 }))).toEqual([
      '1 Bed · 1 Bath ✓',
      '38 m² · Fl 41 ✓'
    ]);
  });
});

describe('statusLabel', () => {
  it('marks an available listing vacant now', () => {
    expect(statusLabel(listing())).toBe('🟢 Vacant · Available Now');
  });

  it('shows a future availability date', () => {
    const future = new Date(Date.now() + 30 * 864e5).toISOString();
    expect(statusLabel(listing({ available_from: future }))).toMatch(/^Available \d{1,2} \w{3}$/);
  });
});

describe('clusterOf', () => {
  it('matches the Bangkok cluster', () => {
    expect(clusterOf(listing())).toBe('bkk');
  });

  it('matches the London cluster by postcode', () => {
    expect(
      clusterOf(
        listing({ currency: 'GBP', jurisdiction: 'GB', un_locode: 'GBLON', suburb: null, postcode_district: 'E14' })
      )
    ).toBe('lon');
  });

  it('returns other for elsewhere', () => {
    expect(clusterOf(listing({ currency: 'USD', jurisdiction: 'US', un_locode: 'USNYC' }))).toBe('other');
  });
});

describe('viewingSlots', () => {
  it('offers 12 future slots', () => {
    const now = new Date('2026-06-01T09:00:00Z');
    const slots = viewingSlots(now);
    expect(slots).toHaveLength(12);
    expect(new Date(slots[0].iso).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('plainText', () => {
  it('strips markup and collapses whitespace', () => {
    expect(plainText('<p>Bright   <b>flat</b></p>')).toBe('Bright flat');
    expect(plainText(null)).toBe('');
  });
});
