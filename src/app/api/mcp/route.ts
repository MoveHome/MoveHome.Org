// Hosted MCP server for the MoveHome property agent (Streamable HTTP).
//   POST /api/mcp   (also reachable at /mcp via a rewrite)
// Exposes the read-only A2A skills as MCP tools by reusing the exact skill handlers
// (src/lib/a2a/skills.ts). create_enquiry is intentionally NOT exposed (it's a write
// that emails an estate agent) — call it over A2A directly if needed.

import { resolveSkill } from '@/lib/a2a/skills';
import { handleMcp, mcpOptions, mcpGetInfo, type McpTool, type McpServerInfo } from '@/lib/mcp/http';

export const dynamic = 'force-dynamic';

const SERVER: McpServerInfo = {
  name: 'movehome-property',
  version: '1.0.0',
  rateLimitGroup: 'a2a',
  instructions: 'Search and inspect MoveHome.org property listings (UK + international). Read-only.'
};

// Wrap an A2A skill as an MCP tool: run the skill, return its summary + structured data.
function skillTool(skillId: string, name: string, description: string, inputSchema: Record<string, unknown>): McpTool {
  return {
    name,
    description,
    inputSchema,
    handler: async (args) => {
      const skill = resolveSkill(skillId);
      if (!skill) return { content: [{ type: 'text', text: `Skill ${skillId} is unavailable.` }], isError: true };
      try {
        const result = await skill(args);
        const dataPart = result.artifacts[0]?.parts.find((p) => (p as { kind?: string }).kind === 'data') as
          | { data?: unknown }
          | undefined;
        return { content: [{ type: 'text', text: `${result.summary}\n\n${JSON.stringify(dataPart?.data ?? {}, null, 2)}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: e instanceof Error ? e.message : 'Skill error.' }], isError: true };
      }
    }
  };
}

const TOOLS: McpTool[] = [
  skillTool('search_properties', 'search_properties', 'Search the MoveHome.org property catalogue by location (UN/LOCODE), service type, property type, bedrooms, and max price.', {
    type: 'object',
    properties: {
      un_locode: { type: 'string', description: '5-char UN/LOCODE, e.g. GBLON' },
      service_type: { type: 'string', enum: ['long_term', 'short_term', 'sale'] },
      property_type: { type: 'string', enum: ['flat', 'house', 'studio', 'commercial', 'land', 'other'] },
      bedrooms_min: { type: 'integer', minimum: 0 },
      rent_pcm_max: { type: 'number' },
      asking_price_max: { type: 'number' },
      limit: { type: 'integer', minimum: 1, maximum: 50 }
    }
  }),
  skillTool('get_property', 'get_property', 'Fetch the full public details of one listing by its raia_id (e.g. prop-gb-rlf-000031).', {
    type: 'object',
    properties: { raia_id: { type: 'string', description: 'Listing id, e.g. prop-gb-rlf-000031' } },
    required: ['raia_id']
  })
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
