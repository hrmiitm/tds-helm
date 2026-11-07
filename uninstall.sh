#!/usr/bin/env bash
# ==============================================================================
# uninstall.sh — Universal Clean Uninstaller Shortcut for Studio Universal
# Safely stops containers, removes volumes, and cleans up host shortcuts
# ==============================================================================
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec "$SCRIPT_DIR/clean-uninstall.sh" "$@"
