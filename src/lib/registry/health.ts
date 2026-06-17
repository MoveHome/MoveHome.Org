// Registry health + A2A conformance worker. For each agent due a check it probes:
//   1. liveness — can we fetch the agent card?
//   2. conformance — does the A2A endpoint speak JSON-RPC? We send `tasks/get` for a
//      nonexistent id, which a conformant agent answers with a JSON-RPC envelope and
//      which has NO side effects (it never invokes a skill like create_enquiry).
// Probes run concurrently with per-request timeouts; results go to store.recordHealth.

import { isForwardableEndpoint } from '@/lib/enquiry';
import { agentsDueForHealthCheck, recordHealth, type HealthDueRow } from './store';
import type { TaskConformance } from './types';

const PROBE_TIMEOUT_MS = 8_000;
const DEFAULT_BATCH = 25;

interface ProbeResult {
  ok: boolean;
  responseMs: number | null;
  conformance: TaskConformance;
}

async function probe(row: HealthDueRow): Promise<ProbeResult> {
  const start = Date.now();

  let cardOk = false;
  if (isForwardableEndpoint(row.well_known_uri)) {
    try {
      const r = await fetch(row.well_known_uri, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      cardOk = r.ok;
    } catch {
      cardOk = false;
    }
  }

  let category: TaskConformance['category'] = 'UNKNOWN';
  let passed = false;
  if (row.a2a_url && isForwardableEndpoint(row.a2a_url)) {
    try {
      const r = await fetch(row.a2a_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'health-probe', method: 'tasks/get', params: { id: 'health-probe-nonexistent' } }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
      });
      const body = (await r.json()) as { jsonrpc?: string; error?: unknown; result?: unknown };
      const speaksA2A = body?.jsonrpc === '2.0' && ('error' in body || 'result' in body);
      passed = speaksA2A;
      category = speaksA2A ? 'WORKING' : 'DEGRADED';
    } catch {
      category = 'FAILING';
      passed = false;
    }
  }

  const responseMs = Date.now() - start;
  const ok = cardOk && passed;
  return {
    ok,
    responseMs,
    conformance: { category: ok ? 'WORKING' : category, passed, checked_at: new Date().toISOString(), response_ms: responseMs }
  };
}

export async function runHealthChecks(limit = DEFAULT_BATCH): Promise<{ checked: number; healthy: number }> {
  const due = await agentsDueForHealthCheck(limit);
  const results = await Promise.all(
    due.map(async (row) => {
      const result = await probe(row);
      await recordHealth(row.id, result).catch((e) => console.error('[registry/health] recordHealth', row.id, e));
      return result.ok;
    })
  );
  return { checked: due.length, healthy: results.filter(Boolean).length };
}
