// The broadcast payload builder.
//
// Only named columns are copied out of the listing, so attendee text can never
// ride along inside a spread object. Unless moderation allowed the content,
// every free-text and media field is replaced by the placeholder: the screen
// shows a generic architectural tile, never the attendee's words or photo.

import { MODERATION_PLACEHOLDER, type ModerationVerdict } from './index';

export interface ListingContent {
  headline?: string | null;
  bedrooms?: number | null;
  rent_pcm?: number | null;
  currency?: string | null;
  photo_url?: string | null;
}

export interface BroadcastListing {
  venue_id: string;
  listing_id: string;
  correlation_id: string | null;
  headline: string;
  bedrooms: number | null;
  rent_pcm: number | null;
  currency: string | null;
  photo_url: string | null;
  moderation: 'allow' | 'block' | 'unavailable' | 'not_checked';
}

export function redactListing(
  input: {
    venue_id: string;
    listing_id: string;
    correlation_id?: string | null;
    listing: ListingContent;
  },
  v: ModerationVerdict | null
): BroadcastListing {
  const allowed = v?.allow === true;
  return {
    venue_id: input.venue_id,
    listing_id: input.listing_id,
    correlation_id: input.correlation_id ?? null,
    headline: allowed && input.listing.headline ? input.listing.headline : MODERATION_PLACEHOLDER,
    bedrooms: allowed ? input.listing.bedrooms ?? null : null,
    rent_pcm: allowed ? input.listing.rent_pcm ?? null : null,
    currency: allowed ? input.listing.currency ?? null : null,
    photo_url: allowed ? input.listing.photo_url ?? null : null,
    moderation: v?.state ?? 'not_checked'
  };
}
