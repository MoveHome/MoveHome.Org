// Per-entity cards for the MoveHome directory: agencies, individual agents and
// properties each publish their own signed agent.json / raia.json. The A2A card
// describes *how to talk to* the entity; the RAIA card describes *who it is*.
//
// Every card carries the same grounding pair, which is the point of the split:
//   listing_agent          the trading agency legally responsible for the listing
//   infrastructure_provider the software operator (EstateAigents), never the agent
// Property listings land in the catalogue under the software provider's org id
// (org-gb-estateaigents), so grounding has to be stated explicitly here.

import { A2A_PROTOCOL_VERSION, type AgentCard } from './types';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://movehome.org').replace(/\/$/, '');

export interface Grounding {
  agent_id: string;
  name: string;
  role: 'trading_agency' | 'infrastructure_provider';
  url?: string;
}

export const INFRASTRUCTURE_PROVIDER: Grounding = {
  agent_id: 'org-gb-estateaigents',
  name: 'EstateAigents',
  role: 'infrastructure_provider',
  url: 'https://estateaigents.com'
};

export interface DirectoryEntity {
  id: string;
  kind: 'agency' | 'agent' | 'property';
  name: string;
  description: string;
  listing_agent: Grounding;
}

const RLF: Grounding = {
  agent_id: 'org-gb-rlf',
  name: 'RentLondonFlat.com Ltd',
  role: 'trading_agency'
};

export const DIRECTORY_ENTITIES: Record<string, DirectoryEntity> = {
  'org-gb-rlf': {
    id: 'org-gb-rlf',
    kind: 'agency',
    name: 'RentLondonFlat.com Ltd',
    description:
      'London letting agency (Companies House 07798821) publishing long-term rental ' +
      'listings over the RAIA Protocol.',
    listing_agent: RLF
  },
  'org-gb-throne': {
    id: 'org-gb-throne',
    kind: 'agency',
    name: 'Throne',
    description: 'UK property agency publishing listings over the RAIA Protocol.',
    listing_agent: {
      agent_id: 'org-gb-throne',
      name: 'Throne',
      role: 'trading_agency'
    }
  },
  'agt-gb-shannon': {
    id: 'agt-gb-shannon',
    kind: 'agent',
    name: 'Shannon',
    description:
      'Individual letting agent working for RentLondonFlat.com Ltd. Acts on the ' +
      "agency's listings; the agency, not the agent, is the contracting party.",
    listing_agent: RLF
  },
  'prop-gb-rlf-000214': {
    id: 'prop-gb-rlf-000214',
    kind: 'property',
    name: '14C Pembroke',
    description: '2-bedroom flat to rent in W1T, marketed by RentLondonFlat.com Ltd.',
    listing_agent: RLF
  }
};

export function getDirectoryEntity(id: string | null | undefined): DirectoryEntity | null {
  return id ? DIRECTORY_ENTITIES[id] ?? null : null;
}

const endpoints = () => ({
  search: `${SITE_URL}/api/a2a`,
  property: `${SITE_URL}/p/{raia_id}/card.json`,
  enquire: `${SITE_URL}/api/enquire`
});

// A2A agent card plus the RAIA grounding extension (A2A clients ignore the extras).
export type GroundedAgentCard = AgentCard & {
  agent_id: string;
  listing_agent: Grounding;
  infrastructure_provider: Grounding;
};

// A2A agent card for an agency or individual agent.
export function buildEntityAgentCard(entity: DirectoryEntity): GroundedAgentCard {
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: `${entity.name} Agent`,
    description: entity.description,
    url: `${SITE_URL}/api/a2a`,
    version: '0.3.0',
    provider: { organization: entity.name, url: SITE_URL },
    documentationUrl: `${SITE_URL}/skills.md`,
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json', 'text/plain'],
    skills: [
      {
        id: 'get_property',
        name: 'Get property',
        description: `Retrieve the public card for one of ${entity.name}'s listings by raia_id.`,
        tags: ['property', 'detail', 'real-estate'],
        examples: [`Get the details for listing ${entity.id}`]
      }
    ],
    // RAIA grounding extension — not part of the A2A spec, ignored by A2A clients.
    agent_id: entity.id,
    listing_agent: entity.listing_agent,
    infrastructure_provider: INFRASTRUCTURE_PROVIDER
  };
}

// RAIA v0.3 card for an agency or individual agent.
export function buildEntityRaiaCard(entity: DirectoryEntity) {
  return {
    schema_version: '0.3.0',
    agent_id: entity.id,
    name: entity.name,
    description: entity.description,
    endpoints: endpoints(),
    verification: { method: 'manual' as const },
    listing_agent: entity.listing_agent,
    infrastructure_provider: INFRASTRUCTURE_PROVIDER
  };
}
