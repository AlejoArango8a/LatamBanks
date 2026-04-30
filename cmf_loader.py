#!/usr/bin/env python3
"""
cmf_loader.py
Librería de procesamiento: parsea los TXT dentro de un ZIP de la CMF
y carga los datos en CockroachDB.

Uso directo: ver cargar_zip.py
"""

import os
import re
import io
import zipfile
import logging
from pathlib import Path
from dotenv import load_dotenv
import psycopg2
import psycopg2.extras

# Carga automáticamente el archivo .env si existe en la raíz del proyecto
load_dotenv(Path(__file__).parent / ".env")

# ============================================================
# CONFIGURACIÓN
# ============================================================
COCKROACH_URL = os.environ.get("COCKROACH_URL", "")

BATCH_SIZE = 500  # filas por insert

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger(__name__)

# ============================================================
# COCKROACHDB CONNECTION
# ============================================================
def get_connection():
    return psycopg2.connect(COCKROACH_URL)

# ============================================================
# PARSERS
# ============================================================
def parse_plan_cuentas(text: str) -> dict:
    result = {}
    for line in text.splitlines():
        parts = line.split('\t')
        if len(parts) < 2:
            continue
        cuenta = parts[0].strip()
        if re.match(r'^\d{9}$', cuenta):
            result[cuenta] = parts[1].strip()
    return result

def parse_instituciones(text: str) -> dict:
    result = {}
    for line in text.splitlines():
        parts = line.split('\t')
        if len(parts) < 2:
            continue
        try:
            code = int(parts[0].strip())
            result[code] = parts[1].strip()
        except ValueError:
            continue
    return result

def parse_data_file(text: str, tipo: str) -> tuple[int, dict]:
    """
    Retorna (ins_code, {cuenta: valores})
    Para b1: valores = [clp, uf, tc, ext]
    Para r1/c1: valores = int
    """
    lines = text.splitlines()
    if not lines:
        return None, {}

    header = lines[0].split('\t')
    if len(header) < 2:
        return None, {}
    try:
        ins_code = int(header[0].strip())
    except ValueError:
        return None, {}

    is_multi = tipo in ('b1', 'b2')
    data = {}

    for line in lines[1:]:
        parts = line.split('\t')
        if len(parts) < 2:
            continue
        cuenta = parts[0].strip()
        if not re.match(r'^\d{9}$', cuenta):
            continue

        if is_multi:
            vals = []
            for i in range(4):
                s = parts[i+1].strip() if i+1 < len(parts) else '0'
                try:
                    vals.append(int(s) if s else 0)
                except ValueError:
                    vals.append(0)
            data[cuenta] = vals
        else:
            s = parts[1].strip() if len(parts) > 1 else '0'
            try:
                data[cuenta] = int(s) if s else 0
            except ValueError:
                data[cuenta] = 0

    return ins_code, data

# ============================================================
# DETECTAR PERÍODO DESDE EL CONTENIDO DEL ZIP
# ============================================================
def detect_periodo(zf: zipfile.ZipFile) -> str | None:
    """
    Infiere el período (YYYYMM) desde los nombres de archivos de datos
    dentro del ZIP (ej: b1202503001.txt → '202503').
    """
    data_pattern = re.compile(r'^(b1|b2|r1|c1|c2)(\d{6})\d{3}\.txt$', re.IGNORECASE)
    for name in zf.namelist():
        fname = name.split('/')[-1]
        m = data_pattern.match(fname)
        if m:
            return m.group(2)
    return None

# ============================================================
# PROCESAR UN ZIP
# ============================================================
def process_zip(zip_bytes: bytes, periodo: str, conn) -> int:
    """Procesa un ZIP y carga los datos en CockroachDB. Retorna número de archivos."""
    log.info(f"Procesando ZIP período {periodo}...")

    cur = conn.cursor()

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()

        instituciones = {}
        plan_cuentas  = {}

        for name in names:
            fname = name.split('/')[-1].lower()
            if fname == 'listado_instituciones.txt':
                text = zf.read(name).decode('utf-8', errors='replace')
                instituciones = parse_instituciones(text)
            elif fname == 'plan_de_cuentas.txt':
                text = zf.read(name).decode('utf-8', errors='replace')
                plan_cuentas = parse_plan_cuentas(text)

        if instituciones:
            rows_t = [(k, v) for k, v in instituciones.items()]
            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO instituciones (codigo, razon_social) VALUES %s "
                "ON CONFLICT (codigo) DO UPDATE SET razon_social = EXCLUDED.razon_social",
                rows_t,
            )
            conn.commit()
            log.info(f"  Instituciones: {len(rows_t)} registros")

        if plan_cuentas:
            rows_t = [(k, v) for k, v in plan_cuentas.items()]
            for i in range(0, len(rows_t), BATCH_SIZE):
                psycopg2.extras.execute_values(
                    cur,
                    "INSERT INTO plan_cuentas (cuenta, descripcion) VALUES %s "
                    "ON CONFLICT (cuenta) DO UPDATE SET descripcion = EXCLUDED.descripcion",
                    rows_t[i:i+BATCH_SIZE],
                )
            conn.commit()
            log.info(f"  Plan de cuentas: {len(rows_t)} registros")

        data_pattern = re.compile(r'^(b1|b2|r1|c1|c2)(\d{6})(\d{3})\.txt$', re.IGNORECASE)
        file_count = 0
        all_tuples = []

        for name in names:
            fname = name.split('/')[-1]
            m = data_pattern.match(fname)
            if not m:
                continue

            tipo = m.group(1).lower()
            if tipo not in ('b1', 'r1', 'c1'):
                continue  # Skip b2, c2

            text = zf.read(name).decode('utf-8', errors='replace')
            ins_code, data = parse_data_file(text, tipo)
            if ins_code is None:
                continue

            is_multi = tipo == 'b1'

            for cuenta, vals in data.items():
                if is_multi:
                    all_tuples.append((
                        periodo, tipo, ins_code, cuenta,
                        vals[0] if len(vals) > 0 else 0,
                        vals[1] if len(vals) > 1 else 0,
                        vals[2] if len(vals) > 2 else 0,
                        vals[3] if len(vals) > 3 else 0,
                        sum(vals),
                    ))
                else:
                    all_tuples.append((
                        periodo, tipo, ins_code, cuenta,
                        0, 0, 0, 0, vals,
                    ))

            file_count += 1

        log.info(f"  Insertando {len(all_tuples)} filas ({file_count} archivos)...")

        INSERT_SQL = (
            "INSERT INTO datos_financieros "
            "(periodo, tipo, ins_cod, cuenta, monto_clp, monto_uf, monto_tc, monto_ext, monto_total) "
            "VALUES %s "
            "ON CONFLICT (periodo, tipo, ins_cod, cuenta) DO UPDATE SET "
            "monto_clp   = EXCLUDED.monto_clp, "
            "monto_uf    = EXCLUDED.monto_uf, "
            "monto_tc    = EXCLUDED.monto_tc, "
            "monto_ext   = EXCLUDED.monto_ext, "
            "monto_total = EXCLUDED.monto_total"
        )
        for i in range(0, len(all_tuples), BATCH_SIZE):
            psycopg2.extras.execute_values(cur, INSERT_SQL, all_tuples[i:i+BATCH_SIZE])
        conn.commit()

        cur.execute(
            "INSERT INTO carga_log (periodo, archivos_procesados, estado) VALUES (%s, %s, %s) "
            "ON CONFLICT (periodo) DO UPDATE SET "
            "archivos_procesados = EXCLUDED.archivos_procesados, "
            "estado = EXCLUDED.estado",
            (periodo, file_count, "ok"),
        )
        conn.commit()

        log.info(f"  ✓ Período {periodo} completado — {file_count} archivos, {len(all_tuples)} filas")
        return file_count

# ============================================================
# PERÍODOS YA CARGADOS
# ============================================================
def get_loaded_periods(conn) -> set:
    cur = conn.cursor()
    cur.execute("SELECT periodo FROM carga_log WHERE estado = 'ok'")
    return {row[0] for row in cur.fetchall()}
