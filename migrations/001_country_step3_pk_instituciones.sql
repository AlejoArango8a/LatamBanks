-- Paso 3 de 5: cambiar PK de instituciones.

ALTER TABLE instituciones ALTER PRIMARY KEY USING COLUMNS (country, codigo);
