-- ===========================================================================
-- GTA Junk and Property Cleanout — video estimate log
-- ===========================================================================
-- Purpose: internal calibration only. This table exists so we can review how
-- well the AI reads a space and re-tune the buffer multipliers over time.
-- Nothing in here is ever shown to a customer.
--
-- Works on Neon, Supabase, or any Postgres 13+.
-- Set DATABASE_URL in Netlify env vars to activate (optional — the function
-- logs to Netlify Blobs regardless).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS estimates (
  id                        BIGSERIAL PRIMARY KEY,
  estimate_id               UUID        NOT NULL UNIQUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Input
  frame_count               SMALLINT    NOT NULL,
  client_ip_hash            TEXT,                   -- sha256, truncated. Not reversible.
  frames_storage_path       TEXT,                   -- Netlify Blobs prefix for the frames

  -- What the model saw
  detected_items            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  estimated_cubic_yards     NUMERIC(7,2),
  estimated_onsite_minutes  INTEGER,
  hazard_flags              JSONB       NOT NULL DEFAULT '[]'::jsonb,
  visibility_confidence     TEXT        CHECK (visibility_confidence IN ('high','medium','low')),
  confidence_note           TEXT,

  -- What we did with it (the calibration columns)
  buffer_applied            NUMERIC(4,2),           -- 1.10 or 1.20; NULL when withheld
  buffered_signal           NUMERIC(10,2),
  buffered_hours            NUMERIC(6,2),
  tier_assigned             TEXT        CHECK (tier_assigned IN ('clear-out','standard-reset','pristine-transformation')),
  price_low_shown           INTEGER,
  price_high_shown          INTEGER,
  price_withheld_reason     TEXT,                   -- 'low_visibility' | 'scope_requires_valuation'

  -- Customer (all optional)
  contact_name              TEXT,
  contact_phone             TEXT,
  contact_email             TEXT,
  contact_city              TEXT,
  contact_notes             TEXT,

  -- Filled in by you after the job, to close the calibration loop
  actual_tier               TEXT,
  actual_price_charged      NUMERIC(10,2),
  actual_onsite_minutes     INTEGER,
  outcome_notes             TEXT,
  reviewed_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_estimates_created     ON estimates (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_estimates_tier        ON estimates (tier_assigned);
CREATE INDEX IF NOT EXISTS idx_estimates_confidence  ON estimates (visibility_confidence);
CREATE INDEX IF NOT EXISTS idx_estimates_unreviewed  ON estimates (reviewed_at) WHERE reviewed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_estimates_contact     ON estimates (contact_phone) WHERE contact_phone IS NOT NULL;

-- ---------------------------------------------------------------------------
-- CALIBRATION QUERIES — run these monthly once you have ~30 completed jobs
-- ---------------------------------------------------------------------------

-- 1. Are we reading low, high, or about right? (the key question)
--    Negative delta = we under-quoted = buffer needs raising.
/*
SELECT
  visibility_confidence,
  COUNT(*)                                                   AS jobs,
  ROUND(AVG(actual_price_charged - price_high_shown), 2)      AS avg_delta_vs_high,
  ROUND(AVG(actual_onsite_minutes - estimated_onsite_minutes), 1) AS avg_minutes_missed
FROM estimates
WHERE actual_price_charged IS NOT NULL
GROUP BY visibility_confidence
ORDER BY visibility_confidence;
*/

-- 2. How often did the on-site tier differ from what the video predicted?
/*
SELECT tier_assigned, actual_tier, COUNT(*) AS n
FROM estimates
WHERE actual_tier IS NOT NULL
GROUP BY tier_assigned, actual_tier
ORDER BY n DESC;
*/

-- 3. What proportion of walkthroughs are unusable? (>25% means the filming
--    tips on the page need rewriting, not the model.)
/*
SELECT
  visibility_confidence,
  COUNT(*) AS n,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM estimates
GROUP BY visibility_confidence;
*/

-- 4. Estimates that never converted — worth a follow-up call.
/*
SELECT created_at, contact_name, contact_phone, contact_city,
       tier_assigned, price_low_shown, price_high_shown
FROM estimates
WHERE actual_price_charged IS NULL
  AND contact_phone IS NOT NULL
  AND created_at > now() - INTERVAL '30 days'
ORDER BY created_at DESC;
*/
