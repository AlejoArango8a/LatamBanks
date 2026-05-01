-- Paso 1b: SOLO instituciones.

ALTER TABLE instituciones ADD COLUMN IF NOT EXISTS country STRING NOT NULL DEFAULT 'CL';
