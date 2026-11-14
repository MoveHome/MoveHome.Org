import { describe, expect, it } from 'vitest';
import { GET, OPTIONS } from '@/app/api/raia-card/route';

describe('GET /api/raia-card', () => {
  it('returns CORS OPTIONS response', () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns canonical RAIA Protocol discovery card JSON', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      schema_version: '0.3.0',
      agent_id: 'org-gb-movehome',
      name: 'Move Home Organisation CIC',
      companies_house_number: '17202438',
      max_data_level: 1,
      a2a_endpoint: 'https://movehome.org/api/a2a',
      mcp_endpoint: 'https://movehome.org/api/mcp',
      a2a_agent_card_url: '/.well-known/agent-card.json'
    });
  });
});
