#!/usr/bin/env bash
# scripts/reset_workspace.sh — Studio Universal v4.2 Hardened Workspace Reset Engine
# Restores /workspace from /opt/course-template or course-specific seed.
# Enforces strict slug validation, non-following of symlinks, and process quiescing.
set -Eeuo pipefail

COURSE_ID="${1:-rag-intro}"
WORKSPACE_DIR="/workspace"
TEMPLATE_DIR="/opt/course-template"

# 1. Strict validation of course ID to prevent path traversal
if [[ ! "$COURSE_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo '{"status":"error","message":"Invalid course ID format"}' >&2
    exit 1
fi

if [ -d "/opt/course-seeds/${COURSE_ID}/workspace" ]; then
    TEMPLATE_DIR="/opt/course-seeds/${COURSE_ID}/workspace"
fi

echo "[reset] Starting hardened workspace reset for course: ${COURSE_ID}..." >&2

# 2. Quiesce active student background servers (e.g. port 8000 Uvicorn / FastAPI)
pkill -f "uvicorn.*8000" 2>/dev/null || true
pkill -f "python.*8000" 2>/dev/null || true

# 3. Canonical security verification: ensure target is strictly inside /workspace
REAL_WS=$(realpath -m "$WORKSPACE_DIR")
if [[ "$REAL_WS" != "/workspace" && "$REAL_WS" != *"/workspace" ]]; then
    echo "SECURITY ALERT: Refusing to reset outside workspace path: $REAL_WS" >&2
    exit 1
fi

# 4. Safely wipe workspace contents without following symlinks
if [ -d "$WORKSPACE_DIR" ]; then
    # -mindepth 1 prevents deleting /workspace itself. -delete removes symlinks without following.
    find "$WORKSPACE_DIR" -mindepth 1 -delete
else
    mkdir -p "$WORKSPACE_DIR"
fi

# 5. Restore clean starter files from template
if [ -d "$TEMPLATE_DIR" ]; then
    cp -a "$TEMPLATE_DIR/." "$WORKSPACE_DIR/"
fi

# 6. Increment generation counter and restore markers
PREV_GEN=1
if [ -f "$WORKSPACE_DIR/.generation" ]; then
    PREV_GEN=$(cat "$WORKSPACE_DIR/.generation" 2>/dev/null || echo 1)
fi
NEW_GEN=$((PREV_GEN + 1))
echo "$NEW_GEN" > "$WORKSPACE_DIR/.generation"
echo "4.2.0" > "$WORKSPACE_DIR/.course_version"
echo "$COURSE_ID" > "$WORKSPACE_DIR/.course_id"

# 7. Ensure learner UID 1000 permissions
chown -R 1000:1000 "$WORKSPACE_DIR" 2>/dev/null || true

echo "{\"status\":\"ok\",\"courseId\":\"${COURSE_ID}\",\"generation\":${NEW_GEN}}"
