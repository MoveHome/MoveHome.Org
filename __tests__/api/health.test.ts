// The pin contract: /api/health must echo the deployment identity a custom alias
// is compared against, so a mismatch is caught before a demo goes live.
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  isConfigured: true,
  getSupabase: () => ({
    from: () => ({ select: () => ({ limit: async () => ({ error: null }) }) })
  })
}));

const { GET } = await import('@/app/api/health/route');

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/health', () => {
  it('reports ok, demo flag and the scheme-stripped deployment identity', async () => {
    vi.stubEnv('VERCEL_URL', 'https://movehome-demo-abc123-move-home.vercel.app');
    vi.stubEnv('DEMO_MODE', 'true');
    const body = await (await GET()).json();
    expect(body.status).toBe('ok');
    expect(body.demo).toBe(true);
    expect(body.deployment_url).toBe('movehome-demo-abc123-move-home.vercel.app');
  });

  it('is not a demo off the demo build', async () => {
    vi.stubEnv('DEMO_MODE', '');
    const body = await (await GET()).json();
    expect(body.demo).toBe(false);
  });
});
