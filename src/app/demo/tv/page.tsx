'use client';

// The booth screen (expo Phase 1).
//
// Nothing renders and no audio unlocks until the operator clicks Arm Display:
// Chrome/Safari block autoplay, so the chime item is unreachable without that
// click. Freshness is decided by reconciliation alone — never by the socket
// state and never by /api/health.
import { useCallback, useEffect, useRef, useState } from 'react';
import TvFeedMap, { type TvPin } from '@/components/demo/TvFeedMap';
import {
  RECONCILE_INTERVAL_MS,
  cursorOf,
  fingerprintOf,
  isStale,
  mergeRows,
  postReconcile,
  refetchAll,
  type FeedRow
} from '@/lib/demo/reconcile';
import { tvChannel, type ListingBroadcast } from '@/lib/demo/realtime';

// Where a pending ping pins before its row lands with real coordinates.
// shortcut: broadcast payloads carry no lat/lng, so an optimistic pin sits at
// the venue home view until hydration; upgrade when the ping carries a position.
const VENUE_HOME = { lat: 51.5, lng: -0.12 };

function venueFromToken(token: string): string | null {
  try {
    const payload = token.split('.')[1] ?? '';
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { venue_id?: unknown };
    return typeof json.venue_id === 'string' ? json.venue_id : null;
  } catch {
    return null;
  }
}

export default function TvPage() {
  const [armed, setArmed] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [timedOut, setTimedOut] = useState(true);
  const [verifiedAgo, setVerifiedAgo] = useState(0);
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [pings, setPings] = useState<ListingBroadcast[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const token = useRef('');
  const venue = useRef('');
  const rowsRef = useRef<FeedRow[]>([]);
  const correlation = useRef('');
  const lastVerified = useRef(0);
  const audio = useRef<AudioContext | null>(null);

  rowsRef.current = rows;
  const stale = mismatch || timedOut;

  // Arm Display / Enable Sound: the only place audio may unlock.
  const arm = useCallback(() => {
    const Ctx = window.AudioContext;
    audio.current = new Ctx();
    void audio.current.resume();
    setArmed(true);
  }, []);

  const chime = useCallback(() => {
    const ctx = audio.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain).connect(ctx.destination);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    token.current = params.get('token') ?? '';
    venue.current = venueFromToken(token.current) ?? '';
    if (!token.current) setNotice('venue token required: open /demo/tv?token=<venue session jwt>');
  }, []);

  // Initial backfill, then the 30 s reconciliation loop. A mismatch refetches
  // everything; the banner stays up until a later check agrees again.
  useEffect(() => {
    if (!armed || !token.current) return;
    let alive = true;

    const backfill = async (since: number) => {
      const page = await refetchAll(token.current, since);
      if (!alive) return;
      setRows((prev) => mergeRows(prev, page));
    };

    void (async () => {
      try {
        await backfill(0);
        if (!alive) return;
        lastVerified.current = Date.now();
        setTimedOut(false);
      } catch {
        if (alive) setTimedOut(true);
      }
    })();

    const verify = async () => {
      try {
        const result = await postReconcile(fingerprintOf(rowsRef.current), token.current, correlation.current);
        if (!alive) return;
        setMismatch(!result.ok);
        if (result.ok) {
          lastVerified.current = Date.now();
          setTimedOut(false);
        } else {
          await backfill(0);
        }
      } catch {
        if (alive) setTimedOut(true);
      }
    };

    const timer = setInterval(() => void verify(), RECONCILE_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [armed]);

  useEffect(() => {
    const tick = setInterval(() => {
      setTimedOut(isStale(lastVerified.current));
      setVerifiedAgo(lastVerified.current ? Math.round((Date.now() - lastVerified.current) / 1000) : 0);
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  // Wake-up ping: pin + chime now, labelled RECEIVED / PROCESSING. The row is
  // pulled from the cursor a moment later and hydrates photo, price and badge.
  useEffect(() => {
    if (!armed || !venue.current) return;
    const channel = tvChannel(venue.current, (listing) => {
      chime();
      correlation.current = listing.correlation_id;
      setPings((prev) => [listing, ...prev].slice(0, 20));
      setFocusId(listing.id);
      void (async () => {
        try {
          const page = await refetchAll(token.current, cursorOf(rowsRef.current));
          setRows((prev) => mergeRows(prev, page));
        } catch {
          setTimedOut(true);
        }
      })();
    });
    return () => channel.close();
  }, [armed, chime]);

  if (!armed) {
    return (
      <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: '#0b1220', color: '#e2e8f0' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 40, marginBottom: 24 }}>MoveHome — live listings</h1>
          <button
            onClick={arm}
            style={{ fontSize: 24, padding: '18px 32px', borderRadius: 12, border: 0, background: '#22d3ee', color: '#06202b', fontWeight: 700 }}
          >
            Arm Display / Enable Sound
          </button>
          {notice ? <p style={{ marginTop: 16, color: '#fca5a5' }}>{notice}</p> : null}
        </div>
      </main>
    );
  }

  const live = rows.filter((row) => row.latitude !== null && row.longitude !== null);
  const hydrated = new Set(live.map((row) => row.id));
  const pins: TvPin[] = [
    ...pings
      .filter((ping) => !hydrated.has(ping.id))
      .map((ping) => ({
        id: ping.id,
        lat: VENUE_HOME.lat,
        lng: VENUE_HOME.lng,
        headline: ping.headline,
        rent_pcm: ping.rent_pcm,
        currency: ping.currency,
        source: 'Telegram',
        correlation_id: ping.correlation_id,
        pending: true
      })),
    ...live.map((row) => ({
      id: row.id,
      lat: Number(row.latitude),
      lng: Number(row.longitude),
      headline: row.headline,
      rent_pcm: row.rent_pcm,
      currency: row.currency,
      photo_url: row.photo_url,
      source: row.source ?? 'Telegram',
      correlation_id: row.correlation_id,
      pending: false
    }))
  ];
  const focused = pins.find((pin) => pin.id === focusId) ?? null;

  return (
    <main style={{ position: 'relative', height: '100vh', overflow: 'hidden', background: '#0b1220' }}>
      <TvFeedMap pins={pins} focusId={focusId} />

      {stale ? (
        <div
          role="alert"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 900, background: '#b91c1c', color: '#fff', padding: '14px 24px', font: '600 18px system-ui, sans-serif' }}
        >
          STALE — this screen and the server disagree. Refetched; re-verifying within{' '}
          {Math.round(RECONCILE_INTERVAL_MS / 1000)}s.
        </div>
      ) : null}

      {focused ? (
        <aside
          style={{ position: 'absolute', top: stale ? 92 : 24, right: 24, zIndex: 900, width: 360, background: '#111a2e', color: '#e2e8f0', borderRadius: 16, overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,.45)' }}
        >
          {focused.photo_url ? (
            <img src={focused.photo_url} alt="" style={{ width: '100%', height: 200, objectFit: 'cover' }} />
          ) : null}
          <div style={{ padding: 20 }}>
            <h2 style={{ fontSize: 22, margin: 0 }}>{focused.headline ?? 'New listing'}</h2>
            <p style={{ fontSize: 26, margin: '8px 0' }}>
              {focused.rent_pcm ? `${focused.currency ?? 'GBP'} ${focused.rent_pcm}/mo` : 'price pending'}
            </p>
            <p style={{ margin: 0, color: '#22d3ee', fontWeight: 600 }}>Just listed via {focused.source ?? 'Telegram'}</p>
            <p style={{ margin: '6px 0 0', fontSize: 12, letterSpacing: '.08em', color: '#94a3b8' }}>
              {focused.pending ? 'RECEIVED / PROCESSING' : 'RECEIVED'}
            </p>
          </div>
        </aside>
      ) : null}

      <footer
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 900, display: 'flex', gap: 24, padding: '10px 24px', background: 'rgba(11,18,32,.88)', color: '#94a3b8', font: '500 14px system-ui, sans-serif' }}
      >
        <span>{pins.length} listings</span>
        <span>correlation {correlation.current || '—'}</span>
        <span>last verified {verifiedAgo}s ago</span>
        {stale ? <span style={{ color: '#fca5a5' }}>reconciliation behind</span> : null}
      </footer>
    </main>
  );
}
