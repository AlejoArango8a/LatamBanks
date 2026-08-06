#!/usr/bin/env python3
"""
cmf_loader.py
Librería de procesamiento: parsea los TXT dentro de un ZIP de la CMF
y carga los datos en CockroachDB.

Soporta dos eras del Compendio de Normas Contables para Bancos (CNCB):
  - < 202201  → CNCB 2021: códigos 7 dígitos, montos en millones, B1/R1 multi-columna
  - ≥ 202201  → CNCB 2022 (Circular 2.243): códigos 9 dígitos, montos en pesos

Para la era 2021 se emiten además cuentas-puente 9 dígitos (DE/PARA KPI) para
que Bank Monitor / Funding / AQ puedan leer la misma lista de códigos post-IFRS.
Ver data/cl_cncb2021_depara.json y HANDOFF_CL_Pre2022_Continuity.md.

Uso directo: ver cargar_zip.py / chile_loader.py
"""

from __future__ import annotations

import json
import os
import re
import io
import zipfile
import logging
from pathlib import Path
from dotenv import load_dotenv
import psycopg2
import psycopg2.extras

from schema_guard import detect_schema_changes, get_known_accounts, record_schema_result

load_dotenv(Path(__file__).parent / ".env")

COCKROACH_URL = os.environ.get("COCKROACH_URL", "")
BATCH_SIZE = 500
CNCB2022_START = "202201"
MILLIONS_SCALE = 1_000_000
DEPARA_PATH = Path(__file__).parent / "data" / "cl_cncb2021_depara.json"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)


def get_connection():
    return psycopg2.connect(COCKROACH_URL)


def is_cncb2021(periodo: str) -> bool:
    return bool(periodo) and periodo < CNCB2022_START


def load_depara() -> list[dict]:
    if not DEPARA_PATH.is_file():
        log.warning("DE/PARA missing: %s", DEPARA_PATH)
        return []
    data = json.loads(DEPARA_PATH.read_text(encoding="utf-8"))
    return list(data.get("bridges") or [])


def parse_cmf_amount(s: str, scale: int = 1) -> int:
    """Parse CMF amount cell → int pesos (after optional millions scale)."""
    s = (s or "").strip().replace(" ", "")
    if not s:
        return 0
    neg = s.startswith("-")
    if neg:
        s = s[1:].lstrip()
    if not s:
        return 0
    try:
        if "," in s:
            # millones style: 0000026995865,00  (dot thousands rare; comma decimals)
            s = s.replace(".", "").replace(",", ".")
            val = float(s)
        else:
            val = float(s)
    except ValueError:
        return 0
    out = int(round(val * scale))
    return -out if neg else out


def parse_plan_cuentas(text: str) -> dict:
    """Accept plan_de_cuentas.txt (9d) and PLAN-CTAS.TXT (YYYY\\tMM\\tcuenta\\tdesc)."""
    result = {}
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        # Modern / simple: cuenta\\tdesc
        c0 = parts[0].strip()
        if re.match(r"^\d{7,9}$", c0):
            result[c0] = parts[1].strip()
            continue
        # PLAN-CTAS: YYYY MM cuenta desc
        if len(parts) >= 4:
            c2 = parts[2].strip()
            if re.match(r"^\d{7,9}$", c2):
                result[c2] = parts[3].strip()
    return result


def parse_instituciones(text: str) -> dict:
    result = {}
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        try:
            code = int(parts[0].strip())
            result[code] = parts[1].strip()
        except ValueError:
            continue
    return result


def parse_codifis(text: str) -> dict:
    """Parse Instrucciones/CODIFIS.TXT (pre-metadata era)."""
    result = {}
    for line in text.splitlines():
        m = re.match(r"^\s*(\d{1,3})\t+(.+?)\s*$", line)
        if not m:
            continue
        code = int(m.group(1))
        name = m.group(2).strip()
        if len(name) < 3:
            continue
        if name.upper().startswith("COD") or name.upper().startswith("RAZON"):
            continue
        result[code] = re.sub(r"\s+\(\d+\)\s*$", "", name).strip()
    return result


def parse_data_file(text: str, tipo: str, *, scale: int = 1, cncb2021: bool = False) -> tuple[int | None, dict]:
    """
    Retorna (ins_code, {cuenta: valores}).
    b1 (y r1 en CNCB2021): valores = [clp, uf, tc, ext]
    r1/c1 post-2022 y c1 CNCB2021: valores = int
    """
    lines = text.splitlines()
    if not lines:
        return None, {}

    header = lines[0].split("\t")
    if len(header) < 2:
        return None, {}
    try:
        ins_code = int(header[0].strip())
    except ValueError:
        return None, {}

    code_re = re.compile(r"^\d{7}$") if cncb2021 else re.compile(r"^\d{9}$")
    # CNCB2021 R1 uses the same 4 currency columns as B1 (LEAME + observed files).
    is_multi = tipo in ("b1", "b2") or (cncb2021 and tipo == "r1")
    data: dict = {}

    for line in lines[1:]:
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        cuenta = parts[0].strip()
        if not code_re.match(cuenta):
            continue

        if is_multi:
            vals = []
            for i in range(4):
                s = parts[i + 1] if i + 1 < len(parts) else "0"
                vals.append(parse_cmf_amount(s, scale))
            data[cuenta] = vals
        else:
            s = parts[1] if len(parts) > 1 else "0"
            data[cuenta] = parse_cmf_amount(s, scale)

    return ins_code, data


def detect_periodo(zf: zipfile.ZipFile) -> str | None:
    data_pattern = re.compile(r"^(b1|b2|r1|c1|c2)(\d{6})\d{3}\.txt$", re.IGNORECASE)
    for name in zf.namelist():
        fname = name.split("/")[-1]
        m = data_pattern.match(fname)
        if m:
            return m.group(2)
    return None


def _emit_bridge_rows(
    bridges: list[dict],
    by_tipo_ins: dict[tuple[str, int], dict],
    periodo: str,
) -> tuple[list[tuple], dict[str, str]]:
    """Synthesize post-IFRS 9-digit KPI accounts from CNCB2021 sources."""
    out: list[tuple] = []
    plan_extra: dict[str, str] = {}
    for br in bridges:
        target = str(br["target"])
        tipo = str(br["tipo"])
        sources = [str(s) for s in br.get("sources") or []]
        label = br.get("label") or f"bridge←{','.join(sources)}"
        plan_extra[target] = f"{label} [bridge:cncb2021]"
        institutions = {ins for (t, ins) in by_tipo_ins if t == tipo}
        for ins in institutions:
            native = by_tipo_ins.get((tipo, ins)) or {}
            if tipo == "b1":
                clp = uf = tc = ext = 0
                found = False
                for src in sources:
                    vals = native.get(src)
                    if vals is None:
                        continue
                    found = True
                    if isinstance(vals, list):
                        clp += vals[0] if len(vals) > 0 else 0
                        uf += vals[1] if len(vals) > 1 else 0
                        tc += vals[2] if len(vals) > 2 else 0
                        ext += vals[3] if len(vals) > 3 else 0
                    else:
                        clp += int(vals)
                if not found:
                    continue
                total = clp + uf + tc + ext
                out.append(("CL", periodo, tipo, ins, target, clp, uf, tc, ext, total))
            else:
                total = 0
                found = False
                for src in sources:
                    if src not in native:
                        continue
                    found = True
                    vals = native[src]
                    if isinstance(vals, list):
                        total += sum(vals)
                    else:
                        total += int(vals)
                if not found:
                    continue
                out.append(("CL", periodo, tipo, ins, target, 0, 0, 0, 0, total))
    return out, plan_extra


def process_zip(zip_bytes: bytes, periodo: str, conn) -> int:
    """Procesa un ZIP y carga los datos en CockroachDB. Retorna número de archivos."""
    log.info("Procesando ZIP período %s...", periodo)
    cncb2021 = is_cncb2021(periodo)
    scale = MILLIONS_SCALE if cncb2021 else 1
    if cncb2021:
        log.info("  Era CNCB2021 (7 dígitos, montos×%s → pesos, DE/PARA bridges)", scale)

    cur = conn.cursor()
    # Compare against chronologically previous period (critical for historical backfill).
    known_accounts = get_known_accounts(conn, "CL", before_periodo=periodo)

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()

        instituciones: dict = {}
        plan_cuentas: dict = {}

        for name in names:
            fname = name.split("/")[-1].lower()
            if fname == "listado_instituciones.txt":
                text = zf.read(name).decode("utf-8", errors="replace")
                instituciones = parse_instituciones(text)
            elif fname in ("plan_de_cuentas.txt", "plan-ctas.txt"):
                text = zf.read(name).decode("latin-1", errors="replace")
                plan_cuentas = parse_plan_cuentas(text)
            elif fname == "codifis.txt" and not instituciones:
                text = zf.read(name).decode("latin-1", errors="replace")
                instituciones = parse_codifis(text)

        if instituciones:
            rows_t = [("CL", k, v) for k, v in instituciones.items()]
            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO instituciones (country, codigo, razon_social) VALUES %s "
                "ON CONFLICT (country, codigo) DO UPDATE SET razon_social = EXCLUDED.razon_social",
                rows_t,
            )
            conn.commit()
            log.info("  Instituciones: %d registros", len(rows_t))

        data_pattern = re.compile(r"^(b1|b2|r1|c1|c2)(\d{6})(\d{3})\.txt$", re.IGNORECASE)
        file_count = 0
        all_tuples: list[tuple] = []
        by_tipo_ins: dict[tuple[str, int], dict] = {}

        for name in names:
            fname = name.split("/")[-1]
            m = data_pattern.match(fname)
            if not m:
                continue

            tipo = m.group(1).lower()
            if tipo not in ("b1", "r1", "c1"):
                continue

            text = zf.read(name).decode("latin-1", errors="replace")
            ins_code, data = parse_data_file(text, tipo, scale=scale, cncb2021=cncb2021)
            if ins_code is None:
                continue

            by_tipo_ins[(tipo, ins_code)] = data
            is_multi = tipo == "b1" or (cncb2021 and tipo == "r1")

            for cuenta, vals in data.items():
                if is_multi and isinstance(vals, list):
                    all_tuples.append(
                        (
                            "CL",
                            periodo,
                            tipo,
                            ins_code,
                            cuenta,
                            vals[0] if len(vals) > 0 else 0,
                            vals[1] if len(vals) > 1 else 0,
                            vals[2] if len(vals) > 2 else 0,
                            vals[3] if len(vals) > 3 else 0,
                            sum(vals),
                        )
                    )
                else:
                    v = vals if not isinstance(vals, list) else sum(vals)
                    all_tuples.append(("CL", periodo, tipo, ins_code, cuenta, 0, 0, 0, 0, v))

            file_count += 1

        bridge_plan: dict[str, str] = {}
        if cncb2021:
            bridges = load_depara()
            bridge_rows, bridge_plan = _emit_bridge_rows(bridges, by_tipo_ins, periodo)
            all_tuples.extend(bridge_rows)
            log.info("  Bridge rows emitted: %d (targets=%d)", len(bridge_rows), len(bridges))

        if plan_cuentas or bridge_plan:
            merged = dict(plan_cuentas)
            merged.update(bridge_plan)
            # Also label native 7d accounts if missing from plan parse
            rows_t = [("CL", k, v) for k, v in merged.items()]
            for i in range(0, len(rows_t), BATCH_SIZE):
                psycopg2.extras.execute_values(
                    cur,
                    "INSERT INTO plan_cuentas (country, cuenta, descripcion) VALUES %s "
                    "ON CONFLICT (country, cuenta) DO UPDATE SET descripcion = EXCLUDED.descripcion",
                    rows_t[i : i + BATCH_SIZE],
                )
            conn.commit()
            log.info("  Plan de cuentas: %d registros", len(rows_t))

        log.info("  Insertando %d filas (%d archivos)...", len(all_tuples), file_count)

        INSERT_SQL = (
            "INSERT INTO datos_financieros "
            "(country, periodo, tipo, ins_cod, cuenta, monto_clp, monto_uf, monto_tc, monto_ext, monto_total) "
            "VALUES %s "
            "ON CONFLICT (country, periodo, tipo, ins_cod, cuenta) DO UPDATE SET "
            "monto_clp   = EXCLUDED.monto_clp, "
            "monto_uf    = EXCLUDED.monto_uf, "
            "monto_tc    = EXCLUDED.monto_tc, "
            "monto_ext   = EXCLUDED.monto_ext, "
            "monto_total = EXCLUDED.monto_total"
        )
        for i in range(0, len(all_tuples), BATCH_SIZE):
            psycopg2.extras.execute_values(cur, INSERT_SQL, all_tuples[i : i + BATCH_SIZE])
        conn.commit()

        detalle = None
        if cncb2021:
            detalle = json.dumps(
                {
                    "coa": "cncb2021",
                    "unit": "millones→pesos",
                    "scale": MILLIONS_SCALE,
                    "bridges": True,
                }
            )
            # Prefer detalle column when present
            try:
                cur.execute(
                    "INSERT INTO carga_log (country, periodo, archivos_procesados, estado, detalle) "
                    "VALUES (%s, %s, %s, %s, %s::jsonb) "
                    "ON CONFLICT (country, periodo) DO UPDATE SET "
                    "archivos_procesados = EXCLUDED.archivos_procesados, "
                    "estado = EXCLUDED.estado, "
                    "detalle = EXCLUDED.detalle",
                    ("CL", periodo, file_count, "ok", detalle),
                )
            except Exception:
                conn.rollback()
                cur.execute(
                    "INSERT INTO carga_log (country, periodo, archivos_procesados, estado) VALUES (%s, %s, %s, %s) "
                    "ON CONFLICT (country, periodo) DO UPDATE SET "
                    "archivos_procesados = EXCLUDED.archivos_procesados, "
                    "estado = EXCLUDED.estado",
                    ("CL", periodo, file_count, "ok"),
                )
        else:
            cur.execute(
                "INSERT INTO carga_log (country, periodo, archivos_procesados, estado) VALUES (%s, %s, %s, %s) "
                "ON CONFLICT (country, periodo) DO UPDATE SET "
                "archivos_procesados = EXCLUDED.archivos_procesados, "
                "estado = EXCLUDED.estado",
                ("CL", periodo, file_count, "ok"),
            )
        conn.commit()

        incoming_accounts = {t[4] for t in all_tuples}
        report = detect_schema_changes("CL", periodo, incoming_accounts, known_accounts)
        # Expected structural jump into IFRS — don't treat as failure signal for ops.
        if periodo == CNCB2022_START and known_accounts:
            report["resumen"] = (report.get("resumen") or "") + " | expected Circular 2.243 CoA break"
            report["cncb_break"] = True
        record_schema_result(conn, "CL", periodo, report)

        log.info(
            "  ✓ Período %s completado — %d archivos, %d filas%s",
            periodo,
            file_count,
            len(all_tuples),
            " [cncb2021+bridge]" if cncb2021 else "",
        )
        return file_count


def get_loaded_periods(conn) -> set:
    cur = conn.cursor()
    cur.execute(
        "SELECT periodo FROM carga_log WHERE country = %s AND estado IN ('ok', 'alerta_esquema')",
        ("CL",),
    )
    return {row[0] for row in cur.fetchall()}
