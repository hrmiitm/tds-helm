#!/usr/bin/env bash
# scripts/lib/engine.sh -- Universal Engine Discovery and Resource Library
# Conforms to upgrade.md Section 4 & Section 8. Bash 3.2+ compatible. Zero emojis.

# Exit codes per Section 8.1
readonly EXIT_SUCCESS=0
readonly EXIT_USAGE=2
readonly EXIT_PREREQ=3
readonly EXIT_ENGINE=4
readonly EXIT_IMAGE_BUILD=5
readonly EXIT_CONFLICT=6
readonly EXIT_CANCEL=7
readonly EXIT_PARTIAL=8

# Logging helpers (zero emojis)
engine_log_info() {
    printf "[INFO] %s\n" "$*"
}

engine_log_step() {
    printf "[STEP] %s\n" "$*"
}

engine_log_ok() {
    printf "[OK] %s\n" "$*"
}

engine_log_warn() {
    printf "[WARN] %s\n" "$*" >&2
}

engine_log_error() {
    printf "[ERROR] %s\n" "$*" >&2
}

# Resolve script directory portably
resolve_dir() {
    local target="$1"
    (
        cd "$target" 2>/dev/null && pwd -P
    )
}

# Platform detection
detect_os() {
    local raw_os
    raw_os="$(uname -s 2>/dev/null || echo "Unknown")"
    case "$raw_os" in
        Linux*)               echo "linux" ;;
        Darwin*)              echo "darwin" ;;
        CYGWIN*|MINGW*|MSYS*) echo "windows" ;;
        *)                    echo "unknown" ;;
    esac
}

detect_arch() {
    local raw_arch
    raw_arch="$(uname -m 2>/dev/null || echo "unknown")"
    case "$raw_arch" in
        x86_64|amd64)   echo "amd64" ;;
        arm64|aarch64)  echo "arm64" ;;
        *)              echo "$raw_arch" ;;
    esac
}

# Resolve State Directory per Section 2.2
get_state_dir() {
    local os
    os="$(detect_os)"
    case "$os" in
        darwin)
            echo "$HOME/Library/Application Support/Studio Universal"
            ;;
        windows)
            if [ -n "${LOCALAPPDATA:-}" ]; then
                echo "$LOCALAPPDATA/Studio Universal"
            else
                echo "$HOME/.local/state/studio-universal"
            fi
            ;;
        *)
            echo "${XDG_STATE_HOME:-$HOME/.local/state}/studio-universal"
            ;;
    esac
}

# Installation UUID generation & resolution
get_or_create_installation_id() {
    local state_dir="$1"
    mkdir -p "$state_dir"
    local id_file="$state_dir/installation_id"
    if [ -f "$id_file" ]; then
        local existing_id
        existing_id="$(head -n 1 "$id_file" | tr -d '[:space:]')"
        if [ -n "$existing_id" ]; then
            echo "$existing_id"
            return 0
        fi
    fi

    local new_id=""
    if command -v uuidgen >/dev/null 2>&1; then
        new_id="$(uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
    elif [ -f /proc/sys/kernel/random/uuid ]; then
        new_id="$(head -n 1 /proc/sys/kernel/random/uuid | tr -d '[:space:]')"
    elif command -v python3 >/dev/null 2>&1; then
        new_id="$(python3 -c 'import uuid; print(uuid.uuid4())' 2>/dev/null | tr -d '[:space:]')"
    else
        # Fallback pseudo-UUID
        new_id="$(od -x -N 16 /dev/urandom 2>/dev/null | head -n 1 | awk '{printf "%s%s-%s-%s-%s-%s%s%s", $2, $3, $4, $5, $6, $7, $8, $9}')"
    fi

    if [ -z "$new_id" ]; then
        new_id="studio-$(date +%s)-$RANDOM"
    fi

    printf "%s\n" "$new_id" > "$id_file"
    chmod 600 "$id_file" 2>/dev/null || true
    echo "$new_id"
}

# Local Setup Lock per Section 8.1
acquire_setup_lock() {
    local state_dir="$1"
    local lock_name="${2:-setup.lock}"
    mkdir -p "$state_dir"
    local lock_dir="$state_dir/$lock_name"

    if mkdir "$lock_dir" 2>/dev/null; then
        echo "$$" > "$lock_dir/pid"
        date -u +"%Y-%m-%dT%H:%M:%SZ" > "$lock_dir/time"
        return 0
    fi

    # Check for stale lock
    if [ -f "$lock_dir/pid" ]; then
        local holder_pid
        holder_pid="$(head -n 1 "$lock_dir/pid" 2>/dev/null | tr -d '[:space:]' || echo "")"
        if [ -n "$holder_pid" ]; then
            if ! kill -0 "$holder_pid" 2>/dev/null; then
                engine_log_warn "Reclaiming stale setup lock from inactive process PID: $holder_pid"
                rm -rf "$lock_dir"
                if mkdir "$lock_dir" 2>/dev/null; then
                    echo "$$" > "$lock_dir/pid"
                    date -u +"%Y-%m-%dT%H:%M:%SZ" > "$lock_dir/time"
                    return 0
                fi
            else
                engine_log_error "Another setup/maintenance process is currently running (PID: $holder_pid)."
                return "$EXIT_CONFLICT"
            fi
        fi
    fi

    engine_log_error "Failed to acquire setup lock at $lock_dir."
    return "$EXIT_CONFLICT"
}

release_setup_lock() {
    local state_dir="$1"
    local lock_name="${2:-setup.lock}"
    local lock_dir="$state_dir/$lock_name"
    if [ -d "$lock_dir" ]; then
        if [ -f "$lock_dir/pid" ]; then
            local holder_pid
            holder_pid="$(head -n 1 "$lock_dir/pid" 2>/dev/null | tr -d '[:space:]' || echo "")"
            if [ "$holder_pid" = "$$" ]; then
                rm -rf "$lock_dir"
            fi
        else
            rm -rf "$lock_dir"
        fi
    fi
}

# Engine Probe and Resolution per Section 4.2 & Section 8.2 I03
probe_engine() {
    local req_engine="${1:-auto}"
    local req_context="${2:-}"
    local state_dir="${3:-}"

    # Check saved choice if auto and state_dir provided
    local saved_engine=""
    local saved_context=""
    if [ "$req_engine" = "auto" ] && [ -n "$state_dir" ] && [ -f "$state_dir/config.json" ]; then
        if command -v python3 >/dev/null 2>&1; then
            saved_engine="$(python3 -c "import json; d=json.load(open('$state_dir/config.json')); print(d.get('engine',''))" 2>/dev/null || echo "")"
            saved_context="$(python3 -c "import json; d=json.load(open('$state_dir/config.json')); print(d.get('context',''))" 2>/dev/null || echo "")"
        fi
    fi

    local candidate_engines=()
    if [ "$req_engine" != "auto" ]; then
        candidate_engines=("$req_engine")
    elif [ -n "$saved_engine" ]; then
        candidate_engines=("$saved_engine")
    else
        # Deterministically prefer reachable Docker first, then Podman
        candidate_engines=("docker" "podman")
    fi

    local selected_bin=""
    local selected_context="$req_context"
    if [ -z "$selected_context" ] && [ -n "$saved_context" ]; then
        selected_context="$saved_context"
    fi

    local found_any_cli=0
    local last_err_code="$EXIT_ENGINE"
    local last_err_msg=""

    for eng in "${candidate_engines[@]}"; do
        if ! command -v "$eng" >/dev/null 2>&1; then
            if [ "$req_engine" = "$eng" ]; then
                engine_log_error "Requested engine executable '$eng' not found in PATH."
                return "$EXIT_PREREQ"
            fi
            continue
        fi
        found_any_cli=1

        # Build context arguments
        local ctx_args=()
        if [ -n "$selected_context" ]; then
            if [ "$eng" = "docker" ]; then
                ctx_args=("--context" "$selected_context")
            elif [ "$eng" = "podman" ]; then
                ctx_args=("--connection" "$selected_context")
            fi
        fi

        # Probe daemon availability with structured info check
        local info_err_file
        info_err_file="$(mktemp 2>/dev/null || echo "/tmp/engine_probe_$$.err")"
        local info_out_file
        info_out_file="$(mktemp 2>/dev/null || echo "/tmp/engine_probe_$$.out")"

        if "$eng" "${ctx_args[@]}" info >"$info_out_file" 2>"$info_err_file"; then
            # Verify Linux container mode
            if [ "$eng" = "docker" ]; then
                local os_type
                os_type="$("$eng" "${ctx_args[@]}" info --format '{{.OSType}}' 2>/dev/null || grep -i "^Server Version:" "$info_out_file" || echo "linux")"
                if [ "$os_type" = "windows" ]; then
                    engine_log_error "Docker is currently configured for Windows containers. Studio Universal requires Linux container support."
                    rm -f "$info_err_file" "$info_out_file"
                    return "$EXIT_ENGINE"
                fi
            fi

            selected_bin="$eng"
            rm -f "$info_err_file" "$info_out_file"
            break
        else
            local err_text
            err_text="$(cat "$info_err_file" 2>/dev/null || echo "")"
            rm -f "$info_err_file" "$info_out_file"

            # Check permissions vs daemon stopped vs unsupported capability
            case "$err_text" in
                *"permission denied"*|*"Permission denied"*)
                    engine_log_error "Permission denied connecting to $eng daemon socket. Ensure user has appropriate permissions or group membership."
                    return "$EXIT_ENGINE"
                    ;;
                *"Cannot connect"*|*"Is the docker daemon running"*|*"daemon is not running"*|*"connection refused"*|*"machine is not running"*)
                    last_err_msg="Engine '$eng' daemon is stopped, unreachable, or its machine/VM is not running."
                    last_err_code="$EXIT_ENGINE"
                    ;;
                *)
                    last_err_msg="Engine '$eng' info check failed: $err_text"
                    last_err_code="$EXIT_ENGINE"
                    ;;
            esac

            if [ "$req_engine" = "$eng" ]; then
                engine_log_error "$last_err_msg"
                return "$last_err_code"
            fi
        fi
    done

    if [ -z "$selected_bin" ]; then
        if [ "$found_any_cli" -eq 0 ]; then
            engine_log_error "Neither Docker nor Podman CLI was found in PATH. Please install Docker or Podman."
            return "$EXIT_PREREQ"
        fi
        engine_log_error "${last_err_msg:-Unable to connect to any container engine daemon.}"
        return "$last_err_code"
    fi

    ENGINE_BIN="$selected_bin"
    ENGINE_CONTEXT="$selected_context"
    return 0
}

# Resolve Engine Socket Source per Section 4.2 & Section 8.3 W04
resolve_engine_socket() {
    local eng="$1"
    local sock=""
    local os
    os="$(detect_os)"

    if [ "$eng" = "docker" ]; then
        if [ -n "${DOCKER_HOST:-}" ]; then
            sock="${DOCKER_HOST#unix://}"
        elif [ "$os" = "darwin" ]; then
            if [ -S "$HOME/.docker/run/docker.sock" ]; then
                sock="$HOME/.docker/run/docker.sock"
            elif [ -S "/var/run/docker.sock" ]; then
                sock="/var/run/docker.sock"
            fi
        elif [ -S "/var/run/docker.sock" ]; then
            sock="/var/run/docker.sock"
        elif [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -S "$XDG_RUNTIME_DIR/docker.sock" ]; then
            sock="$XDG_RUNTIME_DIR/docker.sock"
        fi
    elif [ "$eng" = "podman" ]; then
        if [ -n "${CONTAINER_HOST:-}" ]; then
            sock="${CONTAINER_HOST#unix://}"
        elif [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -S "$XDG_RUNTIME_DIR/podman/podman.sock" ]; then
            sock="$XDG_RUNTIME_DIR/podman/podman.sock"
        elif [ -S "/run/podman/podman.sock" ]; then
            sock="/run/podman/podman.sock"
        fi
    fi

    echo "$sock"
}

# Resource Detection per Section 4.3 & Section 8.2 I04
detect_resources() {
    local target_dir="${1:-/tmp}"

    # CPUs
    local cpus=1
    if command -v nproc >/dev/null 2>&1; then
        cpus="$(nproc)"
    elif command -v sysctl >/dev/null 2>&1; then
        cpus="$(sysctl -n hw.ncpu 2>/dev/null || echo 1)"
    elif command -v getconf >/dev/null 2>&1; then
        cpus="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)"
    fi

    # Total RAM in MiB
    local ram_mib=1024
    if [ -f /proc/meminfo ]; then
        local kb
        kb="$(awk '/MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
        if [ "$kb" -gt 0 ] 2>/dev/null; then
            ram_mib="$(( kb / 1024 ))"
        fi
    elif command -v sysctl >/dev/null 2>&1; then
        local bytes
        bytes="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
        if [ "$bytes" -gt 0 ] 2>/dev/null; then
            ram_mib="$(( bytes / 1048576 ))"
        fi
    fi

    # Free Disk Space in MB
    local disk_mb=2048
    if command -v df >/dev/null 2>&1; then
        local df_val
        df_val="$(df -k "$target_dir" 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)"
        if [ "$df_val" -gt 0 ] 2>/dev/null; then
            disk_mb="$(( df_val / 1024 ))"
        fi
    fi

    DETECTED_CPUS="$cpus"
    DETECTED_RAM_MIB="$ram_mib"
    DETECTED_DISK_MB="$disk_mb"
}

validate_resources_desktop() {
    local target_dir="$1"
    detect_resources "$target_dir"

    # Default chapter ceiling is 2 CPUs and 3 GiB RAM per Section 4.3
    if [ "$DETECTED_CPUS" -lt 2 ]; then
        engine_log_warn "System has $DETECTED_CPUS CPU core(s). Recommended minimum for Studio chapter runtime is 2 CPUs."
    fi

    if [ "$DETECTED_RAM_MIB" -lt 2500 ]; then
        engine_log_warn "Available RAM ($DETECTED_RAM_MIB MiB) is below recommended 3072 MiB (3 GiB). Chapter runtimes may experience memory pressure."
    fi

    if [ "$DETECTED_DISK_MB" -lt 3000 ]; then
        engine_log_warn "Free disk space ($DETECTED_DISK_MB MB) is low. Recommended minimum is 5000 MB."
    fi
}

validate_resources_hub() {
    local target_dir="$1"
    detect_resources "$target_dir"

    # Hub limit is 0.5 CPU and 256 MiB RAM per Section 4.3
    if [ "$DETECTED_RAM_MIB" -lt 512 ]; then
        engine_log_warn "Available RAM ($DETECTED_RAM_MIB MiB) is very low for running container hub."
    fi
}

# Label-based Container and Volume Inventory
list_candidate_containers() {
    local eng="$1"
    local ctx="${2:-}"
    local ctx_args=()
    if [ -n "$ctx" ]; then
        if [ "$eng" = "docker" ]; then ctx_args=("--context" "$ctx"); else ctx_args=("--connection" "$ctx"); fi
    fi

    # Returns lines: ID\tName\tManaged\tInstallation\tRole\tStatus
    "$eng" "${ctx_args[@]}" ps -a --format '{{.ID}}\t{{.Names}}\t{{.Label "io.studio.managed"}}\t{{.Label "io.studio.installation"}}\t{{.Label "io.studio.role"}}\t{{.Status}}' 2>/dev/null || true
}

list_candidate_volumes() {
    local eng="$1"
    local ctx="${2:-}"
    local ctx_args=()
    if [ -n "$ctx" ]; then
        if [ "$eng" = "docker" ]; then ctx_args=("--context" "$ctx"); else ctx_args=("--connection" "$ctx"); fi
    fi

    # Returns lines: Name\tManaged\tInstallation\tRole
    "$eng" "${ctx_args[@]}" volume ls --format '{{.Name}}\t{{.Label "io.studio.managed"}}\t{{.Label "io.studio.installation"}}\t{{.Label "io.studio.role"}}' 2>/dev/null || true
}

list_candidate_networks() {
    local eng="$1"
    local ctx="${2:-}"
    local ctx_args=()
    if [ -n "$ctx" ]; then
        if [ "$eng" = "docker" ]; then ctx_args=("--context" "$ctx"); else ctx_args=("--connection" "$ctx"); fi
    fi

    "$eng" "${ctx_args[@]}" network ls --format '{{.ID}}\t{{.Name}}\t{{.Label "io.studio.managed"}}\t{{.Label "io.studio.installation"}}' 2>/dev/null || true
}

list_candidate_images() {
    local eng="$1"
    local ctx="${2:-}"
    local ctx_args=()
    if [ -n "$ctx" ]; then
        if [ "$eng" = "docker" ]; then ctx_args=("--context" "$ctx"); else ctx_args=("--connection" "$ctx"); fi
    fi

    "$eng" "${ctx_args[@]}" images --format '{{.ID}}\t{{.Repository}}:{{.Tag}}\t{{.Digest}}' 2>/dev/null || true
}

# Probe disposable container per Section 8.2 I04
run_disposable_probe() {
    local eng="$1"
    local ctx="${2:-}"
    local img="${3:-rag-studio:4.2.0}"
    local ctx_args=()
    if [ -n "$ctx" ]; then
        if [ "$eng" = "docker" ]; then ctx_args=("--context" "$ctx"); else ctx_args=("--connection" "$ctx"); fi
    fi

    local probe_name="studio-probe-$$"
    # Ensure cleanup on return
    "$eng" "${ctx_args[@]}" rm -f "$probe_name" >/dev/null 2>&1 || true

    local probe_res=0
    "$eng" "${ctx_args[@]}" run --rm --name "$probe_name" \
        --label "io.studio.managed=true" \
        --label "io.studio.role=probe" \
        "$img" true >/dev/null 2>&1 || probe_res=$?

    return "$probe_res"
}
