import { describe, expect, it } from 'vitest';
import { ttsLocaleOf, voiceMatchesGender } from '@/lib/property-card';
import type { Listing } from '@/lib/types';

const listing = (overrides: Partial<Listing> = {}): Listing =>
  ({ raia_id: 'prop-gb-london-abcd-1234', currency: 'GBP', ...overrides }) as Listing;

// The card, the deck prefetch and the browser fallback all read these helpers,
// so a market's own voice is reachable from one place.
describe('ttsLocaleOf', () => {
  it('maps every supported market from jurisdiction', () => {
    expect(ttsLocaleOf(listing({ jurisdiction: 'GB' }))).toBe('en-GB');
    expect(ttsLocaleOf(listing({ jurisdiction: 'TH' }))).toBe('th-TH');
    expect(ttsLocaleOf(listing({ jurisdiction: 'MY' }))).toBe('ms-MY');
    expect(ttsLocaleOf(listing({ jurisdiction: 'JP' }))).toBe('ja-JP');
  });

  it('falls back to un_locode then currency', () => {
    expect(ttsLocaleOf(listing({ un_locode: 'MYKUL' }))).toBe('ms-MY');
    expect(ttsLocaleOf(listing({ un_locode: 'JPKYO' }))).toBe('ja-JP');
    expect(ttsLocaleOf(listing({ currency: 'MYR' }))).toBe('ms-MY');
    expect(ttsLocaleOf(listing({ currency: 'JPY' }))).toBe('ja-JP');
    expect(ttsLocaleOf(listing({}))).toBe('en-GB');
  });

  it('respects country resolution priority (un_locode/currency before default jurisdiction GB)', () => {
    // When jurisdiction is default 'GB' but un_locode or currency indicates MY/TH, countryOf resolves to MY/TH.
    expect(ttsLocaleOf(listing({ jurisdiction: 'GB', un_locode: 'MYKUL' }))).toBe('ms-MY');
    expect(ttsLocaleOf(listing({ jurisdiction: 'GB', currency: 'THB' }))).toBe('th-TH');
  });
});

describe('voiceMatchesGender', () => {
  const names = ['Google UK English Female', 'Google UK English Male', 'Google ไทย'];

  it('never matches a female voice as male', () => {
    expect(names.filter((n) => voiceMatchesGender(n, 'male'))).toEqual(['Google UK English Male']);
    expect(names.filter((n) => voiceMatchesGender(n, 'female'))).toEqual(['Google UK English Female']);
  });

  it('matches locale-agnostic named voices', () => {
    expect(voiceMatchesGender('Daniel', 'male')).toBe(true);
    expect(voiceMatchesGender('Samantha', 'female')).toBe(true);
    expect(voiceMatchesGender('Google ไทย', 'male')).toBe(false);
  });
});
