'use client';

// Claim flow forms. The token from the URL is sent to the API and never rendered —
// it is a one-time secret, so it must not land in the DOM (or in a copy/paste-able
// field) beyond the address bar it arrived in.

import { useState } from 'react';
import Link from 'next/link';

interface ProblemBody {
  title?: string;
  detail?: string;
}

export default function ClaimForm({
  slug,
  token,
  cardName,
  claimed
}: {
  slug: string;
  token: string;
  cardName: string | null;
  claimed: boolean;
}) {
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [published, setPublished] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const label = cardName || slug;

  async function post(body: Record<string, unknown>) {
    const res = await fetch('/api/registry/v1/agents/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = (await res.json().catch(() => ({}))) as ProblemBody;
    if (!res.ok) throw new Error(data.detail || data.title || 'Could not process the claim.');
    return data;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (token) {
        await post({ phase: 'verify', slug, token, contact_email: email.trim() });
        setPublished(true);
      } else {
        await post({
          phase: 'initiate',
          slug,
          contact_email: email.trim(),
          ...(website.trim() ? { website_url: website.trim() } : {})
        });
        setSent(true);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not process the claim.');
    } finally {
      setBusy(false);
    }
  }

  if (!slug) {
    return (
      <p className="mt-6 text-sm">
        This page needs a card slug. Find your card in the{' '}
        <Link href="/registry" className="text-primary underline">
          registry
        </Link>{' '}
        and use its claim link.
      </p>
    );
  }

  if (claimed && !published) {
    return (
      <div className="mt-6 border border-[var(--border)] rounded p-4 text-sm">
        <p className="font-semibold">This card ({label}) has already been claimed.</p>
        <p className="text-[var(--text-dim)] mt-1">
          If that was not you, email admin@movehome.org and we will look into it.
        </p>
        <Link href={`/registry/${slug}`} className="text-primary underline mt-2 inline-block">
          View the card
        </Link>
      </div>
    );
  }

  if (published) {
    return (
      <div className="mt-6 border border-[var(--border)] rounded p-4 text-sm">
        <p className="font-semibold">Your card is live.</p>
        <p className="text-[var(--text-dim)] mt-1">
          {label} now appears in the public MoveHome registry. You can update it any time by re-syncing your agent card.
        </p>
        <Link href={`/registry/${slug}`} className="text-primary underline mt-2 inline-block">
          View your card
        </Link>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="mt-6 border border-[var(--border)] rounded p-4 text-sm">
        <p className="font-semibold">Check your email.</p>
        <p className="text-[var(--text-dim)] mt-1">
          We sent a claim link for {label} to {email}. It expires in 72 hours. The card stays private until you open it.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
      <p className="text-sm">
        Claiming card: <span className="font-semibold">{label}</span>
      </p>
      <div>
        <label className="block text-xs font-semibold text-[var(--text-dim)] mb-1">Contact email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@youragency.com"
          className="w-full border border-[var(--border)] rounded px-3 py-2 bg-transparent text-sm"
        />
      </div>
      {!token && (
        <div>
          <label className="block text-xs font-semibold text-[var(--text-dim)] mb-1">Website (optional)</label>
          <input
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://youragency.com"
            className="w-full border border-[var(--border)] rounded px-3 py-2 bg-transparent text-sm"
          />
        </div>
      )}
      <button
        type="submit"
        disabled={busy}
        className="self-start rounded bg-primary text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {busy ? 'Working…' : token ? 'Confirm this card is mine' : 'Email me a claim link'}
      </button>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </form>
  );
}
