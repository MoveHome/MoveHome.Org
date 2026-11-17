'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { getEstateAgentProfile, EstateAgentProfile } from '@/lib/agent-directory';

interface Props {
  agentId: string;
  open: boolean;
  onClose: () => void;
  onFilterByAgent?: (agentId: string) => void;
}

export default function EstateAgentCardModal({ agentId, open, onClose, onFilterByAgent }: Props) {
  const profile = getEstateAgentProfile(agentId);
  const [logoUrl, setLogoUrl] = useState<string>(profile?.logo_url || '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  if (!open || !profile) return null;

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload-logo', { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok && data.logoUrl) {
        setLogoUrl(data.logoUrl);
      } else {
        setUploadError(data.error || 'Upload failed');
      }
    } catch {
      setUploadError('Network error uploading logo');
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    setSaveSuccess(false);
    profile.logo_url = logoUrl.trim() || null;
    // Simulate save / API sync
    await new Promise((r) => setTimeout(r, 300));
    setSaving(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header bar */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/95 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-400">
              <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 20 20">
                <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
              </svg>
              Verified RAIA Protocol Organisation
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Content body */}
        <div className="max-h-[80vh] overflow-y-auto p-5 space-y-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white">{profile.name}</h2>
            <p className="mt-1 text-xs text-emerald-400 font-mono">{profile.registration_authority}</p>
            <p className="mt-0.5 text-xs text-zinc-400">{profile.incorporation_info}</p>
          </div>

          <div className="space-y-2 text-xs border-t border-zinc-800/60 pt-3">
            <div>
              <span className="font-semibold text-zinc-400">Legal Name: </span>
              <span className="text-zinc-200">{profile.legal_name}</span>
            </div>
            <div>
              <span className="font-semibold text-zinc-400">Jurisdiction: </span>
              <span className="text-zinc-200">{profile.jurisdiction}</span>
            </div>
            <div>
              <span className="font-semibold text-zinc-400">Business Address: </span>
              <span className="text-zinc-200">{profile.business_address}</span>
            </div>
            <div>
              <span className="font-semibold text-zinc-400">Contact Email: </span>
              <a href={`mailto:${profile.email}`} className="text-emerald-400 hover:underline">
                {profile.email}
              </a>
            </div>
            <div>
              <span className="font-semibold text-zinc-400">Website: </span>
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 hover:underline"
              >
                {profile.website} ↗
              </a>
            </div>
          </div>

          {/* Licences & Redress */}
          <div className="border-t border-zinc-800/60 pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
              Organisation Logo / Branding
            </h3>
            <div className="flex flex-col gap-2">
              {logoUrl ? (
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded border border-zinc-800 bg-white p-1 overflow-hidden flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logoUrl} alt="Logo preview" className="max-h-full max-w-full object-contain" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setLogoUrl('')}
                    className="text-xs text-red-400 hover:underline"
                  >
                    Remove Logo
                  </button>
                </div>
              ) : null}
              <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                <label className="cursor-pointer rounded bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-700">
                  {uploading ? 'Uploading…' : 'Upload Logo File'}
                  <input type="file" accept="image/*" onChange={handleFileUpload} disabled={uploading} className="hidden" />
                </label>
                <span className="text-xs text-zinc-500">or URL:</span>
                <input
                  type="url"
                  placeholder="https://domain.com/logo.png"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
                />
              </div>
              {uploadError ? <p className="text-xs text-red-400">{uploadError}</p> : null}
              <div className="flex items-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save Logo'}
                </button>
                {saveSuccess ? <span className="text-xs text-emerald-400">Saved ✓</span> : null}
              </div>
            </div>
          </div>

          {/* Licences & Redress */}
          <div className="border-t border-zinc-800/60 pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
              Licences &amp; Redress
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {profile.licences.map((licence) => (
                <span
                  key={licence}
                  className="rounded-full border border-zinc-700/60 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-300"
                >
                  ✓ {licence}
                </span>
              ))}
            </div>
          </div>

          {/* A2A Protocol Agent Card URL */}
          <div className="border-t border-zinc-800/60 pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
              A2A Protocol Agent Card
            </h3>
            <a
              href={profile.agent_card_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate rounded-lg border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-300"
            >
              {profile.agent_card_url} ↗
            </a>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-800/80 bg-zinc-950/95 px-5 py-3">
          {onFilterByAgent && (
            <button
              type="button"
              onClick={() => {
                onFilterByAgent(agentId);
                onClose();
              }}
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20"
            >
              Filter Deck to This Estate Agent
            </button>
          )}
          <Link
            href={`/agent/${agentId}`}
            onClick={onClose}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-zinc-700"
          >
            Open Estate Agent Card (/agent/{agentId})
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:text-zinc-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
