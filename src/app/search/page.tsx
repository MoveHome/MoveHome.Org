import { searchListings } from '@/lib/queries';
import PropertyDeck from '@/components/PropertyDeck';
import type { ServiceType } from '@/lib/types';

export const revalidate = 60;

interface SearchPageProps {
  searchParams: Promise<{
    service_type?: ServiceType;
    bedrooms_min?: string;
    rent_pcm_max?: string;
    un_locode?: string;
  }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const sp = await searchParams;
  const { results } = await searchListings({
    service_type: sp.service_type,
    bedrooms_min: sp.bedrooms_min ? Number(sp.bedrooms_min) : undefined,
    rent_pcm_max: sp.rent_pcm_max ? Number(sp.rent_pcm_max) : undefined,
    un_locode: sp.un_locode,
    limit: 48
  });

  return <PropertyDeck listings={results} />;
}
