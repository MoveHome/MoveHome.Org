import { describe, expect, it } from 'vitest';
import type { Listing } from '../lib/types';
import { feedOf, mediaSlidesOf } from '../lib/property-card';

const listing = (over: Partial<Listing> = {}): Listing =>
  ({ photos: [], service_type: 'long_term', ...over }) as Listing;

const kinds = (l: Listing) => mediaSlidesOf(l).map((s) => s.kind);
const urls = (l: Listing) => mediaSlidesOf(l).map((s) => s.url);

describe('Buy | Rent | Stay feed classification', () => {
  it('routes every long-let service_type to rentals', () => {
    for (const service_type of ['long_term', 'lettings', 'rent', 'rental'] as const) {
      expect(feedOf(listing({ service_type: service_type as never }))).toBe('rentals');
    }
  });

  it('routes every short-let service_type to stay, never rentals', () => {
    for (const service_type of ['short_term', 'short_let', 'stay', 'holiday_let'] as const) {
      expect(feedOf(listing({ service_type: service_type as never }))).toBe('stay');
      // A short let is also transaction_type LETTINGS upstream.
      expect(
        feedOf(listing({ service_type: service_type as never, transaction_type: 'LETTINGS' } as never))
      ).toBe('stay');
    }
  });

  it('routes sale spellings to sales', () => {
    expect(feedOf(listing({ service_type: 'sale' }))).toBe('sales');
    expect(feedOf(listing({ service_type: 'sales' as never }))).toBe('sales');
    expect(feedOf(listing({ service_type: 'buy' as never }))).toBe('sales');
  });

  it('reads portal transaction_type case-insensitively', () => {
    expect(feedOf(listing({ service_type: 'sale', transaction_type: 'LETTINGS' } as never))).toBe(
      'rentals'
    );
    expect(feedOf(listing({ service_type: 'long_term', transaction_type: 'SALES' } as never))).toBe(
      'sales'
    );
  });

  it('falls back to service_type when transaction_type is unrecognised', () => {
    expect(feedOf(listing({ service_type: 'sale', transaction_type: 'SWAP' } as never))).toBe('sales');
  });

  it('populates all three feeds and leaves unknown spellings unfiled', () => {
    const types = ['long_term', 'short_term', 'sale', 'lettings', 'rent', 'buy', 'nonsense'];
    const filed = new Set(
      types.map((t) => feedOf(listing({ service_type: t as never })) ?? 'none')
    );
    expect([...filed].sort()).toEqual(['none', 'rentals', 'sales', 'stay']);
  });
});

describe('media slide ordering', () => {
  it('orders hero → top photos → 360/YouTube posters → rest → floorplan last', () => {
    const l = listing({
      photo_url: 'p1.jpg',
      featured_image_url: 'p2.jpg',
      photos: [
        { url: 'p3.jpg', order: 3 },
        { url: 'p4.jpg', order: 1 },
        { url: 'p5.jpg', order: 2 }
      ],
      video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      tour_360_url: 'https://tour.giraffe360.com/abc/',
      floor_plan_url: 'floor.png'
    });

    expect(urls(l)).toEqual([
      'p1.jpg', // hero
      'p2.jpg', // top photo 1
      'p4.jpg', // top photo 2 (photos sorted by order)
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ', // video poster
      'https://tour.giraffe360.com/abc/', // 360 poster
      'p5.jpg', // remaining photos
      'p3.jpg',
      'floor.png' // floorplans last
    ]);
    expect(kinds(l)).toEqual([
      'photo',
      'photo',
      'photo',
      'youtube',
      'tour360',
      'photo',
      'photo',
      'floorplan'
    ]);
  });

  it('keeps 360 and YouTube as poster slides, never a bare iframe', () => {
    const l = listing({
      photo_url: 'p1.jpg',
      video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      tour_360_url: 'https://tour.giraffe360.com/abc/'
    });
    const [youtube, tour] = mediaSlidesOf(l).filter(
      (s) => s.kind === 'youtube' || s.kind === 'tour360'
    );
    expect(youtube.poster).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(tour.poster).toBe('p1.jpg');
  });

  it('drops the floorplan out of the photo run and de-duplicates the hero', () => {
    const l = listing({
      photo_url: 'p1.jpg',
      photos: [
        { url: 'p1.jpg', order: 1 },
        { url: 'floor.png', order: 2 }
      ],
      floor_plan_url: 'floor.png'
    });
    expect(urls(l)).toEqual(['p1.jpg', 'floor.png']);
    expect(kinds(l)).toEqual(['photo', 'floorplan']);
  });

  it('returns an empty list for a listing with no media', () => {
    expect(mediaSlidesOf(listing())).toEqual([]);
  });
});
