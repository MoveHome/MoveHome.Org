import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

interface DemoListing {
  id: string;
  venue_id: string;
  headline: string | null;
  property_type: string | null;
  bedrooms: number | null;
  rent_pcm: number | null;
  currency: string | null;
  un_locode: string | null;
  photo_file_id: string | null;
  created_at: string | null;
}

function price(listing: DemoListing): string {
  if (listing.rent_pcm == null) return 'Price on application';
  const amount = listing.rent_pcm.toLocaleString('en-GB');
  return `${listing.currency ?? 'GBP'} ${amount} pcm`;
}

// Public demo listing page. Reads through demo_get_listing (security definer,
// public projection only — no retract_code, no telegram identity).
export default async function DemoLiveListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = process.env.DEMO_SUPABASE_URL;
  const key = process.env.DEMO_SUPABASE_ANON_KEY;
  if (!url || !key) notFound();

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc('demo_get_listing', { p_id: id });
  if (error || !data) notFound();

  const listing = data as DemoListing;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <p className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Demo listing — not a real property.
      </p>
      <h1 className="text-2xl font-semibold">{listing.headline ?? 'Demo listing'}</h1>
      <dl className="mt-6 space-y-2 text-base">
        <div className="flex gap-2">
          <dt className="text-neutral-500">Price</dt>
          <dd>{price(listing)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-neutral-500">Bedrooms</dt>
          <dd>{listing.bedrooms ?? '—'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-neutral-500">Type</dt>
          <dd>{listing.property_type ?? '—'}</dd>
        </div>
      </dl>
      {listing.photo_file_id ? (
        <p className="mt-4 text-sm text-neutral-600">Photo sent at the booth (stored for the demo board).</p>
      ) : null}
      <p className="mt-8 text-sm text-neutral-500">
        Booth: {listing.venue_id}
        {listing.un_locode ? ` · ${listing.un_locode}` : ''}
      </p>
    </main>
  );
}
