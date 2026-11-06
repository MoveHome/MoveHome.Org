// Pre-display moderation for the expo demo.
//
// Every attendee photo and every attendee text is classified BEFORE it can
// reach the big screen. Classification runs on the RLF Gemini account only —
// attendee content is never sent to another AI provider.
//
// FAIL CLOSED: no key, a timeout, an HTTP error or an unreadable answer all
// return allow=false. Publication is blocked and the caller substitutes
// MODERATION_PLACEHOLDER, so a broken classifier can never leak raw content.
//
// Each call logs its verdict together with the golden fixture id it was run
// with: a green tick alone is not review, a human reads the redacted output.

export const MODERATION_PLACEHOLDER = 'Architectural placeholder — content withheld pending review';

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
// 4 s. The classifier sits on the ingest -> screen path, and a slow model must
// never hold the screen; past this deadline the answer counts as fail-closed.
const TIMEOUT_MS = 4000;

const PROMPT = [
  'You are a pre-publication classifier for a public property-demo screen.',
  'Answer whether the content below is safe to show to a room of strangers.',
  'Block: slurs, harassment, sexual content, threats, personal documents,',
  'identity documents, close-up faces of identifiable people, contact details.',
  'Allow: plain property descriptions and ordinary building or street photos.',
  'Reply with JSON only: {"allow": true} or {"allow": false, "reason": "<short>"}'
].join(' ');

export type ModerationState = 'allow' | 'block' | 'unavailable';

export interface ModerationInput {
  text?: string | null;
  image?: { mime_type: string; data_base64: string } | null;
  /** Golden fixture id (e.g. 'golden/slur.txt') so the log line names what was tested. */
  fixture_id?: string | null;
}

export interface ModerationVerdict {
  allow: boolean;
  state: ModerationState;
  reason: string;
  fixture_id: string | null;
  checked_at: string;
}

function verdict(state: ModerationState, reason: string, fixture_id?: string | null): ModerationVerdict {
  const v: ModerationVerdict = {
    allow: state === 'allow',
    state,
    reason,
    fixture_id: fixture_id ?? null,
    checked_at: new Date().toISOString()
  };
  console.info('[moderation] verdict', JSON.stringify(v));
  return v;
}

export async function moderate(input: ModerationInput): Promise<ModerationVerdict> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return verdict('unavailable', 'no_api_key', input.fixture_id);

  const parts: Array<Record<string, unknown>> = [{ text: PROMPT }];
  if (input.text) parts.push({ text: `Text to classify:\n${input.text}` });
  if (input.image) {
    parts.push({ inline_data: { mime_type: input.image.mime_type, data: input.image.data_base64 } });
  }
  if (parts.length === 1) return verdict('allow', 'nothing_to_classify', input.fixture_id);

  let answer: string;
  try {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0, response_mime_type: 'application/json' }
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) return verdict('unavailable', `http_${res.status}`, input.fixture_id);
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    answer = body.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'error';
    return verdict('unavailable', reason, input.fixture_id);
  }

  try {
    const parsed = JSON.parse(answer) as { allow?: unknown; reason?: unknown };
    if (parsed.allow === true) return verdict('allow', 'classifier_allow', input.fixture_id);
    if (parsed.allow === false) {
      return verdict('block', typeof parsed.reason === 'string' ? parsed.reason : 'classifier_block', input.fixture_id);
    }
  } catch {
    // unreadable answer — fall through to fail-closed
  }
  return verdict('unavailable', 'unreadable_answer', input.fixture_id);
}
