import { NextResponse } from 'next/server';
import { getEstateAgentProfile } from '@/lib/agent-directory';
import { isDirectoryEntityPublic } from '@/lib/registry/publication';

interface Props {
  params: Promise<{ agent_id: string }>;
}

export async function GET(request: Request, { params }: Props) {
  const { agent_id } = await params;
  const profile = getEstateAgentProfile(agent_id);

  if (!profile || !(await isDirectoryEntityPublic(agent_id))) {
    return NextResponse.json(
      { error: 'Agent profile not found' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.json(profile, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400'
    }
  });
}
