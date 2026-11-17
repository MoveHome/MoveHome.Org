export type GestureIntent = 'tap' | 'pass' | 'save' | 'next_property' | 'prev_property' | 'none';

export interface GestureParams {
  dx: number;
  dy: number;
  vx?: number; // px/ms, positive = right
  vy?: number; // px/ms, positive = down
  tapMax?: number; // default 15px
  swipeMinX?: number; // default 75px
  swipeMinY?: number; // default 70px
  flickMin?: number; // default 0.5px/ms — commit on speed even short of the distance
}

export function classifyGesture({
  dx,
  dy,
  vx = 0,
  vy = 0,
  tapMax = 15,
  swipeMinX = 75,
  swipeMinY = 70,
  flickMin = 0.5
}: GestureParams): GestureIntent {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX < tapMax && absY < tapMax) {
    return 'tap';
  }

  if (absX >= absY) {
    if (absX < swipeMinX && Math.abs(vx) < flickMin) return 'none';
    return dx < 0 ? 'pass' : 'save';
  }

  if (absY < swipeMinY && Math.abs(vy) < flickMin) return 'none';
  return dy < 0 ? 'next_property' : 'prev_property';
}
