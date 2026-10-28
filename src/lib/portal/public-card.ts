// Derive a public RAIA listing card from a portal-feed payload and write it
// into tbl_external_raia_listings. This is what makes provider-pushed listings
// surface on movehome.org search alongside crawled federated listings.
//
// Triggered on PUT when payload.public_card.publish !== false (default true).
// Removed on DELETE — the row in tbl_external_raia_listings is marked
// withdrawn_at = now().

import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { createHash } from 'node:crypto';
import type { Json } from '@/lib/database.types';
import type { ListingPayloadT } from './validation';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://movehome.org';

function deriveRaiaId(agent_id: string, reference: string, country: string): string {
  // Slug = agent_id without the "org-{cc}-" prefix, lowercased, safe chars.
  const slug = agent_id
    .replace(/^org-[a-z]{2}-/, '')
    .toLowerCase()
    .slice(0, 32);
  // Stable numeric tail derived from reference hash → 8 digits.
  const h = createHash('sha256').update(`${agent_id}|${reference}`).digest('hex');
  const numeric = (parseInt(h.slice(0, 12), 16) % 100_000_000)
    .toString()
    .padStart(8, '0');
  const cc = country.slice(0, 2).toLowerCase();
  return `prop-${cc}-${slug}-${numeric}`;
}

function mapServiceType(payload: ListingPayloadT):
  | 'long_term'
  | 'short_term'
  | 'sale' {
  if (payload.transaction_type === 'SALES') return 'sale';
  if (payload.kind === 'residential') {
    const freq = payload.rent_frequency;
    if (freq === 'WEEKLY') return 'short_term';
  }
  return 'long_term';
}

function mapPropertyType(payload: ListingPayloadT):
  | 'flat' | 'house' | 'studio' | 'commercial' | 'land' | 'other' {
  if (payload.kind === 'commercial') return 'commercial';
  switch (payload.property_type) {
    case 'FLAT':
    case 'APARTMENT':
    case 'MAISONETTE':
      return 'flat';
    case 'STUDIO':
      return 'studio';
    case 'TERRACED':
    case 'END_TERRACE':
    case 'SEMI_DETACHED':
    case 'DETACHED':
    case 'BUNGALOW':
    case 'COTTAGE':
    case 'TOWNHOUSE':
      return 'house';
    case 'LAND':
      return 'land';
    default:
      return 'other';
  }
}

function mapStatus(s: string | undefined | null): string | null {
  if (!s) return 'available';
  switch (s) {
    case 'AVAILABLE':
      return 'available';
    case 'UNDER_OFFER':
      return 'under_offer';
    case 'LET_AGREED':
      return 'let_agreed';
    case 'SOLD_STC':
    case 'SOLD_STCM':
      return 'sale_agreed';
    case 'RESERVED':
      return 'under_offer';
    case 'OFF_MARKET':
      return 'paused';
    case 'WITHDRAWN':
      return 'withdrawn';
    default:
      return null;
  }
}

interface DeriveArgs {
  agent_id: string;
  reference: string;
  payload: ListingPayloadT;
  existingRaiaId?: string | null;
}

export interface DerivedCard {
  raia_id: string;
  public_card_url: string;
}

export async function upsertPublicCard(args: DeriveArgs): Promise<DerivedCard | null> {
  const { payload } = args;

  if (payload.public_card?.publish === false) {
    // Provider opted out → ensure any prior public card is withdrawn.
    if (args.existingRaiaId) {
      await withdrawPublicCard(args.agent_id, args.existingRaiaId);
    }
    return null;
  }

  const country =
    payload.kind === 'residential'
      ? payload.address.country
      : payload.building.address.country;

  const raia_id =
    payload.public_card?.raia_id ||
    args.existingRaiaId ||
    deriveRaiaId(args.agent_id, args.reference, country);

  const suppress = payload.public_card?.suppress_address !== false;

  const address =
    payload.kind === 'residential' ? payload.address : payload.building.address;

  // Headline / description / status / pricing
  const headline =
    payload.kind === 'residential'
      ? payload.headline
      : `${payload.building.primary_classification.classification.replace('_', ' ')} — ${address.display_address}`;

  const marketing_description =
    payload.kind === 'residential'
      ? payload.description ?? null
      : payload.building.description ?? null;

  const listing_status = mapStatus(
    payload.kind === 'residential' ? payload.status : payload.building.status
  );

  // Pricing / currency
  let rent_pcm: number | null = null;
  let asking_price: number | null = null;
  let currency: string | null = null;
  if (payload.kind === 'residential') {
    // Absent price stays null: a Let Agreed card is price-less (owner decision
    // 2026-10-28) and 0 would render as a real, wrong asking rent.
    if (payload.transaction_type === 'LETTINGS') {
      rent_pcm = payload.asking_rent_pcm != null ? Math.round(payload.asking_rent_pcm) : null;
    } else {
      asking_price = payload.asking_price != null ? Math.round(payload.asking_price) : null;
    }
    currency = payload.currency ?? null;
  } else {
    const p =
      payload.building.pricing ||
      payload.building.spaces?.find((s) => s.pricing)?.pricing ||
      null;
    if (p) {
      if (payload.transaction_type === 'SALES') {
        asking_price = p.asking_price ? Math.round(p.asking_price) : null;
      } else {
        rent_pcm = p.asking_rent_pa ? Math.round(p.asking_rent_pa / 12) : null;
      }
      currency = p.currency ?? null;
    }
  }

  const admin = createSupabaseAdminClient();

  // Media. A provider PUT replaces the photo set, but must not silently drop
  // cache columns the wire payload does not carry (floor plans, featured image),
  // so the existing media object is merged under the new one.
  const media =
    payload.kind === 'residential' ? payload.media ?? null : payload.building.media ?? null;
  const photo_url =
    media && Array.isArray(media.photos) && media.photos.length > 0
      ? media.photos[0].url
      : null;
  const photo_count =
    media && Array.isArray(media.photos) ? media.photos.length : null;

  let existingMedia: Record<string, unknown> = {};
  if (photo_url) {
    const prior = await admin
      .from('tbl_external_raia_listings')
      .select('media')
      .eq('agent_id', args.agent_id)
      .eq('raia_id', raia_id)
      .maybeSingle();
    const priorMedia = prior.data?.media;
    if (priorMedia && typeof priorMedia === 'object' && !Array.isArray(priorMedia)) {
      existingMedia = priorMedia as Record<string, unknown>;
    }
  }

  const features =
    payload.kind === 'residential' ? payload.features ?? null : null;

  // The cache's furnishing vocabulary is narrower than the feed enum; a value
  // it cannot hold is left NULL rather than coerced into a wrong one.
  const CACHE_FURNISHING: Record<string, string> = {
    FURNISHED: 'furnished',
    PART_FURNISHED: 'part_furnished',
    UNFURNISHED: 'unfurnished'
  };
  const furnishing =
    payload.kind === 'residential' && payload.furnishing
      ? CACHE_FURNISHING[payload.furnishing] ?? null
      : null;
  const available_from =
    payload.kind === 'residential' ? payload.available_from ?? null : null;

  const bedrooms =
    payload.kind === 'residential' ? payload.bedrooms ?? null : null;
  const bathrooms =
    payload.kind === 'residential' ? payload.bathrooms ?? null : null;

  // Address fields — suppress display if requested.
  const display_address = suppress ? null : address.display_address;
  const postcode = address.postcode;
  const street_name = suppress ? null : extractStreet(address.display_address);

  const upsertBody = {
    agent_id: args.agent_id,
    raia_id,
    raia_schema_version: '0.2',
    headline,
    marketing_description,
    property_type: mapPropertyType(payload),
    service_type: mapServiceType(payload),
    bedrooms,
    bathrooms,
    floor_area_sqm:
      payload.kind === 'residential'
        ? payload.floor_area_sqm ?? null
        : null,
    latitude: address.latitude ?? null,
    longitude: address.longitude ?? null,
    postcode_full: postcode,
    street_name,
    rent_pcm,
    asking_price,
    currency,
    listing_status,
    visibility: 'public',
    features,
    media: (media ? { ...existingMedia, ...media, featured_image_url: photo_url } : null) as Json,
    photo_url,
    photo_count,
    // ADR-427 field contract: furnishing/availability are source populates for
    // every eligible listing and must survive the feed projection.
    furnishing: furnishing,
    available_from: available_from,
    last_seen_at: new Date().toISOString(),
    withdrawn_at: null,
    jurisdiction_extensions: (suppress
      ? null
      : {
          [country.toLowerCase()]: {
            display_address: address.display_address
          }
        }) as Json
  };

  const { error } = await admin
    .from('tbl_external_raia_listings')
    .upsert(upsertBody as never, { onConflict: 'agent_id,raia_id' });

  if (error) {
    console.error('[portal/public-card] upsert failed', error.message);
    return null;
  }

  return {
    raia_id,
    public_card_url: `${SITE_URL}/property/${raia_id}`
  };
}

export async function withdrawPublicCard(agent_id: string, raia_id: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('tbl_external_raia_listings')
    .update({ withdrawn_at: new Date().toISOString() })
    .eq('agent_id', agent_id)
    .eq('raia_id', raia_id);
  if (error) {
    console.error('[portal/public-card] withdraw failed', error.message);
  }
}

function extractStreet(display: string | undefined | null): string | null {
  if (!display) return null;
  // Best-effort: take everything before the first comma.
  const idx = display.indexOf(',');
  return idx > 0 ? display.slice(0, idx).trim() : display.trim();
}
