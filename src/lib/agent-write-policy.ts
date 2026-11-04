// Shared write policy for agent-originated enquiries (A2A today, MCP later).
// Implements the architecture rulings on MoveHome/MoveHome.Org#34:
//
//   1. Writes sit behind an explicit server flag, default OFF.
//   2. TEST-org fence: an agent write may only target a listing whose
//      organisation is on the server-side TEST allowlist, even with the flag
//      on, and even with a valid token (once OAuth lands).
//   3. The write throttle fails CLOSED (see the A2A route).
//   4. Attribution honesty: `claimed_platform` is caller-asserted;
//      `verified_platform` comes ONLY from an authenticated client binding,
//      never from the request payload. No OAuth yet, so it is always null.
//   5. One policy for both transports, so neither A2A nor MCP is a bypass.
//
// The public web form (POST /api/enquire) is a human channel and is NOT
// governed by this module.

import { createHash } from 'node:crypto';

/** True only when the operator has explicitly switched agent writes on. */
export function agentWritesEnabled(): boolean {
  return (process.env.AGENT_ENQUIRY_WRITES ?? '').trim().toLowerCase() === 'on';
}

/** Organisation ids (listing agent_id) that agent writes may target. Default: none. */
export function testAgentIds(): string[] {
  return (process.env.AGENT_ENQUIRY_TEST_AGENT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export type FenceDecision = { ok: true } | { ok: false; error: string };

/**
 * The TEST-org fence. `agentId` is the owning organisation of the resolved
 * listing, read from the database, never from the caller. An empty allowlist
 * rejects everything.
 */
export function checkTestFence(agentId: string | null | undefined, allowlist = testAgentIds()): FenceDecision {
  if (agentId && allowlist.includes(agentId)) return { ok: true };
  return {
    ok: false,
    error: 'Agent enquiries are in a closed pilot and are only accepted for designated test listings.'
  };
}

export const AGENT_WRITES_DISABLED_MESSAGE =
  'create_enquiry is not currently available to agents (closed pilot). ' +
  'Enquiries can be made at https://movehome.org/enquire.';

export type AgentChannel = 'a2a' | 'mcp';

export interface AgentAttribution {
  channel: AgentChannel;
  /** Free-text platform the caller says it is (e.g. "grok"). Untrusted. */
  claimed_platform: string | null;
  /** Platform proven by an authenticated client binding. Null until OAuth. */
  verified_platform: string | null;
}

/**
 * Build attribution. `verifiedClientPlatform` must come from the server-side
 * OAuth client registration, so there is deliberately no way to derive it
 * from request params.
 */
export function buildAttribution(
  channel: AgentChannel,
  claimedPlatform: string | null | undefined,
  verifiedClientPlatform: string | null = null
): AgentAttribution {
  const claimed = claimedPlatform?.trim().toLowerCase().slice(0, 64) || null;
  return { channel, claimed_platform: claimed, verified_platform: verifiedClientPlatform };
}

/**
 * Deterministic enquiry id for an idempotency key, so a retried write maps to
 * the same primary key and is never recorded or forwarded twice. Scoped by
 * channel (and, after OAuth, the client id) so keys can't collide across callers.
 */
export function enquiryIdForIdempotencyKey(scope: string, key: string): string {
  const h = createHash('sha256').update(`${scope}\u0000${key}`).digest('hex');
  // Shape as an RFC 4122 v4-style UUID (version + variant nibbles set).
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
