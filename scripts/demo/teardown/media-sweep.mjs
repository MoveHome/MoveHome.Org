// Stage 3 — MEDIA. Reconcile the restricted manifest against a recursive
// provider inventory, delete everything, then prove a zero readback. FAIL here
// blocks project deletion: deleting the project would destroy the evidence.
import { deleteTree, inventoryDigest, listTree, runStageCli } from './lib.mjs';

export async function run({ register, manifest, provider, pageSize = 100, now = new Date() }) {
  const checks = [];
  const push = (check, ok, detail) => checks.push({ check, ok: Boolean(ok), detail });

  const registeredBuckets = (register.assets ?? [])
    .filter((asset) => asset.class === 'bucket' || asset.class === 'media')
    .map((asset) => asset.bucket)
    .filter(Boolean);
  const buckets = await provider.storage.buckets();
  const unknown = buckets.filter((bucket) => !registeredBuckets.includes(bucket));
  push('no_unregistered_bucket', unknown.length === 0, unknown.join(',') || 'none');

  const before = [];
  for (const bucket of buckets) before.push(...(await listTree(provider.storage, bucket, '', pageSize)));
  const objectsBefore = before.length;
  const bytesBefore = before.reduce((total, o) => total + (o.bytes ?? 0), 0);

  let objectsDeleted = 0;
  let bytesDeleted = 0;
  let error = null;
  try {
    for (const bucket of buckets) {
      const result = await deleteTree(provider.storage, bucket, '', { pageSize });
      objectsDeleted += result.objects_deleted;
      bytesDeleted += result.bytes_deleted;
    }
    await provider.storage.purgeIncomplete();
  } catch (err) {
    error = err.message;
  }

  // Independent readback at page size 1: an implementation that only looks at
  // the first listing page cannot pass its own verification.
  let objectsAfter = 0;
  for (const bucket of buckets) objectsAfter += (await listTree(provider.storage, bucket, '', 1)).length;
  const incompleteAfter = await provider.storage.incompleteUploads();

  push('media_delete_attempted', error === null, error ?? 'ok');
  push('zero_object_readback', objectsAfter === 0, `${objectsAfter} remaining`);
  push('zero_incomplete_uploads', incompleteAfter === 0, `${incompleteAfter} incomplete`);

  const status = checks.every((check) => check.ok) ? 'PASS' : 'FAIL';
  return {
    stage: 'MEDIA',
    status,
    ts: now.toISOString(),
    run_id: manifest.teardown_run_id,
    buckets: buckets.length,
    recursive_enumeration: true,
    objects_before: objectsBefore,
    bytes_before: bytesBefore,
    objects_deleted: objectsDeleted,
    bytes_deleted: bytesDeleted,
    objects_after: objectsAfter,
    incomplete_after: incompleteAfter,
    // Our own logical inaccessibility only; provider backups are separate.
    inventory_digest: inventoryDigest(before),
    backup_retention: manifest.media_backup_retention ?? 'UNKNOWN',
    checks
  };
}

export const ok = (result) => result.status === 'PASS';

if (typeof process !== 'undefined') {
  await runStageCli('MEDIA', 'media-summary.json', run);
}
