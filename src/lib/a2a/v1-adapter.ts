// A2A 1.0 on top of the 0.3 SDK transport.
//
// The card has advertised 1.0 alongside 0.3 since the federation upgrade, but the
// SDK we run (@a2a-js/sdk 0.3.x) only speaks 0.3, so a 1.0 `SendMessage` answered
// "Method not found". This module negotiates the version and translates the 1.0
// wire shape to 0.3 and back. The SDK, the executor, the skills and every route
// guard (write flag, TEST fence, throttles) stay exactly as they are; the route
// runs them on the translated 0.3 request, so 1.0 cannot bypass any of them.
//
// Rules (same as app.estateaigents.com, raia ADR-472 V2):
//   - No A2A-Version header, or 0.3 / 0.3.x → 0.3, served unchanged.
//   - 1.0 / 1.0.x → 1.0. Version and method must agree: a 0.3 method name under
//     1.x is -32601, and a 1.0 method name under 0.3 is -32601 (the SDK's own
//     answer for an unknown method).
//   - Anything else → -32009 VersionNotSupported.
// Supported 1.0 methods: SendMessage and GetTask. Every task MoveHome publishes is
// already terminal, so there is nothing to stream, subscribe to or cancel.

export const METHOD_NOT_FOUND = -32601;
export const VERSION_NOT_SUPPORTED = -32009;
export const INVALID_PARAMS = -32602;

const LEGACY_METHODS = new Set([
  'message/send', 'message/stream', 'tasks/get', 'tasks/cancel', 'tasks/resubscribe',
  'tasks/pushNotificationConfig/set', 'tasks/pushNotificationConfig/get',
  'tasks/pushNotificationConfig/list', 'tasks/pushNotificationConfig/delete',
  'agent/getAuthenticatedExtendedCard'
]);

type Json = Record<string, unknown>;
export type Negotiated =
  | { kind: 'legacy' }
  | { kind: 'v1' }
  | { kind: 'error'; code: number; message: string };

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Which protocol answers this request. */
export function negotiateVersion(raw: unknown, header: string | null | undefined): Negotiated {
  const v = header?.trim();
  if (!v || v === '0.3' || /^0\.3\.\d+$/.test(v)) return { kind: 'legacy' };
  if (v === '1.0' || /^1\.0\.\d+$/.test(v)) {
    const method = isObj(raw) ? raw.method : undefined;
    if (typeof method === 'string' && LEGACY_METHODS.has(method)) {
      return {
        kind: 'error',
        code: METHOD_NOT_FOUND,
        message: `Method ${method} is A2A 0.3; it does not exist under A2A-Version ${v}.`
      };
    }
    return { kind: 'v1' };
  }
  return {
    kind: 'error',
    code: VERSION_NOT_SUPPORTED,
    message: `The requested A2A protocol version '${v}' is not supported. Supported versions: 1.0, 0.3`
  };
}

// ── 1.0 → 0.3 request ────────────────────────────────────────────────────────

function partToLegacy(p: unknown): Json | null {
  if (!isObj(p)) return null;
  const metadata = isObj(p.metadata) ? { metadata: p.metadata } : {};
  if (typeof p.text === 'string') return { kind: 'text', text: p.text, ...metadata };
  if (isObj(p.data)) return { kind: 'data', data: p.data, ...metadata };
  return null; // file / raw parts: no MoveHome skill reads them
}

function messageToLegacy(m: unknown): Json | null {
  if (!isObj(m) || !Array.isArray(m.parts)) return null;
  const parts = m.parts.map(partToLegacy).filter((p): p is Json => p !== null);
  return {
    kind: 'message',
    role: m.role === 'ROLE_AGENT' ? 'agent' : 'user',
    messageId: typeof m.messageId === 'string' ? m.messageId : '',
    parts,
    ...(typeof m.contextId === 'string' ? { contextId: m.contextId } : {}),
    ...(typeof m.taskId === 'string' ? { taskId: m.taskId } : {}),
    ...(isObj(m.metadata) ? { metadata: m.metadata } : {})
  };
}

/** The 0.3 request to run, or a JSON-RPC error for a 1.0 method MoveHome does not serve. */
export function toLegacyRequest(raw: unknown): { request: Json } | { error: { code: number; message: string } } {
  const r = isObj(raw) ? raw : {};
  const params = isObj(r.params) ? r.params : {};
  const base = { jsonrpc: '2.0', id: r.id ?? null };
  if (r.method === 'SendMessage') {
    const message = messageToLegacy(params.message);
    if (!message) return { error: { code: INVALID_PARAMS, message: 'SendMessage needs params.message with parts.' } };
    return { request: { ...base, method: 'message/send', params: { message, ...(isObj(params.metadata) ? { metadata: params.metadata } : {}) } } };
  }
  if (r.method === 'GetTask') {
    const id = typeof params.id === 'string' ? params.id : typeof params.name === 'string' ? params.name.replace(/^tasks\//, '') : '';
    return { request: { ...base, method: 'tasks/get', params: { id, ...(typeof params.historyLength === 'number' ? { historyLength: params.historyLength } : {}) } } };
  }
  return {
    error: {
      code: METHOD_NOT_FOUND,
      message: `Method ${String(r.method)} is not supported by MoveHome under A2A 1.0. Supported: SendMessage, GetTask.`
    }
  };
}

// ── 0.3 → 1.0 response ───────────────────────────────────────────────────────

const STATE_V1: Record<string, string> = {
  submitted: 'TASK_STATE_SUBMITTED',
  working: 'TASK_STATE_WORKING',
  'input-required': 'TASK_STATE_INPUT_REQUIRED',
  'auth-required': 'TASK_STATE_AUTH_REQUIRED',
  completed: 'TASK_STATE_COMPLETED',
  canceled: 'TASK_STATE_CANCELED',
  failed: 'TASK_STATE_FAILED',
  rejected: 'TASK_STATE_REJECTED'
};

function partToV1(p: unknown): Json | null {
  if (!isObj(p)) return null;
  const metadata = isObj(p.metadata) ? { metadata: p.metadata } : {};
  if (p.kind === 'text') return { text: p.text, ...metadata };
  if (p.kind === 'data') return { data: p.data, ...metadata };
  return null;
}

function messageToV1(m: unknown): Json | undefined {
  if (!isObj(m)) return undefined;
  return {
    messageId: m.messageId,
    role: m.role === 'agent' ? 'ROLE_AGENT' : 'ROLE_USER',
    parts: Array.isArray(m.parts) ? m.parts.map(partToV1).filter(Boolean) : [],
    ...(m.contextId ? { contextId: m.contextId } : {}),
    ...(m.taskId ? { taskId: m.taskId } : {})
  };
}

function taskToV1(t: Json): Json {
  const status = isObj(t.status) ? t.status : {};
  return {
    id: t.id,
    contextId: t.contextId,
    status: {
      state: STATE_V1[String(status.state)] ?? 'TASK_STATE_UNSPECIFIED',
      ...(status.message ? { message: messageToV1(status.message) } : {}),
      ...(status.timestamp ? { timestamp: status.timestamp } : {})
    },
    artifacts: Array.isArray(t.artifacts)
      ? t.artifacts.filter(isObj).map((a) => ({
          artifactId: a.artifactId,
          ...(a.name ? { name: a.name } : {}),
          ...(a.description ? { description: a.description } : {}),
          parts: Array.isArray(a.parts) ? a.parts.map(partToV1).filter(Boolean) : []
        }))
      : [],
    history: Array.isArray(t.history) ? t.history.map(messageToV1).filter(Boolean) : []
  };
}

/**
 * A 0.3 JSON-RPC response in the 1.0 shape. SendMessage answers {task} or
 * {message}; GetTask answers the task itself. Errors pass through unchanged.
 */
export function toV1Response(v1Method: unknown, res: unknown): unknown {
  if (!isObj(res) || !isObj(res.result)) return res;
  const result = res.result;
  if (v1Method === 'GetTask') return { ...res, result: taskToV1(result) };
  if (result.kind === 'message') return { ...res, result: { message: messageToV1(result) } };
  return { ...res, result: { task: taskToV1(result) } };
}
