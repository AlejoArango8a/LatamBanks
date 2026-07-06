#!/usr/bin/env python3
"""
brasil_loader.py — ETL Banco Central do Brasil (IF.data) -> CockroachDB
Nivel: Conglomerados Prudenciais e Instituições Independentes.
LatamBanks — country='BR'

Modos:
  (sin flags)          Modo automático: carga solo los trimestres del catálogo
                        que todavía no estén en carga_log. Uso normal en cron.
  --quarter AAAAMM      Carga (o recarga) un trimestre puntual.
  --all                 Carga (o recarga) todos los trimestres del catálogo.
  --wipe                Borra TODO Brasil antes de cargar. Usar SOLO una vez,
                        en la reconstrucción inicial, combinado con --quarter
                        o --all.
"""
import argparse
import json
import logging
import os
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from dotenv import load_dotenv
import psycopg2
import psycopg2.extras

load_dotenv(Path(__file__).parent / ".env")
COCKROACH_URL = os.environ["COCKROACH_URL"]
COUNTRY = "BR"
BATCH = 500

PORTAL = "https://www3.bcb.gov.br/ifdata/rest"
OLINDA = "https://olinda.bcb.gov.br/olinda/servico/IFDATA/versao/v1/odata"
DICT_RELATORIOS = ["1", "2", "3", "4", "5"]  # Resumo, Ativo, Passivo, Resultado, Capital

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("brasil_loader")


# ---------------------------------------------------------------------------
# HTTP helpers (con reintentos — el portal no es un endpoint documentado y
# puede ser inestable)
# ---------------------------------------------------------------------------
def http_json(url, retries=3, backoff=5):
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = Request(url, headers={"User-Agent": "LatamBanksBR/1.0"})
            with urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError) as e:
            last_err = e
            log.warning("intento %d/%d fallo para %s: %s", attempt, retries, url, e)
            if attempt < retries:
                time.sleep(backoff * attempt)
    raise last_err


def portal_file(f):
    return http_json(f"{PORTAL}/arquivos?nomeArquivo=" + quote(f, safe="/:._-"))


def list_quarters():
    # NOTA: el nombre del endpoint asume catálogo 2025-2030. Si el Banco
    # Central publica un catálogo nuevo después de 2030, este endpoint podría
    # cambiar de nombre — revisar si algún día deja de devolver trimestres
    # nuevos.
    return http_json(f"{PORTAL}/relatorios2025a2030")  # [{dt, files:[{f}]}]


# ---------------------------------------------------------------------------
# Diccionario de cuentas (Olinda) — corrección respecto al handoff original:
# se consultan varias instituciones de tipos TCB distintos, elegidas del
# propio cadastro del trimestre, en vez de depender de un solo banco.
# ---------------------------------------------------------------------------
def pick_reference_codinst(cadastro, keep=("30306294",)):
    """
    Selecciona un CodInst real por cada tipo TCB distinto para maximizar la
    cobertura del diccionario de cuentas. Prioriza instituciones
    independientes (c4=='I'), cuyo c0 YA es su CodInst individual válido en
    Olinda. Los conglomerados prudenciais (c4=='C') tienen código '1000...'
    que NO es un CodInst válido en Olinda, así que se excluyen de esta
    selección (siguen cargándose normalmente en datos_financieros).
    `keep` = CodInst ya confirmados que siempre se incluyen (BTG por defecto,
    validado en sesión anterior).
    """
    seen_tcb = set()
    refs = list(keep)
    for e in cadastro:
        if str(e.get("c4") or "").strip() != "I":
            continue
        tcb = str(e.get("c3") or "").strip()
        cod = str(e.get("c0") or "").strip()
        if tcb and tcb not in seen_tcb and cod:
            seen_tcb.add(tcb)
            refs.append(cod)
    return refs


def build_dictionary(anomes, cadastro):
    codinsts = pick_reference_codinst(cadastro)
    d = {}
    for rel in DICT_RELATORIOS:
        for cod in codinsts:
            url = (
                f"{OLINDA}/IfDataValores(AnoMes={anomes},TipoInstituicao=3,Relatorio='{rel}')"
                f"?$filter=CodInst%20eq%20'{cod}'&$format=json"
            )
            try:
                for row in http_json(url).get("value", []):
                    c = str(row.get("Conta") or "").strip()
                    if c and c not in d:
                        d[c] = str(row.get("NomeColuna") or "").strip()
            except Exception as e:
                log.warning("diccionario rel=%s cod=%s: %s", rel, cod, e)
    log.info(
        "Diccionario de cuentas: %d códigos mapeados (de %d instituciones de referencia: %s)",
        len(d), len(codinsts), codinsts,
    )
    return d


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------
def upsert(conn, table, cols, updates, conflict, rows):
    if not rows:
        return
    cur = conn.cursor()
    sql = (
        f"INSERT INTO {table} ({','.join(cols)}) VALUES %s "
        f"ON CONFLICT ({','.join(conflict)}) DO UPDATE SET "
        + ", ".join(f"{c}=EXCLUDED.{c}" for c in updates)
    )
    for i in range(0, len(rows), BATCH):
        psycopg2.extras.execute_values(cur, sql, rows[i : i + BATCH])
    conn.commit()


def wipe_brazil(conn):
    cur = conn.cursor()
    for t in ("datos_financieros", "instituciones", "plan_cuentas", "carga_log"):
        cur.execute(f"DELETE FROM {t} WHERE country=%s", (COUNTRY,))
    conn.commit()
    log.info("Brasil borrado por completo (solo country='BR').")


def get_loaded_periods(conn):
    cur = conn.cursor()
    cur.execute(
        "SELECT periodo FROM carga_log WHERE country=%s AND estado='ok'", (COUNTRY,)
    )
    return {row[0] for row in cur.fetchall()}


# ---------------------------------------------------------------------------
# Carga de un trimestre
# ---------------------------------------------------------------------------
def load_quarter(conn, dt, files, diccion):
    fmap = {f["f"].split("/")[-1]: f["f"] for f in files}
    cadastro = portal_file(fmap[f"cadastro{dt}_1009.json"])
    dados = portal_file(fmap[f"dados{dt}_1.json"])

    valid = {str(e.get("c0")).strip() for e in cadastro if e.get("c0") is not None}

    inst = [
        (COUNTRY, str(e["c0"]).strip(), str(e.get("c2") or "").strip())
        for e in cadastro
        if e.get("c0") is not None
    ]
    upsert(
        conn, "instituciones", ["country", "codigo", "razon_social"],
        ["razon_social"], ["country", "codigo"], inst,
    )

    datos, contas = [], set()
    for ent in dados.get("values", []):
        e = str(ent.get("e")).strip()
        if e not in valid:  # solo universo prudencial + independientes
            continue
        for it in ent.get("v", []):
            conta = str(it.get("i")).strip()
            val = it.get("v") or 0
            try:
                val = int(round(float(val)))  # monto_total suele ser bigint
            except (TypeError, ValueError):
                val = 0
            datos.append((COUNTRY, str(dt), "p", e, conta, 0, 0, 0, 0, val))
            contas.add(conta)

    plan = [(COUNTRY, c, diccion.get(c, c)) for c in contas]
    upsert(
        conn, "plan_cuentas", ["country", "cuenta", "descripcion"],
        ["descripcion"], ["country", "cuenta"], plan,
    )
    upsert(
        conn, "datos_financieros",
        ["country", "periodo", "tipo", "ins_cod", "cuenta",
         "monto_clp", "monto_uf", "monto_tc", "monto_ext", "monto_total"],
        ["monto_total"],
        ["country", "periodo", "tipo", "ins_cod", "cuenta"], datos,
    )
    upsert(
        conn, "carga_log", ["country", "periodo", "archivos_procesados", "estado"],
        ["archivos_procesados", "estado"], ["country", "periodo"],
        [(COUNTRY, str(dt), len(valid), "ok")],
    )
    log.info("dt=%s cargado: %s entidades, %s filas de datos", dt, len(valid), len(datos))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wipe", action="store_true",
                     help="Borrar TODO Brasil antes de cargar. Usar solo una vez.")
    ap.add_argument("--quarter", help="Cargar/recargar UN trimestre puntual AAAAMM")
    ap.add_argument("--all", action="store_true",
                     help="Cargar/recargar TODOS los trimestres del catálogo")
    args = ap.parse_args()

    conn = psycopg2.connect(COCKROACH_URL)
    try:
        if args.wipe:
            wipe_brazil(conn)

        quarters = list_quarters()
        if not quarters:
            log.error("Catálogo vacío o inaccesible.")
            return

        if args.quarter:
            target = [q for q in quarters if str(q["dt"]) == args.quarter]
        elif args.all:
            target = quarters
        else:
            # Modo automático (default): solo lo que falta. Este es el modo
            # que corre en GitHub Actions una vez terminada la reconstrucción.
            loaded = get_loaded_periods(conn)
            target = [q for q in quarters if str(q["dt"]) not in loaded]
            if not target:
                log.info("Brasil al día (%d trimestres cargados). Nada nuevo.", len(loaded))
                return
            log.info(
                "Modo automático: %d trimestre(s) nuevo(s): %s",
                len(target), [q["dt"] for q in target],
            )

        if not target:
            log.error("Nada que cargar (revisa --quarter/--all o el catálogo).")
            return

        # El diccionario de cuentas se construye UNA sola vez por corrida,
        # usando el cadastro del trimestre más reciente del catálogo (no
        # necesariamente el primero de `target`), para tener el set de
        # cuentas más actualizado disponible.
        ultimo = quarters[-1]
        fmap_dic = {f["f"].split("/")[-1]: f["f"] for f in ultimo["files"]}
        cadastro_dic = portal_file(fmap_dic[f"cadastro{ultimo['dt']}_1009.json"])
        diccion = build_dictionary(ultimo["dt"], cadastro_dic)

        for q in target:
            load_quarter(conn, q["dt"], q["files"], diccion)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
