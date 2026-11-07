#!/usr/bin/env bash
# scripts/start_browser.sh — Headless Chromium X11/noVNC Stack Supervisor
# Starts and supervises Xvfb, Openbox, x11vnc, websockify (noVNC), and Chromium.

set -Eeuo pipefail

echo "========================================================"
echo " Starting Headless Chromium Browser Stack (UID: $(id -u))"
echo "========================================================"

XVFB_PID=""
OPENBOX_PID=""
X11VNC_PID=""
WEBSOCKIFY_PID=""
CHROMIUM_PID=""
CLEANING_UP=0

cleanup() {
    if [ "$CLEANING_UP" -eq 1 ]; then
        return
    fi
    CLEANING_UP=1
    echo "[browser] Termination signal received. Stopping browser processes..."

    # Graceful stop
    for pid in "$CHROMIUM_PID" "$WEBSOCKIFY_PID" "$X11VNC_PID" "$OPENBOX_PID" "$XVFB_PID"; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done

    # Allow up to 5 seconds for child processes to exit
    for i in {1..10}; do
        alive=0
        for pid in "$CHROMIUM_PID" "$WEBSOCKIFY_PID" "$X11VNC_PID" "$OPENBOX_PID" "$XVFB_PID"; do
            if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                alive=1
            fi
        done
        if [ "$alive" -eq 0 ]; then
            break
        fi
        sleep 0.5
    done

    # Force kill any lingering processes
    for pid in "$CHROMIUM_PID" "$WEBSOCKIFY_PID" "$X11VNC_PID" "$OPENBOX_PID" "$XVFB_PID"; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill -KILL "$pid" 2>/dev/null || true
        fi
    done

    # Clean up X11 lock files
    rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true
    echo "[browser] Browser stack stopped cleanly."
    exit 0
}

trap cleanup SIGTERM SIGINT EXIT

# Ensure configuration directory exists
mkdir -p /home/coder/.config/chromium

# Remove stale display locks if present
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true

# Display environment
export DISPLAY=:1

# 1. Start Xvfb virtual framebuffer
echo "[browser] Starting Xvfb on display :1..."
Xvfb :1 -screen 0 1280x800x24 &
XVFB_PID=$!

# Wait for Xvfb display socket or process readiness
for i in {1..30}; do
    if [ -e "/tmp/.X11-unix/X1" ] || kill -0 "$XVFB_PID" 2>/dev/null; then
        sleep 0.2
        break
    fi
    sleep 0.1
done

# 2. Start Openbox window manager
echo "[browser] Starting openbox..."
openbox &
OPENBOX_PID=$!
sleep 0.5

# 3. Start x11vnc VNC bridge
echo "[browser] Starting x11vnc..."
x11vnc -display :1 -nopw -listen 127.0.0.1 -rfbport 5900 -forever -shared -quiet &
X11VNC_PID=$!
sleep 0.5

# 4. Start websockify for noVNC HTML5 client
echo "[browser] Starting websockify (noVNC)..."
websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 &
WEBSOCKIFY_PID=$!
sleep 0.5

# 5. Start Chromium browser with persistent profile
echo "[browser] Starting Chromium browser..."
chromium --no-sandbox --test-type --disable-gpu --disable-dev-shm-usage --user-data-dir=/home/coder/.config/chromium --start-maximized --no-first-run --no-default-browser-check https://www.google.com/ &
CHROMIUM_PID=$!

echo "[browser] Browser stack started successfully (websockify on 127.0.0.1:6080)."

# 6. Process supervisor loop
while true; do
    if ! kill -0 "$XVFB_PID" 2>/dev/null; then
        echo "[browser] ERROR: Xvfb terminated unexpectedly!"
        exit 1
    fi
    if ! kill -0 "$OPENBOX_PID" 2>/dev/null; then
        echo "[browser] WARNING: openbox terminated, restarting..."
        openbox &
        OPENBOX_PID=$!
    fi
    if ! kill -0 "$X11VNC_PID" 2>/dev/null; then
        echo "[browser] ERROR: x11vnc terminated unexpectedly!"
        exit 1
    fi
    if ! kill -0 "$WEBSOCKIFY_PID" 2>/dev/null; then
        echo "[browser] ERROR: websockify terminated unexpectedly!"
        exit 1
    fi
    if ! kill -0 "$CHROMIUM_PID" 2>/dev/null; then
        echo "[browser] WARNING: Chromium exited, restarting..."
        chromium --no-sandbox --test-type --disable-gpu --disable-dev-shm-usage --user-data-dir=/home/coder/.config/chromium --start-maximized --no-first-run --no-default-browser-check https://www.google.com/ &
        CHROMIUM_PID=$!
    fi
    sleep 2
done
