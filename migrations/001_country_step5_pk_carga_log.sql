-- Paso 5 de 5: cambiar PK de carga_log. Fin de la migración multi-país.

ALTER TABLE carga_log ALTER PRIMARY KEY USING COLUMNS (country, periodo);
