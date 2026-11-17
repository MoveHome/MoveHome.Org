import { getSupabase } from './supabase';
import { hasMedia } from './property-card';
import type {
  Agent,
  JurisdictionExtensions,
  Listing,
  ListingPhoto,
  MapPin,
  SearchParams
} from './types';

// Empty-state safety: if Supabase isn't configured (local dev without
// .env.local), every query short-circuits to an empty result so the site
// still renders. The DB row is materialised into the flatter UI Listing
// shape — media and jurisdiction_extensions JSONB blocks are unpacked here.

interface ExternalListingRow {
  raia_id: string;
  external_id?: string | null;
  agent_id: string;
  agent_card_url: string | null;
  enquiry_endpoint: string | null;
  raia_schema_version: string | null;

  un_locode: string | null;
  jurisdiction: string | null;

  headline: string | null;
  marketing_description: string | null;

  latitude: number | null;
  longitude: number | null;
  postcode_full: string | null;
  postcode_district: string | null;
  postcode_sector: string | null;
  street_name: string | null;
  building_number: string | null;
  suburb: string | null;

  marketing_description_th?: string | null;
  marketing_description_ja?: string | null;
  marketing_description_ms?: string | null;
  marketing_description_zh?: string | null;
  i18n_source_hash?: string | null;
  i18n_status?: string | null;

  property_type: string | null;
  service_type: 'long_term' | 'short_term' | 'sale';
  bedrooms: number | null;
  bathrooms: number | null;
  floor_area_sqm: number | null;
  floor: number | null;
  total_floors: number | null;
  furnishing: string | null;
  is_new_build: boolean | null;
  development_name: string | null;

  rent_pcm: number | null;
  daily_rate: number | null;
  asking_price: number | null;
  currency: string | null;
  available_from: string | null;

  listing_status: string | null;
  visibility: 'public' | 'pre_launch' | 'off_market';
  publish_from: string | null;
  publish_until: string | null;

  features: string[] | null;

  media: Record<string, unknown> | null;
  jurisdiction_extensions: JurisdictionExtensions | null;

  photo_url: string | null;
  photo_count: number | null;

  listed_at: string | null;
  first_seen_at: string;
  last_seen_at: string | null;

  snapshot_version: number | null;
  synced_at: string;
}

function rowToListing(row: ExternalListingRow): Listing {
  const media = row.media ?? {};
  const photos = Array.isArray(media.photos) ? (media.photos as ListingPhoto[]) : [];
  return {
    raia_id: row.raia_id,
    external_id: row.external_id ?? null,
    agent_id: row.agent_id,
    agent_card_url: row.agent_card_url,
    enquiry_endpoint: row.enquiry_endpoint,
    raia_schema_version: row.raia_schema_version,

    un_locode: row.un_locode,
    jurisdiction: row.jurisdiction,

    headline: row.headline,
    marketing_description: row.marketing_description,
    marketing_description_th: row.marketing_description_th ?? null,
    marketing_description_ja: row.marketing_description_ja ?? null,
    marketing_description_ms: row.marketing_description_ms ?? null,
    marketing_description_zh: row.marketing_description_zh ?? null,
    i18n_source_hash: row.i18n_source_hash ?? null,
    i18n_status: (row.i18n_status as Listing['i18n_status']) ?? 'pending',

    latitude: row.latitude,
    longitude: row.longitude,
    postcode_full: row.postcode_full,
    postcode_district: row.postcode_district,
    postcode_sector: row.postcode_sector,
    street_name: row.street_name,
    building_number: row.building_number,
    suburb: row.suburb,

    property_type: row.property_type as Listing['property_type'],
    service_type: row.service_type,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    floor_area_sqm: row.floor_area_sqm,
    floor: row.floor,
    total_floors: row.total_floors,
    furnishing: row.furnishing as Listing['furnishing'],
    is_new_build: row.is_new_build,
    development_name: row.development_name,

    rent_pcm: row.rent_pcm,
    daily_rate: row.daily_rate,
    asking_price: row.asking_price,
    currency: row.currency,
    available_from: row.available_from,

    listing_status: row.listing_status as Listing['listing_status'],
    visibility: row.visibility,
    publish_from: row.publish_from,
    publish_until: row.publish_until,

    features: row.features ?? [],

    featured_image_url: (media.featured_image_url as string | null) ?? null,
    photo_url: (media.photo_url as string | null) ?? row.photo_url,
    photos,
    floor_plan_url: (media.floor_plan_url as string | null) ?? null,
    video_url: (media.video_url as string | null) ?? null,
    tour_360_url: (media.tour_360_url as string | null) ?? null,

    jurisdiction_extensions: row.jurisdiction_extensions,

    listed_at: row.listed_at,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,

    snapshot_version: row.snapshot_version,
    synced_at: row.synced_at
  };
}

// The public reader repeats the visibility predicates from migration 0003's RLS
// policy instead of trusting RLS alone: on 2026-11-05 a withdrawn card stayed
// publicly listed for 259 s because the policy was not applied to this reader
// (anon-key drift or a missing policy). A takedown must be observable.
// shortcut: the publish_from/publish_until window is still RLS-only; no live row
// sets it — add it here if the feed starts scheduling publication.

// The listing row carries agent_id only; the display logo lives on the
// approved-agent view. One extra read decorates the page for the card pill.
export async function withAgentLogos(listings: Listing[]): Promise<Listing[]> {
  const sb = getSupabase();
  if (!sb || listings.length === 0) return listings;
  const ids = [...new Set(listings.map((l) => l.agent_id).filter(Boolean))];
  if (ids.length === 0) return listings;
  const { data } = await sb
    .from('vw_raia_agent_registry_public')
    .select('agent_id,logo_url')
    .in('agent_id', ids);
  const logos = new Map<string, string | null>();
  for (const a of data ?? []) if (a.agent_id) logos.set(a.agent_id, a.logo_url);
  return listings.map((l) => ({ ...l, agent_logo_url: logos.get(l.agent_id) ?? null }));
}

export async function searchListings(
  params: SearchParams = {}
): Promise<{ results: Listing[]; total: number }> {
  const sb = getSupabase();
  if (!sb) return { results: [], total: 0 };

  let query = sb
    .from('tbl_external_raia_listings')
    .select('*', { count: 'exact' });

  query = query
    .is('withdrawn_at', null)
    .is('duplicate_of', null)
    .eq('is_outlier', false)
    .eq('visibility', 'public')
    // MCP write-pilot fixtures (prop-gb-mcptest-* / org-gb-mcptest) are test
    // data, never public listings. getListingByRaiaId stays unfiltered so the
    // MCP must-fail/pilot suite can still fetch the fence by id.
    .not('raia_id', 'like', '%mcptest%')
    .or('agent_id.is.null,agent_id.neq.org-gb-mcptest')
    .order('synced_at', { ascending: false });

  if (params.agent_id) query = query.eq('agent_id', params.agent_id);
  if (params.un_locode) query = query.eq('un_locode', params.un_locode);
  if (params.service_type) query = query.eq('service_type', params.service_type);
  if (params.property_type) query = query.eq('property_type', params.property_type);
  if (params.bedrooms_min !== undefined) query = query.gte('bedrooms', params.bedrooms_min);
  if (params.bedrooms_max !== undefined) query = query.lte('bedrooms', params.bedrooms_max);
  if (params.rent_pcm_max !== undefined) query = query.lte('rent_pcm', params.rent_pcm_max);
  if (params.asking_price_max !== undefined) query = query.lte('asking_price', params.asking_price_max);
  if (params.features?.length) query = query.contains('features', params.features);

  const limit = params.limit ?? 200;
  query = query.range(params.offset ?? 0, (params.offset ?? 0) + limit - 1);

  const { data, count, error } = await query;
  if (error) {
    console.error('[searchListings]', error.message);
    return { results: [], total: 0 };
  }
  // Re-rank the fetched page so a media-less fixture never lands first; the
  // synced_at order inside each group is preserved by the stable sort.
  const results = await withAgentLogos(
    (data ?? [])
      .map((r) => rowToListing(r as ExternalListingRow))
      .sort((a, b) => Number(hasMedia(b)) - Number(hasMedia(a)))
  );
  return {
    results,
    total: count ?? 0
  };
}

export async function getListingByRaiaId(raia_id: string, signal?: AbortSignal): Promise<Listing | null> {
  const sb = getSupabase();
  if (!sb) return null;

  let query = sb
    .from('tbl_external_raia_listings')
    .select('*')
    .eq('raia_id', raia_id)
    .is('withdrawn_at', null)
    .eq('visibility', 'public');

  if (signal) {
    query = query.abortSignal(signal);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('[getListingByRaiaId]', error.message);
    return null;
  }
  if (!data) return null;
  const [listing] = await withAgentLogos([rowToListing(data as ExternalListingRow)]);
  return listing;
}

export async function getMapPins(params: SearchParams = {}): Promise<MapPin[]> {
  const sb = getSupabase();
  if (!sb) return [];

  let query = sb
    .from('tbl_external_raia_listings')
    .select('raia_id,latitude,longitude,rent_pcm,asking_price,bedrooms,property_type,photo_url,agent_id');

  query = query
    .is('withdrawn_at', null)
    .is('duplicate_of', null)
    .eq('is_outlier', false)
    .eq('visibility', 'public')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .not('raia_id', 'like', '%mcptest%')
    .or('agent_id.is.null,agent_id.neq.org-gb-mcptest');

  if (params.un_locode) query = query.eq('un_locode', params.un_locode);
  if (params.service_type) query = query.eq('service_type', params.service_type);
  if (params.bedrooms_min !== undefined) query = query.gte('bedrooms', params.bedrooms_min);
  if (params.rent_pcm_max !== undefined) query = query.lte('rent_pcm', params.rent_pcm_max);
  if (params.bbox) {
    query = query
      .gte('latitude', params.bbox.sw_lat)
      .lte('latitude', params.bbox.ne_lat)
      .gte('longitude', params.bbox.sw_lon)
      .lte('longitude', params.bbox.ne_lon);
  }

  const { data, error } = await query.limit(2000);
  if (error) {
    console.error('[getMapPins]', error.message);
    return [];
  }
  return (data ?? []) as MapPin[];
}

export async function getAgent(agent_id: string): Promise<Agent | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from('vw_raia_agent_registry_public')
    .select('*')
    .eq('agent_id', agent_id)
    .maybeSingle();

  if (error) {
    console.error('[getAgent]', error.message);
    return null;
  }
  return (data ?? null) as Agent | null;
}

export async function getListingByRef(agent_id: string, ref: string): Promise<Listing | null> {
  const sb = getSupabase();
  if (sb) {
    const { data } = await sb
      .from('tbl_external_raia_listings')
      .select('*')
      .eq('agent_id', agent_id)
      .is('withdrawn_at', null)
      .eq('visibility', 'public')
      .or(`external_id.eq.${ref},raia_id.eq.${ref},raia_id.ilike.%${ref}%`)
      .limit(1)
      .maybeSingle();

    if (data) {
      const [listing] = await withAgentLogos([rowToListing(data as ExternalListingRow)]);
      return listing;
    }
  }

  const { results } = await searchListings({ agent_id, limit: 100 });
  const cleanedRef = ref.trim().toLowerCase();
  const match = results.find((l) => {
    if (l.external_id && l.external_id.toLowerCase() === cleanedRef) return true;
    if (l.raia_id.toLowerCase() === cleanedRef) return true;
    if (l.raia_id.toLowerCase().includes(cleanedRef)) return true;
    return false;
  });

  return match ?? null;
}
