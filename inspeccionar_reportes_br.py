#!/usr/bin/env python3
"""
inspeccionar_reportes_br.py — Inspección de los reportes IF.data del Banco
Central más allá del Resumo (dados_1), para decidir si vale la pena ampliar
brasil_loader.py.

NO escribe en la base de datos. NO modifica brasil_loader.py. Solo lee del
portal público y compara contra lo que ya está cargado hoy (Resumo).

Uso:
    python inspeccionar_reportes_br.py --quarter 202603
    (usar un trimestre que ya sepamos que está en el catálogo, ej. 202603)
"""
import argparse
import json
import sys
from urllib.parse import quote
from urllib.request import Request, urlopen

PORTAL = "https://www3.bcb.gov.br/ifdata/rest"
REPORT_NAMES = {"1": "Resumo", "2": "Ativo", "3": "Passivo", "4": "Resultado", "5": "Capital"}


def http_json(url, retries=3):
    last = None
    for _ in range(retries):
        try:
            req = Request(url, headers={"User-Agent": "LatamBanksBR-Inspect/1.0"})
            with urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
    raise last


def portal_file(f):
    return http_json(f"{PORTAL}/arquivos?nomeArquivo=" + quote(f, safe="/:._-"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quarter", required=True, help="AAAAMM, ej. 202603 (uno ya cargado)")
    args = ap.parse_args()
    dt = args.quarter

    catalog = http_json(f"{PORTAL}/relatorios2025a2030")
    q = next((x for x in catalog if str(x["dt"]) == dt), None)
    if not q:
        print(f"Trimestre {dt} no está en el catálogo.")
        sys.exit(1)

    fmap = {f["f"].split("/")[-1]: f["f"] for f in q["files"]}
    print(f"=== Archivos disponibles para {dt} ===")
    for name in sorted(fmap):
        print(" -", name)

    # Mismo filtro de universo prudencial que usa brasil_loader.py hoy.
    cadastro = portal_file(fmap[f"cadastro{dt}_1009.json"])
    valid = {str(e.get("c0")).strip() for e in cadastro if e.get("c0") is not None}
    print(f"\nUniverso prudencial válido: {len(valid)} entidades")

    # Baseline: lo que YA está cargado hoy (Resumo, dados_1).
    dados1 = portal_file(fmap[f"dados{dt}_1.json"])
    contas_resumo, entidades_resumo = set(), set()
    for ent in dados1.get("values", []):
        e = str(ent.get("e")).strip()
        if e not in valid:
            continue
        entidades_resumo.add(e)
        for it in ent.get("v", []):
            contas_resumo.add(str(it.get("i")).strip())
    print(f"Resumo (dados_1): {len(entidades_resumo)} entidades, {len(contas_resumo)} cuentas distintas")

    resumen_final = {"quarter": dt, "resumo_cuentas": len(contas_resumo), "reportes": {}}

    for rel in ("2", "3", "4", "5"):
        fname = f"dados{dt}_{rel}.json"
        if fname not in fmap:
            print(f"\n[Reporte {rel} - {REPORT_NAMES[rel]}] archivo no existe para este trimestre: {fname}")
            resumen_final["reportes"][rel] = {"existe": False}
            continue
        try:
            data = portal_file(fmap[fname])
        except Exception as e:
            print(f"\n[Reporte {rel} - {REPORT_NAMES[rel]}] ERROR al descargar: {e}")
            resumen_final["reportes"][rel] = {"existe": True, "error": str(e)}
            continue

        contas_reporte, entidades_reporte = set(), set()
        for ent in data.get("values", []):
            e = str(ent.get("e")).strip()
            if e not in valid:
                continue
            entidades_reporte.add(e)
            for it in ent.get("v", []):
                contas_reporte.add(str(it.get("i")).strip())

        nuevas = contas_reporte - contas_resumo
        muestra_nuevas = sorted(nuevas)[:15]
        print(f"\n[Reporte {rel} - {REPORT_NAMES[rel]}] archivo: {fname}")
        print(f"  Entidades presentes: {len(entidades_reporte)} (universo válido: {len(valid)})")
        print(f"  Cuentas totales en este reporte: {len(contas_reporte)}")
        print(f"  Cuentas NUEVAS (no están en el Resumo): {len(nuevas)}")
        print(f"  Muestra de códigos nuevos (hasta 15): {muestra_nuevas}")

        resumen_final["reportes"][rel] = {
            "existe": True,
            "entidades": len(entidades_reporte),
            "cuentas_totales": len(contas_reporte),
            "cuentas_nuevas": len(nuevas),
            "muestra_codigos_nuevos": muestra_nuevas,
        }

    # Reportes 6-14 (crédito detallado): SOLO inventario, sin decodificar todavía.
    print("\n=== Reportes 6-14 (crédito detallado) — solo inventario ===")
    credito_files = sorted(
        n for n in fmap if any(n.startswith(f"dados{dt}_{i}.") for i in range(6, 15))
    )
    plantilla_files = sorted(n for n in fmap if n.startswith(f"trel{dt}_"))
    print(f"Archivos dados_6..14 encontrados: {credito_files or 'ninguno'}")
    print(f"Archivos de plantilla trel_* encontrados: {plantilla_files or 'ninguno'}")

    resumen_final["credito_detallado"] = {
        "archivos_dados": credito_files,
        "archivos_plantilla": plantilla_files,
    }

    out_path = f"inspeccion_br_{dt}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(resumen_final, f, ensure_ascii=False, indent=2)
    print(f"\nResumen guardado en {out_path} — pégame ese archivo completo junto con la salida de consola.")


if __name__ == "__main__":
    main()
