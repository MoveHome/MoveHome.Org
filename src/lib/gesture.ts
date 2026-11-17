export type GestureIntent = 'tap' | 'pass' | 'save' | 'next_property' | 'prev_property' | 'none';

export interface GestureParams {
  dx: number;
  dy: number;
  tapMax?: number; // default 15px
  swipeMin?: number; // default 65px
}

export function classifyGesture({
  dx,
  dy,
  tapMax = 15,
  swipeMin = 65
}: GestureParams): GestureIntent {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX < tapMax && absY < tapMax) {
    return 'tap';
  }

  if (absX >= absY) {
    if (dx <= -swipeMin) return 'pass';
    if (dx >= swipeMin) return 'save';
  } else {
    if (dy <= -swipeMin) return 'next_property';
    if (dy >= swipeMin) return 'prev_property';
  }

  return 'none';
}
