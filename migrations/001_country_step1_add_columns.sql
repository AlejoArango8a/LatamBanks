-- Paso 1 de 5: añadir columna country (solo esto). Ejecutar y esperar OK.

ALTER TABLE datos_financieros ADD COLUMN IF NOT EXISTS country STRING NOT NULL DEFAULT 'CL';
ALTER TABLE instituciones ADD COLUMN IF NOT EXISTS country STRING NOT NULL DEFAULT 'CL';
ALTER TABLE plan_cuentas ADD COLUMN IF NOT EXISTS country STRING NOT NULL DEFAULT 'CL';
ALTER TABLE carga_log ADD COLUMN IF NOT EXISTS country STRING NOT NULL DEFAULT 'CL';
