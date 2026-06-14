// A2A (Agent2Agent) JSON-RPC endpoint for MoveHome.org, backed by @a2a-js/sdk.
//
//   POST /api/a2a    — JSON-RPC 2.0 (message/send, tasks/get, …) via the SDK
//   GET  /api/a2a    — returns the Agent Card (discovery convenience)
//   OPTIONS          — CORS preflight (the endpoint is open to anonymous agents)
//
// The SDK's DefaultRequestHandler + JsonRpcTransportHandler own protocol parsing,
// validation, and error mapping; MoveHomeAgentExecutor supplies the behaviour and
// InMemoryTaskStore holds tasks for the lifetime of the (synchronous) request.

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  JsonRpcTransportHandler
} from '@a2a-js/sdk/server';
import { buildAgentCard } from '@/lib/a2a/card';
import { signAgentCard } from '@/lib/a2a/card-signing';
import { moveHomeExecutor } from '@/lib/a2a/executor';
import { enforceRateLimit, rateLimitHeaders } from '@/lib/portal/rate-limit';

export const dynamic = 'force-dynamic';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

// Lazily built once per server instance (avoids reading env at build time). The
// card is signed (when a signing key is configured) so the SDK's card endpoint and
// our GET serve the same verifiable card.
let transport: Promise<JsonRpcTransportHandler> | null = null;
function getTransport(): Promise<JsonRpcTransportHandler> {
  if (!transport) {
    transport = (async () => {
      const handler = new DefaultRequestHandler(
        await signAgentCard(buildAgentCard()),
        new InMemoryTaskStore(),
        moveHomeExecutor
      );
      return new JsonRpcTransportHandler(handler);
    })();
  }
  return transport;
}

function json(body: unknown, status = 200, extra?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { ...CORS_HEADERS, ...(extra ?? {}) } });
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id: id ?? null, error: { code, message } };
}

function requestId(raw: unknown): string | number | null {
  const id = (raw as { id?: unknown })?.id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

function isAsyncGenerator(v: unknown): v is AsyncGenerator<unknown> {
  return typeof v === 'object' && v !== null && Symbol.asyncIterator in v;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export function GET() {
  return json(buildAgentCard());
}

// Best-effort per-IP rate limit. Fails open if the limiter store is unavailable
// (e.g. local dev without Supabase env) — discovery/search stay usable.
async function checkRateLimit(
  req: Request
): Promise<{ ok: boolean; headers: Record<string, string>; retryAfter: number }> {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = fwd || req.headers.get('x-real-ip') || 'unknown';
  const ipKey = `a2a:${createHash('sha256').update(ip).digest('hex').slice(0, 32)}`;
  try {
    const decision = await enforceRateLimit(ipKey, 'a2a');
    return { ok: decision.ok, headers: rateLimitHeaders(decision), retryAfter: decision.retryAfter };
  } catch {
    return { ok: true, headers: {}, retryAfter: 0 };
  }
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json(rpcError(null, -32700, 'Invalid JSON.'), 400);
  }

  const rl = await checkRateLimit(req);
  if (!rl.ok) {
    return json(rpcError(requestId(raw), -32603, 'Rate limit exceeded.'), 429, {
      ...rl.headers,
      'Retry-After': String(rl.retryAfter)
    });
  }

  try {
    const result = await (await getTransport()).handle(raw);
    if (isAsyncGenerator(result)) {
      // Streaming (message/stream, tasks/resubscribe) is not supported.
      return json(rpcError(requestId(raw), -32004, 'Streaming is not supported; use message/send.'), 200, rl.headers);
    }
    // Scrub internal-error detail so raw exception text never reaches clients.
    const err = (result as { error?: { code?: number; message?: string } }).error;
    if (err && err.code === -32603) {
      console.error('[a2a] internal error', err.message);
      err.message = 'Internal error.';
    }
    return json(result, 200, rl.headers);
  } catch (e) {
    // The SDK normally returns JSON-RPC errors rather than throwing; surface a
    // structured error either way (use the A2AError code when present).
    const code = e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'number'
      ? (e as { code: number }).code
      : -32603;
    const message =
      code === -32603 ? 'Internal error.' : String((e as { message?: unknown }).message ?? 'Error');
    if (code === -32603) console.error('[a2a] transport error', e);
    return json(rpcError(requestId(raw), code, message), 200, rl.headers);
  }
}
