import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/feed/undo-swipe/route';

const post = (body: unknown) =>
  POST(
    new Request('https://movehome.org/api/feed/undo-swipe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  );

describe('POST /api/feed/undo-swipe', () => {
  it('acknowledges a valid pass undo', async () => {
    const res = await post({ raia_id: 'prop-gb-rlf-000214', action: 'pass' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      raia_id: 'prop-gb-rlf-000214',
      action: 'pass',
      reverted: false
    });
  });

  it('rejects a missing raia_id or unknown action', async () => {
    expect((await post({ action: 'pass' })).status).toBe(400);
    expect((await post({ raia_id: 'prop-gb-rlf-000214', action: 'like' })).status).toBe(400);
  });
});
