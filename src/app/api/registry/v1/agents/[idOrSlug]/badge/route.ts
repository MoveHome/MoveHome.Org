// GET /api/registry/v1/agents/{id|slug}/badge — embeddable shields-style SVG.
// Embed: <img src="https://movehome.org/api/registry/v1/agents/<slug>/badge" alt="A2A registry">
// The label + status strings are a fixed set (never agent-supplied), so no SVG injection.

import { NextResponse } from 'next/server';
import { getAgent } from '@/lib/registry/store';

export const dynamic = 'force-dynamic';

const LABEL = 'a2a registry';
const LABEL_W = 84;

function badge(status: string, color: string): string {
  const valueW = Math.max(46, status.length * 7 + 18);
  const w = LABEL_W + valueW;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${LABEL}: ${status}">
  <rect width="${w}" height="20" rx="3" fill="#555"/>
  <rect x="${LABEL_W}" width="${valueW}" height="20" rx="3" fill="${color}"/>
  <rect x="${LABEL_W}" width="6" height="20" fill="${color}"/>
  <g fill="#fff" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11" text-anchor="middle">
    <text x="${LABEL_W / 2}" y="14">${LABEL}</text>
    <text x="${LABEL_W + valueW / 2}" y="14">${status}</text>
  </g>
</svg>`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ idOrSlug: string }> }) {
  const { idOrSlug } = await params;
  const a = await getAgent(idOrSlug).catch(() => null);

  let status = 'not found';
  let color = '#9f9f9f';
  if (a) {
    if (a.is_healthy === true) { status = 'healthy'; color = '#2ea44f'; }
    else if (a.is_healthy === false) { status = 'unhealthy'; color = '#e05d44'; }
    else { status = 'listed'; color = '#007ec6'; }
  }

  return new NextResponse(badge(status, color), {
    status: a ? 200 : 404,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
