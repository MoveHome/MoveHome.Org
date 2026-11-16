import { NextRequest, NextResponse } from 'next/server';
import { getListingByRaiaId } from '@/lib/queries';
import { sanitizeDescription } from '@/lib/sanitize-description';

export const runtime = 'nodejs';
export const revalidate = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ raia_id: string }> }
) {
  const { raia_id } = await params;
  if (!raia_id) {
    return NextResponse.json({ error: 'Missing raia_id' }, { status: 400 });
  }

  const listing = await getListingByRaiaId(raia_id);
  if (!listing) {
    return NextResponse.json({ error: 'Property card not found' }, { status: 404 });
  }

  const price = listing.rent_pcm ?? listing.asking_price ?? listing.daily_rate ?? 0;
  const card = {
    schema_version: '0.3.0',
    raia_id: listing.raia_id,
    agent_id: listing.agent_id,
    agent_card_url: listing.agent_card_url,
    enquiry_endpoint: listing.enquiry_endpoint,
    headline: listing.headline,
    marketing_description: sanitizeDescription(listing.marketing_description),
    property_type: listing.property_type,
    service_type: listing.service_type,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    floor_area_sqm: listing.floor_area_sqm,
    furnishing: listing.furnishing,
    price,
    currency: listing.currency ?? 'GBP',
    rent_pcm: listing.rent_pcm,
    asking_price: listing.asking_price,
    daily_rate: listing.daily_rate,
    available_from: listing.available_from,
    listing_status: listing.listing_status,
    location: {
      un_locode: listing.un_locode,
      jurisdiction: listing.jurisdiction,
      latitude: listing.latitude,
      longitude: listing.longitude,
      postcode_full: listing.postcode_full,
      postcode_district: listing.postcode_district,
      postcode_sector: listing.postcode_sector,
      street_name: listing.street_name,
      building_number: listing.building_number,
      suburb: listing.suburb,
    },
    media: {
      photo_url: listing.photo_url,
      featured_image_url: listing.featured_image_url,
      photos: listing.photos,
      floor_plan_url: listing.floor_plan_url,
      video_url: listing.video_url,
      tour_360_url: listing.tour_360_url,
    },
    features: listing.features,
    jurisdiction_extensions: listing.jurisdiction_extensions,
  };

  return NextResponse.json(card, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
