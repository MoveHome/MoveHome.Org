import { describe, expect, it, vi } from 'vitest';
import { GET } from '../app/p/[raia_id]/card.json/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/queries', () => ({
  getListingByRaiaId: vi.fn(async (raia_id: string) => {
    if (raia_id === 'prop-test-001') {
      return {
        raia_id: 'prop-test-001',
        agent_id: 'agent-test-001',
        agent_card_url: 'https://example.com/agent.json',
        enquiry_endpoint: 'https://example.com/enquire',
        headline: 'Lovely 2 Bed Flat',
        marketing_description: '☎️ Call us https://bit.ly/contact\nLovely flat in London.',
        property_type: 'flat',
        service_type: 'long_term',
        bedrooms: 2,
        bathrooms: 1,
        floor_area_sqm: 65,
        furnishing: 'furnished',
        rent_pcm: 2000,
        currency: 'GBP',
        available_from: '2026-12-01',
        listing_status: 'available',
        un_locode: 'GBLON',
        jurisdiction: 'GB',
        latitude: 51.5074,
        longitude: -0.1278,
        postcode_full: 'SW1A 1AA',
        photo_url: 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg',
        featured_image_url: 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg',
        photos: [{ url: 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg' }],
        floor_plan_url: null,
        video_url: 'https://res.cloudinary.com/demo/video/upload/v1/sample.mp4',
        tour_360_url: null,
        features: ['Balcony'],
        jurisdiction_extensions: null,
      };
    }
    return null;
  }),
}));

describe('GET /p/[raia_id]/card.json', () => {
  it('returns clean v0.3 property card JSON for an existing raia_id', async () => {
    const req = new NextRequest('https://movehome.org/p/prop-test-001/card.json');
    const res = await GET(req, { params: Promise.resolve({ raia_id: 'prop-test-001' }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.schema_version).toBe('0.3.0');
    expect(json.raia_id).toBe('prop-test-001');
    expect(json.marketing_description).toBe('Lovely flat in London.');
    expect(json.media.video_url).toBe('https://res.cloudinary.com/demo/video/upload/v1/sample.mp4');
    expect(json.price).toBe(2000);
  });

  it('returns 404 for non-existent raia_id', async () => {
    const req = new NextRequest('https://movehome.org/p/prop-unknown/card.json');
    const res = await GET(req, { params: Promise.resolve({ raia_id: 'prop-unknown' }) });
    expect(res.status).toBe(404);
  });
});
