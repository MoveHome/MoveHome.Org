import { describe, expect, it } from 'vitest';
import type { Listing } from '../lib/types';
import {
  buildPropertyDescriptionWithCta,
  cityOf,
  isVacant,
  isYouTubeUrl,
  locationsOf,
  priceGbp,
  specGroups,
  statusLabel,
  titleOf,
  youtubeIdOf
} from '../lib/property-card';

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
    expect(statusLabel(listing({ listing_status: 'let_agreed' }))).toBe('Let Agreed · Register Interest');
  });

  it('returns bare spec groups (the ✓ is rendered by the HUD)', () => {
    expect(specGroups(listing({ bedrooms: 2, bathrooms: 1, floor_area_sqm: 30 }))).toEqual([
      '2 Bed · 1 Bath',
      '30 m²'
    ]);
  });

  it('labels locations in plain English, never locodes', () => {
    expect(cityOf(listing({ un_locode: 'GBLON' }))).toBe('London');
    expect(locationsOf(listing({ un_locode: 'THBKK', suburb: 'Thonglor' }))).toEqual([
      'Bangkok',
      'Thonglor'
    ]);
    expect(locationsOf(listing({ un_locode: 'GBLON', suburb: 'Fulham' }))).not.toContain('GBLON');
  });

  it('converts THB to a GBP monthly figure for the budget filter', () => {
    expect(priceGbp(listing({ rent_pcm: 2000, currency: 'GBP' }))).toBe(2000);
    expect(priceGbp(listing({ rent_pcm: 45_000, currency: 'THB' }))).toBe(1000);
    expect(priceGbp(listing({ service_type: 'sale', asking_price: 500_000, currency: 'GBP' }))).toBe(
      500_000
    );
  });
});

describe('buildPropertyDescriptionWithCta', () => {
  const base = listing({
    headline: 'Modern flat in Camden',
    rent_pcm: 500,
    currency: 'GBP',
    suburb: 'Camden',
    listing_status: 'available',
    marketing_description:
      '<p>A bright two-bedroom flat. Call us on 07700 900123 or see https://agent.example/xyz</p>'
  });

  it('sanitises the description and closes on price + vendor CTA', () => {
    const text = buildPropertyDescriptionWithCta(base, 'RentLondonFlat.com Ltd');
    expect(text).toContain('A bright two-bedroom flat.');
    expect(text).not.toContain('07700');
    expect(text).not.toContain('https://agent.example');
    expect(text).toContain('And all this is only £500 pcm.');
    expect(text.endsWith('Just send a message to RentLondonFlat.com Ltd to arrange a viewing!')).toBe(
      true
    );
  });

  it('falls back to the listing agent when no vendor name is known', () => {
    expect(buildPropertyDescriptionWithCta(base)).toContain(
      'Just send a message to the listing agent to arrange a viewing!'
    );
    expect(buildPropertyDescriptionWithCta(base, '  ')).toContain('the listing agent');
  });

  it('summarises instead of dumping raw spec fields when there is no description', () => {
    const text = buildPropertyDescriptionWithCta(
      listing({
        headline: 'Modern flat in Camden',
        suburb: 'Camden',
        bedrooms: 2,
        bathrooms: 1,
        rent_pcm: 500,
        currency: 'GBP',
        listing_status: 'available'
      }),
      'Acme Lettings'
    );
    expect(text).toContain('Modern flat in Camden in Camden');
    expect(text).toContain('vacant · available now');
    expect(text).toContain('£500 pcm');
    expect(text).not.toContain('1 bathroom');
  });

  it('truncates long descriptions on a word boundary', () => {
    const text = buildPropertyDescriptionWithCta(
      listing({ ...base, marketing_description: 'spacious '.repeat(100).trim() }),
      'Acme'
    );
    const summary = text.split(' And all this is only')[0];
    expect(summary.endsWith('…')).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(482);
    expect(summary).toMatch(/spacious…$/);
  });

  it('skips the price sentence when the listing has no price', () => {
    const text = buildPropertyDescriptionWithCta(
      listing({ raia_id: 'prop-gb-lon-studio-0001', marketing_description: 'A lovely studio.', currency: 'GBP' }),
      'Acme'
    );
    expect(text).not.toContain('Price on application');
    expect(text).toBe('A lovely studio. Just send a message to Acme to arrange a viewing!');
  });
});

describe('youtubeIdOf', () => {
  it('extracts the id from every YouTube URL shape', () => {
    expect(youtubeIdOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeIdOf('https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=10')).toBe(
      'dQw4w9WgXcQ'
    );
    expect(youtubeIdOf('https://youtu.be/dQw4w9WgXcQ?si=abc')).toBe('dQw4w9WgXcQ');
    expect(youtubeIdOf('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('rejects direct video files and missing urls', () => {
    expect(youtubeIdOf('https://cdn.example/tour.mp4')).toBeNull();
    expect(isYouTubeUrl('https://cdn.example/tour.mp4')).toBe(false);
    expect(isYouTubeUrl(null)).toBe(false);
  });
});
