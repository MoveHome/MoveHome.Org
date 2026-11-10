// Recurring demo retention worker (ADR-476 D4): media first, row second.
// A media failure leaves the row non-public ('deleting') and pending, never
// retracted. One receipt per listing; a stale backlog pages both operators.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deleteTree, listTree } from './teardown/lib.mjs';

export const RETENTION_AFTER_MS = 24 * 60 * 60 * 1000;
export const PAGE_AFTER_MS = RETENTION_AFTER_MS + 10 * 60 * 1000;
export const RETENTION_BUCKET = 'demo-media';

export const expiredAt = (createdAt) => new Date(Date.parse(createdAt) + RETENTION_AFTER_MS).toISOString();

// Media-first for one listing. Exported so the retract path and the tests use
// the same enumeration and zero-readback rule.
export async function sweepListingMedia(storage, prefix) {
  const removed = await deleteTree(storage, RETENTION_BUCKET, prefix);
  const objectsAfter = (await listTree(storage, RETENTION_BUCKET, prefix, 1)).length;
  return { ...removed, objects_after: objectsAfter };
}

export async function runRetentionSweep({ db, storage, now = new Date(), limit = 50, keepRowOnFailure = true }) {
  const { data, error } = await db.rpc('demo_expired_listings', { p_limit: limit });
  if (error) throw new Error(`demo_expired_listings failed: ${error.message}`);

  const receipts = [];
  const alerts = [];
  for (const row of data ?? []) {
    const receipt = { ts: now.toISOString(), listing_id: row.id, state: 'pending', media_removed: 0, objects_after: null };

    const begun = await db.rpc('demo_retention_begin', { p_id: row.id });
    if (begun.error) {
      receipt.state = 'pending';
      receipt.error = begun.error.message;
      receipts.push(receipt);
      continue;
    }
    receipt.media_prefix_present = Boolean(begun.data?.media_prefix);

    try {
      const swept = await sweepListingMedia(storage, begun.data?.media_prefix ?? `${row.venue_id}/${row.id}`);
      receipt.media_removed = swept.objects_deleted;
      receipt.objects_after = swept.objects_after;
      if (swept.objects_after !== 0) throw new Error('media did not read back empty');

      const done = await db.rpc('demo_retention_finalize', { p_id: row.id });
      if (done.error || done.data !== true) throw new Error(done.error?.message ?? 'finalize refused');
      receipt.state = 'deleted';
    } catch (err) {
      // Shortcut: a stuck row needs the same sweep rerun; upgrade to a per-row
      // attempt counter only if one provider outage can outlive T+7.
      receipt.error = err.message;
      if (!keepRowOnFailure) await db.rpc('demo_retention_finalize', { p_id: row.id });
    }

    if (now.getTime() - Date.parse(row.created_at) > PAGE_AFTER_MS) alerts.push(row.id);
    receipts.push(receipt);
  }

  if (alerts.length > 0) {
    for (const operator of ['devops', 'pa']) {
      console.error(`[retention] PAGE ${operator}: ${alerts.length} listing(s) past 24h10m`);
    }
  }

  return {
    ts: now.toISOString(),
    processed: receipts.length,
    deleted: receipts.filter((r) => r.state === 'deleted').length,
    pending: receipts.filter((r) => r.state !== 'deleted').length,
    alerts,
    receipts
  };
}

function requireLive(args) {
  if (!args.includes('--live')) {
    console.error('retention-sweep: refusing to run without --live (synthetic runs go through verify.mjs)');
    process.exit(2);
  }
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('retention-sweep.mjs')) {
  const { createClient } = await import('@supabase/supabase-js');
  const args = process.argv.slice(2);
  requireLive(args);
  const url = process.env.DEMO_SUPABASE_URL;
  const key = process.env.DEMO_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('retention-sweep: DEMO_SUPABASE_URL and DEMO_SERVICE_ROLE_KEY are required');
    process.exit(2);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const result = await runRetentionSweep({ db, storage: db.storage });
  const out = join('artifacts', 'expo-t7', 'retention', `${result.ts.replace(/[:.]/g, '-')}.json`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`retention-sweep: processed=${result.processed} deleted=${result.deleted} pending=${result.pending} -> ${out}`);
  process.exit(result.pending === 0 ? 0 : 1);
}
