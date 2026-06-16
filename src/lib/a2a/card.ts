// Builds the A2A Agent Card MoveHome.org publishes at /.well-known/agent-card.json
// (and the legacy /.well-known/agent.json). External agents fetch this to discover
// the JSON-RPC endpoint and the skills they can invoke. Typed against @a2a-js/sdk.

import { A2A_PROTOCOL_VERSION, type AgentCard } from './types';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://movehome.org').replace(/\/$/, '');

// App version — surfaced so agents can detect skill changes across deploys.
const AGENT_VERSION = process.env.npm_package_version || '0.1.0';

export function buildAgentCard(): AgentCard {
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: 'MoveHome.org Property Agent',
    description:
      'Agent-to-agent access to the MoveHome.org property catalogue. Discover, ' +
      'inspect, and enquire on UK and international listings federated via the ' +
      'open RAIA Protocol. Read-only search and listing retrieval are anonymous; ' +
      'enquiries are forwarded to the source estate agent.',
    url: `${SITE_URL}/api/a2a`,
    preferredTransport: 'JSONRPC',
    version: AGENT_VERSION,
    provider: {
      organization: 'Move Home Organisation CIC',
      url: SITE_URL
    },
    documentationUrl: `${SITE_URL}/skills.md`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false
    },
    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json', 'text/plain'],
    skills: [
      {
        id: 'search_properties',
        name: 'Search properties',
        description:
          'Search the MoveHome.org catalogue by location (UN/LOCODE), service ' +
          'type (long_term, short_term, sale), property type, bedrooms, and ' +
          'maximum price. Returns a paginated list of public listing cards.',
        tags: ['property', 'search', 'real-estate', 'lettings', 'sales'],
        examples: [
          'Find 2-bedroom long-term rentals in London under £3000 pcm',
          'Search for flats for sale in GBLON with a maximum price of 750000'
        ]
      },
      {
        id: 'get_property',
        name: 'Get property',
        description:
          'Retrieve the full public card for a single listing by its raia_id ' +
          '(e.g. prop-gb-acme-12345678), including price, location, features and media.',
        tags: ['property', 'detail', 'real-estate'],
        examples: ['Get the details for listing prop-gb-rlf-04827193']
      },
      {
        id: 'create_enquiry',
        name: 'Create enquiry',
        description:
          'Submit an enquiry against a listing on behalf of a prospective ' +
          'tenant or buyer. The enquiry is recorded and forwarded to the source ' +
          'estate agent. Requires enquirer name, email and a message; an ' +
          'optional viewing request with preferred dates may be included.',
        tags: ['property', 'enquiry', 'lead', 'transact', 'viewing'],
        examples: [
          'Enquire about prop-gb-rlf-04827193 for Jane Doe (jane@example.com): ' +
            '"Is this still available and can we view it on Saturday?"'
        ]
      }
    ]
  };
}
