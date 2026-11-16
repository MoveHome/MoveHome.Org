// ElevenLabs TTS voice table, model choice and the Storage cache key. Pure so
// the route, the tests and the client agree on one mapping.

import { createHash } from 'node:crypto';
import { ttsLocaleOf } from './property-card';
import type { Listing } from './types';

export const TTS_LANGS = ['en-GB', 'th-TH', 'ms-MY', 'ja-JP'] as const;
export type TtsLang = (typeof TTS_LANGS)[number];
export type VoiceGender = 'female' | 'male';

// Lease window: also the ownership token, since a key is immutable once created.
export const LOCK_TTL_MS = 30_000;

// Bump when the spoken script or voice mapping changes shape: old audio stays
// addressable but is never served under the new identity.
const CACHE_VERSION = 'v2';

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

// Flash v2.5 covers ~32 languages but not Thai; multilingual v2 does.
export function modelFor(lang: TtsLang): string {
  return lang === 'th-TH' ? 'eleven_multilingual_v2' : 'eleven_flash_v2_5';
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

// Provider-prefixed so the Google-era objects at tts/{id}/… are never served
// as if they were ElevenLabs audio (same script hash, same voice gender).
export function cacheDir(raia_id: string, lang: TtsLang, gender: VoiceGender) {
  return `tts/elevenlabs/${raia_id}/${lang}/${gender}`;
}

// The name carries script, voice, model and cache version: changing a voice env
// var or the model for a locale yields a new object instead of stale audio.
export function cachePath(raia_id: string, lang: TtsLang, gender: VoiceGender, hash: string) {
  const identity = scriptHash(`${CACHE_VERSION}|${modelFor(lang)}|${voiceFor(lang, gender)}|${hash}`);
  return `${cacheDir(raia_id, lang, gender)}/${identity}.mp3`;
}

// A lease's name is its fencing token: the TTL window it was taken in. The
// window is a path segment so a whole dead window can be swept at once, and a
// lease is created with create-if-absent, so exactly one contender per window
// wins and no lease is ever overwritten or reclaimed by deletion.
export function leasePath(
  lang: TtsLang,
  gender: VoiceGender,
  raia_id: string,
  hash: string,
  at = Date.now()
) {
  return `tts/_locks/${lang}/${gender}/${Math.floor(at / LOCK_TTL_MS)}/${raia_id}-${hash}`;
}
