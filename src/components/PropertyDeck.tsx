'use client';

// Swipe deck shell: filter + location-cluster pill bar, one card at a time,
// saved badge in the bottom nav. Owns the stream index and localStorage saves.

import { useEffect, useMemo, useState } from 'react';
import type { Listing } from '@/lib/types';
import TinderPropertyCard from './TinderPropertyCard';
import { CLUSTER_PILLS, clusterOf } from '@/lib/property-card';

const SAVED_KEY = 'movehome.saved.v1';

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
  const [tab, setTab] = useState<'explore' | 'saved'>('explore');
  const [saved, setSaved] = useState<string[]>([]);
  const [index, setIndex] = useState(() =>
    Math.max(0, listings.findIndex((l) => l.raia_id === initialRaiaId))
  );

  useEffect(() => setSaved(readSaved()), []);

  // Saved badge in the nav must follow ❤️ taps anywhere in the card.
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
          : (pill === 'all' || clusterOf(l) === pill) && (service === 'all' || l.service_type === service)
      ),
    [listings, pill, service, tab, saved]
  );

  const safeIndex = Math.min(index, Math.max(0, stream.length - 1));
  const current = stream[safeIndex];

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-[var(--bg)] text-[var(--text)]">
      {/* Filter & location cluster pill bar */}
      <header className="shrink-0 px-3 pb-1 pt-3">
        <div className="mx-auto flex w-full max-w-[420px] items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            aria-expanded={filterOpen}
            aria-label="Filters"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm ${
              filterOpen || service !== 'all'
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-[var(--border)] bg-[var(--bg-card)]'
            }`}
          >
            ☰
          </button>
          {CLUSTER_PILLS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setTab('explore');
                setPill(p.id);
                setIndex(0);
              }}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === 'explore' && pill === p.id
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white dark:text-black'
                  : 'border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-dim)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {filterOpen && (
          <div className="mx-auto mt-1 flex w-full max-w-[420px] gap-1.5">
            {(
              [
                ['all', 'All types'],
                ['long_term', 'Rent'],
                ['short_term', 'Short let'],
                ['sale', 'Buy']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setService(id);
                  setIndex(0);
                }}
                className={`flex-1 rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                  service === id
                    ? 'border-[var(--accent)] bg-[var(--tint-light)] text-[var(--accent)]'
                    : 'border-[var(--border)] text-[var(--text-dim)]'
                }`}
              >
                {label}
              </button>
            ))}
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
            <div className="flex h-full flex-col items-center justify-center gap-2 rounded-[26px] border border-dashed border-[var(--border)] p-8 text-center">
              <p className="text-3xl">🏙️</p>
              <p className="text-sm font-semibold">
                {tab === 'saved' ? 'No saved properties yet' : 'No properties in this cluster'}
              </p>
              <p className="text-xs text-[var(--text-dim)]">
                {tab === 'saved' ? 'Tap ❤️ on a card to keep it here.' : 'Try the All filter.'}
              </p>
            </div>
          )}
        </div>
        <p className="pt-1 text-center text-[10px] text-[var(--text-faint)]">
          {current ? `${safeIndex + 1} / ${stream.length} · swipe or tap to explore` : '—'}
        </p>
      </main>

      {/* Bottom nav with saved badge */}
      <nav className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-card)]">
        <div className="mx-auto grid w-full max-w-[420px] grid-cols-3 py-2 text-[10px] font-semibold">
          <button
            type="button"
            onClick={() => {
              setTab('explore');
              setIndex(0);
            }}
            className={tab === 'explore' ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'}
          >
            <span className="block text-lg leading-5">🏠</span>
            Explore
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('saved');
              setIndex(0);
            }}
            className={`relative ${tab === 'saved' ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'}`}
          >
            <span className="block text-lg leading-5">❤️</span>
            Saved
            {saved.length > 0 && (
              <span className="absolute left-1/2 top-0 ml-3 rounded-full bg-rose-500 px-1.5 text-[9px] leading-4 text-white">
                {saved.length}
              </span>
            )}
          </button>
          <a href="/registry" className="text-[var(--text-faint)]">
            <span className="block text-lg leading-5">🤖</span>
            Agents
          </a>
        </div>
      </nav>
    </div>
  );
}
