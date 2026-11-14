// Serves MoveHome's canonical RAIA Protocol discovery card at /.well-known/raia.json
// (rewritten in next.config.js from /api/raia-card).

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export function GET() {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://movehome.org').replace(/\/$/, '');

  const raiaCard = {
    schema_version: '0.3.0',
    agent_id: 'org-gb-movehome',
    name: 'Move Home Organisation CIC',
    companies_house_number: '17202438',
    max_data_level: 1,
    a2a_endpoint: `${siteUrl}/api/a2a`,
    mcp_endpoint: `${siteUrl}/api/mcp`,
    a2a_agent_card_url: '/.well-known/agent-card.json'
  };

  return NextResponse.json(raiaCard, {
    status: 200,
    headers: { ...CORS, 'Cache-Control': 'public, max-age=300' }
  });
}
