// GET /api/registry/v1/healthz — liveness probe for the registry API itself.

import { NextResponse } from 'next/server';
import { REGISTRY_CORS, corsJson } from '@/lib/registry/http';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: REGISTRY_CORS });
}

export function GET() {
  return corsJson({ status: 'ok', service: 'movehome-a2a-registry', version: 'v1' });
}
