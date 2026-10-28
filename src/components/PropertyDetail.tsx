import type { Listing } from '@/lib/types';
import AgentAttribution from './AgentAttribution';

function formatPrice(l: Listing): string {
  if (!l.currency) return 'Price on application';
  const fmt = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: l.currency,
    maximumFractionDigits: 0
  });
  if (l.service_type === 'long_term' && l.rent_pcm) return `${fmt.format(l.rent_pcm)} pcm`;
  if (l.service_type === 'short_term' && l.daily_rate) return `${fmt.format(l.daily_rate)} / night`;
  if (l.service_type === 'sale' && l.asking_price) return fmt.format(l.asking_price);
  return 'Price on application';
}

export default function PropertyDetail({ listing }: { listing: Listing }) {
  const photos = listing.photos.length > 0
    ? listing.photos
    : listing.photo_url
      ? [{ url: listing.photo_url }]
      : [];
  const gb = listing.jurisdiction_extensions?.gb;
  const th = listing.jurisdiction_extensions?.th;

  return (
    <article className="max-w-5xl mx-auto px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">
          {listing.headline ?? listing.suburb ?? listing.postcode_district ?? listing.raia_id}
        </h1>
        <p className="text-slate-500 mt-1 text-sm">
          {[listing.suburb, listing.postcode_district].filter(Boolean).join(', ')}
        </p>
        {listing.listing_status && listing.listing_status !== 'available' && (
          <span className="mt-3 inline-block rounded-full border border-[var(--border)] bg-[var(--bg-elev)] px-2.5 py-1 text-xs font-semibold capitalize text-[var(--text)]">
            {listing.listing_status.replace(/_/g, ' ')}
          </span>
        )}
        <p className="text-xl font-semibold text-primary mt-3">{formatPrice(listing)}</p>
      </header>

      {photos.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-6">
          {photos.slice(0, 6).map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={p.url}
              src={p.url}
              alt={p.caption ?? listing.raia_id}
              className="aspect-[4/3] w-full object-cover rounded"
              loading="lazy"
            />
          ))}
        </div>
      )}

      <section className="grid md:grid-cols-[1fr_280px] gap-8">
        <div>
          {listing.marketing_description && (
            <div className="prose prose-slate max-w-none whitespace-pre-line">
              {listing.marketing_description}
            </div>
          )}

          {listing.features.length > 0 && (
            <>
              <h2 className="text-lg font-semibold mt-8 mb-2">Features</h2>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {listing.features.map((f) => (
                  <li key={f} className="text-slate-700">· {f.replace(/_/g, ' ')}</li>
                ))}
              </ul>
            </>
          )}
        </div>

        <aside className="text-sm">
          <dl className="border border-slate-200 rounded p-4 grid grid-cols-2 gap-y-2">
            {listing.bedrooms != null && (
              <>
                <dt className="text-slate-500">Bedrooms</dt>
                <dd>{listing.bedrooms}</dd>
              </>
            )}
            {listing.bathrooms != null && (
              <>
                <dt className="text-slate-500">Bathrooms</dt>
                <dd>{listing.bathrooms}</dd>
              </>
            )}
            {listing.floor_area_sqm != null && (
              <>
                <dt className="text-slate-500">Floor area</dt>
                <dd>{listing.floor_area_sqm} m²</dd>
              </>
            )}
            {listing.furnishing && (
              <>
                <dt className="text-slate-500">Furnishing</dt>
                <dd>{listing.furnishing.replace(/_/g, ' ')}</dd>
              </>
            )}
            {listing.available_from && (
              <>
                <dt className="text-slate-500">Available</dt>
                <dd>{new Date(listing.available_from).toLocaleDateString('en-GB')}</dd>
              </>
            )}

            {gb?.tenure && (
              <>
                <dt className="text-slate-500">Tenure</dt>
                <dd>{gb.tenure.replace(/_/g, ' ')}</dd>
              </>
            )}
            {gb?.epc_rating && (
              <>
                <dt className="text-slate-500">EPC</dt>
                <dd>
                  {gb.epc_register_url ? (
                    <a
                      href={gb.epc_register_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-primary"
                    >
                      {gb.epc_rating}
                    </a>
                  ) : (
                    gb.epc_rating
                  )}
                </dd>
              </>
            )}
            {gb?.council_tax_band && (
              <>
                <dt className="text-slate-500">Council tax</dt>
                <dd>{gb.council_tax_band}</dd>
              </>
            )}

            {th?.bts_station && (
              <>
                <dt className="text-slate-500">BTS</dt>
                <dd>
                  {th.bts_station}
                  {th.bts_distance_m != null && ` (${th.bts_distance_m}m)`}
                </dd>
              </>
            )}
            {th?.foreign_ownership_eligible != null && (
              <>
                <dt className="text-slate-500">Foreign ownership</dt>
                <dd>{th.foreign_ownership_eligible ? 'Eligible' : 'Not eligible'}</dd>
              </>
            )}
          </dl>

          <div className="mt-4">
            <AgentAttribution agentId={listing.agent_id} agentCardUrl={listing.agent_card_url} />
          </div>

          {listing.enquiry_endpoint && (
            <a
              href={`/enquire?raia_id=${encodeURIComponent(listing.raia_id)}`}
              className="mt-4 block w-full text-center bg-primary text-white rounded py-2 hover:bg-primary-dark transition-colors"
            >
              Enquire
            </a>
          )}
        </aside>
      </section>
    </article>
  );
}
