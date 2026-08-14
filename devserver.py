#!/usr/bin/env python3
"""Serve the prototype with caching turned off.

`python3 -m http.server` caches ES modules, so after you edit a module the
browser keeps serving the old one: you get a white screen, or a console full of
missing-export errors for exports that are right there in the file. That has
cost this project real debugging time more than once.

This serves the directory the script lives in, with `Cache-Control: no-store`
on every response, so a reload always gets the file you just saved.

    python3 prototype/vision-engine/devserver.py 8810   # then http://localhost:8810

The multiplayer sync server is a separate thing (`server.js`). Without it the
console logs a failed `ws://.../ws` connection and the app falls back to
single-tab local sync, which is expected and fine for solo play.
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8810
    handler = partial(NoCache, directory=ROOT)
    print(f"serving {ROOT} on http://localhost:{port} (no-store)")
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()


if __name__ == "__main__":
    main()
