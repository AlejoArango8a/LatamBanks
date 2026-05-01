-- =============================================================================
-- Corrección: instituciones — mismo "codigo" en Chile y Colombia
-- =============================================================================
-- Si SHOW CREATE TABLE instituciones muestra algo como:
--   PRIMARY KEY (country, codigo)   ✅ correcto
--   UNIQUE INDEX instituciones_codigo_key (codigo)   ❌ sobra — bloquea Colombia
--
-- Ejecuta UNA de las siguientes hasta que alguna aplique sin error (Cockroach
-- puede usar distinta sintaxis por versión). Luego vuelve a correr:
--   python colombia_loader.py --institutions-plan
--
-- =============================================================================

DROP INDEX IF EXISTS instituciones@instituciones_codigo_key CASCADE;

-- Si la línea anterior falló por sintaxis, prueba:
-- DROP INDEX IF EXISTS instituciones_codigo_key CASCADE;

-- ─── Opcional si lo anterior no existe como índice sino como constraint ─────
-- ALTER TABLE instituciones DROP CONSTRAINT IF EXISTS instituciones_codigo_key;


-- ─── Solo si no ves PRIMARY KEY (country, codigo) en SHOW CREATE ─────────────
-- ALTER TABLE instituciones ALTER PRIMARY KEY USING COLUMNS (country, codigo);
