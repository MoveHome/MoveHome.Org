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

export interface HealthBadge {
  text: string;
  cls: string;
}

export function healthBadge(a: Pick<PublicRegistryAgent, 'is_healthy' | 'uptime_percentage'>): HealthBadge {
  if (a.is_healthy === null || a.is_healthy === undefined) {
    return { text: 'unchecked', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' };
  }
  if (a.is_healthy) {
    const up = a.uptime_percentage != null ? ` · ${a.uptime_percentage}% uptime` : '';
    return { text: `healthy${up}`, cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' };
  }
  return { text: 'unhealthy', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' };
}
