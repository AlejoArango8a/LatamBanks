-- Paso 4 de 5: cambiar PK de plan_cuentas.

ALTER TABLE plan_cuentas ALTER PRIMARY KEY USING COLUMNS (country, cuenta);
