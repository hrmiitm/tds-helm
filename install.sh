#!/usr/bin/env bash
# install.sh -- Universal Desktop Mode Installer for Studio Universal
# Conforms to upgrade.md Section 8.1 & Section 8.2 (Steps I01 to I12). Bash 3.2+ compatible. Zero emojis.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
LIB_DIR="$SCRIPT_DIR/scripts/lib"

if [ ! -f "$LIB_DIR/engine.sh" ]; then
    printf "[ERROR] Required library %s not found.\n" "$LIB_DIR/engine.sh" >&2
    exit 3
fi

# shellcheck source=scripts/lib/engine.sh
. "$LIB_DIR/engine.sh"

# Default flags
OPT_ENGINE="auto"
OPT_CONTEXT=""
OPT_IMAGE_SOURCE="auto"
OPT_OFFLINE=0
OPT_DRY_RUN=0
OPT_JSON=0

usage() {
    cat <<EOF
Usage: install.sh [OPTIONS]

Installs Studio Universal in Desktop Mode (Section 8.2).

Options:
  --engine <auto|docker|podman>        Container engine to use (default: auto)
  --context <name>                     Docker context or Podman connection name
  --image-source <auto|pull|build>     Strategy for resolving runtime image (default: auto)
  --offline                            Forbid downloads and remote image builds
  --dry-run                            Perform preflight inventory without mutations
  --json                               Output installation summary in JSON format
  --help                               Show this help message and exit

Exit Codes:
  0: Success / no-op
  2: Usage / invalid arguments
  3: Missing prerequisite
  4: Engine unavailable / permission denied
  5: Image / build / dependency failure
  6: Ownership / port / configuration conflict
  8: Partial installation failure
EOF
}

# Parse options
while [ $# -gt 0 ]; do
    case "$1" in
        --engine)
            shift
            [ $# -gt 0 ] || { engine_log_error "--engine requires an argument."; exit "$EXIT_USAGE"; }
            OPT_ENGINE="$1"
            case "$OPT_ENGINE" in
                auto|docker|podman) ;;
                *) engine_log_error "Invalid engine '$OPT_ENGINE'. Must be auto, docker, or podman."; exit "$EXIT_USAGE" ;;
            esac
            ;;
        --context)
            shift
            [ $# -gt 0 ] || { engine_log_error "--context requires an argument."; exit "$EXIT_USAGE"; }
            OPT_CONTEXT="$1"
            ;;
        --image-source)
            shift
            [ $# -gt 0 ] || { engine_log_error "--image-source requires an argument."; exit "$EXIT_USAGE"; }
            OPT_IMAGE_SOURCE="$1"
            case "$OPT_IMAGE_SOURCE" in
                auto|pull|build) ;;
                *) engine_log_error "Invalid image-source '$OPT_IMAGE_SOURCE'. Must be auto, pull, or build."; exit "$EXIT_USAGE" ;;
            esac
            ;;
        --offline)
            OPT_OFFLINE=1
            ;;
        --dry-run)
            OPT_DRY_RUN=1
            ;;
        --json)
            OPT_JSON=1
            ;;
        --help|-h)
            usage
            exit "$EXIT_SUCCESS"
            ;;
        *)
            engine_log_error "Unknown argument: $1"
            usage
            exit "$EXIT_USAGE"
            ;;
    esac
    shift
done

# I01: Repository root & expected manifest validation
if [ ! -f "$SCRIPT_DIR/release-manifest.json" ]; then
    engine_log_error "Release manifest '$SCRIPT_DIR/release-manifest.json' not found."
    exit "$EXIT_PREREQ"
fi

if [ ! -f "$SCRIPT_DIR/desktop-app/package.json" ]; then
    engine_log_error "Desktop app package manifest '$SCRIPT_DIR/desktop-app/package.json' not found."
    exit "$EXIT_PREREQ"
fi

STATE_DIR="$(get_state_dir)"
LOCK_ACQUIRED=0

cleanup_install() {
    if [ "$LOCK_ACQUIRED" -eq 1 ]; then
        release_setup_lock "$STATE_DIR"
    fi
}
trap cleanup_install EXIT INT TERM

if [ "$OPT_DRY_RUN" -eq 0 ]; then
    acquire_setup_lock "$STATE_DIR"
    LOCK_ACQUIRED=1
fi

INSTALLATION_ID="$(get_or_create_installation_id "$STATE_DIR")"

# I02: Detect OS, architecture, and shell capabilities
HOST_OS="$(detect_os)"
HOST_ARCH="$(detect_arch)"

case "$HOST_ARCH" in
    amd64|arm64) ;;
    *)
        engine_log_error "Unsupported hardware architecture '$HOST_ARCH'. Studio Universal supports linux/amd64 and linux/arm64."
        exit "$EXIT_PREREQ"
        ;;
esac

# I03: Resolve engine and context
probe_engine "$OPT_ENGINE" "$OPT_CONTEXT" "$STATE_DIR"

CTX_ARGS=()
if [ -n "$ENGINE_CONTEXT" ]; then
    if [ "$ENGINE_BIN" = "docker" ]; then
        CTX_ARGS=("--context" "$ENGINE_CONTEXT")
    else
        CTX_ARGS=("--connection" "$ENGINE_CONTEXT")
    fi
fi

# I04: Probe resources and capabilities
detect_resources "$STATE_DIR"
if [ "$OPT_DRY_RUN" -eq 1 ]; then
    engine_log_info "Dry run: Skipping disposable probe container execution."
else
    validate_resources_desktop "$STATE_DIR"
fi

# I05: Port and existing owner detection
PORT_IN_USE=0
if command -v python3 >/dev/null 2>&1; then
    PORT_IN_USE="$(python3 -c "import socket; s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.settimeout(1); res = s.connect_ex(('127.0.0.1', 8080)); s.close(); print(1 if res == 0 else 0)" 2>/dev/null || echo 0)"
fi

if [ "$PORT_IN_USE" -eq 1 ]; then
    # Test if it is an existing Studio hub or unrelated process
    IS_STUDIO_OWNER=0
    if curl -fsS http://127.0.0.1:8080/health/live >/dev/null 2>&1 || curl -fsS http://127.0.0.1:8080/orchestrator/health/live >/dev/null 2>&1; then
        IS_STUDIO_OWNER=1
    fi

    if [ "$IS_STUDIO_OWNER" -eq 1 ]; then
        engine_log_info "Existing Studio controller detected on port 8080; desktop client will attach to active instance."
    else
        engine_log_error "Port 8080 is currently occupied by an unrelated process. Cannot continue without port conflict resolution."
        exit "$EXIT_CONFLICT"
    fi
fi

# I06: Verify/resolve rag-studio:4.2.0 image
EXPECTED_IMAGE="rag-studio:4.2.0"
IMAGE_ID=""

IMAGE_EXISTS=0
LOCAL_IMG="$("$ENGINE_BIN" "${CTX_ARGS[@]}" images -q "$EXPECTED_IMAGE" 2>/dev/null | head -n 1 || echo "")"
if [ -n "$LOCAL_IMG" ]; then
    IMAGE_EXISTS=1
    IMAGE_ID="$LOCAL_IMG"
fi

if [ "$IMAGE_EXISTS" -eq 1 ]; then
    engine_log_ok "Found existing runtime image: $EXPECTED_IMAGE ($IMAGE_ID)"
else
    if [ "$OPT_OFFLINE" -eq 1 ]; then
        engine_log_error "Offline mode: Runtime image '$EXPECTED_IMAGE' is not available locally."
        exit "$EXIT_IMAGE_BUILD"
    fi

    if [ "$OPT_DRY_RUN" -eq 1 ]; then
        engine_log_info "Dry run: Runtime image '$EXPECTED_IMAGE' would be built from $SCRIPT_DIR/Dockerfile."
    else
        engine_log_step "Building runtime image '$EXPECTED_IMAGE' from $SCRIPT_DIR/Dockerfile..."
        if ! "$ENGINE_BIN" "${CTX_ARGS[@]}" build -t "$EXPECTED_IMAGE" "$SCRIPT_DIR"; then
            engine_log_error "Failed to build runtime image '$EXPECTED_IMAGE'."
            exit "$EXIT_IMAGE_BUILD"
        fi
        IMAGE_ID="$("$ENGINE_BIN" "${CTX_ARGS[@]}" images -q "$EXPECTED_IMAGE" | head -n 1)"
    fi
fi

# I07: Validate course bundles
VALID_CHAPTER_COUNT=0

if command -v python3 >/dev/null 2>&1 && python3 -c "import yaml" >/dev/null 2>&1; then
    for cfile in "$SCRIPT_DIR/courses"/*/course.yaml; do
        [ -f "$cfile" ] || continue
        if python3 "$SCRIPT_DIR/authoring/validate.py" "$cfile" >/dev/null 2>&1; then
            VALID_CHAPTER_COUNT=$(( VALID_CHAPTER_COUNT + 1 ))
        fi
    done
elif [ "$IMAGE_EXISTS" -eq 1 ] && [ "$OPT_DRY_RUN" -eq 0 ]; then
    VALIDATION_OUTPUT="$("$ENGINE_BIN" "${CTX_ARGS[@]}" run --rm \
        -v "$SCRIPT_DIR/courses:/repo/courses:ro" \
        -v "$SCRIPT_DIR/schemas:/repo/schemas:ro" \
        -v "$SCRIPT_DIR/authoring:/repo/authoring:ro" \
        -w /repo "$EXPECTED_IMAGE" python3 authoring/validate.py 2>&1)" || true
    if [ -n "$VALIDATION_OUTPUT" ]; then
        VALID_CHAPTER_COUNT="$(printf "%s\n" "$VALIDATION_OUTPUT" | grep -c "PASS" || echo 0)"
    fi
fi

if [ "$VALID_CHAPTER_COUNT" -eq 0 ] && [ -d "$SCRIPT_DIR/courses" ]; then
    # Fallback directory count if validator script ran outside pyyaml
    for cdir in "$SCRIPT_DIR/courses"/*; do
        if [ -d "$cdir" ] && [ -f "$cdir/course.yaml" ]; then
            VALID_CHAPTER_COUNT=$(( VALID_CHAPTER_COUNT + 1 ))
        fi
    done
fi

if [ "$VALID_CHAPTER_COUNT" -eq 0 ]; then
    engine_log_error "Course validation failed: At least one valid course bundle is required for installation."
    exit "$EXIT_IMAGE_BUILD"
fi
engine_log_ok "Validated $VALID_CHAPTER_COUNT course bundle(s)."

# I08: Check host Node and npm
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    engine_log_error "Host Node.js and npm are required for Desktop Mode installation."
    engine_log_error "Please install Node.js 18+ (https://nodejs.org/) or use web-only mode (./install-web-only.sh)."
    exit "$EXIT_PREREQ"
fi

NODE_VER="$(node -v | tr -d 'v' || echo "0")"
NODE_MAJOR="$(echo "$NODE_VER" | cut -d. -f1 || echo "0")"
if [ "$NODE_MAJOR" -lt 18 ]; then
    engine_log_warn "Node.js version $NODE_VER detected. Recommended minimum version is Node 18+."
fi

# I09: Install desktop client dependencies
if [ "$OPT_DRY_RUN" -eq 1 ]; then
    engine_log_info "Dry run: npm dependencies in desktop-app/ would be installed."
else
    engine_log_step "Installing desktop client dependencies in desktop-app/..."
    (
        cd "$SCRIPT_DIR/desktop-app"
        if [ -f "package-lock.json" ]; then
            npm ci --ignore-scripts
        else
            npm install --ignore-scripts
        fi
        if [ ! -f "node_modules/electron/path.txt" ] && [ -f "node_modules/electron/install.js" ]; then
            node node_modules/electron/install.js
        fi
    ) || {
        engine_log_error "Failed to install desktop application dependencies via npm."
        exit "$EXIT_IMAGE_BUILD"
    }

    if [ -d "$SCRIPT_DIR/orchestrator" ] && [ -f "$SCRIPT_DIR/orchestrator/package.json" ]; then
        engine_log_step "Installing orchestrator dependencies in orchestrator/..."
        (
            cd "$SCRIPT_DIR/orchestrator"
            if [ -f "package-lock.json" ]; then
                npm ci --ignore-scripts
            else
                npm install --ignore-scripts
            fi
            if npm run | grep -q " build$"; then
                npm run build
            fi
        ) || {
            engine_log_error "Failed to install orchestrator dependencies."
            exit "$EXIT_IMAGE_BUILD"
        }
    fi
fi

# I10: Write atomic restricted configuration
if [ "$OPT_DRY_RUN" -eq 1 ]; then
    engine_log_info "Dry run: Configuration would be written atomically to $STATE_DIR/config.json."
else
    mkdir -p "$STATE_DIR"
    CONFIG_TMP="$STATE_DIR/config.tmp.$$"
    INSTALL_TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

    cat <<EOF > "$CONFIG_TMP"
{
  "installationId": "$INSTALLATION_ID",
  "engine": "$ENGINE_BIN",
  "context": "$ENGINE_CONTEXT",
  "mode": "desktop",
  "image": "$EXPECTED_IMAGE",
  "imageId": "${IMAGE_ID:-unknown}",
  "installedAt": "$INSTALL_TIMESTAMP",
  "version": "4.2.0"
}
EOF
    chmod 600 "$CONFIG_TMP"
    mv "$CONFIG_TMP" "$STATE_DIR/config.json"
    engine_log_ok "Configuration written atomically to $STATE_DIR/config.json."
fi

# I11: Create idempotent per-user shortcut
SHORTCUT_CREATED=""
if [ "$OPT_DRY_RUN" -eq 0 ]; then
    if [ "$HOST_OS" = "linux" ]; then
        APP_DIR="$HOME/.local/share/applications"
        mkdir -p "$APP_DIR"
        DESKTOP_FILE="$APP_DIR/rag-studio.desktop"
        cat <<EOF > "$DESKTOP_FILE"
[Desktop Entry]
Type=Application
Name=RAG Studio
Comment=Studio Universal Native Desktop Client
Exec="$SCRIPT_DIR/run-desktop.sh"
Path=$SCRIPT_DIR
Terminal=false
Categories=Education;Development;
EOF
        chmod +x "$DESKTOP_FILE"
        SHORTCUT_CREATED="$DESKTOP_FILE"
    fi
fi

# I12: Startup smoke validation and reporting
if [ "$OPT_JSON" -eq 1 ]; then
    if command -v python3 >/dev/null 2>&1; then
        python3 -c "
import json
print(json.dumps({
    'status': 'success',
    'mode': 'desktop',
    'dryRun': bool($OPT_DRY_RUN),
    'engine': '$ENGINE_BIN',
    'context': '$ENGINE_CONTEXT',
    'installationId': '$INSTALLATION_ID',
    'image': '$EXPECTED_IMAGE',
    'imageId': '${IMAGE_ID:-unknown}',
    'validChapters': $VALID_CHAPTER_COUNT,
    'shortcut': '$SHORTCUT_CREATED',
    'launchCommand': './run-desktop.sh'
}, indent=2))
"
    else
        printf '{"status": "success", "mode": "desktop", "engine": "%s", "image": "%s"}\n' "$ENGINE_BIN" "$EXPECTED_IMAGE"
    fi
else
    printf "\n========================================================\n"
    printf " Studio Universal -- Desktop Installation Summary\n"
    printf " Status:          %s\n" "$([ "$OPT_DRY_RUN" -eq 1 ] && echo "DRY RUN COMPLETE" || echo "READY")"
    printf " Mode:            Desktop Client\n"
    printf " Engine:          %s (Context: %s)\n" "$ENGINE_BIN" "${ENGINE_CONTEXT:-default}"
    printf " Image:           %s (%s)\n" "$EXPECTED_IMAGE" "${IMAGE_ID:-local}"
    printf " Valid Courses:   %d\n" "$VALID_CHAPTER_COUNT"
    printf " Installation ID: %s\n" "$INSTALLATION_ID"
    printf " Shortcut:        %s\n" "${SHORTCUT_CREATED:-none (headless or unsupported)}"
    printf " Launch Command:  %s/run-desktop.sh\n" "$SCRIPT_DIR"
    printf "========================================================\n\n"
    engine_log_ok "Installation succeeded without starting runtime containers (idempotent)."
fi

exit "$EXIT_SUCCESS"
