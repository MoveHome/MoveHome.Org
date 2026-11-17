import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase';
import { sanitizeDescription } from '@/lib/sanitize-description';
import { plainText } from '@/lib/property-card';
import type { Listing } from '@/lib/types';

export const i18nResponseSchema = z.object({
  th: z.string().min(1).max(2500),
  ja: z.string().min(1).max(2500),
  ms: z.string().min(1).max(2500),
  zh: z.string().min(1).max(2500)
});

export type I18nTranslations = z.infer<typeof i18nResponseSchema>;

export function computeProseHash(prose: string): string {
  const sanitised = plainText(sanitizeDescription(prose));
  return createHash('sha256').update(sanitised).digest('hex');
}

function hasCurrencyHallucination(sourceText: string, translatedText: string): boolean {
  // Reject currency symbols or prices in translations that were not present in source text
  const sourceCurrencies = sourceText.match(/(?:[£$€฿]|RM|\bGBP\b|\bTHB\b|\bMYR\b|\bUSD\b|\bEUR\b|\bJPY\b|\bCNY\b)/gi) || [];
  const transCurrencies = translatedText.match(/(?:[£$€฿¥]|RM|\bGBP\b|\bTHB\b|\bMYR\b|\bUSD\b|\bEUR\b|\bJPY\b|\bCNY\b|\bRMB\b)/gi) || [];

  if (sourceCurrencies.length === 0 && transCurrencies.length > 0) {
    return true;
  }
  return false;
}

export async function translateListingProse(
  listing: { raia_id: string; marketing_description: string | null; i18n_source_hash?: string | null; i18n_status?: string | null },
  fetchFn: typeof fetch = fetch
): Promise<{ success: boolean; translations?: I18nTranslations; skipped?: boolean }> {
  if (!listing.marketing_description) {
    return { success: false };
  }

  const sanitised = plainText(sanitizeDescription(listing.marketing_description));
  if (!sanitised.trim()) {
    return { success: false };
  }

  const sourceHash = computeProseHash(sanitised);

  if (listing.i18n_source_hash === sourceHash && listing.i18n_status === 'ok') {
    return { success: true, skipped: true };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const sb = getSupabase();

  if (!apiKey) {
    if (sb) {
      await sb
        .from('tbl_external_raia_listings')
        .update({ i18n_status: 'failed' })
        .eq('raia_id', listing.raia_id);
    }
    return { success: false };
  }

  const prompt = `You are a professional real estate translator.
Translate the following property selling-point description into Thai (th), Japanese (ja), Bahasa Melayu (ms), and Simplified Chinese (zh-Hans, key 'zh').
Do NOT invent or add any prices, financial terms, or Call To Action (CTA) details. Only translate the provided prose.

Return JSON ONLY in this format:
{"th": "...", "ja": "...", "ms": "...", "zh": "..."}

[SELLING-POINT PROSE BEGIN]
${sanitised}
[SELLING-POINT PROSE END]`;

  try {
    const res = await fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, response_mime_type: 'application/json' }
        })
      }
    );

    if (!res.ok) {
      throw new Error(`Gemini HTTP ${res.status}`);
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const parsedJson = JSON.parse(rawText);
    const validated = i18nResponseSchema.parse(parsedJson);

    // Check prompt-injection / currency hallucinations
    for (const [lang, text] of Object.entries(validated)) {
      if (hasCurrencyHallucination(sanitised, text)) {
        throw new Error(`Currency hallucination detected in ${lang}`);
      }
    }

    if (sb) {
      const { error } = await sb
        .from('tbl_external_raia_listings')
        .update({
          marketing_description_th: validated.th,
          marketing_description_ja: validated.ja,
          marketing_description_ms: validated.ms,
          marketing_description_zh: validated.zh,
          i18n_source_hash: sourceHash,
          i18n_status: 'ok'
        })
        .eq('raia_id', listing.raia_id);

      if (error) {
        throw new Error(`DB update failed: ${error.message}`);
      }
    }

    return { success: true, translations: validated };
  } catch (err) {
    if (sb) {
      await sb
        .from('tbl_external_raia_listings')
        .update({ i18n_status: 'failed' })
        .eq('raia_id', listing.raia_id);
    }
    return { success: false };
  }
}
