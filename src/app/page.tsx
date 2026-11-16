import { searchListings } from '@/lib/queries';
import PropertyDeck from '@/components/PropertyDeck';

export const revalidate = 60;

// `/` is the swipe stream — the deck is the product entry point.
// The marketing overview lives at /about.
export default async function HomePage() {
  const { results } = await searchListings({ limit: 24 });
  return <PropertyDeck listings={results} />;
}
