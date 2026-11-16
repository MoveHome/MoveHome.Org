'use client';

// Mobile-first Tinder/Reel property card: video-first media stage with
// tap/swipe slides, HUD rendered once in React (never burned into media), an
// ↑ expanded description drawer and a ✈️ viewing-slot sheet.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Listing } from '@/lib/types';
import {
  plainText,
  priceLabel,
  specGroups,
  statusLabel,
  titleOf,
  viewingSlots
} from '@/lib/property-card';

// ── Component ─────────────────────────────────────────────────────────────

interface Props {
  listing: Listing;
  similar?: Listing[];
  saved: boolean;
  onToggleSave: (id: string) => void;
  onPass: () => void;
  onRewind: () => void;
  onSelect: (id: string) => void;
}

type Slide = { kind: 'video' | 'photo'; url: string };

function slidesOf(l: Listing): Slide[] {
  const photos = (l.photos?.length
    ? [...l.photos].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((p) => p.url)
    : [l.photo_url, l.featured_image_url]
  ).filter((u): u is string => Boolean(u));
  return [
    ...(l.video_url ? [{ kind: 'video' as const, url: l.video_url }] : []),
    ...photos.map((url) => ({ kind: 'photo' as const, url }))
  ];
}

function areaOf(l: Listing): string {
  return [l.suburb, l.postcode_district ?? l.postcode_full].filter(Boolean).join(', ') || 'the area';
}

export default function TinderPropertyCard({
  listing,
  similar = [],
  saved,
  onToggleSave,
  onPass,
  onRewind,
  onSelect
}: Props) {
  const slides = useMemo(() => slidesOf(listing), [listing]);
  const [slide, setSlide] = useState(0);
  const [sound, setSound] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const swiped = useRef(false);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (slides[slide]?.kind === 'video') v.play().catch(() => {});
    else v.pause();
  }, [slide, slides]);

  const next = () => setSlide((s) => Math.min(slides.length - 1, s + 1));
  const prev = () => setSlide((s) => Math.max(0, s - 1));

  function speak() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const l = listing;
    const beds = l.bedrooms != null ? `${l.bedrooms} bedroom` : 'studio';
    const text =
      `${titleOf(l)}, ${areaOf(l)}. ${beds}, ${l.bathrooms ?? 1} bathroom` +
      `${l.floor_area_sqm ? `, ${l.floor_area_sqm} square metres` : ''}. ` +
      `${priceLabel(l)}, ${statusLabel(l).replace('🟢 ', '')}. ` +
      `Your MoveHome personal agent can book a viewing and handle the paperwork for you.`;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    window.speechSynthesis.speak(u);
  }

  const location = [listing.building_number, listing.street_name, listing.suburb, listing.postcode_full]
    .filter(Boolean)
    .join(', ');
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    listing.latitude != null && listing.longitude != null
      ? `${listing.latitude},${listing.longitude}`
      : location || titleOf(listing)
  )}`;

  return (
    <article className="relative h-full w-full select-none overflow-hidden rounded-[26px] bg-neutral-900 text-white shadow-2xl">
      {/* ── Media stage ───────────────────────────────────────────────── */}
      <div
        className="absolute inset-0 touch-pan-y"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const s = drag.current;
          drag.current = null;
          if (!s) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) {
            if (dy < -80) setDrawer(true);
            return;
          }
          swiped.current = true;
          if (dx < 0) onPass();
          else onRewind();
        }}
      >
        {slides.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-white/60">No media</div>
        )}
        {slides.map((s, i) =>
          s.kind === 'video' ? (
            <video
              key={s.url}
              ref={videoRef}
              src={s.url}
              poster={listing.photo_url ?? listing.featured_image_url ?? undefined}
              muted={!sound}
              autoPlay
              loop
              playsInline
              className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${
                i === slide ? '' : 'hidden'
              }`}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${s.url}-${i}`}
              src={s.url}
              alt={`${titleOf(listing)} — photo ${i + 1}`}
              className={`absolute inset-0 h-full w-full object-cover ${i === slide ? '' : 'hidden'}`}
            />
          )
        )}

        {/* Tap zones: right half next slide, left half previous */}
        <button
          type="button"
          aria-label="Previous photo"
          className="absolute inset-y-0 left-0 z-10 w-1/2"
          onClick={() => (swiped.current ? (swiped.current = false) : prev())}
        />
        <button
          type="button"
          aria-label="Next photo"
          className="absolute inset-y-0 right-0 z-10 w-1/2"
          onClick={() => (swiped.current ? (swiped.current = false) : next())}
        />

        {listing.video_url && (
          <button
            type="button"
            onClick={() => setSound((v) => !v)}
            aria-pressed={sound}
            className="absolute right-3 top-9 z-20 rounded-full bg-black/50 px-3 py-1.5 text-xs font-semibold backdrop-blur"
          >
            {sound ? '🔊 Sound On' : '🔇 Tap for Sound'}
          </button>
        )}
      </div>

      {/* Story pagination bars */}
      {slides.length > 1 && (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex gap-1.5">
          {slides.map((s, i) => (
            <span
              key={`${s.url}-bar-${i}`}
              className={`h-0.5 flex-1 rounded-full ${i <= slide ? 'bg-white' : 'bg-white/30'}`}
            />
          ))}
        </div>
      )}

      {/* ── HUD ──────────────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black via-black/70 to-transparent px-4 pb-4 pt-24">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            statusLabel(listing).startsWith('🟢')
              ? 'bg-emerald-500/20 text-emerald-200'
              : 'bg-amber-500/20 text-amber-200'
          }`}
        >
          {statusLabel(listing)}
        </span>
        <h2 className="mt-2 text-xl font-bold leading-tight">
          {priceLabel(listing)}{' '}
          <span className="font-semibold text-white/80">· {titleOf(listing)}</span>
        </h2>
        {specGroups(listing).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {specGroups(listing).map((s) => (
              <span key={s} className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium">
                {s}
              </span>
            ))}
          </div>
        )}

        {/* 5 standard action circles */}
        <div className="pointer-events-auto mt-4 flex items-center justify-center gap-3">
          <Action label="Rewind" onClick={onRewind}>↺</Action>
          <Action label="Pass" onClick={onPass}>✕</Action>
          <Action label="Voice summary" onClick={speak}>🔊</Action>
          <Action label={saved ? 'Remove from saved' : 'Save'} onClick={() => onToggleSave(listing.raia_id)} active={saved}>
            {saved ? '❤️' : '🤍'}
          </Action>
          <Action label="Book Viewing" onClick={() => setSheet(true)}>✈️</Action>
        </div>
      </div>

      {/* ↑ info button → drawer */}
      <button
        type="button"
        onClick={() => setDrawer(true)}
        aria-label="More about this property"
        className="absolute right-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 bg-black/40 text-lg font-bold backdrop-blur"
      >
        ↑
      </button>

      {/* ── State 2: expanded description drawer ─────────────────────── */}
      {drawer && (
        <div className="absolute inset-0 z-30 flex flex-col overflow-y-auto bg-neutral-950">
          <header className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-neutral-950/95 px-4 py-3 backdrop-blur">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">
                {priceLabel(listing)} · {titleOf(listing)}
              </p>
              <p className="truncate text-[11px] text-white/50">{areaOf(listing)}</p>
            </div>
            <button
              type="button"
              onClick={() => setDrawer(false)}
              aria-label="Collapse description"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-base font-bold text-black"
            >
              ↓
            </button>
          </header>

          <div className="relative h-40 shrink-0">
            {(listing.photo_url ?? listing.featured_image_url) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={listing.photo_url ?? listing.featured_image_url ?? ''}
                alt={titleOf(listing)}
                className="h-full w-full object-cover"
              />
            )}
            <button
              type="button"
              onClick={() => setSheet(true)}
              className="absolute bottom-3 right-3 rounded-full bg-white px-4 py-2 text-xs font-bold text-black shadow-lg"
            >
              ✈️ Book Viewing
            </button>
          </div>

          <div className="space-y-3 p-3">
            <Card title="Lease & Availability">
              <div className="flex flex-wrap gap-1.5">
                <Chip>{listing.service_type.replace(/_/g, ' ')}</Chip>
                <Chip>{statusLabel(listing)}</Chip>
                {specGroups(listing).map((s) => (
                  <Chip key={s}>{s}</Chip>
                ))}
                {listing.furnishing && <Chip>{listing.furnishing.replace(/_/g, ' ')}</Chip>}
              </div>
            </Card>

            <Card title="About this property">
              <p className="text-xs leading-relaxed text-white/70">
                {plainText(listing.marketing_description) || 'No description provided by the agent.'}
              </p>
            </Card>

            <Card title="Location & Google Maps">
              <p className="text-xs leading-relaxed text-white/70">
                {[titleOf(listing), areaOf(listing), listing.postcode_full].filter(Boolean).join(' · ')}
              </p>
              <a
                href={mapsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs font-semibold text-emerald-300 underline"
              >
                Open in Google Maps ↗
              </a>
            </Card>

            {similar.length > 0 && (
              <Card title="Similar Properties Nearby">
                {similar.slice(0, 3).map((s) => (
                  <button
                    key={s.raia_id}
                    type="button"
                    onClick={() => {
                      onSelect(s.raia_id);
                      setDrawer(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left hover:bg-white/5"
                  >
                    <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/10">
                      {(s.photo_url ?? s.featured_image_url) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={(s.photo_url ?? s.featured_image_url) as string}
                          alt={titleOf(s)}
                          className="h-full w-full object-cover"
                        />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold">{titleOf(s)}</span>
                      <span className="block text-[11px] text-white/60">{priceLabel(s)}</span>
                    </span>
                  </button>
                ))}
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ── State 3: viewing slot sheet ──────────────────────────────── */}
      {sheet && (
        <ViewingSheet listing={listing} onClose={() => setSheet(false)} />
      )}
    </article>
  );
}

function Action({
  label,
  onClick,
  active,
  children
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 items-center justify-center rounded-full border text-lg backdrop-blur transition-transform active:scale-90 ${
        active ? 'border-rose-400 bg-rose-500/25' : 'border-white/40 bg-black/35'
      }`}
    >
      {children}
    </button>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white/[0.06] p-3">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/50">{title}</h3>
      {children}
    </section>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] capitalize text-white/80">{children}</span>
  );
}

function ViewingSheet({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const slots = useMemo(() => viewingSlots(), []);
  const [slot, setSlot] = useState<string>('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [company, setCompany] = useState(''); // honeypot
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError('');
    const res = await fetch('/api/enquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raia_id: listing.raia_id,
        enquirer: { name, email, phone: phone || undefined, preferred_contact: phone ? 'phone' : 'email' },
        message: note.trim() || 'I would like to book a viewing.',
        viewing_request: slot ? { preferred_dates: [slot] } : undefined,
        company
      })
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `Request failed (${res.status})`);
      setStatus('error');
      return;
    }
    setStatus('sent');
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/60">
      <div className="max-h-[90%] overflow-y-auto rounded-t-3xl bg-neutral-900 p-4 text-white">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">Book a viewing</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-white/60">✕</button>
        </div>

        {status === 'sent' ? (
          <div className="py-8 text-center">
            <p className="text-3xl">✅</p>
            <p className="mt-2 text-sm font-semibold">Viewing requested</p>
            <p className="mt-1 text-xs text-white/60">
              We&apos;ve forwarded your request to the listing agent. They&apos;ll confirm shortly.
            </p>
            <button type="button" onClick={onClose} className="mt-4 rounded-full bg-white px-6 py-2 text-xs font-bold text-black">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-xs text-white/60">
              {titleOf(listing)} · {priceLabel(listing)}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {slots.map((s) => (
                <button
                  key={s.iso}
                  type="button"
                  onClick={() => setSlot(s.iso)}
                  className={`rounded-xl border px-2 py-2 text-[11px] font-medium ${
                    slot === s.iso ? 'border-white bg-white text-black' : 'border-white/20 bg-white/5'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-xl bg-white/10 px-3 py-2.5 text-sm placeholder-white/40 outline-none"
            />
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full rounded-xl bg-white/10 px-3 py-2.5 text-sm placeholder-white/40 outline-none"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone (optional)"
              className="w-full rounded-xl bg-white/10 px-3 py-2.5 text-sm placeholder-white/40 outline-none"
            />
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Anything we should know? (optional)"
              className="w-full rounded-xl bg-white/10 px-3 py-2.5 text-sm placeholder-white/40 outline-none"
            />
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="hidden"
            />
            {error && <p className="text-xs text-rose-300">{error}</p>}
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full rounded-full bg-white py-3 text-sm font-bold text-black disabled:opacity-60"
            >
              {status === 'sending' ? 'Sending…' : 'Book Viewing'}
            </button>
            <p className="pb-2 text-center text-[10px] text-white/40">
              Your personal agent handles confirmation, access and paperwork.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
