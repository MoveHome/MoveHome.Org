'use client';

import { useState } from 'react';

interface CrmRefPillProps {
  refId: string;
  copyUrl?: string;
  className?: string;
}

export default function CrmRefPill({ refId, copyUrl, className = '' }: CrmRefPillProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const targetUrl = copyUrl || (typeof window !== 'undefined' ? window.location.href : '');
    if (targetUrl) {
      try {
        await navigator.clipboard.writeText(targetUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Fallback for clipboard
      }
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Click to copy link"
      data-testid="crm-ref-pill"
      className={`inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-mono font-semibold text-emerald-400 hover:bg-emerald-500/20 transition cursor-pointer ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      <span>Ref: {refId}</span>
      {copied ? (
        <span className="ml-1 text-[10px] font-sans font-bold text-emerald-300">✓ Copied</span>
      ) : (
        <svg className="h-3 w-3 ml-0.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}