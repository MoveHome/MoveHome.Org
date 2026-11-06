// The intent pipeline. The order is the contract:
//   1. the deterministic parse (frozen seam) is the result of record;
//   2. the honest location rail is attached — NULLs, never a made-up pin;
//   3. the optimistic listing.received ping fires BEFORE the model is awaited;
//   4. the model is optional and best effort: a single attempt capped at 1200 ms
//      (TIMEOUT_MS in llm.ts) and it may only fill slots the parse left empty.
// A missing key, a timeout or a 429 leaves the parse result untouched.

import { extractListingIntent, type ListingIntent } from '@/lib/demo/intent';
import { broadcastListingReceived } from '@/lib/demo/realtime';
import { geocodeLocation } from '@/lib/intent/geocode';
import { extractWithLlm } from '@/lib/intent/llm';
import { parseListingText } from '@/lib/intent/parse';

export interface PipelineInput {
  text: string;
  photo?: { file_id: string };
  /** Present when the caller has already written the row: the ping then carries
   *  the authoritative listing id instead of a correlation-only nudge. */
  venue_id?: string;
  listing_id?: string;
  correlation_id?: string;
}

export interface PipelineResult extends ListingIntent {
  llm_used: boolean;
}

export async function runIntentPipeline(input: PipelineInput): Promise<PipelineResult> {
  const text = (input.text ?? '').trim();

  let intent: ListingIntent;
  try {
    intent = await extractListingIntent({ text, photo: input.photo });
  } catch {
    // the fallback parser is the floor: it cannot throw, so a capture always lands
    intent = { ...parseListingText(text), missing: [] };
  }

  Object.assign(intent, geocodeLocation(intent.postcode, text));

  // Optimistic ping first: the TV never waits on the model.
  if (input.venue_id) {
    await broadcastListingReceived({
      id: input.listing_id ?? '',
      venue_id: input.venue_id,
      headline: intent.headline ?? null,
      bedrooms: intent.bedrooms ?? null,
      rent_pcm: intent.rent_pcm ?? null,
      currency: intent.currency ?? null,
      un_locode: intent.un_locode ?? null,
      correlation_id: input.correlation_id ?? crypto.randomUUID()
    });
  }

  const model = await extractWithLlm(text);

  if (model) {
    // Fill gaps only: a regex price or bedroom count outranks the model.
    intent.headline ??= model.headline;
    intent.property_type ??= model.property_type;
    intent.service_type ??= model.service_type;
    intent.bedrooms ??= model.bedrooms;
    intent.rent_pcm ??= model.rent_pcm;
    intent.currency ??= model.currency;
    intent.postcode ??= model.postcode;
    // the model may have supplied the location the caption never carried
    if (intent.location_unavailable && intent.postcode) {
      Object.assign(intent, geocodeLocation(intent.postcode, text));
    }
  }

  return { ...intent, llm_used: Boolean(model) };
}
