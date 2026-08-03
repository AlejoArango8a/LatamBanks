-- ============================================================
-- 008 — Curated executive bank profiles (multi-country)
-- PK aligns with instituciones: (country ISO, codigo)
-- Live metrics (assets / equity / ROE 3y) are NOT stored here;
-- they are computed from datos_financieros at request time.
-- ============================================================

CREATE TABLE IF NOT EXISTS bank_profiles (
  country              STRING NOT NULL,
  codigo               INT8   NOT NULL,
  short_name           STRING,
  legal_name           STRING,
  founded              STRING,
  ownership            STRING,
  controlling          STRING,
  shareholders         JSONB,
  origin_country       STRING,
  origin_country_name  STRING,
  employees_in_country INT8,
  employees_as_of      STRING,
  business_focus       STRING,
  hq_city              STRING,
  history              STRING,
  context              STRING,
  website              STRING,
  ir_url               STRING,
  ratings              JSONB,
  news                 JSONB,
  sources              JSONB,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (country, codigo)
);

CREATE INDEX IF NOT EXISTS bank_profiles_origin_idx ON bank_profiles (origin_country);
