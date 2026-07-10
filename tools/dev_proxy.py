#!/usr/bin/env python3
"""
dev_proxy.py — Preview local del dashboard contra la API en VIVO (sin DB local).
Sirve los archivos estáticos del repo en http://localhost:3000 y reenvía /api y
/health a la API en vivo (www.latambanks.co), del lado del servidor (sin cabecera
Origin → sin problemas de CORS). Solo stdlib.

Uso:   py -3 tools/dev_proxy.py      ->  abrir http://localhost:3000/dashboard.html
"""
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
UPSTREAM = os.environ.get("PREVIEW_API", "https://www.latambanks.co").rstrip("/")
PORT = int(os.environ.get("PREVIEW_PORT", "3000"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def _is_api(self):
        return self.path.startswith("/api/") or self.path.split("?")[0] == "/health"

    def _proxy(self):
        url = UPSTREAM + self.path
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else None
        headers = {}
        ct = self.headers.get("Content-Type")
        if ct:
            headers["Content-Type"] = ct
        req = Request(url, data=body, method=self.command, headers=headers)
        try:
            with urlopen(req, timeout=30) as r:
                data, status, rct = r.read(), r.status, r.headers.get("Content-Type", "application/json")
        except HTTPError as e:
            data, status, rct = e.read(), e.code, e.headers.get("Content-Type", "application/json")
        except URLError as e:
            data, status, rct = (b'{"ok":false,"error":"proxy"}'), 502, "application/json"
        self.send_response(status)
        self.send_header("Content-Type", rct)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        return self._proxy() if self._is_api() else super().do_GET()

    def do_POST(self):
        if self._is_api():
            return self._proxy()
        self.send_error(404)

    def end_headers(self):
        # Evita que el navegador cachee los módulos JS (fin de la pelea con la caché).
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"Preview: http://localhost:{PORT}/dashboard.html   (API -> {UPSTREAM})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
