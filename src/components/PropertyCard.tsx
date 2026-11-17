'use client';

// Mobile-first property card: video-first media stage with tap/swipe slides,
// card deck physics & gesture model, HUD, expanded description drawer,
// viewing slot sheet, clickable Estate Agent pill, and Giraffe 360 virtual tour modal.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Listing } from '@/lib/types';
import { getEstateAgentProfile } from '@/lib/agent-directory';
import { classifyGesture } from '@/lib/gesture';
import DescriptionToggleButton from './DescriptionToggleButton';
import EstateAgentCardModal from './EstateAgentCardModal';
import {
  buildPropertyDescriptionWithCta,
  isVacant,
  priceLabel,
  specGroups,
  statusLabel,
  titleOf,
  ttsLocaleOf,
  viewingSlots,
  voiceMatchesGender,
  youtubeIdOf,
  type AppLang
} from '@/lib/property-card';

// ── Component ─────────────────────────────────────────────────────────────

interface Props {
  listing: Listing;
  similar?: Listing[];
  saved: boolean;
  onToggleSave: (id: string) => void;
  onSave: () => void;
  onPass: () => void;
  onRewind: () => void;
  onNextProperty: () => void;
  onPrevProperty: () => void;
  onSelect: (id: string) => void;
  drawer: boolean;
  onDrawerChange: (open: boolean) => void;
  keysEnabled?: boolean;
  voiceGender?: 'female' | 'male';
  appLang?: AppLang;
  onFilterByAgent?: (agentId: string) => void;
}

type MediaItem = { kind: 'video' | 'photo'; url: string };
type Narration = 'idle' | 'loading' | 'playing';

function slidesOf(l: Listing): MediaItem[] {
  const photos = (l.photos?.length
    ? [...l.photos].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((p) => p.url)
    : [l.photo_url, l.featured_image_url]
  ).filter((u): u is string => Boolean(u) && u !== l.floor_plan_url);
  return [
    // YouTube pages are not video files — they get their own player instead.
    ...(l.video_url && !youtubeIdOf(l.video_url)
      ? [{ kind: 'video' as const, url: l.video_url }]
      : []),
    ...photos.map((url) => ({ kind: 'photo' as const, url }))
  ];
}

// 1-sample silent WAV: playing it inside the click unlocks the same Audio
// element for iOS Safari, which rejects a later play() outside the gesture.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA';

const heroPhoto = (l: Listing) =>
  [l.photo_url, l.featured_image_url, ...l.photos.map((p) => p.url)].find(
    (u) => u && u !== l.floor_plan_url
  ) ?? null;

function areaOf(l: Listing): string {
  return [l.suburb, l.postcode_district ?? l.postcode_full].filter(Boolean).join(', ') || 'the area';
}

export default function PropertyCard({
  listing,
  similar = [],
  saved,
  onToggleSave,
  onSave,
  onPass,
  onRewind,
  onNextProperty,
  onPrevProperty,
  onSelect,
  drawer,
  onDrawerChange,
  keysEnabled = true,
  voiceGender = 'female',
  appLang = 'en',
  onFilterByAgent
}: Props) {
  const slides = useMemo(() => slidesOf(listing), [listing]);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const setMediaSlideIndex = setActiveSlideIndex;
  const slide = activeSlideIndex;
  const [narration, setNarration] = useState<Narration>('idle');
  const [sheet, setSheet] = useState(false);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [giraffeModalOpen, setGiraffeModalOpen] = useState(false);
  const [youtubeOpen, setYoutubeOpen] = useState(false);

  // Live pointer drag state
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [animatingExit, setAnimatingExit] = useState<'pass' | 'save' | 'up' | 'down' | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const narrationRef = useRef<{ audio: HTMLAudioElement; abort: AbortController; url: string | null } | null>(
    null
  );
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  // Last pointer sample + speed, so a release can tell a flick from a slow drag.
  const pointerTrackRef = useRef<{ x: number; y: number; t: number; vx: number; vy: number } | null>(
    null
  );

  const agentProfile = getEstateAgentProfile(listing.agent_id);
  const youtubeId = youtubeIdOf(listing.video_url);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (slides[slide]?.kind === 'video') v.play().catch(() => {});
    else v.pause();
  }, [slide, slides]);

  const next = () => setMediaSlideIndex((s) => Math.min(slides.length - 1, s + 1));
  const prev = () => setMediaSlideIndex((s) => Math.max(0, s - 1));

  // Photo arrows only — property up/down live on the deck so they survive the card.
  useEffect(() => {
    if (drawer || !keysEnabled || agentModalOpen || giraffeModalOpen || youtubeOpen) return;
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, keysEnabled, slides.length, agentModalOpen, giraffeModalOpen, youtubeOpen]);

  // Nothing keeps talking after the card leaves: abort the fetch, kill the audio and drop browser voice.
  const stopNarration = useCallback(() => {
    const cur = narrationRef.current;
    narrationRef.current = null;
    if (cur) {
      cur.abort.abort();
      cur.audio.pause();
      try {
        cur.audio.currentTime = 0;
      } catch {}
      cur.audio.removeAttribute('src');
      if (cur.url) URL.revokeObjectURL(cur.url);
    }
    window.speechSynthesis?.cancel();
    setNarration('idle');
  }, []);

  useEffect(() => stopNarration, [stopNarration]);
  useEffect(() => {
    stopNarration();
  }, [listing.raia_id, drawer, stopNarration]);

  const localeMap: Record<AppLang, import('@/lib/property-card').TtsLocale> = {
    en: 'en-GB',
    th: 'th-TH',
    ja: 'ja-JP',
    ms: 'ms-MY',
    zh: 'zh-CN'
  };
  const locale = localeMap[appLang] || ttsLocaleOf(listing);

  function speakLocal() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(
      buildPropertyDescriptionWithCta(listing, agentProfile?.name, appLang)
    );
    u.lang = locale;
    const voices = window.speechSynthesis
      .getVoices()
      .filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(locale.toLowerCase()));
    u.voice = voices.find((v) => voiceMatchesGender(v.name, voiceGender)) ?? voices[0] ?? null;
    u.rate = 1;
    u.onend = () => setNarration('idle');
    u.onerror = () => setNarration('idle');
    window.speechSynthesis.speak(u);
    setNarration('playing');
  }

  function toggleNarration() {
    if (narration !== 'idle') {
      stopNarration();
      return;
    }
    const audio = new Audio();
    const abort = new AbortController();
    narrationRef.current = { audio, abort, url: null };
    setNarration('loading');
    audio.src = SILENT_WAV;
    audio.play().catch(() => {});

    (async () => {
      try {
        const res = await fetch(
          `/api/tts?raia_id=${encodeURIComponent(listing.raia_id)}&lang=${locale}&gender=${voiceGender}`,
          { signal: abort.signal }
        );
        if (!res.ok) throw new Error(`tts ${res.status}`);
        const url = URL.createObjectURL(await res.blob());
        const cur = narrationRef.current;
        if (!cur || cur.abort !== abort) {
          URL.revokeObjectURL(url);
          return;
        }
        cur.url = url;
        audio.onended = stopNarration;
        audio.src = url;
        await audio.play();
        setNarration('playing');
      } catch {
        if (abort.signal.aborted) return;
        narrationRef.current = null;
        speakLocal();
      }
    })();
  }

  // Pointer drag event handlers (active only when drawer/sheets are closed)
  const canDrag = !drawer && !sheet && !agentModalOpen && !giraffeModalOpen && !youtubeOpen;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!canDrag) return;
    if (e.pointerType === 'touch') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
    }
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    pointerTrackRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, vx: 0, vy: 0 };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !pointerStartRef.current) return;
    const dx = e.clientX - pointerStartRef.current.x;
    const dy = e.clientY - pointerStartRef.current.y;
    const track = pointerTrackRef.current;
    if (track) {
      const dt = e.timeStamp - track.t;
      if (dt > 0) {
        track.vx = (e.clientX - track.x) / dt;
        track.vy = (e.clientY - track.y) / dt;
      }
      track.x = e.clientX;
      track.y = e.clientY;
      track.t = e.timeStamp;
    }
    setDragOffset({ x: dx, y: dy });
  };

  const releasePointer = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {}
  };

  const handlePassAction = () => {
    stopNarration();
    setAnimatingExit('pass');
    setTimeout(() => {
      onPass();
      setAnimatingExit(null);
      setDragOffset({ x: 0, y: 0 });
    }, 240);
  };

  const handleSaveAction = () => {
    stopNarration();
    setAnimatingExit('save');
    setTimeout(() => {
      if (!saved) onToggleSave(listing.raia_id);
      onSave();
      setAnimatingExit(null);
      setDragOffset({ x: 0, y: 0 });
    }, 240);
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    if (!isDragging) return;
    releasePointer(e);
    pointerStartRef.current = null;
    pointerTrackRef.current = null;
    setIsDragging(false);
    // A cancelled gesture was never a decision — spring back untouched.
    setDragOffset({ x: 0, y: 0 });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging || !pointerStartRef.current) return;
    releasePointer(e);

    const dx = e.clientX - pointerStartRef.current.x;
    const dy = e.clientY - pointerStartRef.current.y;
    const track = pointerTrackRef.current;
    // Only a sample this recent is still the release speed; older means the drag paused.
    const flick = track && e.timeStamp - track.t < 100 ? track : null;
    pointerStartRef.current = null;
    pointerTrackRef.current = null;
    setIsDragging(false);

    const intent = classifyGesture({ dx, dy, vx: flick?.vx, vy: flick?.vy });

    if (intent === 'tap') {
      setDragOffset({ x: 0, y: 0 });
      // Edge tap: left half -> prev photo, right half -> next photo
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      if (clickX < rect.width / 2) {
        prev();
      } else {
        next();
      }
      return;
    }

    if (intent === 'pass') {
      handlePassAction();
    } else if (intent === 'save') {
      handleSaveAction();
    } else if (intent === 'next_property') {
      setAnimatingExit('up');
      stopNarration();
      setTimeout(() => {
        onNextProperty();
        setAnimatingExit(null);
        setDragOffset({ x: 0, y: 0 });
      }, 220);
    } else if (intent === 'prev_property') {
      setAnimatingExit('down');
      stopNarration();
      setTimeout(() => {
        onPrevProperty();
        setAnimatingExit(null);
        setDragOffset({ x: 0, y: 0 });
      }, 220);
    } else {
      // Spring back if threshold not reached
      setDragOffset({ x: 0, y: 0 });
    }
  };

  // Card transform styling based on live drag & exit animation
  let cardTransform = '';
  let cardTransition = isDragging ? 'none' : 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)';

  if (animatingExit === 'pass') {
    cardTransform = 'translateX(-460px) rotate(-15deg)';
  } else if (animatingExit === 'save') {
    cardTransform = 'translateX(460px) rotate(15deg)';
  } else if (animatingExit === 'up') {
    cardTransform = 'translateY(-600px) scale(0.95)';
    cardTransition = 'transform 220ms ease-in';
  } else if (animatingExit === 'down') {
    cardTransform = 'translateY(600px) scale(0.95)';
    cardTransition = 'transform 220ms ease-in';
  } else if (isDragging) {
    const absX = Math.abs(dragOffset.x);
    const absY = Math.abs(dragOffset.y);
    if (absX >= absY) {
      cardTransform = `translateX(${dragOffset.x}px) rotate(${dragOffset.x * 0.04}deg)`;
    } else {
      cardTransform = `translateY(${dragOffset.y * 0.85}px) scale(0.98)`;
    }
  }

  // Stamp badge calculations
  const showPassBadge = (isDragging && dragOffset.x < -35 && Math.abs(dragOffset.x) >= Math.abs(dragOffset.y)) || animatingExit === 'pass';
  const showSaveBadge = (isDragging && dragOffset.x > 35 && Math.abs(dragOffset.x) >= Math.abs(dragOffset.y)) || animatingExit === 'save';

  const vacant = isVacant(listing);
  const isVideoMedia = slides[activeSlideIndex]?.kind === 'video';

  const location = [listing.building_number, listing.street_name, listing.suburb, listing.postcode_full]
    .filter(Boolean)
    .join(', ');
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    listing.latitude != null && listing.longitude != null
      ? `${listing.latitude},${listing.longitude}`
      : location || titleOf(listing)
  )}`;

  return (
    <article
      style={{ transform: cardTransform, transition: cardTransition }}
      className={`relative h-full w-full select-none overflow-hidden rounded-[26px] bg-[#09090b] text-white shadow-2xl ${
        showSaveBadge ? 'ring-4 ring-emerald-500/80 shadow-emerald-500/20' : ''
      } ${showPassBadge ? 'ring-4 ring-rose-500/80 shadow-rose-500/20' : ''}`}
    >
      {/* ── SAVE / PASS Overlay Stamp ────────────────────────────────── */}
      {showSaveBadge && (
        <div className="pointer-events-none absolute left-6 top-16 z-30 rotate-[-12deg] rounded-xl border-4 border-emerald-500 bg-emerald-950/80 px-4 py-1.5 text-2xl font-black tracking-wider text-emerald-400 backdrop-blur">
          ♥ SAVE
        </div>
      )}
      {showPassBadge && (
        <div className="pointer-events-none absolute right-6 top-16 z-30 rotate-[12deg] rounded-xl border-4 border-rose-500 bg-rose-950/80 px-4 py-1.5 text-2xl font-black tracking-wider text-rose-400 backdrop-blur">
          ✕ PASS
        </div>
      )}

      {/* ── Media stage with Pointer Drag & Tap ────────────────────── */}
      <div
        className="absolute inset-0 touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
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
              muted
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
      </div>

      {/* Story pagination bars */}
      {slides.length > 1 && (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex gap-1.5">
          {slides.map((s, i) => (
            <span
              key={`${s.url}-bar-${i}`}
              className={`h-1 flex-1 rounded-full ${
                i < slide
                  ? 'bg-white'
                  : i > slide
                    ? 'bg-white/30'
                    : s.kind === 'video'
                      ? 'bg-emerald-400'
                      : 'bg-white'
              }`}
            />
          ))}
        </div>
      )}



      {/* YouTube tour opens in its own player */}
      {youtubeId && (
        <button
          type="button"
          data-testid="youtube-btn"
          onClick={() => setYoutubeOpen(true)}
          aria-label="Play YouTube video tour"
          className="absolute right-3 top-7 z-20 inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-950/90 px-3 py-1 text-[11px] font-bold text-white backdrop-blur"
        >
          <YouTubeIcon size={14} />
          YouTube Tour
        </button>
      )}

      {/* ── HUD ──────────────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black via-black/75 to-transparent px-4 pb-4 pt-28">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-zinc-950">
          <span className={`h-2 w-2 rounded-full ${vacant ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          {statusLabel(listing)}
        </span>
        <div className="mt-2 text-[26px] font-extrabold leading-none tracking-tight text-white">
          {priceLabel(listing)}
        </div>
        <div className="mt-1 text-sm font-semibold text-zinc-200">{titleOf(listing)}</div>

        {/* Giraffe 360 & Estate Agent HUD Pills */}
        <div className="pointer-events-auto mt-2.5 flex flex-wrap items-center gap-2">
          {listing.tour_360_url && (
            <button
              type="button"
              data-testid="giraffe-360-btn"
              onClick={() => setGiraffeModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-950/80 px-3 py-1 text-[11px] font-bold text-cyan-300 backdrop-blur hover:bg-cyan-900/80 transition"
            >
              <span>🌐 360° Giraffe Tour</span>
            </button>
          )}

          {agentProfile && (
            <button
              type="button"
              data-testid="estate-agent-pill"
              onClick={() => setAgentModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/80 px-3.5 py-1.5 text-[11px] font-semibold text-emerald-300 backdrop-blur hover:bg-emerald-900/80 transition"
            >
              {(listing.agent_logo_url || agentProfile.logo_url) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={listing.agent_logo_url || agentProfile.logo_url!} alt={agentProfile.name} className="h-4 w-auto object-contain max-w-[100px]" />
              ) : (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-700 text-[9px] font-bold text-white">
                  {agentProfile.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span>{agentProfile.name}</span>
            </button>
          )}
        </div>

        {/* 5 standard action circles */}
        <div className="pointer-events-auto mt-4 flex items-center justify-center gap-3">
          <Action label="Rewind" onClick={onRewind} size={44}>
            <RewindIcon />
          </Action>
          <Action label="Pass" onClick={handlePassAction} size={56}>
            <PassIcon />
          </Action>
          <Action
            label={narration === 'idle' ? 'Read description aloud' : 'Stop narration'}
            onClick={toggleNarration}
            size={44}
          >
            <span className={narration === 'loading' ? 'animate-pulse' : ''}>
              <SpeakerIcon
                size={22}
                color={narration === 'playing' ? '#22c55e' : '#38bdf8'}
              />
            </span>
          </Action>
          <Action
            label={saved ? 'Remove from saved' : 'Save'}
            onClick={handleSaveAction}
            size={56}
            active={saved}
          >
            <HeartIcon filled={saved} />
          </Action>
          <Action label="Book Viewing" onClick={() => setSheet(true)} size={44}>
            <PlaneIcon />
          </Action>
        </div>
      </div>

      {/* ↑ info button → drawer */}
      <div className="absolute right-3 top-1/2 z-20 -translate-y-1/2">
        <DescriptionToggleButton open={false} onClick={() => onDrawerChange(true)} />
      </div>

      {/* ── State 2: expanded description drawer ─────────────────────── */}
      {drawer && (
        <div className="absolute inset-0 z-30 flex flex-col overflow-y-auto bg-neutral-950 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <header className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-neutral-950/95 px-4 py-3 backdrop-blur">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">
                {priceLabel(listing)} · {titleOf(listing)}
              </p>
              <p className="truncate text-[11px] text-white/50">{areaOf(listing)}</p>
              <div className="mt-1.5 flex flex-wrap gap-2 items-center">
                <RefPill id={listing.raia_id} />
              </div>
            </div>
            <DescriptionToggleButton open onClick={() => onDrawerChange(false)} />
          </header>

          <div className="relative h-40 shrink-0">
            {heroPhoto(listing) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={heroPhoto(listing) as string}
                alt={titleOf(listing)}
                className="h-full w-full object-cover"
              />
            )}
            <button
              type="button"
              onClick={() => setSheet(true)}
              className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-black shadow-lg"
            >
              <PlaneIcon size={14} color="#09090b" />
              Book Viewing
            </button>
          </div>

          <div className="space-y-3 p-3">
            <Card title="Estate Agent &amp; Virtual Tour">
              <div className="flex flex-wrap gap-2 items-center">
                {agentProfile && (
                  <button
                    type="button"
                    data-testid="estate-agent-pill"
                    onClick={() => setAgentModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/80 px-3 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-900/80 transition"
                  >
                    Listed by {agentProfile.name} · Verified ↗
                  </button>
                )}

                {listing.tour_360_url && (
                  <button
                    type="button"
                    data-testid="giraffe-360-btn"
                    onClick={() => setGiraffeModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-950/80 px-3 py-1 text-[11px] font-bold text-cyan-300 hover:bg-cyan-900/80 transition"
                  >
                    🌐 360° Giraffe Tour
                  </button>
                )}
              </div>
            </Card>

            <Card title="Lease &amp; Availability">
              <div className="mb-2">
                <RefPill id={listing.raia_id} />
              </div>
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
                {buildPropertyDescriptionWithCta(listing, agentProfile?.name, appLang)}
              </p>
            </Card>

            <Card title="Location &amp; Google Maps">
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
                      onDrawerChange(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left hover:bg-white/5"
                  >
                    <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/10">
                      {heroPhoto(s) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={heroPhoto(s) as string}
                          alt={titleOf(s)}
                          className="h-full w-full object-cover"
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">{titleOf(s)}</span>
                      <span className="block text-[11px] font-bold text-amber-400">
                        {priceLabel(s)}
                      </span>
                    </span>
                  </button>
                ))}
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ── Viewing Slots Sheet ───────────────────────────────────────── */}
      {sheet && (
        <ViewingSheet
          listing={listing}
          onClose={() => setSheet(false)}
        />
      )}

      {/* Estate Agent Profile Modal */}
      <EstateAgentCardModal
        agentId={listing.agent_id}
        open={agentModalOpen}
        onClose={() => setAgentModalOpen(false)}
        onFilterByAgent={onFilterByAgent}
      />

      {/* Giraffe 360 Fullscreen Tour Modal */}
      {giraffeModalOpen && listing.tour_360_url && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black p-2 md:p-4"
          onClick={() => setGiraffeModalOpen(false)}
        >
          <div
            className="relative flex flex-col h-full w-full rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-cyan-300">🌐 360° Giraffe Virtual Tour</span>
                <span className="text-xs text-zinc-400 truncate max-w-xs">{titleOf(listing)}</span>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href={listing.tour_360_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-cyan-400 hover:underline"
                >
                  Open in New Tab ↗
                </a>
                <button
                  type="button"
                  onClick={() => setGiraffeModalOpen(false)}
                  className="rounded-full p-1 text-zinc-400 hover:text-white"
                  aria-label="Close virtual tour"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1 w-full h-full bg-black">
              <iframe
                src={listing.tour_360_url}
                title="Giraffe 360 Virtual Tour"
                className="h-full w-full border-0"
                allow="fullscreen; xr-spatial-tracking; gyroscope; accelerometer"
              />
            </div>
          </div>
        </div>
      )}

      {/* YouTube Tour Modal */}
      {youtubeOpen && youtubeId && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black p-2 md:p-4"
          onClick={() => setYoutubeOpen(false)}
        >
          <div
            className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <YouTubeIcon size={16} />
                <span className="text-sm font-bold text-white">YouTube Tour</span>
                <span className="truncate text-xs text-zinc-400">{titleOf(listing)}</span>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href={`https://www.youtube.com/watch?v=${youtubeId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-red-400 hover:underline"
                >
                  Open in YouTube ↗
                </a>
                <button
                  type="button"
                  onClick={() => setYoutubeOpen(false)}
                  className="rounded-full p-1 text-zinc-400 hover:text-white"
                  aria-label="Close YouTube tour"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="h-full w-full flex-1 bg-black">
              <iframe
                src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0`}
                title="YouTube property tour"
                className="h-full w-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

// ── Small subcomponents ────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-neutral-900/80 p-3 backdrop-blur">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white/80">
      {children}
    </span>
  );
}

function RefPill({ id }: { id: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-emerald-400">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      RAIA #{id}
    </span>
  );
}

function Action({
  label,
  onClick,
  size,
  active = false,
  children
}: {
  label: string;
  onClick: () => void;
  size: number;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-full border border-white/20 bg-zinc-900/90 text-white shadow-lg backdrop-blur transition-transform active:scale-95 ${
        active ? 'border-red-500/50 bg-red-950/40' : ''
      }`}
    >
      {children}
    </button>
  );
}

function RewindIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#facc15" strokeWidth="2.5">
      <polygon points="11 19 2 12 11 5 11 19" />
      <polygon points="22 19 13 12 22 5 22 19" />
    </svg>
  );
}

function PassIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill={filled ? '#ef4444' : 'none'}
      stroke={filled ? '#ef4444' : '#22c55e'}
      strokeWidth="2.5"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function YouTubeIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#ef4444" aria-hidden="true">
      <path d="M23 12s0-3.3-.42-4.88a2.53 2.53 0 0 0-1.78-1.79C19.22 4.9 12 4.9 12 4.9s-7.22 0-8.8.43A2.53 2.53 0 0 0 1.42 7.1C1 8.7 1 12 1 12s0 3.3.42 4.88a2.53 2.53 0 0 0 1.78 1.79c1.58.43 8.8.43 8.8.43s7.22 0 8.8-.43a2.53 2.53 0 0 0 1.78-1.79C23 15.3 23 12 23 12ZM9.75 15.27V8.73L15.5 12l-5.75 3.27Z" />
    </svg>
  );
}

function SpeakerIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function ViewingSheet({
  listing,
  onClose
}: {
  listing: Listing;
  onClose: () => void;
}) {
  const [selectedSlot, setSelectedSlot] = useState<{ iso: string; label: string } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const slots = viewingSlots();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError('Name and email are required.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/enquire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raia_id: listing.raia_id,
          enquirer: { name, email, phone: phone || null, preferred_contact: 'email' },
          message: selectedSlot
            ? `Requested viewing slot: ${selectedSlot.label}`
            : 'Requested property viewing',
          viewing_request: selectedSlot
            ? { preferred_dates: [selectedSlot.iso], party_size: 1 }
            : null
        })
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to send viewing request');
      }

      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send request');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="absolute inset-0 z-40 flex items-end bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-3xl border-t border-white/20 bg-zinc-950 p-5 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white">Book a viewing</h3>
            <p className="text-xs text-zinc-400">{titleOf(listing)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-zinc-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {sent ? (
          <div className="py-6 text-center space-y-2">
            <span className="text-3xl">✅</span>
            <h4 className="text-sm font-bold text-emerald-400">Viewing Request Sent!</h4>
            <p className="text-xs text-zinc-300">
              The agent for {titleOf(listing)} has received your request and will confirm shortly.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {error && <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2 text-red-400">{error}</div>}

            <div className="space-y-2">
              <label className="block font-semibold text-zinc-300">Select a Slot</label>
              <div className="grid grid-cols-1 gap-2 max-h-36 overflow-y-auto">
                {slots.map((slot) => {
                  const isSelected = selectedSlot?.iso === slot.iso;
                  return (
                    <button
                      key={slot.iso}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      className={`flex items-center justify-between rounded-xl border p-2.5 transition ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-950/40 text-emerald-300'
                          : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      <span>📅 {slot.label}</span>
                      <span className="font-semibold text-emerald-400">
                        {isSelected ? 'Selected ✓' : 'Select'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block font-semibold text-zinc-300">Your Details</label>
              <input
                type="text"
                placeholder="Full Name *"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
              />
              <input
                type="email"
                placeholder="Email Address *"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
              />
              <input
                type="tel"
                placeholder="Phone Number (optional)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-500 disabled:opacity-50 transition"
            >
              {loading ? 'Sending Request...' : 'Confirm Viewing Request'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function PlaneIcon({ size = 20, color = '#e4e4e7' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}
