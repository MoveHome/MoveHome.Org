// Stage 2 — FREEZE_RECHECK. Writes must already be off at T0 and nothing new
// may have arrived since. A freeze that only trusts an env var is not a freeze.
import { listTree, runStageCli } from './lib.mjs';

export async function run({ register, manifest, provider, env = process.env, now = new Date() }) {
  const checks = [];
  const push = (check, ok, detail) => checks.push({ check, ok: Boolean(ok), detail });

  push('write_kill_switch_off', env.DEMO_WRITE_ENABLED !== 'true', `DEMO_WRITE_ENABLED=${env.DEMO_WRITE_ENABLED ?? 'unset'}`);

  const telegram = await provider.telegram.webhookInfo();
  push('telegram_webhook_absent', telegram.url === '', telegram.url ? 'webhook still registered' : 'absent');

  const whatsapp = await provider.whatsapp.status();
  push(
    'whatsapp_webhook_absent',
    !whatsapp.provisioned || whatsapp.webhook === '',
    whatsapp.provisioned ? (whatsapp.webhook || 'absent') : 'not provisioned'
  );

  const baseline = manifest.freeze_baseline ?? {};
  let objects = 0;
  for (const bucket of await provider.storage.buckets()) {
    objects += (await listTree(provider.storage, bucket, '', 50)).length;
  }
  const rows = await provider.supabase.rowCount();
  push('object_count_unchanged', objects === baseline.objects, `${objects} vs baseline ${baseline.objects ?? 'missing'}`);
  push('row_count_unchanged', rows === baseline.rows, `${rows} vs baseline ${baseline.rows ?? 'missing'}`);

  const status = checks.every((check) => check.ok) ? 'PASS' : 'FAIL';
  return { stage: 'FREEZE_RECHECK', status, ts: now.toISOString(), run_id: manifest.teardown_run_id, checks };
}

export const ok = (result) => result.status === 'PASS';

if (typeof process !== 'undefined') {
  await runStageCli('FREEZE_RECHECK', 'freeze.json', (ctx) => run(ctx), import.meta.url);
}
