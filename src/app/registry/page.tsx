// Public directory of real-estate A2A agents. Server component; reads filters from
// the query string and renders a filterable grid. All agent text is rendered as JSX
// text (React-escaped); no dangerouslySetInnerHTML anywhere.

import Link from 'next/link';
import { listAgents } from '@/lib/registry/store';
import { healthBadge, hostOf } from '@/lib/registry/ui';
import type { PublicRegistryAgent } from '@/lib/registry/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Real-Estate A2A Agent Registry — MoveHome.org',
  description: 'Discover real-estate agents that speak the Agent2Agent (A2A) protocol. Search by location, service type, and skill; health-checked and conformance-rated.'
};

const SERVICE_TYPES = ['long_term', 'short_term', 'sale'];
const PAGE_SIZE = 24;

function AgentTile({ a }: { a: PublicRegistryAgent }) {
  const badge = healthBadge(a);
  const skillCount = Array.isArray(a.skills) ? a.skills.length : 0;
  return (
    <Link
      href={`/registry/${a.slug}`}
      className="block rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-primary transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold text-lg leading-tight">{a.name || a.slug}</h2>
        {a.signature_verified ? <span title="Signed agent card" className="text-primary text-sm">✓ signed</span> : null}
      </div>
      {a.provider_org ? <p className="text-sm text-gray-500 mt-0.5">{a.provider_org}</p> : null}
      {a.description ? <p className="text-sm mt-2 line-clamp-3">{a.description}</p> : null}
      <div className="flex flex-wrap gap-1.5 mt-3">
        {(a.categories ?? []).slice(0, 4).map((c) => (
          <span key={c} className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800">{c}</span>
        ))}
      </div>
      <div className="flex items-center justify-between mt-3 text-xs">
        <span className={`px-2 py-0.5 rounded ${badge.cls}`}>{badge.text}</span>
        <span className="text-gray-500">{skillCount} skill{skillCount === 1 ? '' : 's'} · {hostOf(a.a2a_url) ?? '—'}</span>
      </div>
    </Link>
  );
}

export default async function RegistryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { agents, total } = await listAgents({
    search: sp.q || undefined,
    location: sp.location?.toUpperCase() || undefined,
    serviceType: sp.service_type || undefined,
    category: sp.category || undefined,
    healthyOnly: sp.healthy === 'true',
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="max-w-6xl mx-auto px-4 py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold">Real-Estate A2A Agent Registry</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2 max-w-2xl">
          A public directory of property agents that speak the Agent2Agent (A2A) protocol — discoverable,
          health-checked, and conformance-rated. Built by MoveHome.org.
        </p>
        <div className="mt-3 flex gap-3 text-sm">
          <Link href="/registry/submit" className="text-primary underline">Register your agent →</Link>
          <a href="/api/registry/v1/agents" className="text-primary underline">API</a>
          <a href="/skills.md" className="text-primary underline">Integration guide</a>
        </div>
      </header>

      <form method="get" className="grid sm:grid-cols-5 gap-2 mb-6">
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Search name / description" className="sm:col-span-2 border rounded px-3 py-2 bg-transparent" />
        <input name="location" defaultValue={sp.location ?? ''} placeholder="UN/LOCODE (GBLON)" className="border rounded px-3 py-2 bg-transparent" />
        <select name="service_type" defaultValue={sp.service_type ?? ''} className="border rounded px-3 py-2 bg-transparent">
          <option value="">Any service</option>
          {SERVICE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="submit" className="rounded bg-primary text-white px-4 py-2">Filter</button>
      </form>

      <p className="text-sm text-gray-500 mb-4">{total} agent{total === 1 ? '' : 's'} listed</p>

      {agents.length === 0 ? (
        <p className="text-gray-500">No agents match. <Link href="/registry/submit" className="text-primary underline">Register the first one.</Link></p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((a) => <AgentTile key={a.id} a={a} />)}
        </div>
      )}

      {pages > 1 ? (
        <nav className="flex gap-2 mt-8 text-sm">
          {Array.from({ length: pages }).slice(0, 20).map((_, i) => {
            const p = i + 1;
            const qs = new URLSearchParams({ ...(sp as Record<string, string>), page: String(p) }).toString();
            return (
              <Link key={p} href={`/registry?${qs}`} className={`px-3 py-1 rounded border ${p === page ? 'bg-primary text-white' : ''}`}>{p}</Link>
            );
          })}
        </nav>
      ) : null}
    </main>
  );
}
