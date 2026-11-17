import { describe, expect, it, vi } from 'vitest';
import { translateListingProse, computeProseHash } from '../lib/i18n/translate-listing';
import { buildPropertyDescriptionWithCta } from '../lib/property-card';
import { voiceFor, modelFor, TTS_LANGS } from '../lib/tts';
import type { Listing } from '../lib/types';

describe('i18n & 5-Language Translation', () => {
  const dummyListing: Listing = {
    raia_id: 'prop-gb-test-1234',
    agent_id: 'org-gb-001',
    agent_card_url: null,
    enquiry_endpoint: null,
    raia_schema_version: '0.3.0',
    un_locode: 'GBLON',
    jurisdiction: 'GB',
    headline: 'Modern 2 Bed Flat',
    marketing_description: 'A beautiful luxury apartment located in central London with stunning city views.',
    marketing_description_th: 'อพาร์ทเมนท์หรูหราสวยงามตั้งอยู่ใจกลางลอนดอน',
    marketing_description_ja: 'ロンドン中心部に位置する美しい高級アパートメント',
    marketing_description_ms: 'Pangsapuri mewah yang indah terletak di pusat London',
    marketing_description_zh: '位于伦敦市中心的美丽豪华公寓',
    i18n_source_hash: '9a8b7c6d5e4f',
    i18n_status: 'ok',
    latitude: 51.5074,
    longitude: -0.1278,
    postcode_full: 'SW1A 1AA',
    postcode_district: 'SW1A',
    postcode_sector: 'SW1A 1',
    street_name: 'High Street',
    building_number: '10',
    suburb: 'Westminster',
    property_type: 'flat',
    service_type: 'long_term',
    bedrooms: 2,
    bathrooms: 2,
    floor_area_sqm: 75,
    floor: 3,
    total_floors: 10,
    furnishing: 'furnished',
    is_new_build: false,
    development_name: null,
    rent_pcm: 2500,
    daily_rate: null,
    asking_price: null,
    currency: 'GBP',
    available_from: null,
    listing_status: 'available',
    visibility: 'public',
    publish_from: null,
    publish_until: null,
    features: ['Balcony', 'Concierge'],
    featured_image_url: null,
    photo_url: 'https://example.com/photo.jpg',
    photos: [],
    floor_plan_url: null,
    video_url: null,
    tour_360_url: null,
    jurisdiction_extensions: null,
    listed_at: '2026-01-01T00:00:00Z',
    first_seen_at: '2026-01-01T00:00:00Z',
    last_seen_at: null,
    snapshot_version: 1,
    synced_at: '2026-01-01T00:00:00Z'
  };

  describe('translateListingProse', () => {
    it('skips translation if hash matches and status is ok', async () => {
      const mockFetch = vi.fn();
      const expectedHash = computeProseHash(dummyListing.marketing_description!);
      const res = await translateListingProse({
        raia_id: 'prop-gb-test-1234',
        marketing_description: dummyListing.marketing_description,
        i18n_source_hash: expectedHash,
        i18n_status: 'ok'
      }, mockFetch);

      expect(res.skipped).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('validates Gemini response JSON and rejects prompt injection currency hallucinations', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  th: 'ราคาเพียง ฿50,000 ต่อเดือน', // Hallucinated price not in source
                  ja: 'ロンドンのアパート',
                  ms: 'Pangsapuri London',
                  zh: '伦敦公寓'
                })
              }]
            }
          }]
        })
      });

      process.env.GEMINI_API_KEY = 'mock-key';
      const res = await translateListingProse({
        raia_id: 'prop-gb-test-1234',
        marketing_description: 'A beautiful luxury apartment in London.',
        i18n_status: 'pending'
      }, mockFetch);

      expect(res.success).toBe(false);
    });

    it('returns validated translations on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  th: 'อพาร์ทเมนท์สวยงามในลอนดอน',
                  ja: 'ロンドンの美しいアパートメント',
                  ms: 'Pangsapuri yang indah di London',
                  zh: '伦敦的公寓'
                })
              }]
            }
          }]
        })
      });

      process.env.GEMINI_API_KEY = 'mock-key';
      const res = await translateListingProse({
        raia_id: 'prop-gb-test-1234',
        marketing_description: 'A beautiful apartment in London.',
        i18n_status: 'pending'
      }, mockFetch);

      expect(res.success).toBe(true);
      expect(res.translations?.th).toBe('อพาร์ทเมนท์สวยงามในลอนดอน');
    });
  });

  describe('buildPropertyDescriptionWithCta', () => {
    it('assembles localized description and closing price/CTA across all 5 languages', () => {
      const en = buildPropertyDescriptionWithCta(dummyListing, 'Acme Realty', 'en');
      expect(en).toContain('A beautiful luxury apartment');
      expect(en).toContain('And all this is only £2,500 pcm.');
      expect(en).toContain('Contact Acme Realty via Personal AI Agent below.');

      const th = buildPropertyDescriptionWithCta(dummyListing, 'Acme Realty', 'th');
      expect(th).toContain('อพาร์ทเมนท์หรูหราสวยงามตั้งอยู่ใจกลางลอนดอน');
      expect(th).toContain('และทั้งหมดนี้ในราคาเพียง £2,500 pcm');
      expect(th).toContain('ติดต่อ Acme Realty ผ่าน Personal AI Agent ด้านล่าง');

      const ja = buildPropertyDescriptionWithCta(dummyListing, 'Acme Realty', 'ja');
      expect(ja).toContain('ロンドン中心部に位置する美しい高級アパートメント');
      expect(ja).toContain('これらすべてがわずか £2,500 pcmです。');
      expect(ja).toContain('以下の Personal AI Agent 経由で Acme Realty に連絡してください。');

      const ms = buildPropertyDescriptionWithCta(dummyListing, 'Acme Realty', 'ms');
      expect(ms).toContain('Pangsapuri mewah yang indah terletak di pusat London');
      expect(ms).toContain('Dan semua ini hanya £2,500 pcm.');
      expect(ms).toContain('Hubungi Acme Realty melalui Personal AI Agent di bawah.');

      const zh = buildPropertyDescriptionWithCta(dummyListing, 'Acme Realty', 'zh');
      expect(zh).toContain('位于伦敦市中心的美丽豪华公寓');
      expect(zh).toContain('所有这些仅需 £2,500 pcm。');
      expect(zh).toContain('请通过下方 Personal AI Agent 联系 Acme Realty。');
    });

    it('falls back to English marketing_description when translation status is not ok', () => {
      const pendingListing = { ...dummyListing, i18n_status: 'pending' as const };
      const th = buildPropertyDescriptionWithCta(pendingListing, 'Acme Realty', 'th');
      expect(th).toContain('A beautiful luxury apartment');
      expect(th).toContain('และทั้งหมดนี้ในราคาเพียง £2,500 pcm');
    });
  });

  describe('ElevenLabs TTS voice & model mapping', () => {
    it('includes zh-CN in TTS_LANGS', () => {
      expect(TTS_LANGS).toContain('zh-CN');
    });

    it('maps zh-CN voices and model correctly', () => {
      expect(modelFor('zh-CN')).toBe('eleven_flash_v2_5');
      const femaleVoice = voiceFor('zh-CN', 'female');
      const maleVoice = voiceFor('zh-CN', 'male');
      expect(femaleVoice).toBe('LcfcDJNUP1GQjkzn1xUU');
      expect(maleVoice).toBe('g5CIjZEefAph4nQFvHAz');
    });
  });
});
