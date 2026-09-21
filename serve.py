#!/usr/bin/env python3
"""Static server for Legends Arena.

- Disables browser caching so edited game files always take effect on reload.
- Accepts POST /_save?path=<relative path> so the headless training harness can
  write datasets/results straight into the project instead of going through the
  browser download folder. Paths are confined to the project directory.
"""
import http.server
import osz
import sys
import urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
MAX_UPLOAD = 512 * 1024 * 1024


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != '/_save':
            self.send_error(404, 'unknown endpoint')
            return
        rel = urllib.parse.parse_qs(parsed.query).get('path', [''])[0]
        target = os.path.abspath(os.path.join(ROOT, rel))
        if not rel or not target.startswith(ROOT + os.sep):
            self.send_error(400, 'path outside project root')
            return
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0 or length > MAX_UPLOAD:
            self.send_error(413, 'bad content length')
            return
        os.makedirs(os.path.dirname(target), exist_ok=True)
        remaining = length
        with open(target, 'wb') as fh:
            while remaining > 0:
                chunk = self.rfile.read(min(1 << 20, remaining))
                if not chunk:
                    break
                fh.write(chunk)
                remaining -= len(chunk)
        body = f'saved {rel} ({length} bytes)'.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        if 'GET' not in fmt % args:      # keep the console quiet except for saves
            super().log_message(fmt, *args)


if __name__ == '__main__':
    with http.server.ThreadingHTTPServer(('', PORT), Handler) as srv:
        print(f'Serving Legends Arena on http://localhost:{PORT} (no cache, POST /_save enabled)')
        srv.serve_forever()
