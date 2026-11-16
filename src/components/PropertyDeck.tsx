'use client';

// Swipe deck shell: filter + location-cluster pill bar, one card at a time,
// saved badge in the bottom nav. Owns the stream index and localStorage saves.

import { useEffect, useMemo, useState } from 'react';
import type { Listing } from '@/lib/types';
import TinderPropertyCard from './TinderPropertyCard';
import { CLUSTER_PILLS, clusterOf } from '@/lib/property-card';

const SAVED_KEY = 'movehome.saved.v1';

type Tab = 'explore' | 'saved' | 'viewings';

const SERVICE_FILTERS = [
  ['all', 'All types'],
  ['long_term', 'Rent (Long term)'],
  ['short_term', 'Short let'],
  ['sale', 'Buy']
] as const;

const SITE_LINKS = [
  ['https://movehome.org', 'Main Website'],
  ['/about', 'About MoveHome CIC'],
  ['/registry', 'Agent Registry'],
  ['/about#charter', 'The Charter']
] as const;

function readSaved(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export default function PropertyDeck({
  listings,
  initialRaiaId
}: {
  listings: Listing[];
  initialRaiaId?: string;
}) {
  const [pill, setPill] = useState<string>('all');
  const [service, setService] = useState<'all' | 'long_term' | 'short_term' | 'sale'>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('explore');
  const [saved, setSaved] = useState<string[]>([]);
  const [index, setIndex] = useState(() =>
    Math.max(0, listings.findIndex((l) => l.raia_id === initialRaiaId))
  );

  useEffect(() => setSaved(readSaved()), []);

  // Saved badge in the nav must follow heart taps anywhere in the card.
  function toggleSave(id: string) {
    setSaved((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      } catch {
        /* private mode — keep in-memory only */
      }
      return next;
    });
  }

  const stream = useMemo(
    () =>
      listings.filter((l) =>
        tab === 'saved'
          ? saved.includes(l.raia_id)
          : tab === 'viewings'
            ? false
            : (pill === 'all' || clusterOf(l) === pill) && (service === 'all' || l.service_type === service)
      ),
    [listings, pill, service, tab, saved]
  );

  const safeIndex = Math.min(index, Math.max(0, stream.length - 1));
  const current = stream[safeIndex];

  const emptyCopy =
    tab === 'saved'
      ? ['No saved properties yet', 'Tap the heart on a card to keep it here.']
      : tab === 'viewings'
        ? ['No viewings booked yet', 'Book one from any card.']
        : ['No properties in this cluster', 'Try the All filter.'];

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-[#09090b] text-zinc-100">
      {/* Top filter bar */}
      <header className="relative z-30 shrink-0 border-b border-zinc-800/60 bg-[#0a0a0c] px-3 pb-2 pt-3">
        <div className="mx-auto flex w-full max-w-[420px] items-center gap-2">
          <a
            href="https://movehome.org"
            aria-label="MoveHome.org home"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-200 transition-colors hover:border-emerald-500"
          >
            <HomeIcon />
          </a>
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            aria-expanded={filterOpen}
            aria-label="Filters and site menu"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-zinc-900 transition-colors ${
              filterOpen || service !== 'all'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-zinc-800 text-zinc-200 hover:border-emerald-500'
            }`}
          >
            <MenuIcon />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none]">
            {CLUSTER_PILLS.map((p) => {
              const active = tab === 'explore' && pill === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setTab('explore');
                    setPill(p.id);
                    setIndex(0);
                  }}
                  className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    active
                      ? 'border-emerald-500 bg-emerald-500 font-bold text-emerald-950'
                      : 'border-zinc-800 bg-zinc-900/90 font-semibold text-zinc-400'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {filterOpen && (
          <div className="absolute left-1/2 top-full z-30 mt-1 w-[min(420px,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl border border-zinc-800 bg-[#0a0a0c] p-3 shadow-2xl">
            <div className="flex flex-wrap gap-1.5">
              {SERVICE_FILTERS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setService(id);
                    setTab('explore');
                    setIndex(0);
                  }}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
                    service === id
                      ? 'border-emerald-500 bg-emerald-500 text-emerald-950'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-col divide-y divide-zinc-800/80 border-t border-zinc-800/80 pt-1">
              {SITE_LINKS.map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  className="py-2 text-xs font-semibold text-zinc-300 hover:text-emerald-400"
                >
                  {label}
                </a>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Deck viewport: full height on mobile, 375–420px card column on desktop */}
      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col px-3 pb-2 pt-1 min-h-0">
        <div className="relative flex-1 min-h-0">
          {current ? (
            <TinderPropertyCard
              key={current.raia_id}
              listing={current}
              similar={listings.filter(
                (l) => l.raia_id !== current.raia_id && clusterOf(l) === clusterOf(current)
              )}
              saved={saved.includes(current.raia_id)}
              onToggleSave={toggleSave}
              onPass={() => setIndex(Math.min(stream.length - 1, safeIndex + 1))}
              onRewind={() => setIndex(Math.max(0, safeIndex - 1))}
              onSelect={(id) => {
                const i = stream.findIndex((l) => l.raia_id === id);
                if (i >= 0) setIndex(i);
              }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 rounded-[26px] border border-dashed border-zinc-800 p-8 text-center">
              <p className="text-sm font-semibold">{emptyCopy[0]}</p>
              <p className="text-xs text-zinc-500">{emptyCopy[1]}</p>
            </div>
          )}
        </div>
        <p className="pt-1 text-center text-[10px] text-zinc-600">
          {current ? `${safeIndex + 1} / ${stream.length} · swipe or tap to explore` : '—'}
        </p>
      </main>

      {/* Bottom navigation */}
      <nav className="shrink-0 border-t border-zinc-800/80 bg-[#050507]">
        <div className="mx-auto grid w-full max-w-[420px] grid-cols-4 py-2 text-[10px] font-semibold">
          <button
            type="button"
            onClick={() => {
              setTab('explore');
              setIndex(0);
            }}
            className={`flex flex-col items-center gap-1 ${
              tab === 'explore' ? 'text-emerald-400' : 'text-zinc-500'
            }`}
          >
            <PlayCircleIcon />
            Reels
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('saved');
              setIndex(0);
            }}
            className={`relative flex flex-col items-center gap-1 ${
              tab === 'saved' ? 'text-emerald-400' : 'text-zinc-500'
            }`}
          >
            <HeartNavIcon active={tab === 'saved'} />
            Saved
            {saved.length > 0 && (
              <span className="absolute left-1/2 top-0 ml-2.5 rounded-full bg-red-500 px-1.5 text-[9px] leading-4 text-white">
                {saved.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('viewings');
              setIndex(0);
            }}
            className={`flex flex-col items-center gap-1 ${
              tab === 'viewings' ? 'text-emerald-400' : 'text-zinc-500'
            }`}
          >
            <CalendarIcon />
            Viewings
          </button>
          <a href="/registry" className="flex flex-col items-center gap-1 text-zinc-500 hover:text-emerald-400">
            <ShieldIcon />
            Agents
          </a>
        </div>
      </nav>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────

function svgProps(size = 20) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  };
}

function HomeIcon() {
  return (
    <svg {...svgProps(18)}>
      <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg {...svgProps(18)}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="14" y2="12" />
      <line x1="4" y1="17" x2="18" y2="17" />
    </svg>
  );
}

function PlayCircleIcon() {
  return (
    <svg {...svgProps()}>
      <circle cx="12" cy="12" r="9" />
      <polygon points="10 8.5 16 12 10 15.5" />
    </svg>
  );
}

function HeartNavIcon({ active }: { active: boolean }) {
  return (
    <svg {...svgProps()} fill={active ? '#ef4444' : 'none'} stroke={active ? '#ef4444' : 'currentColor'}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg {...svgProps()}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
      <line x1="3" y1="11" x2="21" y2="11" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M12 3 5 6v6c0 4.4 3 7.7 7 9 4-1.3 7-4.6 7-9V6z" />
      <polyline points="9 12 11.5 14.5 15.5 9.5" />
    </svg>
  );
}
