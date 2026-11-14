// A2A protocol types are sourced from the official @a2a-js/sdk (A2A 0.3.x).
// We re-export the subset the app uses so internal imports stay stable.

import type { AgentCard as SdkAgentCard } from '@a2a-js/sdk';

export interface AgentSupportedInterface {
  protocolVersion: string;
  protocolBinding: string;
  securityRequirements?: Array<Record<string, string[]>>;
}

export interface AgentCard extends SdkAgentCard {
  supportedInterfaces?: AgentSupportedInterface[];
}

export type {
  AgentCardSignature,
  AgentSkill,
  AgentCapabilities,
  AgentProvider,
  Message,
  Part,
  TextPart,
  DataPart,
  Task,
  TaskStatus,
  TaskState,
  Artifact,
  TaskStatusUpdateEvent
} from '@a2a-js/sdk';

// The A2A protocol version implemented by @a2a-js/sdk 0.3.x. Advertised on the
// Agent Card so clients can negotiate compatibility.
export const A2A_PROTOCOL_VERSION = '0.3.0';
