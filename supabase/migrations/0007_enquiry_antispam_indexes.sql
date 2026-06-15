-- 0007: supporting indexes for the enquiry anti-spam counters.
--
-- createEnquiry() (src/lib/enquiry.ts) runs two COUNT queries before every
-- insert to enforce duplicate suppression and a per-email hourly cap:
--   • (raia_id, enquirer_email, submitted_at)  → duplicate within a short window
--   • (enquirer_email, submitted_at)           → volume per sender per hour
-- These indexes keep those lookups cheap as tbl_enquiries grows. The guards
-- work without them (sequential scan); this is a performance-at-scale measure.
--
-- Emails are stored normalised (trim + lower-case) by the application, so plain
-- B-tree indexes on the column are sufficient — no functional index needed.

create index if not exists idx_enquiries_email_submitted
  on public.tbl_enquiries (enquirer_email, submitted_at desc);

create index if not exists idx_enquiries_raia_email_submitted
  on public.tbl_enquiries (raia_id, enquirer_email, submitted_at desc);
