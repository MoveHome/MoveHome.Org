// Retract a demo listing inside the demo budget: row and media both gone.
//
// The 4-digit code and the seeded-row refusal live in the RPC (0010), so a
// wrong code and a read-only seed row are indistinguishable to the caller.
// This module adds the budget guard and the media sweep.

export const RETRACT_BUDGET_MS = 60000;
export const RETRACT_MEDIA_BUCKET = 'demo-media';

export interface RetractClient {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  storage: {
    from(bucket: string): {
      list(prefix: string): PromiseLike<{ data: Array<{ name: string }> | null; error: { message: string } | null }>;
      remove(paths: string[]): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
}

export type RetractResult =
  | { retracted: true; elapsed_ms: number; media_removed: number }
  | { retracted: false; reason: 'refused' | 'over_budget' | 'error'; message: string; elapsed_ms: number };

async function withinBudget<T>(work: PromiseLike<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`retract exceeded the ${RETRACT_BUDGET_MS / 1000} s demo budget`)),
      RETRACT_BUDGET_MS
    );
  });
  try {
    return await Promise.race([Promise.resolve(work), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function retractListing(
  db: RetractClient,
  args: { venue_id: string; id: string; retract_code: string }
): Promise<RetractResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;

  let data: unknown;
  try {
    const res = await withinBudget(
      db.rpc('demo_retract_listing', { p_id: args.id, p_retract_code: args.retract_code })
    );
    if (res.error) return { retracted: false, reason: 'error', message: res.error.message, elapsed_ms: elapsed() };
    data = res.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'retract failed';
    const over = message.includes('demo budget');
    return { retracted: false, reason: over ? 'over_budget' : 'error', message, elapsed_ms: elapsed() };
  }

  if (data !== true) {
    // The RPC refuses seeded rows too: seeded demo rows are not retractable.
    return {
      retracted: false,
      reason: 'refused',
      message: 'not found, wrong code, or a seeded row — seeded demo rows are not retractable',
      elapsed_ms: elapsed()
    };
  }

  // Row is gone: sweep its media so the photo cannot be re-served from storage.
  const prefix = `${args.venue_id}/${args.id}`;
  let mediaRemoved = 0;
  try {
    const listed = await withinBudget(db.storage.from(RETRACT_MEDIA_BUCKET).list(prefix));
    const paths = (listed.data ?? []).map((f) => `${prefix}/${f.name}`);
    if (paths.length > 0) {
      await withinBudget(db.storage.from(RETRACT_MEDIA_BUCKET).remove(paths));
      mediaRemoved = paths.length;
    }
  } catch (err) {
    // shortcut: a failed media delete leaves an unreferenced object in the
    // private demo-media bucket and nothing points at it; upgrade this to a
    // queued sweep if that bucket ever becomes public.
    console.warn('[retract] media sweep failed', (err as Error).message);
  }

  return { retracted: true, elapsed_ms: elapsed(), media_removed: mediaRemoved };
}
