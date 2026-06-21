// Minimal, stateless MCP server over Streamable HTTP, implemented directly as a
// Next.js route handler (Web Request/Response) — no SDK, no sessions, no Redis.
// Clients POST JSON-RPC 2.0; we answer initialize / tools/list / tools/call / ping
// with a single application/json response. Read-only tools, open CORS.

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { enforceRateLimit, type EndpointGroup } from '@/lib/portal/rate-limit';

const MCP_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Authorization',
  'Access-Control-Max-Age': '86400'
};
const DEFAULT_PROTOCOL = '2025-06-18';

export interface McpContent {
  type: 'text';
  text: string;
}
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<{ content: McpContent[]; isError?: boolean }>;
}
export interface McpServerInfo {
  name: string;
  version: string;
  instructions?: string;
  rateLimitGroup: EndpointGroup;
}

interface JsonRpcMsg {
  jsonrpc?: string;
  method?: string;
  id?: unknown;
  params?: Record<string, unknown>;
}

function ipKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = fwd || req.headers.get('x-real-ip') || 'unknown';
  return `mcp:${createHash('sha256').update(ip).digest('hex').slice(0, 32)}`;
}

function rpc(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: MCP_CORS });
}
const ok = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export function mcpOptions(): NextResponse {
  return new NextResponse(null, { status: 204, headers: MCP_CORS });
}

// GET has no server→client SSE stream here; return a small descriptor so humans
// and probes get something useful (real MCP clients use POST).
export function mcpGetInfo(server: McpServerInfo, tools: McpTool[]): NextResponse {
  return rpc({
    service: server.name,
    version: server.version,
    transport: 'streamable-http (stateless)',
    usage: 'POST JSON-RPC 2.0 — methods: initialize, tools/list, tools/call',
    tools: tools.map((t) => t.name)
  });
}

export async function handleMcp(req: Request, server: McpServerInfo, tools: McpTool[]): Promise<Response> {
  try {
    const decision = await enforceRateLimit(ipKey(req), server.rateLimitGroup);
    if (!decision.ok) return rpc(fail(null, -32000, 'Rate limit exceeded.'), 429);
  } catch {
    /* limiter unavailable — fail open */
  }

  let msg: JsonRpcMsg;
  try {
    msg = (await req.json()) as JsonRpcMsg;
  } catch {
    return rpc(fail(null, -32700, 'Parse error.'));
  }
  if (Array.isArray(msg)) return rpc(fail(null, -32600, 'Batch requests are not supported.'));

  const { method, id, params } = msg;

  // Notifications (no id, e.g. notifications/initialized) — ack with 202, no body.
  if (typeof method === 'string' && msg.id === undefined) {
    return new NextResponse(null, { status: 202, headers: MCP_CORS });
  }

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      return rpc(
        ok(id, {
          protocolVersion: typeof requested === 'string' ? requested : DEFAULT_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: server.name, version: server.version },
          ...(server.instructions ? { instructions: server.instructions } : {})
        })
      );
    }
    case 'ping':
      return rpc(ok(id, {}));
    case 'tools/list':
      return rpc(ok(id, { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }));
    case 'tools/call': {
      const name = typeof params?.name === 'string' ? params.name : '';
      const tool = tools.find((t) => t.name === name);
      if (!tool) return rpc(fail(id, -32602, `Unknown tool: ${name}`));
      const args = (params?.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>;
      try {
        const result = await tool.handler(args);
        return rpc(ok(id, result));
      } catch (e) {
        // Tool failures are reported in-band (isError), not as JSON-RPC errors.
        return rpc(ok(id, { content: [{ type: 'text', text: `Tool error: ${e instanceof Error ? e.message : 'unknown'}` }], isError: true }));
      }
    }
    default:
      return rpc(fail(id, -32601, `Method not found: ${method}`));
  }
}
