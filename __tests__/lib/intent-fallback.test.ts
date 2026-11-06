import { describe, expect, it, beforeEach } from 'vitest';
import { extractListingIntent } from '@/lib/demo/intent';
import { geocodeLocation } from '@/lib/intent/geocode';
import { runIntentPipeline } from '@/lib/intent';
import { parseListingText } from '@/lib/intent/parse';

// MUST-PASS: the deterministic fallback parser alone gets beds, price and the
// outcode out of a caption with the model switched off.
describe('intent fallback parser (model off)', () => {
  beforeEach(() => {
    delete process.env.RLF_GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  it('reads bedrooms, rent and the postcode from "2-bed flat on Baker St, £2,600/mo"', () => {
    const caption = '2-bed flat on Baker St, £2,600/mo';
    const parsed = parseListingText(caption);

    expect(parsed.bedrooms).toBe(2);
    expect(parsed.rent_pcm).toBe(2600);
    expect(parsed.property_type).toBe('flat');
    expect(parsed.currency).toBe('GBP');
    expect(geocodeLocation(parsed.postcode, caption).outcode).toBe('W1');
  });

  it('reads a spaced bedroom count and a full postcode', () => {
    const parsed = parseListingText('2 bed flat W1A 1AA £3,200 pcm');
    expect(parsed.bedrooms).toBe(2);
    expect(parsed.rent_pcm).toBe(3200);
    expect(parsed.postcode).toBe('W1A 1AA');
    expect(geocodeLocation(parsed.postcode, '').outcode).toBe('W1');
  });

  it('completes the whole listing through the seam with no model at all', async () => {
    const intent = await extractListingIntent({ text: '£1500 2 bed flat in Shoreditch', photo: [{ file_id: 'p' }] });
    expect(intent).toMatchObject({ rent_pcm: 1500, bedrooms: 2, property_type: 'flat' });
    expect(intent.missing).toEqual([]);
  });

  it('runs the pipeline end to end with the fallback when the model is absent', async () => {
    const result = await runIntentPipeline({ text: '2-bed flat on Baker St, £2,600/mo' });

    expect(result).toMatchObject({ bedrooms: 2, rent_pcm: 2600, llm_used: false });
    expect(result.latitude).toBeCloseTo(51.5154, 3);
    expect(result.location_unavailable).toBe(false);
  });
});
