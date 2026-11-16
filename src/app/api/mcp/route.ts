// Hosted MCP server for the MoveHome property agent (Streamable HTTP).
//   POST /api/mcp   (also reachable at /mcp via a rewrite)
// Exposes the read-only A2A skills as MCP tools by reusing the exact skill handlers
// (src/lib/a2a/skills.ts). create_enquiry is exposed when MCP_WRITE_ENABLED === 'on' && agentWritesEnabled().

import { resolveSkill } from '@/lib/a2a/skills';
import { handleMcp, mcpOptions, mcpGetInfo, type McpTool, type McpServerInfo } from '@/lib/mcp/http';
import { agentWritesEnabled, checkTestFence, buildAttribution, enquiryIdForIdempotencyKey } from '@/lib/agent-write-policy';
import { hasWriteScope, verifyMcpToken } from '@/lib/mcp/oauth';
import { checkMcpWriteRate, recordMcpWrite } from '@/lib/mcp/write-throttle';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const SERVER: McpServerInfo = {
  name: 'movehome-property',
  version: '1.0.0',
  rateLimitGroup: 'a2a',
  instructions: 'Search and inspect MoveHome.org property listings (UK + international). Submit enquiries (pilot).'
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

const READ_TOOLS: McpTool[] = [
  skillTool('search_properties', 'search_properties', 'Search the MoveHome.org property catalogue by location (UN/LOCODE), service type, property type, bedrooms, and max price.', {
    type: 'object',
    properties: {
      un_locode: { type: 'string', pattern: '^[A-Za-z]{2}[A-Za-z0-9]{3}$', description: '5-char UN/LOCODE, e.g. GBLON (case-insensitive)' },
      service_type: { type: 'string', enum: ['long_term', 'short_term', 'sale'] },
      property_type: { type: 'string', enum: ['flat', 'house', 'studio', 'commercial', 'land', 'other'] },
      bedrooms_min: { type: 'integer', minimum: 0, maximum: 50 },
      rent_pcm_max: { type: 'number', minimum: 0, maximum: 1000000 },
      asking_price_max: { type: 'number', minimum: 0, maximum: 1000000000 },
      limit: { type: 'integer', minimum: 1, maximum: 50 }
    }
  }),
  skillTool('get_property', 'get_property', 'Fetch the full public details of one listing by its raia_id (e.g. prop-gb-rlf-000031).', {
    type: 'object',
    properties: { raia_id: { type: 'string', description: 'Listing id, e.g. prop-gb-rlf-000031' } },
    required: ['raia_id']
  })
];

const WRITE_TOOL: McpTool = {
  name: 'create_enquiry',
  description: 'Submit an enquiry for a property listing (pilot only). Requires OAuth 2.1 authentication.',
  inputSchema: {
    type: 'object',
    properties: {
      raia_id: { type: 'string', description: 'Listing id, e.g. prop-gb-mcptest-000001' },
      message: { type: 'string', description: 'Enquiry message content' },
      enquirer: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' }
        },
        required: ['name', 'email']
      }
    },
    required: ['raia_id', 'message', 'enquirer']
  },
  handler: async () => {
    // Handler is processed in route logic with full context (req headers & auth)
    return { content: [{ type: 'text', text: 'create_enquiry handled by route wrapper.' }] };
  }
};

function getActiveTools(): McpTool[] {
  const isMcpWriteOn = (process.env.MCP_WRITE_ENABLED ?? '').trim().toLowerCase() === 'on';
  if (isMcpWriteOn && agentWritesEnabled()) {
    return [...READ_TOOLS, WRITE_TOOL];
  }
  return READ_TOOLS;
}

export function OPTIONS() {
  return mcpOptions();
}
export function GET() {
  return mcpGetInfo(SERVER, getActiveTools());
}
export async function POST(req: Request) {
  const tools = getActiveTools();
  
  // Clone req to parse JSON-RPC method for write handler override
  let reqJson: Record<string, unknown> | null = null;
  try {
    const clone = req.clone();
    reqJson = await clone.json();
  } catch {
    /* ignore */
  }

  // Intercept create_enquiry write tool calls
  if (reqJson && reqJson.method === 'tools/call') {
    const params = reqJson.params as Record<string, unknown> | undefined;
    if (params && params.name === 'create_enquiry') {
      const isMcpWriteOn = (process.env.MCP_WRITE_ENABLED ?? '').trim().toLowerCase() === 'on';
      if (!isMcpWriteOn || !agentWritesEnabled()) {
        return handleMcp(req, SERVER, READ_TOOLS);
      }

      // Verify OAuth JWT
      const authHeader = req.headers.get('authorization');
      const verifiedToken = await verifyMcpToken(authHeader);
      if (!verifiedToken) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: reqJson.id ?? null,
            error: { code: -32001, message: 'Unauthorized. Bearer token missing or invalid.' }
          }),
          {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              'WWW-Authenticate': 'Bearer resource_metadata="https://movehome.org/.well-known/oauth-protected-resource"'
            }
          }
        );
      }

      // G-AUTH-03: a valid token without enquiry:write is refused (403), never written.
      if (!hasWriteScope(verifiedToken)) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: reqJson.id ?? null,
            error: { code: -32001, message: 'insufficient_scope: enquiry:write required.' }
          }),
          {
            status: 403,
            headers: {
              'Content-Type': 'application/json',
              'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="enquiry:write"'
            }
          }
        );
      }

      const args = (params.arguments || {}) as Record<string, unknown>;

      // D5 check: reject body-supplied verified_platform
      if ('verified_platform' in args || 'verification_method' in args) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: reqJson.id ?? null,
            error: { code: -32602, message: 'verified_platform must not be supplied in request body.' }
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const raiaId = typeof args.raia_id === 'string' ? args.raia_id : '';
      const message = typeof args.message === 'string' ? args.message : '';
      const enquirer = (args.enquirer || {}) as Record<string, string>;

      // 1. D6 Throttle check (fail closed)
      const throttle = await checkMcpWriteRate(verifiedToken.client_id, raiaId);
      if (!throttle.allowed) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: reqJson.id ?? null,
            error: { code: -32000, message: throttle.reason || 'Rate limit exceeded' }
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(throttle.retryAfterSeconds || 60)
            }
          }
        );
      }

      // 2. D9 DB listing resolution & TEST fence check
      const supabase = createSupabaseAdminClient();
      if (!supabase) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: reqJson.id ?? null,
            error: { code: -32000, message: 'Database service unavailable' }
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { data: listing } = await supabase
        .from('tbl_external_raia_listings')
        .select('agent_id')
        .eq('raia_id', raiaId)
        .maybeSingle();

      const fence = checkTestFence(listing?.agent_id);
      if (!fence.ok) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: reqJson.id ?? null,
            error: { code: -32003, message: 'closed pilot: listing not in TEST allowlist' }
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 3. Idempotency handling (D4)
      const idempotencyKey = req.headers.get('idempotency-key') || (typeof args.idempotency_key === 'string' ? args.idempotency_key : '');
      const scope = `mcp:${verifiedToken.client_id}:${raiaId}`;
      const enquiryId = enquiryIdForIdempotencyKey(scope, idempotencyKey || `${Date.now()}-${Math.random()}`);

      // Check existing idempotency row in tbl_enquiries
      const { data: existingEnquiry } = await supabase
        .from('tbl_enquiries')
        .select('enquiry_id, status')
        .eq('enquiry_id', enquiryId)
        .maybeSingle();

      if (existingEnquiry) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: reqJson.id ?? null,
            result: {
              content: [{ type: 'text', text: `Enquiry ${enquiryId} replayed successfully.` }],
              structuredContent: { enquiry_id: enquiryId, status: 'replayed' }
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Insert new enquiry row (D7 outbox)
      const attribution = buildAttribution('mcp', (args.claimed_platform as string) || verifiedToken.platform, verifiedToken.platform);
      
      const { error: insertErr } = await (supabase as any).from('tbl_enquiries').insert({
        enquiry_id: enquiryId,
        raia_id: raiaId,
        agent_id: listing?.agent_id || 'org-gb-mcptest',
        message,
        enquirer_name: enquirer.name,
        enquirer_email: enquirer.email,
        enquirer_phone: enquirer.phone || null,
        source: attribution,
        // tbl_enquiries_status_check allows only new|forwarded|responded|closed;
        // 'accepted' is the API receipt label, not a storable DB status.
        status: 'new'
      });

      if (insertErr) {
        console.error('[mcp create_enquiry] Insert error:', insertErr);
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: reqJson.id ?? null,
            error: { code: -32000, message: 'Failed to record enquiry' }
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Record rate limit write count
      await recordMcpWrite(verifiedToken.client_id, raiaId);

      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: reqJson.id ?? null,
          result: {
            content: [{ type: 'text', text: `Enquiry ${enquiryId} accepted.` }],
            structuredContent: { enquiry_id: enquiryId, status: 'accepted' }
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  return handleMcp(req, SERVER, tools);
}
