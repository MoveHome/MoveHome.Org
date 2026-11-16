// Signed RAIA property card at /p/{raia_id}/raia.json (alias of the .json card,
// with grounding + signature attached).
import { NextRequest, NextResponse } from 'next/server';
import { getListingByRaiaId } from '@/lib/queries';
import { buildWellKnownPropertyCard } from '@/lib/property-card';
import { getDirectoryEntity, INFRASTRUCTURE_PROVIDER } from '@/lib/a2a/directory-cards';
import { signCard } from '@/lib/a2a/card-signing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://movehome.org').replace(/\/$/, '');

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ raia_id: string }> }
) {
  const { raia_id } = await params;
  const listing = await getListingByRaiaId(raia_id);
  if (!listing) {
    return NextResponse.json({ error: 'Property card not found' }, { status: 404 });
  }

  // The catalogue row carries the software provider's org id; the card must name
  // the trading agency, so registered properties override it.
  const listingAgent = getDirectoryEntity(raia_id)?.listing_agent ?? {
    agent_id: listing.agent_id,
    name: listing.agent_id,
    role: 'trading_agency' as const
  };

  const card = {
    ...buildWellKnownPropertyCard(listing),
    agent_id: listingAgent.agent_id,
    agent_card_url: `${SITE_URL}/agent/${listingAgent.agent_id}/agent.json`,
    listing_agent: listingAgent,
    infrastructure_provider: INFRASTRUCTURE_PROVIDER
  };

  return NextResponse.json(await signCard(card), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
