#!/usr/bin/env node
// One-off backfill: give every active UK card a readable area next to its bare
// outward postcode ("... in HA9" → "... in Wembley HA9"), and seed the sale /
// short-stay variants of the Parker Street and Philbeach Gardens cards.
//
// USAGE
//   npx tsx scripts/backfill-uk-suburb-areas.ts          # dry run
//   npx tsx scripts/backfill-uk-suburb-areas.ts --write
//
// ENV  NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (from .env.local)

import { createClient } from '@supabase/supabase-js';
import { UK_POSTCODE_AREA_MAP } from '../src/lib/property-card';

const write = process.argv.includes('--write');
try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local: rely on the ambient environment.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');

const db = createClient(url, key, { auth: { persistSession: false } });
const OUTWARD_IN_RE = /\bin\s+([A-Z]{1,2}\d[A-Z\d]?)$/i;

const districtOf = (row: { postcode_district?: string | null; postcode_full?: string | null }) =>
  row.postcode_district?.toUpperCase() ??
  row.postcode_full?.match(/^([A-Z]{1,2}\d[A-Z\d]?)/i)?.[1].toUpperCase() ??
  null;

const withArea = (headline: string | null, area: string | null, district: string | null) => {
  if (!headline || !area || !district) return headline;
  if (headline.toLowerCase().includes(area.toLowerCase())) return headline;
  return headline.replace(OUTWARD_IN_RE, (full, code: string) => `in ${area} ${code}`);
};

async function main() {
  const { data: rows, error } = await db
    .from('tbl_external_raia_listings')
    .select('*')
    .is('withdrawn_at', null)
    .like('raia_id', 'prop-gb-%');
  if (error) throw new Error(error.message);

  console.log(`${rows.length} active UK rows; mode=${write ? 'WRITE' : 'dry-run'}`);

  for (const row of rows) {
    const district = districtOf(row);
    const area = row.suburb?.trim() || (district ? UK_POSTCODE_AREA_MAP[district] ?? null : null);
    const headline = withArea(row.headline, area, district);
    const patch: Record<string, string | null> = {};
    if (area && area !== row.suburb) patch.suburb = area;
    if (district && district !== row.postcode_district) patch.postcode_district = district;
    if (headline !== row.headline) patch.headline = headline;
    if (!Object.keys(patch).length) continue;

    console.log(row.raia_id, JSON.stringify(patch));
    if (write) {
      const { error: upErr } = await db
        .from('tbl_external_raia_listings')
        .update(patch)
        .eq('raia_id', row.raia_id)
        .eq('agent_id', row.agent_id);
      if (upErr) throw new Error(`${row.raia_id}: ${upErr.message}`);
    }
  }

  // Sale + short-stay variants. Clone the source card so media/agent/features
  // stay identical, then overwrite only what the transaction changes.
  const variants = [
    {
      source: 'prop-gb-rlf-000818',
      raia_id: 'prop-gb-rlf-000818-sale',
      headline: '2-bedroom flat for sale in Holborn WC2B',
      suburb: 'Holborn',
      postcode_district: 'WC2B',
      service_type: 'sale',
      asking_price: 1_950_000,
      daily_rate: null,
      rent_pcm: null
    },
    {
      source: 'prop-gb-rlf-000818',
      raia_id: 'prop-gb-rlf-000818-stay',
      headline: '2-bedroom flat to stay in Holborn WC2B',
      suburb: 'Holborn',
      postcode_district: 'WC2B',
      service_type: 'short_term',
      asking_price: null,
      daily_rate: 181,
      rent_pcm: null
    },
    {
      source: 'prop-gb-rlf-000065',
      raia_id: 'prop-gb-rlf-000815-stay',
      headline: '2-bedroom flat to stay in Earls Court SW5',
      suburb: 'Earls Court',
      postcode_district: 'SW5',
      service_type: 'short_term',
      asking_price: null,
      daily_rate: 87,
      rent_pcm: null
    }
  ];

  for (const v of variants) {
    const { data: base, error: baseErr } = await db
      .from('tbl_external_raia_listings')
      .select('*')
      .eq('raia_id', v.source)
      .single();
    if (baseErr || !base) throw new Error(`${v.source}: ${baseErr?.message ?? 'not found'}`);

    const body = {
      ...base,
      raia_id: v.raia_id,
      headline: v.headline,
      suburb: v.suburb,
      postcode_district: v.postcode_district,
      service_type: v.service_type,
      asking_price: v.asking_price,
      daily_rate: v.daily_rate,
      rent_pcm: v.rent_pcm,
      currency: 'GBP',
      listing_status: 'available',
      withdrawn_at: null,
      last_seen_at: new Date().toISOString()
    };
    delete (body as Record<string, unknown>).external_id;
    // Generated column: derived by the DB from un_locode, never inserted.
    delete (body as Record<string, unknown>).jurisdiction;

    console.log('variant', v.raia_id, v.service_type, v.daily_rate ?? v.asking_price);
    if (write) {
      const { error: upErr } = await db
        .from('tbl_external_raia_listings')
        .upsert(body as never, { onConflict: 'agent_id,raia_id' });
      if (upErr) throw new Error(`${v.raia_id}: ${upErr.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
