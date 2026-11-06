// Deterministic caption parser — the fallback that ships first and the only part
// that has to work. Pure and synchronous: no network, no await, no model, so a
// caption still parses (and the map still pings) at a 100% LLM outage.

export type PropertyType = 'flat' | 'house' | 'studio' | 'commercial' | 'land' | 'other';
export type ServiceType = 'long_term' | 'short_term' | 'sale';

export interface ParsedListingText {
  headline?: string;
  property_type?: PropertyType;
  service_type?: ServiceType;
  bedrooms?: number;
  rent_pcm?: number;
  currency?: string;
  /** Full postcode when the caption carries one; the location rail narrows it. */
  postcode?: string;
}

const PRICE_RE = /(?:£|\bgbp)\s*([\d,]+(?:\.\d+)?)/i;
// "2 bed" and "2-bed" are both how people write it.
const BEDS_RE = /\b(\d+)\s*[- ]?\s*(?:bed|beds|bedroom|bedrooms|br)\b/i;
const POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i;

function money(raw: string): number | undefined {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

export function parseListingText(raw: string | null | undefined): ParsedListingText {
  const caption = (raw ?? '').trim();
  const lower = caption.toLowerCase();
  const parsed: ParsedListingText = {};

  const price = PRICE_RE.exec(caption);
  if (price) parsed.rent_pcm = money(price[1]);

  const beds = BEDS_RE.exec(lower);
  if (beds) parsed.bedrooms = Number(beds[1]);
  else if (/\bstudio\b/.test(lower)) parsed.bedrooms = 0;

  if (/\bstudio\b/.test(lower)) parsed.property_type = 'studio';
  else if (/\b(flat|apartment)\b/.test(lower)) parsed.property_type = 'flat';
  else if (/\bhouse\b/.test(lower)) parsed.property_type = 'house';
  else if (/\b(shop|office|commercial)\b/.test(lower)) parsed.property_type = 'commercial';
  else if (/\b(land|plot)\b/.test(lower)) parsed.property_type = 'land';

  parsed.service_type = /\b(short.?term|holiday|nightly)\b/.test(lower)
    ? 'short_term'
    : /\b(sale|for sale|freehold)\b/.test(lower)
      ? 'sale'
      : 'long_term';

  parsed.currency = /€|\beur\b/.test(lower) ? 'EUR' : /\$|\busd\b/.test(lower) ? 'USD' : 'GBP';

  const postcode = POSTCODE_RE.exec(caption.toUpperCase());
  if (postcode) parsed.postcode = postcode[1];

  if (caption) parsed.headline = caption.split('\n')[0].slice(0, 200);

  return parsed;
}
