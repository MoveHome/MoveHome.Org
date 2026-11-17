import { describe, expect, it } from 'vitest';
import { classifyGesture } from '@/lib/gesture';

describe('classifyGesture', () => {
  it('classifies taps when movement is under 15px', () => {
    expect(classifyGesture({ dx: 0, dy: 0 })).toBe('tap');
    expect(classifyGesture({ dx: 10, dy: -10 })).toBe('tap');
    expect(classifyGesture({ dx: -14, dy: 14 })).toBe('tap');
  });

  it('classifies horizontal swipes (Pass / Save) when |dx| >= 75px and |dx| >= |dy|', () => {
    expect(classifyGesture({ dx: -75, dy: 0 })).toBe('pass');
    expect(classifyGesture({ dx: -100, dy: 30 })).toBe('pass');
    expect(classifyGesture({ dx: 75, dy: 0 })).toBe('save');
    expect(classifyGesture({ dx: 120, dy: -50 })).toBe('save');
  });

  it('classifies vertical swipes (Next / Prev property) when |dy| >= 70px and |dy| > |dx|', () => {
    expect(classifyGesture({ dx: 0, dy: -70 })).toBe('next_property');
    expect(classifyGesture({ dx: 20, dy: -80 })).toBe('next_property');
    expect(classifyGesture({ dx: 0, dy: 70 })).toBe('prev_property');
    expect(classifyGesture({ dx: -30, dy: 90 })).toBe('prev_property');
  });

  it('classifies a fast flick even when it falls short of the distance threshold', () => {
    expect(classifyGesture({ dx: -30, dy: 5, vx: -0.8 })).toBe('pass');
    expect(classifyGesture({ dx: 30, dy: -5, vx: 1.2 })).toBe('save');
    expect(classifyGesture({ dx: 5, dy: -30, vy: -0.9 })).toBe('next_property');
    expect(classifyGesture({ dx: -5, dy: 30, vy: 0.7 })).toBe('prev_property');
  });

  it('returns none when movement exceeds tap threshold but does not reach swipe threshold', () => {
    expect(classifyGesture({ dx: 30, dy: 30 })).toBe('none');
    expect(classifyGesture({ dx: 60, dy: 0, vx: 0.2 })).toBe('none');
    expect(classifyGesture({ dx: 0, dy: -60, vy: -0.1 })).toBe('none');
  });
});
