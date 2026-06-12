// MoveHome A2A protocol tester — browser client.
//
// Talks to the A2A endpoint at `${base}/api/a2a`:
//   • GET                       → Agent Card (discovery)
//   • POST message/send         → invokes a skill via a DataPart { skill, params }
//   • POST tasks/get, …         → other JSON-RPC methods (used by the suite)
//
// A skill reply is an A2A *Task*: status.state is "completed" or "failed", with
// artifacts[] carrying machine-readable DataParts. App-level failures (bad params,
// not found, unknown skill) come back as a *failed Task* — NOT a JSON-RPC error —
// so the UI distinguishes "transport error" from "task failed". Everything that
// crosses the wire is mirrored into the wire-log drawer.

'use strict';

const state = {
  base: 'http://localhost:3000',
  rpcId: 0,
  card: null,
  wire: 0
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pretty = (v) => JSON.stringify(v, null, 2);

// crypto.randomUUID is available on http://localhost and https; fall back for plain LAN IPs.
function uuid() {
  try {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  } catch {}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const baseUrl = () => state.base.replace(/\/+$/, '');

// ── Wire log ────────────────────────────────────────────────────────────
function logWire({ verb, url, status, ms, request, response, kind }) {
  state.wire += 1;
  $('#wire-count').textContent = String(state.wire);
  const codeClass =
    kind === 'neterr' ? 'err'
    : status >= 500 ? 's5'
    : status >= 400 ? 's4'
    : status >= 200 ? 's2'
    : 'err';
  const codeText = kind === 'neterr' ? 'NETWORK' : status ?? '—';
  const entry = document.createElement('details');
  entry.className = 'entry';
  entry.innerHTML = `
    <summary>
      <span class="verb">${esc(verb)}</span>
      <span class="code ${codeClass}">${esc(codeText)}</span>
      <span class="mono" style="color:var(--faint)">${esc(url)}</span>
      <span class="ms">${ms != null ? ms + ' ms' : ''}</span>
    </summary>
    <div class="io">
      <div><h5>Request</h5><pre>${esc(typeof request === 'string' ? request : pretty(request))}</pre></div>
      <div><h5>Response</h5><pre>${esc(typeof response === 'string' ? response : pretty(response))}</pre></div>
    </div>`;
  const body = $('#wire-body');
  body.prepend(entry);
  // Auto-open the drawer on first traffic so results are visible immediately.
  if (state.wire === 1) $('#wire').classList.remove('collapsed');
}

// ── HTTP helpers ──────────────────────────────────────────────────────────
// POST a JSON-RPC envelope. `rawBody` sends a literal string unchanged (used to
// test malformed-JSON handling). Returns { status, json, text, ms, netErr }.
async function rpcPost(body, { rawBody = null, verb } = {}) {
  const url = baseUrl() + '/api/a2a';
  const payload = rawBody != null ? rawBody : JSON.stringify(body);
  const label = verb || (body && body.method) || '(raw)';
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const ms = Math.round(performance.now() - t0);
    logWire({ verb: `POST ${label}`, url, status: res.status, ms, request: payload, response: json ?? text });
    return { status: res.status, json, text, ms, netErr: null };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    logWire({ verb: `POST ${label}`, url, ms, request: payload, response: String(e), kind: 'neterr' });
    return { status: 0, json: null, text: '', ms, netErr: e };
  }
}

async function httpGet(path, verb) {
  const url = baseUrl() + path;
  const t0 = performance.now();
  try {
    const res = await fetch(url, { method: 'GET' });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const ms = Math.round(performance.now() - t0);
    logWire({ verb: verb || `GET ${path}`, url, status: res.status, ms, request: '(no body)', response: json ?? text });
    return { status: res.status, json, text, ms, netErr: null };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    logWire({ verb: verb || `GET ${path}`, url, ms, request: '(no body)', response: String(e), kind: 'neterr' });
    return { status: 0, json: null, text: '', ms, netErr: e };
  }
}

// Build a message/send envelope that invokes one skill.
function skillEnvelope(skill, params) {
  state.rpcId += 1;
  return {
    jsonrpc: '2.0',
    id: state.rpcId,
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        role: 'user',
        messageId: uuid(),
        parts: [{ kind: 'data', data: { skill, params } }]
      }
    }
  };
}

async function invokeSkill(skill, params, verb) {
  return rpcPost(skillEnvelope(skill, params), { verb: verb || `message/send · ${skill}` });
}

// Pull the named artifact's first DataPart out of a completed Task.
function artifactData(task, name) {
  const a = task?.artifacts?.find((x) => x.name === name) || task?.artifacts?.[0];
  const part = a?.parts?.find((p) => p.kind === 'data');
  return part?.data ?? null;
}
function statusText(task) {
  return task?.status?.message?.parts?.find((p) => p.kind === 'text')?.text ?? '';
}

// ── Discovery ───────────────────────────────────────────────────────────
async function discover() {
  setStatus('busy', 'connecting…');
  const r = await httpGet('/api/a2a', 'GET agent card');
  if (r.netErr || !r.json) {
    setStatus('bad', r.netErr ? 'unreachable' : `HTTP ${r.status}`);
    $('#card-summary').className = 'card-summary empty';
    $('#card-summary').textContent = r.netErr
      ? `Could not reach ${baseUrl()} — is the dev server running?`
      : `Unexpected response (HTTP ${r.status}).`;
    return null;
  }
  state.card = r.json;
  renderCard(r.json);
  const skillCount = Array.isArray(r.json.skills) ? r.json.skills.length : 0;
  setStatus('ok', `${esc(r.json.name || 'agent')} · ${skillCount} skills`);
  return r.json;
}

function renderCard(card) {
  $('#card-json').textContent = pretty(card);
  const caps = card.capabilities || {};
  const skills = Array.isArray(card.skills) ? card.skills : [];
  $('#card-summary').className = 'card-summary';
  $('#card-summary').innerHTML = `
    <dl class="kv">
      <dt>Name</dt><dd>${esc(card.name)}</dd>
      <dt>Version</dt><dd>${esc(card.version)}</dd>
      <dt>Protocol</dt><dd>${esc(card.protocolVersion)}</dd>
      <dt>Transport</dt><dd>${esc(card.preferredTransport)}</dd>
      <dt>Endpoint</dt><dd>${esc(card.url)}</dd>
      <dt>Capabilities</dt><dd>streaming=${!!caps.streaming} · push=${!!caps.pushNotifications}</dd>
    </dl>
    <div><strong>Skills (${skills.length})</strong></div>
    ${skills
      .map(
        (s) => `
      <div class="skill">
        <h4>${esc(s.id)}</h4>
        <p>${esc(s.description || s.name || '')}</p>
        <div class="chips">${(s.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      </div>`
      )
      .join('')}`;
}

// ── search_properties ─────────────────────────────────────────────────────
function readNum(v) {
  if (v === '' || v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function searchParamsFromForm(form) {
  const f = new FormData(form);
  const p = {};
  const str = (k) => (f.get(k) || '').toString().trim();
  if (str('un_locode')) p.un_locode = str('un_locode').toUpperCase();
  if (str('service_type')) p.service_type = str('service_type');
  if (str('property_type')) p.property_type = str('property_type');
  if (readNum(f.get('bedrooms_min')) !== undefined) p.bedrooms_min = readNum(f.get('bedrooms_min'));
  if (readNum(f.get('bedrooms_max')) !== undefined) p.bedrooms_max = readNum(f.get('bedrooms_max'));
  if (readNum(f.get('rent_pcm_max')) !== undefined) p.rent_pcm_max = readNum(f.get('rent_pcm_max'));
  if (readNum(f.get('asking_price_max')) !== undefined) p.asking_price_max = readNum(f.get('asking_price_max'));
  if (str('features')) p.features = str('features').split(',').map((x) => x.trim()).filter(Boolean);
  if (readNum(f.get('limit')) !== undefined) p.limit = readNum(f.get('limit'));
  if (readNum(f.get('offset')) !== undefined) p.offset = readNum(f.get('offset'));
  return p;
}

function priceOf(l) {
  const c = l.price?.currency || '£';
  if (l.service_type === 'sale' && l.price?.asking_price != null) return `${c}${fmt(l.price.asking_price)}`;
  if (l.price?.rent_pcm != null) return `${c}${fmt(l.price.rent_pcm)} pcm`;
  if (l.price?.daily_rate != null) return `${c}${fmt(l.price.daily_rate)}/day`;
  return '—';
}
const fmt = (n) => Number(n).toLocaleString('en-GB');

async function runSearch(form) {
  const summary = $('#search-summary');
  const out = $('#search-results');
  summary.className = 'result-summary';
  summary.textContent = 'Searching…';
  out.innerHTML = '';
  const r = await invokeSkill('search_properties', searchParamsFromForm(form));
  const task = r.json?.result;
  if (r.json?.error) return failSummary(summary, `JSON-RPC error ${r.json.error.code}: ${r.json.error.message}`);
  if (!task) return failSummary(summary, r.netErr ? 'Network error.' : 'No task in response.');
  if (task.status?.state !== 'completed') return failSummary(summary, `Task ${task.status?.state}: ${statusText(task)}`);

  const data = artifactData(task, 'search_results') || {};
  const listings = data.listings || [];
  summary.className = 'result-summary ok';
  summary.textContent = `${statusText(task)} (total ${data.total ?? '?'}, showing ${listings.length}) · ${r.ms} ms`;
  if (!listings.length) { out.innerHTML = '<p class="result-summary">No listings to display.</p>'; return; }
  out.innerHTML = `
    <table><thead><tr>
      <th>raia_id</th><th>Headline</th><th>Service</th><th>Type</th><th>Beds</th><th>Price</th><th>LOCODE</th><th></th>
    </tr></thead><tbody>
    ${listings
      .map(
        (l) => `<tr>
        <td class="mono">${esc(l.raia_id)}</td>
        <td>${esc(l.headline || '—')}</td>
        <td>${esc(l.service_type || '—')}</td>
        <td>${esc(l.property_type || '—')}</td>
        <td>${l.bedrooms ?? '—'}</td>
        <td>${esc(priceOf(l))}</td>
        <td class="mono">${esc(l.location?.un_locode || '—')}</td>
        <td><div class="row-actions">
          <button data-get="${esc(l.raia_id)}">Get</button>
          <button data-enq="${esc(l.raia_id)}">Enquire</button>
        </div></td>
      </tr>`
      )
      .join('')}
    </tbody></table>`;
}
function failSummary(el, msg) { el.className = 'result-summary fail'; el.textContent = msg; }

// ── get_property ──────────────────────────────────────────────────────────
async function runGet(raiaId) {
  const out = $('#get-result');
  out.innerHTML = '<p class="result-summary">Fetching…</p>';
  const r = await invokeSkill('get_property', { raia_id: raiaId });
  const task = r.json?.result;
  if (r.json?.error) { out.innerHTML = `<p class="result-summary fail">JSON-RPC error ${r.json.error.code}: ${esc(r.json.error.message)}</p>`; return; }
  if (!task) { out.innerHTML = `<p class="result-summary fail">${r.netErr ? 'Network error.' : 'No task in response.'}</p>`; return; }
  if (task.status?.state !== 'completed') { out.innerHTML = `<p class="result-summary fail">Task ${esc(task.status?.state)}: ${esc(statusText(task))}</p>`; return; }

  const l = (artifactData(task, 'property') || {}).listing;
  if (!l) { out.innerHTML = '<p class="result-summary fail">Completed but no listing in artifact.</p>'; return; }
  const field = (label, val) => `<div class="f"><span>${esc(label)}</span><b>${esc(val ?? '—')}</b></div>`;
  const media = l.media || {};
  const links = Object.entries({ Photo: media.photo_url, 'Floor plan': media.floor_plan_url, Video: media.video_url, '360 tour': media.tour_360_url })
    .filter(([, v]) => v)
    .map(([k, v]) => `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(k)} ↗</a>`)
    .join('');
  out.innerHTML = `
    <div class="detail-card">
      <h3>${esc(l.headline || l.raia_id)}</h3>
      <div class="sub mono">${esc(l.raia_id)} · <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url)}</a></div>
      <div class="detail-grid">
        ${field('Service', l.service_type)} ${field('Type', l.property_type)} ${field('Status', l.status)}
        ${field('Price', priceOf(l))} ${field('Bedrooms', l.bedrooms)} ${field('Bathrooms', l.bathrooms)}
        ${field('Floor area', l.floor_area_sqm ? l.floor_area_sqm + ' m²' : null)} ${field('Furnishing', l.furnishing)}
        ${field('Available', l.available_from)} ${field('LOCODE', l.location?.un_locode)}
        ${field('Suburb', l.location?.suburb)} ${field('Postcode', l.location?.postcode_district)}
      </div>
      ${l.description ? `<p style="color:var(--muted);margin-top:14px">${esc(l.description)}</p>` : ''}
      ${(l.features || []).length ? `<div class="chips" style="margin-top:12px">${l.features.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
      ${links ? `<div class="media-links">${links}</div>` : ''}
    </div>`;
}

// ── create_enquiry (gated write) ───────────────────────────────────────────
function enquiryParamsFromForm(form) {
  const f = new FormData(form);
  const str = (k) => (f.get(k) || '').toString().trim();
  const enquirer = { name: str('name'), email: str('email') };
  if (str('phone')) enquirer.phone = str('phone');
  if (str('preferred_contact')) enquirer.preferred_contact = str('preferred_contact');
  const params = { raia_id: str('raia_id'), enquirer, message: str('message') };
  const dates = str('preferred_dates').split(',').map((x) => x.trim()).filter(Boolean);
  if (dates.length) {
    params.viewing_request = { preferred_dates: dates };
    if (readNum(f.get('party_size')) !== undefined) params.viewing_request.party_size = readNum(f.get('party_size'));
  }
  return params;
}

async function runEnquiry(params) {
  const out = $('#enquiry-result');
  out.innerHTML = '<p class="result-summary">Sending…</p>';
  const r = await invokeSkill('create_enquiry', params);
  const task = r.json?.result;
  if (r.json?.error) { out.innerHTML = `<p class="result-summary fail">JSON-RPC error ${r.json.error.code}: ${esc(r.json.error.message)}</p>`; return; }
  if (!task) { out.innerHTML = `<p class="result-summary fail">${r.netErr ? 'Network error.' : 'No task in response.'}</p>`; return; }
  if (task.status?.state !== 'completed') { out.innerHTML = `<p class="result-summary fail">Task ${esc(task.status?.state)}: ${esc(statusText(task))}</p>`; return; }
  const data = artifactData(task, 'enquiry_receipt') || {};
  out.innerHTML = `
    <div class="receipt">
      <div>${esc(statusText(task))}</div>
      <div class="mono">enquiry_id: ${esc(data.enquiry_id || '—')} · status: ${esc(data.status || '—')}</div>
    </div>`;
}

// ── Conformance suite ───────────────────────────────────────────────────
// Each check returns { status: 'pass'|'fail'|'skip', detail }. A thrown error
// fails the check. `ctx` carries a raia_id captured from the live search so the
// happy-path get_property check exercises a real listing.
const CHECKS = [
  {
    group: 'discovery', name: 'Agent Card via GET /api/a2a',
    async run() {
      const r = await httpGet('/api/a2a', 'GET /api/a2a');
      if (r.status !== 200 || !r.json) return fail(`HTTP ${r.status}`);
      const c = r.json;
      const ids = (c.skills || []).map((s) => s.id);
      const need = ['search_properties', 'get_property', 'create_enquiry'];
      const missing = need.filter((s) => !ids.includes(s));
      if (!c.name) return fail('card has no name');
      if (!String(c.url || '').endsWith('/api/a2a')) return fail(`url is "${c.url}"`);
      if (missing.length) return fail(`missing skills: ${missing.join(', ')}`);
      return pass(`${c.name} v${c.version} · proto ${c.protocolVersion} · ${ids.length} skills`);
    }
  },
  {
    group: 'discovery', name: 'Agent Card via /.well-known/agent-card.json',
    async run() {
      const r = await httpGet('/.well-known/agent-card.json', 'GET well-known');
      if (r.status !== 200 || !r.json) return fail(`HTTP ${r.status} (rewrite not wired?)`);
      if (!r.json.name) return fail('no name in card');
      return pass(`served via rewrite · ${r.json.name}`);
    }
  },
  {
    group: 'search', name: 'search_properties → completed Task with artifact',
    async run(ctx) {
      const r = await invokeSkill('search_properties', { limit: 3 }, 'suite · search');
      const t = r.json?.result;
      if (!t) return fail(r.json?.error ? `JSON-RPC error ${r.json.error.code}` : 'no task');
      if (t.status?.state !== 'completed') return fail(`state=${t.status?.state}`);
      const data = artifactData(t, 'search_results');
      if (!data || !Array.isArray(data.listings)) return fail('no search_results artifact / listings[]');
      if (typeof data.total !== 'number') return fail('artifact missing numeric total');
      if (data.listings[0]?.raia_id) ctx.raiaId = data.listings[0].raia_id; // chain for next check
      return pass(`total=${data.total}, returned ${data.listings.length}`);
    }
  },
  {
    group: 'get', name: 'get_property (real raia_id from search) → completed',
    async run(ctx) {
      if (!ctx.raiaId) return skip('no listing available to chain from search');
      const r = await invokeSkill('get_property', { raia_id: ctx.raiaId }, 'suite · get');
      const t = r.json?.result;
      if (!t) return fail('no task');
      if (t.status?.state !== 'completed') return fail(`state=${t.status?.state}: ${statusText(t)}`);
      const l = (artifactData(t, 'property') || {}).listing;
      if (l?.raia_id !== ctx.raiaId) return fail('returned listing id mismatch');
      return pass(`fetched ${ctx.raiaId}`);
    }
  },
  {
    group: 'get', name: 'get_property (unknown id) → failed Task, not crash',
    async run() {
      const r = await invokeSkill('get_property', { raia_id: 'prop-gb-zzz-00000000' }, 'suite · get 404');
      const t = r.json?.result;
      if (!t) return fail(r.json?.error ? `got JSON-RPC error instead of failed task` : 'no task');
      if (t.status?.state !== 'failed') return fail(`expected failed, got ${t.status?.state}`);
      return pass(`failed gracefully: "${truncate(statusText(t))}"`);
    }
  },
  {
    group: 'skills', name: 'unknown skill → failed Task listing valid skills',
    async run() {
      const r = await invokeSkill('teleport_user', {}, 'suite · unknown skill');
      const t = r.json?.result;
      if (!t || t.status?.state !== 'failed') return fail(`expected failed task, got ${t?.status?.state ?? 'none'}`);
      if (!/unknown skill/i.test(statusText(t))) return fail(`message: "${truncate(statusText(t))}"`);
      return pass(`"${truncate(statusText(t))}"`);
    }
  },
  {
    group: 'validation', name: 'invalid params (bad un_locode) → failed Task',
    async run() {
      const r = await invokeSkill('search_properties', { un_locode: 'london' }, 'suite · bad params');
      const t = r.json?.result;
      if (!t || t.status?.state !== 'failed') return fail(`expected failed task, got ${t?.status?.state ?? 'none'}`);
      if (!/invalid parameters/i.test(statusText(t))) return fail(`message: "${truncate(statusText(t))}"`);
      return pass(`rejected: "${truncate(statusText(t))}"`);
    }
  },
  {
    group: 'validation', name: 'message with no skill DataPart → failed Task',
    async run() {
      state.rpcId += 1;
      const body = {
        jsonrpc: '2.0', id: state.rpcId, method: 'message/send',
        params: { message: { kind: 'message', role: 'user', messageId: uuid(), parts: [{ kind: 'text', text: 'hello agent' }] } }
      };
      const r = await rpcPost(body, { verb: 'suite · no datapart' });
      const t = r.json?.result;
      if (!t || t.status?.state !== 'failed') return fail(`expected failed task, got ${t?.status?.state ?? 'none'}`);
      if (!/no skill invocation/i.test(statusText(t))) return fail(`message: "${truncate(statusText(t))}"`);
      return pass('guided error returned');
    }
  },
  {
    group: 'protocol', name: 'unknown JSON-RPC method → JSON-RPC error',
    async run() {
      state.rpcId += 1;
      const r = await rpcPost({ jsonrpc: '2.0', id: state.rpcId, method: 'agent/teleport', params: {} }, { verb: 'suite · bad method' });
      if (!r.json?.error) return fail(`expected error object, got result`);
      return pass(`error ${r.json.error.code}: ${truncate(r.json.error.message)}`);
    }
  },
  {
    group: 'protocol', name: 'message/stream → rejected (streaming unsupported)',
    async run() {
      state.rpcId += 1;
      const body = {
        jsonrpc: '2.0', id: state.rpcId, method: 'message/stream',
        params: { message: { kind: 'message', role: 'user', messageId: uuid(), parts: [{ kind: 'data', data: { skill: 'search_properties', params: { limit: 1 } } }] } }
      };
      const r = await rpcPost(body, { verb: 'suite · stream' });
      if (!r.json?.error) return fail('expected an error (card advertises streaming=false)');
      const note = r.json.error.code === -32004 ? ' (-32004 as designed)' : '';
      return pass(`rejected: ${r.json.error.code}${note}`);
    }
  },
  {
    group: 'protocol', name: 'malformed JSON body → HTTP 400 / -32700',
    async run() {
      const r = await rpcPost(null, { rawBody: '{ "jsonrpc": "2.0", oops', verb: 'suite · malformed' });
      if (r.status !== 400) return fail(`expected HTTP 400, got ${r.status}`);
      if (r.json?.error?.code !== -32700) return fail(`expected -32700, got ${r.json?.error?.code}`);
      return pass('HTTP 400 with parse error -32700');
    }
  },
  {
    group: 'protocol', name: 'tasks/get (unknown id) → JSON-RPC error',
    async run() {
      state.rpcId += 1;
      const r = await rpcPost({ jsonrpc: '2.0', id: state.rpcId, method: 'tasks/get', params: { id: uuid() } }, { verb: 'suite · tasks/get' });
      if (!r.json?.error) return fail('expected task-not-found error');
      return pass(`error ${r.json.error.code}: ${truncate(r.json.error.message)}`);
    }
  }
];

const pass = (detail) => ({ status: 'pass', detail });
const fail = (detail) => ({ status: 'fail', detail });
const skip = (detail) => ({ status: 'skip', detail });
const truncate = (s, n = 90) => (String(s ?? '').length > n ? String(s).slice(0, n) + '…' : String(s ?? ''));

async function runSuite() {
  const btn = $('#run-suite');
  const box = $('#suite-results');
  btn.disabled = true;
  box.innerHTML = '';
  const ctx = {};
  const rows = CHECKS.map((c) => {
    const row = document.createElement('div');
    row.className = 'check running';
    row.innerHTML = `<span class="icon">…</span><div class="body"><div class="grp">${esc(c.group)}</div><div class="name">${esc(c.name)}</div><div class="detail">running…</div></div><span class="meta"></span>`;
    box.appendChild(row);
    return row;
  });

  let passed = 0, failed = 0, skipped = 0;
  for (let i = 0; i < CHECKS.length; i++) {
    const t0 = performance.now();
    let res;
    try {
      res = await CHECKS[i].run(ctx);
    } catch (e) {
      res = fail(`threw: ${e?.message || e}`);
    }
    const ms = Math.round(performance.now() - t0);
    if (res.status === 'pass') passed++; else if (res.status === 'skip') skipped++; else failed++;
    const icon = res.status === 'pass' ? '✓' : res.status === 'skip' ? '⊘' : '✗';
    rows[i].className = `check ${res.status}`;
    rows[i].querySelector('.icon').textContent = icon;
    rows[i].querySelector('.detail').textContent = res.detail || '';
    rows[i].querySelector('.meta').textContent = `${ms} ms`;
  }
  const tally = $('#suite-tally');
  tally.innerHTML = `<strong style="color:var(--ok)">${passed} passed</strong> · <strong style="color:${failed ? 'var(--fail)' : 'var(--faint)'}">${failed} failed</strong>${skipped ? ` · ${skipped} skipped` : ''}`;
  btn.disabled = false;
}

// ── Status pill ───────────────────────────────────────────────────────────
function setStatus(kind, text) {
  const pill = $('#status');
  pill.className = `pill ${kind}`;
  pill.textContent = text;
  const dot = document.querySelector('.brand .dot');
  dot.className = 'dot' + (kind === 'ok' ? ' live' : kind === 'bad' ? ' bad' : '');
}

// ── Wiring ────────────────────────────────────────────────────────────────
function switchTab(name) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
}

function reflectTarget() {
  state.base = $('#base').value.trim() || 'http://localhost:3000';
  const isProd = /movehome\.org/i.test(state.base) && !/localhost|127\.0\.0\.1/.test(state.base);
  $('#prod-warning').classList.toggle('hidden', !isProd);
}

let pendingEnquiry = null;
function init() {
  reflectTarget();
  $('#base').addEventListener('input', reflectTarget);
  $$('.preset').forEach((b) => b.addEventListener('click', () => { $('#base').value = b.dataset.base; reflectTarget(); discover(); }));
  $('#discover').addEventListener('click', discover);
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); runSearch(e.target); });
  $('#get-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = new FormData(e.target).get('raia_id').toString().trim();
    if (id) runGet(id);
  });

  // Row actions from the search results table (event delegation).
  $('#search-results').addEventListener('click', (e) => {
    const get = e.target.closest('[data-get]');
    const enq = e.target.closest('[data-enq]');
    if (get) { $('#get-form [name=raia_id]').value = get.dataset.get; switchTab('get'); runGet(get.dataset.get); }
    if (enq) { $('#enquiry-form [name=raia_id]').value = enq.dataset.enq; switchTab('enquiry'); }
  });

  // create_enquiry is the only write — confirm first.
  $('#enquiry-form').addEventListener('submit', (e) => {
    e.preventDefault();
    pendingEnquiry = enquiryParamsFromForm(e.target);
    $('#modal-text').innerHTML =
      `This will insert a real enquiry for <strong>${esc(pendingEnquiry.raia_id)}</strong> ` +
      `as <strong>${esc(pendingEnquiry.enquirer.name)} &lt;${esc(pendingEnquiry.enquirer.email)}&gt;</strong> ` +
      `against <strong>${esc(baseUrl())}</strong> and forward it to the source agent.`;
    $('#modal').classList.remove('hidden');
  });
  $('#modal-cancel').addEventListener('click', () => { pendingEnquiry = null; $('#modal').classList.add('hidden'); });
  $('#modal-confirm').addEventListener('click', () => {
    $('#modal').classList.add('hidden');
    if (pendingEnquiry) runEnquiry(pendingEnquiry);
    pendingEnquiry = null;
  });

  $('#run-suite').addEventListener('click', runSuite);

  // Wire-log drawer.
  const toggleWire = () => {
    const w = $('#wire');
    w.classList.toggle('collapsed');
    $('#wire-caret').textContent = w.classList.contains('collapsed') ? '▲' : '▼';
  };
  $('#wire-toggle').addEventListener('click', (e) => { if (e.target.id !== 'wire-clear') toggleWire(); });
  $('#wire-toggle').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.id !== 'wire-clear') { e.preventDefault(); toggleWire(); }
  });
  $('#wire-clear').addEventListener('click', (e) => { e.stopPropagation(); $('#wire-body').innerHTML = ''; state.wire = 0; $('#wire-count').textContent = '0'; });

  // Auto-discover on load so the page is useful immediately.
  discover();
}

document.addEventListener('DOMContentLoaded', init);
