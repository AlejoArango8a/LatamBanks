-- Índices únicos legacy (pre multi-país) que colisionan entre jurisdicciones
-- cuando la misma cuenta/código se usa en AR/PE/MX/US/etc.
-- La PK correcta ya es compuesta con country.

DROP INDEX IF EXISTS plan_cuentas_cuenta_key CASCADE;
DROP INDEX IF EXISTS datos_financieros_periodo_tipo_ins_cod_cuenta_key CASCADE;
