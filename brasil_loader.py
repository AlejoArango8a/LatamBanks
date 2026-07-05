#!/usr/bin/env python3
"""
brasil_loader.py — ETL IF.data Brasil (Banco Central / API Olinda OData) → CockroachDB.

Fuente: https://olinda.bcb.gov.br/olinda/servico/IFDATA/versao/v1/odata/IfDataValores
Filtros: TipoInstituicao=3 (conglomerados/independentes), Relatorio=1 (Resumo).
Frecuencia: TRIMESTRAL (AnoMes termina en 03, 06, 09, 12).

Qué capturamos por fila:
  - CodInst  -> ins_cod (BIGINT)         identificador de la institución (base do CNPJ)
  - AnoMes   -> periodo (YYYYMM)
  - Conta    -> cuenta (TEXT)            código de la columna del reporte (¡cambia en mar-2025!)
  - NomeColuna     -> plan_cuentas.descripcion   nombre legible del concepto
  - DescricaoColuna-> plan_cuentas.formula       cuentas Cosif oficiales que lo componen (auditoría DE/PARA)
  - Saldo    -> monto_total (BIGINT)

Diseño de la cuenta (acordado con el usuario):
  Guardamos `Conta` crudo (fiel a la fuente). El nuevo plan Cosif de mar-2025
  (Resolución CMN 4.966/2021) renumeró las cuentas: el schema_guard (Tarea A)
  detecta esa frontera vía umbral relativo y la deja registrada como alerta.
  DescricaoColuna queda como respaldo auditable contra los catálogos oficiales
  del BCB (completo_contas_2025.pdf vs completo_contas.pdf).

Requiere:
  - Variable .env COCKROACH_URL
  - migrations/001..004 aplicadas + 005_plan_cuentas_add_formula.sql (para `formula`)

Uso:
  python brasil_loader.py --dry-run                 # SOLO LECTURA: no escribe en BD
  python brasil_loader.py --dry-run --quarters 202409,202412,202503,202506
  python brasil_loader.py --historical              # 2013..trimestre actual
  python brasil_loader.py --historical --year 2025  # solo un año civil
  python brasil_loader.py --incremental             # trimestres nuevos
  python brasil_loader.py --institutions-plan       # solo instituciones + plan (último trimestre)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from dotenv import load_dotenv
import psycopg2
import psycopg2.extras

from schema_guard import detect_schema_changes, get_known_accounts, record_schema_result
from brasil_banks import name_for, is_bank

# Evita UnicodeEncodeError al imprimir acentos en consolas Windows (cp1252).
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
except Exception:
    pass

load_dotenv(Path(__file__).parent / ".env")

COCKROACH_URL = os.environ.get("COCKROACH_URL", "")
OLINDA_BASE = (
    "https://olinda.bcb.gov.br/olinda/servico/IFDATA/versao/v1/odata/"
    "IfDataValores(AnoMes=@AnoMes,TipoInstituicao=@TipoInstituicao,Relatorio=@Relatorio)"
)

COUNTRY = "BR"
TIPO_INSTITUICAO = 3
RELATORIO = "1"
BATCH_ROWS = 500
FIRST_YEAR = 2022  # alineado con Chile/Colombia; extensible con --year para años previos

# Reportes IF.data a cargar por trimestre.
#   ("1", None)      -> Resumo: se etiqueta con el tipo inferido (b1/r1); NO cambia.
#   detalle          -> cada reporte va con su propio `tipo` para no pisar al Resumo
#                       (comparten algunos códigos Conta, ej. 78186 = Patrimônio).
# Los reportes de detalle solo se guardan para bancos operativos (es_banco), para
# no inflar la base con ~2000 instituciones que no mostramos en detalle.
REPORTS: list[tuple[str, str | None]] = [
    ("1", None),        # Resumo  (indicadores principales)
    ("2", "br_ativo"),  # Ativo   (composición del activo)
    ("3", "br_pasivo"), # Passivo (composición del pasivo + depósitos)
    ("4", "br_dre"),    # DRE     (estado de resultados)
]

# Tipos del Resumo: única fuente que vigila el schema_guard (Tarea A). Los reportes
# de detalle tienen muchas más cuentas y dispararían falsas alertas si se vigilaran.
RESUMO_TIPOS = ("b1", "r1")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)


# ============================================================
# CONEXIÓN Y FUENTE
# ============================================================
def conn_get():
    return psycopg2.connect(COCKROACH_URL)


def olinda_get(
    ano_mes: str,
    tipo_inst: int = TIPO_INSTITUICAO,
    relatorio: str = RELATORIO,
    cod_inst: str | None = None,
    top: int | None = None,
) -> list[dict[str, Any]]:
    """GET a la API Olinda; devuelve la lista data['value']."""
    q = (
        f"?@AnoMes={ano_mes}&@TipoInstituicao={tipo_inst}&@Relatorio='{relatorio}'"
        f"&$format=json"
    )
    if cod_inst:
        q += "&$filter=" + quote(f"CodInst eq '{cod_inst}'", safe="'")
    if top:
        q += f"&$top={top}"
    url = OLINDA_BASE + q
    req = Request(url, headers={"User-Agent": "LatamBanksBrasilLoader/1.0"})
    try:
        with urlopen(req, timeout=180) as r:
            raw = r.read().decode("utf-8")
    except HTTPError as e:
        log.error("Olinda HTTP %s — %s", e.code, e.read()[:500])
        raise
    except URLError as e:
        log.error("Olinda URL error: %s", e.reason)
        raise
    data = json.loads(raw)
    value = data.get("value")
    if not isinstance(value, list):
        raise RuntimeError(f"Olinda esperaba 'value' lista, halló {type(value)}")
    return value


# ============================================================
# PARSEO
# ============================================================
def infer_tipo(nome_coluna: str) -> str:
    """Clasifica el renglón: r1 = resultado (estado de resultados), b1 = balance.

    En el Relatorio 1 la única línea de resultado es "Lucro Líquido"; el resto son
    de balance. OJO: no usamos la palabra "resultado" como disparador porque
    colisiona con "Resultados de Exercícios Futuros" (una cuenta de PASIVO del
    Cosif viejo). La detección amplia de resultados llegará con los Relatorios 2-5
    y su tabla de equivalencias.
    """
    n = (nome_coluna or "").lower()
    if "lucro" in n or "prejuízo" in n or "prejuizo" in n:
        return "r1"
    return "b1"


def row_to_tuple(rec: dict[str, Any], tipo_override: str | None = None) -> tuple:
    ins = int(str(rec["CodInst"]).strip())
    periodo = str(rec["AnoMes"]).strip()
    cuenta = str(rec.get("Conta") or "").strip()
    nome = str(rec.get("NomeColuna") or "").strip()
    tipo = tipo_override or infer_tipo(nome)
    saldo = float(rec.get("Saldo") or 0)
    monto = int(round(saldo))
    return (COUNTRY, periodo, tipo, ins, cuenta, 0, 0, 0, 0, monto)


def collect_plan(records: list[dict], plan: dict[str, tuple[str, str]]) -> None:
    """Acumula {Conta: (NomeColuna, DescricaoColuna)} a partir de los registros."""
    for r in records:
        c = str(r.get("Conta") or "").strip()
        if not c:
            continue
        nome = str(r.get("NomeColuna") or "").strip()
        formula = str(r.get("DescricaoColuna") or "").strip()
        plan[c] = (nome, formula)


# ============================================================
# UPSERTS
# ============================================================
def upsert_institutions(conn, cod_insts: set[str]) -> None:
    if not cod_insts:
        return
    tuples = []
    for ci in cod_insts:
        try:
            code = int(str(ci).strip())
        except ValueError:
            continue
        tuples.append((COUNTRY, code, name_for(ci), is_bank(ci)))
    cur = conn.cursor()
    for i in range(0, len(tuples), BATCH_ROWS):
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO instituciones (country, codigo, razon_social, es_banco) VALUES %s "
            "ON CONFLICT (country, codigo) DO UPDATE SET "
            "razon_social = EXCLUDED.razon_social, es_banco = EXCLUDED.es_banco",
            tuples[i : i + BATCH_ROWS],
        )
    conn.commit()
    log.info("Instituciones BR upsert — %s instituciones", len(tuples))


def upsert_plan_cuentas(conn, plan: dict[str, tuple[str, str]]) -> None:
    if not plan:
        return
    tuples = [(COUNTRY, c, (nome or c), (formula or None)) for c, (nome, formula) in plan.items()]
    cur = conn.cursor()
    for i in range(0, len(tuples), BATCH_ROWS):
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO plan_cuentas (country, cuenta, descripcion, formula) VALUES %s "
            "ON CONFLICT (country, cuenta) DO UPDATE SET "
            "descripcion = EXCLUDED.descripcion, formula = EXCLUDED.formula",
            tuples[i : i + BATCH_ROWS],
        )
    conn.commit()
    log.info("Plan de cuentas BR upsert — %s cuentas (con fórmula Cosif)", len(tuples))


INSERT_DATOS = (
    "INSERT INTO datos_financieros "
    "(country, periodo, tipo, ins_cod, cuenta, monto_clp, monto_uf, monto_tc, monto_ext, monto_total) "
    "VALUES %s "
    "ON CONFLICT (country, periodo, tipo, ins_cod, cuenta) DO UPDATE SET "
    "monto_clp = EXCLUDED.monto_clp, monto_uf = EXCLUDED.monto_uf, "
    "monto_tc = EXCLUDED.monto_tc, monto_ext = EXCLUDED.monto_ext, "
    "monto_total = EXCLUDED.monto_total"
)


def ingest_tuple_batch(conn, tuples: list[tuple]) -> None:
    if not tuples:
        return
    # De-dup por clave primaria (country, periodo, tipo, ins_cod, cuenta): la
    # fuente Olinda a veces repite la misma fila dentro de un trimestre, y un
    # INSERT ... ON CONFLICT no puede afectar la misma fila dos veces en un solo
    # statement (CardinalityViolation). Nos quedamos con la última ocurrencia.
    dedup: dict[tuple, tuple] = {}
    for t in tuples:
        dedup[(t[0], t[1], t[2], t[3], t[4])] = t
    rows = list(dedup.values())
    cur = conn.cursor()
    for i in range(0, len(rows), BATCH_ROWS):
        psycopg2.extras.execute_values(cur, INSERT_DATOS, rows[i : i + BATCH_ROWS])
    conn.commit()


def bump_carga_log(conn, counts_by_periodo: dict[str, int]) -> None:
    cur = conn.cursor()
    for p, nrows in sorted(counts_by_periodo.items()):
        cur.execute(
            "INSERT INTO carga_log (country, periodo, archivos_procesados, estado) VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (country, periodo) DO UPDATE SET "
            "archivos_procesados = EXCLUDED.archivos_procesados, estado = 'ok'",
            (COUNTRY, p, nrows, "ok"),
        )
    conn.commit()


# ============================================================
# PERÍODOS (trimestrales)
# ============================================================
def quarters_in_range(y0: int, y1: int) -> list[str]:
    out: list[str] = []
    for y in range(y0, y1 + 1):
        for m in (3, 6, 9, 12):
            out.append(f"{y:04d}{m:02d}")
    return out


def latest_available_quarter() -> str | None:
    """Busca el trimestre más reciente con datos (probando de más nuevo a más viejo)."""
    today = date.today()
    for y in (today.year, today.year - 1):
        for m in (12, 9, 6, 3):
            if y == today.year and m > ((today.month - 1) // 3) * 3 + 3:
                continue
            p = f"{y:04d}{m:02d}"
            try:
                if olinda_get(p, top=1):
                    return p
            except (HTTPError, URLError):
                continue
    return None


def get_loaded(conn) -> set[str]:
    cur = conn.cursor()
    cur.execute("SELECT periodo FROM carga_log WHERE country = %s AND estado = 'ok'", (COUNTRY,))
    return {r[0] for r in cur.fetchall()}


# ============================================================
# MODOS
# ============================================================
def _process_quarters(conn, quarters: list[str], known_accounts: set[str]) -> None:
    plan: dict[str, tuple[str, str]] = {}
    cod_insts: set[str] = set()
    for p in quarters:
        log.info("Trimestre %s ...", p)
        all_tuples: list[tuple] = []
        resumo_accounts: set[str] = set()
        total_rows = 0
        for rel, tipo_override in REPORTS:
            try:
                recs = olinda_get(p, relatorio=rel)
            except (HTTPError, URLError) as e:
                log.warning("  [%s] relatorio %s error de red: %s (se omite)", p, rel, e)
                continue
            if not recs:
                log.info("  [%s] relatorio %s sin datos", p, rel)
                continue
            collect_plan(recs, plan)
            es_resumo = rel == "1"
            for r in recs:
                ci = str(r.get("CodInst"))
                # El Resumo se guarda completo (todas las instituciones); los reportes
                # de detalle solo para bancos operativos (es_banco).
                if not es_resumo and not is_bank(ci):
                    continue
                try:
                    t = row_to_tuple(r, tipo_override)
                except Exception as e:  # noqa: BLE001
                    log.warning("  fila omitida: %s", e)
                    continue
                all_tuples.append(t)
                total_rows += 1
                cod_insts.add(ci)
                if es_resumo:
                    resumo_accounts.add(t[4])
        if not all_tuples:
            log.warning("  sin datos para %s (se omite)", p)
            continue
        ingest_tuple_batch(conn, all_tuples)
        bump_carga_log(conn, {p: total_rows})
        # schema_guard (Tarea A) SOLO sobre el Resumo: comparar el detalle
        # dispararía falsas alertas por su gran volumen de cuentas.
        report = detect_schema_changes(COUNTRY, p, resumo_accounts, known_accounts)
        record_schema_result(conn, COUNTRY, p, report)
        # La base para el siguiente trimestre es el Resumo que acabamos de cargar.
        if resumo_accounts:
            known_accounts = resumo_accounts
        log.info("  %s — %s filas (Resumo + detalle)", p, total_rows)
    upsert_institutions(conn, cod_insts)
    upsert_plan_cuentas(conn, plan)


def run_historical(conn, years: tuple[int, int] | None = None) -> None:
    y0 = years[0] if years else FIRST_YEAR
    y1 = years[1] if years else date.today().year
    quarters = quarters_in_range(y0, y1)
    first_q = quarters[0] if quarters else None
    # Base = Resumo del trimestre cronológicamente anterior al primero a cargar
    # (evita falsas alertas al re-correr el histórico con datos nuevos ya presentes).
    known_accounts = get_known_accounts(conn, COUNTRY, tipos=RESUMO_TIPOS, before_periodo=first_q)
    _process_quarters(conn, quarters, known_accounts)


def run_incremental(conn) -> None:
    latest = latest_available_quarter()
    if not latest:
        log.error("No pude determinar el último trimestre disponible en Olinda.")
        return
    loaded = get_loaded(conn)
    max_loaded = max(loaded, default="")
    if latest <= max_loaded:
        log.info("Nada nuevo: último cargado BR=%s, último disponible=%s", max_loaded, latest)
        return
    y0 = int(max_loaded[:4]) if max_loaded else FIRST_YEAR
    y1 = int(latest[:4])
    pending = [q for q in quarters_in_range(y0, y1) if q > max_loaded and q <= latest]
    first_q = pending[0] if pending else None
    known_accounts = get_known_accounts(conn, COUNTRY, tipos=RESUMO_TIPOS, before_periodo=first_q)
    _process_quarters(conn, pending, known_accounts)


def run_institutions_plan(conn) -> None:
    latest = latest_available_quarter()
    if not latest:
        log.error("No pude determinar el último trimestre disponible en Olinda.")
        return
    recs = olinda_get(latest)
    plan: dict[str, tuple[str, str]] = {}
    collect_plan(recs, plan)
    cod_insts = {str(r.get("CodInst")) for r in recs}
    upsert_institutions(conn, cod_insts)
    upsert_plan_cuentas(conn, plan)


# ============================================================
# DRY-RUN (solo lectura, no toca la BD)
# ============================================================
def run_dryrun(quarters: list[str]) -> None:
    print("\n" + "=" * 74)
    print("  DRY-RUN Brasil — SOLO LECTURA (no se escribe en la base de datos)")
    print("  TipoInstituicao=3 · Relatorio=1 · trimestres:", ", ".join(quarters))
    print("=" * 74)

    prev_accounts: set[str] | None = None
    prev_periodo = ""
    for p in quarters:
        try:
            recs = olinda_get(p)
        except (HTTPError, URLError) as e:
            print(f"\n[{p}] ERROR de red: {e}")
            continue
        if not recs:
            print(f"\n[{p}] sin datos.")
            continue

        insts = {str(r.get("CodInst")) for r in recs}
        accounts = {str(r.get("Conta") or "").strip() for r in recs if r.get("Conta")}
        tuples = [row_to_tuple(r) for r in recs]
        by_tipo = defaultdict(int)
        for t in tuples:
            by_tipo[t[2]] += 1

        print(f"\n[{p}]  registros={len(recs)}  instituciones={len(insts)}  "
              f"cuentas_distintas={len(accounts)}  tipos={dict(by_tipo)}")

        # Muestra BTG (30306294) para ver conceptos + fórmula Cosif.
        btg = [r for r in recs if str(r.get("CodInst")) == "30306294"]
        if btg:
            print("   BTG Pactual (Conta | tipo | NomeColuna | fórmula Cosif | Saldo):")
            for r in sorted(btg, key=lambda x: str(x.get("Conta"))):
                nome = str(r.get("NomeColuna") or "")
                print(f"     {str(r.get('Conta')):>7} | {infer_tipo(nome):<3} | {nome[:26]:<26} "
                      f"| {str(r.get('DescricaoColuna') or '')[:30]:<30} | {r.get('Saldo')}")

        # Vista previa del schema_guard (Tarea A) período-contra-período.
        if prev_accounts is not None:
            report = detect_schema_changes(COUNTRY, p, accounts, prev_accounts)
            marca = "🚨 ALERTA" if report["status"] == "structural_change" else "· ok"
            print(f"   schema_guard vs {prev_periodo}: {marca} — {report['resumen']}")
            if report["status"] == "structural_change":
                print(f"       desaparecieron: {report['desaparecidas']}")
                print(f"       aparecieron:    {report['nuevas']}")
        prev_accounts = accounts
        prev_periodo = p

    print("\n" + "=" * 74)
    print("  Fin del dry-run. Nada se escribió en la BD.")
    print("=" * 74)


# ============================================================
# CLI
# ============================================================
def main():
    parser = argparse.ArgumentParser(
        description="Carga IF.data Brasil (Olinda) → datos_financieros country=BR"
    )
    parser.add_argument("--historical", action="store_true", help="Trimestres FIRST_YEAR..hoy")
    parser.add_argument("--incremental", action="store_true", help="Trimestres nuevos")
    parser.add_argument("--institutions-plan", action="store_true", help="Solo instituciones + plan")
    parser.add_argument("--dry-run", action="store_true", help="Solo lectura; no escribe en BD")
    parser.add_argument("--year", type=int, help="Con --historical: solo ese año civil")
    parser.add_argument(
        "--quarters",
        type=str,
        help="Con --dry-run: lista YYYYMM separada por comas (default alrededor de mar-2025)",
    )
    args = parser.parse_args()

    if args.dry_run:
        if args.quarters:
            quarters = [q.strip() for q in args.quarters.split(",") if q.strip()]
        else:
            quarters = ["202409", "202412", "202503", "202506"]
        run_dryrun(quarters)
        return

    if args.year and not args.historical:
        parser.error("--historical es obligatorio para usar --year")

    modes = sum([bool(args.historical), bool(args.incremental), bool(args.institutions_plan)])
    if modes != 1:
        parser.error("Elige uno: --historical | --incremental | --institutions-plan | --dry-run")

    conn = conn_get()
    try:
        if args.institutions_plan:
            run_institutions_plan(conn)
        elif args.incremental:
            run_incremental(conn)
        elif args.historical:
            if args.year:
                run_historical(conn, years=(args.year, args.year))
            else:
                run_historical(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
