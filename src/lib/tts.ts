// ElevenLabs TTS voice table, model choice and the Storage cache key. Pure so
// the route, the tests and the client agree on one mapping.

import { createHash } from 'node:crypto';
import { ttsLocaleOf } from './property-card';
import type { Listing } from './types';

export const TTS_LANGS = ['en-GB', 'th-TH', 'ms-MY', 'ja-JP', 'zh-CN'] as const;
export type TtsLang = (typeof TTS_LANGS)[number];
export type VoiceGender = 'female' | 'male';

// Lease window: also the ownership token, since a key is immutable once created.
export const LOCK_TTL_MS = 30_000;

// Bump when the spoken script or voice mapping changes shape: old audio stays
// addressable but is never served under the new identity.
const CACHE_VERSION = 'v2';

// ElevenLabs default curated voice IDs for female / male.
// Thai has its own catalog voices: multilingual v2 and flash v2.5 do not speak
// Thai at all, and the default English voices are not Thai-native.
// Overridable via ELEVENLABS_VOICE_ID_FEMALE / _MALE / _TH_FEMALE / _TH_MALE.
const DEFAULT_FEMALE_VOICE = '21m00Tcm4TlvDq8ikWAM';
const DEFAULT_MALE_VOICE = 'ErXwobaYiN019PkySvjV';
const DEFAULT_TH_FEMALE_VOICE = 'brM9iIbwDREZaWL8luun'; // Anna - Thailand Female
const DEFAULT_TH_MALE_VOICE = 'xVv8qLTTnsYnrysc2Lx4'; // Thai - Deep, Formal and Professional
const DEFAULT_ZH_FEMALE_VOICE = 'LcfcDJNUP1GQjkzn1xUU'; // Mandarin Female
const DEFAULT_ZH_MALE_VOICE = 'g5CIjZEefAph4nQFvHAz'; // Mandarin Male

export function voiceFor(lang: TtsLang, gender: VoiceGender): string {
  if (lang === 'th-TH') {
    return gender === 'male'
      ? process.env.ELEVENLABS_VOICE_ID_TH_MALE || DEFAULT_TH_MALE_VOICE
      : process.env.ELEVENLABS_VOICE_ID_TH_FEMALE || DEFAULT_TH_FEMALE_VOICE;
  }
  if (lang === 'zh-CN') {
    return gender === 'male'
      ? process.env.ELEVENLABS_VOICE_ID_ZH_MALE || DEFAULT_ZH_MALE_VOICE
      : process.env.ELEVENLABS_VOICE_ID_ZH_FEMALE || DEFAULT_ZH_FEMALE_VOICE;
  }
  if (gender === 'male') {
    return process.env.ELEVENLABS_VOICE_ID_MALE || DEFAULT_MALE_VOICE;
  }
  return process.env.ELEVENLABS_VOICE_ID_FEMALE || DEFAULT_FEMALE_VOICE;
}

// Thai is not in multilingual v2 or flash v2.5; eleven_v3 is the catalog model
// that supports it (70+ languages).
export function modelFor(lang: TtsLang): string {
  return lang === 'th-TH' ? 'eleven_v3' : 'eleven_flash_v2_5';
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

// One immutable lease per (listing, locale, voice, script). Acquisition is a
// single create-if-absent upload, so exactly one contender can own it; there is
// no window boundary for two contenders to straddle.
export function leasePath(lang: TtsLang, gender: VoiceGender, raia_id: string, hash: string) {
  return `tts/_locks/${lang}/${gender}/${raia_id}-${hash}`;
}
