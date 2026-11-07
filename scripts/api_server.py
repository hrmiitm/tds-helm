#!/usr/bin/env python3
"""
api_server.py — Studio Universal v4.2 Lightweight Controller API Server
Provides internal management endpoints including:
  - POST /api/v1/workspace/reset (triggers workspace restoration)
  - GET  /api/v1/health / GET /health (controller health probe)
Runs on 127.0.0.1:8082 behind Nginx gateway.
"""

import os
import sys
import json
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# Add script directory to Python path
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

try:
    from reset_workspace import reset_workspace
except ImportError:
    reset_workspace = None

HOST = os.environ.get("CONTROLLER_HOST", "127.0.0.1")
PORT = int(os.environ.get("CONTROLLER_PORT", "8082"))

class StudioControllerHandler(BaseHTTPRequestHandler):
    server_version = "StudioUniversalController/4.2.0"

    def _send_json(self, status_code, data):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        normalized_path = self.path.split("?")[0].rstrip("/")
        if normalized_path in ("/api/v1/health", "/health", "/api/health"):
            self._send_json(200, {
                "status": "ok",
                "ready": True,
                "version": "4.2.0",
                "service": "studio-controller"
            })
        else:
            self._send_json(404, {"error": "not_found", "path": self.path})

    def do_POST(self):
        normalized_path = self.path.split("?")[0].rstrip("/")
        if normalized_path in ("/api/v1/workspace/reset", "/api/workspace/reset", "/api/v1/switch-chapter", "/api/switch-chapter"):
            content_length = int(self.headers.get("Content-Length", 0))
            body = {}
            if content_length > 0:
                raw_body = self.rfile.read(content_length)
                try:
                    body = json.loads(raw_body.decode("utf-8"))
                except Exception:
                    body = {}

            template_override = body.get("template")
            workspace_override = body.get("workspace")
            course_id = body.get("chapter") or body.get("course_id") or body.get("courseId") or "rag-intro"

            try:
                if reset_workspace:
                    result = reset_workspace(
                        custom_template=template_override,
                        custom_workspace=workspace_override,
                        course_id=course_id
                    )
                else:
                    # Fallback execution via subprocess
                    import subprocess
                    script_path = SCRIPT_DIR / "reset_workspace.py"
                    cmd = [sys.executable, str(script_path), "--course-id", str(course_id)]
                    if template_override:
                        cmd.extend(["--template", str(template_override)])
                    if workspace_override:
                        cmd.extend(["--workspace", str(workspace_override)])
                    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
                    result = {
                        "status": "ok",
                        "message": "Workspace successfully restored to template",
                        "output": res.stdout,
                        "course_id": course_id
                    }
                self._send_json(200, result)
            except Exception as e:
                self._send_json(500, {
                    "status": "error",
                    "message": f"Failed to reset workspace: {str(e)}"
                })
        elif normalized_path in ("/api/v1/browser/navigate", "/api/browser/navigate"):
            content_length = int(self.headers.get("Content-Length", 0))
            body = {}
            if content_length > 0:
                raw_body = self.rfile.read(content_length)
                try:
                    body = json.loads(raw_body.decode("utf-8"))
                except Exception:
                    body = {}
            target_url = (body.get("url") or "https://www.google.com").strip()
            if not target_url:
                target_url = "https://www.google.com"
            elif not (target_url.startswith("http://") or target_url.startswith("https://")):
                import urllib.parse
                if "." in target_url and " " not in target_url:
                    target_url = "https://" + target_url
                else:
                    target_url = "https://www.google.com/search?q=" + urllib.parse.quote(target_url)

            import subprocess
            env = os.environ.copy()
            env["DISPLAY"] = ":1"
            cmd = [
                "chromium",
                "--user-data-dir=/home/coder/.config/chromium",
                "--no-sandbox",
                "--test-type",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                target_url
            ]
            try:
                subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                self._send_json(200, {"status": "ok", "url": target_url})
            except Exception as e:
                self._send_json(500, {"status": "error", "message": str(e)})
        else:
            self._send_json(404, {"error": "not_found", "path": self.path})

    def log_message(self, format, *args):
        # Concise logging to stdout
        sys.stdout.write(f"[controller] {self.address_string()} - {format % args}\n")
        sys.stdout.flush()

def main():
    server = ThreadingHTTPServer((HOST, PORT), StudioControllerHandler)
    print(f"[controller] Studio Universal Controller API listening on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[controller] Shutting down.")
        server.server_close()

if __name__ == "__main__":
    main()
