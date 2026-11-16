// ElevenLabs TTS voice table and the Storage cache key. Pure so the route,
// the tests and the client agree on one mapping.

import { createHash } from 'node:crypto';
import { ttsLocaleOf } from './property-card';
import type { Listing } from './types';

export const TTS_LANGS = ['en-GB', 'th-TH', 'ms-MY', 'ja-JP'] as const;
export type TtsLang = (typeof TTS_LANGS)[number];
export type VoiceGender = 'female' | 'male';

// ElevenLabs default curated voice IDs for female / male
// Default: Female = 21m00Tcm4TlvDq8ikWAM (Rachel), Male = ErXwobaYiN019PkySvjV (Antoni)
// Overridable via ELEVENLABS_VOICE_ID_FEMALE / ELEVENLABS_VOICE_ID_MALE env vars.
const DEFAULT_FEMALE_VOICE = '21m00Tcm4TlvDq8ikWAM';
const DEFAULT_MALE_VOICE = 'ErXwobaYiN019PkySvjV';

export function voiceFor(_lang: TtsLang, gender: VoiceGender): string {
  if (gender === 'male') {
    return process.env.ELEVENLABS_VOICE_ID_MALE || DEFAULT_MALE_VOICE;
  }
  return process.env.ELEVENLABS_VOICE_ID_FEMALE || DEFAULT_FEMALE_VOICE;
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
