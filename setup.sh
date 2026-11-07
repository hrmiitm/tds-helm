#!/usr/bin/env bash
# ==============================================================================
# setup.sh — Universal Quick-Start Launcher for Studio Universal & Labs
# Supports: Linux (Ubuntu, Debian, Fedora, Arch, RHEL, openSUSE), macOS, WSL2
# ==============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPT_DIR"

IMAGE_NAME="rag-studio:4.2.0"
GATEWAY_PORT=8080
GATEWAY_URL="http://127.0.0.1:$GATEWAY_PORT"

COLOR_CYAN='\033[0;36m'
COLOR_GREEN='\033[0;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_RED='\033[0;31m'
COLOR_RESET='\033[0m'

log_info() { printf "${COLOR_CYAN}[setup]${COLOR_RESET} %s\n" "$*"; }
log_ok()   { printf "${COLOR_GREEN}[setup:ok]${COLOR_RESET} %s\n" "$*"; }
log_warn() { printf "${COLOR_YELLOW}[setup:warn]${COLOR_RESET} %s\n" "$*"; }
log_err()  { printf "${COLOR_RED}[setup:error]${COLOR_RESET} %s\n" "$*" >&2; }

echo "======================================================================"
echo " Studio Universal v4.2 — Quick Start & Unified Lab Environment"
echo " Foundations of RAG & Vector Databases"
echo "======================================================================"

# Step 1: Detect container engine
ENGINE=""
if command -v docker >/dev/null 2>&1; then
    ENGINE="docker"
elif command -v podman >/dev/null 2>&1; then
    ENGINE="podman"
else
    log_err "Neither docker nor podman was found on your system."
    log_err "Please install Docker Desktop or Podman and try again."
    exit 3
fi

# Verify container engine is actively running
if ! $ENGINE info >/dev/null 2>&1; then
    log_err "Container engine '$ENGINE' is installed but the daemon is not running."
    log_err "Please start Docker/Podman (e.g. 'sudo systemctl start docker' or launch Docker Desktop) and retry."
    exit 4
fi
log_ok "Container engine verified: $ENGINE"

# Step 2: Check Node.js and npm
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    log_err "Node.js and npm are required on the host to run the controller and client."
    log_err "Please install Node.js 18+ (https://nodejs.org/) and retry."
    exit 3
fi
NODE_VER=$(node -v)
log_ok "Node.js runtime verified: $NODE_VER"

# Step 3: Check / Build Container Image
log_info "Checking runtime image '$IMAGE_NAME'..."
if ! $ENGINE image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    log_warn "Runtime image '$IMAGE_NAME' not found locally. Initiating automated build..."
    $ENGINE build -t "$IMAGE_NAME" .
    log_ok "Container image built successfully: $IMAGE_NAME"
else
    log_ok "Runtime image found: $IMAGE_NAME"
fi

# Step 4: Build Host Orchestrator Controller
log_info "Ensuring orchestrator controller is built..."
if [ ! -d "orchestrator/node_modules" ]; then
    (cd orchestrator && npm install --no-audit --no-fund)
fi
(cd orchestrator && npm run build --silent)
log_ok "Orchestrator build complete."

# Step 5: Ensure Desktop Client dependencies are installed
log_info "Ensuring desktop application dependencies are ready..."
if [ ! -d "desktop-app/node_modules" ]; then
    (cd desktop-app && npm install --no-audit --no-fund)
elif [ ! -f "desktop-app/node_modules/electron/path.txt" ]; then
    (cd desktop-app/node_modules/electron && node install.js)
fi
log_ok "Desktop dependencies ready."

# Step 6: Start Host Orchestrator in Background
ORCHESTRATOR_PID=""
cleanup() {
    if [ -n "$ORCHESTRATOR_PID" ]; then
        log_info "Stopping background orchestrator (PID $ORCHESTRATOR_PID)..."
        kill "$ORCHESTRATOR_PID" 2>/dev/null || true
        wait "$ORCHESTRATOR_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

if curl -fsS "$GATEWAY_URL/orchestrator/health/live" >/dev/null 2>&1; then
    log_ok "Orchestrator is already running on $GATEWAY_URL."
else
    log_info "Starting background orchestrator on $GATEWAY_URL..."
    node orchestrator/dist/server.js &
    ORCHESTRATOR_PID=$!

    READY=0
    for i in {1..25}; do
        if curl -fsS "$GATEWAY_URL/orchestrator/health/live" >/dev/null 2>&1; then
            READY=1
            break
        fi
        sleep 1
    done

    if [ "$READY" -ne 1 ]; then
        log_err "Orchestrator failed to become healthy within 25s."
        exit 5
    fi
    log_ok "Orchestrator gateway is active on $GATEWAY_URL"
fi

# Step 7: Launch Application
# Detect display environment (Linux X11/Wayland or macOS)
HAS_DISPLAY=0
if [ "${OSTYPE:-}" = "darwin"* ] || [ "$(uname -s)" = "Darwin" ]; then
    HAS_DISPLAY=1
elif [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
    HAS_DISPLAY=1
fi

export RAG_STUDIO_URL="$GATEWAY_URL"

if [ "$HAS_DISPLAY" -eq 1 ]; then
    log_ok "Launching native Electron desktop app..."
    (cd desktop-app && npx electron . --no-sandbox)
else
    log_info "Headless environment detected (no X11 / Wayland display)."
    log_ok "Studio Universal is running and ready at: $GATEWAY_URL"
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$GATEWAY_URL" >/dev/null 2>&1 || true
    fi
    log_info "Press Ctrl+C to terminate the session."
    if [ -n "$ORCHESTRATOR_PID" ]; then
        wait "$ORCHESTRATOR_PID"
    else
        while true; do sleep 3600; done
    fi
fi
