// ADR-476 acceptance rail.
//   node scripts/demo/teardown/verify.mjs --fixture latest   # synthetic, 11 fixtures
//   node scripts/demo/teardown/verify.mjs --live <dir>       # re-verify an evidence bundle
// Synthetic green is not live proof; a live run needs the manifest and Eugin
// approval and lands in artifacts/expo-t7 (gitignored).
import { REQUIRED_EVIDENCE, verifyEvidence } from './lib.mjs';
import { FIXTURES, runFixture } from './fixtures.mjs';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function runFixtures() {
  const which = flag('--fixture');
  const selected = which === 'latest' || which === 'all' ? FIXTURES.map((f) => f.name) : [which];
  let passed = 0;
  for (const name of selected) {
    const result = await runFixture(name);
    passed += result.pass ? 1 : 0;
    console.log(
      `fixture ${result.pass ? 'PASS' : 'FAIL'} ${result.name} expected=${result.expected} actual=${result.status}${
        result.detail ? ` (${result.detail})` : ''
      }`
    );
  }
  if (passed !== FIXTURES.length || selected.length !== FIXTURES.length) {
    console.log(`TEARDOWN_CONTRACT_FAIL passed=${passed}/${FIXTURES.length}`);
    process.exit(1);
  }
  console.log(`TEARDOWN_CONTRACT_PASS fixtures=${passed}`);
  process.exit(0);
}

async function verifyBundle(dir) {
  const result = await verifyEvidence({ dir, required: REQUIRED_EVIDENCE });
  for (const check of result.checks) {
    console.log(`${check.status.padEnd(10)} ${check.check} ${check.detail ?? ''}`.trim());
  }
  console.log(`TEARDOWN_VERIFY_${result.status} dir=${dir}`);
  process.exit(result.status === 'PASS' ? 0 : 1);
}

if (argv.includes('--fixture')) await runFixtures();
else if (argv.includes('--live') || argv.includes('--dir')) await verifyBundle(flag('--live') ?? flag('--dir'));
else {
  console.error('verify: use --fixture latest, or --live <evidence-dir>');
  process.exit(2);
}
