-- Paso 2 de 5: cambiar PK de datos_financieros (solo esta línea en este paso).
-- ANTES: ejecuta 001_country_step1_wait_for_jobs.sql y espera a que no queden
-- trabajos de esquema "running" sobre datos_financieros (si no, error típico:
-- "table datos_financieros is currently undergoing a schema change").

ALTER TABLE datos_financieros ALTER PRIMARY KEY USING COLUMNS (country, periodo, tipo, ins_cod, cuenta);
