import { NextResponse } from 'next/server';
import { getEstateAgentProfile } from '@/lib/agent-directory';

interface Props {
  params: Promise<{ agent_id: string }>;
}

export async function GET(request: Request, { params }: Props) {
  const { agent_id } = await params;
  const profile = getEstateAgentProfile(agent_id);

  return NextResponse.json(profile, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400'
    }
  });
}
