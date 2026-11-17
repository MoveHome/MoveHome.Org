import { describe, expect, it, vi } from 'vitest';
import type { Listing } from '@/lib/types';

const viewRows = [
  { agent_id: 'agent-a', logo_url: 'https://cdn.example/logo-a.png' },
  { agent_id: 'agent-b', logo_url: null }
];

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({ in: async () => ({ data: viewRows, error: null }) })
    })
  })
}));

import { withAgentLogos } from '@/lib/queries';

const listing = (agent_id: string): Listing =>
  ({ raia_id: `prop-gb-x-${agent_id}-0001`, agent_id, photos: [] }) as unknown as Listing;

describe('withAgentLogos', () => {
  it('maps the public agent view logo onto each listing', async () => {
    const out = await withAgentLogos([listing('agent-a'), listing('agent-b'), listing('agent-c')]);
    expect(out.map((l) => l.agent_logo_url)).toEqual([
      'https://cdn.example/logo-a.png',
      null,
      null
    ]);
  });
});
