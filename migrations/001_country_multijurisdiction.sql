-- Multi-country rows: CL (Chile CMF default) + CO (Colombia Socrata CUIF).
-- Run manually after backup against CockroachDB / Postgres-compatible.
-- Existing rows get country = CL via DEFAULT on ADD COLUMN.

ALTER TABLE datos_financieros ADD COLUMN IF NOT EXISTS country STRING NOT NULL DEFAULT 'CL';
ALTER TABLE instituciones ADD COLUMN IF NOT EXISTS country STRING NOT NULL DEFAULT 'CL';
ALTER TABLE plan_cuentas ADD COLUMN IF NOT EXISTS country STRING NOT NULL DEFAULT 'CL';
ALTER TABLE carga_log ADD COLUMN IF NOT EXISTS country STRING NOT NULL DEFAULT 'CL';

ALTER TABLE datos_financieros ALTER PRIMARY KEY USING COLUMNS (country, periodo, tipo, ins_cod, cuenta);
ALTER TABLE instituciones ALTER PRIMARY KEY USING COLUMNS (country, codigo);
ALTER TABLE plan_cuentas ALTER PRIMARY KEY USING COLUMNS (country, cuenta);
ALTER TABLE carga_log ALTER PRIMARY KEY USING COLUMNS (country, periodo);
