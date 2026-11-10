// Stage 4 — DATABASE. Whole dedicated project deletion, gated on the media zero
// readback. A table drop, schema drop or project pause is not this step.
import { runStageCli } from './lib.mjs';

export async function run({ register, manifest, provider, media, now = new Date() }) {
  if (!media || media.status !== 'PASS') {
    return {
      stage: 'DATABASE',
      status: 'BLOCKED',
      ts: now.toISOString(),
      run_id: manifest.teardown_run_id,
      reason: 'media zero readback is a hard dependency of project deletion',
      readback: 'NOT_ATTEMPTED'
    };
  }

  const ref = register.targets.database.project_ref;
  const checks = [];
  const push = (check, ok, detail) => checks.push({ check, ok: Boolean(ok), detail });

  const operation = await provider.supabase.deleteProject(ref);
  push('project_delete_accepted', operation?.deleted === true, String(operation?.ref));

  let readback = 'FOUND';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if ((await provider.supabase.getProject(ref)) === null) {
      readback = 'NOT_FOUND';
      break;
    }
  }
  push('management_readback_not_found', readback === 'NOT_FOUND', readback);
  const reachable = await provider.supabase.dataApiReachable();
  push('data_api_unreachable', reachable === false, reachable ? 'still answering' : 'unreachable');

  const status = checks.every((check) => check.ok) ? 'PASS' : 'FAIL';
  return {
    stage: 'DATABASE',
    status,
    ts: now.toISOString(),
    run_id: manifest.teardown_run_id,
    action: 'management-api project delete',
    project_ref: ref,
    readback,
    checks
  };
}

export const ok = (result) => result.status === 'PASS';

if (typeof process !== 'undefined') {
  await runStageCli('DATABASE', 'database.json', run);
}
