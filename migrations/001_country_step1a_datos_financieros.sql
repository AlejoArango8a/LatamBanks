-- Paso 1a: SOLO tabla datos_financieros. Ejecutar; esperar mensaje OK.

ALTER TABLE datos_financieros ADD COLUMN IF NOT EXISTS country STRING NOT NULL DEFAULT 'CL';
