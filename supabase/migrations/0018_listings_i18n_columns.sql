-- Migration 0018: Add 5-language i18n columns to tbl_external_raia_listings (L3-9)
ALTER TABLE public.tbl_external_raia_listings
  ADD COLUMN IF NOT EXISTS marketing_description_th TEXT,
  ADD COLUMN IF NOT EXISTS marketing_description_ja TEXT,
  ADD COLUMN IF NOT EXISTS marketing_description_ms TEXT,
  ADD COLUMN IF NOT EXISTS marketing_description_zh TEXT,
  ADD COLUMN IF NOT EXISTS i18n_source_hash TEXT,
  ADD COLUMN IF NOT EXISTS i18n_status TEXT NOT NULL DEFAULT 'pending' CHECK (i18n_status IN ('pending', 'ok', 'failed'));
