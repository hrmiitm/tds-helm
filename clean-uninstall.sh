#!/usr/bin/env bash
# clean-uninstall.sh -- Universal Clean Uninstallation Script for Studio Universal
# Conforms to upgrade.md Section 8.1 & Section 8.4. Bash 3.2+ compatible. Zero emojis.
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
OPT_PURGE_IMAGES=0
OPT_YES=0
OPT_INCLUDE_LEGACY=0
OPT_ALL_INSTALLATIONS=0
OPT_DRY_RUN=0
OPT_JSON=0

usage() {
    cat <<EOF
Usage: clean-uninstall.sh [OPTIONS]

Safely uninstalls Studio Universal containers, volumes, dependencies, and shortcuts.

Options:
  --engine <auto|docker|podman>  Container engine to use (default: auto)
  --context <name>               Docker context or Podman connection name
  --purge-images                 Also remove rag-studio:* and rag-studio-hub:* images
  --yes                          Non-interactive confirmation for targeted deletion
  --include-legacy               Include unlabeled legacy containers and volumes
  --all-installations            Target all Studio Universal installations on engine
  --dry-run                      Print inventory of targets without modifying anything
  --json                         Output inventory and report in JSON format
  --help                         Show this help message and exit

Exit Codes:
  0: Success / no-op
  2: Usage / invalid arguments
  3: Missing prerequisite
  4: Engine unavailable / permission denied
  6: Ownership / setup lock conflict
  7: User cancellation
  8: Partial cleanup failure
EOF
}

# Parse command line options
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
        --purge-images)
            OPT_PURGE_IMAGES=1
            ;;
        --yes)
            OPT_YES=1
            ;;
        --include-legacy)
            OPT_INCLUDE_LEGACY=1
            ;;
        --all-installations)
            OPT_ALL_INSTALLATIONS=1
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

STATE_DIR="$(get_state_dir)"
LOCK_ACQUIRED=0

cleanup_lock() {
    if [ "$LOCK_ACQUIRED" -eq 1 ]; then
        release_setup_lock "$STATE_DIR"
    fi
}
trap cleanup_lock EXIT INT TERM

# U01: Resolve installation config and acquire setup lock
if [ "$OPT_DRY_RUN" -eq 0 ]; then
    acquire_setup_lock "$STATE_DIR"
    LOCK_ACQUIRED=1
fi

INSTALLATION_ID=""
if [ -f "$STATE_DIR/installation_id" ]; then
    INSTALLATION_ID="$(head -n 1 "$STATE_DIR/installation_id" | tr -d '[:space:]')"
fi

# Engine discovery
probe_engine "$OPT_ENGINE" "$OPT_CONTEXT" "$STATE_DIR"

CTX_ARGS=()
if [ -n "$ENGINE_CONTEXT" ]; then
    if [ "$ENGINE_BIN" = "docker" ]; then
        CTX_ARGS=("--context" "$ENGINE_CONTEXT")
    else
        CTX_ARGS=("--connection" "$ENGINE_CONTEXT")
    fi
fi

# U02 & U03: Inventory candidates and verify ownership
TARGET_CONTAINERS=()
TARGET_CONTAINER_NAMES=()
SKIPPED_CONTAINERS=()

TARGET_VOLUMES=()
SKIPPED_VOLUMES=()

TARGET_NETWORKS=()
TARGET_IMAGES=()
PRESERVED_IMAGES=()

TARGET_PATHS=()

# 1. Containers
C_RAW_FILE="$(mktemp 2>/dev/null || echo "/tmp/studio_c_$$.tmp")"
"$ENGINE_BIN" "${CTX_ARGS[@]}" ps -a --format '{{.ID}}	{{.Names}}	{{.Label "io.studio.managed"}}	{{.Label "io.studio.installation"}}	{{.Label "io.studio.role"}}' >"$C_RAW_FILE" 2>/dev/null || true

while IFS='	' read -r c_id c_name c_managed c_inst c_role; do
    [ -n "$c_id" ] || continue
    is_target=0
    is_legacy=0

    if [ "$c_managed" = "true" ]; then
        if [ "$OPT_ALL_INSTALLATIONS" -eq 1 ] || [ -z "$INSTALLATION_ID" ] || [ "$c_inst" = "$INSTALLATION_ID" ]; then
            is_target=1
        else
            SKIPPED_CONTAINERS+=("$c_name (belongs to installation $c_inst)")
        fi
    else
        case "$c_name" in
            rag-studio*|studio-*)
                is_legacy=1
                ;;
        esac
        if [ "$is_legacy" -eq 1 ]; then
            if [ "$OPT_INCLUDE_LEGACY" -eq 1 ]; then
                is_target=1
            else
                SKIPPED_CONTAINERS+=("$c_name (unlabeled legacy container; requires --include-legacy)")
            fi
        fi
    fi

    if [ "$is_target" -eq 1 ]; then
        TARGET_CONTAINERS+=("$c_id")
        TARGET_CONTAINER_NAMES+=("$c_name")
    fi
done < "$C_RAW_FILE"
rm -f "$C_RAW_FILE"

# 2. Volumes
V_RAW_FILE="$(mktemp 2>/dev/null || echo "/tmp/studio_v_$$.tmp")"
"$ENGINE_BIN" "${CTX_ARGS[@]}" volume ls --format '{{.Name}}	{{.Label "io.studio.managed"}}	{{.Label "io.studio.installation"}}	{{.Label "io.studio.role"}}' >"$V_RAW_FILE" 2>/dev/null || true

while IFS='	' read -r v_name v_managed v_inst v_role; do
    [ -n "$v_name" ] || continue
    is_target=0
    is_legacy=0

    if [ "$v_managed" = "true" ]; then
        if [ "$OPT_ALL_INSTALLATIONS" -eq 1 ] || [ -z "$INSTALLATION_ID" ] || [ "$v_inst" = "$INSTALLATION_ID" ]; then
            is_target=1
        else
            SKIPPED_VOLUMES+=("$v_name (belongs to installation $v_inst)")
        fi
    else
        case "$v_name" in
            rag-studio-*|rag-workspace-*|rag-user-*|rag-orchestrator-state-*)
                is_legacy=1
                ;;
        esac
        if [ "$is_legacy" -eq 1 ]; then
            if [ "$OPT_INCLUDE_LEGACY" -eq 1 ]; then
                is_target=1
            else
                SKIPPED_VOLUMES+=("$v_name (unlabeled legacy volume; requires --include-legacy)")
            fi
        fi
    fi

    if [ "$is_target" -eq 1 ]; then
        TARGET_VOLUMES+=("$v_name")
    fi
done < "$V_RAW_FILE"
rm -f "$V_RAW_FILE"

# 3. Networks
N_RAW_FILE="$(mktemp 2>/dev/null || echo "/tmp/studio_n_$$.tmp")"
"$ENGINE_BIN" "${CTX_ARGS[@]}" network ls --format '{{.ID}}	{{.Name}}	{{.Label "io.studio.managed"}}	{{.Label "io.studio.installation"}}' >"$N_RAW_FILE" 2>/dev/null || true

while IFS='	' read -r n_id n_name n_managed n_inst; do
    [ -n "$n_id" ] || continue
    if [ "$n_managed" = "true" ]; then
        if [ "$OPT_ALL_INSTALLATIONS" -eq 1 ] || [ -z "$INSTALLATION_ID" ] || [ "$n_inst" = "$INSTALLATION_ID" ]; then
            TARGET_NETWORKS+=("$n_id")
        fi
    elif [ "$OPT_INCLUDE_LEGACY" -eq 1 ] && [ "$n_name" = "rag-studio-net" ]; then
        TARGET_NETWORKS+=("$n_id")
    fi
done < "$N_RAW_FILE"
rm -f "$N_RAW_FILE"

# 4. Images
I_RAW_FILE="$(mktemp 2>/dev/null || echo "/tmp/studio_i_$$.tmp")"
"$ENGINE_BIN" "${CTX_ARGS[@]}" images --format '{{.ID}}	{{.Repository}}:{{.Tag}}' >"$I_RAW_FILE" 2>/dev/null || true

while IFS='	' read -r img_id img_tag; do
    [ -n "$img_id" ] || continue
    case "$img_tag" in
        rag-studio:*|rag-studio-hub:*)
            if [ "$OPT_PURGE_IMAGES" -eq 1 ]; then
                TARGET_IMAGES+=("$img_tag")
            else
                PRESERVED_IMAGES+=("$img_tag")
            fi
            ;;
    esac
done < "$I_RAW_FILE"
rm -f "$I_RAW_FILE"

# 5. Local shortcuts and directories
DESKTOP_ENTRY="$HOME/.local/share/applications/rag-studio.desktop"
if [ -f "$DESKTOP_ENTRY" ]; then
    TARGET_PATHS+=("$DESKTOP_ENTRY")
fi

if [ -d "$SCRIPT_DIR/desktop-app/node_modules" ]; then
    TARGET_PATHS+=("$SCRIPT_DIR/desktop-app/node_modules")
fi

if [ -d "$SCRIPT_DIR/desktop-app/dist" ]; then
    TARGET_PATHS+=("$SCRIPT_DIR/desktop-app/dist")
fi

if [ -d "$SCRIPT_DIR/orchestrator/node_modules" ]; then
    TARGET_PATHS+=("$SCRIPT_DIR/orchestrator/node_modules")
fi

if [ -d "$STATE_DIR" ]; then
    TARGET_PATHS+=("$STATE_DIR")
fi

# Print dry-run inventory or formatted JSON
if [ "$OPT_JSON" -eq 1 ]; then
    if command -v python3 >/dev/null 2>&1; then
        python3 -c "
import json
print(json.dumps({
    'dryRun': bool($OPT_DRY_RUN),
    'engine': '$ENGINE_BIN',
    'installationId': '$INSTALLATION_ID',
    'targetContainers': $(printf '%s\n' "${TARGET_CONTAINER_NAMES[@]:-}" | python3 -c 'import sys, json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))'),
    'skippedContainers': $(printf '%s\n' "${SKIPPED_CONTAINERS[@]:-}" | python3 -c 'import sys, json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))'),
    'targetVolumes': $(printf '%s\n' "${TARGET_VOLUMES[@]:-}" | python3 -c 'import sys, json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))'),
    'skippedVolumes': $(printf '%s\n' "${SKIPPED_VOLUMES[@]:-}" | python3 -c 'import sys, json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))'),
    'targetNetworks': $(printf '%s\n' "${TARGET_NETWORKS[@]:-}" | python3 -c 'import sys, json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))'),
    'targetImages': $(printf '%s\n' "${TARGET_IMAGES[@]:-}" | python3 -c 'import sys, json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))'),
    'preservedImages': $(printf '%s\n' "${PRESERVED_IMAGES[@]:-}" | python3 -c 'import sys, json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))'),
    'targetPaths': $(printf '%s\n' "${TARGET_PATHS[@]:-}" | python3 -c 'import sys, json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')
}, indent=2))
"
    else
        printf '{"dryRun": %s, "engine": "%s", "targetContainers": %d, "targetVolumes": %d}\n' \
            "$OPT_DRY_RUN" "$ENGINE_BIN" "${#TARGET_CONTAINERS[@]}" "${#TARGET_VOLUMES[@]}"
    fi

    if [ "$OPT_DRY_RUN" -eq 1 ]; then
        exit "$EXIT_SUCCESS"
    fi
fi

if [ "$OPT_JSON" -eq 0 ]; then
    printf "========================================================\n"
    printf " Studio Universal -- Clean Uninstallation Inventory\n"
    printf " Engine:          %s\n" "$ENGINE_BIN"
    printf " Installation ID: %s\n" "${INSTALLATION_ID:-[none / unmanaged]}"
    printf " Mode:            %s\n" "$([ "$OPT_DRY_RUN" -eq 1 ] && echo "DRY RUN (read-only)" || echo "EXECUTION")"
    printf "========================================================\n\n"

    printf "[INVENTORY] Managed & Targeted Containers (%d):\n" "${#TARGET_CONTAINERS[@]}"
    if [ "${#TARGET_CONTAINER_NAMES[@]}" -eq 0 ]; then
        printf "  (none)\n"
    else
        for cn in "${TARGET_CONTAINER_NAMES[@]}"; do
            printf "  - %s\n" "$cn"
        done
    fi

    if [ "${#SKIPPED_CONTAINERS[@]}" -gt 0 ]; then
        printf "\n[INVENTORY] Skipped Containers (%d):\n" "${#SKIPPED_CONTAINERS[@]}"
        for sc in "${SKIPPED_CONTAINERS[@]}"; do
            printf "  * %s\n" "$sc"
        done
    fi

    printf "\n[INVENTORY] Managed & Targeted Volumes (%d):\n" "${#TARGET_VOLUMES[@]}"
    if [ "${#TARGET_VOLUMES[@]}" -eq 0 ]; then
        printf "  (none)\n"
    else
        for vn in "${TARGET_VOLUMES[@]}"; do
            printf "  - %s\n" "$vn"
        done
    fi

    if [ "${#SKIPPED_VOLUMES[@]}" -gt 0 ]; then
        printf "\n[INVENTORY] Skipped Volumes (%d):\n" "${#SKIPPED_VOLUMES[@]}"
        for sv in "${SKIPPED_VOLUMES[@]}"; do
            printf "  * %s\n" "$sv"
        done
    fi

    printf "\n[INVENTORY] Targeted Networks (%d):\n" "${#TARGET_NETWORKS[@]}"
    if [ "${#TARGET_NETWORKS[@]}" -eq 0 ]; then
        printf "  (none)\n"
    else
        for nn in "${TARGET_NETWORKS[@]}"; do
            printf "  - %s\n" "$nn"
        done
    fi

    printf "\n[INVENTORY] Images to Purge (--purge-images) (%d):\n" "${#TARGET_IMAGES[@]}"
    if [ "${#TARGET_IMAGES[@]}" -eq 0 ]; then
        printf "  (none)\n"
    else
        for iname in "${TARGET_IMAGES[@]}"; do
            printf "  - %s\n" "$iname"
        done
    fi

    if [ "${#PRESERVED_IMAGES[@]}" -gt 0 ]; then
        printf "\n[INVENTORY] Preserved Images (%d):\n" "${#PRESERVED_IMAGES[@]}"
        for pname in "${PRESERVED_IMAGES[@]}"; do
            printf "  * %s\n" "$pname"
        done
    fi

    printf "\n[INVENTORY] Targeted File System Artifacts (%d):\n" "${#TARGET_PATHS[@]}"
    if [ "${#TARGET_PATHS[@]}" -eq 0 ]; then
        printf "  (none)\n"
    else
        for pn in "${TARGET_PATHS[@]}"; do
            printf "  - %s\n" "$pn"
        done
    fi
    printf "\n"
fi

if [ "$OPT_DRY_RUN" -eq 1 ]; then
    engine_log_info "Dry run complete. No modifications were made."
    exit "$EXIT_SUCCESS"
fi

# U04: Confirmation check
if [ "$OPT_YES" -eq 0 ]; then
    if [ ! -t 0 ]; then
        engine_log_error "Non-interactive execution requires explicit --yes flag."
        exit "$EXIT_CANCEL"
    fi

    printf "WARNING: The items listed above will be PERMANENTLY DELETED.\n"
    printf "To confirm uninstallation, type 'DELETE STUDIO': "
    read -r user_confirmation
    if [ "$user_confirmation" != "DELETE STUDIO" ]; then
        engine_log_info "Uninstallation cancelled by user."
        exit "$EXIT_CANCEL"
    fi
fi

# U05: Quiesce and stop containers
PARTIAL_FAILURE=0

if [ "${#TARGET_CONTAINERS[@]}" -gt 0 ]; then
    engine_log_step "Stopping ${#TARGET_CONTAINERS[@]} container(s)..."
    for cid in "${TARGET_CONTAINERS[@]}"; do
        if ! "$ENGINE_BIN" "${CTX_ARGS[@]}" stop -t 15 "$cid" >/dev/null 2>&1; then
            engine_log_warn "Failed to stop container $cid gracefully; attempting kill..."
            "$ENGINE_BIN" "${CTX_ARGS[@]}" kill "$cid" >/dev/null 2>&1 || true
        fi
    done
fi

# U06: Remove containers
if [ "${#TARGET_CONTAINERS[@]}" -gt 0 ]; then
    engine_log_step "Removing ${#TARGET_CONTAINERS[@]} container(s)..."
    for cid in "${TARGET_CONTAINERS[@]}"; do
        if ! "$ENGINE_BIN" "${CTX_ARGS[@]}" rm -f "$cid" >/dev/null 2>&1; then
            engine_log_error "Failed to remove container $cid."
            PARTIAL_FAILURE=1
        fi
    done
fi

# U07: Remove volumes and networks
if [ "${#TARGET_VOLUMES[@]}" -gt 0 ]; then
    engine_log_step "Removing ${#TARGET_VOLUMES[@]} volume(s)..."
    for vid in "${TARGET_VOLUMES[@]}"; do
        if ! "$ENGINE_BIN" "${CTX_ARGS[@]}" volume rm "$vid" >/dev/null 2>&1; then
            engine_log_error "Failed to remove volume $vid (may still be referenced)."
            PARTIAL_FAILURE=1
        fi
    done
fi

if [ "${#TARGET_NETWORKS[@]}" -gt 0 ]; then
    engine_log_step "Removing ${#TARGET_NETWORKS[@]} network(s)..."
    for nid in "${TARGET_NETWORKS[@]}"; do
        "$ENGINE_BIN" "${CTX_ARGS[@]}" network rm "$nid" >/dev/null 2>&1 || true
    done
fi

# U08: Remove installed per-user shortcuts and directories
for p in "${TARGET_PATHS[@]}"; do
    # Never delete repo root or dangerous paths
    if [ "$p" = "$SCRIPT_DIR" ] || [ "$p" = "/" ] || [ "$p" = "$HOME" ]; then
        engine_log_error "Safety invariant violated: refusing to remove path $p"
        PARTIAL_FAILURE=1
        continue
    fi

    if [ -f "$p" ]; then
        rm -f "$p" 2>/dev/null || PARTIAL_FAILURE=1
    elif [ -d "$p" ]; then
        # If removing state dir, release lock first
        if [ "$p" = "$STATE_DIR" ]; then
            release_setup_lock "$STATE_DIR"
            LOCK_ACQUIRED=0
        fi
        rm -rf "$p" 2>/dev/null || PARTIAL_FAILURE=1
    fi
done

# U09: Purge images if requested
if [ "$OPT_PURGE_IMAGES" -eq 1 ] && [ "${#TARGET_IMAGES[@]}" -gt 0 ]; then
    engine_log_step "Purging ${#TARGET_IMAGES[@]} image(s)..."
    for img in "${TARGET_IMAGES[@]}"; do
        if ! "$ENGINE_BIN" "${CTX_ARGS[@]}" rmi "$img" >/dev/null 2>&1; then
            engine_log_warn "Failed to remove image $img (may still be referenced by another container)."
        fi
    done
fi

# U10: Final validation and reporting
if [ "$PARTIAL_FAILURE" -ne 0 ]; then
    engine_log_error "Uninstallation completed with partial failures. Some resources could not be removed."
    exit "$EXIT_PARTIAL"
fi

engine_log_ok "Studio Universal uninstallation completed successfully."
exit "$EXIT_SUCCESS"
