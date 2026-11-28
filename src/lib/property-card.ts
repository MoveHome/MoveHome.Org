// Pure presentation helpers for the swipe deck. Kept out of the client
// component so server pages can use them without crossing the RSC boundary.

import type { Listing } from './types';
import { getEstateAgentProfile, EstateAgentProfile } from './agent-directory';
import { sanitizeDescription } from './sanitize-description';

const SYMBOLS: Record<string, string> = { THB: '฿', GBP: '£', USD: '$', EUR: '€' };

// Outward postcode → the place name a card can show next to the code. Grouped
// so a district that shares a name with its neighbours needs one line, not many.
const AREA_CODES: [area: string, codes: string][] = [
  ['Wembley', 'HA9'],
  ['Hammersmith', 'W6'],
  ['Holborn', 'WC2B WC2A WC1R'],
  ['Fitzrovia', 'W1T W1W'],
  ['Canary Wharf', 'E14'],
  ['Bow', 'E3'],
  ['Belgravia', 'SW1W SW1X'],
  ['Chelsea', 'SW3'],
  ['Fulham', 'SW6'],
  ['Kensington', 'W8'],
  ['Bayswater', 'W2'],
  ['Shepherds Bush', 'W12'],
  ['Southwark', 'SE1 SE1P'],
  ['Greenwich', 'SE10'],
  ['Blackheath', 'SE3'],
  ['Islington', 'N1'],
  ['Kings Cross', 'N1C'],
  ['Southgate', 'N14'],
  ['Mill Hill', 'NW7'],
  ['Colindale', 'NW9'],
  ['Kensal Green', 'NW10'],
  ['Clerkenwell', 'EC1 EC1V EC1A EC1M EC1R EC1N EC1Y WC1X'],
  ['Brixton', 'SW2'],
  ['Earls Court', 'SW5'],
  ['South Kensington', 'SW7'],
  ['Notting Hill', 'W11'],
  ['Southall', 'UB1'],
  ['Greenford', 'UB6'],
  ['Windlesham', 'GU20'],
  ['Fleet', 'GU51'],
  ['Reading', 'RG2'],
  ['Birmingham', 'B1 B2 B3 B4 B5 B6 B7 B8 B9 B10 B11 B12 B13 B14 B15 B16 B17 B18 B19 B20 B21 B23 B24 B25 B26 B27 B28 B29 B30 B31 B32 B33 B34 B35 B36 B37 B38 B40 B42 B43 B44 B45 B46 B47 B48'],
  ['Romford', 'RM1'],
  ['Wallingford', 'OX10'],
  ['Slough', 'SL3'],
  ['Lewisham', 'SE13'],
  ['Westminster', 'SW1 SW1A SW1H SW1P SW1V SW1Y'],
  ['City of London', 'EC2 EC2A EC2M EC2V EC2Y EC3 EC3A EC3V EC4 EC4A EC4M EC4R EC4V'],
  ['Bloomsbury', 'WC1 WC1A WC1B WC1E WC1H WC1N'],
  ['Covent Garden', 'WC2 WC2E WC2H WC2N'],
  ['Mayfair', 'W1 W1C W1J W1K W1S'],
  ['Soho', 'W1D W1F'],
  ['Marylebone', 'W1B W1G W1H W1U'],
  ['Whitechapel', 'E1'],
  ['Bethnal Green', 'E2'],
  ['Dalston', 'E8'],
  ['Hackney', 'E9'],
  ['Stratford', 'E15'],
  ['Camden', 'NW1'],
  ['Hampstead', 'NW3'],
  ['Kentish Town', 'NW5'],
  ['St Johns Wood', 'NW8'],
  ['Clapham', 'SW4'],
  ['Nine Elms', 'SW8'],
  ['Stockwell', 'SW9'],
  ['Battersea', 'SW11'],
  ['Balham', 'SW12'],
  ['Putney', 'SW15'],
  ['Wimbledon', 'SW19'],
  ['Acton', 'W3'],
  ['Chiswick', 'W4'],
  ['Ealing', 'W5'],
  ['Maida Vale', 'W9'],
  ['North Kensington', 'W10'],
  ['West Kensington', 'W14'],
  ['Kilburn', 'NW6'],
  ['Golders Green', 'NW11'],
  ['Finsbury Park', 'N4'],
  ['Highbury', 'N5'],
  ['Highgate', 'N6'],
  ['Holloway', 'N7'],
  ['Muswell Hill', 'N10'],
  ['Wood Green', 'N22'],
  ['Leyton', 'E10'],
  ['Leytonstone', 'E11'],
  ['Walthamstow', 'E17'],
  ['Camberwell', 'SE5'],
  ['Deptford', 'SE8'],
  ['Peckham', 'SE15'],
  ['Elephant and Castle', 'SE17'],
  ['Woolwich', 'SE18'],
  ['East Dulwich', 'SE22'],
  ['Forest Hill', 'SE23'],
  ['Manchester', 'M1 M2 M3 M4 M11 M12 M13 M14 M15 M20'],
  ['Salford', 'M5 M6 M7 M50'],
  ['Bristol', 'BS1 BS2 BS3 BS4 BS5 BS6 BS7 BS8'],
  ['Leeds', 'LS1 LS2 LS3 LS4 LS5 LS6 LS7 LS8 LS9'],
  ['Liverpool', 'L1 L2 L3 L4 L5 L6 L7 L8'],
  ['Glasgow', 'G1 G2 G3 G4 G5 G11 G12 G13 G14 G15 G20 G21 G22 G23 G31 G32 G33 G34 G40 G41 G42 G43 G44 G45 G46 G51 G52 G53 G60 G61 G62 G63 G64 G65 G66 G67 G68 G69 G71 G72 G73 G74 G75 G76 G77 G78 G81 G82 G83 G84'],
  ['Edinburgh', 'EH1 EH2 EH3 EH4 EH5 EH6 EH7 EH8 EH9 EH10 EH11 EH12 EH13 EH14 EH15 EH16 EH17']
];

export const UK_POSTCODE_AREA_MAP: Record<string, string> = Object.fromEntries(
  AREA_CODES.flatMap(([area, codes]) => codes.split(' ').map((code) => [code, area]))
);

export function priceLabel(l: Listing): string {
  const money = (n: number) =>
    `${SYMBOLS[l.currency ?? ''] ?? `${l.currency ?? ''} `}${n.toLocaleString('en-GB')}`;
  if (l.service_type === 'sale' && l.asking_price) return money(l.asking_price);
  if (l.service_type === 'short_term' && l.daily_rate) return `${money(l.daily_rate)}/night`;
  if (l.rent_pcm) return `${money(l.rent_pcm)}${l.currency === 'THB' ? '/mo' : ' pcm'}`;
  return 'Price on application';
}

// A headline that ends on a bare outward code ("... in HA9") reads as a gap,
// so the area name is resolved from the map when the listing has no suburb.
const OUTWARD_IN_RE = /\bin\s+([A-Z]{1,2}\d[A-Z\d]?)$/i;

export function resolvedSuburbOf(l: Listing): string | null {
  return (
    l.suburb?.trim() ||
    (l.postcode_district
      ? UK_POSTCODE_AREA_MAP[l.postcode_district.trim().toUpperCase()] ?? null
      : null)
  );
}

export function titleOf(l: Listing): string {
  const t =
    l.headline ??
    l.development_name ??
    [resolvedSuburbOf(l), l.postcode_district].filter(Boolean).join(' ');
  // Upstream headlines ship "2-bedflat"; split the run-together word.
  let raw = (t || l.raia_id).replace(/(\d+-bed)flat/gi, '$1 flat');
  const area = resolvedSuburbOf(l);
  if (area && !raw.toLowerCase().includes(area.toLowerCase())) {
    raw = raw.replace(OUTWARD_IN_RE, (full, code: string) => `in ${area} ${code}`);
  }
  // A 0-bed room is marketed as a studio, never "0 Bed Flat".
  return l.bedrooms === 0
    ? raw.replace(/\b0[\s-]?bed(?:room)?s?\b(?:\s*(?:flat|apartment))?/gi, 'Studio Flat')
    : raw;
}

// Two spec groups, nulls dropped so nothing ever renders "UNKNOWN"/"NA".
export function specGroups(l: Listing): string[] {
  const rooms = [
    l.bedrooms != null ? (l.bedrooms === 0 ? 'Studio Flat' : `${l.bedrooms} Bed`) : null,
    l.bathrooms != null ? `${l.bathrooms} Bath` : null
  ].filter(Boolean);
  const size = [
    l.floor_area_sqm != null ? `${l.floor_area_sqm} m²` : null,
    l.floor != null ? `Fl ${l.floor}` : null
  ].filter(Boolean);
  return [rooms.join(' · '), size.join(' · ')].filter(Boolean);
}

export type Availability = 'now' | 'soon' | 'unavailable';

// The status decides whether the listing is live at all; the date then splits
// live listings into "now" and "soon". Drives the pill colour and filter.
export function availabilityOf(l: Listing, now: Date = new Date()): Availability {
  if (l.listing_status && l.listing_status !== 'available') return 'unavailable';
  if (!l.available_from || new Date(l.available_from) <= now) return 'now';
  return 'soon';
}

export function isVacant(l: Listing, now: Date = new Date()): boolean {
  return availabilityOf(l, now) === 'now';
}

// GB reads day-first with a 2-digit year; TH/MY keep the full year.
export function formatAvailabilityDate(l: Listing, date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year =
    countryOf(l) === 'GB'
      ? String(date.getUTCFullYear()).slice(-2)
      : String(date.getUTCFullYear());
  return `${dd}/${mm}/${year}`;
}

export function statusLabel(l: Listing, now: Date = new Date()): string {
  const availability = availabilityOf(l, now);
  if (availability === 'now') return 'Available Now';
  if (availability === 'unavailable') return 'Unavailable';
  const d = new Date(l.available_from as string);
  return Number.isNaN(d.getTime())
    ? 'Available Soon'
    : `Available ${formatAvailabilityDate(l, d)}`;
}

export function countryOf(l: Listing): CatalogCountry | null {
  const locode = (l.un_locode ?? '').toUpperCase();
  // UN/LOCODE prefix wins: a GBLON listing priced in MYR is still a UK property.
  if (locode.startsWith('GB')) return 'GB';
  if (locode.startsWith('TH')) return 'TH';
  if (locode.startsWith('MY')) return 'MY';
  if (l.jurisdiction === 'TH' || l.currency === 'THB') return 'TH';
  if (l.jurisdiction === 'MY' || l.currency === 'MYR') return 'MY';
  if (l.jurisdiction === 'GB' || l.currency === 'GBP') return 'GB';
  return null;
}

export function resolveDefaultCountry(ipCountry: string | null | undefined): CatalogCountry {
  const cc = ipCountry?.toUpperCase();
  return cc === 'TH' || cc === 'MY' ? cc : 'GB';
}

export type TtsLocale = 'en-GB' | 'th-TH' | 'ms-MY' | 'ja-JP' | 'zh-CN';
export type AppLang = 'en' | 'th' | 'ja' | 'ms' | 'zh';

// The spoken locale, shared by the request, the prefetch and the browser
// fallback so every market reaches its own voice. Location (UN/LOCODE) wins
// over currency: a Kyoto property priced in THB is still Japanese.
export function ttsLocaleOf(l: Listing): TtsLocale {
  const locode = (l.un_locode ?? '').toUpperCase();
  if (locode.startsWith('GB')) return 'en-GB';
  if (locode.startsWith('TH')) return 'th-TH';
  if (locode.startsWith('MY')) return 'ms-MY';
  if (locode.startsWith('JP')) return 'ja-JP';
  if (locode.startsWith('CN')) return 'zh-CN';
  if (l.jurisdiction === 'JP') return 'ja-JP';
  if (l.jurisdiction === 'CN') return 'zh-CN';
  const country = countryOf(l);
  if (country === 'TH') return 'th-TH';
  if (country === 'MY') return 'ms-MY';
  if (l.currency === 'JPY') return 'ja-JP';
  if (l.currency === 'CNY') return 'zh-CN';
  return 'en-GB';
}

// \b keeps /male/ from matching the "male" inside "female".
const GENDER_VOICE: Record<'female' | 'male', RegExp> = {
  female: /\bfemale\b|samantha|karen|moira|tessa|victoria|kyoko|kanya/i,
  male: /\bmale\b|daniel|alex|fred|david|otoya|niwat/i
};

export function voiceMatchesGender(name: string, gender: 'female' | 'male'): boolean {
  return GENDER_VOICE[gender].test(name);
}

export function priceThb(l: Listing): number | null {
  const p =
    l.service_type === 'sale' ? l.asking_price : (l.rent_pcm ?? (l.daily_rate ? l.daily_rate * 30 : null));
  if (p != null && l.currency === 'THB') return p;
  const gbp = priceGbp(l);
  return gbp != null ? Math.round(gbp * 45) : null;
}

// Monthly-equivalent price in MYR for the Malaysia budget filter.
export function priceMyr(l: Listing): number | null {
  const p =
    l.service_type === 'sale' ? l.asking_price : (l.rent_pcm ?? (l.daily_rate ? l.daily_rate * 30 : null));
  if (p != null && l.currency === 'MYR') return p;
  const gbp = priceGbp(l);
  return gbp != null ? Math.round(gbp * 5.6) : null;
}

export type ClusterId = 'all' | 'bkk' | 'lon' | 'other';

export const CLUSTER_PILLS: { id: ClusterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'bkk', label: 'Bangkok · Phloen Chit / Thonglor' },
  { id: 'lon', label: 'London · Canary Wharf / Holborn' }
];

export function clusterOf(l: Listing): ClusterId {
  const hay = [l.suburb, l.street_name, l.development_name, l.postcode_district, l.postcode_full, l.headline]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const locode = (l.un_locode ?? '').toUpperCase();
  if (l.currency === 'THB' || l.jurisdiction === 'TH' || locode.startsWith('TH')) {
    return /phloen chit|thong ?lor|sukhumvit|watthana|khlong toei|chit lom/.test(hay) ? 'bkk' : 'other';
  }
  if (l.currency === 'GBP' || l.jurisdiction === 'GB' || locode.startsWith('GB')) {
    return /canary wharf|holborn|\be14\b|\bwc1|\bwc2|\bec1/.test(hay) ? 'lon' : 'other';
  }
  return 'other';
}

// Reference UN/LOCODE places per CRAM jurisdiction, alphabetical by city name.
// Residential/commercial towns only — the ~3,000 non-residential port and
// rail-depot codes would drown the picker.
export type CatalogCountry = 'GB' | 'TH' | 'MY';

export const UN_LOCODE_CATALOG: Record<CatalogCountry, readonly { code: string; city: string }[]> = {
  GB: [
    { code: 'GBABD', city: 'Aberdeen' },
    { code: 'GBBAT', city: 'Bath' },
    { code: 'GBBEL', city: 'Belfast' },
    // Live listings carry GBBHX for Birmingham (upstream feed), so it stays here
    // even though UNECE also lists GBBHM for the city.
    { code: 'GBBHX', city: 'Birmingham' },
    { code: 'GBBMT', city: 'Bournemouth' },
    { code: 'GBBRF', city: 'Bradford' },
    { code: 'GBBSH', city: 'Brighton' },
    { code: 'GBBRS', city: 'Bristol' },
    { code: 'GBCBG', city: 'Cambridge' },
    { code: 'GBCDF', city: 'Cardiff' },
    { code: 'GBCHE', city: 'Cheltenham' },
    { code: 'GBCER', city: 'Chester' },
    { code: 'GBCOL', city: 'Colchester' },
    { code: 'GBCOV', city: 'Coventry' },
    { code: 'GBCRN', city: 'Croydon' },
    { code: 'GBDER', city: 'Derby' },
    { code: 'GBDUN', city: 'Dundee' },
    { code: 'GBEDH', city: 'Edinburgh' },
    { code: 'GBEXE', city: 'Exeter' },
    { code: 'GBGLW', city: 'Glasgow' },
    { code: 'GBGLO', city: 'Gloucester' },
    { code: 'GBGUI', city: 'Guildford' },
    { code: 'GBHUD', city: 'Huddersfield' },
    { code: 'GBINV', city: 'Inverness' },
    { code: 'GBIPS', city: 'Ipswich' },
    { code: 'GBKGN', city: 'Kingston upon Thames' },
    { code: 'GBLDS', city: 'Leeds' },
    { code: 'GBLEI', city: 'Leicester' },
    { code: 'GBLIV', city: 'Liverpool' },
    { code: 'GBLON', city: 'London' },
    { code: 'GBMAN', city: 'Manchester' },
    { code: 'GBMKH', city: 'Milton Keynes' },
    { code: 'GBNCL', city: 'Newcastle upon Tyne' },
    { code: 'GBNWI', city: 'Norwich' },
    { code: 'GBNOT', city: 'Nottingham' },
    { code: 'GBOXF', city: 'Oxford' },
    { code: 'GBPBO', city: 'Peterborough' },
    { code: 'GBPLY', city: 'Plymouth' },
    { code: 'GBPME', city: 'Portsmouth' },
    { code: 'GBRDG', city: 'Reading' },
    { code: 'GBSHF', city: 'Sheffield' },
    { code: 'GBSLH', city: 'Slough' },
    { code: 'GBSOU', city: 'Southampton' },
    { code: 'GBSTK', city: 'Stoke-on-Trent' },
    { code: 'GBSWA', city: 'Swansea' },
    { code: 'GBSWD', city: 'Swindon' },
    { code: 'GBWTF', city: 'Watford' },
    { code: 'GBWOK', city: 'Woking' },
    { code: 'GBWOL', city: 'Wolverhampton' },
    { code: 'GBYRK', city: 'York' }
  ],
  TH: [
    { code: 'THAYT', city: 'Ayutthaya' },
    { code: 'THBKK', city: 'Bangkok' },
    { code: 'THCNX', city: 'Chiang Mai' },
    { code: 'THCEI', city: 'Chiang Rai' },
    { code: 'THHDY', city: 'Hat Yai' },
    { code: 'THHHQ', city: 'Hua Hin' },
    { code: 'THKKC', city: 'Khon Kaen' },
    { code: 'THUSM', city: 'Koh Samui' },
    { code: 'THKBV', city: 'Krabi' },
    { code: 'THNMA', city: 'Nakhon Ratchasima' },
    { code: 'THNAN', city: 'Nan' },
    { code: 'THPYX', city: 'Pattaya' },
    { code: 'THHKT', city: 'Phuket' },
    { code: 'THRAY', city: 'Rayong' },
    { code: 'THSRT', city: 'Surat Thani' },
    { code: 'THTRG', city: 'Trang' },
    { code: 'THUBP', city: 'Ubon Ratchathani' },
    { code: 'THUDN', city: 'Udon Thani' }
  ],
  MY: [
    { code: 'MYAOR', city: 'Alor Setar' },
    { code: 'MYBTU', city: 'Bintulu' },
    { code: 'MYZCA', city: 'Cyberjaya' },
    { code: 'MYPEN', city: 'George Town' },
    { code: 'MYIPH', city: 'Ipoh' },
    { code: 'MYJHB', city: 'Johor Bahru' },
    { code: 'MYKGR', city: 'Kangar' },
    { code: 'MYKBR', city: 'Kota Bharu' },
    { code: 'MYBKI', city: 'Kota Kinabalu' },
    { code: 'MYKUL', city: 'Kuala Lumpur' },
    { code: 'MYKUA', city: 'Kuantan' },
    { code: 'MYKCH', city: 'Kuching' },
    { code: 'MYLBU', city: 'Labuan' },
    { code: 'MYLGK', city: 'Langkawi' },
    { code: 'MYMKZ', city: 'Malacca' },
    { code: 'MYMYY', city: 'Miri' },
    { code: 'MYPJA', city: 'Petaling Jaya' },
    { code: 'MYPUT', city: 'Putrajaya' },
    { code: 'MYSDK', city: 'Sandakan' },
    { code: 'MYSHA', city: 'Shah Alam' },
    { code: 'MYSBW', city: 'Sibu' },
    { code: 'MYSUB', city: 'Subang Jaya' },
    { code: 'MYTPG', city: 'Taiping' }
  ]
};

// Plain-English place labels. un_locode gives the city; the suburb is the leaf
// users actually type. Codes never leak into the UI.
const CITY_BY_LOCODE: Record<string, string> = Object.fromEntries(
  Object.values(UN_LOCODE_CATALOG)
    .flat()
    .map(({ code, city }) => [code, city])
);

// City names a user can pick for a country before any listing exists there.
export function catalogCities(country: CatalogCountry): string[] {
  return UN_LOCODE_CATALOG[country].map((c) => c.city).sort((a, b) => a.localeCompare(b));
}

export function cityOf(l: Listing): string | null {
  const code = (l.un_locode ?? '').toUpperCase();
  if (CITY_BY_LOCODE[code]) return CITY_BY_LOCODE[code];
  if (code.startsWith('TH')) return 'Thailand';
  if (code.startsWith('MY')) return 'Malaysia';
  if (code.startsWith('GB')) return 'UK';
  const jurisdiction = (l.jurisdiction ?? '').toUpperCase();
  if (jurisdiction === 'TH') return 'Thailand';
  if (jurisdiction === 'MY') return 'Malaysia';
  if (jurisdiction === 'GB') return 'UK';
  if (l.currency === 'THB') return 'Thailand';
  if (l.currency === 'MYR') return 'Malaysia';
  if (l.currency === 'GBP') return 'UK';
  return null;
}

// Every label this listing can be found by: city and suburb.
export function locationsOf(l: Listing): string[] {
  return [cityOf(l), resolvedSuburbOf(l)].filter((x): x is string => Boolean(x));
}

// Monthly-equivalent price in GBP for the budget filter.
// shortcut: fixed 45 THB/GBP, use a rate table when clients care about FX drift.
export function priceGbp(l: Listing): number | null {
  const p =
    l.service_type === 'sale' ? l.asking_price : (l.rent_pcm ?? (l.daily_rate ? l.daily_rate * 30 : null));
  if (p == null) return null;
  if (l.currency === 'THB') return Math.round(p / 45);
  if (l.currency === 'MYR') return Math.round(p / 5.6);
  return p;
}

export function viewingSlots(now: Date = new Date()): { iso: string; label: string }[] {
  const out: { iso: string; label: string }[] = [];
  for (let d = 1; d <= 3; d++) {
    for (const h of [10, 12, 15, 18]) {
      const t = new Date(now);
      t.setDate(t.getDate() + d);
      t.setHours(h, 0, 0, 0);
      out.push({
        iso: t.toISOString(),
        label: t.toLocaleString('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        })
      });
    }
  }
  return out;
}

export function plainText(html: string | null): string {
  return (html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Media & narration script ───────────────────────────────────────────────

const YOUTUBE_RE =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

export function youtubeIdOf(url: string | null | undefined): string | null {
  return url?.match(YOUTUBE_RE)?.[1] ?? null;
}

// A YouTube link in <video src> fails silently, so it gets a player instead.
export const isYouTubeUrl = (url: string | null | undefined): boolean => youtubeIdOf(url) !== null;

// ── Buy | Rent | Stay feeds ──────────────────────────────────────────────────

export type Feed = 'sales' | 'rentals' | 'stay';

const SALES_TYPES = ['sale', 'sales', 'buy'];
const RENTAL_TYPES = ['long_term', 'lettings', 'rent', 'rental'];
// short_term is this codebase's name for a short let.
const STAY_TYPES = ['short_term', 'short_let', 'stay', 'holiday_let'];

// Portal rows carry transaction_type (SALES/LETTINGS), feed rows service_type;
// they disagree on spelling, so both are normalised before matching. A listing
// that matches neither belongs to no feed rather than to both.
export function feedOf(l: Listing): Feed | null {
  // A short let is also transaction_type LETTINGS, so service_type is checked
  // first or every Stay listing would be swept into Rent.
  const st = (l.service_type ?? '').toLowerCase();
  if (STAY_TYPES.includes(st)) return 'stay';
  const tt = (l as Listing & { transaction_type?: string | null }).transaction_type;
  const classify = (v?: string | null): Feed | null => {
    const s = (v ?? '').toLowerCase();
    if (SALES_TYPES.includes(s)) return 'sales';
    if (RENTAL_TYPES.includes(s)) return 'rentals';
    return null;
  };
  return classify(tt) ?? classify(l.service_type);
}

// ── Media slide ordering ───────────────────────────────────────────────────

export type MediaSlide = {
  kind: 'photo' | 'video' | 'tour360' | 'youtube' | 'floorplan';
  url: string;
  // Static frame shown before the slide is opened (video/360/YouTube posters).
  poster?: string;
};

// hero photo → top photos → video/360 posters → remaining photos → floorplans last.
// 360 and YouTube arrive as posters so the carousel keeps deck gestures.
export function mediaSlidesOf(l: Listing): MediaSlide[] {
  const photos: string[] = [];
  const add = (u: string | null | undefined) => {
    if (u && u !== l.floor_plan_url && !photos.includes(u)) photos.push(u);
  };
  add(l.photo_url);
  add(l.featured_image_url);
  for (const p of [...(l.photos ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    add(p.url);
  }

  const slides: MediaSlide[] = [];
  const [hero, ...rest] = photos;
  if (hero) slides.push({ kind: 'photo', url: hero });
  for (const url of rest.slice(0, 2)) slides.push({ kind: 'photo', url });

  const poster = rest[2] ?? hero;
  if (l.video_url) {
    const yt = youtubeIdOf(l.video_url);
    slides.push({
      kind: yt ? 'youtube' : 'video',
      url: l.video_url,
      poster: yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : poster
    });
  }
  if (l.tour_360_url) slides.push({ kind: 'tour360', url: l.tour_360_url, poster });

  for (const url of rest.slice(2)) slides.push({ kind: 'photo', url });
  if (l.floor_plan_url) slides.push({ kind: 'floorplan', url: l.floor_plan_url });
  return slides;
}

const DESCRIPTION_MAX = 480;

export type ContactChannel = 'Personal AI Agent' | 'WhatsApp' | 'Telegram';

const LOCAL_COPY: Record<AppLang, { pricePrefix: string; priceSuffix: string; cta: (vendor: string, channel?: ContactChannel) => string }> = {
  en: {
    pricePrefix: 'And all this is only',
    priceSuffix: '.',
    cta: (vendor, channel = 'Personal AI Agent') => `Contact ${vendor} via ${channel} below.`
  },
  th: {
    pricePrefix: 'และทั้งหมดนี้ในราคาเพียง',
    priceSuffix: ' เท่านั้น',
    cta: (vendor, channel = 'Personal AI Agent') => `ติดต่อ ${vendor} ผ่าน ${channel} ด้านล่าง`
  },
  ja: {
    pricePrefix: 'これらすべてがわずか',
    priceSuffix: 'です。',
    cta: (vendor, channel = 'Personal AI Agent') => `以下の ${channel} 経由で ${vendor} に連絡してください。`
  },
  ms: {
    pricePrefix: 'Dan semua ini hanya',
    priceSuffix: '.',
    cta: (vendor, channel = 'Personal AI Agent') => `Hubungi ${vendor} melalui ${channel} di bawah.`
  },
  zh: {
    pricePrefix: '所有这些仅需',
    priceSuffix: '。',
    cta: (vendor, channel = 'Personal AI Agent') => `请通过下方 ${channel} 联系 ${vendor}。`
  }
};

// One script for every surface: the TTS endpoint, the browser voice fallback
// and the written "About this property" card all end on price + vendor CTA.
export function buildPropertyDescriptionWithCta(
  l: Listing,
  vendorOrgName?: string | null,
  lang: AppLang = 'en',
  contactChannel: ContactChannel = 'Personal AI Agent'
): string {
  const copy = LOCAL_COPY[lang] ?? LOCAL_COPY.en;
  const priceSentence = `${copy.pricePrefix} ${priceLabel(l)}${copy.priceSuffix}`;
  const vendor = vendorOrgName?.trim() || (lang === 'th' ? 'ตัวแทนอสังหาริมทรัพย์' : lang === 'ja' ? '不動産エージェント' : lang === 'ms' ? 'ejen hartanah' : lang === 'zh' ? '房产中介' : 'the listing agent');
  const ctaSentence = copy.cta(vendor, contactChannel);
  const suffix = ` ${priceSentence} ${ctaSentence}`;

  let rawProse: string | null = null;
  if (l.i18n_status === 'ok') {
    if (lang === 'th') rawProse = l.marketing_description_th ?? null;
    else if (lang === 'ja') rawProse = l.marketing_description_ja ?? null;
    else if (lang === 'ms') rawProse = l.marketing_description_ms ?? null;
    else if (lang === 'zh') rawProse = l.marketing_description_zh ?? null;
  }
  if (!rawProse) {
    rawProse = l.marketing_description;
  }

  const desc = plainText(sanitizeDescription(rawProse));

  let rawBody: string;
  if (desc) {
    rawBody = desc;
  } else {
    // Structured synthesized sales narrative fallback
    const area = [resolvedSuburbOf(l), l.postcode_district].filter(Boolean).join(', ');
    const isSale = l.service_type === 'sale';
    const actionWord = isSale ? 'Buy' : 'Rent';
    const typeWord = l.bedrooms === 0 ? 'Studio' : l.bedrooms != null ? `${l.bedrooms}-bed property` : 'property';
    const hook = `${actionWord} this ${typeWord}${area ? ` in ${area}` : ''}`;

    const highlights: string[] = [];
    if (l.features && l.features.length > 0) {
      highlights.push(l.features.slice(0, 3).join(', '));
    }
    if (l.furnishing) {
      highlights.push(l.furnishing.replace(/_/g, ' '));
    }
    const specs = specGroups(l).join(' · ');
    if (specs) {
      highlights.push(specs);
    }
    highlights.push(statusLabel(l).toLowerCase());

    const highlightsText = highlights.length > 0 ? ` Features include ${highlights.join('; ')}.` : '';
    rawBody = `${hook}.${highlightsText}`;
  }

  const bodyText = /[.!?…]$/.test(rawBody) ? rawBody : `${rawBody}.`;

  const maxBodyLen = Math.max(0, DESCRIPTION_MAX - suffix.length);
  let body = bodyText;
  if (body.length > maxBodyLen) {
    body = `${body.slice(0, maxBodyLen).replace(/\s+\S*$/, '')}…`;
    if (!/[.!?…]$/.test(body)) {
      body = `${body}…`;
    }
  }

  return `${body}${suffix}`;
}

// A card with no video and no image renders a dead "No media" stage, so rich
// cards are ranked above bare ones.
export function hasMedia(l: Listing): boolean {
  return Boolean(l.video_url || l.photos?.length || l.photo_url || l.featured_image_url);
}

export function scoreAiPrompt(l: Listing, prompt: string): number {
  if (!prompt || !prompt.trim()) return 0;
  const tokens = prompt
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (!tokens.length) return 0;

  let score = 0;
  const features = (l.features ?? []).map((f) => f.toLowerCase());
  const headline = (l.headline ?? '').toLowerCase();
  const suburb = (l.suburb ?? '').toLowerCase();
  const propertyType = (l.property_type ?? '').toLowerCase();
  const furnishing = (l.furnishing ?? '').toLowerCase();
  const desc = plainText(l.marketing_description).toLowerCase();

  for (const token of tokens) {
    if (features.some((f) => f.includes(token))) {
      score += 3;
    }
    if (
      headline.includes(token) ||
      suburb.includes(token) ||
      propertyType.includes(token) ||
      furnishing.includes(token)
    ) {
      score += 2;
    }
    if (desc.includes(token)) {
      score += 1;
    }
  }

  return score;
}

export function filterProperties(
  listings: Listing[],
  opts: {
    locations?: string[];
    serviceType?: string;
    maxBudget?: number | null;
    minBeds?: number | null;
    aiPrompt?: string;
    statusFilter?: 'all' | 'available' | 'let_agreed';
  } = {}
): Listing[] {
  let filtered = listings.filter((l) => {
    if (opts.statusFilter && opts.statusFilter !== 'all') {
      if (opts.statusFilter === 'available' && l.listing_status && l.listing_status !== 'available') {
        return false;
      }
      if (opts.statusFilter === 'let_agreed' && l.listing_status !== 'let_agreed') {
        return false;
      }
    }

    if (opts.serviceType && l.service_type !== opts.serviceType) {
      return false;
    }

    if (opts.minBeds != null && (l.bedrooms == null || l.bedrooms < opts.minBeds)) {
      return false;
    }

    if (opts.maxBudget != null) {
      if (l.service_type === 'sale') {
        if (opts.maxBudget >= 25000 && (l.asking_price == null || l.asking_price > opts.maxBudget)) {
          return false;
        }
      } else {
        const pGbp = priceGbp(l);
        if (pGbp != null && pGbp > opts.maxBudget) {
          return false;
        }
      }
    }

    if (opts.locations && opts.locations.length > 0) {
      const locs = locationsOf(l).map((x) => x.toLowerCase());
      const matchesLoc = opts.locations.some((reqLoc) =>
        locs.some((loc) => loc.includes(reqLoc.toLowerCase()) || reqLoc.toLowerCase().includes(loc))
      );
      if (!matchesLoc) return false;
    }

    return true;
  });

  if (opts.aiPrompt && opts.aiPrompt.trim()) {
    const scored = filtered
      .map((l) => ({ listing: l, score: scoreAiPrompt(l, opts.aiPrompt!) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    filtered = scored.map((item) => item.listing);
  }

  return filtered;
}

export function buildWellKnownPropertyCard(l: Listing) {
  const price = l.rent_pcm ?? l.asking_price ?? l.daily_rate ?? 0;
  return {
    schema_version: '0.3.0',
    raia_id: l.raia_id,
    agent_id: l.agent_id,
    agent_card_url: l.agent_card_url,
    enquiry_endpoint: l.enquiry_endpoint,
    headline: l.headline,
    marketing_description: plainText(l.marketing_description),
    property_type: l.property_type,
    service_type: l.service_type,
    bedrooms: l.bedrooms,
    bathrooms: l.bathrooms,
    floor_area_sqm: l.floor_area_sqm,
    furnishing: l.furnishing,
    price,
    currency: l.currency ?? 'GBP',
    rent_pcm: l.rent_pcm,
    asking_price: l.asking_price,
    daily_rate: l.daily_rate,
    available_from: l.available_from,
    listing_status: l.listing_status,
    location: {
      un_locode: l.un_locode,
      jurisdiction: l.jurisdiction,
      latitude: l.latitude,
      longitude: l.longitude,
      postcode_full: l.postcode_full,
      postcode_district: l.postcode_district,
      postcode_sector: l.postcode_sector,
      street_name: l.street_name,
      building_number: l.building_number,
      suburb: l.suburb
    },
    media: {
      photo_url: l.photo_url,
      featured_image_url: l.featured_image_url,
      photos: l.photos,
      floor_plan_url: l.floor_plan_url ?? null,
      video_url: l.video_url,
      tour_360_url: l.tour_360_url ?? null
    },
    tour_360_url: l.tour_360_url ?? null,
    floor_plan_url: l.floor_plan_url ?? null,
    estate_agent: getEstateAgentProfile(l.agent_id),
    features: l.features,
    jurisdiction_extensions: l.jurisdiction_extensions
  };
}
