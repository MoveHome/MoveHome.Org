import { describe, expect, it } from 'vitest';
import type { Listing } from '../lib/types';
import {
  buildPropertyDescriptionWithCta,
  catalogCities,
  cityOf,
  countryOf,
  isVacant,
  isYouTubeUrl,
  locationsOf,
  priceGbp,
  priceMyr,
  priceThb,
  resolveDefaultCountry,
  specGroups,
  statusLabel,
  titleOf,
  youtubeIdOf
} from '../lib/property-card';

const listing = (over: Partial<Listing> = {}): Listing =>
  ({ photos: [], service_type: 'long_term', ...over }) as Listing;

describe('property-card helpers', () => {
  it('detects countryOf from jurisdiction, un_locode, and currency', () => {
    expect(countryOf(listing({ jurisdiction: 'GB' }))).toBe('GB');
    expect(countryOf(listing({ un_locode: 'THBKK' }))).toBe('TH');
    expect(countryOf(listing({ currency: 'THB' }))).toBe('TH');
    expect(countryOf(listing({ currency: 'USD' }))).toBeNull();
  });

  it('resolves default country from IP header', () => {
    expect(resolveDefaultCountry('TH')).toBe('TH');
    expect(resolveDefaultCountry('th')).toBe('TH');
    expect(resolveDefaultCountry('GB')).toBe('GB');
    expect(resolveDefaultCountry(null)).toBe('GB');
    expect(resolveDefaultCountry('US')).toBe('GB');
  });

  it('calculates priceThb accurately in native THB or GBP fallback', () => {
    expect(priceThb(listing({ rent_pcm: 30000, currency: 'THB' }))).toBe(30000);
    expect(priceThb(listing({ rent_pcm: 1000, currency: 'GBP' }))).toBe(45000);
  });
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

  it('covers all three CRAM jurisdictions', () => {
    expect(resolveDefaultCountry('MY')).toBe('MY');
    expect(resolveDefaultCountry('my')).toBe('MY');
    expect(countryOf(listing({ currency: 'MYR' }))).toBe('MY');
    expect(cityOf(listing({ un_locode: 'MYKUL' }))).toBe('Kuala Lumpur');
    expect(cityOf(listing({ un_locode: 'GBXYZ' }))).toBe('UK');
    // UN/LOCODE prefix beats currency, and codes follow UNECE, not guesses.
    expect(countryOf(listing({ un_locode: 'GBLON', currency: 'MYR' }))).toBe('GB');
    expect(cityOf(listing({ un_locode: 'GBLON', currency: 'MYR' }))).toBe('London');
    expect(cityOf(listing({ un_locode: 'GBBHX' }))).toBe('Birmingham');
    expect(cityOf(listing({ un_locode: 'GBBSH' }))).toBe('Brighton');
    expect(cityOf(listing({ un_locode: 'GBBRF' }))).toBe('Bradford');
    expect(cityOf(listing({ un_locode: 'MYZCA' }))).toBe('Cyberjaya');
    expect(cityOf(listing({ un_locode: 'MYSUB' }))).toBe('Subang Jaya');
    // Pickable before any listing exists in that city, alphabetical.
    const gb = catalogCities('GB');
    expect(gb).toContain('London');
    expect(gb).toEqual([...gb].sort((a, b) => a.localeCompare(b)));
  });

  it('calculates priceMyr in native MYR or GBP fallback', () => {
    expect(priceMyr(listing({ rent_pcm: 4500, currency: 'MYR' }))).toBe(4500);
    expect(priceMyr(listing({ rent_pcm: 1000, currency: 'GBP' }))).toBe(5600);
    expect(priceMyr(listing({ service_type: 'short_term', daily_rate: 150, currency: 'MYR' }))).toBe(
      4500
    );
  });

  it('converts THB to a GBP monthly figure for the budget filter', () => {
    expect(priceGbp(listing({ rent_pcm: 2000, currency: 'GBP' }))).toBe(2000);
    expect(priceGbp(listing({ rent_pcm: 45_000, currency: 'THB' }))).toBe(1000);
    expect(priceGbp(listing({ service_type: 'sale', asking_price: 500_000, currency: 'GBP' }))).toBe(
      500_000
    );
    expect(priceGbp(listing({ rent_pcm: 33_600, currency: 'MYR' }))).toBe(6000);
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

  it('truncates long descriptions on a word boundary including price and CTA within cap', () => {
    const text = buildPropertyDescriptionWithCta(
      listing({ ...base, marketing_description: 'spacious '.repeat(100).trim() }),
      'Acme'
    );
    expect(text.length).toBeLessThanOrEqual(480);
    expect(text).toContain('And all this is only £500 pcm.');
    expect(text).toContain('Just send a message to Acme to arrange a viewing!');
  });

  it('includes the price sentence using priceLabel even when listing has no numeric price', () => {
    const text = buildPropertyDescriptionWithCta(
      listing({ raia_id: 'prop-gb-lon-studio-0001', marketing_description: 'A lovely studio.', currency: 'GBP' }),
      'Acme'
    );
    expect(text).toContain('And all this is only Price on application.');
    expect(text).toBe('A lovely studio. And all this is only Price on application. Just send a message to Acme to arrange a viewing!');
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
