// The honest location rail. A capture resolves to an outcode-level centroid (the
// TV draws an "approx" ring around it) or to nothing at all — a capture with no
// location stores NULL coordinates and is flagged unavailable. A coordinate only
// ever comes from the gazetteer centroid below: nothing is offset, seeded or
// bent towards the venue. An invented coordinate is a lying success and a GDPR
// accuracy bug.

export interface LocationRail {
  latitude: number | null;
  longitude: number | null;
  /** City-level code we cannot derive honestly, so it stays null. */
  un_locode: string | null;
  location_unavailable: boolean;
  /** 'outcode' = approx ring only; 'none' = no honest location was derivable. */
  precision: 'outcode' | 'none';
  outcode?: string;
}

// shortcut: hand-built Zone-1 gazetteer, enough for the expo demo; swap for a
// real postcode geocoder when the demo leaves zone 1.
const OUTCODE_CENTROIDS: Record<string, [number, number]> = {
  W1: [51.5154, -0.1459],
  W2: [51.514, -0.18],
  W6: [51.492, -0.225],
  W8: [51.501, -0.19],
  W11: [51.512, -0.205],
  WC1: [51.5245, -0.125],
  WC2: [51.512, -0.123],
  EC1: [51.5245, -0.09],
  EC2: [51.52, -0.08],
  E1: [51.515, -0.055],
  E2: [51.528, -0.06],
  E8: [51.546, -0.075],
  E14: [51.506, -0.02],
  E15: [51.54, -0.01],
  E17: [51.586, -0.02],
  N1: [51.535, -0.1],
  N7: [51.553, -0.115],
  N16: [51.562, -0.08],
  NW1: [51.535, -0.145],
  NW6: [51.542, -0.195],
  SE1: [51.503, -0.09],
  SE5: [51.474, -0.09],
  SE15: [51.47, -0.06],
  SW1: [51.499, -0.14],
  SW2: [51.46, -0.12],
  SW3: [51.492, -0.165],
  SW7: [51.496, -0.177],
  SW11: [51.465, -0.165],
  SW18: [51.456, -0.19],
  CR0: [51.376, -0.098]
};

const LOCALITY_OUTCODE: Record<string, string> = {
  'baker st': 'W1',
  'baker street': 'W1',
  soho: 'W1',
  mayfair: 'W1',
  shoreditch: 'EC2',
  whitechapel: 'E1',
  'bethnal green': 'E2',
  dalston: 'E8',
  hackney: 'E8',
  'canary wharf': 'E14',
  stratford: 'E15',
  walthamstow: 'E17',
  islington: 'N1',
  holloway: 'N7',
  'stamford hill': 'N16',
  camden: 'NW1',
  kilburn: 'NW6',
  kensington: 'W8',
  'notting hill': 'W11',
  paddington: 'W2',
  hammersmith: 'W6',
  lambeth: 'SE1',
  camberwell: 'SE5',
  peckham: 'SE15',
  westminster: 'SW1',
  brixton: 'SW2',
  chelsea: 'SW3',
  'south kensington': 'SW7',
  clapham: 'SW11',
  earlsfield: 'SW18',
  croydon: 'CR0'
};

const LOCALITIES_LONGEST_FIRST = Object.keys(LOCALITY_OUTCODE).sort((a, b) => b.length - a.length);

/** W1A 1AA -> W1; W1 -> W1; nonsense -> undefined. Never guesses. */
export function outcodeOf(postcode: string | null | undefined): string | undefined {
  const match = /^([A-Z]{1,2}\d[A-Z\d]?)/.exec((postcode ?? '').toUpperCase().replace(/\s+/g, ''));
  return match ? match[1] : undefined;
}

function localityIn(text: string): string | undefined {
  const lower = text.toLowerCase();
  const hit = LOCALITIES_LONGEST_FIRST.find((name) => lower.includes(name));
  return hit ? LOCALITY_OUTCODE[hit] : undefined;
}

/** Exact outcode when the gazetteer knows it, else its district (W1A -> W1). */
function resolveOutcode(outcode: string | undefined): { outcode: string; centroid: [number, number] } | undefined {
  if (!outcode) return undefined;
  const exact = OUTCODE_CENTROIDS[outcode];
  if (exact) return { outcode, centroid: exact };
  const district = /^([A-Z]{1,2}\d)/.exec(outcode)?.[1];
  const fallback = district ? OUTCODE_CENTROIDS[district] : undefined;
  return district && fallback ? { outcode: district, centroid: fallback } : undefined;
}

export function geocodeLocation(postcode: string | null | undefined, text: string): LocationRail {
  const resolved = resolveOutcode(outcodeOf(postcode) ?? localityIn(text ?? ''));

  if (!resolved) {
    return {
      latitude: null,
      longitude: null,
      un_locode: null,
      location_unavailable: true,
      precision: 'none'
    };
  }

  return {
    latitude: resolved.centroid[0],
    longitude: resolved.centroid[1],
    un_locode: null,
    location_unavailable: false,
    precision: 'outcode',
    outcode: resolved.outcode
  };
}
