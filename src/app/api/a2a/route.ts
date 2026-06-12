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
import { moveHomeExecutor } from '@/lib/a2a/executor';
import { enforceRateLimit, rateLimitHeaders } from '@/lib/portal/rate-limit';

export const dynamic = 'force-dynamic';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

// Lazily built once per server instance (avoids reading env at build time).
let transport: JsonRpcTransportHandler | null = null;
function getTransport(): JsonRpcTransportHandler {
  if (!transport) {
    const handler = new DefaultRequestHandler(
      buildAgentCard(),
      new InMemoryTaskStore(),
      moveHomeExecutor
    );
    transport = new JsonRpcTransportHandler(handler);
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

// Detect a create_enquiry invocation in a raw message/send body. The enquiry
// skill is a write that emails a real estate agent, so it gets a tighter
// per-IP throttle than the 60/min the read skills share.
const ENQUIRY_PER_MIN = 5;
function isCreateEnquiry(raw: unknown): boolean {
  const r = raw as { method?: unknown; params?: { message?: { parts?: unknown } } };
  if (r?.method !== 'message/send') return false;
  const parts = r.params?.message?.parts;
  if (!Array.isArray(parts)) return false;
  return parts.some(
    (p) =>
      p && typeof p === 'object' && (p as { kind?: unknown }).kind === 'data' &&
      (p as { data?: { skill?: unknown } }).data?.skill === 'create_enquiry'
  );
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || req.headers.get('x-real-ip') || 'unknown';
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

  // Extra throttle for the one write skill. Reads already passed the 60/min
  // bucket above; enquiries get a tighter per-IP cap on top. Fails open.
  if (isCreateEnquiry(raw)) {
    try {
      const ipKey = `a2a-enquiry:${createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 32)}`;
      const decision = await enforceRateLimit(ipKey, 'enquiry.write', ENQUIRY_PER_MIN);
      if (!decision.ok) {
        return json(rpcError(requestId(raw), -32603, 'Enquiry rate limit exceeded.'), 429, {
          ...rateLimitHeaders(decision),
          'Retry-After': String(decision.retryAfter)
        });
      }
    } catch {
      /* limiter unavailable — fail open */
    }
  }

  try {
    const result = await getTransport().handle(raw);
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
