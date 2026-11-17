import React from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { searchListings } from '@/lib/queries';
import { priceLabel, titleOf } from '@/lib/property-card';
import { isReservedSlug, getAgentBySlug, generateListingSlug, getCrmRef } from '@/lib/agent-routing';
import CrmRefPill from '@/components/CrmRefPill';

export const revalidate = 60;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (isReservedSlug(slug)) {
    return { title: 'MoveHome.org' };
  }
  const profile = await getAgentBySlug(slug);
  if (!profile) {
    return { title: 'Agent Not Found — MoveHome.org' };
  }
  const agentSlug = profile.slug || slug;
  return {
    title: `${profile.name} · Agent Storefront — MoveHome.org`,
    description: `Official Estate Agent Storefront for ${profile.legal_name} (${profile.registration_authority}). ${profile.incorporation_info}.`,
    alternates: { canonical: `https://app.movehome.org/${agentSlug}` }
  };
}

export default async function AgentStorefrontPage({ params }: Props) {
  const { slug } = await params;
  if (isReservedSlug(slug)) {
    notFound();
  }

  const profile = await getAgentBySlug(slug);
  if (!profile) {
    notFound();
  }

  const agentSlug = profile.slug || slug;
  const { results: allListings } = await searchListings({ agent_id: profile.agent_id, limit: 100 });
  const agentProperties = allListings.filter((l) => l.agent_id === profile.agent_id);

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 px-4 py-8 md:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        {/* Navigation back */}
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-emerald-400 transition"
          >
            ← Back to MoveHome
          </Link>
        </div>

        {/* Agent Header / Card */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 md:p-8 shadow-2xl space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              {profile.logo_url && (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-white/90 p-2 shadow-md">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={profile.logo_url}
                    alt={profile.name}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              )}
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400">
                    <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 20 20">
                      <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
                    </svg>
                    Verified RAIA Protocol Organisation
                  </span>
                  <span className="rounded-full border border-zinc-700/60 bg-zinc-900 px-2.5 py-0.5 text-[11px] font-mono text-zinc-300">
                    A2A Badge
                  </span>
                </div>
                <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">{profile.name}</h1>
                <p className="mt-1 text-sm font-mono text-emerald-400">{profile.registration_authority}</p>
                <p className="mt-0.5 text-xs text-zinc-400">{profile.incorporation_info}</p>
              </div>
            </div>

            <a
              href={`/agent/${profile.agent_id}/card.json`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-300 transition"
            >
              /agent/{profile.agent_id}/card.json ↗
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-zinc-800/80 pt-6 text-xs">
            <div>
              <span className="font-semibold text-zinc-400">Legal Name: </span>
              <span className="text-zinc-200">{profile.legal_name}</span>
            </div>
            <div>
              <span className="font-semibold text-zinc-400">Jurisdiction: </span>
              <span className="text-zinc-200">{profile.jurisdiction}</span>
            </div>
            <div>
              <span className="font-semibold text-zinc-400">Business Address: </span>
              <span className="text-zinc-200">{profile.business_address}</span>
            </div>
            <div>
              <span className="font-semibold text-zinc-400">Contact Email: </span>
              <a href={`mailto:${profile.email}`} className="text-emerald-400 hover:underline">
                {profile.email}
              </a>
            </div>
            <div>
              <span className="font-semibold text-zinc-400">Website: </span>
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 hover:underline"
              >
                {profile.website} ↗
              </a>
            </div>
            <div>
              <span className="font-semibold text-zinc-400">A2A Protocol Agent Card: </span>
              <a
                href={profile.agent_card_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 hover:underline truncate block"
              >
                {profile.agent_card_url} ↗
              </a>
            </div>
          </div>

          <div className="border-t border-zinc-800/80 pt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
              Licences &amp; Redress
            </h3>
            <div className="flex flex-wrap gap-2">
              {profile.licences.map((licence) => (
                <span
                  key={licence}
                  className="rounded-full border border-zinc-700/60 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-300"
                >
                  ✓ {licence}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Listed Properties */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white tracking-tight">
              Properties Listed by {profile.name} ({agentProperties.length})
            </h2>
          </div>

          {agentProperties.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
              No active listings currently displayed for this estate agent.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {agentProperties.map((p) => {
                const photo = p.photo_url || p.featured_image_url || p.photos?.[0]?.url;
                const listingSlug = generateListingSlug(p);
                const crmRef = p.external_id ?? getCrmRef(p);
                const canonicalHref = `/${agentSlug}/${listingSlug}`;

                return (
                  <Link
                    key={p.raia_id}
                    href={canonicalHref}
                    className="group flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60 transition hover:border-emerald-500/50"
                  >
                    <div className="relative h-48 w-full bg-zinc-900">
                      {photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={photo}
                          alt={titleOf(p)}
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                          No Photo
                        </div>
                      )}
                      <div className="absolute top-2.5 left-2.5 rounded-full bg-zinc-950/80 backdrop-blur px-3 py-1 text-xs font-bold text-white">
                        {priceLabel(p)}
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col justify-between p-4 space-y-3">
                      <div>
                        <h3 className="line-clamp-1 text-sm font-bold text-zinc-100 group-hover:text-emerald-400 transition">
                          {titleOf(p)}
                        </h3>
                        <p className="mt-1 truncate text-xs text-zinc-400">
                          {[p.suburb, p.postcode_district].filter(Boolean).join(', ')}
                        </p>
                      </div>

                      <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-between">
                        <CrmRefPill refId={crmRef} copyUrl={`https://app.movehome.org${canonicalHref}`} />
                        <span className="text-xs text-zinc-500 font-medium group-hover:text-emerald-400 transition">
                          View details →
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}