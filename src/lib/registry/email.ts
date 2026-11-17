// Outbound email for the registry claim flow. Resend's HTTP API is called directly
// (no SDK dependency). A missing RESEND_API_KEY is never papered over: the caller gets
// false and turns it into a 503, because claiming "we emailed you" when nothing was
// sent would silently strand the agency's card in 'staged'.
// Claim tokens are one-time secrets: they appear in the email body only, never in logs.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const FROM = process.env.REGISTRY_FROM_EMAIL || 'MoveHome Registry <registry@movehome.org>';

export function emailProviderConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendClaimEmail(to: string, cardName: string | null, claimUrl: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const label = cardName || 'your agency';
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: `Claim the MoveHome registry card for ${label}`,
        text: [
          `Someone (hopefully you) asked to claim the MoveHome registry card for ${label}.`,
          '',
          `Confirm the claim: ${claimUrl}`,
          '',
          'The link expires in 72 hours. If this was not you, ignore this email — the card stays private.'
        ].join('\n')
      })
    });
    return res.ok;
  } catch {
    return false;
  }
}
