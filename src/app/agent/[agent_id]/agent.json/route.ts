// Signed A2A agent card for one directory entity: /agent/{id}/agent.json
import { NextResponse } from 'next/server';
import { buildEntityAgentCard, getDirectoryEntity } from '@/lib/a2a/directory-cards';
import { signCard } from '@/lib/a2a/card-signing';
import { isDirectoryEntityPublic } from '@/lib/registry/publication';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ agent_id: string }> }) {
  const { agent_id } = await params;
  const entity = getDirectoryEntity(agent_id);
  if (!entity || entity.kind === 'property' || !(await isDirectoryEntityPublic(agent_id))) {
    return NextResponse.json(
      { error: 'Agent card not found' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  return NextResponse.json(await signCard(buildEntityAgentCard(entity)), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
