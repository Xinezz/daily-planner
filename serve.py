"""Tiny local web server for the planner.

Run:  python serve.py        (then open http://localhost:5173)
Unlike `python -m http.server`, it tells the browser never to cache, so edits show on refresh.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    server = ThreadingHTTPServer(("", port), NoCacheHandler)
    print(f"Serving on http://localhost:{port}  (Ctrl+C to stop)")
    server.serve_forever()
