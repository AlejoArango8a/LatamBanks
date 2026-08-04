-- ============================================================
-- 009 — Cached BTG franchise snapshot (stale-while-revalidate)
-- One row holds the last successful /api/btg-banks/snapshot payload
-- so the UI can paint immediately without re-aggregating 6 countries.
-- ============================================================

CREATE TABLE IF NOT EXISTS btg_franchise_snapshot_cache (
  cache_key   STRING PRIMARY KEY,
  payload     JSONB NOT NULL,
  built_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
