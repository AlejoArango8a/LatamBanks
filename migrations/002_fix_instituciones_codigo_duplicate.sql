-- =============================================================================
-- Corrección: instituciones con código repetido entre Chile y Colombia
-- =============================================================================
-- Error típico al cargar Colombia:
--   duplicate key ... instituciones_codigo_key ... Key (codigo)=(1) already exists.
--
-- Causa: la tabla debe identificar cada banco como (country, codigo). Si sigue
-- existiendo unicidad sólo sobre "codigo", dos países no pueden tener el mismo número.
--
-- QUÉ HACER (con calma):
--
--  A) Ejecuta primero:
--       SHOW CREATE TABLE instituciones;
--
--  B) Interpreta PRIMARY KEY:
--       • Si solo aparece codigo sin country → ejecuta sólo la línea del BLOQUE 1.
--       • Si ya aparece (country, codigo) y el cargador igual falló → ejecuta el
--         comentario del BLOQUE 2 (quita los -- delante) tras confirmar nombre.
--
-- =============================================================================

-- ─── BLOQUE 1: clave principal = país + código (migration paso 3) ────────────

ALTER TABLE instituciones ALTER PRIMARY KEY USING COLUMNS (country, codigo);


-- ─── BLOQUE 2: unicidad vieja sólo-sobre-codigo (solo si hace falta) ─────────
-- Ejecutar sin los guiones `--` sólo después de revisar SHOW CREATE TABLE.

-- ALTER TABLE instituciones DROP CONSTRAINT IF EXISTS instituciones_codigo_key;
