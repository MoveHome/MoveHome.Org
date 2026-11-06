'use client';

// This component is the UI half of the gate; src/lib/demo/emit.ts is the enforced half.
// Nothing broadcasts from here — onConfirm only records the attendee's answer.

import { useState } from 'react';

interface ConsentMomentProps {
  summary: string;
  onConfirm: () => void;
  onDecline: () => void;
}

export default function ConsentMoment({ summary, onConfirm, onDecline }: ConsentMomentProps) {
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-moment-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg)]/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-sm">
        <h2 id="consent-moment-title" className="text-2xl font-extrabold tracking-tight">
          Show on the big screen?
        </h2>

        <p className="mt-3 whitespace-pre-line rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 text-sm text-[var(--text)]">
          {summary}
        </p>

        <p className="mt-3 text-sm text-[var(--text-dim)]">
          A photo with a price and an area identifies the home to the neighbours in this room, so
          confirm first — nothing is broadcast until you do.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={answer !== null}
            onClick={() => {
              setAnswer('yes');
              onConfirm();
            }}
            className="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--bg)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            Yes — show it
          </button>
          <button
            type="button"
            disabled={answer !== null}
            onClick={() => {
              setAnswer('no');
              onDecline();
            }}
            className="rounded-xl border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--text)] transition-colors hover:bg-[var(--bg-card-hover)] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            No
          </button>
        </div>
      </div>
    </div>
  );
}
