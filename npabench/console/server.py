"""HTTP server for the mining console."""
from __future__ import annotations

import json
import logging
import socket
import threading
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from npabench.console.session import MiningSession

log = logging.getLogger("npabench.console")
STATIC = Path(__file__).resolve().parent / "static"
PAGES = {
    "/": (STATIC / "index.html", "text/html; charset=utf-8"),
    "/app.css": (STATIC / "app.css", "text/css; charset=utf-8"),
    "/app.js": (STATIC / "app.js", "text/javascript; charset=utf-8"),
    "/terrain.js": (STATIC / "terrain.js", "text/javascript; charset=utf-8"),
}
_MAX_BODY = 32_768
_VIEWER_PORT = 3007
_HOP_HEADERS = {"connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade"}


def _query_int(query: dict, key: str) -> int:
    raw = query.get(key, ["0"])[0]
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def viewer_upstream(raw_path: str) -> str | None:
    """Map the dashboard world view onto the local Minecraft viewer."""
    parsed = urlsplit(raw_path)
    query = f"?{parsed.query}" if parsed.query else ""
    path = parsed.path
    if path == "/mc" or path.startswith("/mc/"):
        rest = path[3:] or "/"
        if not rest.startswith("/"):
            rest = "/" + rest
        return rest + query
    if path == "/socket.io" or path.startswith("/socket.io/"):
        return path + query
    return None


class ConsoleHandler(BaseHTTPRequestHandler):
    session = MiningSession()

    def log_message(self, fmt: str, *args) -> None:
        log.info("%s %s", self.address_string(), fmt % args)

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: int, payload: dict) -> None:
        self._send(status, json.dumps(payload).encode("utf-8"), "application/json")

    def do_GET(self) -> None:  # noqa: N802
        upstream = viewer_upstream(self.path)
        if upstream is not None:
            self._proxy_viewer(upstream)
            return
        path = urlsplit(self.path).path.rstrip("/") or "/"
        try:
            if path == "/api/session":
                query = parse_qs(urlsplit(self.path).query)
                self._send_json(200, self.session.status(_query_int(query, "logs"), _query_int(query, "mind")))
                return
            page = PAGES.get(path)
            if page is None:
                self._send_json(404, {"detail": "not found"})
                return
            file_path, content_type = page
            self._send(200, file_path.read_bytes(), content_type)
        except Exception as exc:
            log.exception("GET %s failed", path)
            self._send_json(500, {"detail": str(exc)})

    def do_POST(self) -> None:  # noqa: N802
        upstream = viewer_upstream(self.path)
        if upstream is not None:
            self._proxy_viewer(upstream)
            return
        path = urlsplit(self.path).path.rstrip("/") or "/"
        try:
            if path != "/api/mine":
                self._send_json(404, {"detail": "not found"})
                return
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > _MAX_BODY:
                self._send_json(400, {"detail": "request body is too large"})
                return
            payload: dict = {}
            if length:
                raw = self.rfile.read(length)
                try:
                    loaded = json.loads(raw.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    self._send_json(400, {"detail": "expected a JSON body"})
                    return
                if not isinstance(loaded, dict):
                    self._send_json(400, {"detail": "expected a JSON object"})
                    return
                payload = loaded
            seed = payload.get("seed", 0)
            self.session.start(seed=seed)
            self._send_json(200, self.session.status(0))
        except ValueError as exc:
            self._send_json(400, {"detail": str(exc)})
        except RuntimeError as exc:
            self._send_json(409, {"detail": str(exc)})
        except Exception as exc:
            log.exception("POST %s failed", path)
            self._send_json(500, {"detail": str(exc)})

    def _proxy_viewer(self, upstream: str) -> None:
        upgrade = self.headers.get("Upgrade", "")
        if upgrade.lower() == "websocket":
            self._tunnel_viewer(upstream)
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else None
        headers = {
            key: (f"127.0.0.1:{_VIEWER_PORT}" if key.lower() == "host" else value)
            for key, value in self.headers.items()
            if key.lower() not in _HOP_HEADERS
        }
        try:
            conn = HTTPConnection("127.0.0.1", _VIEWER_PORT, timeout=60)
            conn.request(self.command, upstream, body=body, headers=headers)
            response = conn.getresponse()
        except OSError:
            self._send(502, b"Minecraft viewer is not running yet.", "text/plain; charset=utf-8")
            return
        self.send_response(response.status)
        for key, value in response.headers.items():
            if key.lower() in _HOP_HEADERS or key.lower() == "content-length":
                continue
            self.send_header(key, value)
        declared = response.getheader("Content-Length")
        if declared is None:
            payload = response.read()
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        self.send_header("Content-Length", declared)
        self.end_headers()
        remaining = int(declared)
        while remaining > 0:
            chunk = response.read(min(256 * 1024, remaining))
            if not chunk:
                break
            self.wfile.write(chunk)
            remaining -= len(chunk)

    def _tunnel_viewer(self, upstream: str) -> None:
        try:
            upstream_sock = socket.create_connection(("127.0.0.1", _VIEWER_PORT), timeout=10)
        except OSError:
            self._send(502, b"Minecraft viewer is not running yet.", "text/plain; charset=utf-8")
            return
        header = [f"GET {upstream} HTTP/1.1"]
        for key, value in self.headers.items():
            if key.lower() == "host":
                value = f"127.0.0.1:{_VIEWER_PORT}"
            header.append(f"{key}: {value}")
        upstream_sock.sendall(("\r\n".join(header) + "\r\n\r\n").encode("iso-8859-1"))
        self.close_connection = True
        client = self.connection

        def pump(source: socket.socket, destination: socket.socket) -> None:
            try:
                while True:
                    chunk = source.recv(65536)
                    if not chunk:
                        break
                    destination.sendall(chunk)
            except OSError:
                pass
            for sock in (source, destination):
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

        left = threading.Thread(target=pump, args=(client, upstream_sock), daemon=True)
        right = threading.Thread(target=pump, args=(upstream_sock, client), daemon=True)
        left.start()
        right.start()
        left.join()
        right.join()


def serve(host: str = "127.0.0.1", port: int = 8765) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    server = ThreadingHTTPServer((host, port), ConsoleHandler)
    log.info("mining console at http://%s:%s", host, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("interrupted")
    finally:
        server.server_close()


def main() -> None:
    import os

    host = os.environ.get("NPABENCH_CONSOLE_HOST", "0.0.0.0")
    port = int(os.environ.get("NPABENCH_CONSOLE_PORT", "8766"))
    serve(host, port)


if __name__ == "__main__":
    main()
