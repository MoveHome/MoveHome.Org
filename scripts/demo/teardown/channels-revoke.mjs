// Stage 5 — CHANNELS. Telegram revocation is a sequence, not webhook deletion.
// WhatsApp is conditional; leased release differs from owned restore.
import { runStageCli } from './lib.mjs';

export async function run({ register, manifest, provider, now = new Date() }) {
  const checks = [];
  const push = (check, ok, detail) => checks.push({ check, ok: Boolean(ok), detail });

  // ── Telegram ──────────────────────────────────────────────────────────────
  const identity = await provider.telegram.identity();
  push('telegram_identity_matches_register', Boolean(identity?.id), `bot ${identity?.username ?? 'unknown'}`);

  const webhook = await provider.telegram.webhookInfo();
  if (webhook.url) await provider.telegram.deleteWebhook();
  const webhookAfter = await provider.telegram.webhookInfo();
  push('telegram_webhook_absent', webhookAfter.url === '', webhookAfter.url ? 'still registered' : 'absent');

  const revoke = await provider.telegram.revokeToken();
  const oldTokenWorks = await provider.telegram.oldTokenAuthorised();
  // Webhook deletion alone leaves the credential working: not revocation.
  push('telegram_old_token_unauthorised', oldTokenWorks === false, oldTokenWorks ? 'old token still authorised' : 'unauthorised');

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  const wa = await provider.whatsapp.status();
  let whatsapp;
  if (!wa.provisioned) {
    whatsapp = {
      branch: 'NOT_PROVISIONED',
      status: 'PASS',
      evidence: wa.evidence ?? 'provider readback: absent'
    };
    push('whatsapp_not_provisioned_proved', Boolean(whatsapp.evidence), whatsapp.evidence);
  } else {
    const disabled = await provider.whatsapp.disableWebhook();
    push('whatsapp_webhook_disabled', disabled?.ok === true, String(disabled?.ok));
    const revoked = await provider.whatsapp.revokeToken();
    push('whatsapp_token_revoked', revoked?.ok === true, String(revoked?.status));
    const stillWorks = await provider.whatsapp.oldTokenAuthorised();
    push('whatsapp_old_token_unauthorised', stillWorks === false, stillWorks ? 'old token still authorised' : 'unauthorised');

    const ownership = wa.ownership;
    const disposition = await provider.whatsapp.numberDisposition({
      ownership,
      release: ownership === 'temporary_release'
    });
    push('number_disposition_correct', disposition?.ok === true, disposition?.detail ?? 'no detail');
    if (ownership === 'owned_restore') {
      push('owned_number_not_released', disposition?.released === false, String(disposition?.released));
    }
    whatsapp = {
      branch: ownership === 'owned_restore' ? 'PROVISIONED_OWNED_RESTORE' : 'PROVISIONED_TEMPORARY_RELEASE',
      status: checks.every((check) => check.ok) ? 'PASS' : 'FAIL',
      token_revoked: revoked?.ok === true,
      number_disposition: disposition?.detail,
      released: disposition?.released === true
    };
  }

  const status = checks.every((check) => check.ok) ? 'PASS' : 'FAIL';
  return {
    stage: 'CHANNELS',
    status,
    ts: now.toISOString(),
    run_id: manifest.teardown_run_id,
    telegram: {
      identity_verified: Boolean(identity?.id),
      webhook_absent: webhookAfter.url === '',
      revoke_status: revoke?.status ?? 'UNKNOWN',
      old_token_authorised: oldTokenWorks
    },
    whatsapp,
    checks
  };
}

export const ok = (result) => result.status === 'PASS';

if (typeof process !== 'undefined') {
  await runStageCli('CHANNELS', 'channels.json', run, import.meta.url);
}
