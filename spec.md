# Studio Universal v4.2 — Multi-Course & Immersive Workspace Specification

**Document revision:** 4.2.0 · **Audit date:** 2026-11-07  
**Architecture:** Single HTTP/WebSocket gateway with master container orchestrator, multi-course catalog, True Immersive Focus Mode, draggable persistent annotations with iPad laser decay, and offline Reveal.js/KaTeX presentation decks.  
**Status:** Implementation contract & authoritative system specification. Fully implemented and verified.

## 1. Architectural audit and decisions

| Severity | Finding in revision 4.0.0 / archived evidence | Required correction |
|---|---|---|
| Critical | Unauthenticated IDE and notebook server published on all host interfaces; wildcard framing, wildcard Jupyter origins and disabled XSRF | Loopback publication by default; authenticated HTTPS ingress for remote use; exact allowed hosts/ancestors; retain XSRF and origin checks. |
| High | Electron `before-input-event.preventDefault()` on Ctrl/Cmd+W prevents the editor receiving that shortcut | Remove conflicting menu accelerators; leave editor input uncancelled. Keep Chromium security and sandboxing enabled. |
| High | amd64-only base, x86-specific CPU assumptions, developer `npm install` as learner setup | Native amd64/arm64 image manifest and prebuilt signed desktop packages; no host language runtimes or compilers. |
| High | `$host` drops the external port; external HTTPS is not represented correctly; `/preview/` is missing | Forward the validated full authority, use configured public scheme, preserve Jupyter prefix, strip code-server/preview prefixes as specified. |
| High | `curl -s` regards 404/500 as successful transport; startup proceeds after timeout; no continuing child supervision | Exact HTTP/JSON readiness checks, startup deadlines, runtime monitoring, signal forwarding and container failure on essential service loss. |
| High | Browser preview loads `127.0.0.1:8000`, which addresses the learner's host | Proxy container port 8000 through `/preview/8000/`; configure application URL prefixes and offline API documentation assets. |
| High | Three.js interaction has no keyboard/touch boundary or lifecycle contract | Focusable canvas, explicit Reveal keyboard gate, bubbling suppression, pointer capture, accessible controls and hidden-view rendering suspension. |
| High | Archived tasks and notebooks do not share a verified exercise definition | Versioned canonical task manifest, explicit notebook cell/script mapping, reproducible corpus/settings, generated answer fixtures and parity tests. |
| Medium | Model baking and runtime use different cache paths; warmup is described as persistent graph compilation | Use an immutable local model directory and offline loading. Build-time inference validates artifacts; each runtime still loads the model. |
| Medium | Four inference threads on two CPUs, multiple model copies, unbounded notebook lifetime | Default one computational thread per process, one active heavy workload, kernel lifecycle controls and a measured memory budget. |
| Medium | 3D projections and analogy examples imply exact geometry/semantic guarantees | Compute true similarity from original embeddings; label projected geometry and analogies as demonstrations. |

### 1.1 Lessons retained from the archives

Reviewed: `old-design/{README.md,spec.md,course/}`, `old-design/v2-browser/{README.md,spec.md,nginx.conf,entrypoint.sh,web/tasks.json}`, and `old-design-v2/{README.md,spec.md,AGENTS.md,entrypoint.sh,rag-project/,web/tasks.json,electron-app/src/tasks.json}`.

- **v1:** Notebook-first course lacked the desired integrated IDE and task workflow. JupyterLab itself does have file browsing, terminals and text editing; do not describe their absence as an inherent JupyterLab limitation.
- **v2:** Restore the browser split-pane as a supported access mode. Reserved shortcuts vary across browsers and operating systems; a web page cannot guarantee overriding them. `Ctrl+Shift+P` is not universally an Incognito shortcut. Provide visible editor commands and direct tool links.
- **v2 incident diagnosis:** `ECONNREFUSED` means a failed connection to a listener/address. It is not proof of CORS or storage partitioning. Separately diagnose wrong ports, host-versus-container localhost, mixed content, frame policy, service workers and third-party cookies. Same-origin routing fixes many deployment issues but cannot guarantee arbitrary extensions work.
- **v3:** Retain the native host experience, remove Electron from the container and remove X11 mounts, `xhost`, host networking, `--ipc=host`, privileged execution and `--no-sandbox`.

### 1.2 Product and support boundary

A learner needs an existing supported container runtime and, optionally, the packaged desktop application. No Python, Node.js, npm, Git, C++ toolchain, XQuartz, VcXsrv or separately configured display bridge is required on the host. Docker Desktop's own VM/WSL2 installation and hardware virtualization remain container-runtime prerequisites. The app connects to an already started hub; automatic Docker installation or Docker-socket access is out of scope.

| Host | Container architecture | Native distribution / acceptance requirement |
|---|---|---|
| macOS Intel | `linux/amd64` | Signed, notarized x64 DMG |
| macOS Apple Silicon | `linux/arm64` | Signed, notarized arm64 DMG; no required amd64 emulation |
| Windows 10/11 x64 where the chosen Electron and Docker releases remain supported | `linux/amd64` Linux containers | Signed EXE installer including the Electron runtime; no system Node.js |
| Linux desktop x64 / arm64 | Matching Linux architecture | AppImage plus a FUSE-independent extracted bundle/launcher; test both X11 and Wayland |
| Killercoda or similar 2-vCPU / 4-GiB Ubuntu sandbox | Usually `linux/amd64` | Browser through the provider's port-8080 HTTPS URL; desktop optional and subject to provider login support |

“Any Linux distribution without extra libraries” cannot be an unconditional native Electron guarantee: libc ABI, display server, graphics libraries and sandbox support still matter. Publish a tested desktop baseline (Ubuntu LTS, Debian stable, Fedora stable, current Arch, both applicable architectures), bundle legally redistributable application libraries, and test on clean machines. Supply a FUSE-independent launch path rather than asking learners to install FUSE. Minimal/headless or incompatible distributions use the browser mode from a supported client. Never fall back to disabling the Electron sandbox. [AppImage FUSE guidance](https://docs.appimage.org/user-guide/troubleshooting/fuse.html).

The release manifest records exact OS versions, libc/runtime requirements and browser versions actually tested. Hardware/OS combinations outside that matrix are best effort. The container is a **single learner's arbitrary-code execution environment**, not a multi-tenant security boundary. One isolated container and volume per learner is mandatory for hosted classrooms.

## 2. Topology, origins and access profiles

```text
Browser OR native Electron (host; loads the HTTP(S) hub, not a file:// wrapper)
  -> one public origin / port
     Nginx :8080 (non-root)
       /                       Studio shell, tasks, preview inspector
       /slides/                local Reveal.js + Three.js assets
       /vscode/                -> 127.0.0.1:8081 (prefix stripped)
       /jupyter/               -> 127.0.0.1:8888 (prefix preserved)
       /preview/8000/          -> 127.0.0.1:8000 (prefix stripped)
       /health/live            gateway liveness
       /health/ready           supervisor-controlled readiness
       /health/status.json     bounded service status, no secrets
  -> /workspace + /opt/venv + /opt/hf_cache (shared within container)
```

Only 8080 is exposed by the image. Internal IDE, notebook and example API listeners bind IPv4 loopback. URLs in client code are root-relative (`/vscode/`, `/jupyter/lab`, `/slides/`, `/preview/8000/`), never hard-coded `localhost` URLs. Use the current origin and `ws:`/`wss:` derived from its scheme. Pick one canonical local hostname for cookies and saved progress; localhost and 127.0.0.1 are different origins.

### 2.1 Local profile (default)

- Publish `127.0.0.1:8080:8080`, use `http://localhost:8080`. Loopback HTTP is suitable for local development secure-context browser features; validate actual browser behavior.
- Empty Jupyter token and `code-server --auth none` are permitted only within this local trust boundary, or behind the authenticated remote boundary below.
- Nginx accepts only configured host authorities. Do not expose the hub on a LAN as an anonymous coding environment. All scripts, notebooks and preview applications share the learner's trust boundary and filesystem.

### 2.2 Remote / Killercoda profile

- Set `RAG_PUBLIC_ORIGIN` to the **exact** externally assigned HTTPS origin, without credentials, path, query or fragment. The startup renderer uses parsed URL fields, rejects CR/LF and configuration metacharacters, and emits exact Nginx host/authority entries and Jupyter hostnames.
- Remote deployment requires provider access control or an operator-supplied authenticated reverse proxy protecting **every path and WebSocket handshake**, including static content, previews and health endpoints. TLS termination and authentication are outside this single learner container. The operator must validate the provider's privacy model; a public, unguessable URL alone is not authentication.
- For container-internal port exposure on Killercoda, `-p 8080:8080` is allowed only within the provider-isolated, access-controlled sandbox. The learner uses its port-8080 launch URL, not `localhost` in their own browser. Keep public hosts configurable because the provider assigns them per session.
- Nginx overwrites forwarded headers. Derive the upstream scheme from the configured public origin, not an untrusted incoming `X-Forwarded-Proto`. Preserve the validated public `Host` including its port; require ingress to preserve that authority. No TLS certificate bypasses in Electron.
- Supported deployment is at the **origin root**. A provider adding `/some/session/prefix/` must supply a root-origin endpoint or a separately tested generated prefix configuration for every tool, asset, cookie and WebSocket. Do not pretend `X-Forwarded-Prefix` alone fixes this.
- Open the hub in a top-level tab by default. If provider framing is required, set `RAG_FRAME_ANCESTORS` to a validated list of exact HTTPS origins. Every ancestor in a nested frame chain must be allowed by each framed application. Test Safari with default privacy controls; top-level launch is the fallback when provider framing/storage policies interfere.

## 3. Nginx gateway contract

### 3.1 Reference local configuration

The following is the complete local baseline for `/etc/nginx/nginx.conf`. It runs as UID 1000 on an unprivileged port. Create `/tmp/nginx/{client,proxy,fastcgi,uwsgi,scgi}` and `/tmp/rag-health` before startup. Image assets must be world-readable. Runtime configuration is generated into `/tmp/rag-config/nginx.conf`; do not mutate the read-only image configuration.

```nginx
worker_processes 1;
pid /tmp/nginx.pid;
error_log /dev/stderr warn;
events { worker_connections 512; }
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    access_log /dev/stdout;
    sendfile on;
    keepalive_timeout 65;
    client_max_body_size 32m;
    client_body_temp_path /tmp/nginx/client;
    proxy_temp_path /tmp/nginx/proxy;
    fastcgi_temp_path /tmp/nginx/fastcgi;
    uwsgi_temp_path /tmp/nginx/uwsgi;
    scgi_temp_path /tmp/nginx/scgi;

    map $http_upgrade $connection_upgrade {
        default upgrade;
        '' close;
    }
    # Startup renderer adds the exact RAG_PUBLIC_ORIGIN authority if supplied.
    # Add the explicitly configured local host port when publishing a different port.
    map $http_host $rag_allowed_host {
        default 0;
        localhost:8080 1;
        127.0.0.1:8080 1;
    }
    # Remote renderer adds: public.example:443 https; (actual parsed authority).
    # The local health requests continue to use http.
    map $http_host $rag_public_scheme {
        default http;
    }
    map $uri $rag_cache_control {
        default "";
        ~^/health/ no-store;
    }

    server {
        listen 8080 default_server;
        server_name _;
        if ($rag_allowed_host = 0) { return 444; }
        absolute_redirect off;
        root /usr/share/nginx/html;
        index index.html;

        # Inherited by locations unless a location adds its own add_header.
        add_header Content-Security-Policy "frame-ancestors 'self'" always;
        add_header X-Content-Type-Options nosniff always;
        add_header Referrer-Policy same-origin always;
        add_header Cache-Control $rag_cache_control always;

        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_set_header X-Forwarded-Proto $rag_public_scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_connect_timeout 5s;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;

        location = /health/live {
            default_type application/json;
            return 200 '{"status":"live"}';
        }
        location = /health/ready {
            alias /tmp/rag-health/ready.json;
            default_type application/json;
            error_page 404 =503 @not_ready;
        }
        location @not_ready {
            default_type application/json;
            return 503 '{"status":"starting-or-unavailable"}';
        }
        location = /health/status.json {
            alias /tmp/rag-health/status.json;
            default_type application/json;
        }
        location = /vscode { return 308 /vscode/$is_args$args; }
        location = /jupyter { return 308 /jupyter/$is_args$args; }
        location = /slides { return 308 /slides/$is_args$args; }
        location = /preview/8000 { return 308 /preview/8000/$is_args$args; }

        location /vscode/ {
            proxy_pass http://127.0.0.1:8081/;
        }
        location /jupyter/ {
            proxy_pass http://127.0.0.1:8888;
        }
        location /slides/ {
            alias /usr/share/nginx/slides/;
            index index.html;
        }
        location /preview/8000/ {
            proxy_pass http://127.0.0.1:8000/;
        }
        location /preview/ {
            default_type application/json;
            return 404 '{"error":"unsupported-preview-port","supported":[8000]}';
        }
        location / {
            try_files $uri $uri/ =404;
        }
    }
}
```

Use query/hash state for the shell, so missing JS/CSS is a 404 rather than silently returning HTML. Trailing-slash redirects preserve query strings and stay relative to the public origin. The Jupyter `proxy_pass` has **no URI part** and preserves `/jupyter/`; code-server and preview have a trailing `/` and strip their location prefix. Do not invent a code-server `--base-url` flag. Verify its relative URLs and redirects against the locked version. [code-server proxy guide](https://coder.com/docs/code-server/guide).

Explicit HTTP/1.1, `Upgrade` and conditional `Connection` forwarding are required on WebSocket routes. Ingress must also support upgrades and adequate idle timeouts. A 200 HTML page is not proof of a working terminal or notebook kernel; test actual 101 handshakes and bidirectional messages. Keep upstream ping/heartbeat behavior and reconnect UI. [Nginx WebSocket proxying](https://nginx.org/en/docs/http/websocket.html).

### 3.2 Framing, CSP and cookie rules

- `frame-ancestors 'self'` allows the shell to frame the tools. The shell's full CSP also needs `frame-src 'self'`; these directives serve different purposes. Ship shell JS/CSS locally with a hash/nonce-based script policy; use `object-src 'none'` and `base-uri 'self'`. Derive `connect-src` from the approved HTTP and WebSocket origins. Do not impose the shell's restrictive script policy on VS Code/Jupyter pages without upstream compatibility testing.
- The baseline Nginx policy is an additional ancestor restriction. **Multiple CSP headers intersect; they do not override each other.** Preserve upstream policies. For default same-origin use, an upstream `X-Frame-Options: SAMEORIGIN` is compatible; `DENY` is not. Inspect actual headers for the locked tools, including extension webviews and errors.
- Provider framing requires coordinated ancestors in Nginx and Jupyter and, if necessary, a narrowly scoped code-server header adapter. That adapter may replace only the `frame-ancestors` directive in each upstream CSP and remove conflicting X-Frame-Options; retain all other directives and multiple-policy semantics. Do not globally `proxy_hide_header Content-Security-Policy` to make frames work. If the tool cannot safely support provider framing, open the hub top-level.
- Do not set COEP/COOP cross-origin isolation globally; it can break embedded tools. Do not add wildcard CORS, rewrite the browser `Origin`, or globally set cookies to `SameSite=None` to mask routing errors.
- Preserve `Cookie`, `Set-Cookie`, query strings and WebSocket subprotocols. Jupyter cookies must cover `/jupyter/`. HTTPS deployment must retain secure cookies and must not generate internal `http://127.0.0.1:8888` URLs. No Nginx cookie-path rewriting is needed for the configured Jupyter base URL.
- IDE/Jupyter iframes use normal same-origin loading and no restrictive `sandbox` attribute that would disable required scripts, storage, downloads or workers. Their contents already have arbitrary execution privileges inside this learner's container. Preview HTML is also trusted learner code; it is not a safe place to render untrusted third-party applications under the hub origin.
- `add_header` inheritance changes when a location defines its own headers: any such location must include the complete shared header snippet, using `always` where appropriate. The baseline's URI map applies `Cache-Control: no-store` to health responses without dropping the ancestor policy. Release tests inspect normal and error responses. [Nginx header inheritance](https://nginx.org/en/docs/http/ngx_http_headers_module.html).

### 3.3 Jupyter configuration

Generate `jupyter_server_config.py` from validated deployment settings. Use JupyterLab 4.x and Jupyter Server 2.x in the locked environment. The old `--ServerApp.token=''` is a deprecated compatibility form; use the identity provider setting. Token-free operation does **not** require disabling XSRF.

```python
# jupyter_server_config.py (local profile)
c = get_config()
c.LabApp.extension_manager = "readonly"
c.ServerApp.ip = "127.0.0.1"
c.ServerApp.port = 8888
c.ServerApp.port_retries = 0
c.ServerApp.open_browser = False
c.ServerApp.root_dir = "/workspace"
c.ServerApp.base_url = "/jupyter/"
c.ServerApp.default_url = "/lab"
c.ServerApp.trust_xheaders = True
c.ServerApp.allow_remote_access = False
c.ServerApp.local_hostnames = ["localhost"]
c.IdentityProvider.token = ""
c.PasswordIdentityProvider.hashed_password = ""
c.ServerApp.allow_origin = ""
c.ServerApp.disable_check_xsrf = False
c.ServerApp.tornado_settings = {
    "headers": {"Content-Security-Policy": "frame-ancestors 'self'"}
}
c.MappingKernelManager.cull_idle_timeout = 1800
c.MappingKernelManager.cull_interval = 60
c.MappingKernelManager.cull_connected = False
c.MappingKernelManager.cull_busy = False
```

For remote use add the exact public hostname to `local_hostnames`; retain host validation rather than setting `allow_remote_access=True` globally. `trust_xheaders` is justified because only loopback Nginx can reach Jupyter and Nginx overwrites the values. An idle connected notebook is deliberately not culled; the UI offers an explicit kernel shutdown action. [Jupyter Server configuration](https://jupyter-server.readthedocs.io/en/latest/other/full-config.html).

JupyterLab obtains its XSRF cookie through normal page loading and supplies the matching token on modifying requests. Custom clients must first acquire the cookie, send credentials to the same origin and include `X-XSRFToken` on POST/PATCH/PUT/DELETE as required. A 403 is a diagnostic signal: check cookie path, origin/authority, public scheme and the token before changing security settings. Tests must include save, rename, upload, start/interrupt/restart/shutdown kernel, terminal use and a failed mutation without XSRF. A readiness GET cannot verify these operations. [Jupyter authentication/security model](https://jupyter-server.readthedocs.io/en/latest/operators/security.html).

The read-only extension manager avoids presenting a runtime pip-install workflow for the immutable environment. Disable automatic update/news network checks in the baked JupyterLab settings, and provide extensions at image build time. [JupyterLab extension manager configuration](https://jupyterlab.readthedocs.io/en/stable/user/extensions.html#extension-manager-implementations).

## 4. Container build, dependencies and offline assets

### 4.1 Image and lock contract

- Base: official `python:3.11-slim-bookworm`, pinned by multi-platform manifest digest in the release. Build native `linux/amd64` and `linux/arm64` variants in CI and publish one versioned manifest. Native builders are preferred for native libraries; do not force Apple Silicon through emulation. [Docker multi-platform builds](https://docs.docker.com/build/building/multi-platform/).
- CPU execution is required, AVX-512 is not. Compile native extensions to each supported architecture's portable baseline, with no build-host `-march=native`. Test on a documented baseline amd64 CPU and arm64 CPU. Chroma's native backend may differ by version; do not assume the separately installed `hnswlib` package is Chroma's backend.
- Multi-stage build: compilers, Python headers matching `/usr/local` Python, wheel build tools and any Rust toolchain stay in builder stages. Runtime contains `/opt/venv`, Nginx, code-server's packaged runtime, `tini`, Bash, `curl`, `util-linux` (`setsid`), CA certificates, Git, `libgomp1`/`libstdc++6` and required shared libraries only. Keep the language tools inside the container. No Electron, X server, NodeSource installer or passwordless sudo in the image.
- Fetch code-server archives per architecture using explicit versions and verified checksums; use its bundled Node runtime. No `curl | sh`, `latest` tags or unpinned pip upgrades in release builds.
- Build `/opt/venv` normally with `python -m venv`; `--without-pip` is not a host-isolation requirement. Use `PATH=/opt/venv/bin:$PATH` for every service, terminal and kernel. Install local `rag_course` as a package into that environment so notebooks work from any working directory.
- Set UID/GID 1000 (`coder`), `HOME=/home/coder`, workdir `/workspace`. Keep `/opt/venv`, models and application assets root-owned and readable. Allow writes only to workspace, user state and runtime directories. Learner dependency experiments use a separate workspace virtualenv; the baseline course kernel remains reproducible.

The implementation must commit `locks/python-linux-{amd64,arm64}.txt` with all transitive versions and hashes, JavaScript lockfiles, image digest, code-server checksums, model commit SHA and extension VSIX checksums in `release-manifest.json`. Lock generation and compatibility tests are build work, not learner setup. A candidate version is not a validated release merely because its package exists.

| Layer | Required release selection policy |
|---|---|
| Python / notebook | Python 3.11.x; JupyterLab 4.x, Jupyter Server 2.x, ipykernel; exact compatible patch versions locked |
| Embedding runtime | Security-maintained CPU PyTorch 2.x (at least 2.6), sentence-transformers, transformers, tokenizers, huggingface-hub; resolve and test jointly on both architectures |
| Vector database | ChromaDB 1.x with its matching native backend; use its documented cosine-index configuration; migrate old API usage and recreate course indexes from source corpus |
| Course utilities | numpy, pandas, matplotlib, rich, pydantic, langchain-text-splitters; no implicit reliance on transitive imports |
| API lesson | FastAPI, Uvicorn, locally bundled Swagger UI assets; Flask/Streamlit are optional separately tested extensions |
| Optional orchestration | LangChain core/community/Chroma integration only if a lesson uses them; pin a compatible family and test imports; do not retain obsolete pins just because they occur in the archives |
| Browser assets | Reveal.js 5.x and a matching single pinned Three.js release plus its own OrbitControls; no mixed versions or CDNs |
| Desktop | A currently supported Electron release, exact version locked; Electron 28 is not the release baseline |

Do not copy the old torch `2.4.1+cpu` wheel requirement unchanged to arm64. Wheel build suffixes and CPU packaging differ by architecture. Resolve architecture-specific wheels at build time, verify no CUDA runtime dependency is installed, run `pip check`, inspect the SBOM and reject unsupported/security-vulnerable versions. The legacy dependency matrix is migration input, not a certified set. Updating Chroma requires notebook/script API parity and persistence tests before publishing.

### 4.2 Model and frontend baking

Use one canonical model directory: `/opt/hf_cache/models/all-MiniLM-L6-v2`. At build time download a pinned commit of `sentence-transformers/all-MiniLM-L6-v2`, including model/tokenizer/config/pooling assets; prefer safetensors, verify the manifest and record license/attribution. Both architectures use the same model revision. Run a small CPU encode, verify finite `(2, 384)` output and normalized vectors, then test loading with outbound networking disabled.

```python
# Shared course loader; RAG_MODEL_PATH is set by the image.
import os
from functools import lru_cache
from sentence_transformers import SentenceTransformer

@lru_cache(maxsize=1)
def get_model():
    return SentenceTransformer(
        os.environ["RAG_MODEL_PATH"], device="cpu", local_files_only=True
    )
```

```dockerfile
ENV PATH="/opt/venv/bin:$PATH" \
    RAG_MODEL_PATH=/opt/hf_cache/models/all-MiniLM-L6-v2 \
    HF_HOME=/opt/hf_cache \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TOKENIZERS_PARALLELISM=false \
    ANONYMIZED_TELEMETRY=False \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
```

Apply offline flags after the networked bake stage. Do not initialize a model at container startup. Inference warmup does not persist a loaded model or magically remove runtime CPU costs. A process-local cache avoids repeated loads in one kernel; it does not share weights across separate Python processes.

Bake Reveal.js, Three.js, OrbitControls, fonts, syntax highlighting, MathJax/KaTeX assets, VSIX extensions and Swagger UI JS/CSS into the image. Load slides from `/slides/` using local module paths/import maps. Precompute vector visualization data during the build. Core lessons require no API key, model download, CDN, extension marketplace or external LLM. Do not promise offline behavior for arbitrary extensions or external links. Image pull/install initially requires access to a registry/download or an instructor-provided offline image/package.

### 4.3 Workspace persistence and seeding

Store immutable starter content under `/opt/course-template`. Mount a named volume at `/workspace`; seed only a truly empty volume, as UID 1000, and write a course-version marker. Never overwrite learner files on restart. On version mismatch, offer a new volume or explicit backed-up migration. Do not perform recursive chown on every startup or silently ignore permission failures.

Provide writable UID-1000-owned `/workspace` and `/home/coder` mountpoints in the image so new Docker named volumes initialize with usable ownership. Validate write access before starting services. Advanced bind mounts use documented ownership/SELinux handling; named volumes are the cross-platform default. Preserve course source and progress in workspace; persist IDE settings in a separate user-state volume. `/tmp` is ephemeral. Create `/course -> /workspace` for archived paths; migrate notebook metadata and paths rather than relying on the symlink alone.

## 5. Service lifecycle, health and resource limits

### 5.1 Startup sequence and process contract

1. `tini -g -- /entrypoint.sh` is PID 1. `entrypoint.sh` uses Bash `set -Eeuo pipefail`, traps EXIT/TERM/INT before starting children, and runs entirely as `coder`.
2. Validate configuration, workspace permissions, required assets/model files and available ports; seed workspace; merge first-run IDE defaults without overwriting learner settings. No pip/npm install, model inference, recursive workspace scans or network download at startup.
3. Create writable Nginx temp/config/health directories; remove stale ready marker; atomically write starting status. Run `nginx -t -c /tmp/rag-config/nginx.conf`; fail immediately on errors.
4. Start Nginx immediately to serve shell and status, then start code-server and wait for readiness, then Jupyter and wait for readiness. This staggers initialization peaks while allowing the UI to explain startup. Neither editor loading nor starting Jupyter should automatically launch a notebook kernel. The preview process starts only when the student runs it.
5. Each essential service starts in its own process group (`setsid`), with PID/group recorded and stdout/stderr retained in `docker logs`. A deadline covers all startup stages, default 120 seconds. Poll at one-second intervals with short request timeouts and check child liveness. On timeout or any early exit, remove readiness, record failing service, terminate other groups and exit nonzero. Do not print “ready” after a failed wait.
6. Only after the checks below succeed, atomically rename a prepared JSON marker to `/tmp/rag-health/ready.json` and publish ready status. The shell mounts a tool only when its status is ready.
7. Run a supervised lightweight watchdog every five seconds. Check child liveness and HTTP/JSON readiness; remove the ready marker on first failure. On three consecutive unhealthy probes or any essential process exit, terminate the group and exit nonzero. `wait -n` must observe Nginx, code-server, Jupyter and watchdog; even an unexpected exit code 0 is a service failure. No infinite restart loops hiding crashes.
8. On TERM/INT, clear readiness, TERM every recorded process group (including terminals/kernels), reap children, allow at most ten seconds, then KILL remaining groups and reap them. Signal cleanup must also work during startup. The container's stop grace is 15 seconds. `tini` reaps orphaned descendants; it does not replace service supervision.

Required process invocations:

```bash
code-server --bind-addr 127.0.0.1:8081 --auth none \
  --disable-telemetry --disable-update-check /workspace
jupyter lab --config=/tmp/rag-config/jupyter_server_config.py
nginx -c /tmp/rag-config/nginx.conf -g 'daemon off;'
```

Preserve workspace trust for imported/untrusted material. Mark only the baked lesson workspace as trusted if necessary for first-run usability; do not globally disable trust for every folder. Install only tested Python tooling, disable automatic extension updates, and avoid simultaneously running duplicate notebook extensions when native Jupyter is active.

### 5.2 Readiness and Docker health

`/usr/local/bin/rag-healthcheck` is a lightweight Python-standard-library or shell/JSON-parser tool packaged in the image. It must never import torch, Chroma or initialize a kernel. Per-request connect timeout ≤1 second, total request timeout ≤2 seconds; complete a full check in ≤8 seconds. Use exact status 200 and JSON fields, not curl transport success or HTML substring matching.

| Check | Expected evidence |
|---|---|
| `/health/live` | 200 JSON `{status: "live"}` |
| `/vscode/healthz` via Nginx | 200, valid code-server heartbeat JSON; both its `alive` and `expired` heartbeat states can indicate a responsive idle server, not a failed process |
| `/jupyter/api` via Nginx | 200 JSON with a server version, no login/HTML redirect |
| `/health/ready` | 200 JSON only after supervisor declares both services ready; otherwise 503 |
| Runtime monitor | Above dependencies plus recorded process liveness; ignore optional port-8000 absence |

The startup/monitor probe variant does not depend on `/health/ready` (avoids circular readiness). Docker's probe checks the marker and dependencies afresh, so a stale marker is insufficient. Every probe uses `Host: localhost:8080`; remote deployment retains this internal allowed authority. `/health/status.json` contains state, per-service readiness, elapsed startup time and a short error code only; no filesystem dumps, cookies or secrets. Set no-store and fetch with cache disabled.

```dockerfile
HEALTHCHECK --interval=20s --timeout=10s --start-period=120s --retries=3 \
  CMD ["/usr/local/bin/rag-healthcheck"]
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/entrypoint.sh"]
```

Docker health status alone does not restart a container. Process supervision must make failures visible through exit status; operators choose restart policies. Preview failure affects only its pane. Persist learner work before any user-requested restart; do not automatically kill healthy notebooks merely because a browser disconnected.

### 5.3 Resource profile and measurable budgets

Default teaching profile: 2 vCPUs and 4 GiB host/sandbox RAM, one learner, one notebook kernel **or** one heavy script/API process at a time. Both IDE and Jupyter servers may stay running. Switching panes does not free kernel/model memory. Explain shutdown of idle kernels and stopping scripts in the task panel; never silently terminate unsaved work. Full-stack lessons stop unused notebook kernels first.

| Measurement | Acceptance target on the published reference hardware |
|---|---|
| Hub idle, no kernel, default extensions | ≤900 MiB container working set |
| One MiniLM task + IDE + Jupyter server | ≤2.5 GiB peak container working set |
| Container memory cap for 4-GiB sandbox | 3 GiB, leaving space for host/provider; browser is separate on remote sandboxes |
| Warm image start to full readiness | ≤60 seconds target, hard startup deadline 120 seconds |
| MiniLM example (up to 32 short texts) | ≤15 seconds warm inference target, hardware and cold-load timings reported separately |
| Core course image | Target ≤2 GiB compressed / ≤5 GiB unpacked per architecture; measure before release |
| Pull and first-use disk headroom | Document measured download and ≥10 GiB free-disk recommendation; never build from source inside a timed workshop |

These are engineering budgets, not measured facts. Benchmark image size, cgroup peak memory, OOM events, startup, embedding latency and desktop/browser RSS; report host model, architecture and versions. A local 4-GiB machine running Docker Desktop plus Electron may need the lighter browser profile or more RAM even when the remote sandbox budget passes.

Set all BLAS/OpenMP pools to one thread, `torch.set_num_threads(1)` and `torch.set_num_interop_threads(1)` once before work, embedding batch size 16 and no multiprocessing data loaders. Set Chroma indexing concurrency to one using the locked release's supported configuration. Small course corpus: at most 1,000 chunks in default lessons. Exclude model caches, database files and generated outputs from IDE file watchers/search. Do not install large language servers/extensions without measuring their memory cost. No Uvicorn reload workers in the default lesson. The full environment check is user-triggered/CI-triggered, never part of recurring health probes.

## 6. Shared workspace and educational verification

### 6.1 Required implementation tree

```text
Dockerfile, entrypoint.sh, nginx.conf, release-manifest.json
config/                         # Jupyter and deployment rendering
locks/                          # Python per arch + frontend/desktop lockfiles
scripts/                        # bake, render config, supervise/health, CI validation
studio-web/                     # one shell shared by browser and desktop
  tasks.json                    # generated from canonical curriculum source
  task-schema.json
slides/                         # local deck/assets and precomputed vectors
curriculum/
  tasks.source.json
  exercises.json
  expected-results.json         # generated by reference solution runs
workspace/                      # baked into /opt/course-template
  notebooks/
    00_lexical_vs_semantic.ipynb
    01_chunking_basics.ipynb
    02_embeddings_deep_dive.ipynb
    03_vector_store_ops.ipynb
    04_full_rag_pipeline.ipynb
    05_api_preview.ipynb
  labs/
    keyword_limitation_demo.py
    chunking_lab.py
    embeddings_lab.py
    chroma_lab.py
    rag_pipeline_lab.py
    api_app.py
    verify_rag.py
  rag_course/                   # shared inputs, paths, model loader, exercise helpers
  data/raw/doc_001.txt, doc_002.txt, doc_003.txt
  data/policies/                # lexical demo policy texts, no hidden inline corpus
  data/chroma_db/notebooks/     # separate working stores per track
  data/chroma_db/scripts/
  results/, solutions/, README.md
desktop-app/                    # host client, packaging and connection UI
tests/                          # integration, curriculum parity, desktop, resource tests
```

All notebook metadata uses kernel name `rag-kernel` and display name `Python 3.11 (RAG Stack)`. Register it with:

```bash
/opt/venv/bin/python -m ipykernel install --prefix=/opt/venv \
  --name rag-kernel --display-name 'Python 3.11 (RAG Stack)'
```

Verify kernelspec `argv[0]` and terminal `sys.executable` are `/opt/venv/bin/python`, Python minor version exactly 3.11. Paths come from a shared `RAG_WORKSPACE=/workspace` helper, not the process working directory. Notebooks opened from `/workspace/notebooks` and scripts started from any directory must find the same raw data and model. Read text as UTF-8, normalize newlines deliberately, sort inputs and record corpus SHA-256. Ship `.gitattributes` for LF source/corpus text.

### 6.2 Canonical exercise mapping

Keep existing task IDs during migration, adding stable notebook cell IDs/tags and script step arguments. Notebook and script tracks teach the same exercise with the same inputs/parameters; they share data and helpers but retain meaningful learner code/TODOs. Solutions are separate. Results use a JSON schema, not parsing colored terminal output.

| Tasks | Notebook / tagged step | Script / step | Evidence and invariant |
|---|---|---|---|
| `t1_1`, `t1_2` | `00_lexical_vs_semantic`, `lexical-search`, `semantic-ranking` | `keyword_limitation_demo.py`, `lexical-search`, `semantic-ranking` | Lexical match count and ranked policy IDs; explain synonym mismatch. Preserve the same policy corpus and query in both tracks. |
| `t2_1`, `t2_2` | `01_chunking_basics`, `canonical-chunking`, `overlap` | `chunking_lab.py`, same step IDs | Integer chunk count for doc_001; demonstrate boundary context with generated chunk spans. |
| `t3_1`, `t3_2` | `02_embeddings_deep_dive`, `dimensions`, `cosine` | `embeddings_lab.py`, same step IDs | Shape D=384; finite normalized embeddings; relative similarity for the three specified sentences. |
| `t4_1`, `t4_2` | `03_vector_store_ops`, `index`, `query` | `chroma_lab.py`, same step IDs | Count equals canonical chunk manifest; query source from reference result; cosine distance ordering. |
| `t5_1` | `04_full_rag_pipeline`, `grounded-prompt` | `rag_pipeline_lab.py`, same step | Retrieved source IDs and citation-bearing prompt; explain limits of grounding. |
| `t5_2` | `04_full_rag_pipeline`, `environment-check` | `verify_rag.py`, full report | Actual component results and exit status, not an MCQ that always rewards “PASS”. |
| `t6_1`, `t6_2` (new) | `05_api_preview`, `serve`, `request` | `api_app.py`, startup and request lesson | `/preview/8000/health`, prefixed OpenAPI/docs, a successful JSON request and recoverable stopped-server state. |

Canonical chunk settings: `chunk_size=350`, `chunk_overlap=50`, `length_function=len`, separators `["\n\n", "\n", ". ", " ", ""]`, explicit separator/whitespace handling in `exercises.json`. The alternate 300/30 and 250/40 notebook exercises remain optional experiments and have separate result IDs. Recursive overlap is a requested target, not a promise of exactly 50 repeated characters or complete sentences at every boundary.

Archived discrepancies to fix during migration:

- The archived chunk MCQ says 12±1 for doc_001, while the index explanation assigns it 11 and asserts 32 overall. Do not retain these counts without regenerating them against the canonical corpus and locked splitter. Integer counts use zero tolerance; ±1 should not hide divergent exercises.
- Old notebooks refer to `rag-env`, `lab_collection` and `pipeline_rag`; scripts use `rag_knowledge_base`. Replace the metadata and use the same logical collection name/configuration, with distinct physical notebook/script DB paths to prevent concurrent writers from interfering. Do not concurrently mutate the same embedded Chroma store from separate processes. A later shared Chroma server is a separate architecture change.
- The lexical script implements simple keyword/sub-string matching, not BM25. Label it accurately. If BM25 is taught, add a real BM25 implementation and fixtures. Neither lexical retrieval nor dense retrieval universally wins.
- Policy documents were inline script data rather than the three raw technical documents. Make them explicit shared policy fixtures, and keep tasks' displayed names consistent.
- The capstone assembles a retrieval-grounded prompt. It does not run an LLM by default. Grounding can reduce hallucinations but does not guarantee correctness or force the model to obey retrieved evidence. Optional external generation must be explicitly enabled and is outside offline/core budgets.

Index exercises use deterministic IDs and idempotent upserts. Re-running a cell must not increase counts unexpectedly. Reset only the explicitly named course collection with a clear learner action. Use temporary databases for verification and record schema/model/corpus versions with persistent indexes; regenerate after incompatible changes.

For the Chroma 1.x implementation, use an explicit embedding function policy and index configuration:

```python
collection = client.get_or_create_collection(
    name="rag_knowledge_base",
    embedding_function=None,
    configuration={"hnsw": {"space": "cosine", "num_threads": 1}},
)
```

Always supply precomputed `embeddings` on upsert and `query_embeddings` on query, using the shared MiniLM loader. Do not let Chroma's default embedding function trigger a second model/runtime download. Validate an existing collection's stored configuration before reuse: get-or-create must not silently accept an incompatible previous index. Cosine distance is `1 - cosine_similarity`; smaller distance means a closer match. [Chroma collection configuration](https://docs.trychroma.com/docs/collections/configure).

### 6.3 Task schema, answer evaluation and state

`curriculum/tasks.source.json` is authoritative. Generate the same `studio-web/tasks.json` for both access modes; do not maintain a desktop copy. JSON Schema validates IDs, prerequisite DAG, track locations, step IDs, prompts, hints, solutions and answer types. Every notebook cell reference and script step must resolve. Optional experiment tasks cannot silently overwrite canonical result files.

Example canonical numeric task (the display question is retained across access modes):

```json
{
  "id": "t3_1",
  "exerciseId": "embeddings-dimensions",
  "prerequisites": ["t2_2"],
  "tracks": {
    "notebook": {
      "path": "notebooks/02_embeddings_deep_dive.ipynb",
      "cellTag": "dimensions"
    },
    "script": {
      "path": "labs/embeddings_lab.py",
      "args": ["--step", "dimensions", "--json"]
    }
  },
  "question": {
    "type": "numeric",
    "prompt": "What is the number of dimensions per embedding?",
    "expected": 384,
    "absoluteTolerance": 0,
    "relativeTolerance": 0,
    "integerOnly": true,
    "explanation": "This model produces 384 coordinates per embedding."
  }
}
```

- Numeric evaluation rejects blank input, trailing garbage, NaN and infinity. Validate a complete numeric string, then a finite number. Accept if `abs(actual-expected) <= max(absTolerance, relTolerance*abs(expected))`; counts/dimensions are exact integers. Similarity outputs may use declared absolute tolerance (default 1e-4 after cross-architecture measurement), not exact display-string equality.
- MCQs use stable option IDs and `correctOptionId`, so shuffle/localization cannot invalidate index-based answers. Provide evidence-specific explanations and progressive hints. Distinguish conceptual correctness from having executed a working lab.
- Generate data-dependent counts, top sources and reference distances by running reference solutions for the pinned corpus/model/dependencies. Store the generation input hash and results in `expected-results.json`; CI fails on stale or inconsistent fixtures. Where near-ties vary across architectures, use an explicit valid-answer set or a stronger fixture rather than inventing a guaranteed rank.
- Each script supports `--step` and `--json`, produces `{schemaVersion, exerciseId, track, inputHash, metrics, status}` and exits nonzero on failure. Notebook verification cells emit the same schema. Students can import a bounded result JSON into the shell; the browser does not gain an arbitrary command-execution endpoint to grade work.
- Task progress is separate from runtime health. Client-side answer keys/results are educational feedback, not secure examination grading. “Verified environment” requires actual diagnostic evidence.
- Store mode/layout/task progress locally with course/version namespace, handle blocked storage gracefully, and offer JSON export/import. Browser and Electron have distinct storage; switching clients does not automatically share localStorage. For cross-client continuity, save/import the progress JSON via `/workspace`; do not claim automatic synchronization. Reconcile version changes explicitly.
- Provide keyboard-accessible navigation, visible focus, text labels beyond color, responsive task text, hint and solution disclosure, previous/next actions and a non-destructive timer. Timer expiration does not delete work or shut down the container.

## 7. Dual-Pane Tabbed Workspace, Presentation & Annotation Architecture

### 7.1 Unified Dual-Pane Layout & Tab Contract

The user interface is structured into an ergonomic, high-density dual-pane learning environment inspired by professional developer IDEs and interactive cloud platforms:

| Pane | Role | Available Views / Tabs | Key Behaviors |
|---|---|---|---|
| **Left Pane** | **Learning & Curriculum** | • **`Tasks` View**: Step-by-step guidance, copyable CLI commands, verification MCQs/numeric checks with tolerances, hints, solutions, and module progression.<br>• **`Slides` View**: Embedded Reveal.js presentation with interactive 3D WebGL vector space and mathematical dimension inspector. | Seamless toggle between guided tasks and presentation slides without losing task answers or slide position. Header provides quick-switch pills (`[Tasks] [Slides]`) and a full-screen slide launcher. |
| **Right Pane** | **Development & Practice Tools** | • **`VS Code` Tab**: Embedded `code-server` with integrated terminal pre-activated in `/workspace`.<br>• **`JupyterLab` Tab**: Embedded JupyterLab 4.x computational notebook workspace.<br>• **`Browser` Tab**: Preinstalled containerized Chromium browser with persistent profile via noVNC/websockify (`/browser/vnc.html`).<br>• **`Excalidraw` Tab**: Dedicated official open-source Excalidraw diagramming workspace (`/excalidraw/`) with theme synchronization. | Persistent tab strip. Retains iframe DOM nodes across tab switches to preserve editor buffers, running terminals, and notebook execution state without reloads. Direct external link button (`↗`) allows opening tools in separate windows. |

### 7.2 Global Navigation & Unslop Header Controls

The top global navigation bar follows strict Unslop minimalist design principles (Inter and JetBrains Mono typography, zero generic gradients, clean spacing, no duplicate buttons):
1. **Brand & Status:** `⚡ RAG Studio v4.0` logo, real-time Hub connection indicator badge (`Hub Ready` / `Degraded` / `Disconnected`), and Module selection dropdown (`Module 1` through `Module 6`).
2. **Context-Aware Immersive Focus Mode (`#btn-focus-toggle`):**
   - Maximizes whichever pane (Left or Right) is currently active to 100vw × 100vh.
   - **Immersive Header Hiding:** Completely hides `.app-header` (`display: none !important`) to eliminate distractions.
   - **Escape Affordance:** Displays floating pill `#floating-focus-pill` (`⛶ Press Esc to Exit Focus`) and listens for the `Esc` keyboard key to instantly restore the dual-pane split view.
3. **Teaching & Annotation Suite (`#btn-annotate-menu`):**
   - **iPad-Style Laser Pointer:** Glowing neon laser beam with ~2-second decaying dissolution trail that persists while sketching, then gracefully dissolves. Operates across all windows (VS Code, Jupyter, Slides) by intercepting pointer events.
   - **Smooth Screen Pen & Highlighter:** Freehand drawing with quadratic Bézier curve smoothing, semi-transparent highlighter, eraser, color palette, stroke sizes, undo, and clear all.
4. **Utility Actions:**
   - **`🌙 / ☀️ Theme Toggle`:** Instant transition between dark and light themes, automatically broadcasted via `postMessage` to child iframes (Slides and Excalidraw).
   - **`⇄ Swap Panes`:** Inverts the left and right pane layout.
   - **`⛶ Fullscreen`:** Standard window/browser Fullscreen API toggle.
   - **`⏱ Session Timer`:** Non-destructive countdown timer with pause/resume.
   - **`💾 Progress Manager`:** One-click JSON import and export for verification progress.

### 7.3 Dedicated Excalidraw Whiteboard Specification

The Right Pane embeds official open-source Excalidraw (`/excalidraw/index.html`):
- **Full Excalidraw Toolset:** Hand-drawn boxes, circles, arrows, mindmaps, text labels, stickies, and freehand pens.
- **Theme Awareness:** Synchronized with the shell's active theme via window `message` events (`SET_THEME`).
- **External Window Link:** Direct header link (`↗`) opens Excalidraw in a dedicated browser tab.
- **Local Persistence:** Retains learner drawings locally across sessions using browser storage.

### 7.4 Live Screen Annotation & Laser Pointer Overlay

A root-level viewport canvas (`#screen-annotation-canvas`) spans the entire display:
- **Iframe Event Capture:** While annotations are active, the canvas wrapper employs `pointer-events: auto` to capture all pointer events before they sink into child iframes (VS Code, JupyterLab, Slides).
- **iPad Laser Engine:**
  - Cursor tracking displays a glowing pointer beacon dot.
  - Dragging/drawing records timestamps for each coordinate point `{ x, y, time }`.
  - In the 60fps animation loop, points fade out over a 2000ms decay window (`alpha = 1 - age / 2000`).
  - Renders dual-pass neon glow (outer blurred colored aura + inner intense white laser core).
- **Bézier-Curve Line Smoothing:**
  - For freehand pen and highlighter, points are smoothed using quadratic Bézier curves through calculated segment midpoints (`ctx.quadraticCurveTo(p1.x, p1.y, midX, midY)`).
  - Highlighter applies a translucent layer (`alpha: 0.35`) with increased stroke width (`size * 4.5`).
- **Dismissal:** Pressing `Esc` or clicking the toolbar close button (`✕`) immediately restores standard click-through interactions.

## 8. Reveal.js and Three.js integration

### 8.1 Curriculum and mathematical accuracy

The eight slides mirror the 6 core curriculum modules and notebook progression:
1. **Slide 1 (Foundation):** *RAG Architecture Overview* — Ingestion Pipeline vs Query Pipeline, Naive RAG bottlenecks vs Production Grounded RAG.
2. **Slide 2 (Module 1 / Notebook 00):** *The Vocabulary Mismatch Problem* — Why BM25/lexical matching fails on synonyms ("telecommuting" vs "distributed workforce"); interactive query comparator.
3. **Slide 3 (Module 2 / Notebook 01):** *Document Chunking Strategies* — Fixed-length vs Recursive splitting; separator hierarchies (`\n\n`, `\n`, `. `, ` `); preserving boundary context via overlap.
4. **Slide 4 (Module 3 / Notebook 02):** *Dense Vector Embeddings & Math* — MiniLM 384 dimensions, L2 normalization, dot product, and cosine similarity formula.
5. **Slide 5 (Interactive 3D):** *Interactive 3D Vector Space* — Three.js WebGL scene with PCA-projected sentence vectors, cluster visualization, and dual-dimension inspector (3D projected angle vs true 384-d cosine similarity).
6. **Slide 6 (Module 4 / Notebook 03):** *Vector Databases & HNSW Indexing* — Approximate Nearest Neighbor (ANN) search, Hierarchical Navigable Small World layers, cosine space vs Euclidean.
7. **Slide 7 (Module 5 / Notebook 04):** *Grounded Prompt Assembly & Citations* — Context injection, citation tracking (`[doc_001.txt#c03]`), eliminating hallucinations via prompt grounding.
8. **Slide 8 (Module 6 / Notebook 05):** *Production API Preview & Microservices* — FastAPI serving, OpenAPI docs (`/preview/8000/docs`), latency budgets, and end-to-end evaluation.

Precompute the word/sentence embeddings with the same pinned local model as the labs. Include king/queen/man/woman, remote-work synonyms and bread/pastry distractors. Store original 384-dimensional vectors, their norms, 3D projection coordinates, model/corpus hashes and projection method/parameters. An analogy is an experiment, not a guaranteed property of MiniLM; do not manufacture a “queen” result or an unsupported similarity score. Embeddings may reflect training-data bias.

The true cosine inspector uses original vectors:

```text
s = dot(u, v) / (norm(u) * norm(v))
s = clamp(s, -1, 1)
angle_degrees = acos(s) * 180 / pi
```

Reject zero-length/non-finite vectors. Label a separately displayed angle between projected 3D arrows as **projected angle**; PCA/t-SNE/UMAP and 3D truncation do not preserve all original angles/distances. A chord joining point tips is not the vector angle; draw arrows from a common origin and a labeled arc for geometric demonstrations. Do not call approximate HNSW search unconditionally O(log N) or exact nearest-neighbor search; describe its empirical efficiency/recall tradeoff.

### 8.2 Exact focus and input boundary

Use `OrbitControls(camera, renderer.domElement)` inside a focusable `.vector-widget` wrapper marked `data-prevent-swipe`. Canvas has `tabindex="0"`, an accessible name, adjacent instructions and CSS `touch-action: none; overscroll-behavior: contain`. Provide explicit Rotate/Zoom/Reset and point-selection controls for keyboard/screen-reader users.

Initialize Reveal with `embedded: true`, `mouseWheel: false`, `autoSlide: 0` and a `keyboardCondition(event)` that returns false while focus/event target is within the widget or one of its controls. Outside the widget it returns true for normal slide navigation. Keep visible previous/next buttons. Use `data-prevent-swipe` for the widget and scoped touch propagation suppression; do not disable all deck interaction globally. [Reveal configuration](https://revealjs.com/config/), [touch navigation](https://revealjs.com/touch-navigation/).

The input adapter follows this ordering and behavior:

1. Construct OrbitControls first. Call `controls.listenToKeyEvents(canvas)`, never `window`/`document`. Keep arrow-key panning local to the focused canvas; toolbar buttons provide rotation. Then attach **bubble-phase** suppression listeners on the wrapper. A capture listener that stops the event before it reaches canvas would break OrbitControls.
2. On canvas `pointerdown`, focus the canvas with `{preventScroll: true}` and record pointer ID/start position. Let OrbitControls own pointer capture and drag handlers in the locked release. If a custom picking control owns capture instead, it must explicitly call `setPointerCapture` and release it on completion; do not have competing capture owners.
3. Stop propagation for `pointerdown/move/up/cancel`, `lostpointercapture`, `mousedown/move/up`, `click`, `dblclick`, `contextmenu`, `touchstart/move/end/cancel` and `wheel` at the widget boundary. Do not use `stopImmediatePropagation`, which can suppress same-target OrbitControls callbacks. Register wheel/touch listeners that cancel defaults with `{passive:false}`. Prevent default for canvas wheel, canvas touch gestures and contextmenu; do not cancel clicks/default actions of adjacent accessible buttons or text inputs.
4. On pointer-up, select a raycast point only if movement stayed below 5 CSS pixels, primary button was used and no multi-touch gesture occurred. Dragging, pinch, pointer cancellation or lost capture must never select a point or advance a slide. Compute pointer coordinates from the current canvas bounding rectangle after each resize.
5. Stop `keydown` and `keyup` propagation from the whole widget. For the canvas, prevent default for Arrow keys, Space, PageUp/PageDown, Home/End and Enter when the widget owns those actions. OrbitControls receives its keys first. Do not cancel Tab/Shift+Tab, and preserve native button activation/text-input keys. The Reveal `keyboardCondition` is an independent guard if listener order changes.
6. Escape while inside the widget cancels selection/drag state and moves focus to a dedicated focusable deck-navigation element outside the widget; prevent and stop that Escape so it does not also toggle overview. Tab naturally leaves the widget without a trap. Key handling in the slides frame must not capture keys from other tool frames.
7. On `pointercancel`, `lostpointercapture`, window blur, hidden document, slide departure or mode hiding, clear drag state, stop input capture and cancel pending gestures. On return, restore stored camera/selection deliberately; do not reset them on every slide transition. An explicit Reset button restores the saved initial camera.

**Pointer lock is not required for OrbitControls.** Never automatically call `requestPointerLock` or trap the mouse. Pointer capture keeps an active drag coherent without hiding the pointer. Any future first-person mode would require a separate explicit opt-in and Escape/unlock handling. [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html).

A minimal event-isolation pattern (complete interaction/picking logic still follows the requirements above):

```javascript
const widget = document.querySelector('.vector-widget');
const canvas = widget.querySelector('canvas');
const deckNavigation = document.querySelector('.deck-navigation');
const controls = new OrbitControls(camera, canvas);
controls.listenToKeyEvents(canvas);
canvas.tabIndex = 0;
canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }));

await Reveal.initialize({
  embedded: true,
  mouseWheel: false,
  autoSlide: 0,
  keyboardCondition: event => !widget.contains(document.activeElement) &&
    !widget.contains(event.target)
});

for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel',
  'lostpointercapture', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick']) {
  widget.addEventListener(type, event => event.stopPropagation());
}
for (const type of ['wheel', 'touchstart', 'touchmove', 'touchend',
  'touchcancel', 'contextmenu']) {
  widget.addEventListener(type, event => {
    event.stopPropagation();
    if (event.target === canvas && event.cancelable) event.preventDefault();
  }, { passive: false });
}
const canvasKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  ' ', 'PageUp', 'PageDown', 'Home', 'End', 'Enter']);
for (const type of ['keydown', 'keyup']) {
  widget.addEventListener(type, event => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      // Also cancel the application's selection/drag state here.
      if (type === 'keydown') deckNavigation.focus({ preventScroll: true });
    } else if (event.target === canvas && canvasKeys.has(event.key)) {
      event.preventDefault();
    }
  });
}
```

### 8.3 Rendering and fallback

Keep one renderer/scene for the deck. Render on interaction/change or a bounded animation loop only while the relevant slide/pane is visible; stop `requestAnimationFrame` when hidden. Cap pixel ratio at `min(devicePixelRatio, 1.5)`, use a small point count, avoid shadows/post-processing and dispose geometries/materials/listeners on final teardown. `ResizeObserver` updates canvas drawing size, camera aspect and projection after pane resizing; skip zero-sized canvases.

WebGL runs on the **client**, not in the container. Software/disabled GPU, remote desktops and browser policy can still prevent it. Catch creation/context-loss failures, pause rendering, and show a locally bundled 2D/static diagram plus keyboard-accessible word selectors, similarity table and the same original-vector calculations. Do not block lesson completion on 3D availability. Restore a lost context when supported without reloading the entire workspace. Respect reduced-motion preferences and avoid continuous spin by default.

## 9. Full-stack preview and port-8000 recovery

The preview pane opens `/preview/8000/`, and its API inspector makes same-origin fetch requests to that prefix with explicit method, JSON body, status, response and a bounded timeout. Never concatenate arbitrary user-entered URLs into a general-purpose backend proxy. Only port 8000 is supported initially; additional ports require explicit routing/configuration and tests.

The provided FastAPI app binds loopback **inside the container** and uses a proxy-aware ASGI root path:

```bash
python -m uvicorn labs.api_app:app --app-dir /workspace \
  --host 127.0.0.1 --port 8000 --workers 1 \
  --proxy-headers --forwarded-allow-ips 127.0.0.1 \
  --root-path /preview/8000
```

Nginx strips `/preview/8000/`; application routes remain `/health`, `/query`, `/docs`, `/openapi.json`. The supplied docs page serves bundled Swagger assets and builds the OpenAPI URL using ASGI `root_path`. Verify Try-it-out requests and redirects through the gateway. Static assets, JS fetches and WebSocket URLs must respect the prefix; an absolute `/assets/...` or `/ws` from arbitrary student HTML will bypass it. Build frontend URLs from the deployment base; do not attempt blind HTML substitution in Nginx. [FastAPI proxy/root-path guidance](https://fastapi.tiangolo.com/advanced/behind-a-proxy/).

If a learner types `http://localhost:8000` into the preview address bar, explain that it addresses the host and offer the equivalent gateway path. Do not silently rewrite unrelated/external URLs. In a cloud session the laptop's localhost cannot reach the sandbox. Opening an extension's embedded browser does not create a listener or publish a port.

Provide these recovery instructions in the lesson and preview error state:

1. Keep the API terminal running. In the container terminal run `curl -fsS http://127.0.0.1:8000/health`. Connection refused means the application is stopped, crashed, listening on another port/interface, or failed to import; inspect terminal output.
2. Run `curl -fsS http://127.0.0.1:8080/preview/8000/health`. If direct health succeeds but proxy fails, inspect prefix/routing. Gateway 502/504 means unavailable/timed-out upstream; 404 usually means wrong application path. Preserve HTTP error codes; the shell shows a friendly error and retry button.
3. Open the current hub origin plus `/preview/8000/docs`. A blank frame with a successful direct endpoint calls for checking CSP/X-Frame-Options, browser console, assets and WebSocket URLs. Provide an “Open preview directly” link on the same origin; do not remove security headers from third-party sites to frame them.
4. Killercoda users keep using the port-8080 launch URL. No extra port is needed. A separate port-8000 provider URL is an optional provider feature, not a baseline requirement.
5. Advanced local direct exposure requires recreating the container with `-p 127.0.0.1:8000:8000`, binding Uvicorn to `0.0.0.0` **inside the container**, and clearing `--root-path` for direct mode. Preserve the existing workspace volume. Docker cannot add a published port to an already running container; avoid this detour in the normal course.

Flask and Streamlit need their own documented prefix settings and WebSocket checks. They are not automatically compatible because FastAPI is compatible. The optional code-server port proxy has different rewrite semantics and must not become a second undocumented preview path.

## 10. Native Electron client

### 10.1 Packaging and connection behavior

`desktop-app/` builds host-native installers in CI, with exact dependency locks and a supported Electron version. Learners install/run the DMG, signed EXE or Linux package/bundle; `npm install && npm start` is a developer workflow only. Sign/notarize releases, publish checksums and use signed updates if an update channel is implemented. Verify installation and launch with no Node/Python/FUSE preinstalled on test hosts where applicable.

Default connection: `http://localhost:8080`. A local connection screen offers retry, a copyable Docker command, health state and editing the hub URL. Support another loopback port or an explicitly entered HTTPS remote origin. Parse URLs using `new URL`; allow only HTTP loopback or HTTPS, reject credentials and non-root paths, normalize exact origins and do not accept remote HTTP. Never use a string-prefix origin test. Settings persist in app userData; do not store remote auth secrets in the course workspace.

The connection screen is a bundled local page with a restrictive CSP. Its optional preload exposes only validated connection/settings operations, with sender/frame checks. Load the remote hub in a separate BrowserWindow/WebContents with **no preload or Node bridge**. Remote HTML is untrusted to the host. The hub can execute student Python inside the container but cannot invoke host shell commands through Electron.

Poll hub health with bounded backoff, timeout and a visible retry path. If authentication redirects require login, open only the explicitly configured provider authentication flow; do not scrape credentials or import browser cookies. Browser access remains the fallback for provider SSO that disallows embedded clients. Network failures show the connection UI rather than a permanently blank window.

### 10.2 Input and security requirements

Use `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true`, `allowRunningInsecureContent:false`, `webviewTag:false`. Do not use a privileged `<webview>`, disable site isolation, or add certificate-error overrides. Deny camera/microphone/geolocation/device permissions by default; any supported clipboard/download capability is narrowly scoped to the configured hub and initiated by the learner. Downloads require a user-chosen destination. [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

Remove Close Window, New Window, Print and other menu accelerators that conflict with tools. Retain accessible native app/Edit menus where required, including macOS copy/paste roles and Quit. Do not register global shortcuts. Avoid cancelling Ctrl/Cmd+W/P/N/Shift+P in `before-input-event`: cancelling there also prevents the page's key events. OS-reserved shortcuts and IME behavior remain platform-dependent. [Electron input semantics](https://www.electronjs.org/docs/latest/api/web-contents#event-before-input-event).

```javascript
// Attach after constructing the secure BrowserWindow and custom menu.
mainWindow.webContents.on('before-input-event', (event, input) => {
  const key = input.key.toLowerCase();
  const editorShortcut = (input.control || input.meta) &&
    ['w', 'p', 'n'].includes(key);
  mainWindow.webContents.setIgnoreMenuShortcuts(editorShortcut);
  // Do not preventDefault for editorShortcut: the focused frame needs the event.
  if (input.type === 'keyDown' && !input.isAutoRepeat && input.key === 'F11') {
    event.preventDefault();
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});
```

The full lifecycle includes macOS `activate` window recreation, load failures, renderer crash recovery, normal close/quit and unsaved-edit handling. Do not assume the main frame's beforeunload automatically accounts for every editor iframe; test and provide a visible close confirmation if necessary. A key event in the IDE must reach that focused frame exactly once; do not synthesize duplicate key events.

For navigation and popups:

- Deny new windows by default with `setWindowOpenHandler`. For an approved same-origin tool link, create a controlled BrowserWindow with identical sandbox/navigation policies, or open the OS browser on explicit learner action.
- Validate external links with URL parsing; allow only http/https documentation links from explicit learner actions, using a confirmation for a previously unapproved external destination. Block file, javascript, data, custom shell protocols and deceptive prefix matches such as `localhost:8080.evil.example`.
- Guard top-level navigation **and redirects**, while allowing legitimate same-origin tool navigation. A main-frame guard alone does not secure every frame: apply protocol/origin rules to subframe navigation too, permitting only code-server/Jupyter-required, tested blob/about/webview resource cases. Do not allow arbitrary remote frames merely because their parent is the hub.
- Remote authentication destinations require an explicit allowlist separate from the hub origin. Avoid blanket `shell.openExternal(url)` for any popup. None of these flows can access an IPC host shell API.

The desktop guarantees tested editor shortcut behavior, not immunity to every OS or extension issue. Both browser and desktop expose the same five modes and task content.

## 11. Build and learner launch contracts

Implement and publish the image/package artifacts before distributing course commands. `rag-studio:4.0.1` below is the local release tag; the published registry reference and digest come from the release manifest. CI performs native builds and release publication, not students on Killercoda.

Default local command, valid as one line in Bash, zsh, PowerShell and cmd:

```text
docker run -d --name rag-studio --cpus=2 --memory=3g --stop-timeout=15 -p 127.0.0.1:8080:8080 -v rag-studio-workspace:/workspace -v rag-studio-user:/home/coder rag-studio:4.0.1
```

Open `http://localhost:8080` or launch the desktop application. Save the volume names in the connection screen/instructions. `docker stop rag-studio` and `docker start rag-studio` preserve work. Do not use `--rm` as the default learner lifecycle; never remove volumes during routine troubleshooting. Provide explicit export/backup instructions using the IDE download UI and optionally `docker cp rag-studio:/workspace ./rag-studio-backup` from the host.

If 8080 is busy, recreate with a different host port, e.g. `-p 127.0.0.1:18080:8080 -e RAG_PUBLIC_ORIGIN=http://localhost:18080`, retaining volume names. Configuration generation adds that validated authority; native client connection settings must match. This is the only allowed non-HTTPS `RAG_PUBLIC_ORIGIN` case: an explicit loopback origin.

For a provider-isolated sandbox, replace only port publication with `-p 8080:8080` and set `RAG_PUBLIC_ORIGIN` to its actual HTTPS launch origin; follow the remote authentication/ingress contract. Do not reuse that exposure command on a public VM without protected ingress.

Developer-only build commands are documented separately:

```bash
docker build -t rag-studio:4.0.1 .
# Release CI uses native amd64 + arm64 builders and publishes a manifest.
# Desktop CI runs the locked package build on macOS, Windows and Linux.
```

`.dockerignore` excludes archives, node_modules, VCS data, generated databases and local outputs. Do not send the archived Electron node_modules into every container build. The container exposes no Docker socket and requires no host networking, privileged mode, display mounts or host Python/Node installations.

## 12. Verification design and release gates

### 12.1 Full environment verifier

`python /workspace/labs/verify_rag.py --json` is independent of the cheap readiness check. Run manually and in CI, with a temporary working directory and isolated Chroma database. Each check produces PASS/FAIL/SKIP with details and timing; any required failure returns nonzero. If embedding loading fails, dependent vector checks are SKIP with that cause, not an undefined-variable exception. Do not label warnings as passes.

Required checks: exact Python 3.11; executable/kernel agreement; imports and dependency consistency; finite CPU tensors (`device.type == "cpu"`, no installed CUDA build dependency, not merely `cuda.is_available()==False`); local offline model loading and 384 dimensions; normalized embeddings; canonical splitter behavior; insert/query/update/persist/reopen a cosine Chroma collection; stable IDs and count on rerun; writable workspace; JSON report schema. Kernel execution is an integration check using the registered kernelspec, not simply inspecting its display name.

Separate CI notebook runs execute **solutions** in fresh kernels. Student starter notebooks intentionally contain TODOs and are validated structurally, not falsely required to pass solved-lab assertions. CLI and notebook reference runs must produce equivalent canonical metrics on each architecture. Test scripts from a different working directory and notebooks from their own folder.

### 12.2 Mandatory acceptance matrix

| Area | Required tests / pass criteria |
|---|---|
| Clean installs | Supported Windows x64, Intel/Apple Silicon macOS, tested Linux X11/Wayland baselines; no host Node/Python/compiler; Linux FUSE-unavailable launch path |
| Native images | amd64 and arm64 native execution; no SIGILL, unintended emulation or CUDA libraries; model, Chroma, kernels and lessons pass |
| Browser clients | Current stable Chrome, Edge, Firefox and Safari at release; record exact versions; local and remote HTTPS; Safari tested on actual macOS, not just Playwright WebKit |
| Gateway paths | Slash redirects/query strings; assets and MIME; IDE terminal WS and Jupyter kernel WS 101 plus traffic; uploads, save, rename, restart; no internal-port redirects or mixed content |
| Authentication/security | Local Host rejection; remote ingress protects all paths/WS; unauthorized mutation without XSRF fails; foreign Origin fails; allowed same-origin operations succeed; CSP ancestor policies verified including tool errors |
| Provider framing | Top-level Killercoda launch; optional framed case with full ancestor chain and default cookie restrictions; clear top-level fallback, no wildcard relaxation |
| Desktop keys | Ctrl/Cmd+W closes editor tab, P Quick Open, Shift+P palette, N new file where supported; test focused IDE/notebook, copy/paste, IME, F11 once per keypress, app close and macOS reopen |
| UI state | Five modes, swap, focus/restore and resize without iframe reload/data loss; persistence/export/import; disconnect/retry; accessible keyboard splitter and task controls |
| Interactive deck | Drag, wheel, pinch, point click, arrows/Space, Tab and Escape keep slide index unchanged within widget; outside navigation works; cancel/blur handling; repeated transitions do not leak WebGL contexts |
| No WebGL | Context unavailable/lost, reduced motion and low-end GPU all retain cosine lesson and task completion |
| API preview | No server gives actionable 502 state; start/retry works; docs/assets/OpenAPI/Try-it-out use prefix offline; JSON/SSE/WebSocket if included; wrong port recovery and no arbitrary proxy |
| Offline operation | Disable outbound egress after image pull while preserving client gateway access; every core tool/lesson/model/slide/docs asset works; no runtime downloads |
| Startup and failure | Slow startup within deadline; 404/500/redirect/invalid JSON do not mark ready; missing model/permission failure aborts; kill each service; watchdog failure; readiness clears and exit is nonzero |
| Shutdown/persistence | TERM during each startup phase and during active kernel; stop within 15 seconds; no orphaned child groups; restart retains edited notebooks, scripts, settings and DB data |
| Resources | Two CPUs, 3-GiB container cap on 4-GiB host, no OOM; measured idle/peak budgets; repeated mode transitions; cold and warm latency recorded |
| Curriculum | Schema/path/cell/step integrity, DAG, generated expectations, corpus hash, notebook/script parity, numeric edge cases, MCQ IDs, reruns and isolated stores |

Use unit checks for pure task validation/config generation and integration/browser/desktop checks for process boundaries and real input behavior. Do not substitute static text inspection for runtime compatibility. Include a 60-minute representative workshop soak with one heavy workload at a time, service reconnects and progress retention.

### 12.3 Completion definition

Release v4.0.1 only after the implementation tree, immutable locks, native images, packaged clients, offline fixtures, learner recovery instructions and the matrix above exist with recorded results. A failing platform gate either blocks release or narrows the published support matrix explicitly; it is never hidden behind “works on any OS.” This specification removes known architectural contradictions and defines the work needed for a reproducible implementation; it does not certify unbuilt artifacts.

### 12.4 Checks performed during this specification audit

On 2026-11-06, the embedded Bash/JavaScript examples passed syntax checks, Python examples compiled, and the example task JSON parsed. The reference Nginx configuration passed `nginx -t` as UID 1000 in the available archived v2 image. Isolated mock-upstream checks exercised prefix stripping/preservation, full Host forwarding, WebSocket upgrade-header forwarding, rejection of a spoofed forwarded scheme, query-preserving redirects, readiness 503/200 behavior, no-store/CSP headers, unsupported preview paths and foreign Host rejection.

In the available archived v1 image (JupyterLab 4.3.1 / Jupyter Server 2.21.1), the specified base URL and token-free/XSRF-enabled settings supported page loading, rejected a modifying request without XSRF, and accepted file create/save/delete and kernel start/execution/shutdown. This isolated legacy-image harness enabled root execution solely because that archive runs as root; the v4 runtime remains non-root. These checks did not exercise Jupyter through Nginx, real browser WebSockets, desktop packaging, the revised dependency locks or cross-platform resource budgets. Those remain implementation release gates above.
