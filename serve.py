#!/usr/bin/env python3
"""serve.py - server statis untuk dashboard ini, dengan Cache-Control: no-store.

Kenapa bukan `python3 -m http.server`: server bawaan tidak mengirim Cache-Control,
jadi browser menyimpan index.html lama di samping css/js baru dan halaman tampak
rusak padahal berkasnya benar. Server ini mematikan cache supaya setiap muat ulang
membaca berkas terbaru.

Pakai:
    python3 serve.py            # port 8099
    python3 serve.py 8123
"""

from __future__ import annotations

import http.server
import socketserver
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), Handler) as httpd:
        print(f"dashboard: http://127.0.0.1:{port}/")
        print("berhenti: Ctrl+C")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nberhenti")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
