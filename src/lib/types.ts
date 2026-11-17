// UI-facing types for MoveHome. Maps onto tbl_external_raia_listings rows
// after unpacking media + jurisdiction_extensions JSONB blocks.
// Aligned with RAIA Protocol v0.2 listing.json (estateaigents.org/schemas/listing.json).

export type ServiceType = 'long_term' | 'short_term' | 'sale';

export type ListingStatus =
  | 'available'
  | 'under_offer'
  | 'let_agreed'
  | 'sale_agreed'
  | 'exchanged'
  | 'completed'
  | 'fallen_through'
  | 'withdrawn'
  | 'paused';

export type Visibility = 'public' | 'pre_launch' | 'off_market';

export type PropertyType = 'flat' | 'house' | 'studio' | 'commercial' | 'land' | 'other';

export type Furnishing = 'furnished' | 'unfurnished' | 'part_furnished';

export interface ListingPhoto {
  url: string;
  caption?: string;
  order?: number;
}

// listing.json/jurisdiction_extensions/gb
export interface JurisdictionGB {
  tenure?: 'freehold' | 'leasehold' | 'share_of_freehold' | 'commonhold';
  lease_years_remaining?: number;
  service_charge_pa?: number;
  ground_rent_pa?: number;
  council_tax_band?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';
  epc_rating?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  epc_register_url?: string;
  hmo_licence_number?: string;
}

// listing.json/jurisdiction_extensions/th
export interface JurisdictionTH {
  ownership_type?: 'freehold' | 'leasehold' | 'company_holding';
  foreign_ownership_eligible?: boolean;
  chanote_type?: string;
  bts_station?: string;
  bts_distance_m?: number;
  mrt_station?: string;
  mrt_distance_m?: number;
}

export interface JurisdictionExtensions {
  gb?: JurisdictionGB;
  th?: JurisdictionTH;
}

// One listing as the UI consumes it. Materialised from a tbl_external_raia_listings
// row in src/lib/queries.ts — denormalised photo fields come from the media JSONB.
export interface Listing {
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
  marketing_description_th?: string | null;
  marketing_description_ja?: string | null;
  marketing_description_ms?: string | null;
  marketing_description_zh?: string | null;
  i18n_source_hash?: string | null;
  i18n_status?: 'pending' | 'ok' | 'failed';

  latitude: number | null;
  longitude: number | null;
  postcode_full: string | null;
  postcode_district: string | null;
  postcode_sector: string | null;
  street_name: string | null;
  building_number: string | null;
  suburb: string | null;

  property_type: PropertyType | null;
  service_type: ServiceType;
  bedrooms: number | null;
  bathrooms: number | null;
  floor_area_sqm: number | null;
  floor: number | null;
  total_floors: number | null;
  furnishing: Furnishing | null;
  is_new_build: boolean | null;
  development_name: string | null;

  rent_pcm: number | null;
  daily_rate: number | null;
  asking_price: number | null;
  currency: string | null;
  available_from: string | null;

  listing_status: ListingStatus | null;
  visibility: Visibility;
  publish_from: string | null;
  publish_until: string | null;

  features: string[];

  // Denormalised media — unpacked from the row's media JSONB.
  featured_image_url: string | null;
  photo_url: string | null;
  photos: ListingPhoto[];
  floor_plan_url: string | null;
  video_url: string | null;
  tour_360_url: string | null;
  agent_logo_url?: string | null;

  jurisdiction_extensions: JurisdictionExtensions | null;

  listed_at: string | null;
  first_seen_at: string;
  last_seen_at: string | null;

  snapshot_version: number | null;
  synced_at: string;
}

export interface SearchParams {
  agent_id?: string;
  un_locode?: string;
  bbox?: { sw_lat: number; sw_lon: number; ne_lat: number; ne_lon: number };
  service_type?: ServiceType;
  bedrooms_min?: number;
  bedrooms_max?: number;
  rent_pcm_max?: number;
  asking_price_max?: number;
  property_type?: PropertyType;
  features?: string[];
  limit?: number;
  offset?: number;
}

export interface MapPin {
  raia_id: string;
  latitude: number;
  longitude: number;
  rent_pcm: number | null;
  asking_price: number | null;
  bedrooms: number | null;
  property_type: string | null;
  photo_url: string | null;
  agent_id: string;
}

// ── Agent (federated) ──────────────────────────────────────────────────────
export interface Agent {
  agent_id: string;
  agent_card_url: string;
  name: string | null;
  display_name: string | null;
  logo_url: string | null;
  jurisdictions: string[] | null;
  capabilities: string[] | null;
  verification_status: 'pending' | 'approved' | 'rejected' | 'suspended';
  trust_tier: 'unverified' | 'auto_verified' | 'manually_verified' | 'platform_member';
}
