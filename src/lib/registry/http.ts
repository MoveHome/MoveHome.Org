// Shared HTTP helpers for the public registry API: open CORS (agents call cross-
// origin), per-IP keys for rate limiting, and a short submitter hash (never the raw IP).

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

export const REGISTRY_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || req.headers.get('x-real-ip') || 'unknown';
}

export function ipKey(req: Request, prefix: string): string {
  return `${prefix}:${createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 32)}`;
}

// Short, non-reversible submitter tag stored on the row (audit without storing IPs).
export function ipHash(req: Request): string {
  return createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 16);
}

export function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(REGISTRY_CORS)) res.headers.set(k, v);
  return res;
}

export function corsJson(body: unknown, status = 200, extra?: Record<string, string>): NextResponse {
  return NextResponse.json(body, { status, headers: { ...REGISTRY_CORS, ...(extra ?? {}) } });
}
