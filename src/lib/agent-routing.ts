import type { Listing } from './types';
import { getEstateAgentProfile, type EstateAgentProfile } from './agent-directory';

export const RESERVED_SLUGS = new Set([
  'search',
  'registry',
  'charter',
  'terms',
  'privacy',
  'api',
  'app',
  'signin',
  'register',
  'enquire',
  'demo',
  'about',
  'p',
  'agent',
  'property',
  'connect'
]);

export function isReservedSlug(slug: string): boolean {
  if (!slug) return false;
  return RESERVED_SLUGS.has(slug.toLowerCase().trim());
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getCrmRef(listing: Partial<Listing> & { raia_id?: string; external_id?: string | null }): string {
  if (listing.external_id && listing.external_id.trim().length > 0) {
    return listing.external_id.trim();
  }
  if (listing.raia_id) {
    const parts = listing.raia_id.split('-');
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return '0';
}

export function generateListingSlug(listing: Listing): string {
  const crmRef = getCrmRef(listing);
  const parts: string[] = [];

  if (listing.suburb) {
    parts.push(slugify(listing.suburb));
  } else if (listing.postcode_district) {
    parts.push(slugify(listing.postcode_district));
  }

  if (listing.bedrooms != null) {
    parts.push(`${listing.bedrooms}-bed`);
  }

  if (listing.street_name) {
    parts.push(slugify(listing.street_name));
  } else if (listing.property_type) {
    parts.push(slugify(listing.property_type));
  }

  let base = parts.filter(Boolean).join('-');
  if (!base) {
    if (listing.headline) {
      base = slugify(listing.headline);
    } else {
      base = 'property';
    }
  }

  return `${base}-${crmRef}`;
}

export function parseListingSlugRef(listingSlug: string): { isRawRef: boolean; ref: string } {
  const trimmed = listingSlug.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return { isRawRef: true, ref: trimmed };
  }
  // Hybrid slugs may embed the full UUID after an SEO title prefix
  // (e.g. "w1t-2-bed-flat-<uuid>"); splitting on "-" would truncate it.
  const uuidMatch = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuidMatch) {
    return { isRawRef: false, ref: uuidMatch[0] };
  }
  if (/^[a-z0-9_]+$/i.test(trimmed)) {
    return { isRawRef: true, ref: trimmed };
  }
  const parts = trimmed.split('-');
  const lastSegment = parts[parts.length - 1];
  return { isRawRef: false, ref: lastSegment || trimmed };
}

export async function getAgentBySlug(slug: string): Promise<EstateAgentProfile | null> {
  if (isReservedSlug(slug)) return null;

  // 1. Local profile lookup
  const localProfile = getEstateAgentProfile(slug);
  if (localProfile) return localProfile;

  // 2. Registry lookup (server-only dynamic import to keep client bundle clean of Node builtins)
  if (typeof window === 'undefined') {
    try {
      const { getAgent: getRegistryAgent } = await import('./registry/store');
      const regAgent = await getRegistryAgent(slug);
      if (regAgent) {
        return {
          agent_id: regAgent.id || slug,
          slug: regAgent.slug,
          name: regAgent.name || regAgent.slug,
          legal_name: regAgent.provider_org || regAgent.name || regAgent.slug,
          registration_number: 'A2A-REG',
          registration_authority: 'RAIA A2A Protocol Registry',
          incorporation_info: 'Verified A2A Protocol Agent',
          jurisdiction: (regAgent.locations && regAgent.locations[0]) || 'Global',
          business_address: regAgent.provider_url || 'A2A Network',
          email: 'agent@estateaigents.com',
          website: regAgent.provider_url || regAgent.a2a_url || 'https://movehome.org',
          licences: ['RAIA Protocol Listed Agent'],
          agent_card_url: regAgent.well_known_uri || regAgent.a2a_url || 'https://app.estateaigents.com/.well-known/agent.json',
          logo_url: regAgent.icon_url || null,
          verified: true
        };
      }
    } catch {
      // Registry query failed or unconfigured DB
    }
  }

  return null;
}
