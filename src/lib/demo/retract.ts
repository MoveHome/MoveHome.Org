// Retract a demo listing inside the demo budget: media first, row second.
//
// ADR-476 D4: the row is marked `deleting` (gone from every projection) before
// any storage call. Media is enumerated recursively and deleted in batches;
// only an empty readback may finalize the row. A media failure leaves a
// non-public `deleting` row for the retention worker to retry — it never
// returns an unqualified success and never reports `media_removed: 0` as done.

export const RETRACT_BUDGET_MS = 60000;
export const RETRACT_MEDIA_BUCKET = 'demo-media';
const PAGE_SIZE = 100;
const REMOVE_BATCH = 100;
const MAX_ROUNDS = 25;

interface StorageEntry {
  name: string;
  id?: string | null;
  metadata?: { size?: number } | null;
}

export interface RetractClient {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  storage: {
    from(bucket: string): {
      list(
        prefix: string,
        options?: { limit?: number; offset?: number }
      ): PromiseLike<{ data: StorageEntry[] | null; error: { message: string } | null }>;
      remove(paths: string[]): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
}

export type RetractResult =
  | { retracted: true; elapsed_ms: number; media_removed: number }
  | {
      retracted: false;
      reason: 'refused' | 'over_budget' | 'media_failed' | 'finalize_failed' | 'error';
      message: string;
      elapsed_ms: number;
      // True when the row is left non-public for the retention worker.
      deletion_pending: boolean;
    };

export interface RetractBegin {
  id: string;
  venue_id: string;
  media_prefix: string;
}

// Lists every object under `prefix`, descending nested prefixes and following
// pagination to the end. One top-level list() call is not enumeration.
async function listTree(
  client: RetractClient,
  prefix: string,
  guard: <T>(work: PromiseLike<T>) => Promise<T>
): Promise<string[]> {
  const found: string[] = [];
  const queue = [prefix];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const seen = new Set<string>();
    let offset = 0;
    for (let page = 0; page < 10000; page += 1) {
      const listed = await guard(
        client.storage.from(RETRACT_MEDIA_BUCKET).list(current, { limit: PAGE_SIZE, offset })
      );
      if (listed.error) throw new Error(listed.error.message);
      const entries = listed.data ?? [];
      if (entries.length === 0) break;
      let fresh = 0;
      for (const entry of entries) {
        const path = `${current}/${entry.name}`;
        if (seen.has(path)) continue;
        seen.add(path);
        fresh += 1;
        // Supabase reports folders with a null id and no metadata.
        if (entry.id === null || entry.id === undefined) queue.push(path);
        else found.push(path);
      }
      // A provider that ignores `offset` returns the same page forever: stop
      // instead of growing the inventory without bound.
      if (fresh === 0) break;
      offset += entries.length;
    }
  }
  return found;
}

async function deleteTree(
  client: RetractClient,
  prefix: string,
  guard: <T>(work: PromiseLike<T>) => Promise<T>
): Promise<{ removed: number; objects_after: number }> {
  let removed = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const objects = await listTree(client, prefix, guard);
    if (objects.length === 0) return { removed, objects_after: 0 };
    for (let i = 0; i < objects.length; i += REMOVE_BATCH) {
      const batch = objects.slice(i, i + REMOVE_BATCH);
      const result = await guard(client.storage.from(RETRACT_MEDIA_BUCKET).remove(batch));
      if (result.error) throw new Error(result.error.message);
      removed += batch.length;
    }
  }
  // Non-zero remainder: report it rather than claiming the prefix is empty.
  const left = await listTree(client, prefix, guard);
  return { removed, objects_after: left.length };
}

export async function retractListing(
  db: RetractClient,
  args: { venue_id: string; id: string; retract_code: string }
): Promise<RetractResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;

  // Every storage/RPC call shares the one 60 s interactive budget.
  function guard<T>(work: PromiseLike<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const remaining = Math.max(1, RETRACT_BUDGET_MS - elapsed());
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`retract exceeded the ${RETRACT_BUDGET_MS / 1000} s demo budget`)),
        remaining
      );
    });
    return Promise.race([Promise.resolve(work), deadline]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  const failure = (
    reason: 'refused' | 'over_budget' | 'media_failed' | 'finalize_failed' | 'error',
    message: string
  ): RetractResult => ({
    retracted: false,
    reason,
    message,
    elapsed_ms: elapsed(),
    deletion_pending: reason !== 'refused'
  });

  let begun: { data: unknown; error: { message: string } | null };
  try {
    begun = await guard(
      db.rpc('demo_retract_begin', { p_id: args.id, p_retract_code: args.retract_code })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'retract failed';
    return failure(message.includes('demo budget') ? 'over_budget' : 'error', message);
  }
  if (begun.error) return failure('error', begun.error.message);

  const begin = begun.data as RetractBegin | null;
  if (!begin) {
    // The RPC refuses wrong codes, seeded rows and already-deleting rows alike.
    return failure('refused', 'not found, wrong code, or a seeded row — seeded demo rows are not retractable');
  }

  const prefix = begin.media_prefix || `${args.venue_id}/${args.id}`;
  let mediaRemoved = 0;
  try {
    const swept = await deleteTree(db, prefix, guard);
    mediaRemoved = swept.removed;
    if (swept.objects_after !== 0) throw new Error(`${swept.objects_after} media object(s) remain`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'media sweep failed';
    // Row stays `deleting` (non-public) and the retention worker retries it.
    return failure(message.includes('demo budget') ? 'over_budget' : 'media_failed', message);
  }

  try {
    const finalized = await guard(db.rpc('demo_retract_finalize', { p_id: args.id }));
    if (finalized.error) return failure('finalize_failed', finalized.error.message);
    if (finalized.data !== true) return failure('finalize_failed', 'row was not in a deletable state');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'finalize failed';
    return failure(message.includes('demo budget') ? 'over_budget' : 'finalize_failed', message);
  }

  return { retracted: true, elapsed_ms: elapsed(), media_removed: mediaRemoved };
}
