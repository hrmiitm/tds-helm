#!/usr/bin/env bash
# entrypoint.sh — Studio Universal v4.2.0 Process Supervisor
# Implements spec.md Section 5.1 process lifecycle, health monitoring, and graceful termination.
set -Eeuo pipefail

echo "========================================================"
echo " Starting Studio Universal v4.2.0 (RAG Stack 3.11)"
echo " Non-root UID: $(id -u), GID: $(id -g), User: $(whoami)"
echo " Workspace: /workspace"
echo "========================================================"

# Process tracking
NGINX_PID=""
NGINX_PGID=""
VSC_PID=""
VSC_PGID=""
JUPYTER_PID=""
JUPYTER_PGID=""
API_PID=""
API_PGID=""
BROWSER_PID=""
BROWSER_PGID=""
WATCHDOG_PID=""
CLEANING_UP=0
EXIT_CODE=0

cleanup() {
    local rc=$?
    if [ "$CLEANING_UP" -eq 1 ]; then
        return
    fi
    CLEANING_UP=1
    if [ "$rc" -ne 0 ] && [ "$EXIT_CODE" -eq 0 ]; then
        EXIT_CODE="$rc"
    fi
    echo "[supervisor] Received termination signal (exit code: $EXIT_CODE). Initiating graceful shutdown..."

    # Clear readiness immediately
    rm -f /tmp/rag-health/ready.json
    echo '{"status":"stopping"}' > /tmp/rag-health/status.json 2>/dev/null || true

    # Send SIGTERM to process groups
    for pgid in "$BROWSER_PGID" "$API_PGID" "$JUPYTER_PGID" "$VSC_PGID" "$NGINX_PGID"; do
        if [ -n "$pgid" ]; then
            echo "[supervisor] Sending SIGTERM to process group -$pgid"
            kill -TERM "-$pgid" 2>/dev/null || true
        fi
    done
    for pid in "$BROWSER_PID" "$API_PID" "$JUPYTER_PID" "$VSC_PID" "$NGINX_PID" "$WATCHDOG_PID"; do
        if [ -n "$pid" ]; then
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done

    # Allow up to 10 seconds for graceful termination
    for i in {1..10}; do
        alive=0
        for pid in "$BROWSER_PID" "$API_PID" "$JUPYTER_PID" "$VSC_PID" "$NGINX_PID"; do
            if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                alive=1
            fi
        done
        if [ "$alive" -eq 0 ]; then
            echo "[supervisor] All services terminated cleanly."
            break
        fi
        sleep 1
    done

    # Force kill any lingering processes
    for pgid in "$BROWSER_PGID" "$API_PGID" "$JUPYTER_PGID" "$VSC_PGID" "$NGINX_PGID"; do
        if [ -n "$pgid" ]; then
            kill -KILL "-$pgid" 2>/dev/null || true
        fi
    done
    for pid in "$BROWSER_PID" "$API_PID" "$JUPYTER_PID" "$VSC_PID" "$NGINX_PID" "$WATCHDOG_PID"; do
        if [ -n "$pid" ]; then
            kill -KILL "$pid" 2>/dev/null || true
        fi
    done

    echo "[supervisor] Shutdown complete. Exiting with code $EXIT_CODE."
    exit "$EXIT_CODE"
}

trap cleanup SIGTERM SIGINT EXIT

# 1. Directory & Permission Validation
mkdir -p /tmp/rag-config /tmp/rag-health
mkdir -p /tmp/nginx/client /tmp/nginx/proxy /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi
rm -f /tmp/rag-health/ready.json
echo '{"status":"starting"}' > /tmp/rag-health/status.json

# Determine active chapter (defaults to rag-mcp, or CHAPTER/STUDIO_COURSE_ID env var)
ACTIVE_CHAPTER="${CHAPTER:-${STUDIO_COURSE_ID:-rag-mcp}}"
echo "[supervisor] Active Chapter configured: $ACTIVE_CHAPTER"

TEMPLATE_DIR="/opt/course-templates/$ACTIVE_CHAPTER"
if [ ! -d "$TEMPLATE_DIR" ] && [ -d "/opt/course-template" ]; then
    TEMPLATE_DIR="/opt/course-template"
fi

if [ -d "$TEMPLATE_DIR" ]; then
    CURRENT_VERSION=$(cat /workspace/.course_version 2>/dev/null || echo "")
    EXPECTED_VERSION="4.4.0-$ACTIVE_CHAPTER"
    NOTEBOOKS_COUNT=$(find /workspace/notebooks -name "*.ipynb" 2>/dev/null | wc -l || echo "0")
    if [ "$CURRENT_VERSION" != "$EXPECTED_VERSION" ] || [ -z "$(ls -A /workspace 2>/dev/null)" ] || [ "$NOTEBOOKS_COUNT" -lt 6 ]; then
        echo "[supervisor] Seeding workspace for $ACTIVE_CHAPTER from $TEMPLATE_DIR..."
        rm -rf /workspace/* /workspace/.[!.]* 2>/dev/null || true
        cp -a "$TEMPLATE_DIR/." /workspace/
        rm -rf /workspace/rag_course /workspace/rag_course.egg-info /workspace/setup.py /workspace/requirements.txt /workspace/solutions /workspace/results /workspace/__pycache__ 2>/dev/null || true
        echo "$EXPECTED_VERSION" > /workspace/.course_version
        echo "$ACTIVE_CHAPTER" > /workspace/.active_chapter
        echo "[supervisor] Workspace seeded successfully for $ACTIVE_CHAPTER."
    fi
fi

# Ensure workspace .vscode settings exist
mkdir -p /workspace/.vscode
cat << 'EOF' > /workspace/.vscode/settings.json
{
  "workbench.colorTheme": "Default Dark Modern",
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 1000,
  "files.exclude": {
    "**/.git": true,
    "**/.course_version": true,
    "**/.active_chapter": true,
    "**/.vscode": true,
    "**/__pycache__": true,
    "**/*.pyc": true,
    "**/rag_course": true,
    "**/rag_course.egg-info": true,
    "**/setup.py": true,
    "**/requirements.txt": true,
    "**/results": true,
    "**/solutions": true
  }
}
EOF

# Ensure first-run VS Code and Chromium config directories exist
mkdir -p /home/coder/.local/share/code-server/User /home/coder/.config/chromium /home/coder/.config/code-server
cat << 'EOF' > /home/coder/.config/code-server/config.yaml
bind-addr: 127.0.0.1:8081
auth: none
cert: false
EOF

cat << 'EOF' > /home/coder/.local/share/code-server/User/settings.json
{
  "workbench.colorTheme": "Default Dark Modern",
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoUpdate": false,
  "extensions.autoCheckUpdates": false,
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 1000,
  "files.exclude": {
    "**/.git": true,
    "**/.svn": true,
    "**/.hg": true,
    "**/CVS": true,
    "**/.DS_Store": true,
    "**/Thumbs.db": true,
    "**/.course_version": true,
    "**/.active_chapter": true,
    "**/__pycache__": true,
    "**/rag_course": true,
    "**/rag_course.egg-info": true,
    "**/setup.py": true,
    "**/solutions": true,
    "**/results": true
  }
}
EOF

# 2. Render dynamic configuration
RENDER_SCRIPT="/scripts/render_config.py"
if [ ! -f "$RENDER_SCRIPT" ]; then
    RENDER_SCRIPT="./scripts/render_config.py"
fi
python3 "$RENDER_SCRIPT"

# 3. Test Nginx Configuration
echo "[supervisor] Testing Nginx configuration..."
nginx -t -c /tmp/rag-config/nginx.conf

# 4. Start Nginx Gateway
echo "[supervisor] Starting Nginx gateway on port 8080..."
setsid nginx -c /tmp/rag-config/nginx.conf -g 'daemon off;' &
NGINX_PID=$!
NGINX_PGID=$(ps -o pgid= -p "$NGINX_PID" | tr -d ' ')
echo "[supervisor] Nginx running (PID: $NGINX_PID, PGID: $NGINX_PGID)"

# 5. Start Code-Server on 127.0.0.1:8081
echo "[supervisor] Starting code-server on 127.0.0.1:8081..."
PORT=8081 setsid code-server \
    --config /home/coder/.config/code-server/config.yaml \
    --bind-addr 127.0.0.1:8081 \
    --auth none \
    --disable-telemetry \
    --disable-update-check \
    /workspace &
VSC_PID=$!
VSC_PGID=$(ps -o pgid= -p "$VSC_PID" | tr -d ' ')
echo "[supervisor] code-server running (PID: $VSC_PID, PGID: $VSC_PGID)"

# 6. Start Studio Controller API on 127.0.0.1:8082
echo "[supervisor] Starting Studio Controller on 127.0.0.1:8082..."
CONTROLLER_SCRIPT="/scripts/api_server.py"
if [ ! -f "$CONTROLLER_SCRIPT" ]; then
    CONTROLLER_SCRIPT="./scripts/api_server.py"
fi
setsid python3 "$CONTROLLER_SCRIPT" &
API_PID=$!
API_PGID=$(ps -o pgid= -p "$API_PID" | tr -d ' ')
echo "[supervisor] Studio Controller running (PID: $API_PID, PGID: $API_PGID)"

# 7. Start JupyterLab on 127.0.0.1:8888
echo "[supervisor] Starting JupyterLab on 127.0.0.1:8888..."
setsid jupyter lab --config=/tmp/rag-config/jupyter_server_config.py &
JUPYTER_PID=$!
JUPYTER_PGID=$(ps -o pgid= -p "$JUPYTER_PID" | tr -d ' ')
echo "[supervisor] JupyterLab running (PID: $JUPYTER_PID, PGID: $JUPYTER_PGID)"

# 8. Start Chromium Browser Stack on 127.0.0.1:6080
echo "[supervisor] Starting Chromium Browser stack on 127.0.0.1:6080..."
BROWSER_SCRIPT="/scripts/start_browser.sh"
if [ ! -f "$BROWSER_SCRIPT" ]; then
    BROWSER_SCRIPT="./scripts/start_browser.sh"
fi
setsid "$BROWSER_SCRIPT" &
BROWSER_PID=$!
BROWSER_PGID=$(ps -o pgid= -p "$BROWSER_PID" | tr -d ' ')
echo "[supervisor] Browser stack running (PID: $BROWSER_PID, PGID: $BROWSER_PGID)"

# 9. Wait for service readiness (deadline: 60s target, 120s max)
echo "[supervisor] Waiting for services to become responsive..."
DEADLINE=$((SECONDS + 120))
READY=0

while [ $SECONDS -lt $DEADLINE ]; do
    # Check if any process died early
    if ! kill -0 "$NGINX_PID" 2>/dev/null; then
        echo "[supervisor] ERROR: Nginx exited unexpectedly!"
        exit 1
    fi
    if ! kill -0 "$VSC_PID" 2>/dev/null; then
        echo "[supervisor] ERROR: code-server exited unexpectedly!"
        exit 1
    fi
    if ! kill -0 "$JUPYTER_PID" 2>/dev/null; then
        echo "[supervisor] ERROR: JupyterLab exited unexpectedly!"
        exit 1
    fi
    if ! kill -0 "$API_PID" 2>/dev/null; then
        echo "[supervisor] ERROR: Studio Controller exited unexpectedly!"
        exit 1
    fi
    if ! kill -0 "$BROWSER_PID" 2>/dev/null; then
        echo "[supervisor] ERROR: Browser stack exited unexpectedly!"
        exit 1
    fi

    # Check Nginx live
    NGINX_OK=0
    curl -fsS http://127.0.0.1:8080/health/live >/dev/null 2>&1 && NGINX_OK=1 || true

    # Check code-server healthz via Nginx
    VSC_OK=0
    curl -fsS http://127.0.0.1:8080/vscode/healthz >/dev/null 2>&1 && VSC_OK=1 || true

    # Check Jupyter API via Nginx
    JUP_OK=0
    curl -fsS http://127.0.0.1:8080/jupyter/api >/dev/null 2>&1 && JUP_OK=1 || true

    # Check Controller API via Nginx
    API_OK=0
    curl -fsS http://127.0.0.1:8080/api/v1/health >/dev/null 2>&1 && API_OK=1 || true

    # Check Browser stack via direct port 6080
    BROWSER_OK=0
    curl -fsS http://127.0.0.1:6080/vnc.html >/dev/null 2>&1 && BROWSER_OK=1 || true

    if [ "$NGINX_OK" -eq 1 ] && [ "$VSC_OK" -eq 1 ] && [ "$JUPYTER_PID" -gt 0 ] && [ "$JUP_OK" -eq 1 ] && [ "$API_OK" -eq 1 ] && [ "$BROWSER_OK" -eq 1 ]; then
        READY=1
        break
    fi

    sleep 1
done

if [ "$READY" -ne 1 ]; then
    echo "[supervisor] ERROR: Timed out waiting for service readiness after 120 seconds."
    exit 1
fi

# 10. Mark environment ready
cat << 'EOF' > /tmp/rag-health/ready.tmp.json
{"status":"ready","ready":true,"version":"4.2.0"}
EOF
mv /tmp/rag-health/ready.tmp.json /tmp/rag-health/ready.json

cat << 'EOF' > /tmp/rag-health/status.json
{"status":"ready","nginx":true,"vscode":true,"jupyter":true,"controller":true,"browser":true,"version":"4.2.0"}
EOF

echo "========================================================"
echo " Studio Universal v4.2.0 is READY and accepting traffic!"
echo " Universal Hub URL: http://localhost:8080"
echo " Slides Deck:       http://localhost:8080/slides/"
echo " VS Code Web:       http://localhost:8080/vscode/"
echo " JupyterLab:        http://localhost:8080/jupyter/"
echo " Chromium Browser:  http://localhost:8080/browser/vnc.html"
echo " Controller API:    http://localhost:8080/api/v1/health"
echo " Full-Stack Preview http://localhost:8080/preview/8000/"
echo "========================================================"

# 11. Supervised Background Watchdog & Foreground Process Wait
(
    CONSECUTIVE_FAILURES=0
    while true; do
        sleep 5
        PROBE_OK=1
        curl -fsS --max-time 2 http://127.0.0.1:8080/health/live >/dev/null 2>&1 || PROBE_OK=0
        curl -fsS --max-time 2 http://127.0.0.1:8080/vscode/healthz >/dev/null 2>&1 || PROBE_OK=0
        curl -fsS --max-time 2 http://127.0.0.1:8080/jupyter/api >/dev/null 2>&1 || PROBE_OK=0
        curl -fsS --max-time 2 http://127.0.0.1:8080/api/v1/health >/dev/null 2>&1 || PROBE_OK=0
        curl -fsS --max-time 2 http://127.0.0.1:6080/vnc.html >/dev/null 2>&1 || PROBE_OK=0

        if [ "$PROBE_OK" -eq 1 ]; then
            CONSECUTIVE_FAILURES=0
        else
            CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
            echo "[watchdog] WARNING: Health probe failed ($CONSECUTIVE_FAILURES/3)"
            rm -f /tmp/rag-health/ready.json
            if [ "$CONSECUTIVE_FAILURES" -ge 3 ]; then
                echo "[watchdog] ERROR: 3 consecutive probe failures. Triggering supervisor shutdown."
                echo '{"status":"unhealthy","error":"probe-failed"}' > /tmp/rag-health/status.json 2>/dev/null || true
                exit 1
            fi
        fi
    done
) &
WATCHDOG_PID=$!

# Observe processes using wait -n
set +e
wait -n "$NGINX_PID" "$VSC_PID" "$JUPYTER_PID" "$API_PID" "$BROWSER_PID" "$WATCHDOG_PID"
EXIT_CODE=$?
echo "[supervisor] A core process terminated unexpectedly with code: $EXIT_CODE"
exit "$EXIT_CODE"

