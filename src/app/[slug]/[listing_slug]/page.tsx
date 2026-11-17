import React from 'react';
import { notFound, redirect, permanentRedirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getListingByRef, searchListings } from '@/lib/queries';
import PropertyDeck from '@/components/PropertyDeck';
import { priceLabel, titleOf } from '@/lib/property-card';
import {
  isReservedSlug,
  getAgentBySlug,
  generateListingSlug,
  parseListingSlugRef
} from '@/lib/agent-routing';

export const revalidate = 60;

interface Props {
  params: Promise<{ slug: string; listing_slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, listing_slug } = await params;
  if (isReservedSlug(slug)) {
    return { title: 'MoveHome.org' };
  }

  const profile = await getAgentBySlug(slug);
  if (!profile) return { title: 'Property not found — MoveHome.org' };

  const parsed = parseListingSlugRef(listing_slug);
  const listing = await getListingByRef(profile.agent_id, parsed.ref);
  if (!listing) return { title: 'Property not found — MoveHome.org' };

  const agentSlug = profile.slug || slug;
  const canonicalSlug = generateListingSlug(listing);

  return {
    title: `${priceLabel(listing)} · ${titleOf(listing)} — ${profile.name}`,
    description: listing.marketing_description?.slice(0, 160) ?? undefined,
    alternates: {
      canonical: `https://app.movehome.org/${agentSlug}/${canonicalSlug}`
    }
  };
}

export default async function AgentListingDetailPage({ params }: Props) {
  const { slug, listing_slug } = await params;
  if (isReservedSlug(slug)) {
    notFound();
  }

  const profile = await getAgentBySlug(slug);
  if (!profile) {
    notFound();
  }

  const parsed = parseListingSlugRef(listing_slug);
  const listing = await getListingByRef(profile.agent_id, parsed.ref);
  if (!listing) {
    notFound();
  }

  const agentSlug = profile.slug || slug;
  const canonicalSlug = generateListingSlug(listing);

  // If user visits direct CRM ref app.movehome.org/[slug]/10492 (or raw ref), issue 308 redirect
  if (parsed.isRawRef || listing_slug !== canonicalSlug) {
    permanentRedirect(`/${agentSlug}/${canonicalSlug}`);
  }

  // Fetch sibling listings for this agent or nearby cluster
  const { results } = await searchListings({ agent_id: profile.agent_id, limit: 12 });
  const siblings = results.filter((l) => l.raia_id !== listing.raia_id);

  return <PropertyDeck listings={[listing, ...siblings]} initialRaiaId={listing.raia_id} />;
}