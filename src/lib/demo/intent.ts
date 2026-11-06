// Slot-filling seam for the Telegram caption.
//
// Deterministic on purpose: price / bedrooms / property type / headline are
// read from the caption text, nothing else. No LLM, no geocoding — t_1c4bb6ab
// owns those and may rewrite the internals, but MUST keep this signature and
// the `missing` marker.

export type PropertyType = 'flat' | 'house' | 'studio' | 'commercial' | 'land' | 'other';
export type ServiceType = 'long_term' | 'short_term' | 'sale';

export interface ListingIntent {
  headline?: string;
  property_type?: PropertyType;
  service_type?: ServiceType;
  bedrooms?: number;
  rent_pcm?: number;
  currency?: string;
  postcode?: string;
  /** Slots still needed before anything may be written. */
  missing: string[];
}

export interface IntentInput {
  text?: string | null;
  photo?: unknown;
}

const PRICE_RE = /(?:£|\bgbp)\s*([\d,]+(?:\.\d+)?)/i;
const BEDS_RE = /\b(\d+)\s*(?:bed|beds|bedroom|bedrooms|br)\b/i;
const POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i;

function money(raw: string): number | undefined {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

export async function extractListingIntent({ text, photo }: IntentInput): Promise<ListingIntent> {
  const caption = (text ?? '').trim();
  const lower = caption.toLowerCase();
  const intent: ListingIntent = { missing: [] };

  const price = PRICE_RE.exec(caption);
  if (price) intent.rent_pcm = money(price[1]);

  const beds = BEDS_RE.exec(lower);
  if (beds) intent.bedrooms = Number(beds[1]);
  else if (/\bstudio\b/.test(lower)) intent.bedrooms = 0;

  if (/\bstudio\b/.test(lower)) intent.property_type = 'studio';
  else if (/\b(flat|apartment)\b/.test(lower)) intent.property_type = 'flat';
  else if (/\bhouse\b/.test(lower)) intent.property_type = 'house';
  else if (/\b(shop|office|commercial)\b/.test(lower)) intent.property_type = 'commercial';
  else if (/\b(land|plot)\b/.test(lower)) intent.property_type = 'land';

  intent.service_type = /\b(short.?term|holiday|nightly)\b/.test(lower)
    ? 'short_term'
    : /\b(sale|for sale|freehold)\b/.test(lower)
      ? 'sale'
      : 'long_term';

  intent.currency = /€|\beur\b/.test(lower) ? 'EUR' : /\$|\busd\b/.test(lower) ? 'USD' : 'GBP';

  const postcode = POSTCODE_RE.exec(caption.toUpperCase());
  if (postcode) intent.postcode = postcode[1];

  if (caption) intent.headline = caption.split('\n')[0].slice(0, 200);

  // Never a silent partial write: the prompt asks for exactly these.
  if (!photo) intent.missing.push('photo');
  if (intent.rent_pcm === undefined) intent.missing.push('price');
  if (intent.bedrooms === undefined) intent.missing.push('number of bedrooms');
  if (intent.property_type === undefined) intent.missing.push('property type');
  if (!intent.headline) intent.missing.push('a caption');

  return intent;
}
