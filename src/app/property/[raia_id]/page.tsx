import { notFound } from 'next/navigation';
import { getListingByRaiaId } from '@/lib/queries';
import PropertyDetail from '@/components/PropertyDetail';

export const revalidate = 60;

export default async function PropertyPage({
  params
}: {
  params: Promise<{ raia_id: string }>;
}) {
  const { raia_id } = await params;
  const listing = await getListingByRaiaId(raia_id);
  if (!listing) notFound();
  return <PropertyDetail listing={listing} />;
}
