import { describe, expect, it } from 'vitest';
import type { Listing } from '../lib/types';
import { isVacant, specGroups, statusLabel, titleOf } from '../lib/property-card';

const listing = (over: Partial<Listing> = {}): Listing =>
  ({ photos: [], service_type: 'long_term', ...over }) as Listing;

describe('property-card helpers', () => {
  it('splits the run-together "2-bedflat" headline typo', () => {
    expect(titleOf(listing({ headline: 'Modern 2-bedflat in Camden' }))).toBe(
      'Modern 2-bed flat in Camden'
    );
  });

  it('reports vacancy and renders it without emoji', () => {
    expect(isVacant(listing({ listing_status: 'available' }))).toBe(true);
    expect(statusLabel(listing({ listing_status: 'available' }))).toBe('Vacant · Available Now');
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    expect(isVacant(listing({ listing_status: 'available', available_from: future }))).toBe(false);
    expect(statusLabel(listing({ listing_status: 'let_agreed' }))).toBe('let agreed');
  });

  it('returns bare spec groups (the ✓ is rendered by the HUD)', () => {
    expect(specGroups(listing({ bedrooms: 2, bathrooms: 1, floor_area_sqm: 30 }))).toEqual([
      '2 Bed · 1 Bath',
      '30 m²'
    ]);
  });
});
