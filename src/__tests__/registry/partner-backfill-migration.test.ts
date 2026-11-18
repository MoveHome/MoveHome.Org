// Migration 0020 invariants: the live partner cards are backfilled to public
// BEFORE the 404 publication gate ships, while the unclaimed test cards stay
// staged. Text-level assertions only — the migration is applied to prod by hand,
// so CI guards the file, not the database.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = join(
  process.cwd(),
  'supabase/migrations/0020_partner_registry_backfill.sql'
);
const sql = readFileSync(MIGRATION, 'utf8');
const lines = sql.split('\n');

const PARTNER_IDS = ['org-gb-rlf', 'org-gb-07798821', 'org-th-0105561135324'];

describe('0020_partner_registry_backfill.sql', () => {
  it.each(PARTNER_IDS)('publishes partner %s', (id) => {
    expect(sql).toContain(id);
  });

  it('publishes rows in tbl_a2a_registry and approves them in tbl_raia_agent_registry', () => {
    expect(sql).toMatch(/UPDATE public\.tbl_a2a_registry\s+SET status\s+= 'listed'/);
    expect(sql).toMatch(/publication_status = 'published'/);
    expect(sql).toMatch(/claimed_at\s+= COALESCE\(claimed_at, now\(\)\)/);
    expect(sql).toMatch(/UPDATE public\.tbl_raia_agent_registry\s+SET verification_status = 'approved'/);
  });

  it('never promotes the unclaimed test cards in any single statement line', () => {
    // Same predicate as /root/.hermes/scripts/verify/probes/t_mh_partner_backfill_probe.sh.
    expect(sql).not.toMatch(/throne.*published/i);
    expect(sql).not.toMatch(/shannon.*published/i);
  });

  it('keeps throne and shannon staged and hidden', () => {
    const guard = lines.findIndex((l) => l.includes("IN ('throne', 'shannon')"));
    expect(guard).toBeGreaterThan(-1);
    const statement = lines.slice(guard - 5, guard + 3).join('\n');
    expect(statement).toMatch(/publication_status = 'staged'/);
    expect(statement).toMatch(/hidden\s+= true/);
  });

  it('is idempotent: inserts are keyed with ON CONFLICT DO UPDATE', () => {
    const inserts = sql.match(/INSERT INTO public\.tbl_a2a_registry/g) ?? [];
    const upserts = sql.match(/ON CONFLICT \(slug\) DO UPDATE/g) ?? [];
    expect(inserts.length).toBe(2);
    expect(upserts.length).toBe(inserts.length);
  });
});
