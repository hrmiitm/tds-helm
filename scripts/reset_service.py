#!/usr/bin/env python3
"""
scripts/reset_service.py — Studio Universal v4.2 Workspace Reset Daemon
Listens on 127.0.0.1:8090 and handles POST /api/v1/workspace/reset
Executes /scripts/reset_workspace.sh safely without root privileges.
"""
import sys
import os
import json
import subprocess
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 8090

class ResetHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        sys.stderr.write(f"[reset_service] {format % args}\n")

    def do_GET(self):
        if self.path in ("/health/live", "/health/ready"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok","service":"reset"}\n')
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path == "/api/v1/workspace/reset":
            content_len = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}"
            try:
                payload = json.loads(body)
            except Exception:
                payload = {}

            course_id = payload.get("courseId", "rag-intro")
            # Sanitize course_id against traversal
            if not course_id.replace("-", "").replace("_", "").isalnum():
                course_id = "rag-intro"

            reset_script = "/scripts/reset_workspace.sh"
            if not os.path.exists(reset_script):
                # Fallback to relative path in dev
                reset_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reset_workspace.sh")

            try:
                proc = subprocess.run(
                    ["/usr/bin/env", "bash", reset_script, course_id],
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                if proc.returncode == 0:
                    resp_data = proc.stdout.strip()
                    try:
                        # Validate JSON output
                        json.loads(resp_data)
                    except Exception:
                        resp_data = json.dumps({"status": "ok", "courseId": course_id, "generation": 2})
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(resp_data.encode("utf-8") + b"\n")
                else:
                    self.send_response(500)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    err_msg = json.dumps({"status": "error", "message": proc.stderr.strip() or "Reset failed"})
                    self.wfile.write(err_msg.encode("utf-8") + b"\n")
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                err_msg = json.dumps({"status": "error", "message": str(e)})
                self.wfile.write(err_msg.encode("utf-8") + b"\n")
            return

        self.send_response(404)
        self.end_headers()

def main():
    server = HTTPServer(("127.0.0.1", PORT), ResetHandler)
    print(f"[reset_service] Listening on 127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()

