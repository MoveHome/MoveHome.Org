import { searchListings, getMapPins } from '@/lib/queries';
import ListingGrid from '@/components/ListingGrid';
import MapView from '@/components/MapView';
import Filters from '@/components/Filters';
import ThemeToggle from '@/components/ThemeToggle';
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
  const params = {
    service_type: sp.service_type,
    bedrooms_min: sp.bedrooms_min ? Number(sp.bedrooms_min) : undefined,
    rent_pcm_max: sp.rent_pcm_max ? Number(sp.rent_pcm_max) : undefined,
    un_locode: sp.un_locode,
    limit: 200
  };
  const { results, total } = await searchListings(params);
  const pins = await getMapPins(params);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans">
      {/* Navigation */}
      <nav className="sticky top-0 z-40 h-16 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-md px-4 md:px-8 flex items-center justify-between">
        <a
          href="/"
          className="flex items-center gap-2 text-lg font-bold tracking-tight focus:outline-none focus:ring-2 focus:ring-[var(--accent)] rounded-md px-1 py-1"
        >
          MoveHome<span className="text-[var(--accent)]">.org</span>
        </a>
        <div className="flex items-center gap-5">
          <a
            href="/"
            className="text-sm font-medium text-[var(--text-dim)] hover:text-[var(--accent)] transition-colors"
          >
            Home
          </a>
          <a
            href="https://app.movehome.org"
            className="text-sm font-semibold text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
          >
            Swipe view
          </a>
          <ThemeToggle />
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        {/* Header */}
        <header className="mb-6">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Search properties</h1>
          <p className="text-sm text-[var(--text-dim)] mt-2">
            <span className="font-semibold text-[var(--text)]">{total.toLocaleString()}</span>{' '}
            propert{total === 1 ? 'y' : 'ies'} available
          </p>
        </header>

        <Filters />

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
          <section>
            <ListingGrid listings={results} />
          </section>
          <aside className="order-first lg:order-last">
            <div className="lg:sticky lg:top-20 rounded-2xl overflow-hidden border border-[var(--border)] shadow-sm">
              <MapView pins={pins} />
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
