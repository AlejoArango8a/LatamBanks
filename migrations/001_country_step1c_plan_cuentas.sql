-- Paso 1c: SOLO plan_cuentas.

ALTER TABLE plan_cuentas ADD COLUMN IF NOT EXISTS country STRING NOT NULL DEFAULT 'CL';
