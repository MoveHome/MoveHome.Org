import { describe, it, expect, vi } from 'vitest';
import {
  isReservedSlug,
  slugify,
  getCrmRef,
  generateListingSlug,
  parseListingSlugRef,
  getAgentBySlug,
  RESERVED_SLUGS
} from '@/lib/agent-routing';
import type { Listing } from '@/lib/types';
import AgentStorefrontPage, { generateMetadata as storefrontMetadata } from '@/app/[slug]/page';
import AgentListingDetailPage, { generateMetadata as listingMetadata } from '@/app/[slug]/[listing_slug]/page';

// Mock Next.js navigation (notFound, redirect, permanentRedirect)
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((url: string, type?: string) => {
    const err = new Error(`NEXT_REDIRECT: ${url} (${type})`);
    (err as unknown as { url: string; type?: string }).url = url;
    (err as unknown as { url: string; type?: string }).type = type;
    throw err;
  }),
  permanentRedirect: vi.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT: ${url} (308)`);
    (err as unknown as { url: string; type?: string }).url = url;
    (err as unknown as { url: string; type?: string }).type = '308';
    throw err;
  }),
  RedirectType: { permanent: 'permanent', push: 'push', replace: 'replace' }
}));

// Mock queries
vi.mock('@/lib/queries', () => ({
  searchListings: vi.fn(async ({ agent_id }: { agent_id?: string }) => {
    const sampleListings: Listing[] = [
      {
        raia_id: 'prop-gb-rlf-10492',
        external_id: '10492',
        agent_id: 'org-gb-07798821',
        agent_card_url: 'https://app.estateaigents.com/.well-known/agent.json',
        enquiry_endpoint: null,
        raia_schema_version: '0.3.0',
        un_locode: 'GBLON',
        jurisdiction: 'GB',
        headline: 'Stunning 2 Bed Apartment in Fitzrovia',
        marketing_description: 'Spacious 2 bedroom flat on Charlotte Street',
        latitude: 51.518,
        longitude: -0.137,
        postcode_full: 'W1T 1RR',
        postcode_district: 'W1T',
        postcode_sector: 'W1T 1',
        street_name: 'Charlotte Street',
        building_number: '12',
        suburb: 'Fitzrovia',
        property_type: 'flat',
        service_type: 'long_term',
        bedrooms: 2,
        bathrooms: 1,
        floor_area_sqm: 65,
        floor: 2,
        total_floors: 4,
        furnishing: 'furnished',
        is_new_build: false,
        development_name: null,
        rent_pcm: 2500,
        daily_rate: null,
        asking_price: null,
        currency: 'GBP',
        available_from: '2026-12-01',
        listing_status: 'available',
        visibility: 'public',
        publish_from: null,
        publish_until: null,
        features: ['Balcony', 'Lift'],
        featured_image_url: 'https://images.example.com/p1.jpg',
        photo_url: 'https://images.example.com/p1.jpg',
        photos: [{ url: 'https://images.example.com/p1.jpg' }],
        floor_plan_url: null,
        video_url: null,
        tour_360_url: null,
        jurisdiction_extensions: null,
        listed_at: '2026-11-01',
        first_seen_at: '2026-11-01',
        last_seen_at: '2026-11-17',
        snapshot_version: 1,
        synced_at: '2026-11-17T12:00:00Z'
      }
    ];
    if (agent_id) {
      return { results: sampleListings.filter((l) => l.agent_id === agent_id), total: 1 };
    }
    return { results: sampleListings, total: sampleListings.length };
  }),
  getListingByRef: vi.fn(async (agent_id: string, ref: string) => {
    if (agent_id === 'org-gb-07798821' && (ref === '10492' || ref === 'prop-gb-rlf-10492')) {
      return {
        raia_id: 'prop-gb-rlf-10492',
        external_id: '10492',
        agent_id: 'org-gb-07798821',
        agent_card_url: 'https://app.estateaigents.com/.well-known/agent.json',
        enquiry_endpoint: null,
        raia_schema_version: '0.3.0',
        un_locode: 'GBLON',
        jurisdiction: 'GB',
        headline: 'Stunning 2 Bed Apartment in Fitzrovia',
        marketing_description: 'Spacious 2 bedroom flat on Charlotte Street',
        latitude: 51.518,
        longitude: -0.137,
        postcode_full: 'W1T 1RR',
        postcode_district: 'W1T',
        postcode_sector: 'W1T 1',
        street_name: 'Charlotte Street',
        building_number: '12',
        suburb: 'Fitzrovia',
        property_type: 'flat',
        service_type: 'long_term',
        bedrooms: 2,
        bathrooms: 1,
        floor_area_sqm: 65,
        floor: 2,
        total_floors: 4,
        furnishing: 'furnished',
        is_new_build: false,
        development_name: null,
        rent_pcm: 2500,
        daily_rate: null,
        asking_price: null,
        currency: 'GBP',
        available_from: '2026-12-01',
        listing_status: 'available',
        visibility: 'public',
        publish_from: null,
        publish_until: null,
        features: ['Balcony', 'Lift'],
        featured_image_url: 'https://images.example.com/p1.jpg',
        photo_url: 'https://images.example.com/p1.jpg',
        photos: [{ url: 'https://images.example.com/p1.jpg' }],
        floor_plan_url: null,
        video_url: null,
        tour_360_url: null,
        jurisdiction_extensions: null,
        listed_at: '2026-11-01',
        first_seen_at: '2026-11-01',
        last_seen_at: '2026-11-17',
        snapshot_version: 1,
        synced_at: '2026-11-17T12:00:00Z'
      } as Listing;
    }
    return null;
  })
}));

describe('Agent Vanity Routing & Hybrid SEO Slugs', () => {
  describe('Reserved Slugs Protection', () => {
    it('correctly identifies reserved top-level routes', () => {
      const reservedList = Array.from(RESERVED_SLUGS);
      for (const slug of reservedList) {
        expect(isReservedSlug(slug)).toBe(true);
        expect(isReservedSlug(slug.toUpperCase())).toBe(true);
      }
      expect(isReservedSlug('rentlondonflat')).toBe(false);
      expect(isReservedSlug('beyond360')).toBe(false);
    });

    it('returns null from getAgentBySlug when reserved keyword is requested', async () => {
      const result = await getAgentBySlug('search');
      expect(result).toBeNull();
    });

    it('storefront page calls notFound() for reserved slugs', async () => {
      await expect(AgentStorefrontPage({ params: Promise.resolve({ slug: 'search' }) })).rejects.toThrow(
        'NEXT_NOT_FOUND'
      );
    });

    it('listing detail page calls notFound() for reserved slugs', async () => {
      await expect(
        AgentListingDetailPage({ params: Promise.resolve({ slug: 'search', listing_slug: '10492' }) })
      ).rejects.toThrow('NEXT_NOT_FOUND');
    });
  });

  describe('Agent Slug Resolution', () => {
    it('resolves agent profile by vanity slug', async () => {
      const rlf = await getAgentBySlug('rentlondonflat');
      expect(rlf).not.toBeNull();
      expect(rlf?.agent_id).toBe('org-gb-07798821');
      expect(rlf?.name).toBe('RentLondonFlat.com Ltd');

      const beyond = await getAgentBySlug('beyond360');
      expect(beyond).not.toBeNull();
      expect(beyond?.agent_id).toBe('org-th-0105561135324');
    });

    it('resolves agent profile by raw agent_id', async () => {
      const rlf = await getAgentBySlug('org-gb-07798821');
      expect(rlf).not.toBeNull();
      expect(rlf?.name).toBe('RentLondonFlat.com Ltd');
    });

    it('returns null for unknown agent slug', async () => {
      const unknown = await getAgentBySlug('nonexistent-agent-slug');
      expect(unknown).toBeNull();
    });
  });

  describe('Hybrid SEO Slugs & Ref Parsing', () => {
    const mockListing: Listing = {
      raia_id: 'prop-gb-rlf-10492',
      external_id: '10492',
      agent_id: 'org-gb-07798821',
      agent_card_url: null,
      enquiry_endpoint: null,
      raia_schema_version: '0.3.0',
      un_locode: 'GBLON',
      jurisdiction: 'GB',
      headline: '2 Bed Flat',
      marketing_description: 'Nice flat',
      latitude: 51.5,
      longitude: -0.1,
      postcode_full: 'W1T 1RR',
      postcode_district: 'W1T',
      postcode_sector: 'W1T 1',
      street_name: 'Charlotte Street',
      building_number: '12',
      suburb: 'Fitzrovia',
      property_type: 'flat',
      service_type: 'long_term',
      bedrooms: 2,
      bathrooms: 1,
      floor_area_sqm: 65,
      floor: 1,
      total_floors: 3,
      furnishing: 'furnished',
      is_new_build: false,
      development_name: null,
      rent_pcm: 2500,
      daily_rate: null,
      asking_price: null,
      currency: 'GBP',
      available_from: null,
      listing_status: 'available',
      visibility: 'public',
      publish_from: null,
      publish_until: null,
      features: [],
      featured_image_url: null,
      photo_url: null,
      photos: [],
      floor_plan_url: null,
      video_url: null,
      tour_360_url: null,
      jurisdiction_extensions: null,
      listed_at: null,
      first_seen_at: '2026-11-01',
      last_seen_at: null,
      snapshot_version: 1,
      synced_at: '2026-11-01'
    };

    it('extracts CRM ref from external_id or raia_id', () => {
      expect(getCrmRef(mockListing)).toBe('10492');
      expect(getCrmRef({ raia_id: 'prop-gb-rlf-000427' })).toBe('000427');
    });

    it('generates hybrid SEO slug combining location, bedrooms, street, and ref', () => {
      const slug = generateListingSlug(mockListing);
      expect(slug).toBe('fitzrovia-2-bed-charlotte-street-10492');
    });

    it('parses raw ref vs hybrid SEO slug', () => {
      const raw = parseListingSlugRef('10492');
      expect(raw.isRawRef).toBe(true);
      expect(raw.ref).toBe('10492');

      const hybrid = parseListingSlugRef('fitzrovia-2-bed-charlotte-street-10492');
      expect(hybrid.isRawRef).toBe(false);
      expect(hybrid.ref).toBe('10492');
    });
  });

  describe('308 Permanent Redirect for Raw CRM Refs', () => {
    it('issues a 308 redirect when visiting raw ref /[slug]/10492', async () => {
      try {
        await AgentListingDetailPage({
          params: Promise.resolve({ slug: 'rentlondonflat', listing_slug: '10492' })
        });
        expect.fail('Should have thrown redirect');
      } catch (err: unknown) {
        const redirectError = err as { message: string; url?: string; type?: string };
        expect(redirectError.message).toContain('NEXT_REDIRECT');
        expect(redirectError.url).toBe('/rentlondonflat/fitzrovia-2-bed-charlotte-street-10492');
        expect(redirectError.type).toBe('308');
      }
    });

    it('renders detail page when canonical hybrid slug is visited', async () => {
      const element = await AgentListingDetailPage({
        params: Promise.resolve({
          slug: 'rentlondonflat',
          listing_slug: 'fitzrovia-2-bed-charlotte-street-10492'
        })
      });
      expect(element).toBeDefined();
    });

    it('provides canonical tag in metadata', async () => {
      const meta = await listingMetadata({
        params: Promise.resolve({
          slug: 'rentlondonflat',
          listing_slug: 'fitzrovia-2-bed-charlotte-street-10492'
        })
      });
      expect(meta.alternates?.canonical).toBe(
        'https://app.movehome.org/rentlondonflat/fitzrovia-2-bed-charlotte-street-10492'
      );
    });
  });

  describe('Agent Storefront Deck Rendering', () => {
    it('renders storefront deck for valid agent slug', async () => {
      const page = await AgentStorefrontPage({
        params: Promise.resolve({ slug: 'rentlondonflat' })
      });
      expect(page).toBeDefined();
    });

    it('provides metadata for storefront deck', async () => {
      const meta = await storefrontMetadata({
        params: Promise.resolve({ slug: 'rentlondonflat' })
      });
      expect(meta.title).toContain('RentLondonFlat.com Ltd');
      expect(meta.alternates?.canonical).toBe('https://app.movehome.org/rentlondonflat');
    });
  });
});