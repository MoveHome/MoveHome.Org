// Eleven synthetic fixtures for the ADR-476 teardown contract. Nothing here
// touches a provider: every stage runs against the synthetic adapter.
import { mkdtemp } from 'node:fs/promises';
import { appendFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEMO_FQDN,
  MANIFEST_SCHEMA,
  PRODUCTION_REF,
  REGISTER_SCHEMA,
  deleteAfter,
  listTree,
  redact,
  redactionViolations,
  runSecretsMonitors,
  syntheticProvider,
  verifyEvidence,
  writeEvidence
} from './lib.mjs';
import * as preflight from './preflight.mjs';
import * as freeze from './freeze.mjs';
import * as media from './media-sweep.mjs';
import * as database from './project-delete.mjs';
import * as channels from './channels-revoke.mjs';
import * as dns from './dns-remove.mjs';
import { runRetentionSweep } from '../retention-sweep.mjs';

const RUN_ID = 'run-synth-001';
const EVENT_CLOSED = '2026-11-01T18:00:00Z';
const SYNTH_REF = 'synthdemoprojectref01';

const DEMO_PREFIX = 'v1/l1/';

function makeRegister(overrides = {}) {
  const base = {
    schema: REGISTER_SCHEMA,
    event_id: 'expo-synth-001',
    expected: {
      project_ref: SYNTH_REF,
      project_name: 'movehome-demo',
      organisation: 'movehome-cic',
      region: 'eu-west-2',
      denylist: []
    },
    targets: {
      database: {
        provider: 'supabase',
        organisation: 'movehome-cic',
        project_name: 'movehome-demo',
        project_ref: SYNTH_REF,
        region: 'eu-west-2'
      },
      vercel: { scope: 'move-home', project: 'movehome-demo' },
      dns: { zone: 'movehome.org', record: 'demo', fqdn: DEMO_FQDN }
    },
    denylist: [PRODUCTION_REF],
    assets: [
      { asset_id: 'a-db', class: 'database', provider: 'supabase', account: 'movehome-cic', data_class: 'attendee content', disposition: 'temporary_release' },
      { asset_id: 'a-bucket', class: 'bucket', bucket: 'demo-media', provider: 'supabase', account: 'movehome-cic', data_class: 'media', disposition: 'temporary_release' },
      { asset_id: 'a-tg', class: 'telegram', provider: 'telegram', account: 'MoveHomeDemoBot', data_class: 'telegram identifiers', disposition: 'temporary_release', secret_names: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'] },
      { asset_id: 'a-wa', class: 'whatsapp', provider: 'whatsapp', account: 'unprovisioned', data_class: 'phone identifiers', disposition: 'not_applicable', status: 'NOT_PROVISIONED' },
      { asset_id: 'a-number', class: 'number', provider: 'telephony', account: 'unprovisioned', data_class: 'phone identifiers', disposition: 'not_applicable', status: 'NOT_PROVISIONED' },
      { asset_id: 'a-dns', class: 'dns', provider: 'godaddy', account: 'movehome.org', data_class: 'metadata', disposition: 'temporary_release' },
      { asset_id: 'a-vercel', class: 'vercel', provider: 'vercel', account: 'move-home', data_class: 'metadata', disposition: 'temporary_release' },
      { asset_id: 'a-code', class: 'artifact', provider: 'github', account: 'MoveHome/MoveHome.Org', data_class: 'metadata', disposition: 'retain_code_only' }
    ]
  };
  return {
    ...base,
    ...overrides,
    targets: { ...base.targets, ...(overrides.targets ?? {}) },
    expected: { ...base.expected, ...(overrides.expected ?? {}) }
  };
}

async function countObjects(provider) {
  let total = 0;
  for (const bucket of await provider.storage.buckets()) {
    total += (await listTree(provider.storage, bucket, '', 1)).length;
  }
  return total;
}

async function buildScenario({ registerOverrides, providerSpec = {}, interruptAfter, tamper } = {}) {
  const register = makeRegister(registerOverrides);
  const provider = syntheticProvider(providerSpec);
  const manifest = {
    schema: MANIFEST_SCHEMA,
    event_id: register.event_id,
    teardown_run_id: RUN_ID,
    event_closed_at: EVENT_CLOSED,
    delete_after: deleteAfter(EVENT_CLOSED),
    code_sha: 'a'.repeat(40),
    operators: { executor: 'devops-operator-synth', verifier: 'pa-verifier-synth' },
    approval_ref: 'eugin-approval-synth-001',
    freeze_baseline: { objects: await countObjects(provider), rows: providerSpec.rows ?? 0 },
    media_backup_retention: 'PROVIDER_RETAINED'
  };
  return {
    register,
    provider,
    manifest,
    acknowledgement: `${RUN_ID} ${register.targets.database.project_ref} ${EVENT_CLOSED}`,
    interruptAfter,
    tamper
  };
}

const NOT_RUN = (stage) => ({ stage, status: 'NOT_RUN', ts: new Date(0).toISOString() });

function aggregate(stageStatuses) {
  const values = Object.values(stageStatuses);
  if (values.includes('FAIL') || values.includes('BLOCKED')) return 'FAIL';
  if (values.includes('INCOMPLETE') || values.includes('NOT_RUN')) return 'INCOMPLETE';
  return 'PASS';
}

// D11 order. A media failure blocks DATABASE; channels and DNS still run so
// exposure-reducing cleanup is never held hostage by one failed stage.
export async function runScenario(scenario) {
  const { register, provider, manifest, acknowledgement } = scenario;
  const stages = {};

  stages.preflight = await preflight.run({
    register,
    manifest,
    provider,
    accountProjects: await provider.listProjects(),
    acknowledgement
  });

  if (stages.preflight.status === 'PASS') {
    stages.freeze = await freeze.run({ register, manifest, provider, env: { DEMO_WRITE_ENABLED: 'false' } });
  }
  if (stages.freeze?.status === 'PASS') {
    stages.media = await media.run({ register, manifest, provider });
  }

  if (scenario.interruptAfter === 'media') {
    stages.database = { stage: 'DATABASE', status: 'INCOMPLETE', readback: 'NOT_ATTEMPTED', reason: 'process interrupted after MEDIA' };
  } else if (stages.media) {
    stages.database = await database.run({ register, manifest, provider, media: stages.media });
    stages.channels = await channels.run({ register, manifest, provider });
    stages.dns = await dns.run({ register, manifest, provider });
  }

  const stageStatuses = {
    PREFLIGHT: stages.preflight?.status ?? 'NOT_RUN',
    FREEZE_RECHECK: stages.freeze?.status ?? 'NOT_RUN',
    MEDIA: stages.media?.status ?? 'NOT_RUN',
    DATABASE: stages.database?.status ?? 'NOT_RUN',
    CHANNELS: stages.channels?.status ?? 'NOT_RUN',
    DNS_HOSTING: stages.dns?.status ?? 'NOT_RUN'
  };
  const verdict = aggregate(stageStatuses);

  const secrets = await runSecretsMonitors({ register, provider });
  const files = {
    'manifest.json': manifest,
    'asset-register.redacted.json': register,
    'preflight.json': stages.preflight,
    'media-summary.json': stages.media ?? NOT_RUN('MEDIA'),
    'database.json': stages.database ?? NOT_RUN('DATABASE'),
    'channels.json': stages.channels ?? NOT_RUN('CHANNELS'),
    'dns-hosting.json': stages.dns ?? NOT_RUN('DNS_HOSTING'),
    'secrets-monitors.json': secrets,
    'verify.json': {
      stage: 'VERIFY',
      status: verdict,
      ts: new Date().toISOString(),
      checks: [{ check: 'stage_sequence', status: Object.values(stageStatuses).includes('FAIL') ? 'FAIL' : verdict, detail: Object.entries(stageStatuses).map(([k, v]) => `${k}=${v}`).join(' ') }]
    },
    'summary.json': {
      status: scenario.interruptAfter ? 'INTERRUPTED' : verdict,
      stages: stageStatuses,
      run_id: RUN_ID,
      event_id: register.event_id
    }
  };

  const dir = await mkdtemp(join(tmpdir(), 'expo-t7-fixture-'));
  await writeEvidence(dir, files);

  if (scenario.tamper) {
    await appendFile(join(dir, scenario.tamper), ' \n');
  }

  const result = await verifyEvidence({ dir });
  return { dir, stages, stageStatuses, files, result, provider, register, manifest };
}

// ── fixture definitions ─────────────────────────────────────────────────────
const MEDIA_KEYS = [
  'v1/l1/originals/a.jpg',
  'v1/l1/derivatives/a-320.jpg',
  'v1/l1/derivatives/deep/a-640.jpg',
  'v1/l2/originals/b.jpg',
  'v1/l2/thumbnails/b.jpg',
  'v2/l3/originals/c.jpg'
];

const fixtures = [
  {
    name: 'production-target-rejection',
    expect: 'FAIL',
    build: () =>
      buildScenario({
        registerOverrides: {
          expected: { project_ref: PRODUCTION_REF },
          targets: { database: { project_ref: PRODUCTION_REF } }
        },
        providerSpec: { project: { ref: PRODUCTION_REF }, storage: { buckets: { 'demo-media': MEDIA_KEYS } } }
      }),
    after: ({ stages, result, provider }) => ({
      ok:
        stages.preflight.status === 'FAIL' &&
        stages.preflight.checks.some((c) => c.check === 'project_ref_not_denylisted' && c.ok === false) &&
        !provider.calls.some((c) => c.op === 'deleteProject'),
      detail: 'denylisted production ref rejected before any mutation'
    })
  },
  {
    name: 'nested-paginated-media',
    expect: 'PASS',
    build: () => buildScenario({ providerSpec: { storage: { buckets: { 'demo-media': MEDIA_KEYS }, pageSize: 2 } } }),
    after: ({ files }) => {
      const summary = files['media-summary.json'];
      return {
        ok: summary.objects_before === MEDIA_KEYS.length && summary.objects_deleted === MEDIA_KEYS.length && summary.objects_after === 0,
        detail: `before=${summary.objects_before} deleted=${summary.objects_deleted} after=${summary.objects_after}`
      };
    }
  },
  {
    name: 'originals-derivatives-orphans',
    expect: 'PASS',
    build: () =>
      buildScenario({
        providerSpec: {
          storage: {
            buckets: {
              'demo-media': [...MEDIA_KEYS, 'v9/orphan/leftover.jpg', 'v9/orphan/derivatives/leftover-320.jpg']
            },
            incomplete: 2,
            pageSize: 3
          }
        }
      }),
    after: ({ files }) => {
      const summary = files['media-summary.json'];
      return {
        ok:
          summary.objects_deleted === MEDIA_KEYS.length + 2 &&
          summary.incomplete_after === 0 &&
          summary.objects_after === 0,
        detail: `deleted=${summary.objects_deleted} (originals+derivatives+orphans) incomplete_after=${summary.incomplete_after}`
      };
    }
  },
  {
    name: 'media-failure-blocks-database-deletion',
    expect: 'FAIL',
    build: () => buildScenario({ providerSpec: { storage: { buckets: { 'demo-media': MEDIA_KEYS }, failRemove: true } } }),
    after: ({ stages, files, provider }) => ({
      ok:
        stages.media.status === 'FAIL' &&
        stages.database.status === 'BLOCKED' &&
        files['database.json'].readback === 'NOT_ATTEMPTED' &&
        !provider.calls.some((c) => c.op === 'deleteProject'),
      detail: `media=${stages.media.status} database=${stages.database.status} deleteCalls=${provider.calls.filter((c) => c.op === 'deleteProject').length}`
    })
  },
  {
    name: 'honest-retract-pending',
    expect: 'FAIL',
    build: () => buildScenario({ providerSpec: { storage: { buckets: { 'demo-media': MEDIA_KEYS }, failRemoveOnce: true } } }),
    after: async ({ files, result }) => {
      const db = {
        async rpc(fn) {
          if (fn === 'demo_expired_listings') {
            return { data: [{ id: 'l1', venue_id: 'v1', media_prefix: DEMO_PREFIX, created_at: '2026-11-09T00:00:00Z' }] };
          }
          if (fn === 'demo_retention_begin') return { data: { media_prefix: DEMO_PREFIX } };
          return { data: false };
        }
      };
      // Real retention worker against a storage that keeps refusing deletion.
      const sweep = await runRetentionSweep({
        db,
        storage: {
          async list() {
            return { objects: [{ key: `${DEMO_PREFIX}originals/a.jpg`, id: 'o1', bytes: 10 }] };
          },
          async remove() {
            return { error: 'delete refused (still pending)' };
          }
        },
        now: new Date('2026-11-10T00:00:00Z')
      });
      const receipt = sweep.receipts[0] ?? {};
      const summary = files['media-summary.json'];
      return {
        ok:
          summary.objects_after > 0 &&
          result.status === 'FAIL' &&
          receipt.state === 'pending' &&
          receipt.media_removed === 0 &&
          sweep.deleted === 0 &&
          JSON.stringify(sweep).includes('"retracted":true') === false,
        detail: `media_after=${summary.objects_after} receipt=${receipt.state} deleted=${sweep.deleted}`
      };
    }
  },
  {
    name: 'telegram-revoke-not-webhook-deletion',
    expect: 'PASS',
    build: () => buildScenario({ providerSpec: { storage: { buckets: { 'demo-media': MEDIA_KEYS } }, telegram: { revokes: true } } }),
    after: async ({ stages, files, register, manifest }) => {
      const webhookOnly = syntheticProvider({ storage: { buckets: { 'demo-media': [] } }, telegram: { webhookUrl: 'https://demo.movehome.org/api/telegram/webhook', revokes: false } });
      const negative = await channels.run({ register, manifest, provider: webhookOnly });
      return {
        ok:
          stages.channels.status === 'PASS' &&
          files['channels.json'].telegram.revoke_status === 'REVOKED' &&
          files['channels.json'].telegram.old_token_authorised === false &&
          negative.status === 'FAIL',
        detail: `revoked=${files['channels.json'].telegram.revoke_status} webhookOnly=${negative.status}`
      };
    }
  },
  {
    name: 'whatsapp-three-branches',
    expect: 'PASS',
    build: () => buildScenario({ providerSpec: { storage: { buckets: { 'demo-media': MEDIA_KEYS } }, telegram: { revokes: true } } }),
    after: async ({ register, manifest }) => {
      const branch = async (whatsapp) => {
        const provider = syntheticProvider({ storage: { buckets: { 'demo-media': [] } }, telegram: { revokes: true }, whatsapp });
        const stage = await channels.run({ register, manifest, provider });
        return { status: stage.status, wa: stage.whatsapp };
      };
      const absent = await branch({ provisioned: false });
      const leased = await branch({ provisioned: true, ownership: 'temporary_release', tokenRevoked: true });
      const owned = await branch({ provisioned: true, ownership: 'owned_restore', tokenRevoked: true });
      return {
        ok:
          absent.status === 'PASS' && absent.wa.branch === 'NOT_PROVISIONED' &&
          leased.status === 'PASS' && leased.wa.branch === 'PROVISIONED_TEMPORARY_RELEASE' && leased.wa.released === true &&
          owned.status === 'PASS' && owned.wa.branch === 'PROVISIONED_OWNED_RESTORE' && owned.wa.released === false,
        detail: `absent=${absent.wa.branch} leased(released=${leased.wa.released}) owned(released=${owned.wa.released})`
      };
    }
  },
  {
    name: 'dns-production-records-preserved',
    expect: 'PASS',
    build: () =>
      buildScenario({
        providerSpec: {
          storage: { buckets: { 'demo-media': MEDIA_KEYS } },
          telegram: { revokes: true },
          dns: { records: { '@': 'A 76.76.21.21', www: 'CNAME movehome.vercel.app', demo: 'CNAME b325cf8404325006.vercel-dns-016.com', MX: 'MX 10 mx1.improvmx.com' } },
          vercel: { domains: ['demo.movehome.org', 'movehome.org'] }
        }
      }),
    after: async ({ stages, files, provider }) => {
      const refused = await provider.dns.deleteRecord('@');
      const records = await provider.dns.records();
      return {
        ok:
          stages.dns.status === 'PASS' &&
          records['@'] === 'A 76.76.21.21' &&
          !('demo' in records) &&
          refused.ok === false &&
          files['dns-hosting.json'].dns.resolvers.join('/') === 'NXDOMAIN/NXDOMAIN',
        detail: `refused=@ production_preserved=${records['@'] === 'A 76.76.21.21'}`
      };
    }
  },
  {
    name: 'secret-redaction',
    expect: 'PASS',
    build: () =>
      buildScenario({
        providerSpec: {
          storage: { buckets: { 'demo-media': MEDIA_KEYS } },
          telegram: { revokes: true },
          secrets: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'],
          monitors: ['monitor-uptime-demo']
        }
      }),
    after: async ({ result, files, register, manifest }) => {
      const poisoned = {
        ...manifest,
        telegram_bot_token: '123456789:AAHnotarealtokenvalue00000000000000000',
        attendee_phone: '+447700900123',
        chat_id: 987654321,
        operator_note: 'second attendee +447700900124'
      };
      const dir = await mkdtemp(join(tmpdir(), 'expo-t7-redaction-'));
      await writeFile(join(dir, 'raw.json'), JSON.stringify(poisoned), 'utf8');
      const rawViolations = redactionViolations(poisoned);
      const cleaned = redact(poisoned);
      return {
        ok:
          result.status === 'PASS' &&
          rawViolations.length >= 2 &&
          redactionViolations(cleaned).length === 0 &&
          !JSON.stringify(files).includes('AAHnotarealtokenvalue') &&
          !JSON.stringify(files).includes('+447700900123') &&
          register.assets.some((a) => Array.isArray(a.secret_names)),
        detail: `rawViolations=${rawViolations.length} cleaned=0`
      };
    }
  },
  {
    name: 'interrupted-run-incomplete',
    expect: 'INCOMPLETE',
    build: () => buildScenario({ providerSpec: { storage: { buckets: { 'demo-media': MEDIA_KEYS }, pageSize: 2 }, telegram: { revokes: true } }, interruptAfter: 'media' }),
    after: ({ result, files }) => ({
      ok:
        result.status === 'INCOMPLETE' &&
        files['summary.json'].status === 'INTERRUPTED' &&
        files['database.json'].readback === 'NOT_ATTEMPTED',
      detail: `status=${result.status} summary=${files['summary.json'].status}`
    })
  },
  {
    name: 'hash-tamper-failure',
    expect: 'FAIL',
    build: () => buildScenario({ providerSpec: { storage: { buckets: { 'demo-media': MEDIA_KEYS } }, telegram: { revokes: true } }, tamper: 'media-summary.json' }),
    after: ({ result }) => ({
      ok: result.status === 'FAIL' && result.checks.some((c) => c.check === 'sha256_match' && c.status === 'FAIL'),
      detail: result.checks.find((c) => c.check === 'sha256_match')?.detail
    })
  }
];

export const FIXTURES = fixtures;

export async function runFixture(name) {
  const fixture = fixtures.find((f) => f.name === name);
  if (!fixture) throw new Error(`unknown fixture: ${name}`);
  const scenario = await fixture.build();
  const result = await runScenario(scenario);
  const extra = fixture.after ? await fixture.after({ ...result, scenario }) : { ok: true, detail: '' };
  const pass = result.result.status === fixture.expect && extra.ok;
  return {
    name,
    expected: fixture.expect,
    status: result.result.status,
    pass,
    detail: extra.detail,
    evidence_dir: result.dir
  };
}
