// Signed RAIA card for one directory entity: /agent/{id}/raia.json
import { NextResponse } from 'next/server';
import { buildEntityRaiaCard, getDirectoryEntity } from '@/lib/a2a/directory-cards';
import { signCard } from '@/lib/a2a/card-signing';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ agent_id: string }> }) {
  const { agent_id } = await params;
  const entity = getDirectoryEntity(agent_id);
  if (!entity || entity.kind === 'property') {
    return NextResponse.json({ error: 'RAIA card not found' }, { status: 404 });
  }
  return NextResponse.json(await signCard(buildEntityRaiaCard(entity)), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
