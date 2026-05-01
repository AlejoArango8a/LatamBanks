-- Paso 2 de 5: cambiar PK de datos_financieros (solo esta línea en este paso).

ALTER TABLE datos_financieros ALTER PRIMARY KEY USING COLUMNS (country, periodo, tipo, ins_cod, cuenta);
