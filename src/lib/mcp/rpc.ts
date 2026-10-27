// Pure JSON-RPC 2.0 envelope validation for the Streamable HTTP MCP handlers.
// No imports on purpose: scripts/mcp-rpc-selftest.mjs runs this file directly under node.

export interface RpcMessage {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export type RpcParse =
  | { ok: true; msg: RpcMessage }
  | { ok: false; id: unknown; code: number; message: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseRpc(body: unknown): RpcParse {
  if (Array.isArray(body)) return { ok: false, id: null, code: -32600, message: 'Batch requests are not supported.' };
  if (!isObj(body)) return { ok: false, id: null, code: -32600, message: 'Invalid Request: body must be a JSON object.' };

  const { jsonrpc, method, id, params } = body;
  if (jsonrpc !== '2.0') return { ok: false, id: null, code: -32600, message: 'Invalid Request: jsonrpc must be "2.0".' };
  if (typeof method !== 'string' || method === '') {
    return { ok: false, id: null, code: -32600, message: 'Invalid Request: method must be a non-empty string.' };
  }
  const idOk = id === undefined || id === null || typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
  if (!idOk) return { ok: false, id: null, code: -32600, message: 'Invalid Request: id must be a string, a finite number, or null.' };
  if (params !== undefined && params !== null && !isObj(params)) {
    return { ok: false, id: id ?? null, code: -32602, message: 'Invalid params: params must be an object.' };
  }

  return {
    ok: true,
    msg: {
      jsonrpc: '2.0',
      method,
      id: id as RpcMessage['id'],
      params: (params ?? undefined) as RpcMessage['params']
    }
  };
}
