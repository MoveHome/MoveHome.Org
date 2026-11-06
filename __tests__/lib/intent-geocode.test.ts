import { describe, expect, it } from 'vitest';
import { geocodeLocation } from '@/lib/intent/geocode';
import { runIntentPipeline } from '@/lib/intent';

// MUST-FAIL: an ungeocodable caption is flagged unavailable with NULL coordinates.
// No jitter, no random offset, no venue pin — zero fabricated location data.
describe('intent geocode rail', () => {
  it('marks "near the park" unavailable and invents no latitude/longitude', () => {
    const rail = geocodeLocation(undefined, '3 bed near the park');

    expect(rail.location_unavailable).toBe(true);
    expect(rail.latitude).toBeNull();
    expect(rail.longitude).toBeNull();
    expect(rail.precision).toBe('none');
  });

  it('is deterministic: the same caption always yields the same outcode pin', () => {
    const first = geocodeLocation(undefined, '2 bed on Baker St');
    const second = geocodeLocation(undefined, '2 bed on Baker St');

    expect(first).toEqual(second);
    expect(first.outcode).toBe('W1');
    expect(first.precision).toBe('outcode');
    expect(first.location_unavailable).toBe(false);
  });

  it('carries location_unavailable and NULL coordinates through the pipeline', async () => {
    const result = await runIntentPipeline({ text: '3 bed near the park' });

    expect(result.location_unavailable).toBe(true);
    expect(result.latitude).toBeNull();
    expect(result.longitude).toBeNull();
  });
});
