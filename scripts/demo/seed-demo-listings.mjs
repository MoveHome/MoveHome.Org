#!/usr/bin/env node
// Seed the demo project with ~200 REAL public MoveHome listings, read-only.
// Prod is only ever READ here (public anon key); nothing is written to prod.
// Rows land in the demo project with is_seed = true, so the demo flow can
// neither retract them nor let the TTL worker expire them.
//
// Usage: node scripts/demo/seed-demo-listings.mjs [count]
// Env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY  (prod, read-only)
//      DEMO_SUPABASE_URL, DEMO_SUPABASE_SERVICE_ROLE_KEY        (demo, write)

import { createClient } from '@supabase/supabase-js';

const COUNT = Number(process.argv[2] ?? 200);
const SEED_VENUE = 'movehome-expo';

const prodUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const prodKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const demoUrl = process.env.DEMO_SUPABASE_URL;
const demoKey = process.env.DEMO_SUPABASE_SERVICE_ROLE_KEY;

if (!prodUrl || !prodKey || !demoUrl || !demoKey) {
  console.error(
    'seed: need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, DEMO_SUPABASE_URL, DEMO_SUPABASE_SERVICE_ROLE_KEY'
  );
  process.exit(2);
}

const prod = createClient(prodUrl, prodKey, { auth: { persistSession: false, autoRefreshToken: false } });
const demo = createClient(demoUrl, demoKey, { auth: { persistSession: false, autoRefreshToken: false } });

// Read-only against prod: the public reader applies visibility itself.
const { data, error } = await prod
  .from('tbl_external_raia_listings')
  .select('raia_id,headline,property_type,service_type,bedrooms,rent_pcm,currency,un_locode,latitude,longitude')
  .limit(COUNT);

if (error) {
  console.error('seed: prod read failed:', error.message);
  process.exit(1);
}

const rows = (data ?? [])
  .filter((r) => r.raia_id && r.headline)
  .map((r) => ({ ...r, venue_id: SEED_VENUE, is_seed: true, retract_code: null }));

if (rows.length === 0) {
  console.error('seed: prod returned no public listings');
  process.exit(1);
}

// Re-seed cleanly: drop this venue's previous seed rows, then insert.
await demo.from('demo_listings').delete().eq('venue_id', SEED_VENUE).eq('is_seed', true);

const { error: insErr } = await demo.from('demo_listings').insert(rows);
if (insErr) {
  console.error('seed: demo insert failed:', insErr.message);
  process.exit(1);
}

console.log(`seeded ${rows.length}/${COUNT} read-only rows into demo venue ${SEED_VENUE}`);
if (rows.length < COUNT) console.warn(`seed: prod had fewer than ${COUNT} public listings`);
