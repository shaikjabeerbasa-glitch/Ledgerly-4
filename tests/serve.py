"""Serve the application for concurrent browser tests."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class TestServer(ThreadingHTTPServer):
    # Browser projects open many asset connections at once.
    request_queue_size = 128


root = Path(__file__).resolve().parent.parent
handler = partial(SimpleHTTPRequestHandler, directory=str(root))
with TestServer(("127.0.0.1", 8776), handler) as server:
    server.serve_forever()
