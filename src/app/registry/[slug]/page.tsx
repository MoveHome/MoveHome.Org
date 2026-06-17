// Agent detail page. Server component; renders the registered card, derived facets,
// and health/conformance. All agent text is React-escaped; outbound URLs go through
// safeHref so a card cannot inject a javascript:/data: link.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAgent } from '@/lib/registry/store';
import { safeHref, healthBadge, hostOf } from '@/lib/registry/ui';
import FlagButton from '@/components/registry/FlagButton';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = await getAgent(slug);
  if (!a) return { title: 'Agent not found — MoveHome A2A Registry' };
  return {
    title: `${a.name || a.slug} — MoveHome A2A Registry`,
    description: a.description ?? `A real-estate A2A agent listed on the MoveHome registry.`
  };
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 border-b border-gray-100 dark:border-gray-800 text-sm">
      <span className="w-40 shrink-0 text-gray-500">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export default async function AgentDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = await getAgent(slug);
  if (!a) notFound();

  const badge = healthBadge(a);
  const cardLink = safeHref(a.well_known_uri);
  const a2aLink = safeHref(a.a2a_url);
  const provLink = safeHref(a.provider_url);
  const docLink = safeHref(a.documentation_url);
  const skills = Array.isArray(a.skills) ? a.skills : [];

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/registry" className="text-sm text-primary underline">← Registry</Link>

      <header className="mt-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{a.name || a.slug}</h1>
          {a.provider_org ? <p className="text-gray-500 mt-1">{a.provider_org}</p> : null}
        </div>
        <div className="flex flex-col items-end gap-1 text-xs">
          <span className={`px-2 py-0.5 rounded ${badge.cls}`}>{badge.text}</span>
          {a.signature_verified ? <span className="text-primary">✓ signed card</span> : null}
          {a.domain_verified ? <span className="text-primary">✓ domain verified</span> : null}
        </div>
      </header>

      {a.description ? <p className="mt-4">{a.description}</p> : null}

      <section className="mt-6">
        <Row label="A2A endpoint">{a2aLink ? <a className="text-primary underline" href={a2aLink}>{hostOf(a2aLink)}{new URL(a2aLink).pathname}</a> : '—'}</Row>
        <Row label="Agent card">{cardLink ? <a className="text-primary underline" href={cardLink}>view card</a> : '—'}</Row>
        <Row label="Protocol">{a.protocol_version ?? '—'} · {a.preferred_transport ?? '—'}</Row>
        <Row label="Locations">{a.locations?.length ? a.locations.join(', ') : '—'}</Row>
        <Row label="Service types">{a.service_types?.length ? a.service_types.join(', ') : '—'}</Row>
        <Row label="Categories">{a.categories?.length ? a.categories.join(', ') : '—'}</Row>
        {docLink ? <Row label="Docs"><a className="text-primary underline" href={docLink}>documentation</a></Row> : null}
        {provLink ? <Row label="Provider"><a className="text-primary underline" href={provLink}>{hostOf(provLink)}</a></Row> : null}
      </section>

      <section className="mt-6">
        <h2 className="text-xl font-semibold mb-2">Skills ({skills.length})</h2>
        <div className="space-y-3">
          {skills.map((s) => (
            <div key={s.id} className="rounded border border-gray-200 dark:border-gray-700 p-3">
              <div className="font-medium">{s.name || s.id} <span className="text-xs text-gray-500 font-mono">{s.id}</span></div>
              {s.description ? <p className="text-sm mt-1">{s.description}</p> : null}
              {s.tags?.length ? (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {s.tags.slice(0, 10).map((t) => <span key={t} className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800">{t}</span>)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 text-sm text-gray-600 dark:text-gray-400">
        <h2 className="text-xl font-semibold mb-2 text-current">Health &amp; conformance</h2>
        <Row label="Conformance">{a.task_conformance?.category ?? 'unchecked'}</Row>
        <Row label="Uptime">{a.uptime_percentage != null ? `${a.uptime_percentage}%` : '—'}</Row>
        <Row label="Avg response">{a.avg_response_ms != null ? `${a.avg_response_ms} ms` : '—'}</Row>
        <Row label="Last check">{a.last_health_check ? new Date(a.last_health_check).toUTCString() : 'not yet checked'}</Row>
      </section>

      <div className="mt-8">
        <FlagButton agentId={a.id} />
      </div>
    </main>
  );
}
