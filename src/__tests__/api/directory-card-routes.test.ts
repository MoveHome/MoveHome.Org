import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getAgentCard } from '@/app/agent/[agent_id]/agent.json/route';
import { GET as getRaiaCard } from '@/app/agent/[agent_id]/raia.json/route';
import { GET as getPropertyCard } from '@/app/p/[raia_id]/raia.json/route';

vi.mock('@/lib/queries', () => ({
  getListingByRaiaId: vi.fn(async (raia_id: string) =>
    raia_id === 'prop-gb-rlf-000214'
      ? {
          raia_id: 'prop-gb-rlf-000214',
          agent_id: 'org-gb-estateaigents',
          agent_card_url: null,
          enquiry_endpoint: null,
          headline: '2-bedroom flat to rent in W1T',
          marketing_description: '2-bedroom flat to rent in W1T',
          property_type: 'Flat',
          service_type: 'long_term',
          bedrooms: 2,
          bathrooms: 1,
          floor_area_sqm: null,
          furnishing: null,
          rent_pcm: null,
          asking_price: null,
          daily_rate: null,
          currency: 'GBP',
          available_from: '2027-02-19',
          listing_status: 'let_agreed',
          un_locode: 'GBLON',
          jurisdiction: 'gb',
          latitude: null,
          longitude: null,
          postcode_full: null,
          postcode_district: 'W1T',
          postcode_sector: null,
          street_name: null,
          building_number: null,
          suburb: 'W1T',
          photo_url: null,
          featured_image_url: null,
          photos: [],
          floor_plan_url: null,
          video_url: null,
          tour_360_url: null,
          features: ['FURNISHED'],
          jurisdiction_extensions: null
        }
      : null
  )
}));

describe('directory card routes', () => {
  it('serves agent.json and raia.json for each entity', async () => {
    for (const id of ['org-gb-rlf', 'org-gb-throne', 'agt-gb-shannon']) {
      const agent = await getAgentCard(new Request('https://movehome.org/'), { params: Promise.resolve({ agent_id: id }) });
      expect(agent.status).toBe(200);
      expect((await agent.json()).agent_id).toBe(id);

      const raia = await getRaiaCard(new Request('https://movehome.org/'), { params: Promise.resolve({ agent_id: id }) });
      expect(raia.status).toBe(200);
      expect((await raia.json()).schema_version).toBe('0.3.0');
    }
  });

  it('404s for an unknown entity', async () => {
    const res = await getAgentCard(new Request('https://movehome.org/'), { params: Promise.resolve({ agent_id: 'org-gb-nope' }) });
    expect(res.status).toBe(404);
  });

  it('grounds the Pembroke property card to RentLondonFlat', async () => {
    const res = await getPropertyCard(new NextRequest('https://movehome.org/p/prop-gb-rlf-000214/raia.json'), {
      params: Promise.resolve({ raia_id: 'prop-gb-rlf-000214' })
    });
    expect(res.status).toBe(200);
    const card = await res.json();
    expect(card.raia_id).toBe('prop-gb-rlf-000214');
    expect(card.agent_id).toBe('org-gb-rlf');
    expect(card.agent_card_url).toBe('https://movehome.org/agent/org-gb-rlf/agent.json');
    expect(card.listing_agent).toEqual({ agent_id: 'org-gb-rlf', name: 'RentLondonFlat.com Ltd', role: 'trading_agency' });
    expect(card.infrastructure_provider.agent_id).toBe('org-gb-estateaigents');
  });
});
