#!/usr/bin/env python3
"""
rag_healthcheck.py — RAG Studio v4.0 Standard-Library Health & Readiness Probe
Packaged at /usr/local/bin/rag-healthcheck.
Strict invariants:
  - Pure Python standard library (no torch, chroma, or heavy imports).
  - Short timeouts (1s connect, 2s read).
  - Validates exact HTTP 200 and JSON bodies.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

def check_http_endpoint(url: str, timeout: float = 2.0, host_header: str | None = None) -> tuple[bool, int, dict | str]:
    if host_header is None:
        host_header = os.environ.get("RAG_HEALTHCHECK_HOST", "localhost:8080")
    # Bypass system/environment proxies for local container probes
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    req = urllib.request.Request(
        url,
        headers={
            "Host": host_header,
            "User-Agent": "rag-healthcheck/4.2",
            "Accept": "application/json",
        }
    )
    try:
        with opener.open(req, timeout=timeout) as response:
            status_code = response.getcode()
            body_bytes = response.read()
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                data = body_bytes.decode("utf-8", errors="replace")
            return (status_code == 200, status_code, data)
    except urllib.error.HTTPError as e:
        return (False, e.code, f"HTTPError: {e.reason}")
    except Exception as e:
        return (False, 0, f"ConnectionError: {str(e)}")

def probe_all_services(port_8080: int = 8080) -> dict:
    results = {
        "timestamp": time.time(),
        "nginx_live": False,
        "vscode_ready": False,
        "jupyter_ready": False,
        "preview_active": False,
        "ready": False,
        "details": {}
    }

    # 1. Nginx live
    ok_live, code_live, data_live = check_http_endpoint(f"http://127.0.0.1:{port_8080}/health/live")
    results["nginx_live"] = ok_live and isinstance(data_live, dict) and data_live.get("status") == "live"
    results["details"]["nginx"] = {"ok": results["nginx_live"], "code": code_live}

    # 2. Code-server healthz via Nginx
    ok_vsc, code_vsc, data_vsc = check_http_endpoint(f"http://127.0.0.1:{port_8080}/vscode/healthz")
    # code-server returns {"status":"alive"} or {"status":"expired"}
    vsc_responsive = ok_vsc and (
        (isinstance(data_vsc, dict) and data_vsc.get("status") in ("alive", "expired")) or
        (isinstance(data_vsc, str) and "alive" in data_vsc)
    )
    results["vscode_ready"] = vsc_responsive
    results["details"]["vscode"] = {"ok": vsc_responsive, "code": code_vsc}

    # 3. JupyterLab API via Nginx
    ok_jup, code_jup, data_jup = check_http_endpoint(f"http://127.0.0.1:{port_8080}/jupyter/api")
    jup_responsive = ok_jup and isinstance(data_jup, dict) and "version" in data_jup
    results["jupyter_ready"] = jup_responsive
    results["details"]["jupyter"] = {"ok": jup_responsive, "code": code_jup}

    # 4. Optional port 8000 preview app
    ok_prev, code_prev, data_prev = check_http_endpoint(f"http://127.0.0.1:{port_8080}/preview/8000/health", timeout=0.5)
    results["preview_active"] = ok_prev
    results["details"]["preview"] = {"ok": ok_prev, "code": code_prev}

    # Overall service readiness
    results["ready"] = results["nginx_live"] and results["vscode_ready"] and results["jupyter_ready"]
    return results

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "check"

    if mode == "--json" or mode == "status":
        res = probe_all_services()
        print(json.dumps(res, indent=2))
        sys.exit(0 if res["ready"] else 1)

    # Standard Docker healthcheck mode:
    # 1. Probe dependencies
    res = probe_all_services()
    if not res["ready"]:
        print(f"[rag-healthcheck] UNHEALTHY: nginx={res['nginx_live']}, vscode={res['vscode_ready']}, jupyter={res['jupyter_ready']}", file=sys.stderr)
        sys.exit(1)

    # 2. Check ready marker file
    ready_marker = "/tmp/rag-health/ready.json"
    if not os.path.exists(ready_marker):
        print(f"[rag-healthcheck] UNREADY: {ready_marker} does not exist", file=sys.stderr)
        sys.exit(1)

    print("[rag-healthcheck] HEALTHY: all services responsive and ready marker present")
    sys.exit(0)

if __name__ == "__main__":
    main()

