'use client';

import { useState } from 'react';
import Link from 'next/link';

// Self-service registration: paste the agent's wellKnownURI → POST to the register
// API → show the result (links to the new listing, or validation errors).
interface RegisterOk { agent: { slug: string; name: string | null } }
interface ProblemBody { title?: string; detail?: string; validation_errors?: { field: string; message: string }[] }

export default function SubmitPage() {
  const [uri, setUri] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<RegisterOk | null>(null);
  const [err, setErr] = useState<ProblemBody | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setOk(null);
    setErr(null);
    try {
      const res = await fetch('/api/registry/v1/agents/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wellKnownURI: uri.trim() })
      });
      const body = await res.json();
      if (res.ok) setOk(body as RegisterOk);
      else setErr(body as ProblemBody);
    } catch {
      setErr({ title: 'Network error', detail: 'Could not reach the registry. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <Link href="/registry" className="text-sm text-primary underline">← Registry</Link>
      <h1 className="text-3xl font-semibold mt-3">Register your A2A agent</h1>
      <p className="text-gray-600 dark:text-gray-400 mt-2">
        Paste the URL of your agent&apos;s A2A Agent Card (its <code>/.well-known/agent-card.json</code>). We fetch
        and validate it, confirm it&apos;s a real-estate agent, and list it immediately. Read-only — no account needed.
      </p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
        <input
          type="url"
          required
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          placeholder="https://your-domain.com/.well-known/agent-card.json"
          className="border rounded px-3 py-2 bg-transparent"
        />
        <button type="submit" disabled={busy} className="rounded bg-primary text-white px-4 py-2 disabled:opacity-50">
          {busy ? 'Validating…' : 'Register agent'}
        </button>
      </form>

      {ok ? (
        <div className="mt-6 rounded border border-green-300 bg-green-50 dark:bg-green-900/20 p-4">
          <p className="font-medium text-green-800 dark:text-green-300">Listed ✓</p>
          <p className="text-sm mt-1">
            <Link href={`/registry/${ok.agent.slug}`} className="text-primary underline">
              View {ok.agent.name || ok.agent.slug} →
            </Link>
          </p>
        </div>
      ) : null}

      {err ? (
        <div className="mt-6 rounded border border-red-300 bg-red-50 dark:bg-red-900/20 p-4">
          <p className="font-medium text-red-800 dark:text-red-300">{err.title || 'Could not register'}</p>
          {err.detail ? <p className="text-sm mt-1">{err.detail}</p> : null}
          {err.validation_errors?.length ? (
            <ul className="text-sm mt-2 list-disc pl-5">
              {err.validation_errors.map((v, i) => <li key={i}><code>{v.field}</code>: {v.message}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-gray-500 mt-8">
        New to A2A? See the <a href="/skills.md" className="text-primary underline">integration guide</a>.
      </p>
    </main>
  );
}
