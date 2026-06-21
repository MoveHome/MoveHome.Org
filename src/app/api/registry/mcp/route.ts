// Hosted MCP server for the MoveHome real-estate A2A registry (Streamable HTTP).
//   POST /api/registry/mcp
// Exposes registry discovery as MCP tools, reusing src/lib/registry/store.ts.

import { listAgents, getAgent, getStats } from '@/lib/registry/store';
import { handleMcp, mcpOptions, mcpGetInfo, type McpTool, type McpServerInfo } from '@/lib/mcp/http';

export const dynamic = 'force-dynamic';

const SERVER: McpServerInfo = {
  name: 'movehome-a2a-registry',
  version: '1.0.0',
  rateLimitGroup: 'registry.read',
  instructions: 'Search and inspect the MoveHome public registry of real-estate A2A agents.'
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const clampLimit = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(50, Math.max(1, Math.trunc(n))) : 20;
};

const TOOLS: McpTool[] = [
  {
    name: 'search_agents',
    description: 'Search the registry of real-estate A2A agents by free text, location (UN/LOCODE), service type, or skill id. Returns listed agents.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Free text (name/description/provider)' },
        location: { type: 'string', description: 'UN/LOCODE, e.g. GBLON' },
        service_type: { type: 'string', enum: ['long_term', 'short_term', 'sale'] },
        skill: { type: 'string', description: 'Skill id, e.g. search_properties' },
        healthy: { type: 'boolean', description: 'Only currently-healthy agents' },
        limit: { type: 'integer', minimum: 1, maximum: 50 }
      }
    },
    handler: async (a) => {
      const { agents, total } = await listAgents({
        search: str(a.q),
        location: str(a.location)?.toUpperCase(),
        serviceType: str(a.service_type),
        skill: str(a.skill),
        healthyOnly: a.healthy === true,
        limit: clampLimit(a.limit),
        offset: 0
      });
      return { content: [{ type: 'text', text: `${total} agent(s) listed.\n\n${JSON.stringify(agents, null, 2)}` }] };
    }
  },
  {
    name: 'get_agent',
    description: 'Get one registered agent by its registry id or slug.',
    inputSchema: {
      type: 'object',
      properties: { idOrSlug: { type: 'string', description: 'Registry id (uuid) or slug' } },
      required: ['idOrSlug']
    },
    handler: async (a) => {
      const key = str(a.idOrSlug);
      if (!key) return { content: [{ type: 'text', text: 'idOrSlug is required.' }], isError: true };
      const agent = await getAgent(key);
      if (!agent) return { content: [{ type: 'text', text: `No listed agent with id/slug "${key}".` }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(agent, null, 2) }] };
    }
  },
  {
    name: 'registry_stats',
    description: 'Registry totals and top facets (categories, service types, locations).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const stats = await getStats();
      return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
    }
  }
];

export function OPTIONS() {
  return mcpOptions();
}
export function GET() {
  return mcpGetInfo(SERVER, TOOLS);
}
export function POST(req: Request) {
  return handleMcp(req, SERVER, TOOLS);
}
