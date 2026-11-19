export interface EstateAgentProfile {
  agent_id: string;
  slug?: string;
  name: string;
  legal_name: string;
  registration_number: string;
  registration_authority: string;
  incorporation_info: string;
  jurisdiction: string;
  business_address: string;
  email: string;
  website: string;
  licences: string[];
  agent_card_url: string;
  logo_url?: string | null;
  /** Other entity ids this same agency is served under (e.g. its A2A card id). */
  aliases?: string[];
}

export const ESTATE_AGENT_PROFILES: Record<string, EstateAgentProfile> = {
  'org-gb-07798821': {
    agent_id: 'org-gb-07798821',
    slug: 'rentlondonflat',
    name: 'RentLondonFlat.com Ltd',
    legal_name: 'RentLondonFlat.com Ltd',
    registration_number: '07798821',
    registration_authority: 'UK Companies House #07798821',
    incorporation_info: 'Incorporated Oct 2011 · 15 Years Trading (England & Wales)',
    jurisdiction: 'United Kingdom · GBLON',
    business_address: 'London, United Kingdom',
    email: 'lettings@rentlondonflat.com',
    website: 'https://www.rentlondonflat.com',
    licences: [
      'Property Redress Scheme (PRS) Member',
      'Client Money Protection (CMP) Certified',
      'ICO Data Protection Registered',
      'HMRC AML Supervised Estate Agency'
    ],
    agent_card_url: 'https://app.estateaigents.com/.well-known/agent.json',
    aliases: ['org-gb-rlf']
  },
  'org-th-0105561135324': {
    agent_id: 'org-th-0105561135324',
    slug: 'beyond360',
    name: 'Beyond 360 Co., Ltd.',
    legal_name: 'Beyond 360 Co., Ltd.',
    registration_number: '0105561135324',
    registration_authority: 'Thailand DBD #0105561135324',
    incorporation_info: 'Incorporated 2015 · 11 Years Trading (Thailand)',
    jurisdiction: 'Thailand · THBKK (Bangkok)',
    business_address: 'Sukhumvit / Phloen Chit, Bangkok, Thailand',
    email: 'concierge@buythai.com',
    website: 'https://www.beyond360group.com',
    licences: [
      'DBD Registered Property & Asset Management Co. (#0105561135324)',
      'Thai PDPA Data Protection Compliant',
      'Verified Foreign Quota & Leasehold Due Diligence'
    ],
    agent_card_url: 'https://app.estateaigents.com/.well-known/agent.json'
  }
};

export const DEFAULT_ESTATE_AGENT_PROFILE: EstateAgentProfile = ESTATE_AGENT_PROFILES['org-gb-07798821'];

export function getEstateAgentProfile(agentIdOrSlug: string | null | undefined): EstateAgentProfile | null {
  if (!agentIdOrSlug) return null;
  if (ESTATE_AGENT_PROFILES[agentIdOrSlug]) {
    return ESTATE_AGENT_PROFILES[agentIdOrSlug];
  }
  const match = Object.values(ESTATE_AGENT_PROFILES).find(
    (p) => p.slug === agentIdOrSlug || p.agent_id === agentIdOrSlug || p.aliases?.includes(agentIdOrSlug)
  );
  return match ?? null;
}
