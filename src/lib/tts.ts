// Google Cloud TTS voice table and the Storage cache key. Pure so the route,
// the tests and the client agree on one mapping.

import { createHash } from 'node:crypto';
import { countryOf } from './property-card';
import type { Listing } from './types';

export const TTS_LANGS = ['en-GB', 'th-TH', 'ms-MY', 'ja-JP'] as const;
export type TtsLang = (typeof TTS_LANGS)[number];
export type VoiceGender = 'female' | 'male';

// Curated, verified Google Cloud voice IDs per locale and gender.
const VOICES: Record<TtsLang, Record<VoiceGender, string>> = {
  'en-GB': { female: 'en-GB-Neural2-F', male: 'en-GB-Neural2-D' },
  'th-TH': { female: 'th-TH-Neural2-C', male: 'th-TH-Standard-A' },
  'ms-MY': { female: 'ms-MY-Wavenet-A', male: 'ms-MY-Wavenet-D' },
  'ja-JP': { female: 'ja-JP-Neural2-B', male: 'ja-JP-Neural2-C' }
};

export function voiceFor(lang: TtsLang, gender: VoiceGender): string {
  return VOICES[lang][gender];
}

// Locale comes from the listing's country when the caller omits it; an
// explicit unknown locale is rejected rather than silently swapped.
export function resolveLang(param: string | null, l: Listing): TtsLang | null {
  if (param) return (TTS_LANGS as readonly string[]).includes(param) ? (param as TtsLang) : null;
  const cc = (l.jurisdiction ?? countryOf(l) ?? '').toUpperCase();
  return ({ TH: 'th-TH', MY: 'ms-MY', JP: 'ja-JP' } as Record<string, TtsLang>)[cc] ?? 'en-GB';
}

export function scriptHash(script: string): string {
  return createHash('sha256').update(script).digest('hex');
}

export function cachePath(raia_id: string, lang: TtsLang, gender: VoiceGender, hash: string) {
  return `tts/${raia_id}/${lang}/${gender}/${hash}.mp3`;
}
