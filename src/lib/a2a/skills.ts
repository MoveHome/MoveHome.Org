// A2A skill handlers. Each maps validated params onto the existing data layer
// (src/lib/queries.ts) or the shared enquiry pipeline (src/lib/enquiry.ts) and
// returns artifacts the calling agent can consume — a machine-readable DataPart
// plus a short human-readable summary. Handlers throw SkillError for client-facing
// failures (bad params, not found); the executor turns those into a failed Task.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getListingByRaiaId, searchListings } from '@/lib/queries';
import { createEnquiry } from '@/lib/enquiry';
import type { Listing, SearchParams } from '@/lib/types';
import type { Artifact } from './types';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://movehome.org').replace(/\/$/, '');
const RAIA_ID_RE = /^prop-[a-z]{2}-[a-z0-9-]{2,32}-[0-9]{4,}$/;
// ISO 8601 date or datetime, e.g. 2026-06-15 or 2026-06-15T14:30:00Z.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

export interface SkillResult {
  artifacts: Artifact[];
  summary: string;
}

// Thrown by skill handlers for client-facing failures. The A2A executor maps
// these to a Task with status `failed` carrying the message (not a 5xx/crash).
export class SkillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillError';
  }
}

function parse<T>(schema: z.ZodType<T>, params: unknown): T {
  const result = schema.safeParse(params ?? {});
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new SkillError(`Invalid parameters: ${details}`);
  }
  return result.data;
}

// Curated public projection of a listing — the same data the public card shows,
// shaped for agent consumption (no internal sync/snapshot bookkeeping).
function toPublicListing(l: Listing) {
  return {
    raia_id: l.raia_id,
    agent_id: l.agent_id,
    url: `${SITE_URL}/property/${l.raia_id}`,
    headline: l.headline,
    description: l.marketing_description,
    property_type: l.property_type,
    service_type: l.service_type,
    status: l.listing_status,
    bedrooms: l.bedrooms,
    bathrooms: l.bathrooms,
    floor_area_sqm: l.floor_area_sqm,
    furnishing: l.furnishing,
    available_from: l.available_from,
    price: {
      rent_pcm: l.rent_pcm,
      daily_rate: l.daily_rate,
      asking_price: l.asking_price,
      currency: l.currency
    },
    location: {
      un_locode: l.un_locode,
      jurisdiction: l.jurisdiction,
      street_name: l.street_name,
      suburb: l.suburb,
      postcode_district: l.postcode_district,
      latitude: l.latitude,
      longitude: l.longitude
    },
    features: l.features,
    media: {
      photo_url: l.photo_url,
      photos: l.photos,
      floor_plan_url: l.floor_plan_url,
      video_url: l.video_url,
      tour_360_url: l.tour_360_url
    },
    jurisdiction_extensions: l.jurisdiction_extensions
  };
}

// ── search_properties ─────────────────────────────────────────────────────
const searchSchema = z
  .object({
    // Clients send lowercase/padded codes in practice; normalise before matching.
    un_locode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}[A-Z0-9]{3}$/, 'un_locode must be a 5-char UN/LOCODE, e.g. GBLON')
      .optional(),
    service_type: z.enum(['long_term', 'short_term', 'sale']).optional(),
    property_type: z.enum(['flat', 'house', 'studio', 'commercial', 'land', 'other']).optional(),
    bedrooms_min: z.number().int().min(0).max(50).optional(),
    bedrooms_max: z.number().int().min(0).max(50).optional(),
    rent_pcm_max: z.number().finite().min(0).max(1_000_000).optional(),
    asking_price_max: z.number().finite().min(0).max(1_000_000_000).optional(),
    features: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).max(10_000).optional()
  })
  .strict();

async function searchProperties(params: unknown): Promise<SkillResult> {
  const input = parse(searchSchema, params);
  const searchParams: SearchParams = { ...input, limit: input.limit ?? 24 };
  const { results, total } = await searchListings(searchParams);
  const listings = results.map(toPublicListing);

  return {
    summary:
      total === 0
        ? 'No listings matched the search criteria.'
        : `Found ${total} listing${total === 1 ? '' : 's'}; returning ${listings.length}.`,
    artifacts: [
      {
        artifactId: randomUUID(),
        name: 'search_results',
        parts: [
          {
            kind: 'data',
            data: {
              total,
              count: listings.length,
              offset: searchParams.offset ?? 0,
              limit: searchParams.limit,
              listings
            }
          }
        ]
      }
    ]
  };
}

// ── get_property ────────────────────────────────────────────────────────────
const getSchema = z
  .object({
    raia_id: z.string().regex(RAIA_ID_RE, 'raia_id must look like prop-gb-acme-12345678')
  })
  .strict();

async function getProperty(params: unknown): Promise<SkillResult> {
  const { raia_id } = parse(getSchema, params);
  const listing = await getListingByRaiaId(raia_id);
  if (!listing || listing.visibility !== 'public') {
    throw new SkillError(`No public listing found for ${raia_id}.`);
  }

  return {
    summary: listing.headline ? `Listing: ${listing.headline}` : `Listing ${raia_id}`,
    artifacts: [
      {
        artifactId: randomUUID(),
        name: 'property',
        parts: [{ kind: 'data', data: { listing: toPublicListing(listing) } }]
      }
    ]
  };
}

// ── create_enquiry ────────────────────────────────────────────────────────
const enquirySchema = z
  .object({
    raia_id: z.string().regex(RAIA_ID_RE, 'raia_id must look like prop-gb-acme-12345678'),
    enquirer: z
      .object({
        name: z.string().trim().min(1).max(200),
        email: z.string().trim().email(),
        phone: z.string().trim().max(40).optional(),
        preferred_contact: z.enum(['email', 'phone', 'whatsapp']).optional()
      })
      .strict(),
    message: z.string().trim().min(1).max(2000),
    viewing_request: z
      .object({
        preferred_dates: z
          .array(z.string().max(40).regex(ISO_DATE_RE, 'preferred_dates must be ISO 8601 dates'))
          .min(1)
          .max(3),
        party_size: z.number().int().min(1).max(50).optional()
      })
      .strict()
      .optional()
  })
  .strict();

async function createEnquirySkill(params: unknown): Promise<SkillResult> {
  const input = parse(enquirySchema, params);
  const result = await createEnquiry({
    raia_id: input.raia_id,
    name: input.enquirer.name,
    email: input.enquirer.email,
    phone: input.enquirer.phone ?? null,
    preferred_contact: input.enquirer.preferred_contact ?? null,
    message: input.message,
    viewing_request: input.viewing_request ?? null,
    userId: null,
    ipCountry: null
  });

  if (!result.ok) {
    throw new SkillError(result.error);
  }

  return {
    summary: `Enquiry ${result.enquiry_id} received and routed to the source agent.`,
    artifacts: [
      {
        artifactId: randomUUID(),
        name: 'enquiry_receipt',
        parts: [
          { kind: 'data', data: { enquiry_id: result.enquiry_id, status: result.status } }
        ]
      }
    ]
  };
}

// ── Skill router ────────────────────────────────────────────────────────────
const SKILLS: Record<string, (params: unknown) => Promise<SkillResult>> = {
  search_properties: searchProperties,
  get_property: getProperty,
  create_enquiry: createEnquirySkill
};

export function resolveSkill(skillId: string): ((params: unknown) => Promise<SkillResult>) | null {
  return SKILLS[skillId] ?? null;
}

export const SKILL_IDS = Object.keys(SKILLS);
