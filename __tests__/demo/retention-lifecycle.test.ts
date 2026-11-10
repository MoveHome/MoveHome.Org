// ADR-476 D4: retraction is media-first and fail-closed. These tests drive the
// real retractListing against a fake Supabase client; no provider is touched.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  RETRACT_BUDGET_MS,
  retractListing,
  type RetractClient
} from '@/lib/demo/retract';

const MEDIA_KEYS = [
  'v1/l1/originals/a.jpg',
  'v1/l1/derivatives/a-320.jpg',
  'v1/l1/derivatives/deep/a-640.jpg',
  'v1/l1/thumbnails/b.jpg'
];

interface Fake {
  client: RetractClient;
  calls: string[];
  media: Set<string>;
  rpc: Record<string, unknown>;
}

// Mimics Supabase storage: one page holds immediate children only (folders have
// a null id), and the provider caps a page at `pageSize` rows.
function fakeClient(options: {
  keys?: string[];
  pageSize?: number;
  begin?: unknown;
  beginError?: { message: string } | null;
  finalize?: unknown;
  removeError?: string;
} = {}): Fake {
  const calls: string[] = [];
  const media = new Set(options.keys ?? MEDIA_KEYS);
  const pageSize = options.pageSize ?? 2;

  const client: RetractClient = {
    rpc(fn, args) {
      calls.push(`rpc:${fn}`);
      if (fn === 'demo_retract_begin') {
        return Promise.resolve({
          data: options.begin === undefined ? { id: String(args.p_id), venue_id: 'v1', media_prefix: 'v1/l1' } : options.begin,
          error: options.beginError ?? null
        });
      }
      if (fn === 'demo_retract_finalize') {
        return Promise.resolve({ data: options.finalize ?? true, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
    },
    storage: {
      from() {
        return {
          list(prefix: string, opts?: { limit?: number; offset?: number }) {
            calls.push(`list:${prefix}`);
            const children = new Map<string, { name: string; id: string | null; metadata: { size: number } | null }>();
            for (const key of [...media].filter((k) => k.startsWith(`${prefix}/`)).sort()) {
              const rest = key.slice(prefix.length + 1);
              const slash = rest.indexOf('/');
              const name = slash >= 0 ? rest.slice(0, slash) : rest;
              children.set(name, slash >= 0
                ? { name, id: null, metadata: null }
                : { name, id: `id-${key}`, metadata: { size: 10 } });
            }
            const all = [...children.values()];
            const offset = opts?.offset ?? 0;
            const limit = Math.min(opts?.limit ?? 100, pageSize);
            return Promise.resolve({ data: all.slice(offset, offset + limit), error: null });
          },
          remove(paths: string[]) {
            calls.push(`remove:${paths.length}`);
            if (options.removeError) {
              return Promise.resolve({ data: null, error: { message: options.removeError } });
            }
            for (const path of paths) media.delete(path);
            return Promise.resolve({ data: paths.length, error: null });
          }
        };
      }
    }
  };

  return { client, calls, media, rpc: {} };
}

describe('media-first retraction (ADR-476 D4)', () => {
  it('deletes nested and paginated originals plus derivatives, then finalizes', async () => {
    const fake = fakeClient({ pageSize: 2 });
    const result = await retractListing(fake.client, { venue_id: 'v1', id: 'l1', retract_code: '1234' });

    expect(result.retracted).toBe(true);
    if (!result.retracted) return;
    expect(result.media_removed).toBe(MEDIA_KEYS.length);
    expect([...fake.media]).toEqual([]);
    // Row is marked deleting BEFORE any storage call, and finalized last.
    expect(fake.calls[0]).toBe('rpc:demo_retract_begin');
    expect(fake.calls.at(-1)).toBe('rpc:demo_retract_finalize');
    // Nested prefixes were descended, not just listed once at the top level.
    expect(fake.calls.some((call) => call === 'list:v1/l1/derivatives')).toBe(true);
    expect(fake.calls.some((call) => call === 'list:v1/l1/derivatives/deep')).toBe(true);
  });

  it('never reports success when media deletion fails, and leaves the row pending', async () => {
    const fake = fakeClient({ removeError: 'storage refused' });
    const result = await retractListing(fake.client, { venue_id: 'v1', id: 'l1', retract_code: '1234' });

    expect(result.retracted).toBe(false);
    if (result.retracted) return;
    expect(result.reason).toBe('media_failed');
    expect(result.deletion_pending).toBe(true);
    expect(fake.calls).not.toContain('rpc:demo_retract_finalize');
    expect(fake.media.size).toBe(MEDIA_KEYS.length);
  });

  it('reports a pending deletion when the row cannot be finalized', async () => {
    const fake = fakeClient({ finalize: false });
    const result = await retractListing(fake.client, { venue_id: 'v1', id: 'l1', retract_code: '1234' });

    expect(result.retracted).toBe(false);
    if (result.retracted) return;
    expect(result.reason).toBe('finalize_failed');
    expect(result.deletion_pending).toBe(true);
  });

  it('refuses a wrong code or seeded row without touching storage', async () => {
    const fake = fakeClient({ begin: null });
    const result = await retractListing(fake.client, { venue_id: 'v1', id: 'l1', retract_code: '0000' });

    expect(result.retracted).toBe(false);
    if (result.retracted) return;
    expect(result.reason).toBe('refused');
    expect(result.deletion_pending).toBe(false);
    expect(fake.calls.some((call) => call.startsWith('list:'))).toBe(false);
  });

  it('surfaces an RPC error instead of claiming a retraction', async () => {
    const fake = fakeClient({ beginError: { message: 'permission denied' } });
    const result = await retractListing(fake.client, { venue_id: 'v1', id: 'l1', retract_code: '1234' });

    expect(result.retracted).toBe(false);
    if (result.retracted) return;
    expect(result.reason).toBe('error');
    expect(result.message).toContain('permission denied');
  });

  it('does not hang when the provider ignores pagination offsets', async () => {
    // A page that never advances would grow the inventory without bound.
    const calls: string[] = [];
    const client = {
      rpc: async (fn: string) =>
        fn === 'demo_retract_begin'
          ? { data: { id: 'l1', venue_id: 'v1', media_prefix: 'v1/l1' }, error: null }
          : { data: true, error: null },
      storage: {
        from: () => ({
          list: async () => {
            calls.push('list');
            return { data: [{ name: 'a.jpg', id: 'obj-1', metadata: { size: 1 } }], error: null };
          },
          remove: async () => ({ data: null, error: { message: 'refused' } })
        })
      }
    } as unknown as RetractClient;

    const result = await retractListing(client, { venue_id: 'v1', id: 'l1', retract_code: '1234' });
    expect(result.retracted).toBe(false);
    expect(calls.length).toBeLessThan(10);
  });

  it('keeps the 60 s interactive budget', async () => {
    vi.useFakeTimers();
    try {
      const slow = fakeClient();
      const original = slow.client.storage.from;
      slow.client.storage.from = () => ({
        list: () => new Promise(() => {}),
        remove: () => Promise.resolve({ data: null, error: null })
      });
      const pending = retractListing(slow.client, { venue_id: 'v1', id: 'l1', retract_code: '1234' });
      await vi.advanceTimersByTimeAsync(RETRACT_BUDGET_MS + 10);
      const result = await pending;
      expect(result.retracted).toBe(false);
      if (result.retracted) return;
      expect(result.reason).toBe('over_budget');
      expect(result.deletion_pending).toBe(true);
      expect(original).toBeTypeOf('function');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('retention clock and migration contract', () => {
  it('expires rows at 24 h and teardown at event_closed_at + 168 h', async () => {
    const sweep: any = await import(
      new URL('../../scripts/demo/retention-sweep.mjs', import.meta.url).href
    );
    const lib: any = await import(new URL('../../scripts/demo/teardown/lib.mjs', import.meta.url).href);

    expect(sweep.RETENTION_AFTER_MS).toBe(24 * 60 * 60 * 1000);
    expect(sweep.expiredAt('2026-11-13T18:00:00Z')).toBe('2026-11-14T18:00:00.000Z');
    expect(lib.deleteAfter('2026-11-13T18:00:00Z')).toBe('2026-11-20T18:00:00.000Z');
  });

  it('0015 removes the row-only 0010 machinery and gates projections', async () => {
    const path = fileURLToPath(new URL('../../supabase/migrations/0015_demo_retention_lifecycle.sql', import.meta.url));
    const sql = await readFile(path, 'utf8');

    expect(sql).toContain("cron.unschedule('demo-listings-ttl')");
    expect(sql).toContain("cron.unschedule('demo-teardown-t7')");
    expect(sql).toContain('drop function if exists public.demo_teardown()');
    expect(sql).toContain('drop function if exists public.demo_retract_listing(uuid, text)');
    expect(sql).toContain("deletion_state in ('live', 'deleting')");
    expect(sql).toContain("and l.deletion_state = 'live'");
    // Finalize must be scoped to a deleting row, never to any row.
    expect(sql).toMatch(/delete from public\.demo_listings\s+where id = p_id\s+and deletion_state = 'deleting'/);
    expect(sql).toContain('public.demo_media_manifest');
  });

  it('does not schedule a database-side T+7 teardown', async () => {
    const path = fileURLToPath(new URL('../../supabase/migrations/0015_demo_retention_lifecycle.sql', import.meta.url));
    const sql = await readFile(path, 'utf8');
    expect(sql).not.toMatch(/cron\.schedule\(/);
    expect(sql).not.toContain('drop schema');
    expect(sql).not.toContain('2026-11-20');
  });
});
