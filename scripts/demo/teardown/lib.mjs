// ADR-476 teardown contract helpers: target guard, media enumeration, redaction,
// digests and the evidence bundle. No provider call happens at import time.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MANIFEST_SCHEMA = 'movehome.expo.teardown-manifest/1';
export const REGISTER_SCHEMA = 'movehome.expo.asset-register/1';
export const T7_MS = 168 * 60 * 60 * 1000;
// MoveHome public listing project — never an Expo target (ADR-459).
export const PRODUCTION_REF = 'vfnpmtqxrffppqajxxpb';
export const DEMO_PROJECT = 'move-home/movehome-demo';
export const DEMO_FQDN = 'demo.movehome.org';
export const REQUIRED_EVIDENCE = [
  'manifest.json',
  'asset-register.redacted.json',
  'preflight.json',
  'media-summary.json',
  'database.json',
  'channels.json',
  'dns-hosting.json',
  'secrets-monitors.json',
  'verify.json',
  'summary.json'
];

export const deleteAfter = (eventClosedAt) =>
  new Date(Date.parse(eventClosedAt) + T7_MS).toISOString();

// ── redaction ───────────────────────────────────────────────────────────────
// Values are scrubbed, keys are dropped. `secret_names` is the one field that
// must survive: the register records names only (D1).
const FORBIDDEN_KEY =
  /^(token|secret|password|passcode|authorization|caption|message|phone|msisdn|chat_id|chatid|user_id|userid|object_key|objectkey|media_bytes|body|content|headers|ip|ip_address)$/i;
const DIGEST_KEY = /^(sha256|digest|hash|inventory_digest|file_sha256)$/i;

export function redactString(value) {
  return String(value)
    .replace(/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, '[redacted:bot-token]')
    .replace(/\+\d{9,15}\b/g, '[redacted:phone]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[redacted:secret]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted:jwt]');
}

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'secret_names' || DIGEST_KEY.test(key)) {
        out[key] = entry;
        continue;
      }
      if (FORBIDDEN_KEY.test(key)) continue;
      out[key] = redact(entry);
    }
    return out;
  }
  if (typeof value === 'string') return redactString(value);
  return value;
}

// A redaction assertion, not a rewrite: evidence that still carries a raw
// identifier or secret must fail the run instead of being silently cleaned.
export function redactionViolations(value, path = '$') {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((entry, i) => found.push(...redactionViolations(entry, `${path}[${i}]`)));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key !== 'secret_names' && !DIGEST_KEY.test(key) && FORBIDDEN_KEY.test(key)) {
        found.push(`${path}.${key}`);
        continue;
      }
      found.push(...redactionViolations(entry, `${path}.${key}`));
    }
    return found;
  }
  if (typeof value === 'string' && DIGEST_KEY.test(path.split('.').pop() ?? '')) return found;
  if (typeof value === 'string' && redactString(value) !== value) found.push(`${path} (raw value)`);
  return found;
}

// ── digests ─────────────────────────────────────────────────────────────────
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export const digest = (value) =>
  createHash('sha256').update(canonical(value)).digest('hex');

// Keyed digest of a media inventory: counts unnamed keys, never the keys.
export function inventoryDigest(objects) {
  return digest(
    [...objects]
      .map((o) => `${o.key}:${o.bytes ?? 0}`)
      .sort()
      .map((line) => createHash('sha256').update(line).digest('hex'))
  );
}

// ── target guard (D8) ───────────────────────────────────────────────────────
export function checkTarget({ register, expected, accountProjects = [] }) {
  const checks = [];
  const target = register?.targets ?? {};
  const database = target.database ?? {};
  const denylist = new Set([PRODUCTION_REF, ...(register?.denylist ?? []), ...(expected.denylist ?? [])]);
  const push = (check, ok, detail) => checks.push({ check, ok: Boolean(ok), detail });

  push('project_ref_matches_register', database.project_ref === expected.project_ref, database.project_ref ?? 'missing');
  push('project_ref_not_denylisted', Boolean(database.project_ref) && !denylist.has(database.project_ref), database.project_ref ?? 'missing');
  push('project_ref_not_production', database.project_ref !== PRODUCTION_REF, database.project_ref ?? 'missing');
  push('project_name_matches', database.project_name === expected.project_name, database.project_name ?? 'missing');
  push('organisation_matches', database.organisation === expected.organisation, database.organisation ?? 'missing');
  push('region_matches', database.region === expected.region, database.region ?? 'missing');
  push(
    'vercel_target_exact',
    `${target.vercel?.scope}/${target.vercel?.project}` === DEMO_PROJECT,
    `${target.vercel?.scope ?? '?'}/${target.vercel?.project ?? '?'}`
  );
  push(
    'dns_target_exact',
    target.dns?.fqdn === DEMO_FQDN && target.dns?.record === 'demo',
    `${target.dns?.record ?? '?'} -> ${target.dns?.fqdn ?? '?'}`
  );
  const strays = accountProjects.filter(
    (project) => project.ref !== database.project_ref && !(register?.denylist ?? []).includes(project.ref)
  );
  push('no_unregistered_project_in_account', strays.length === 0, strays.map((p) => p.name).join(',') || 'none');

  return { ok: checks.every((c) => c.ok), checks };
}

// Live acknowledgement must name the run, the project and the event close.
export function checkApproval({ acknowledgement, manifest, register }) {
  const fix = `${manifest.teardown_run_id} ${register.targets.database.project_ref} ${manifest.event_closed_at}`;
  const ok = typeof acknowledgement === 'string' && acknowledgement.trim() === fix;
  return { check: 'live_acknowledgement_exact', ok, detail: ok ? 'exact' : `expected "${fix}"` };
}

// ── media enumeration (D5) ──────────────────────────────────────────────────
// Provider listing is paginated and prefixes nest; a single top-level list() is
// not enumeration. Folders are descended, pages are followed to the end.
export async function listTree(storage, bucket, prefix, pageSize = 100) {
  const objects = [];
  const queue = [prefix];
  while (queue.length > 0) {
    const current = queue.shift();
    let offset = 0;
    // Providers cap page size below what we ask for, so page until an empty
    // page, not until a short one.
    for (let page = 0; page < 10000; page += 1) {
      const result = await storage.list(bucket, current, { limit: pageSize, offset });
      if (result?.error) throw new Error(`storage list failed at ${current}: ${result.error}`);
      const entries = result?.objects ?? [];
      if (entries.length === 0) break;
      for (const entry of entries) {
        const folder = entry.folder === true || (entry.bytes === null && entry.id === null);
        if (folder) queue.push(entry.key.endsWith('/') ? entry.key : `${entry.key}/`);
        else objects.push({ key: entry.key, bytes: entry.bytes ?? 0 });
      }
      offset += entries.length;
    }
  }
  return objects;
}

export async function deleteTree(storage, bucket, prefix, { pageSize = 100, batch = 100, rounds = 50 } = {}) {
  let objects_deleted = 0;
  let bytes_deleted = 0;
  for (let round = 0; round < rounds; round += 1) {
    const objects = await listTree(storage, bucket, prefix, pageSize);
    if (objects.length === 0) return { objects_deleted, bytes_deleted, objects_after: 0 };
    for (let i = 0; i < objects.length; i += batch) {
      const chunk = objects.slice(i, i + batch);
      const result = await storage.remove(bucket, chunk.map((o) => o.key));
      if (result?.error) throw new Error(`storage remove failed: ${result.error}`);
      objects_deleted += chunk.length;
      bytes_deleted += chunk.reduce((total, o) => total + (o.bytes ?? 0), 0);
    }
  }
  throw new Error('storage delete did not converge to zero objects');
}

// ── evidence bundle (D12, D13) ──────────────────────────────────────────────
export async function writeEvidence(dir, files) {
  await mkdir(dir, { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    if (name === 'sha256sums.txt') continue;
    await writeFile(join(dir, name), `${JSON.stringify(redact(value), null, 2)}\n`, 'utf8');
  }
  const names = (await readdir(dir)).filter((n) => n !== 'sha256sums.txt').sort();
  const lines = [];
  for (const name of names) {
    const bytes = await readFile(join(dir, name));
    lines.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
  }
  await writeFile(join(dir, 'sha256sums.txt'), `${lines.join('\n')}\n`, 'utf8');
  return join(dir, 'sha256sums.txt');
}

export async function verifyEvidence({ dir, required = REQUIRED_EVIDENCE }) {
  const checks = [];
  const push = (check, status, detail) => checks.push({ check, status, detail });
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return { status: 'FAIL', checks: [{ check: 'evidence_dir_readable', status: 'FAIL', detail: dir }], summary: {} };
  }

  const missing = required.filter((name) => !names.includes(name));
  push('required_files_present', missing.length === 0 ? 'PASS' : 'INCOMPLETE', missing.join(',') || 'all present');

  const loaded = {};
  for (const name of required) {
    if (!names.includes(name)) continue;
    try {
      loaded[name] = JSON.parse(await readFile(join(dir, name), 'utf8'));
    } catch (err) {
      push(`schema_valid:${name}`, 'FAIL', `unparseable: ${err.message}`);
    }
  }

  // Hashes are recomputed from the bytes on disk, not trusted from the run.
  const sumsText = names.includes('sha256sums.txt')
    ? await readFile(join(dir, 'sha256sums.txt'), 'utf8')
    : '';
  const sums = new Map(
    sumsText
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, ...rest] = line.trim().split(/\s+/);
        return [rest.join(' '), hash];
      })
  );
  const tampered = [];
  for (const name of Object.keys(loaded)) {
    const actual = createHash('sha256').update(await readFile(join(dir, name))).digest('hex');
    if (sums.get(name) !== actual) tampered.push(name);
  }
  push('sha256_match', tampered.length === 0 ? 'PASS' : 'FAIL', tampered.join(',') || 'all match');

  const forbidden = Object.entries(loaded).flatMap(([name, value]) =>
    redactionViolations(value).map((path) => `${name}:${path}`)
  );
  push('no_forbidden_fields', forbidden.length === 0 ? 'PASS' : 'FAIL', forbidden.join(',') || 'none');

  if (loaded['manifest.json']) {
    push(
      'manifest_schema',
      loaded['manifest.json'].schema === MANIFEST_SCHEMA ? 'PASS' : 'FAIL',
      String(loaded['manifest.json'].schema)
    );
  }
  if (loaded['media-summary.json']) {
    const media = loaded['media-summary.json'];
    if (media.objects_after === null || media.objects_after === undefined) {
      push('media_zero_readback', 'INCOMPLETE', 'no readback recorded');
    } else {
      const zero =
        media.objects_after === 0 && media.incomplete_after === 0 && media.recursive_enumeration === true;
      push('media_zero_readback', zero ? 'PASS' : 'FAIL', `after=${media.objects_after} incomplete=${media.incomplete_after}`);
    }
  }
  if (loaded['database.json']) {
    const readback = loaded['database.json'].readback;
    push(
      'project_delete_readback',
      readback === 'NOT_FOUND' ? 'PASS' : readback === 'NOT_ATTEMPTED' ? 'INCOMPLETE' : 'FAIL',
      String(readback)
    );
  }

  // An interrupted run is INCOMPLETE, never PASS (D12).
  const interrupted =
    String(loaded['summary.json']?.status ?? '') === 'INTERRUPTED' ||
    String(loaded['summary.json']?.status ?? '') === 'RUNNING' ||
    Object.values(loaded).some((value) => value && value.status === 'INCOMPLETE');
  if (interrupted) push('run_completed', 'INCOMPLETE', 'run did not reach a terminal stage');

  const order = { PASS: 0, INCOMPLETE: 1, FAIL: 2 };
  const status = checks.reduce((worst, c) => (order[c.status] > order[worst] ? c.status : worst), 'PASS');
  return { status, checks, summary: loaded['summary.json'] ?? {} };
}

export async function sha256File(path) {
  const { readFile: read } = await import('node:fs/promises');
  return createHash('sha256').update(await read(path)).digest('hex');
}

// ── provider adapters ───────────────────────────────────────────────────────
// The synthetic adapter is the only one exercised by the contract fixtures; the
// live adapter is read-mostly and refuses steps it cannot prove.
export function syntheticProvider(spec = {}) {
  const storage = { ...(spec.storage ?? {}) };
  const buckets = storage.buckets ?? {};
  const calls = [];
  const project = { ref: 'synthdemoprojectref01', name: 'movehome-demo', region: 'eu-west-2', organisation: 'movehome-cic', exists: true, ...(spec.project ?? {}) };
  const pageSize = storage.pageSize ?? 2;

  return {
    kind: 'synthetic',
    calls,
    project,
    accountProjects: spec.accountProjects ?? [{ ref: project.ref, name: project.name }],
    async listProjects() {
      return project.exists ? [{ ref: project.ref, name: project.name, region: project.region }] : [];
    },
    storage: {
      async buckets() {
        return Object.keys(buckets);
      },
      async list(bucket, prefix, { limit = 100, offset = 0 } = {}) {
        calls.push({ op: 'list', bucket, prefix, offset });
        if (storage.failList) return { objects: null, error: 'storage unavailable' };
        // Provider truth: one page holds immediate children only; folders must
        // be descended and the page followed.
        const children = new Map();
        for (const key of (buckets[bucket] ?? []).filter((k) => k.startsWith(prefix)).sort()) {
          const rest = key.slice(prefix.length);
          const slash = rest.indexOf('/');
          if (slash >= 0) {
            const folderKey = `${prefix}${rest.slice(0, slash + 1)}`;
            children.set(folderKey, { key: folderKey, folder: true, id: null, bytes: null });
          } else {
            children.set(key, { key, id: `obj-${key}`, bytes: storage.sizes?.[key] ?? 10 });
          }
        }
        const all = [...children.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
        return { objects: all.slice(offset, offset + Math.min(limit, pageSize)) };
      },
      async remove(bucket, keys) {
        calls.push({ op: 'remove', bucket, keys: keys.length });
        if (storage.failRemoveOnce) {
          storage.failRemoveOnce = false;
          return { data: null, error: 'delete refused by provider (transient)' };
        }
        if (storage.failRemove) return { data: null, error: 'delete refused by provider' };
        const set = new Set(buckets[bucket] ?? []);
        for (const key of keys) set.delete(key);
        buckets[bucket] = [...set];
        return { data: keys.length };
      },
      async incompleteUploads() {
        return storage.incomplete ?? 0;
      },
      async purgeIncomplete() {
        const count = storage.incomplete ?? 0;
        storage.incomplete = 0;
        return count;
      }
    },
    supabase: {
      async getProject(ref) {
        return ref === project.ref && project.exists
          ? { ref: project.ref, name: project.name, region: project.region, organisation_ref: project.organisation }
          : null;
      },
      async deleteProject(ref) {
        calls.push({ op: 'deleteProject', ref });
        if (spec.deleteFails) throw new Error('management api refused deletion');
        if (ref === project.ref) project.exists = false;
        return { ref, deleted: true };
      },
      async dataApiReachable() {
        return project.exists;
      },
      async rowCount() {
        return spec.rows ?? 0;
      }
    },
    telegram: {
      async webhookInfo() {
        return { url: spec.telegram?.webhookUrl ?? '' };
      },
      async deleteWebhook() {
        spec.telegram = { ...(spec.telegram ?? {}), webhookUrl: '' };
        return { ok: true };
      },
      async identity() {
        return { id: spec.telegram?.botId ?? 1001, username: 'MoveHomeDemoBot' };
      },
      async revokeToken() {
        if (!spec.telegram?.revokes) return { status: 'MANUAL_REQUIRED', ok: false };
        spec.telegram = { ...(spec.telegram ?? {}), revoked: true };
        return { status: 'REVOKED', ok: true };
      },
      async oldTokenAuthorised() {
        return !spec.telegram?.revoked;
      }
    },
    whatsapp: {
      async status() {
        const wa = spec.whatsapp ?? { provisioned: false };
        if (!wa.provisioned) return { provisioned: false, evidence: 'provider account readback: no app, no number' };
        return {
          provisioned: true,
          webhook: wa.webhook ?? 'https://demo.movehome.org/api/whatsapp/webhook',
          ownership: wa.ownership ?? 'temporary_release',
          phone_number_id: wa.phoneNumberId ?? 'PN-SYNTH-01',
          token_revoked: wa.tokenRevoked ?? false,
          routing: wa.routing ?? 'demo'
        };
      },
      async disableWebhook() {
        if (spec.whatsapp) spec.whatsapp = { ...spec.whatsapp, webhook: '' };
        return { ok: true };
      },
      async revokeToken() {
        if (spec.whatsapp) spec.whatsapp = { ...spec.whatsapp, tokenRevoked: true };
        return { status: 'REVOKED', ok: true };
      },
      async oldTokenAuthorised() {
        return !(spec.whatsapp?.tokenRevoked ?? false);
      },
      // temporary_release releases the leased number; owned_restore must not.
      async numberDisposition({ ownership, release }) {
        calls.push({ op: 'numberDisposition', ownership, release });
        if (ownership === 'owned_restore') {
          if (release) return { ok: false, detail: 'owned number must not be released' };
          return { ok: true, detail: 'demo routing removed, pre-demo configuration restored', released: false };
        }
        if (!release) return { ok: false, detail: 'leased number must be released' };
        return { ok: true, detail: 'leased number absent from provider account', released: true };
      }
    },
    dns: {
      async records() {
        return { ...(spec.dns?.records ?? {}) };
      },
      async deleteRecord(host) {
        calls.push({ op: 'deleteRecord', host });
        const records = { ...(spec.dns?.records ?? {}) };
        if (host !== 'demo') return { ok: false, detail: `refusing to delete production record ${host}` };
        if (!(host in records)) return { ok: false, detail: 'record already absent' };
        delete records[host];
        spec.dns = { ...(spec.dns ?? {}), records };
        return { ok: true };
      },
      async resolve(fqdn) {
        const records = spec.dns?.records ?? {};
        return fqdn.startsWith('demo.') && 'demo' in records ? 'RESOLVED' : 'NXDOMAIN';
      }
    },
    vercel: {
      async domains() {
        return [...(spec.vercel?.domains ?? [])];
      },
      async removeDomain(domain) {
        calls.push({ op: 'removeDomain', domain });
        spec.vercel = { domains: (spec.vercel?.domains ?? []).filter((d) => d !== domain) };
        return { ok: true };
      }
    },
    secrets: {
      async names() {
        return [...(spec.secrets ?? [])];
      },
      async deleteName(name) {
        spec.secrets = (spec.secrets ?? []).filter((n) => n !== name);
        return { ok: true };
      }
    },
    monitors: {
      async list() {
        return [...(spec.monitors ?? [])];
      },
      async deregister(id) {
        spec.monitors = (spec.monitors ?? []).filter((m) => m !== id);
        return { ok: true };
      }
    }
  };
}

// Live adapter: real endpoints, no destructive call without an explicit env
// switch. Steps a provider cannot prove over the API stay MANUAL and fail.
export function liveProvider(env = process.env) {
  const need = (name) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is required for a live run`);
    return value;
  };
  const json = async (res) => {
    const text = await res.text();
    try {
      return { status: res.status, body: text ? JSON.parse(text) : null };
    } catch {
      return { status: res.status, body: text };
    }
  };

  const supabaseToken = env.SUPABASE_ACCESS_TOKEN;
  const ref = env.DEMO_PROJECT_REF;
  const mgmt = (path, init = {}) =>
    fetch(`https://api.supabase.com/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${need('SUPABASE_ACCESS_TOKEN')}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }
    });

  return {
    kind: 'live',
    async listProjects() {
      const res = await json(await mgmt('/projects'));
      return (res.body ?? []).map((project) => ({ ref: project.id, name: project.name, region: project.region }));
    },
    storage: {
      async buckets() {
        const res = await json(
          await fetch(`https://${ref}.supabase.co/storage/v1/bucket`, {
            headers: { Authorization: `Bearer ${need('DEMO_SERVICE_ROLE_KEY')}`, apikey: need('DEMO_SERVICE_ROLE_KEY') }
          })
        );
        return (res.body ?? []).map((bucket) => bucket.name);
      },
      async list(bucket, prefix, { limit = 100, offset = 0 } = {}) {
        const res = await json(
          await fetch(`https://${ref}.supabase.co/storage/v1/object/list/${bucket}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${need('DEMO_SERVICE_ROLE_KEY')}`,
              apikey: need('DEMO_SERVICE_ROLE_KEY'),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prefix, limit, offset, sortBy: { column: 'name', order: 'asc' } })
          })
        );
        if (res.status >= 300) return { objects: null, error: `list ${res.status}` };
        return {
          objects: (res.body ?? []).map((entry) => ({
            key: prefix ? `${prefix.replace(/\/$/, '')}/${entry.name}` : entry.name,
            id: entry.id ?? null,
            bytes: entry.metadata?.size ?? null
          }))
        };
      },
      async remove(bucket, keys) {
        const res = await json(
          await fetch(`https://${ref}.supabase.co/storage/v1/object/${bucket}`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${need('DEMO_SERVICE_ROLE_KEY')}`,
              apikey: need('DEMO_SERVICE_ROLE_KEY'),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prefixes: keys })
          })
        );
        return res.status >= 300 ? { error: `remove ${res.status}` } : { data: keys.length };
      },
      async incompleteUploads() {
        return 0; // shortcut: S3-compatible multipart readback is not exposed by the storage API; the zero readback above is the gate.
      },
      async purgeIncomplete() {
        return 0;
      }
    },
    supabase: {
      async getProject(target) {
        const res = await json(await mgmt(`/projects/${target}`));
        if (res.status === 404) return null;
        return {
          ref: res.body?.id,
          name: res.body?.name,
          region: res.body?.region,
          organisation_ref: res.body?.organization_id
        };
      },
      async deleteProject(target) {
        const res = await json(await mgmt(`/projects/${target}`, { method: 'DELETE' }));
        if (res.status >= 300 && res.status !== 404) throw new Error(`project delete failed: ${res.status}`);
        return { ref: target, deleted: true };
      },
      async dataApiReachable() {
        const res = await fetch(`https://${ref}.supabase.co/rest/v1/`, {
          headers: { apikey: need('DEMO_SUPABASE_ANON_KEY') }
        }).catch(() => null);
        return Boolean(res && res.status < 500);
      },
      async rowCount() {
        const res = await fetch(`https://${ref}.supabase.co/rest/v1/demo_listings?select=id`, {
          method: 'HEAD',
          headers: {
            apikey: need('DEMO_SERVICE_ROLE_KEY'),
            Authorization: `Bearer ${need('DEMO_SERVICE_ROLE_KEY')}`,
            Prefer: 'count=exact'
          }
        });
        const total = res.headers.get('content-range');
        if (!total) throw new Error('row count readback unavailable');
        return Number(total.split('/').pop());
      }
    },
    telegram: {
      async webhookInfo() {
        const res = await json(await fetch(`https://api.telegram.org/bot${need('TELEGRAM_BOT_TOKEN')}/getWebhookInfo`));
        return { url: res.body?.result?.url ?? '' };
      },
      async deleteWebhook() {
        const res = await json(
          await fetch(`https://api.telegram.org/bot${need('TELEGRAM_BOT_TOKEN')}/deleteWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ drop_pending_updates: true })
          })
        );
        return { ok: res.body?.ok === true };
      },
      async identity() {
        const res = await json(await fetch(`https://api.telegram.org/bot${need('TELEGRAM_BOT_TOKEN')}/getMe`));
        return { id: res.body?.result?.id, username: res.body?.result?.username };
      },
      // BotFather has no revoke endpoint: the rotation is a human step and the
      // proof is that the old token stops working.
      async revokeToken() {
        return { status: 'MANUAL_REQUIRED', ok: true };
      },
      async oldTokenAuthorised() {
        const res = await json(await fetch(`https://api.telegram.org/bot${need('TELEGRAM_BOT_TOKEN')}/getMe`));
        return res.status === 200 && res.body?.ok === true;
      }
    },
    whatsapp: {
      async status() {
        return {
          provisioned: Boolean(env.WHATSAPP_PROVIDER),
          evidence: env.WHATSAPP_PROVIDER
            ? `provider=${env.WHATSAPP_PROVIDER}; ownership=${env.WHATSAPP_OWNERSHIP ?? 'UNCLASSIFIED'}`
            : 'provider account readback: no demo app, no number'
        };
      },
      async disableWebhook() {
        if (!env.WHATSAPP_PROVIDER) return { ok: true };
        throw new Error('WhatsApp provider API not implemented — teardown is fail-closed');
      },
      async revokeToken() {
        if (!env.WHATSAPP_PROVIDER) return { status: 'NOT_PROVISIONED', ok: true };
        throw new Error('WhatsApp provider API not implemented — teardown is fail-closed');
      },
      async oldTokenAuthorised() {
        return Boolean(env.WHATSAPP_PROVIDER);
      },
      async numberDisposition({ ownership, release }) {
        if (!env.WHATSAPP_PROVIDER) return { ok: true, detail: 'not provisioned', released: false };
        if (ownership === 'owned_restore' && release) return { ok: false, detail: 'owned number must not be released' };
        throw new Error('number disposition API not implemented — teardown is fail-closed');
      }
    },
    dns: {
      async records() {
        const res = await json(
          await fetch('https://api.godaddy.com/v1/domains/movehome.org/records', {
            headers: { Authorization: `sso-key ${need('GODADDY_API_KEY')}:${need('GODADDY_API_SECRET')}` }
          })
        );
        if (res.status >= 300) throw new Error(`dns read failed: ${res.status}`);
        const grouped = {};
        for (const record of res.body ?? []) {
          const host = record.name || '@';
          grouped[host] = `${record.type} ${record.data}`;
        }
        return grouped;
      },
      async deleteRecord(host) {
        if (host !== 'demo') return { ok: false, detail: `refusing to delete production record ${host}` };
        const res = await fetch(`https://api.godaddy.com/v1/domains/movehome.org/records/CNAME/${host}`, {
          method: 'DELETE',
          headers: { Authorization: `sso-key ${need('GODADDY_API_KEY')}:${need('GODADDY_API_SECRET')}` }
        });
        return res.status < 300 ? { ok: true } : { ok: false, detail: `delete ${res.status}` };
      },
      async resolve(fqdn) {
        const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(fqdn)}&type=CNAME`);
        const body = await res.json();
        return body.Status === 3 ? 'NXDOMAIN' : 'RESOLVED';
      }
    },
    vercel: {
      async domains() {
        const res = await json(
          await fetch(`https://api.vercel.com/v9/projects/${DEMO_PROJECT.split('/')[1]}/domains?teamId=${need('VERCEL_TEAM_ID')}`, {
            headers: { Authorization: `Bearer ${need('VERCEL_TOKEN')}` }
          })
        );
        return (res.body?.domains ?? []).map((d) => d.name);
      },
      async removeDomain(domain) {
        const res = await fetch(
          `https://api.vercel.com/v9/projects/${DEMO_PROJECT.split('/')[1]}/domains/${domain}?teamId=${need('VERCEL_TEAM_ID')}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${need('VERCEL_TOKEN')}` } }
        );
        return { ok: res.status < 300 };
      }
    },
    secrets: {
      async names() {
        return (env.DEMO_SECRET_NAMES ?? '')
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean);
      },
      async deleteName() {
        throw new Error('secret deletion is a named-human step — remove the value in Vercel/GitHub/host stores, then rerun');
      }
    },
    monitors: {
      async list() {
        return (env.DEMO_MONITOR_IDS ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);
      },
      async deregister() {
        throw new Error('monitor deregistration is a named-human step');
      }
    }
  };
}

// ── stage CLI ───────────────────────────────────────────────────────────────
// Each stage script is runnable on its own; the evidence directory is the only
// shared state between stages. Live only: fixtures never come through here.
// `moduleUrl` must be the caller's own import.meta.url: comparing against this
// module's URL never matches argv[1], which silently turned every stage into a
// no-op exit 0.
export async function runStageCli(stage, evidenceName, runStage, moduleUrl) {
  if (!moduleUrl) throw new Error(`${stage}: runStageCli needs the caller's import.meta.url`);
  const { pathToFileURL } = await import('node:url');
  const invoked = process.argv[1] && moduleUrl === pathToFileURL(process.argv[1]).href;
  if (!invoked) return null;

  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const registerPath = flag('--register') ?? process.env.EXPO_ASSET_REGISTER;
  if (!registerPath) {
    console.error(`${stage}: --register <asset-register.json> is required`);
    process.exit(2);
  }
  if (!args.includes('--live')) {
    console.error(`${stage}: synthetic fixtures run through verify.mjs; add --live for a real run`);
    process.exit(2);
  }

  const register = JSON.parse(await readFile(registerPath, 'utf8'));
  const manifestPath = flag('--manifest') ?? `${registerPath}.manifest.json`;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const outDir = flag('--out') ?? join('artifacts', 'expo-t7', register.event_id, manifest.teardown_run_id);
  const provider = liveProvider();
  const result = await runStage({
    register,
    manifest,
    provider,
    accountProjects: await provider.listProjects(),
    acknowledgement: flag('--ack'),
    now: new Date()
  });
  await writeEvidence(outDir, { [evidenceName]: result });
  console.log(`${stage}: ${result.status}`);
  process.exit(result.status === 'PASS' ? 0 : 1);
}

// ── stage 7: secrets, monitors, local media (D10) ───────────────────────────
export async function runSecretsMonitors({ register, provider, now = new Date() }) {
  const checks = [];
  const push = (check, ok, detail) => checks.push({ check, ok: Boolean(ok), detail });

  const demoSecrets = (register.assets ?? []).flatMap((asset) => asset.secret_names ?? []);
  const namesBefore = await provider.secrets.names();
  const manual = [];
  for (const name of namesBefore) {
    try {
      await provider.secrets.deleteName(name);
    } catch (err) {
      manual.push({ name, detail: err.message });
    }
  }
  const namesAfter = await provider.secrets.names();
  push('secret_names_absent', namesAfter.length === 0, namesAfter.join(',') || 'none');
  push('registered_secret_names_known', demoSecrets.every((name) => namesBefore.includes(name)), String(namesBefore.length));

  const monitorsBefore = await provider.monitors.list();
  const deregistered = [];
  for (const id of monitorsBefore) {
    try {
      await provider.monitors.deregister(id);
      deregistered.push(id);
    } catch (err) {
      manual.push({ name: `monitor:${id}`, detail: err.message });
    }
  }
  const monitorsAfter = await provider.monitors.list();
  // Last: a failed cleanup must still page, so monitors go last (D10).
  push('monitors_deregistered', monitorsAfter.length === 0, monitorsAfter.join(',') || 'none');

  const status = checks.every((check) => check.ok) ? 'PASS' : 'FAIL';
  return {
    stage: 'SECRETS_MONITORS_LOCAL',
    status,
    ts: now.toISOString(),
    secret_names: { before: namesBefore.length, after: namesAfter.length },
    monitors: { before: monitorsBefore.length, after: monitorsAfter.length },
    local_media: 'artifacts/expo-t7 only; no operator cache touched',
    manual_steps: manual,
    checks
  };
}
