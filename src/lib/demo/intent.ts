// Slot-filling seam for the Telegram caption.
//
// Deterministic on purpose: the caption text goes through src/lib/intent/parse
// (price / bedrooms / property type / headline / postcode) and nothing else —
// no model, no network. The model seat and the honest location rail live in
// src/lib/intent and run AROUND this seam; this signature and the `missing`
// marker are frozen contracts, the internals are free.

import { parseListingText, type ParsedListingText, type PropertyType, type ServiceType } from '@/lib/intent/parse';

export type { ParsedListingText, PropertyType, ServiceType };

export interface ListingIntent extends ParsedListingText {
  /** Outcode-level pin from the honest location rail; null when unknown. */
  un_locode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location_unavailable?: boolean;
  /** Slots still needed before anything may be written. */
  missing: string[];
}

export interface IntentInput {
  text?: string | null;
  photo?: unknown;
}

export async function extractListingIntent({ text, photo }: IntentInput): Promise<ListingIntent> {
  const intent: ListingIntent = { ...parseListingText(text), missing: [] };

  // Never a silent partial write: the prompt asks for exactly these.
  if (!photo) intent.missing.push('photo');
  if (intent.rent_pcm === undefined) intent.missing.push('price');
  if (intent.bedrooms === undefined) intent.missing.push('number of bedrooms');
  if (intent.property_type === undefined) intent.missing.push('property type');
  if (!intent.headline) intent.missing.push('a caption');

  return intent;
}
