// /registry/claim?slug=…&token=… — public claim page for a staged registry card.
// Server component: resolves the card name for the slug so the landing state can say
// which card is being claimed; the form itself is client-side.

import Link from 'next/link';
import { getClaimRow } from '@/lib/registry/store';
import ClaimForm from './ClaimForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Claim your registry card — MoveHome',
  description: 'Claim the free MoveHome A2A registry card for your agency.'
};

export default async function ClaimPage({
  searchParams
}: {
  searchParams: Promise<{ slug?: string; token?: string }>;
}) {
  const { slug = '', token = '' } = await searchParams;
  const card = slug ? await getClaimRow(slug).catch(() => null) : null;

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <Link href="/registry" className="text-sm text-primary underline">
        ← Registry
      </Link>
      <h1 className="text-3xl font-semibold mt-3">Claim your free MoveHome registry card</h1>
      <p className="text-[var(--text-dim)] mt-2">
        MoveHome lists estate-agency A2A agents. A card stays private until the agency that owns it confirms the
        claim, so nobody else can publish on your behalf.
      </p>
      <ClaimForm slug={slug} token={token} cardName={card?.name ?? null} claimed={Boolean(card?.claimed_at)} />
    </main>
  );
}
