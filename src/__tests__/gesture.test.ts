import { describe, expect, it } from 'vitest';
import { classifyGesture } from '@/lib/gesture';

describe('classifyGesture', () => {
  it('classifies taps when movement is under 15px', () => {
    expect(classifyGesture({ dx: 0, dy: 0 })).toBe('tap');
    expect(classifyGesture({ dx: 10, dy: -10 })).toBe('tap');
    expect(classifyGesture({ dx: -14, dy: 14 })).toBe('tap');
  });

  it('classifies horizontal swipes (Pass / Save) when |dx| >= 65px and |dx| >= |dy|', () => {
    expect(classifyGesture({ dx: -65, dy: 0 })).toBe('pass');
    expect(classifyGesture({ dx: -100, dy: 30 })).toBe('pass');
    expect(classifyGesture({ dx: 65, dy: 0 })).toBe('save');
    expect(classifyGesture({ dx: 120, dy: -50 })).toBe('save');
  });

  it('classifies vertical swipes (Next / Prev property) when |dy| >= 65px and |dy| > |dx|', () => {
    expect(classifyGesture({ dx: 0, dy: -65 })).toBe('next_property');
    expect(classifyGesture({ dx: 20, dy: -80 })).toBe('next_property');
    expect(classifyGesture({ dx: 0, dy: 65 })).toBe('prev_property');
    expect(classifyGesture({ dx: -30, dy: 90 })).toBe('prev_property');
  });

  it('returns none when movement exceeds tap threshold but does not reach swipe threshold', () => {
    expect(classifyGesture({ dx: 30, dy: 30 })).toBe('none');
    expect(classifyGesture({ dx: 60, dy: 0 })).toBe('none');
    expect(classifyGesture({ dx: 0, dy: -60 })).toBe('none');
  });
});
