'use client';

// Swipe deck shell: one hamburger, a clean top bar, and a filter-preferences
// sheet on the right. Owns the stream index, filters and localStorage saves.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Listing } from '@/lib/types';
import PropertyCard from './PropertyCard';
import {
  catalogCities,
  countryOf,
  locationsOf,
  priceGbp,
  priceMyr,
  priceThb,
  clusterOf
} from '@/lib/property-card';

const SAVED_KEY = 'movehome.saved.v1';
const VOICE_KEY = 'movehome.voice.v1';

type Tab = 'explore' | 'saved' | 'viewings';
type Service = 'all' | 'long_term' | 'short_term' | 'sale';
type Country = 'GB' | 'TH' | 'MY';

// Pinned first in the Locations picker; selecting it clears the filter.
const ALL_LOCATIONS = 'All Locations';

const SERVICE_FILTERS: [Service, string][] = [
  ['all', 'All'],
  ['long_term', 'Lettings (Rent)'],
  ['short_term', 'Short Let'],
  ['sale', 'Sales (Buy)']
];

const BUDGETS_GBP: [number, string][] = [
  [0, 'Any'],
  [1500, '≤ £1,500'],
  [2500, '≤ £2,500'],
  [4000, '≤ £4,000']
];

const BUDGETS_THB: [number, string][] = [
  [0, 'Any'],
  [20000, '≤ ฿20,000'],
  [40000, '≤ ฿40,000'],
  [80000, '≤ ฿80,000']
];

const BUDGETS_MYR: [number, string][] = [
  [0, 'Any'],
  [3000, '≤ RM 3,000'],
  [6000, '≤ RM 6,000'],
  [12000, '≤ RM 12,000']
];

const BEDROOMS: [number, string][] = [
  [-1, 'Any'],
  [0, 'Studio+'],
  [1, '1+'],
  [2, '2+'],
  [3, '3+']
];

const MENU_LINKS = [
  ['/', 'Home (movehome.org)'],
  ['/about', 'About MoveHome CIC'],
  ['/registry', 'Agent Registry'],
  ['/registry/submit', 'Register an Estate Agent'],
  ['/about#charter', 'The Charter'],
  ['/skills.md', 'Connect Your AI Agent']
] as const;

function readSaved(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const haystack = (l: Listing) =>
  [l.headline, l.marketing_description, l.development_name, ...l.features]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

export default function PropertyDeck({
  listings,
  initialRaiaId,
  defaultCountry = 'GB'
}: {
  listings: Listing[];
  initialRaiaId?: string;
  defaultCountry?: Country;
}) {
  const [country, setCountry] = useState<Country>(defaultCountry);
  const [locations, setLocations] = useState<string[]>([]);
  const [service, setService] = useState<Service>('all');
  const [budget, setBudget] = useState(0);
  const [beds, setBeds] = useState(-1);
  const [prompt, setPrompt] = useState('');
  const [voiceGender, setVoiceGender] = useState<'female' | 'male'>('female');
  const [modalLocQuery, setModalLocQuery] = useState('');
  const [modalLocPicking, setModalLocPicking] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState<Tab>('explore');
  const [saved, setSaved] = useState<string[]>([]);
  const [index, setIndex] = useState(() =>
    Math.max(0, listings.findIndex((l) => l.raia_id === initialRaiaId))
  );
  const modalLocSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSaved(readSaved());
    if (localStorage.getItem(VOICE_KEY) === 'male') setVoiceGender('male');
  }, []);

  function pickVoice(g: 'female' | 'male') {
    setVoiceGender(g);
    try {
      localStorage.setItem(VOICE_KEY, g);
    } catch {
      /* private mode — keep in-memory only */
    }
  }

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

  // Country's reference cities, merged with the suburbs live listings actually use.
  const locationOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const city of catalogCities(country)) seen.set(city.toLowerCase(), city);
    for (const l of listings) {
      const c = countryOf(l);
      if (c && c !== country) continue;
      for (const loc of locationsOf(l)) {
        seen.set(loc.toLowerCase(), loc);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [listings, country]);

  const suggestions = useMemo(() => {
    const q = modalLocQuery.trim().toLowerCase();
    const cities = locationOptions.filter(
      (o) => !locations.includes(o) && (!q || o.toLowerCase().includes(q))
    );
    const all = !q || ALL_LOCATIONS.toLowerCase().includes(q) ? [ALL_LOCATIONS] : [];
    return [...all, ...cities].slice(0, 8);
  }, [locationOptions, locations, modalLocQuery]);

  function pickLocation(opt: string) {
    setLocations((prev) => (opt === ALL_LOCATIONS ? [] : [...prev, opt]));
    setModalLocQuery('');
    modalLocSearchRef.current?.focus();
  }

  const handleCountryChange = (newCountry: Country) => {
    setCountry(newCountry);
    setBudget(0);
    setLocations([]);
    setModalLocQuery('');
  };

  const activeCount =
    (country !== defaultCountry ? 1 : 0) +
    (locations.length > 0 ? 1 : 0) +
    (service !== 'all' ? 1 : 0) +
    (budget > 0 ? 1 : 0) +
    (beds >= 0 ? 1 : 0) +
    (prompt.trim() ? 1 : 0);

  const stream = useMemo(() => {
    const tokens = prompt.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return listings.filter((l) => {
      if (tab === 'saved') return saved.includes(l.raia_id);
      if (tab === 'viewings') return false;

      const c = countryOf(l);
      if (c && c !== country) return false;

      if (
        locations.length &&
        !locationsOf(l).some((loc) => locations.some((s) => s.toLowerCase() === loc.toLowerCase()))
      ) {
        return false;
      }
      if (service !== 'all' && l.service_type !== service) return false;
      if (budget > 0 && l.service_type !== 'sale') {
        const price = country === 'TH' ? priceThb(l) : country === 'MY' ? priceMyr(l) : priceGbp(l);
        // Unknown price stays visible — hiding it silently loses listings.
        if (price != null && price > budget) return false;
      }
      if (beds >= 1 && (l.bedrooms ?? 0) < beds) return false;
      // Every keyword must match: refinement, not recall.
      if (tokens.length) {
        const hay = haystack(l);
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }, [listings, country, locations, service, budget, beds, prompt, tab, saved]);

  const safeIndex = Math.min(index, Math.max(0, stream.length - 1));
  const current = stream[safeIndex];

  // A filter change invalidates the position in the stream.
  useEffect(() => {
    setIndex(0);
    setDrawer(false);
  }, [country, locations, service, budget, beds, prompt, tab]);

  // Silently warm the next card's first frame (image or video poster) and prefetch audio TTS.
  useEffect(() => {
    const nextListing = stream[safeIndex + 1];
    if (!nextListing) return;
    const src =
      nextListing.photo_url ||
      nextListing.featured_image_url ||
      nextListing.photos?.[0]?.url ||
      nextListing.video_url;
    if (src) {
      const img = new window.Image();
      img.src = src;
    }
    // N+1 audio prefetch with cancellation signal to prevent runaway/overlapping fetches
    const controller = new AbortController();
    const lang = countryOf(nextListing) === 'TH' ? 'th-TH' : 'en-GB';
    fetch(
      `/api/tts?raia_id=${encodeURIComponent(nextListing.raia_id)}&lang=${lang}&gender=${voiceGender}`,
      { signal: controller.signal }
    ).catch(() => {});
    return () => controller.abort();
  }, [stream, safeIndex, voiceGender]);

  const go = (delta: number) => {
    setDrawer(false);
    setIndex(Math.max(0, Math.min(stream.length - 1, safeIndex + delta)));
  };

  // Keyboard: arrows move property (↑/↓) or photo (←/→); i/Enter opens details.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (drawer || filterOpen || menuOpen) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'i' || e.key === 'Enter') {
        setDrawer(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, filterOpen, menuOpen, safeIndex, stream.length]);

  const emptyCopy =
    tab === 'saved'
      ? ['No saved properties yet', 'Tap the heart on a card to keep it here.']
      : tab === 'viewings'
        ? ['No viewings booked yet', 'Book one from any card.']
        : ['No properties match', 'Try removing a location or filter.'];

  const budgets = country === 'TH' ? BUDGETS_THB : country === 'MY' ? BUDGETS_MYR : BUDGETS_GBP;

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-[#09090b] text-zinc-100">
      {/* Top bar: hamburger button (left) · filter settings button (right) */}
      <header className="relative z-30 shrink-0 border-b border-zinc-800/60 bg-[#0a0a0c] px-3 pb-2 pt-3">
        <div className="mx-auto flex w-full max-w-[420px] items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label="Menu"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-200 transition-colors hover:border-emerald-500"
          >
            <MenuIcon />
          </button>

          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            aria-label={`Filter preferences${activeCount ? `, ${activeCount} active` : ''}`}
            className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-zinc-900 transition-colors ${
              activeCount
                ? 'border-emerald-500 text-emerald-400'
                : 'border-zinc-800 text-zinc-200 hover:border-emerald-500'
            }`}
          >
            <FilterIcon />
            {activeCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-bold text-emerald-950">
                {activeCount}
              </span>
            )}
          </button>
        </div>

        {menuOpen && (
          <nav className="absolute left-3 top-full z-40 mt-1 w-[220px] overflow-hidden rounded-2xl border border-zinc-800 bg-[#0a0a0c] py-1 shadow-2xl">
            {MENU_LINKS.map(([href, label]) => (
              <a
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className="block px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-emerald-500/10 hover:text-emerald-300"
              >
                {label}
              </a>
            ))}
          </nav>
        )}
      </header>

      {/* Deck viewport: full height on mobile, 375–420px card column on desktop */}
      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col px-3 pb-2 pt-1 min-h-0">
        <div className="relative flex-1 min-h-0">
          {current ? (
            <PropertyCard
              key={current.raia_id}
              listing={current}
              similar={listings.filter(
                (l) => l.raia_id !== current.raia_id && clusterOf(l) === clusterOf(current)
              )}
              saved={saved.includes(current.raia_id)}
              onToggleSave={toggleSave}
              onPass={() => go(1)}
              onRewind={() => go(-1)}
              drawer={drawer}
              onDrawerChange={setDrawer}
              keysEnabled={!filterOpen && !menuOpen}
              voiceGender={voiceGender}
              onSelect={(id) => {
                const i = stream.findIndex((l) => l.raia_id === id);
                if (i >= 0) go(i - safeIndex);
              }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 rounded-[26px] border border-dashed border-zinc-800 p-8 text-center">
              <p className="text-sm font-semibold">{emptyCopy[0]}</p>
              <p className="text-xs text-zinc-500">{emptyCopy[1]}</p>
            </div>
          )}

          {/* Desktop prev/next rail, outside the card */}
          <div className="pointer-events-none absolute -right-14 inset-y-0 hidden flex-col items-center justify-center gap-3 md:flex">
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous property"
              className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/90 text-zinc-200 hover:border-emerald-500 hover:text-emerald-400"
            >
              <ChevronIcon up />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next property"
              className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/90 text-zinc-200 hover:border-emerald-500 hover:text-emerald-400"
            >
              <ChevronIcon />
            </button>
          </div>
        </div>
        <p className="pt-1 text-center text-[10px] text-zinc-600">
          {current
            ? `${safeIndex + 1} / ${stream.length} · swipe up for next, down for previous`
            : '—'}
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

      {/* Filter preferences sheet */}
      {filterOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Filter preferences"
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70"
          onClick={() => setFilterOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90dvh] overflow-y-auto rounded-t-3xl border-t border-zinc-800 bg-[#0a0a0c] p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div className="mx-auto mb-3 flex w-full max-w-[420px] items-center justify-between">
              <h2 className="text-sm font-bold">Discovery settings</h2>
              <button
                type="button"
                onClick={() => setFilterOpen(false)}
                className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black"
              >
                Done
              </button>
            </div>

            <div className="mx-auto w-full max-w-[420px] space-y-4">
              <Section title="Country">
                <select
                  value={country}
                  onChange={(e) => handleCountryChange(e.target.value as Country)}
                  aria-label="Country"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-100 outline-none focus:border-emerald-500"
                >
                  <option value="MY">Malaysia</option>
                  <option value="TH">Thailand</option>
                  <option value="GB">United Kingdom</option>
                </select>
              </Section>

              <Section title="Locations">
                <div className="relative min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-2 focus-within:border-emerald-500">
                    {locations.map((loc) => (
                      <span
                        key={loc}
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-emerald-950"
                      >
                        {loc}
                        <button
                          type="button"
                          onClick={() => setLocations((prev) => prev.filter((x) => x !== loc))}
                          aria-label={`Remove ${loc}`}
                          className="text-emerald-950/80 hover:text-emerald-950"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      ref={modalLocSearchRef}
                      value={modalLocQuery}
                      onChange={(e) => setModalLocQuery(e.target.value)}
                      onFocus={() => setModalLocPicking(true)}
                      onBlur={() => setTimeout(() => setModalLocPicking(false), 120)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && suggestions[0]) {
                          pickLocation(suggestions[0]);
                          e.preventDefault();
                        } else if (e.key === 'Backspace' && !modalLocQuery && locations.length) {
                          setLocations((prev) => prev.slice(0, -1));
                        }
                      }}
                      placeholder={locations.length ? 'Add another location…' : 'Search locations… e.g. Fulham, Thonglor'}
                      aria-label="Search locations"
                      className="min-w-[7rem] flex-1 bg-transparent px-1 py-0.5 text-xs text-zinc-100 outline-none placeholder:text-zinc-500"
                    />
                  </div>

                  {modalLocPicking && suggestions.length > 0 && (
                    <ul className="absolute inset-x-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-xl border border-zinc-800 bg-[#0a0a0c] py-1 shadow-2xl [scrollbar-width:none]">
                      {suggestions.map((opt) => (
                        <li key={opt}>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pickLocation(opt)}
                            className="block w-full px-3 py-1.5 text-left text-xs font-semibold text-zinc-300 hover:bg-emerald-500/15 hover:text-emerald-300"
                          >
                            {opt}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Section>

              <Section title="Transaction type">
                <PillRow options={SERVICE_FILTERS} value={service} onChange={(v) => setService(v as Service)} />
              </Section>

              <Section title="Max budget per month">
                <PillRow options={budgets} value={budget} onChange={(v) => setBudget(Number(v))} />
              </Section>

              <Section title="Min bedrooms">
                <PillRow options={BEDROOMS} value={beds} onChange={(v) => setBeds(Number(v))} />
              </Section>

              <Section title="Narration voice">
                <PillRow
                  options={[
                    ['female', 'Female'],
                    ['male', 'Male']
                  ]}
                  value={voiceGender}
                  onChange={(v) => pickVoice(v as 'female' | 'male')}
                />
              </Section>

              <Section title="Refine with AI">
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. balcony, garden, near tube"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-xs outline-none placeholder:text-zinc-500 focus:border-emerald-500"
                />
                <p className="mt-1 text-[10px] text-zinc-500">
                  Filters features, headlines and descriptions as you type.
                </p>
              </Section>

              <button
                type="button"
                onClick={() => {
                  setCountry(defaultCountry);
                  setLocations([]);
                  setService('all');
                  setBudget(0);
                  setBeds(-1);
                  setPrompt('');
                  pickVoice('female');
                }}
                className="w-full rounded-full border border-zinc-800 py-2 text-[11px] font-semibold text-zinc-400 hover:text-zinc-200"
              >
                Reset filters
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500">{title}</h3>
      {children}
    </section>
  );
}

function PillRow({
  options,
  value,
  onChange
}: {
  options: [string | number, string][];
  value: string | number;
  onChange: (v: string | number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
            value === id
              ? 'border-emerald-500 bg-emerald-500 text-emerald-950'
              : 'border-zinc-800 bg-zinc-900 text-zinc-400'
          }`}
        >
          {label}
        </button>
      ))}
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

function MenuIcon() {
  return (
    <svg {...svgProps(18)}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="14" y2="12" />
      <line x1="4" y1="17" x2="18" y2="17" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg {...svgProps(18)}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="9" cy="7" r="2" fill="currentColor" />
      <circle cx="15" cy="12" r="2" fill="currentColor" />
      <circle cx="8" cy="17" r="2" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon({ up }: { up?: boolean }) {
  return (
    <svg {...svgProps(18)}>
      <polyline points={up ? '6 14 12 8 18 14' : '6 10 12 16 18 10'} />
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