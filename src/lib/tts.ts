// Google Cloud TTS voice table and the Storage cache key. Pure so the route,
// the tests and the client agree on one mapping.

import { createHash } from 'node:crypto';
import { ttsLocaleOf } from './property-card';
import type { Listing } from './types';

export const TTS_LANGS = ['en-GB', 'th-TH', 'ms-MY', 'ja-JP'] as const;
export type TtsLang = (typeof TTS_LANGS)[number];
export type VoiceGender = 'female' | 'male';

// Every entry is a name + SSML gender taken from Google's official list
// (https://cloud.google.com/text-to-speech/docs/list-voices-and-types).
// Thai has no male voice below the Chirp 3: HD tier, so the male entry is
// Premium/Chirp3 rather than Neural2 — the only catalog-verified male Thai.
const VOICES: Record<TtsLang, Record<VoiceGender, string>> = {
  'en-GB': { female: 'en-GB-Neural2-F', male: 'en-GB-Neural2-D' },
  'th-TH': { female: 'th-TH-Neural2-C', male: 'th-TH-Chirp3-HD-Achird' },
  'ms-MY': { female: 'ms-MY-Wavenet-A', male: 'ms-MY-Wavenet-D' },
  'ja-JP': { female: 'ja-JP-Neural2-B', male: 'ja-JP-Neural2-C' }
};

export function voiceFor(lang: TtsLang, gender: VoiceGender): string {
  return VOICES[lang][gender];
}

// Locale comes from the listing when the caller omits it; an explicit unknown
// locale is rejected rather than silently swapped.
export function resolveLang(param: string | null, l: Listing): TtsLang | null {
  if (param) return (TTS_LANGS as readonly string[]).includes(param) ? (param as TtsLang) : null;
  return ttsLocaleOf(l);
}

export function scriptHash(script: string): string {
  return createHash('sha256').update(script).digest('hex');
}

export function cachePath(raia_id: string, lang: TtsLang, gender: VoiceGender, hash: string) {
  return `tts/${raia_id}/${lang}/${gender}/${hash}.mp3`;
}
