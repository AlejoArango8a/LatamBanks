#!/usr/bin/env python3
"""
cargar_zip.py  —  Carga un ZIP de la CMF en Supabase.

USO
  python cargar_zip.py <ruta_al_zip>
  python cargar_zip.py <ruta_al_zip> 202503   <- período explícito
"""
import sys, io, os, re, time, zipfile, logging, threading
from pathlib import Path

os.system('')  # habilita ANSI en Windows cmd

# ── Colores ANSI ──────────────────────────────────────────────────────────────
RS = '\033[0m';  BD = '\033[1m';  DM = '\033[2m'
CY = '\033[96m'; GR = '\033[92m'; YL = '\033[93m'; RD = '\033[91m'

# ── Banner ────────────────────────────────────────────────────────────────────
def _banner():
    print()
    print(f'  {CY}{BD}╔══════════════════════════════════════════════════════╗{RS}')
    print(f'  {CY}{BD}║{RS}                                                      {CY}{BD}║{RS}')
    print(f'  {CY}{BD}║{RS}    ALM BTG  ·  Banks Monitor                         {CY}{BD}║{RS}')
    print(f'  {CY}{BD}║{RS}    Cargador de datos  ·  CMF Chile                    {CY}{BD}║{RS}')
    print(f'  {CY}{BD}║{RS}                                                      {CY}{BD}║{RS}')
    print(f'  {CY}{BD}╚══════════════════════════════════════════════════════╝{RS}')
    print()

# ── Animación: gráfico de barras que sube y baja en ola ──────────────────────
_CHARS = ' ▁▂▃▄▅▆▇█'
_WAVE  = [2,3,5,7,8,7,5,3,2,1,2,4,6,8,6,4,2,3,5,7,8,6,4,2,1,3,5,7,6,4]
_SPIN  = list('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏')

_status  = 'Iniciando...'
_running = False
_lock    = threading.Lock()

def _set_status(msg: str):
    with _lock:
        global _status
        _status = msg

def _bar(offset: int, cols: int = 24) -> str:
    return '  '.join(_CHARS[min(_WAVE[(i + offset) % len(_WAVE)], 8)] for i in range(cols))

def _anim_worker():
    f = 0
    while _running:
        with _lock:
            label = _status
        sp  = _SPIN[f % len(_SPIN)]
        bar = _bar(f)
        sys.stdout.write(
            '\033[2A'
            f'\r  {CY}{bar}{RS}\033[K\n'
            f'\r  {CY}{sp}{RS}  {label}\033[K\n'
        )
        sys.stdout.flush()
        time.sleep(0.09)
        f += 1

def _start_anim() -> threading.Thread:
    global _running
    _running = True
    print(f'  {CY}{_bar(0)}{RS}')   # placeholder línea 1
    print(f'  {_SPIN[0]}  {_status}')  # placeholder línea 2
    t = threading.Thread(target=_anim_worker, daemon=True)
    t.start()
    return t

def _stop_anim(t: threading.Thread):
    global _running
    _running = False
    t.join(timeout=0.4)
    # limpia las 2 líneas de animación
    sys.stdout.write('\033[2A\r\033[K\n\r\033[K\n\033[2A')
    sys.stdout.flush()

# ── Log handler que actualiza el status sin imprimir nada ────────────────────
class _SilentHandler(logging.Handler):
    def emit(self, record):
        msg = record.getMessage()
        if 'Instituciones:' in msg:
            m = re.search(r'(\d+)', msg)
            _set_status(f'Instituciones  ·  {m.group(1) if m else "?"} registros')
        elif 'Plan de cuentas:' in msg:
            m = re.search(r'(\d+)', msg)
            _set_status(f'Plan de cuentas  ·  {m.group(1) if m else "?"} registros')
        elif 'Insertando' in msg:
            m = re.search(r'(\d+) filas.*?(\d+) archivos', msg)
            if m:
                _set_status(f'Datos financieros  ·  {m.group(1)} filas  ·  {m.group(2)} archivos')
            else:
                _set_status('Cargando datos financieros...')
        elif 'completado' in msg:
            _set_status('Finalizando...')

def _setup_log():
    root = logging.getLogger()
    root.handlers.clear()
    h = _SilentHandler()
    h.setLevel(logging.INFO)
    root.addHandler(h)
    root.setLevel(logging.INFO)

# ── Nombre legible del período ────────────────────────────────────────────────
_MESES = {'01':'Enero','02':'Febrero','03':'Marzo','04':'Abril','05':'Mayo',
           '06':'Junio','07':'Julio','08':'Agosto','09':'Septiembre',
           '10':'Octubre','11':'Noviembre','12':'Diciembre'}

def _label(periodo: str) -> str:
    return f'{_MESES.get(periodo[4:], periodo[4:])} {periodo[:4]}'

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    from cmf_loader import (
        get_connection, get_loaded_periods, process_zip, detect_periodo,
        COCKROACH_URL,
    )

    # Argumentos
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    zip_path = Path(sys.argv[1])
    periodo_override = sys.argv[2] if len(sys.argv) >= 3 else None

    # Pantalla limpia + banner
    os.system('cls' if os.name == 'nt' else 'clear')
    _banner()

    # Validaciones rápidas (antes de la animación)
    if not zip_path.exists():
        print(f'  {RD}Error:{RS} Archivo no encontrado:\n    {zip_path}\n')
        sys.exit(1)
    if zip_path.suffix.lower() != '.zip':
        print(f'  {RD}Error:{RS} El archivo debe ser un .zip\n')
        sys.exit(1)
    if not COCKROACH_URL:
        print(f'  {RD}Error:{RS} Falta la variable COCKROACH_URL.')
        print(f'  Copia {BD}.env.example{RS} → {BD}.env{RS} y pega tu COCKROACH_URL.\n')
        sys.exit(1)

    # Leer ZIP y detectar período
    zip_bytes = zip_path.read_bytes()
    if periodo_override:
        periodo = periodo_override
    else:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            periodo = detect_periodo(zf)
        if not periodo:
            print(f'  {RD}Error:{RS} No se pudo detectar el período.')
            print(f'  Indícalo manualmente:  python cargar_zip.py archivo.zip 202503\n')
            sys.exit(1)

    if not (len(periodo) == 6 and periodo.isdigit()):
        print(f'  {RD}Error:{RS} Período inválido: "{periodo}". Formato esperado: YYYYMM\n')
        sys.exit(1)

    # Info
    print(f'  {DM}Archivo  :{RS}  {BD}{zip_path.name}{RS}  {DM}({len(zip_bytes)/1024:.0f} KB){RS}')
    print(f'  {DM}Período  :{RS}  {BD}{_label(periodo)}{RS}')
    print()

    # Conexión y verificación (rápidas, antes de la animación)
    try:
        conn   = get_connection()
        loaded = get_loaded_periods(conn)
    except Exception as e:
        print(f'  {RD}Error al conectar con CockroachDB:{RS}\n  {e}\n')
        sys.exit(1)

    if periodo in loaded:
        print(f'  {YL}⚠  El período {_label(periodo)} ya está cargado.{RS}')
        resp = input('     ¿Deseas sobreescribir los datos? [s/N]: ').strip().lower()
        print()
        if resp != 's':
            print('  Operación cancelada.\n')
            conn.close()
            sys.exit(0)

    # ── Animación + carga ────────────────────────────────────────────────────
    _setup_log()
    _set_status('Procesando archivo ZIP...')
    anim = _start_anim()

    error   = None
    n_files = 0
    try:
        n_files = process_zip(zip_bytes, periodo, conn)
    except Exception as e:
        error = str(e)
    finally:
        _stop_anim(anim)
        conn.close()

    # ── Resultado ─────────────────────────────────────────────────────────────
    if error:
        print(f'  {RD}✗  Error durante la carga:{RS}')
        print(f'     {error}')
    else:
        print(f'  {GR}{BD}✓  {_label(periodo)} cargado exitosamente{RS}')
        print(f'  {DM}   {n_files} archivos procesados{RS}')
    print()

if __name__ == '__main__':
    main()
