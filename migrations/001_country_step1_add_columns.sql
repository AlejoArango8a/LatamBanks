-- Paso 1 (alternativa rápida): las 4 columnas en un solo pegado.
-- Si luego el paso 2 falla con "undergoing a schema change", usa en su lugar
-- los archivos step1a … step1d y luego step1_wait_for_jobs.sql.

ALTER TABLE datos_financieros ADD COLUMN IF NOT EXISTS country STRING NOT NULL DEFAULT 'CL';
ALTER TABLE instituciones ADD COLUMN IF NOT EXISTS country STRING NOT NULL DEFAULT 'CL';
ALTER TABLE plan_cuentas ADD COLUMN IF NOT EXISTS country STRING NOT NULL DEFAULT 'CL';
ALTER TABLE carga_log ADD COLUMN IF NOT EXISTS country STRING NOT NULL DEFAULT 'CL';
