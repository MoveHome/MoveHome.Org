-- 0009_a2a_registry_cron.sql
--
-- Schedules the registry health worker from Supabase using pg_cron + pg_net,
-- calling the secret-protected Next.js endpoint every 30 minutes.
--
-- PREREQUISITES (run once before this):
--   1. Enable extensions: Dashboard → Database → Extensions → enable `pg_cron` + `pg_net`
--      (or: create extension if not exists pg_cron; create extension if not exists pg_net;).
--
-- SECRET HANDLING — important:
--   `alter database … set app.registry_cron_secret` requires superuser and is BLOCKED
--   for the SQL-editor / Management-API role on Supabase, so we inline the secret in the
--   job command below. Replace <REGISTRY_CRON_SECRET> with the SAME value set as the
--   Vercel env REGISTRY_CRON_SECRET. (Do NOT commit the real secret — keep it a placeholder
--   here.) For a hardened setup, store it in Supabase Vault and read it via
--   `vault.decrypted_secrets` in the job command instead of inlining.
--
-- Re-running is safe: we unschedule any existing job of the same name first.

select cron.unschedule('a2a-registry-health')
where exists (select 1 from cron.job where jobname = 'a2a-registry-health');

select cron.schedule(
  'a2a-registry-health',
  '*/30 * * * *',
  $job$
  select net.http_post(
    url     := 'https://movehome.org/api/registry/cron/health',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <REGISTRY_CRON_SECRET>'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
