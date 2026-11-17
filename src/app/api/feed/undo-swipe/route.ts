// POST /api/feed/undo-swipe — roll back the last pass/save on the swipe deck.
//
// Swipes are client-only today (saved ids live in localStorage, passes are not
// recorded), so there is no server row to delete. The route validates the
// payload and acknowledges; `reverted` is false until a swipe store exists.
import { NextResponse } from 'next/server';

const ACTIONS = new Set(['pass', 'save']);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { raia_id, action } = (body ?? {}) as { raia_id?: unknown; action?: unknown };
  if (typeof raia_id !== 'string' || !raia_id || !ACTIONS.has(String(action))) {
    return NextResponse.json(
      { error: 'raia_id and action (pass|save) are required' },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, raia_id, action, reverted: false });
}
