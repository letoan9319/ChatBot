"""Authenticated HTTP trigger for the Render fallback worker."""

import hmac
import logging
import os
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .config import Settings
from .main import serve


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    settings = Settings.load()
    secret = os.environ["WORKER_WAKE_SECRET"].encode()
    if len(secret) < 32 or settings.ai_provider != "openrouter":
        raise ValueError("Render requires a wake secret of at least 32 bytes and AI_PROVIDER=openrouter.")
    stopped = threading.Event()
    lock = threading.Lock()
    worker = None

    def run():
        try:
            serve(settings, stopped=stopped, idle_seconds=150, worker_id="learnstep-render")
        except Exception as exc:
            logging.warning("cloud_worker_stopped error_type=%s", type(exc).__name__)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def respond(self, code):
            self.send_response(code)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            self.respond(200 if self.path == "/healthz" else 404)

        def do_POST(self):
            nonlocal worker
            if self.path != "/wake":
                self.respond(404)
                return
            if not hmac.compare_digest(self.headers.get("Authorization", "").encode(), b"Bearer " + secret):
                self.respond(401)
                return
            with lock:
                if not worker or not worker.is_alive():
                    worker = threading.Thread(target=run, daemon=True)
                    worker.start()
            self.respond(202)

    server = ThreadingHTTPServer(("0.0.0.0", int(os.getenv("PORT", "10000"))), Handler)

    def shutdown(*_):
        stopped.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, shutdown)
    with server:
        server.serve_forever()


if __name__ == "__main__":
    main()
