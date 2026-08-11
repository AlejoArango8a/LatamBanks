-- ============================================================
-- 010 — Calificaciones de riesgo por banco y calificadora
--
-- Sustituye a data/bank_ratings.json como fuente de verdad: el archivo del
-- repositorio queda solo como respaldo y como semilla inicial.
--
-- Guarda únicamente el estado vigente. No hay historial por decisión de
-- producto: interesa la calificación actual de cada banco, no su evolución.
--
-- `agency` es la clave de la columna tal como la define RATING_AGENCIES en
-- js/ratings.js: en Chile 'fitch_cl', 'feller', 'humphreys', 'fitch', 'moodys',
-- 'sp'; en el resto de los países 'local' e 'international'. Se guarda como
-- texto y no como enum para que agregar una calificadora sea un cambio de front
-- y no una migración.
--
-- `agency_name` es distinto: es quién firma la nota. Hace falta porque en las
-- columnas genéricas 'local' e 'international' la calificadora cambia según el
-- banco ('BRC Ratings', 'Fitch / BRC'), y esa precisión es justamente lo que se
-- quiere auditar.
--
-- `rating` admite NULL a propósito: con status 'not_rated' se deja constancia
-- de que la calificadora no cubre a ese banco, que es distinto de no haberlo
-- revisado todavía (eso último es, simplemente, la ausencia de fila).
-- ============================================================

CREATE TABLE IF NOT EXISTS bank_ratings (
  country     STRING      NOT NULL,
  ins_cod     INT         NOT NULL,
  agency      STRING      NOT NULL,
  agency_name STRING,
  rating      STRING,
  outlook     STRING,
  as_of       STRING,
  status      STRING      NOT NULL DEFAULT 'unverified',
  source      STRING,
  note        STRING,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (country, ins_cod, agency),
  CONSTRAINT bank_ratings_status_check
    CHECK (status IN ('verified', 'unverified', 'not_rated'))
);

-- Nota de contexto por banco, no por celda: a qué calificadoras lo cubren, qué
-- quedó pendiente de contrastar. Va en su propia tabla porque no pertenece a
-- ninguna calificadora en particular.
CREATE TABLE IF NOT EXISTS bank_rating_notes (
  country     STRING      NOT NULL,
  ins_cod     INT         NOT NULL,
  note        STRING      NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (country, ins_cod)
);
