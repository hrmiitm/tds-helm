#!/usr/bin/env bash
# run-desktop.sh — Launcher for Studio Universal Native Desktop Client & Host Orchestrator
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$SCRIPT_DIR/desktop-app"
ORCHESTRATOR_DIR="$SCRIPT_DIR/orchestrator"

echo "========================================================"
echo " Studio Universal v4.2 — Native Desktop Launcher"
echo " Mode:           Catalog-First Orchestration"
echo " Gateway Port:   8080"
echo "========================================================"

# Step 1: Build orchestrator controller
echo "[launcher] Ensuring orchestrator controller is built..."
(cd "$ORCHESTRATOR_DIR" && npm run build)

# Step 2: Check if Orchestrator Gateway is already running
ORCHESTRATOR_PID=""
if ! curl -fsS http://127.0.0.1:8080/orchestrator/health/live >/dev/null 2>&1; then
    echo "[launcher] Starting background host orchestrator on http://127.0.0.1:8080..."
    node "$ORCHESTRATOR_DIR/dist/server.js" &
    ORCHESTRATOR_PID=$!

    # Wait for orchestrator readiness (up to 15s)
    for i in {1..15}; do
        if curl -fsS http://127.0.0.1:8080/orchestrator/health/live >/dev/null 2>&1; then
            echo "[launcher] [OK] Orchestrator gateway is ready."
            break
        fi
        sleep 1
    done
fi

cleanup() {
    if [ -n "$ORCHESTRATOR_PID" ]; then
        echo "[launcher] Stopping background orchestrator (PID $ORCHESTRATOR_PID)..."
        kill "$ORCHESTRATOR_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

# Step 3: Ensure desktop-app dependencies and electron binary are installed
if [ ! -d "$DESKTOP_DIR/node_modules" ]; then
    echo "[launcher] Installing desktop dependencies in desktop-app/..."
    (cd "$DESKTOP_DIR" && npm install)
elif [ ! -f "$DESKTOP_DIR/node_modules/electron/path.txt" ]; then
    echo "[launcher] Downloading missing Electron runtime binary..."
    (cd "$DESKTOP_DIR/node_modules/electron" && node install.js)
fi

# Step 4: Launch Electron desktop client connected to Catalog
echo "[launcher] Launching native Electron desktop client..."
export RAG_STUDIO_URL="http://localhost:8080"
(cd "$DESKTOP_DIR" && npx electron . --no-sandbox)
