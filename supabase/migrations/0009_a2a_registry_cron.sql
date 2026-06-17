-- 0009_a2a_registry_cron.sql
--
-- Schedules the registry health worker from Supabase using pg_cron + pg_net,
-- calling the secret-protected Next.js endpoint every 30 minutes.
--
-- PREREQUISITES (run once, in the Supabase dashboard or SQL editor, before this):
--   1. Enable extensions:  Dashboard → Database → Extensions → enable `pg_cron` + `pg_net`.
--   2. Store the shared secret (same value as the Vercel env REGISTRY_CRON_SECRET):
--        alter database postgres set app.registry_cron_secret = '<the-secret>';
--      (a DB setting keeps the secret out of source control / this migration).
--
-- Re-running is safe: we unschedule any existing job of the same name first.

select cron.unschedule('a2a-registry-health')
where exists (select 1 from cron.job where jobname = 'a2a-registry-health');

select cron.schedule(
  'a2a-registry-health',
  '*/30 * * * *',
  $$
  select net.http_post(
    url     := 'https://movehome.org/api/registry/cron/health',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.registry_cron_secret', true)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
