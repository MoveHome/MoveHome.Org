import { searchListings } from '@/lib/queries';
import PropertyDeck from '@/components/PropertyDeck';

export const revalidate = 60;

// The swipe/reel webapp. Canonical home is app.movehome.org (application.
// as alias), which next.config rewrites to this route so the host root serves
// the deck.
export default async function WebappPage() {
  const { results } = await searchListings({ limit: 48 });
  return <PropertyDeck listings={results} />;
}
