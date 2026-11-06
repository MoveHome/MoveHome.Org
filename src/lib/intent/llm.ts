// The model seat: gemini-3.6-flash on the rentlondonflat.com Gemini account
// (RLF_GEMINI_API_KEY). Attendee messages are personal data, so that Gemini
// account is the only vendor on this path. Optional by design: one attempt, hard
// 1.2 s abort, no second try — a missing key, a timeout or a 429 all return null
// and the caller keeps the deterministic parse result.

import { z } from 'zod';

export const TIMEOUT_MS = 1200;
const MODEL = 'gemini-3.6-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const PROMPT =
  'Extract property-listing fields from a chat caption. Reply with JSON only and ' +
  'omit unknown fields. Keys: headline (string), property_type (flat|house|studio|' +
  'commercial|land|other), service_type (long_term|short_term|sale), bedrooms ' +
  '(integer), rent_pcm (monthly rent as a number), currency (3 letters), postcode.';

const IntentSchema = z.object({
  headline: z.string().min(1).max(200).optional(),
  property_type: z.enum(['flat', 'house', 'studio', 'commercial', 'land', 'other']).optional(),
  service_type: z.enum(['long_term', 'short_term', 'sale']).optional(),
  bedrooms: z.number().int().min(0).max(50).optional(),
  rent_pcm: z.number().min(1).max(1_000_000).optional(),
  currency: z.string().length(3).optional(),
  postcode: z.string().min(3).max(8).optional()
});

export type LlmIntent = z.infer<typeof IntentSchema>;

// Daily spend guard: the durable cap lives on the RLF key quota; this is the
// per-instance call budget so a runaway loop cannot bill the day away.
let budgetDay = '';
let callsToday = 0;

function overBudget(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== budgetDay) {
    budgetDay = today;
    callsToday = 0;
  }
  if (callsToday >= Number(process.env.INTENT_LLM_DAILY_CAP ?? 250)) return true;
  callsToday += 1;
  return false;
}

export function llmConfigured(): boolean {
  return Boolean(process.env.RLF_GEMINI_API_KEY || process.env.GEMINI_API_KEY);
}

export async function extractWithLlm(text: string): Promise<LlmIntent | null> {
  const key = process.env.RLF_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key || !text.trim() || overBudget()) return null;

  try {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${PROMPT}\n\nCaption: ${text.slice(0, 1000)}` }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: 'application/json' }
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (!res.ok) return null; // 429 / quota / 5xx -> fallback, never a second attempt

    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const content = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof content !== 'string') return null;

    const parsed = IntentSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // abort/timeout, network failure or malformed JSON -> fallback
  }
}
