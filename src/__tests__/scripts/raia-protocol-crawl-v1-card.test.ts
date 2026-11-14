import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { jsonRpcEndpoint, isJsonRpcCard, validateAgentCard, buildSearchRequest } = require('../../../scripts/raia-protocol-crawl.cjs') as {
  jsonRpcEndpoint: (card: unknown) => string | null;
  isJsonRpcCard: (card: unknown) => boolean;
  validateAgentCard: (card: unknown) => string[];
  buildSearchRequest: (card: unknown, params?: Record<string, unknown>) => { url: string; method: string; body: { method: string } | null };
};

const A2A = 'https://app.estateaigents.com/api/a2a';

// ADR-472 V7 / a2a-v1-upgrade-design §1.2: the 1.0 card has no top-level url.
const V1_DUAL = {
  name: 'EstateAigents RAIA Property Agent',
  version: '1.0.0',
  supportedInterfaces: [
    { url: A2A, protocolBinding: 'JSONRPC', tenant: '', protocolVersion: '1.0' },
    { url: A2A, protocolBinding: 'JSONRPC', tenant: '', protocolVersion: '0.3' },
  ],
};

describe('crawler — A2A 1.0 agent card (ADR-472 V7)', () => {
  it('finds the 0.3 JSONRPC interface on a dual-interface 1.0 card', () => {
    expect(jsonRpcEndpoint(V1_DUAL)).toBe(A2A);
    expect(isJsonRpcCard(V1_DUAL)).toBe(true);
    expect(validateAgentCard(V1_DUAL)).toEqual([]);
  });

  it('builds the same message/send request it sends to a 0.3 card', () => {
    const req = buildSearchRequest(V1_DUAL, { un_locode: 'GBLON', transaction_type: 'LETTINGS', limit: 50 });
    expect(req.url).toBe(A2A);
    expect(req.method).toBe('POST');
    expect(req.body?.method).toBe('message/send');
  });

  it('accepts "0.3.0" spelling of the legacy interface version', () => {
    expect(jsonRpcEndpoint({ supportedInterfaces: [{ url: A2A, protocolBinding: 'jsonrpc', protocolVersion: '0.3.0' }] })).toBe(A2A);
  });

  it('refuses a 1.0-only card with a clear error instead of sending a 0.3 method to it', () => {
    const v1Only = { supportedInterfaces: [V1_DUAL.supportedInterfaces[0]] };
    expect(jsonRpcEndpoint(v1Only)).toBeNull();
    expect(validateAgentCard(v1Only)).toEqual(['A2A 1.0 card declares no JSONRPC 0.3 interface (crawler speaks message/send)']);
  });

  it('ignores a 0.3 interface whose url is not http(s)', () => {
    expect(jsonRpcEndpoint({ supportedInterfaces: [{ url: 'ftp://x', protocolBinding: 'JSONRPC', protocolVersion: '0.3' }] })).toBeNull();
  });

  it('keeps the 0.3 card path unchanged', () => {
    const v03 = { protocolVersion: '0.3.0', url: A2A, preferredTransport: 'JSONRPC' };
    expect(jsonRpcEndpoint(v03)).toBe(A2A);
    expect(validateAgentCard(v03)).toEqual([]);
  });
});
