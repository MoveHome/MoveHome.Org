// Presentational helpers for the registry UI. The directory renders agent-supplied
// text (name/description/skills) — React escapes those by default, but URLs used as
// href need an explicit guard so a card can't smuggle a javascript:/data: scheme.

import type { PublicRegistryAgent } from './types';

export function safeHref(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function hostOf(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function getMonogram(name?: string | null, fallback = 'AG'): string {
  if (!name || !name.trim()) return fallback;
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase();
}

export interface HealthBadge {
  text: string;
  cls: string;
}

export function healthBadge(a: Pick<PublicRegistryAgent, 'is_healthy' | 'uptime_percentage'>): HealthBadge {
  if (a.is_healthy === null || a.is_healthy === undefined) {
    return { text: 'unchecked', cls: 'bg-[var(--bg-elev)] text-[var(--text-dim)]' };
  }
  if (a.is_healthy) {
    const up = a.uptime_percentage != null ? ` · ${a.uptime_percentage}% uptime` : '';
    return { text: `healthy${up}`, cls: 'bg-[var(--tint-light)] text-[var(--accent-hover)]' };
  }
  return { text: 'unhealthy', cls: 'bg-[var(--bg-elev)] text-red-600 font-medium' };
}
