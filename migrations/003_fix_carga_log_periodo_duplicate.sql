-- =============================================================================
-- Corrección: carga_log — mismo periodo YYYYMM en Chile y Colombia
-- =============================================================================
-- Error típico al cargar histórico Colombia:
--   duplicate key ... carga_log_periodo_key ... Key (periodo)=('202201') already exists.
--
-- PRIMARY KEY debe ser sólo (country, periodo). Si queda UNIQUE sólo-periodo:
--
DROP INDEX IF EXISTS carga_log@carga_log_periodo_key CASCADE;

-- Si falló por sintaxis:
-- DROP INDEX IF EXISTS carga_log_periodo_key CASCADE;
