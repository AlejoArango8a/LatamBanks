#!/usr/bin/env python3
"""
brasil_loader.py — ETL Banco Central do Brasil (IF.data) -> CockroachDB
Nivel: Conglomerados Prudenciais e Instituições Independentes.
LatamBanks — country='BR'

Fuente (igual pre y post 2025):
  - Catálogo REST: relatorios (2000–2024) + relatorios2025a2030
  - Universo prudencial: cadastro{dt}_1009.json (desde 202309) o
    cadastro{dt}_1004.json (201403–202306). Mismos códigos 1000… de grupo.
  - Valores: dados{dt}_1.json (Cosif Resumo/Ativo/Passivo/Resultado/Capital)
            + dados{dt}_3.json (SCR crédito: reportes 123–131 — Inadimplência,
              Ativos problemáticos, C1–C5, geografía, Exterior)
  - Diccionario crédito: info{dt}.json (lid → nombre). Olinda solo cubre rel 1–5.
  - Paths: el catálogo 2025+ ya trae bucket `ifdata_2025_2030//…`;
    el histórico requiere prefijo `ifdata/`.

Cobertura prudencial continua: desde 201403 (mínimo por defecto).
KPIs: Cosif viejo ≤202412 (78xxx) + nuevo ≥202503 (14xxxx); el frontend
suma el par (brSum) y en cada trimestre solo uno tiene valor.

Modos:
  (sin flags)          Modo automático: carga trimestres del catálogo que
                        aún no estén en carga_log. Uso normal en cron.
  --quarter AAAAMM      Carga (o recarga) un trimestre puntual.
  --all                 Carga (o recarga) todos los trimestres del catálogo.
  --from / --to         Filtra el rango AAAAMM (inclusive).
  --dry-run             Lista qué se cargaría; no toca la base.
  --wipe                Borra TODO Brasil antes de cargar. Usar SOLO una vez.
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

load_dotenv(Path(__file__).parent / ".env")

COUNTRY = "BR"
BATCH = 500
# Primer trimestre con cadastro prudencial (1004) y códigos 1000… estables.
MIN_PRUDENTIAL_DT = "201403"

PORTAL = "https://www3.bcb.gov.br/ifdata/rest"
OLINDA = "https://olinda.bcb.gov.br/olinda/servico/IFDATA/versao/v1/odata"
DICT_RELATORIOS = ["1", "2", "3", "4", "5"]  # Resumo, Ativo, Passivo, Resultado, Capital
# Preferir 1009 (nombre actual del filtro prudencial); 1004 es el mismo
# universo en 2014–2023-06. No usar 1005 (conglomerados financieros / otros IDs).
CADASTRO_PRUDENTIAL_IDS = ("1009", "1004")

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
                raw = r.read().decode("utf-8")
            if not raw or raw.lstrip()[:1] not in "{[":
                raise ValueError(f"respuesta no-JSON ({raw[:80]!r})")
            return json.loads(raw)
        except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as e:
            last_err = e
            log.warning("intento %d/%d fallo para %s: %s", attempt, retries, url, e)
            if attempt < retries:
                time.sleep(backoff * attempt)
    raise last_err


def resolve_portal_path(f):
    """
    El catálogo histórico devuelve paths tipo `202412/cadastro…json` que el
    endpoint /arquivos solo sirve con prefijo `ifdata/`. El catálogo 2025+
    ya incluye `ifdata_2025_2030//…`.
    """
    f = str(f).lstrip("/")
    if f.startswith("ifdata_") or f.startswith("ifdata/"):
        return f
    return "ifdata/" + f


def portal_file(f):
    path = resolve_portal_path(f)
    return http_json(f"{PORTAL}/arquivos?nomeArquivo=" + quote(path, safe="/:._-"))


def file_map(files):
    return {f["f"].split("/")[-1]: f["f"] for f in files}


def pick_cadastro_key(fmap, dt):
    """Devuelve (filename, cad_id) del cadastro prudencial disponible."""
    for cad_id in CADASTRO_PRUDENTIAL_IDS:
        key = f"cadastro{dt}_{cad_id}.json"
        if key in fmap:
            return key, cad_id
    return None, None


def list_quarters(min_dt=MIN_PRUDENTIAL_DT):
    """
    Une catálogo histórico (hasta 202412) y 2025–2030. Solo trimestres con
    cadastro prudencial (1009 o 1004) y dados{dt}_1.json.
    """
    hist = http_json(f"{PORTAL}/relatorios")
    try:
        new = http_json(f"{PORTAL}/relatorios2025a2030")
    except Exception as e:
        log.warning("catálogo 2025a2030 inaccesible (%s); solo histórico", e)
        new = []

    by_dt = {}
    for q in list(hist) + list(new):
        dt = str(q.get("dt") or "").strip()
        if not dt or dt < min_dt:
            continue
        files = q.get("files") or []
        fmap = file_map(files)
        cad_key, cad_id = pick_cadastro_key(fmap, dt)
        if not cad_key or f"dados{dt}_1.json" not in fmap:
            continue
        # dados_3 (SCR credit) is present for every prudential quarter we care about;
        # keep the quarter even if missing so Cosif-only history still loads.
        # Si el mismo dt aparece en ambos catálogos, conservar el de 2025+
        # (paths con bucket correcto). En la práctica no se solapan.
        by_dt[dt] = {"dt": dt, "files": files, "cad_id": cad_id}

    quarters = [by_dt[k] for k in sorted(by_dt)]
    log.info(
        "Catálogo prudencial: %d trimestres (%s .. %s)",
        len(quarters),
        quarters[0]["dt"] if quarters else "—",
        quarters[-1]["dt"] if quarters else "—",
    )
    return quarters


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
    olinda_ok = 0
    olinda_fail = 0
    for rel in DICT_RELATORIOS:
        for cod in codinsts:
            url = (
                f"{OLINDA}/IfDataValores(AnoMes={anomes},TipoInstituicao=3,Relatorio='{rel}')"
                f"?$filter=CodInst%20eq%20'{cod}'&$format=json"
            )
            try:
                # 1 retry — Olinda is flaky; Cosif names already live in plan_cuentas
                # and SCR lids come from info.json.
                for row in http_json(url, retries=1, backoff=2).get("value", []):
                    c = str(row.get("Conta") or "").strip()
                    if c and c not in d:
                        nome = str(row.get("NomeColuna") or "").strip()
                        nome = " ".join(nome.split())
                        d[c] = nome
                olinda_ok += 1
            except Exception as e:
                olinda_fail += 1
                if olinda_fail <= 3:
                    log.warning("diccionario rel=%s cod=%s: %s", rel, cod, e)
                elif olinda_fail == 4:
                    log.warning("diccionario Olinda: más fallos (silenciando)…")
                # Bail early if Olinda is down — don't burn minutes on retries.
                if olinda_ok == 0 and olinda_fail >= 6:
                    log.warning(
                        "Olinda caído (%d fallos seguidos) — sigo con plan_cuentas + info.json",
                        olinda_fail,
                    )
                    return d
    log.info(
        "Diccionario de cuentas (%s): %d códigos mapeados (refs: %s)",
        anomes, len(d), codinsts,
    )
    return d


def build_merged_dictionary(quarters):
    """
    Une diccionarios Cosif nuevo (≥202503) y viejo (≤202412) para que
    plan_cuentas tenga nombres legibles en ambos lados de la frontera.
    """
    if not quarters:
        return {}

    def load_cad(q):
        fmap = file_map(q["files"])
        key, _ = pick_cadastro_key(fmap, q["dt"])
        return portal_file(fmap[key])

    merged = {}
    # 1) Trimestre más reciente → Cosif nuevo
    ultimo = quarters[-1]
    merged.update(build_dictionary(ultimo["dt"], load_cad(ultimo)))

    # 2) Último trimestre pre-2025 → Cosif viejo (78xxx)
    pre = [q for q in quarters if q["dt"] < "202501"]
    if pre:
        old_q = pre[-1]
        for k, v in build_dictionary(old_q["dt"], load_cad(old_q)).items():
            merged.setdefault(k, v)

    log.info("Diccionario fusionado: %d códigos (viejo+nuevo Cosif)", len(merged))
    return merged


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def build_info_dictionary(dt, files):
    """
    lid → label from info{dt}.json (portal file). Required for SCR credit
    columns in dados_3 — Olinda Relatorio 6+ returns empty (blueprint §2.4).
    """
    fmap = file_map(files)
    key = f"info{dt}.json"
    if key not in fmap:
        log.warning("dt=%s sin %s — nombres SCR caerán al lid numérico", dt, key)
        return {}
    try:
        info = portal_file(fmap[key])
    except Exception as e:
        log.warning("dt=%s info.json: %s", dt, e)
        return {}
    d = {}
    if not isinstance(info, list):
        return d
    for row in info:
        lid = row.get("lid")
        if lid is None:
            continue
        name = str(row.get("n") or row.get("ni") or lid).strip()
        name = " ".join(name.split())
        d[str(lid)] = name
    log.info("dt=%s info.json: %d lids etiquetados", dt, len(d))
    return d


def get_db_url():
    url = os.environ.get("COCKROACH_URL")
    if not url:
        raise SystemExit(
            "Falta COCKROACH_URL. Copia .env.example → .env o exporta la variable."
        )
    return url


def connect():
    import psycopg2
    return psycopg2.connect(get_db_url())


def upsert(conn, table, cols, updates, conflict, rows):
    import psycopg2.extras
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


def load_existing_plan_labels(conn):
    """Reuse Cosif names already in plan_cuentas when Olinda is down."""
    cur = conn.cursor()
    cur.execute(
        "SELECT cuenta, descripcion FROM plan_cuentas WHERE country=%s",
        (COUNTRY,),
    )
    out = {}
    for cuenta, desc in cur.fetchall():
        c, d = str(cuenta), str(desc or "").strip()
        if d and d != c:
            out[c] = d
    log.info("plan_cuentas existente: %d etiquetas Cosif/SCR", len(out))
    return out


# ---------------------------------------------------------------------------
# Carga de un trimestre
# ---------------------------------------------------------------------------
def load_quarter(conn, dt, files, diccion):
    fmap = file_map(files)
    cad_key, cad_id = pick_cadastro_key(fmap, dt)
    if not cad_key:
        raise KeyError(
            f"Sin cadastro prudencial (1009/1004) para {dt}. "
            "No cargar consolidación financiera (1005)."
        )
    dados_keys = [f"dados{dt}_1.json"]
    dados3_key = f"dados{dt}_3.json"
    if dados3_key in fmap:
        dados_keys.append(dados3_key)
    else:
        log.warning("dt=%s sin %s — Asset Quality SCR quedará incompleto", dt, dados3_key)
    for k in dados_keys:
        if k not in fmap:
            raise KeyError(f"Falta {k}")

    # Merge Olinda Cosif names with info.json SCR lids (dados_3).
    labels = dict(diccion or {})
    labels.update(build_info_dictionary(dt, files))

    log.info("dt=%s cadastro=%s path=%s files=%s", dt, cad_id, resolve_portal_path(fmap[cad_key]), dados_keys)
    cadastro = portal_file(fmap[cad_key])

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

    # e -> {conta: val} so Cosif + SCR merge without duplicate rows
    merged = {}
    for dkey in dados_keys:
        dados = portal_file(fmap[dkey])
        for ent in dados.get("values", []):
            e = str(ent.get("e")).strip()
            if e not in valid:
                continue
            bucket = merged.setdefault(e, {})
            for it in ent.get("v", []):
                conta = str(it.get("i")).strip()
                if not conta:
                    continue
                val = it.get("v") or 0
                try:
                    val = int(round(float(val)))
                except (TypeError, ValueError):
                    val = 0
                bucket[conta] = val  # later file wins on rare lid collisions

    datos_rows, contas = [], set()
    for e, bucket in merged.items():
        for conta, val in bucket.items():
            datos_rows.append((COUNTRY, str(dt), "p", e, conta, 0, 0, 0, 0, val))
            contas.add(conta)

    plan = []
    for c in contas:
        name = labels.get(c)
        if name and name != c:
            plan.append((COUNTRY, c, name))
        else:
            # Insert with lid as placeholder; ON CONFLICT keeps prior human label.
            plan.append((COUNTRY, c, c))
    # Custom upsert: do not clobber an existing human description with the raw lid.
    import psycopg2.extras
    if plan:
        cur = conn.cursor()
        sql = (
            "INSERT INTO plan_cuentas (country, cuenta, descripcion) VALUES %s "
            "ON CONFLICT (country, cuenta) DO UPDATE SET "
            "descripcion = CASE "
            "  WHEN EXCLUDED.descripcion = EXCLUDED.cuenta THEN plan_cuentas.descripcion "
            "  ELSE EXCLUDED.descripcion END"
        )
        for i in range(0, len(plan), BATCH):
            psycopg2.extras.execute_values(cur, sql, plan[i:i + BATCH])
        conn.commit()
    upsert(
        conn, "datos_financieros",
        ["country", "periodo", "tipo", "ins_cod", "cuenta",
         "monto_clp", "monto_uf", "monto_tc", "monto_ext", "monto_total"],
        ["monto_total"],
        ["country", "periodo", "tipo", "ins_cod", "cuenta"], datos_rows,
    )
    upsert(
        conn, "carga_log", ["country", "periodo", "archivos_procesados", "estado"],
        ["archivos_procesados", "estado"], ["country", "periodo"],
        [(COUNTRY, str(dt), len(valid), "ok")],
    )
    log.info(
        "dt=%s cargado: %s entidades, %s filas (cadastro=%s, files=%s)",
        dt, len(valid), len(datos_rows), cad_id, "+".join(dados_keys),
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def filter_quarters(quarters, args, loaded=None):
    target = list(quarters)
    if args.quarter:
        target = [q for q in target if q["dt"] == args.quarter]
    if args.from_dt:
        target = [q for q in target if q["dt"] >= args.from_dt]
    if args.to_dt:
        target = [q for q in target if q["dt"] <= args.to_dt]
    if not args.quarter and not args.all and loaded is not None:
        target = [q for q in target if q["dt"] not in loaded]
    return target


def main():
    ap = argparse.ArgumentParser(
        description="ETL IF.data Brasil → CockroachDB (nivel prudencial, desde 201403)."
    )
    ap.add_argument("--wipe", action="store_true",
                    help="Borrar TODO Brasil antes de cargar. Usar solo una vez.")
    ap.add_argument("--quarter", help="Cargar/recargar UN trimestre puntual AAAAMM")
    ap.add_argument("--all", action="store_true",
                    help="Cargar/recargar TODOS los trimestres del catálogo (o del rango)")
    ap.add_argument("--from", dest="from_dt", metavar="AAAAMM",
                    help="Solo trimestres >= AAAAMM (default catálogo: 201403)")
    ap.add_argument("--to", dest="to_dt", metavar="AAAAMM",
                    help="Solo trimestres <= AAAAMM")
    ap.add_argument("--dry-run", action="store_true",
                    help="Solo listar trimestres objetivo; no conecta a la BD")
    ap.add_argument("--skip-olinda", action="store_true",
                    help="No consultar Olinda; usar plan_cuentas + info.json (más rápido / resiliente)")
    args = ap.parse_args()

    min_dt = args.from_dt or MIN_PRUDENTIAL_DT
    if args.from_dt and args.from_dt < MIN_PRUDENTIAL_DT:
        log.warning(
            "--from=%s es anterior al mínimo prudencial %s; "
            "se usará %s (códigos 1000… / cadastro 1004+).",
            args.from_dt, MIN_PRUDENTIAL_DT, MIN_PRUDENTIAL_DT,
        )
        min_dt = MIN_PRUDENTIAL_DT

    quarters = list_quarters(min_dt=min_dt)
    if not quarters:
        log.error("Catálogo vacío o inaccesible.")
        return 1

    if args.dry_run:
        loaded = set()
        # En dry-run no hay BD; con --all/--quarter mostramos el filtro puro.
        if args.quarter or args.all or args.from_dt or args.to_dt:
            target = filter_quarters(quarters, args, loaded=None if (args.quarter or args.all) else set())
            if not args.quarter and not args.all:
                # sin --all, dry-run asume que nada está cargado → muestra backlog
                target = filter_quarters(quarters, args, loaded=set())
        else:
            target = quarters
        print(f"Trimestres en catálogo prudencial: {len(quarters)}")
        print(f"Objetivo dry-run: {len(target)}")
        for q in target:
            fmap = file_map(q["files"])
            cad_key, cad_id = pick_cadastro_key(fmap, q["dt"])
            d3 = f"dados{q['dt']}_3.json"
            d3_note = resolve_portal_path(fmap[d3]) if d3 in fmap else "MISSING"
            print(
                f"  {q['dt']}  cadastro={cad_id}  "
                f"dados1={resolve_portal_path(fmap[f'dados{q['dt']}_1.json'])}  "
                f"dados3={d3_note}"
            )
        return 0

    conn = connect()
    try:
        if args.wipe:
            wipe_brazil(conn)

        loaded = get_loaded_periods(conn) if not (args.quarter or args.all) else None
        target = filter_quarters(quarters, args, loaded=loaded)

        if not target:
            if loaded is not None:
                log.info(
                    "Brasil al día (%d trimestres cargados; catálogo %d). Nada nuevo.",
                    len(loaded), len(quarters),
                )
                return 0
            log.error("Nada que cargar (revisa --quarter/--all/--from/--to o el catálogo).")
            return 1

        log.info(
            "Cargando %d trimestre(s): %s%s",
            len(target),
            [q["dt"] for q in target[:8]],
            "…" if len(target) > 8 else "",
        )

        diccion = load_existing_plan_labels(conn)
        if args.skip_olinda:
            log.info("--skip-olinda: no se consulta Olinda")
        else:
            try:
                diccion.update(build_merged_dictionary(quarters))
            except Exception as e:
                log.warning("Olinda dictionary skipped (%s) — usando plan_cuentas + info.json", e)

        for q in target:
            load_quarter(conn, q["dt"], q["files"], diccion)
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main() or 0)
