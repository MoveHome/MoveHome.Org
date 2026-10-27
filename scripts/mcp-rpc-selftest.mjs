// Self-check for the JSON-RPC envelope rules in src/lib/mcp/rpc.ts:
//   node scripts/mcp-rpc-selftest.mjs
import assert from 'node:assert/strict';
import { parseRpc } from '../src/lib/mcp/rpc.ts';

const good = (body, expect) => assert.deepEqual(pick(parseRpc(body)), expect);
const pick = (r) => (r.ok ? { ok: true, method: r.msg.method, id: r.msg.id } : { ok: false, code: r.code, id: r.id });

good({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, { ok: true, method: 'initialize', id: 1 });
good({ jsonrpc: '2.0', id: 'abc', method: 'ping' }, { ok: true, method: 'ping', id: 'abc' });
good({ jsonrpc: '2.0', id: 0, method: 'tools/list', params: null }, { ok: true, method: 'tools/list', id: 0 });
good({ jsonrpc: '2.0', method: 'notifications/initialized' }, { ok: true, method: 'notifications/initialized', id: undefined });

good(null, { ok: false, code: -32600, id: null });
good([], { ok: false, code: -32600, id: null });
good('hi', { ok: false, code: -32600, id: null });
good({ id: 1, method: 'ping' }, { ok: false, code: -32600, id: null });
good({ jsonrpc: '1.0', id: 1, method: 'ping' }, { ok: false, code: -32600, id: null });
good({ jsonrpc: '2.0', id: 1 }, { ok: false, code: -32600, id: null });
good({ jsonrpc: '2.0', id: 1, method: '' }, { ok: false, code: -32600, id: null });
good({ jsonrpc: '2.0', id: {}, method: 'ping' }, { ok: false, code: -32600, id: null });
good({ jsonrpc: '2.0', id: NaN, method: 'ping' }, { ok: false, code: -32600, id: null });
good({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: [1, 2] }, { ok: false, code: -32602, id: 7 });
good({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: 'x' }, { ok: false, code: -32602, id: 7 });

console.log('PASS mcp-rpc-selftest');
