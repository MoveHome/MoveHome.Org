import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getListingByRaiaId, searchListings } from '@/lib/queries';
import PropertyDeck from '@/components/PropertyDeck';
import { priceLabel, titleOf } from '@/lib/property-card';

export const revalidate = 60;

interface Props {
  params: Promise<{ raia_id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { raia_id } = await params;
  const listing = await getListingByRaiaId(raia_id);
  if (!listing) return { title: 'Property not found — MoveHome.org' };
  return {
    title: `${priceLabel(listing)} · ${titleOf(listing)} — MoveHome.org`,
    description: listing.marketing_description?.slice(0, 160) ?? undefined,
    alternates: { canonical: `/p/${listing.raia_id}` }
  };
}

export default async function PropertyDeepLinkPage({ params }: Props) {
  const { raia_id } = await params;
  const listing = await getListingByRaiaId(raia_id);
  if (!listing) notFound();

  // Nearby = same city, so the arrow keys / swipe stay in the listed cluster.
  const { results } = await searchListings({ un_locode: listing.un_locode ?? undefined, limit: 12 });
  const siblings = results.filter((l) => l.raia_id !== listing.raia_id);

  return <PropertyDeck listings={[listing, ...siblings]} initialRaiaId={listing.raia_id} />;
}
