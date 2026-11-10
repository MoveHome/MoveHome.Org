// ADR-476 D14/D15: the eleven synthetic fixtures are the acceptance contract.
// They run against the synthetic provider adapter only — no live mutation.
import { describe, expect, it } from 'vitest';

type Fixture = {
  name: string;
  expected: string;
  status: string;
  pass: boolean;
  detail: string;
  evidence_dir: string;
};

const EXPECTED_NAMES = [
  'production-target-rejection',
  'nested-paginated-media',
  'originals-derivatives-orphans',
  'media-failure-blocks-database-deletion',
  'honest-retract-pending',
  'telegram-revoke-not-webhook-deletion',
  'whatsapp-three-branches',
  'dns-production-records-preserved',
  'secret-redaction',
  'interrupted-run-incomplete',
  'hash-tamper-failure'
];

async function runAll(): Promise<{ fixtures: Fixture[]; module: any }> {
  const module: any = await import(
    new URL('../../scripts/demo/teardown/fixtures.mjs', import.meta.url).href
  );
  const fixtures: Fixture[] = [];
  for (const name of EXPECTED_NAMES) fixtures.push(await module.runFixture(name));
  return { fixtures, module };
}

describe('teardown contract fixtures (synthetic only)', () => {
  it('declares exactly eleven fixtures with the required names', async () => {
    const module: any = await import(
      new URL('../../scripts/demo/teardown/fixtures.mjs', import.meta.url).href
    );
    expect(module.FIXTURES.map((f: { name: string }) => f.name)).toEqual(EXPECTED_NAMES);
    expect(module.FIXTURES).toHaveLength(11);
  });

  it('passes all eleven with their expected verdicts', async () => {
    const { fixtures } = await runAll();
    const failed = fixtures.filter((fixture) => !fixture.pass);
    expect(failed.map((fixture) => `${fixture.name} (expected ${fixture.expected}, got ${fixture.status})`)).toEqual([]);
  }, 120_000);

  it('distinguishes PASS, FAIL and INCOMPLETE — an interrupted run is never PASS', async () => {
    const { fixtures } = await runAll();
    const byName = new Map(fixtures.map((fixture) => [fixture.name, fixture]));
    expect(byName.get('nested-paginated-media')?.status).toBe('PASS');
    expect(byName.get('production-target-rejection')?.status).toBe('FAIL');
    expect(byName.get('media-failure-blocks-database-deletion')?.status).toBe('FAIL');
    expect(byName.get('interrupted-run-incomplete')?.status).toBe('INCOMPLETE');
    expect(byName.get('hash-tamper-failure')?.status).toBe('FAIL');
    expect(byName.get('secret-redaction')?.status).toBe('PASS');
  }, 120_000);

  it('never uses a live provider in a fixture run', async () => {
    const { module } = await runAll();
    const scenario = await module.FIXTURES[1].build();
    expect(scenario.provider.kind).toBe('synthetic');
    const result = await module.runScenario(scenario);
    // Every provider operation is recorded on the synthetic adapter.
    expect(Array.isArray(result.provider.calls)).toBe(true);
    expect(result.provider.calls.every((call: { op: string }) => typeof call.op === 'string')).toBe(true);
  }, 120_000);

  it('states provider backup retention honestly instead of claiming erasure', async () => {
    const { module } = await runAll();
    const scenario = await module.FIXTURES[1].build();
    const result = await module.runScenario(scenario);
    const media = result.files['media-summary.json'];
    expect(media.objects_after).toBe(0);
    expect(['PROVIDER_RETAINED', 'EXPIRED', 'UNKNOWN']).toContain(media.backup_retention);
  }, 120_000);
});
