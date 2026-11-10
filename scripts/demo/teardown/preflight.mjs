// Stage 1 — PREFLIGHT (read-only). Target equality, denylist, register
// completeness and the exact live acknowledgement. No mutation happens here.
import { checkApproval, checkTarget, deleteAfter, runStageCli } from './lib.mjs';

const REQUIRED_ASSET_FIELDS = ['asset_id', 'class', 'provider', 'account', 'data_class'];

export async function run({ register, manifest, provider, accountProjects = [], acknowledgement, now = new Date() }) {
  const expected = register.expected ?? {};
  const target = checkTarget({ register, expected, accountProjects });
  const checks = [...target.checks];

  const live = await provider.supabase.getProject(register.targets.database.project_ref);
  const push = (check, ok, detail) => checks.push({ check, ok: Boolean(ok), detail });
  push('provider_project_exists', Boolean(live), live ? 'found' : 'not found');
  push('provider_project_name', live?.name === expected.project_name, String(live?.name));
  push('provider_project_region', live?.region === expected.region, String(live?.region));
  push('provider_project_organisation', live?.organisation_ref === expected.organisation, String(live?.organisation_ref));

  const approval = checkApproval({ acknowledgement, manifest, register });
  checks.push(approval);
  push('deadline_is_event_close_plus_168h', deleteAfter(manifest.event_closed_at) === manifest.delete_after, String(manifest.delete_after));
  push('deadline_reached', Date.parse(manifest.delete_after) <= now.getTime(), manifest.delete_after);

  const assets = register.assets ?? [];
  const incomplete = assets.filter((asset) => REQUIRED_ASSET_FIELDS.some((field) => !asset[field]));
  push('register_rows_complete', incomplete.length === 0, incomplete.map((a) => a.asset_id ?? '?').join(',') || 'all complete');

  const unclassified = assets.filter(
    (asset) => !['temporary_release', 'owned_restore', 'retain_code_only', 'not_applicable'].includes(asset.disposition)
  );
  push('dispositions_classified', unclassified.length === 0, unclassified.map((a) => a.asset_id).join(',') || 'all classified');

  // A NOT_PROVISIONED row needs a fresh provider readback, not a narrative.
  const waAsset = assets.find((asset) => asset.class === 'whatsapp');
  const waStatus = await provider.whatsapp.status();
  push(
    'whatsapp_state_matches_provider',
    !waAsset || (waStatus.provisioned === (waAsset.status !== 'NOT_PROVISIONED')),
    `register=${waAsset?.status ?? 'absent'} provider=${waStatus.provisioned ? 'provisioned' : 'absent'}`
  );

  const status = checks.every((check) => check.ok) ? 'PASS' : 'FAIL';
  return {
    stage: 'PREFLIGHT',
    status,
    ts: now.toISOString(),
    run_id: manifest.teardown_run_id,
    target: register.targets.database.project_ref,
    checks
  };
}

export const ok = (result) => result.status === 'PASS';

if (typeof process !== 'undefined') {
  await runStageCli('PREFLIGHT', 'preflight.json', run);
}
