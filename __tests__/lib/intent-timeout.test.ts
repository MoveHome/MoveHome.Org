import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runIntentPipeline } from '@/lib/intent';

// MUST-PASS: a hung model still completes inside the 1.2 s budget via the fallback.
describe('intent timeout fallback', () => {
  beforeEach(() => {
    process.env.RLF_GEMINI_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RLF_GEMINI_API_KEY;
  });

  it('aborts the model at the 1.2 s cap and keeps the fallback result', async () => {
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const started = Date.now();
    const result = await runIntentPipeline({ text: '2 bed Croydon £1400' });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(2000);
    expect(result).toMatchObject({ bedrooms: 2, rent_pcm: 1400, llm_used: false });
    expect(fetchMock).toHaveBeenCalledTimes(1); // one attempt, no retry in the path
  });

  it('treats a 429 as absent and falls back without a second call', async () => {
    const fetchMock = vi.fn(async () => new Response('quota', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runIntentPipeline({ text: '3 bed house £2100' });

    expect(result).toMatchObject({ bedrooms: 3, rent_pcm: 2100, property_type: 'house', llm_used: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
