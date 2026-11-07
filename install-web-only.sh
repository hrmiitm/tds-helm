#!/usr/bin/env bash
# install-web-only.sh -- Universal Web-Only Mode Installer for Studio Universal
# Conforms to upgrade.md Section 8.1 & Section 8.3 (Steps W01 to W11). Bash 3.2+ compatible. Zero emojis.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
LIB_DIR="$SCRIPT_DIR/scripts/lib"

if [ ! -f "$LIB_DIR/engine.sh" ]; then
    printf "[ERROR] Required library %s not found.\n" "$LIB_DIR/engine.sh" >&2
    exit 3
fi

# shellcheck source=scripts/lib/engine.sh
. "$LIB_DIR/engine.sh"

# Default flags per W01
OPT_ENGINE="auto"
OPT_CONTEXT=""
OPT_IMAGE_SOURCE="auto"
OPT_OFFLINE=0
OPT_DRY_RUN=0
OPT_JSON=0

OPT_BIND="127.0.0.1"
OPT_PORT="8080"
OPT_PUBLIC_ORIGIN=""
OPT_WORKSPACE_ORIGIN=""
OPT_COURSES_DIR="$SCRIPT_DIR/courses"

usage() {
    cat <<EOF
Usage: install-web-only.sh [OPTIONS]

Installs and launches Studio Universal in Web-Only Mode (Section 8.3).
Does not require host Node, npm, Electron, or Python.

Options:
  --bind <address>                 Bind address (default: 127.0.0.1)
  --port <port>                    Public service port (default: 8080)
  --public-origin <url>            Origin for catalog and control plane
  --workspace-origin <url>         Origin for active workspace iframe
  --courses-dir <path>             Path to course content directories
  --engine <auto|docker|podman>    Container engine to use (default: auto)
  --context <name>                 Docker context or Podman connection name
  --image-source <auto|pull|build> Strategy for resolving hub image (default: auto)
  --offline                        Forbid downloads and remote image builds
  --dry-run                        Perform preflight inventory without mutations
  --json                           Output summary in JSON format
  --help                           Show this help message and exit

Exit Codes:
  0: Success / no-op
  2: Usage / invalid arguments
  3: Missing prerequisite
  4: Engine unavailable / permission denied
  5: Image / build failure
  6: Port / origin / exposure conflict
  8: Readiness timeout or container failure
EOF
}

# Parse options
while [ $# -gt 0 ]; do
    case "$1" in
        --bind)
            shift
            [ $# -gt 0 ] || { engine_log_error "--bind requires an argument."; exit "$EXIT_USAGE"; }
            OPT_BIND="$1"
            ;;
        --port)
            shift
            [ $# -gt 0 ] || { engine_log_error "--port requires an argument."; exit "$EXIT_USAGE"; }
            OPT_PORT="$1"
            ;;
        --public-origin)
            shift
            [ $# -gt 0 ] || { engine_log_error "--public-origin requires an argument."; exit "$EXIT_USAGE"; }
            OPT_PUBLIC_ORIGIN="$1"
            ;;
        --workspace-origin)
            shift
            [ $# -gt 0 ] || { engine_log_error "--workspace-origin requires an argument."; exit "$EXIT_USAGE"; }
            OPT_WORKSPACE_ORIGIN="$1"
            ;;
        --courses-dir)
            shift
            [ $# -gt 0 ] || { engine_log_error "--courses-dir requires an argument."; exit "$EXIT_USAGE"; }
            OPT_COURSES_DIR="$1"
            ;;
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

# Default origins if unspecified
if [ -z "$OPT_PUBLIC_ORIGIN" ]; then
    OPT_PUBLIC_ORIGIN="http://localhost:${OPT_PORT}"
fi
if [ -z "$OPT_WORKSPACE_ORIGIN" ]; then
    OPT_WORKSPACE_ORIGIN="http://127.0.0.1:${OPT_PORT}"
fi

STATE_DIR="$(get_state_dir)"
LOCK_ACQUIRED=0

cleanup_web() {
    if [ "$LOCK_ACQUIRED" -eq 1 ]; then
        release_setup_lock "$STATE_DIR"
    fi
}
trap cleanup_web EXIT INT TERM

if [ "$OPT_DRY_RUN" -eq 0 ]; then
    acquire_setup_lock "$STATE_DIR"
    LOCK_ACQUIRED=1
fi

INSTALLATION_ID="$(get_or_create_installation_id "$STATE_DIR")"

# W02: Engine and course checks without host Node/npm/Python requirements
HOST_ARCH="$(detect_arch)"
case "$HOST_ARCH" in
    amd64|arm64) ;;
    *)
        engine_log_error "Unsupported hardware architecture '$HOST_ARCH'. Studio Universal supports linux/amd64 and linux/arm64."
        exit "$EXIT_PREREQ"
        ;;
esac

probe_engine "$OPT_ENGINE" "$OPT_CONTEXT" "$STATE_DIR"

CTX_ARGS=()
if [ -n "$ENGINE_CONTEXT" ]; then
    if [ "$ENGINE_BIN" = "docker" ]; then
        CTX_ARGS=("--context" "$ENGINE_CONTEXT")
    else
        CTX_ARGS=("--connection" "$ENGINE_CONTEXT")
    fi
fi

validate_resources_hub "$STATE_DIR"

# Validate course directories exist
VALID_COURSES=0
if [ -d "$OPT_COURSES_DIR" ]; then
    for cdir in "$OPT_COURSES_DIR"/*; do
        if [ -d "$cdir" ] && [ -f "$cdir/course.yaml" ]; then
            VALID_COURSES=$(( VALID_COURSES + 1 ))
        fi
    done
fi
if [ "$VALID_COURSES" -eq 0 ]; then
    engine_log_error "No valid courses found in $OPT_COURSES_DIR."
    exit "$EXIT_IMAGE_BUILD"
fi

# W03: Resolve rag-studio-hub:4.2.0 image
EXPECTED_HUB_IMAGE="rag-studio-hub:4.2.0"
HUB_IMAGE_ID=""

LOCAL_HUB="$("$ENGINE_BIN" "${CTX_ARGS[@]}" images -q "$EXPECTED_HUB_IMAGE" 2>/dev/null | head -n 1 || echo "")"
if [ -n "$LOCAL_HUB" ]; then
    HUB_IMAGE_ID="$LOCAL_HUB"
    engine_log_ok "Found existing hub image: $EXPECTED_HUB_IMAGE ($HUB_IMAGE_ID)"
else
    if [ "$OPT_OFFLINE" -eq 1 ]; then
        engine_log_error "Offline mode: Hub image '$EXPECTED_HUB_IMAGE' is not available locally."
        exit "$EXIT_IMAGE_BUILD"
    fi

    if [ "$OPT_DRY_RUN" -eq 1 ]; then
        engine_log_info "Dry run: Hub image '$EXPECTED_HUB_IMAGE' would be built from orchestrator/Dockerfile."
    else
        if [ -f "$SCRIPT_DIR/orchestrator/Dockerfile" ]; then
            engine_log_step "Building hub image '$EXPECTED_HUB_IMAGE'..."
            if ! "$ENGINE_BIN" "${CTX_ARGS[@]}" build -t "$EXPECTED_HUB_IMAGE" -f "$SCRIPT_DIR/orchestrator/Dockerfile" "$SCRIPT_DIR"; then
                engine_log_error "Failed to build hub image '$EXPECTED_HUB_IMAGE'."
                exit "$EXIT_IMAGE_BUILD"
            fi
            HUB_IMAGE_ID="$("$ENGINE_BIN" "${CTX_ARGS[@]}" images -q "$EXPECTED_HUB_IMAGE" | head -n 1)"
        else
            engine_log_error "Hub image '$EXPECTED_HUB_IMAGE' not found and orchestrator/Dockerfile does not exist."
            exit "$EXIT_IMAGE_BUILD"
        fi
    fi
fi

# W04: Resolve engine socket source and permissions
SOCKET_PATH="$(resolve_engine_socket "$ENGINE_BIN")"
if [ -z "$SOCKET_PATH" ] || [ ! -S "$SOCKET_PATH" ]; then
    # Fallback to standard socket path
    if [ -S "/var/run/docker.sock" ]; then
        SOCKET_PATH="/var/run/docker.sock"
    fi
fi

if [ -z "$SOCKET_PATH" ] || [ ! -S "$SOCKET_PATH" ]; then
    engine_log_error "Unable to resolve valid daemon socket. Hub container requires engine socket access."
    exit "$EXIT_ENGINE"
fi

if [ ! -r "$SOCKET_PATH" ]; then
    engine_log_error "Permission denied reading engine socket '$SOCKET_PATH' for user $(id -un)."
    exit "$EXIT_ENGINE"
fi

# W05: Validate origins, port availability, and exposure
IS_LOOPBACK=0
case "$OPT_BIND" in
    127.0.0.1|localhost|::1)
        IS_LOOPBACK=1
        ;;
esac

if [ "$IS_LOOPBACK" -eq 0 ]; then
    # Non-loopback requires TLS and two distinct origins
    if [ "$OPT_PUBLIC_ORIGIN" = "$OPT_WORKSPACE_ORIGIN" ]; then
        engine_log_error "Non-loopback bind requires two distinct origins (--public-origin and --workspace-origin)."
        exit "$EXIT_CONFLICT"
    fi
    case "$OPT_PUBLIC_ORIGIN" in
        https://*) ;;
        *)
            engine_log_error "Non-loopback bind requires explicitly configured TLS ingress (https://)."
            exit "$EXIT_CONFLICT"
            ;;
    esac
fi

# Check port conflict
PORT_OCCUPIED=0
if command -v python3 >/dev/null 2>&1; then
    PORT_OCCUPIED="$(python3 -c "import socket; s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.settimeout(1); res = s.connect_ex(('$OPT_BIND', int('$OPT_PORT'))); s.close(); print(1 if res == 0 else 0)" 2>/dev/null || echo 0)"
fi

if [ "$PORT_OCCUPIED" -eq 1 ]; then
    # Check if existing process is an active Studio hub
    IS_EXISTING_HUB=0
    if curl -fsS "http://${OPT_BIND}:${OPT_PORT}/orchestrator/health/live" >/dev/null 2>&1 || curl -fsS "http://${OPT_BIND}:${OPT_PORT}/health/live" >/dev/null 2>&1; then
        IS_EXISTING_HUB=1
    fi

    if [ "$IS_EXISTING_HUB" -eq 0 ]; then
        engine_log_error "Port $OPT_PORT is currently occupied by an unrelated process on $OPT_BIND."
        exit "$EXIT_CONFLICT"
    fi
fi

# W06: Create/reuse labeled state volume and dedicated network
STATE_VOLUME="rag-orchestrator-state-${INSTALLATION_ID}"
NETWORK_NAME="rag-studio-net"

if [ "$OPT_DRY_RUN" -eq 1 ]; then
    engine_log_info "Dry run: State volume '$STATE_VOLUME' and network '$NETWORK_NAME' would be created/reused."
else
    if ! "$ENGINE_BIN" "${CTX_ARGS[@]}" volume inspect "$STATE_VOLUME" >/dev/null 2>&1; then
        engine_log_step "Creating labeled state volume '$STATE_VOLUME'..."
        "$ENGINE_BIN" "${CTX_ARGS[@]}" volume create \
            --label "io.studio.managed=true" \
            --label "io.studio.installation=$INSTALLATION_ID" \
            --label "io.studio.role=state" \
            "$STATE_VOLUME" >/dev/null
    fi

    if ! "$ENGINE_BIN" "${CTX_ARGS[@]}" network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
        engine_log_step "Creating labeled network '$NETWORK_NAME'..."
        "$ENGINE_BIN" "${CTX_ARGS[@]}" network create \
            --label "io.studio.managed=true" \
            --label "io.studio.installation=$INSTALLATION_ID" \
            --label "io.studio.role=network" \
            "$NETWORK_NAME" >/dev/null
    fi
fi

# W07: Generate/reuse bootstrap secret in restricted state
TOKEN_FILE="$STATE_DIR/bootstrap_token"
BOOTSTRAP_TOKEN=""
if [ -f "$TOKEN_FILE" ]; then
    BOOTSTRAP_TOKEN="$(head -n 1 "$TOKEN_FILE" | tr -d '[:space:]')"
fi

if [ -z "$BOOTSTRAP_TOKEN" ]; then
    if command -v python3 >/dev/null 2>&1; then
        BOOTSTRAP_TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(24))' 2>/dev/null || echo "")"
    fi
    if [ -z "$BOOTSTRAP_TOKEN" ]; then
        BOOTSTRAP_TOKEN="$(od -x -N 24 /dev/urandom 2>/dev/null | head -n 1 | awk '{printf "%s%s%s%s", $2, $3, $4, $5}')"
    fi
    if [ "$OPT_DRY_RUN" -eq 0 ]; then
        mkdir -p "$STATE_DIR"
        printf "%s\n" "$BOOTSTRAP_TOKEN" > "$TOKEN_FILE"
        chmod 600 "$TOKEN_FILE"
    fi
fi

# W08: Inspect existing hub container
HUB_CONTAINER="rag-studio-hub"
REUSE_EXISTING_HUB=0

if "$ENGINE_BIN" "${CTX_ARGS[@]}" ps -f "name=^/${HUB_CONTAINER}$" --format '{{.Status}}' 2>/dev/null | grep -q "Up"; then
    if curl -fsS "http://${OPT_BIND}:${OPT_PORT}/orchestrator/health/live" >/dev/null 2>&1 || curl -fsS "http://${OPT_BIND}:${OPT_PORT}/health/live" >/dev/null 2>&1; then
        REUSE_EXISTING_HUB=1
        engine_log_ok "Existing hub container '$HUB_CONTAINER' is healthy; reusing."
    fi
fi

# W09: Start hub container if not reused
if [ "$OPT_DRY_RUN" -eq 1 ]; then
    engine_log_info "Dry run: Hub container would be started on ${OPT_BIND}:${OPT_PORT} with limits 0.5 CPU / 256 MiB."
else
    if [ "$REUSE_EXISTING_HUB" -eq 0 ]; then
        "$ENGINE_BIN" "${CTX_ARGS[@]}" rm -f "$HUB_CONTAINER" >/dev/null 2>&1 || true

        engine_log_step "Starting orchestrator hub container on ${OPT_BIND}:${OPT_PORT}..."
        "$ENGINE_BIN" "${CTX_ARGS[@]}" run -d \
            --name "$HUB_CONTAINER" \
            --label "io.studio.managed=true" \
            --label "io.studio.installation=$INSTALLATION_ID" \
            --label "io.studio.role=hub" \
            --cpus=0.5 \
            --memory=256m \
            --restart unless-stopped \
            --log-opt max-size=10m \
            --log-opt max-file=3 \
            --network "$NETWORK_NAME" \
            -p "${OPT_BIND}:${OPT_PORT}:8080" \
            -v "${SOCKET_PATH}:/var/run/docker.sock:ro" \
            -v "${STATE_VOLUME}:/data" \
            -v "${OPT_COURSES_DIR}:/opt/studio/courses:ro" \
            -e "STUDIO_INSTALLATION_ID=$INSTALLATION_ID" \
            -e "STUDIO_PUBLIC_ORIGIN=$OPT_PUBLIC_ORIGIN" \
            -e "STUDIO_WORKSPACE_ORIGIN=$OPT_WORKSPACE_ORIGIN" \
            -e "STUDIO_BOOTSTRAP_TOKEN=$BOOTSTRAP_TOKEN" \
            "$EXPECTED_HUB_IMAGE" >/dev/null
    fi

    # W10: Poll readiness endpoint (60s deadline)
    engine_log_step "Waiting for orchestrator readiness probe at http://${OPT_BIND}:${OPT_PORT}..."
    READY=0
    for _ in $(seq 1 30); do
        if curl -fsS "http://${OPT_BIND}:${OPT_PORT}/orchestrator/health/ready" >/dev/null 2>&1 || curl -fsS "http://${OPT_BIND}:${OPT_PORT}/health/ready" >/dev/null 2>&1 || curl -fsS "http://${OPT_BIND}:${OPT_PORT}/health/live" >/dev/null 2>&1; then
            READY=1
            break
        fi
        sleep 2
    done

    if [ "$READY" -eq 0 ]; then
        engine_log_error "Hub container failed to become ready within 60 seconds."
        engine_log_error "Redacted logs from container $HUB_CONTAINER:"
        "$ENGINE_BIN" "${CTX_ARGS[@]}" logs --tail 50 "$HUB_CONTAINER" 2>&1 | sed 's/token=[^ &]*/token=[REDACTED]/g' >&2 || true
        exit "$EXIT_PARTIAL"
    fi
    engine_log_ok "Orchestrator hub probe reported ready."
fi

# W11: Output summary and report
CATALOG_URL="${OPT_PUBLIC_ORIGIN}/"
if [ "$OPT_JSON" -eq 1 ]; then
    if command -v python3 >/dev/null 2>&1; then
        python3 -c "
import json
print(json.dumps({
    'status': 'success',
    'mode': 'web-only',
    'dryRun': bool($OPT_DRY_RUN),
    'catalogUrl': '$CATALOG_URL',
    'publicOrigin': '$OPT_PUBLIC_ORIGIN',
    'workspaceOrigin': '$OPT_WORKSPACE_ORIGIN',
    'engine': '$ENGINE_BIN',
    'context': '$ENGINE_CONTEXT',
    'installationId': '$INSTALLATION_ID',
    'image': '$EXPECTED_HUB_IMAGE',
    'port': '$OPT_PORT',
    'bind': '$OPT_BIND',
    'stateVolume': '$STATE_VOLUME',
    'courses': $VALID_COURSES
}, indent=2))
"
    else
        printf '{"status": "success", "mode": "web-only", "url": "%s"}\n' "$CATALOG_URL"
    fi
else
    printf "\n========================================================\n"
    printf " Studio Universal -- Web-Only Hub Ready\n"
    printf " Status:            %s\n" "$([ "$OPT_DRY_RUN" -eq 1 ] && echo "DRY RUN COMPLETE" || echo "ACTIVE")"
    printf " Mode:              Web Gateway & Hub\n"
    printf " Catalog URL:       %s\n" "$CATALOG_URL"
    printf " Public Origin:     %s\n" "$OPT_PUBLIC_ORIGIN"
    printf " Workspace Origin:  %s\n" "$OPT_WORKSPACE_ORIGIN"
    printf " Engine:            %s\n" "$ENGINE_BIN"
    printf " State Volume:      %s\n" "$STATE_VOLUME"
    printf " Running Chapters:  0 (clean catalog start)\n"
    printf " Stop Command:      %s stop %s\n" "$ENGINE_BIN" "$HUB_CONTAINER"
    printf " Restart Command:   %s restart %s\n" "$ENGINE_BIN" "$HUB_CONTAINER"
    printf "========================================================\n\n"
    engine_log_ok "Web-only hub installation complete."
fi

exit "$EXIT_SUCCESS"
