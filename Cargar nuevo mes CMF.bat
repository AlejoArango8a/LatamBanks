@echo off
setlocal EnableDelayedExpansion
title Carga CMF — Latam Banks
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  ============================================================
echo    ALM BTG — Carga de datos CMF (Chile)
echo  ============================================================
echo.

:: --- Python: en Windows, al abrir un .bat desde el Explorador a veces no
::     esta "python" en el PATH; el launcher "py -3" suele funcionar igual.
set "PY_CMD="
where py >nul 2>&1
if not errorlevel 1 (
  py -3 --version >nul 2>&1
  if not errorlevel 1 set "PY_CMD=py -3"
)
if not defined PY_CMD (
  where python >nul 2>&1
  if not errorlevel 1 (
    python --version >nul 2>&1
    if not errorlevel 1 set "PY_CMD=python"
  )
)
if not defined PY_CMD (
  echo  ERROR: No se encontro Python ^(ni "py -3" ni "python"^).
  echo  Instala Python desde https://www.python.org
  echo  y marca "Add python.exe to PATH", o usa "py launcher".
  echo.
  pause
  exit /b 1
)
echo  Usando: !PY_CMD!
echo.

if not exist ".env" (
  echo  ERROR: No se encontro el archivo .env con las credenciales.
  echo.
  echo  Pasos:
  echo    1. Busca ".env.example" en esta carpeta
  echo    2. Copialo y renombralo a ".env"
  echo    3. Abrelo y pega tu COCKROACH_URL
  echo.
  pause
  exit /b 1
)

echo  Se abrira el selector de archivos para el ZIP de la CMF.
echo  Si no ves ninguna ventana, revisa la barra de tareas:
echo  a veces el dialogo queda DETRAS de otras ventanas.
echo.

set "ZIP_PATH="
for /f "usebackq delims=" %%F in (`powershell -noprofile -sta -command "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = 'Selecciona el ZIP de la CMF'; $d.Filter = 'Archivos ZIP|*.zip'; $d.InitialDirectory = [Environment]::GetFolderPath('UserProfile') + '\\Downloads'; if ($d.ShowDialog() -eq 'OK') { $d.FileName } else { 'CANCELADO' }"`) do set "ZIP_PATH=%%F"

if "!ZIP_PATH!"=="" (
  echo  ERROR: No se obtuvo ninguna ruta del archivo ^(dialogo vacio o fallo de PowerShell^).
  echo  Alternativa: abre CMD en esta carpeta y ejecuta:
  echo    !PY_CMD! cargar_zip.py "C:\\ruta\\completa\\archivo.zip"
  echo.
  pause
  exit /b 1
)

if /i "!ZIP_PATH!"=="CANCELADO" (
  echo  Operacion cancelada.
  echo.
  pause
  exit /b 0
)

if not exist "!ZIP_PATH!" (
  echo  ERROR: El archivo no existe:
  echo    !ZIP_PATH!
  echo.
  pause
  exit /b 1
)

echo  Archivo seleccionado:
echo    !ZIP_PATH!
echo.
echo  --------------------------------------------------------
echo  Iniciando carga en CockroachDB...
echo  --------------------------------------------------------
echo.

!PY_CMD! cargar_zip.py "!ZIP_PATH!"

echo.
echo  --------------------------------------------------------
if errorlevel 1 (
  echo  Hubo un error durante la carga. Revisa los mensajes arriba.
) else (
  echo  Carga completada correctamente ^(salida sin error^).
)
echo  --------------------------------------------------------
echo.
pause
endlocal
