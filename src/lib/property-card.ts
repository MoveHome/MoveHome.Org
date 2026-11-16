// Pure presentation helpers for the swipe deck. Kept out of the client
// component so server pages can use them without crossing the RSC boundary.

import type { Listing } from './types';

const SYMBOLS: Record<string, string> = { THB: '฿', GBP: '£', USD: '$', EUR: '€' };

export function priceLabel(l: Listing): string {
  const money = (n: number) =>
    `${SYMBOLS[l.currency ?? ''] ?? `${l.currency ?? ''} `}${n.toLocaleString('en-GB')}`;
  if (l.service_type === 'sale' && l.asking_price) return money(l.asking_price);
  if (l.service_type === 'short_term' && l.daily_rate) return `${money(l.daily_rate)}/night`;
  if (l.rent_pcm) return `${money(l.rent_pcm)}${l.currency === 'THB' ? '/mo' : ' pcm'}`;
  return 'Price on application';
}

export function titleOf(l: Listing): string {
  const t =
    l.headline ??
    l.development_name ??
    [l.suburb, l.postcode_district].filter(Boolean).join(' ');
  // Upstream headlines ship "2-bedflat"; split the run-together word.
  return (t || l.raia_id).replace(/(\d+-bed)flat/gi, '$1 flat');
}

// Two spec groups, nulls dropped so nothing ever renders "UNKNOWN"/"NA".
export function specGroups(l: Listing): string[] {
  const rooms = [
    l.bedrooms != null ? `${l.bedrooms} Bed` : null,
    l.bathrooms != null ? `${l.bathrooms} Bath` : null
  ].filter(Boolean);
  const size = [
    l.floor_area_sqm != null ? `${l.floor_area_sqm} m²` : null,
    l.floor != null ? `Fl ${l.floor}` : null
  ].filter(Boolean);
  return [rooms.join(' · '), size.join(' · ')].filter(Boolean);
}

// Vacant = live and not future-dated. Drives the HUD dot colour and copy.
export function isVacant(l: Listing, now: Date = new Date()): boolean {
  if (l.listing_status && l.listing_status !== 'available') return false;
  return !l.available_from || new Date(l.available_from) <= now;
}

export function statusLabel(l: Listing, now: Date = new Date()): string {
  if (l.listing_status === 'available' || !l.listing_status) {
    if (!isVacant(l, now)) {
      const d = new Date(l.available_from as string);
      return `Available ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    }
    return 'Vacant · Available Now';
  }
  return l.listing_status.replace(/_/g, ' ');
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

// A card with no video and no image renders a dead "No media" stage, so rich
// cards are ranked above bare ones.
export function hasMedia(l: Listing): boolean {
  return Boolean(l.video_url || l.photos?.length || l.photo_url || l.featured_image_url);
}
