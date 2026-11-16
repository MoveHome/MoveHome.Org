import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import canonicalize from 'canonicalize';
import { exportJWK, generateKeyPair, flattenedVerify, importJWK } from 'jose';
import { DIRECTORY_ENTITIES, buildEntityAgentCard, buildEntityRaiaCard } from '@/lib/a2a/directory-cards';
import { signCard, publicJwks } from '@/lib/a2a/card-signing';

const IDS = ['org-gb-rlf', 'org-gb-throne', 'agt-gb-shannon'];

describe('directory cards', () => {
  let privateJwk: Record<string, unknown>;

  beforeAll(async () => {
    const { privateKey } = await generateKeyPair('ES256', { extractable: true });
    privateJwk = await exportJWK(privateKey) as Record<string, unknown>;
    process.env.A2A_CARD_SIGNING_JWK = JSON.stringify(privateJwk);
  });

  afterAll(() => {
    delete process.env.A2A_CARD_SIGNING_JWK;
  });

  it('grounds every entity to a trading agency and EstateAigents as provider', () => {
    expect(Object.keys(DIRECTORY_ENTITIES)).toEqual([
      'org-gb-rlf',
      'org-gb-throne',
      'agt-gb-shannon',
      'prop-gb-rlf-000214'
    ]);
    for (const entity of Object.values(DIRECTORY_ENTITIES)) {
      expect(entity.listing_agent.role).toBe('trading_agency');
      expect(entity.listing_agent.agent_id).toMatch(/^org-/);
    }
    expect(DIRECTORY_ENTITIES['prop-gb-rlf-000214'].listing_agent.agent_id).toBe('org-gb-rlf');
    expect(DIRECTORY_ENTITIES['agt-gb-shannon'].listing_agent.agent_id).toBe('org-gb-rlf');
    expect(DIRECTORY_ENTITIES['org-gb-throne'].listing_agent.agent_id).toBe('org-gb-throne');
  });

  it.each(IDS)('signs agent.json and raia.json for %s with a verifiable JWS', async (id) => {
    const publicKey = await importJWK(publicJwks().keys[0] as never, 'ES256');

    for (const card of [buildEntityAgentCard(DIRECTORY_ENTITIES[id]), buildEntityRaiaCard(DIRECTORY_ENTITIES[id])]) {
      const signed = await signCard(card);
      expect(signed.signatures).toHaveLength(1);
      const { signatures, ...unsigned } = signed as typeof signed & { signatures: { protected: string; signature: string }[] };
      const expected = canonicalize(unsigned) as string;
      // Server signs the JCS bytes; jose stores them base64url in `payload`.
      const payload = Buffer.from(expected, 'utf8').toString('base64url');
      await flattenedVerify(
        { protected: signatures[0].protected, signature: signatures[0].signature, payload },
        publicKey
      );
      expect(signed).toMatchObject({
        listing_agent: { role: 'trading_agency' },
        infrastructure_provider: { agent_id: 'org-gb-estateaigents', role: 'infrastructure_provider' }
      });
    }
  });

  it('property cards are grounded to the trading agency, not the catalogue org', () => {
    const entity = DIRECTORY_ENTITIES['prop-gb-rlf-000214'];
    expect(entity.kind).toBe('property');
    expect(entity.listing_agent.agent_id).toBe('org-gb-rlf');
  });
});
