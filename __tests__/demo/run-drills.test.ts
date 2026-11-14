import { describe, expect, it } from 'vitest';
import { runD1, runD2, runD3, runD4, runD5, runD6, runD7, runD8 } from '../../scripts/demo/run-drills';

describe('fault injection drills runner (dry-run)', () => {
  it('runs all 8 drills hermetically and returns passing results', async () => {
    const d1 = await runD1(true);
    expect(d1.pass).toBe(true);
    expect(d1.drill_id).toBe('d1-tv-socket-kill');

    const d2 = await runD2(true);
    expect(d2.pass).toBe(true);
    expect(d2.drill_id).toBe('d2-rls-fanout-mismatch');

    const d3 = await runD3(true);
    expect(d3.pass).toBe(true);

    const d4 = await runD4(true);
    expect(d4.pass).toBe(true);

    const d5 = await runD5(true);
    expect(d5.pass).toBe(true);

    const d6 = await runD6(true);
    expect(d6.pass).toBe(true);

    const d7 = await runD7(true);
    expect(d7.pass).toBe(true);

    const d8 = await runD8(true);
    expect(d8.pass).toBe(true);
  });
});
