// Publication gate for the /agent/<id> directory surfaces. A directory entity is
// public only if the database says so:
//   - tbl_raia_agent_registry: verification_status = 'approved' AND revoked_at IS NULL
//   - tbl_a2a_registry: listed + not hidden + publication_status = 'published',
//     keyed by raw_card->>'agent_id' (that is how the seeded/backfilled rows carry
//     the entity id, see supabase/migrations/0020_partner_registry_backfill.sql)
// Both are checked because partners are published in one or the other (org-gb-rlf
// has no RAIA row). Fails closed on any DB error so an outage cannot leak a staged
// card, and logs one warning per entity id.

import { createSupabaseAdminClient } from '@/lib/supabase-admin';

// Entity ids come straight off the URL and go into a PostgREST filter.
const ENTITY_ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional type erasure (see store.ts)
type AnyBuilder = any;

const warned = new Set<string>();

export async function isDirectoryEntityPublic(entityId: string): Promise<boolean> {
  if (!ENTITY_ID_RE.test(entityId ?? '')) return false;
  try {
    const admin = createSupabaseAdminClient() as unknown as { from: (n: string) => AnyBuilder };
    const [raia, a2a] = await Promise.all([
      admin
        .from('tbl_raia_agent_registry')
        .select('verification_status, revoked_at')
        .eq('agent_id', entityId)
        .maybeSingle(),
      admin
        .from('tbl_a2a_registry')
        .select('id')
        .eq('status', 'listed')
        .eq('hidden', false)
        .eq('publication_status', 'published')
        .eq('raw_card->>agent_id', entityId)
        // limit(1), not maybeSingle(): two published rows sharing an agent_id
        // would make maybeSingle() error, and the gate would 404 a real partner.
        .limit(1)
    ]);
    if (raia?.error || a2a?.error) {
      throw new Error(raia?.error?.message ?? a2a?.error?.message ?? 'registry query failed');
    }
    const approved =
      !!raia?.data && raia.data.verification_status === 'approved' && !raia.data.revoked_at;
    const published = Array.isArray(a2a?.data) && a2a.data.length > 0;
    return approved || published;
  } catch (err) {
    if (!warned.has(entityId)) {
      warned.add(entityId);
      console.warn(
        `[registry] publication gate failed closed for ${entityId}: ${(err as Error).message}`
      );
    }
    return false;
  }
}
