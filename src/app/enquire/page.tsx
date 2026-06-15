'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function EnquireForm() {
  const params = useSearchParams();
  const raia_id = params.get('raia_id') ?? '';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [preferred, setPreferred] = useState<'email' | 'phone' | 'whatsapp'>('email');
  const [message, setMessage] = useState('');
  const [company, setCompany] = useState(''); // honeypot — stays empty for real users
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!raia_id) {
      setStatus('error');
      setError('Missing raia_id — open this page from a property listing.');
      return;
    }
    setStatus('sending');
    setError(null);

    const res = await fetch('/api/enquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raia_id,
        enquirer: { name, email, phone: phone || undefined, preferred_contact: preferred },
        message,
        company // honeypot; empty unless a bot filled the hidden field
      })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setStatus('error');
      setError(body.error ?? `Request failed (${res.status})`);
      return;
    }
    setStatus('sent');
  }

  if (status === 'sent') {
    return (
      <div className="max-w-md mx-auto px-4 py-12">
        <h1 className="text-2xl font-semibold mb-2">Enquiry sent</h1>
        <p className="text-sm text-slate-700">
          We&apos;ve forwarded your enquiry to the listing agent. They&apos;ll be in touch directly.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <h1 className="text-2xl font-semibold mb-2">Enquire about this property</h1>
      {raia_id && (
        <p className="text-xs text-slate-500 mb-6 font-mono">{raia_id}</p>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {/* Honeypot: hidden from real users (off-screen, not focusable, ignored by
            autofill). A non-empty value on the server is treated as a bot. */}
        <input
          type="text"
          name="company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: 0 }}
        />

        <label className="flex flex-col text-sm">
          <span className="text-slate-700 mb-1">Name</span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2"
            autoComplete="name"
          />
        </label>

        <label className="flex flex-col text-sm">
          <span className="text-slate-700 mb-1">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2"
            autoComplete="email"
          />
        </label>

        <label className="flex flex-col text-sm">
          <span className="text-slate-700 mb-1">Phone (optional)</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2"
            placeholder="+447700900123"
            autoComplete="tel"
          />
        </label>

        <label className="flex flex-col text-sm">
          <span className="text-slate-700 mb-1">Preferred contact</span>
          <select
            value={preferred}
            onChange={(e) => setPreferred(e.target.value as typeof preferred)}
            className="border border-slate-300 rounded px-3 py-2"
          >
            <option value="email">Email</option>
            <option value="phone">Phone</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </label>

        <label className="flex flex-col text-sm">
          <span className="text-slate-700 mb-1">Message</span>
          <textarea
            required
            minLength={1}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            className="border border-slate-300 rounded px-3 py-2"
            placeholder="A few words about your situation, ideal move date, etc."
          />
        </label>

        <button
          type="submit"
          disabled={status === 'sending'}
          className="bg-primary text-white rounded py-2 hover:bg-primary-dark transition-colors disabled:opacity-60"
        >
          {status === 'sending' ? 'Sending…' : 'Send enquiry'}
        </button>

        {status === 'error' && error && <p className="text-sm text-red-700">{error}</p>}
      </form>
    </div>
  );
}

export default function EnquirePage() {
  return (
    <Suspense fallback={null}>
      <EnquireForm />
    </Suspense>
  );
}
