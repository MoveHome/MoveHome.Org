import { describe, it, expect } from 'vitest';
import { isOrganisationAgent, listAgents } from '@/lib/registry/store';
import { getMonogram } from '@/lib/registry/ui';
import type { PublicRegistryAgent } from '@/lib/registry/types';

describe('Registry Organisation-First & Logo Features', () => {
  describe('isOrganisationAgent logic', () => {
    it('identifies orgs correctly and filters out negotiators/individual_agents', () => {
      const orgAgent: Partial<PublicRegistryAgent> = {
        id: '1',
        name: 'RentLondonFlat.com Ltd',
        categories: ['property', 'lettings']
      };
      const negotiatorAgent: Partial<PublicRegistryAgent> = {
        id: '2',
        name: 'Shannon',
        categories: ['negotiator', 'property']
      };
      const individualAgent: Partial<PublicRegistryAgent> = {
        id: '3',
        name: 'John Doe',
        categories: ['individual_agent']
      };

      expect(isOrganisationAgent(orgAgent as PublicRegistryAgent)).toBe(true);
      expect(isOrganisationAgent(negotiatorAgent as PublicRegistryAgent)).toBe(false);
      expect(isOrganisationAgent(individualAgent as PublicRegistryAgent)).toBe(false);
    });
  });

  describe('getMonogram fallback helper', () => {
    it('generates 2-letter monogram or fallback', () => {
      expect(getMonogram('RentLondonFlat.com Ltd')).toBe('RL');
      expect(getMonogram('Beyond 360')).toBe('B3');
      expect(getMonogram('Shannon')).toBe('SH');
      expect(getMonogram('')).toBe('AG');
      expect(getMonogram(null)).toBe('AG');
    });
  });
});
