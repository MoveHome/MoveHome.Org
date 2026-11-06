// The emit path: the ONE place a demo listing may reach the big screen.
//
// Consent is checked here, not only in the UI, so a UI bypass cannot broadcast.
// Nothing is processed before consent: a pending or declined row returns
// emitted:false without calling the classifier or the publisher.

import { moderate, type ModerationVerdict } from '@/lib/moderation';
import { redactListing, type BroadcastListing, type ListingContent } from '@/lib/moderation/redact';

export type ConsentState = 'pending' | 'granted' | 'declined';

export interface EmitInput {
  venue_id: string;
  listing_id: string;
  consent_state: ConsentState;
  correlation_id?: string | null;
  listing: ListingContent;
  /** Photo bytes for vision moderation; never persisted by this module. */
  photo?: { mime_type: string; data_base64: string } | null;
  fixture_id?: string | null;
}

export type Publish = (payload: BroadcastListing) => unknown;

export interface EmitResult {
  emitted: boolean;
  reason: 'ok' | 'consent_not_granted' | 'moderation_not_allowed';
  payload: BroadcastListing;
  verdict: ModerationVerdict | null;
}

export async function emitListing(input: EmitInput, publish: Publish): Promise<EmitResult> {
  // Consent precedes processing: no classifier call and no content in the payload.
  if (input.consent_state !== 'granted') {
    return {
      emitted: false,
      reason: 'consent_not_granted',
      payload: redactListing(input, null),
      verdict: null
    };
  }

  const verdict = await moderate({
    text: input.listing.headline ?? null,
    image: input.photo ?? null,
    fixture_id: input.fixture_id ?? null
  });
  const payload = redactListing(input, verdict);
  if (!verdict.allow) {
    // Fail closed: the row stays a draft. The screen keeps its architectural
    // placeholder tile — nothing at all is published for this listing.
    return { emitted: false, reason: 'moderation_not_allowed', payload, verdict };
  }

  await publish(payload);
  return { emitted: true, reason: 'ok', payload, verdict };
}
