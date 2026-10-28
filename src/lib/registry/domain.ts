// Domain-control verification for registry agents (RAIA SPEC §7 trust tier).
//
// The registry issues a random token per agent; the operator proves control of the
// card's host by publishing   _raia-verify.<host>  TXT  "raia-verify=<token>".
// Verification resolves that record and passes only on an exact match. The token is
// not a secret — the DNS record is public anyway — it just binds the record to this
// registry entry. The health worker re-checks it on every run, so removing the record
// drops the agent out of the verified tier (it is never deleted for it).

import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';

export const VERIFY_LABEL = '_raia-verify';
const VALUE_PREFIX = 'raia-verify=';

export type TxtResolver = (name: string) => Promise<string[][]>;

export function newVerificationToken(): string {
  return randomBytes(24).toString('base64url');
}

export function verificationRecord(cardUrl: string, token: string): { type: 'TXT'; name: string; value: string } {
  return { type: 'TXT', name: `${VERIFY_LABEL}.${new URL(cardUrl).hostname}`, value: `${VALUE_PREFIX}${token}` };
}

/**
 * True only when the card host's _raia-verify TXT record carries exactly this token.
 * Any DNS failure (NXDOMAIN, no data, timeout) is "not verified", never an error.
 */
export async function checkDomainTxt(
  cardUrl: string,
  token: string | null,
  resolveTxt: TxtResolver = dns.resolveTxt
): Promise<boolean> {
  if (!token) return false;
  const { name, value } = verificationRecord(cardUrl, token);
  try {
    // A TXT record may be split into several <=255-byte strings; join each record's chunks.
    const records = await resolveTxt(name);
    return records.some((chunks) => chunks.join('') === value);
  } catch {
    return false;
  }
}
