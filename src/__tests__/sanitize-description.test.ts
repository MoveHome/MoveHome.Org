import { describe, expect, it } from 'vitest';
import { sanitizeDescription as sanitizeTs } from '../lib/sanitize-description';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sanitizeDescription: sanitizeCjs } = require('../../scripts/lib/sanitize-description.cjs');

describe('sanitizeDescription', () => {
  it('strips broker shortlinks (bit.ly, wa.me) and phone numbers', () => {
    const input = `🛌 4 Bedrooms
🚿 5 Bathrooms
🏬 3rd Floor
📏 Size 430 Sq.m

Sale Price 42 MB

📍Bugaan Krungthep Kreetha is conveniently located just within 2.3 km or about 10 minutes by car from MRT Yaek Lam Sali

☎️ Contact us https://bit.ly/throneproperty-contact
Call 020 7946 0958 or wa.me/447700900123`;

    const expected = `4 Bedrooms
5 Bathrooms
3rd Floor
Size 430 Sq.m

Sale Price 42 MB

Bugaan Krungthep Kreetha is conveniently located just within 2.3 km or about 10 minutes by car from MRT Yaek Lam Sali`;

    expect(sanitizeTs(input)).toBe(expected);
    expect(sanitizeCjs(input)).toBe(expected);
  });

  it('preserves room counts, prices, floor numbers and distances', () => {
    const input = '2 bed, 1 bath. Price £2,000 pcm. Year 2024. 0.5 km to station.';
    expect(sanitizeTs(input)).toBe(input);
  });

  it('handles null and undefined gracefully', () => {
    expect(sanitizeTs(null)).toBe('');
    expect(sanitizeTs(undefined)).toBe('');
    expect(sanitizeCjs(null)).toBe('');
  });
});
