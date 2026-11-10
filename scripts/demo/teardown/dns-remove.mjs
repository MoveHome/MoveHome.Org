// Stage 6 — DNS_HOSTING. Only the `demo` CNAME goes. The production zone
// (@, www, NS, SOA, MX) is compared before and after, not assumed.
import { DEMO_FQDN, runStageCli } from './lib.mjs';

export async function run({ register, manifest, provider, now = new Date() }) {
  const checks = [];
  const push = (check, ok, detail) => checks.push({ check, ok: Boolean(ok), detail });

  const before = await provider.dns.records();
  const production = Object.fromEntries(Object.entries(before).filter(([host]) => host !== 'demo'));

  const domainsBefore = await provider.vercel.domains();
  if (domainsBefore.includes(DEMO_FQDN)) await provider.vercel.removeDomain(DEMO_FQDN);
  const domainsAfter = await provider.vercel.domains();
  push('vercel_demo_domain_absent', !domainsAfter.includes(DEMO_FQDN), domainsAfter.join(',') || 'none');

  const removal = await provider.dns.deleteRecord('demo');
  push('demo_cname_removed', removal?.ok === true, removal?.detail ?? String(removal?.ok));

  const after = await provider.dns.records();
  push('demo_cname_absent_authoritative', !('demo' in after), Object.keys(after).join(',') || 'empty');
  const productionAfter = Object.fromEntries(Object.entries(after).filter(([host]) => host !== 'demo'));
  const preserved =
    JSON.stringify(Object.keys(production).sort()) === JSON.stringify(Object.keys(productionAfter).sort()) &&
    Object.keys(production).every((host) => production[host] === productionAfter[host]);
  push('production_records_preserved', preserved, `${Object.keys(productionAfter).length} unchanged`);

  // Two independent resolvers, after the negative-cache window (D9 step 3).
  const resolverA = await provider.dns.resolve(DEMO_FQDN);
  const resolverB = await provider.dns.resolve(DEMO_FQDN);
  push('two_resolvers_nxdomain', resolverA === 'NXDOMAIN' && resolverB === 'NXDOMAIN', `${resolverA}/${resolverB}`);

  const status = checks.every((check) => check.ok) ? 'PASS' : 'FAIL';
  return {
    stage: 'DNS_HOSTING',
    status,
    ts: now.toISOString(),
    run_id: manifest.teardown_run_id,
    vercel: { demo_domain_present: domainsAfter.includes(DEMO_FQDN) },
    dns: { removed: 'demo', production_hosts: Object.keys(productionAfter), resolvers: [resolverA, resolverB] },
    negative_cache_wait: 'max(previous CNAME TTL, SOA negative TTL) + 15 min',
    checks
  };
}

export const ok = (result) => result.status === 'PASS';

if (typeof process !== 'undefined') {
  await runStageCli('DNS_HOSTING', 'dns-hosting.json', run, import.meta.url);
}
