import { headers } from 'next/headers';
import { searchListings } from '@/lib/queries';
import PropertyDeck from '@/components/PropertyDeck';
import { resolveDefaultCountry } from '@/lib/property-card';

export const dynamic = 'force-dynamic';

// The swipe/reel webapp. Canonical home is app.movehome.org (application.
// as alias), which next.config rewrites to this route so the host root serves
// the deck.
export default async function WebappPage() {
  const reqHeaders = await headers();
  const ipCountry = reqHeaders.get('x-vercel-ip-country');
  const defaultCountry = resolveDefaultCountry(ipCountry);
  const { results } = await searchListings({ limit: 200 });
  return <PropertyDeck listings={results} defaultCountry={defaultCountry} />;
}
