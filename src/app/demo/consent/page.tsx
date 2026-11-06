'use client';

import { useState, type FormEvent } from 'react';

export default function DemoConsentPage() {
  const [optedIn, setOptedIn] = useState(false);
  const [granted, setGranted] = useState(false);

  // shortcut: consent is held on this device until the ingest lane posts it to demo_grant_consent (0014), upgrade when a consent API route exists
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!optedIn) return;
    window.sessionStorage.setItem('demo:consent', 'granted');
    setGranted(true);
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans">
      <main className="max-w-2xl mx-auto px-4 md:px-8 py-10">
        <a
          href="/"
          className="inline-flex items-center gap-2 text-lg font-bold tracking-tight rounded-md px-1 py-1 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          MoveHome<span className="text-[var(--accent)]">.org</span>
        </a>

        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mt-6">Privacy notice</h1>
        <p className="text-sm text-[var(--text-dim)] mt-2">
          Expo demo — what happens to what you send us.
        </p>

        <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 space-y-4 text-sm leading-relaxed">
          <p>
            MoveHome Organisation CIC (Co. No. 17202438) is the data controller for what you send
            us at the expo — the photo, the price, the area and the message.
          </p>
          <p>
            movehome.org and EstateAigents act as processors only: they run the inbox and the
            screen on our instruction, for no other purpose.
          </p>
          <p>
            We keep your content for 24 hours, and the whole demo plane is torn down 7 days after
            the expo.
          </p>
          <p>
            An automatic safety check runs before anything can appear on the screen. It runs on our
            own moderation account, as a processor. Your content is never used to train a model and
            is never shared for marketing or profiling.
          </p>
          <p className="font-semibold text-[var(--text)]">
            Nothing is processed, stored or broadcast before you opt in. The opt-in below happens
            first, on this device.
          </p>
          <p className="text-[var(--text-dim)]">
            Your consent covers display at the expo only. You can decline and still talk to us; a
            declined draft is never broadcast.
          </p>
        </div>

        {granted ? (
          <section
            aria-live="polite"
            className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6"
          >
            <h2 className="text-xl font-semibold">You are opted in</h2>
            <p className="text-sm text-[var(--text-dim)] mt-2">
              Send your listing to the number on your card. It will appear on the screen once it
              passes the safety check.
            </p>
          </section>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={optedIn}
                onChange={(event) => setOptedIn(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              <span>I have read the privacy notice and I opt in</span>
            </label>

            <button
              type="submit"
              disabled={!optedIn}
              className="mt-5 inline-flex items-center rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--bg)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              Opt in and continue
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
