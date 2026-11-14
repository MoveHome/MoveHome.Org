import { describe, expect, it } from 'vitest';
import { buildAgentCard } from '@/lib/a2a/card';

describe('buildAgentCard', () => {
  it('includes supportedInterfaces for A2A 1.0 and 0.3 compatibility', () => {
    const card = buildAgentCard();
    expect(card.supportedInterfaces).toBeDefined();
    expect(card.supportedInterfaces).toEqual([
      { protocolVersion: '1.0', protocolBinding: 'JSONRPC' },
      { protocolVersion: '0.3', protocolBinding: 'JSONRPC' }
    ]);
  });
});
