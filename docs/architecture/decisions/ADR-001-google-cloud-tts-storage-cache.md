# ADR-001 — Google Cloud TTS with Supabase store-once audio

- **Status:** Amended — provider is ElevenLabs (see Amendment 1); the Google sections below are historical
- **Date:** 2026-11-16
- **Issue:** MoveHome/MoveHome.Org#85[4]
- **Implementation:** PR #86, branch `fix/movehome-tts-google-cache`[5]
- **Risk tier:** MEDIUM

## Context

Property narration currently uses ElevenLabs through an unversioned `GET /api/tts` URL and a per-instance memory cache. Issue #85 replaces that provider with Google Cloud Text-to-Speech, adds Female/Male selection in Discovery settings, and requires shared store-once MP3 caching in Supabase Storage. Cached audio must not survive a listing withdrawal as a successful API response, and a changed description, price, or CTA must produce a new cache object.[4]

The repository had no local ADR directory or registry before this decision. This ADR records the architecture for the in-flight implementation; it does not retroactively mark PR #86 approved.

## Decision

### 1. Provider and client fallback

Use the REST `text:synthesize` endpoint with MP3 output. Google limits each synthesis request to 5,000 bytes and applies project-level request quotas.[2] `GOOGLE_TTS_API_KEY` is the primary server-only credential; `GEMINI_API_KEY` is a fallback only when that key is authorised for Cloud Text-to-Speech. Do not use `RLF_GEMINI_API_KEY`, which belongs to a separate data path. Never expose either credential to browser code.

The browser retains `speechSynthesis` as a best-effort fallback for non-200 responses, network/playback failure, or missing provider configuration. It uses the same listing-derived locale and requested gender heuristic; browser voice gender is not guaranteed.

### 2. Voice selection

Prefer Neural2, then WaveNet/Standard where Neural2 is unavailable. The selected IDs and genders are present in Google's supported-voice catalogue.[1]

| Locale | Female | Male |
|---|---|---|
| `en-GB` | `en-GB-Neural2-F` | `en-GB-Neural2-D` |
| `th-TH` | `th-TH-Neural2-C` | `th-TH-Chirp3-HD-Achird` |
| `ms-MY` | `ms-MY-Wavenet-A` | `ms-MY-Wavenet-D` |
| `ja-JP` | `ja-JP-Neural2-B` | `ja-JP-Neural2-C` |

**Explicit exception:** Google lists no male Thai Neural2, WaveNet, or Standard voice. Male Thai therefore uses the verified Chirp 3: HD voice above rather than silently substituting a female voice. If this exception is rejected, Male must be disabled for `th-TH`; `th-TH-Standard-A` is female and is not a valid male fallback. Chirp 3: HD currently has the same 0–1 million character monthly free allowance as Neural2, although their overage rates differ.[3]

Locale derivation is shared by the card, deck prefetch, and browser fallback: jurisdiction/UN-LOCODE first, currency second, then `en-GB`. Script translation is out of scope.

### 3. Script and object identity

`buildPropertyDescriptionWithCta(listing, vendorOrgName?)` remains the single narration-script source for the API, browser fallback, and written property card. Its sanitised description/fallback, price, status, and vendor CTA determine the spoken content.

For the exact UTF-8 script string sent to Google:

```text
script_hash = lowercase_hex_sha256(script)
object_path = tts/{raia_id}/{lang}/{gender}/{script_hash}.mp3
```

The hash is the full 64-character SHA-256 digest. Language and gender are path segments, so they do not need to be hashed. A voice-ID mapping change is an operational cache-invalidation event because the existing issue-approved key contains only the script hash.

After a successful shared write, prune older `.mp3` hashes only within the same `(raia_id, lang, gender)` prefix. Cleanup must re-read the current listing and preserve its current hash so an older in-flight request cannot delete newer audio. A withdrawn listing returns 404 even if its old object remains in Storage.

### 4. Storage and failure boundary

Provision one **private** bucket named `tts-audio` in `supabase/migrations/0018_tts_audio_bucket.sql`. Only the server-side service-role client reads/writes it; no browser Storage policies or public object URLs are required. Stored objects use `audio/mpeg` and a seven-day immutable-object cache lifetime because their paths are content-addressed.

Storage is best-effort for audio delivery:

1. Check per-instance memory.
2. Check shared Storage.
3. On a miss, synthesise once using shared create-if-absent coordination, return the audio, and attempt the shared write.
4. If Storage is unavailable, retain bounded memory audio and retry persistence on a later request.

A missing bucket, missing admin credential, or Storage read/write error must not become a false rate-limit denial. Only an explicit duplicate-object result means a coordination/budget claim is already held. Other Storage failures fall back to local coordination and the normal provider/browser fallback path.

### 5. HTTP and caching contract

The lookup URL is mutable even though the object path is immutable. Every API response therefore uses `Cache-Control: no-store`; only the hash-addressed Storage object receives a long object cache lifetime. Successful audio responses include `X-TTS-Cache: HIT` for memory/Storage hits and `X-TTS-Cache: MISS` for new synthesis. Provider-miss errors also report `MISS` when a cache lookup occurred.

| Status | Required behaviour |
|---|---|
| 200 | `audio/mpeg`; live listing was found; hit/miss header present |
| 400 | Invalid `raia_id`, unsupported `lang`, or invalid `gender` |
| 404 | Unknown, withdrawn, or non-public listing; checked before provider configuration |
| 429 | Billable-miss budget exceeded; `Retry-After: 60` |
| 500 | Listing lookup failed; must be distinguishable from “not found” |
| 503 | Provider key missing and no cached audio exists; browser falls back |
| 502 | Google returned an error or no audio |
| 504 | Google timed out or the network request failed |

`getListingByRaiaId(raia_id, signal?)` currently converts PostgREST errors to `null`. The TTS path must add/use a strict error-surfacing variant without changing the legacy helper's semantics for other callers; otherwise database failures are incorrectly reported as 404 and the 500 contract is unreachable.

### 6. Abuse and deployment controls

Apply the shared miss budget only when synthesis may be required, not to memory/Storage hits. Keep concurrent-miss coordination and the budget markers in the private bucket. Configuration documentation must include both Google variables and the server-only Supabase service-role requirement.

Deployment requires migration 0018 and provider/Storage smoke checks before the feature is considered live. Unit tests and mocked Storage alone do not prove real provider voice availability or bucket provisioning.

## Consequences

- Shared Storage removes most duplicate synthesis across instances; bounded memory remains the resilience path.
- Live lookup on every request prioritises takedown and price correctness over HTTP-edge caching.
- The public endpoint has provider-cost exposure, so miss limiting and observability are required.
- Real Google synthesis and Supabase Storage integration remain release evidence, separate from unit tests.
- The Thai male tier exception is the only voice-map decision requiring explicit owner approval.

## Sources

[1] https://cloud.google.com/text-to-speech/docs/voices — Google Cloud Text-to-Speech: Supported voices and languages
[2] https://docs.cloud.google.com/text-to-speech/quotas
[3] https://cloud.google.com/text-to-speech/pricing
[4] https://github.com/MoveHome/MoveHome.Org/issues/85
[5] https://github.com/MoveHome/MoveHome.Org/pull/86

## Amendment 1 — ElevenLabs provider (PR #91)

The implementation ships ElevenLabs instead of Google Cloud TTS; the storage
contract above is unchanged.

- **Credential:** `ELEVENLABS_API_KEY` only. No Google/Gemini credential is sent
  to ElevenLabs; without the key the endpoint answers 503 and the client keeps
  its `speechSynthesis` fallback.
- **Model per language:** `eleven_flash_v2_5` except Thai (`th-TH`), where Flash
  v2.5 has no Thai support and `eleven_multilingual_v2` is required. Selection
  lives in `modelFor()` in `src/lib/tts.ts`, with unit coverage.
- **Cache identity:** the object name hashes script hash + model + resolved
  voice ID + a cache version, so changing a voice env var or the model for a
  locale does not serve stale audio. The provider prefix (`tts/elevenlabs/…`)
  keeps Google-era objects unservable.
- **Concurrency:** one lease object per TTL window (`tts/_locks/<lang>/<gender>/<window>/…`),
  created create-if-absent. The window is the fencing token: keys are immutable,
  a contender only opens the next window when the previous one has expired, and
  release deletes only a lease whose recorded owner matches.
- **Cleanup:** a superseded MP3 is removed only when it is neither the current
  script nor the file just written and has been untouched for 5 minutes, so a
  concurrent request can never lose its current audio.
- **Abuse budget:** per-client per-minute markers under a hashed client key (no
  IP is stored), plus a per-instance fallback counter. A marker that cannot be
  written is treated as a denial; only a total Storage-client failure falls back
  to the per-instance counter alone.
