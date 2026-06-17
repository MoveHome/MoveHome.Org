'use client';

import { useState } from 'react';

// Community flag/takedown trigger. Posts to the rate-limited flag endpoint; the
// server auto-hides an agent past a threshold.
export default function FlagButton({ agentId }: { agentId: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  async function flag() {
    if (!window.confirm('Flag this agent for review (spam, miscategorised, or broken)?')) return;
    setState('sending');
    try {
      const res = await fetch(`/api/registry/v1/agents/${agentId}/flag`, { method: 'POST' });
      setState(res.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') return <span className="text-xs text-gray-500">Flag recorded — our team will review. Thank you.</span>;
  if (state === 'error') return <span className="text-xs text-red-500">Could not record the flag. Please try again later.</span>;
  return (
    <button onClick={flag} disabled={state === 'sending'} className="text-xs text-gray-500 underline hover:text-gray-700">
      {state === 'sending' ? 'Sending…' : 'Flag this listing'}
    </button>
  );
}
