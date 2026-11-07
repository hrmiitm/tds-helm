#!/usr/bin/env python3
"""
render_config.py — Studio Universal v4.2 Dynamic Configuration Renderer
Generates runtime configurations into /tmp/rag-config/ based on environment variables:
  - RAG_PUBLIC_ORIGIN: e.g. "http://localhost:8080" or "https://hub.example.com"
  - RAG_FRAME_ANCESTORS: e.g. "'self' https://learning-platform.example.com"
  - RAG_ALLOWED_HOSTS: optional comma-separated list of allowed host authorities

Outputs:
  - /tmp/rag-config/nginx.conf
  - /tmp/rag-config/jupyter_server_config.py
"""

import os
import sys
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

def sanitize_header_value(val: str) -> str:
    """Strip carriage returns, newlines, and semicolons to prevent Nginx configuration injection."""
    if not val:
        return ""
    # Strip dangerous characters
    cleaned = re.sub(r"[\r\n;]", " ", val).strip()
    return cleaned

def main():
    os.makedirs("/tmp/rag-config", exist_ok=True)
    os.makedirs("/tmp/rag-health", exist_ok=True)
    for p in ["client", "proxy", "fastcgi", "uwsgi", "scgi"]:
        os.makedirs(f"/tmp/nginx/{p}", exist_ok=True)

    raw_public_origin = os.environ.get("RAG_PUBLIC_ORIGIN", "").strip()
    raw_frame_ancestors = os.environ.get("RAG_FRAME_ANCESTORS", "'self'").strip()
    raw_extra_allowed = os.environ.get("RAG_ALLOWED_HOSTS", "").strip()

    public_origin = sanitize_header_value(raw_public_origin)
    frame_ancestors = sanitize_header_value(raw_frame_ancestors) or "'self'"
    extra_allowed = sanitize_header_value(raw_extra_allowed)

    # Determine allowed hosts and public schemes
    allowed_hosts = {
        "~^localhost(:[0-9]+)?$",
        "~^127\\.0\\.0\\.1(:[0-9]+)?$",
        "~^\\[::1\\](:[0-9]+)?$",
        "localhost:8080",
        "127.0.0.1:8080",
        "localhost",
        "127.0.0.1",
        "[::1]:8080",
        "[::1]",
    }
    public_schemes = {}
    jupyter_hostnames = {"localhost", "127.0.0.1"}

    if public_origin:
        parsed = urlsplit(public_origin)
        if not parsed.scheme or not parsed.netloc:
            print(f"[render_config] ERROR: Invalid RAG_PUBLIC_ORIGIN: {public_origin}", file=sys.stderr)
            sys.exit(1)
        if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1"):
            print(f"[render_config] WARNING: Remote origins should use HTTPS: {public_origin}", file=sys.stderr)
        
        allowed_hosts.add(parsed.netloc)
        public_schemes[parsed.netloc] = parsed.scheme
        if parsed.hostname:
            jupyter_hostnames.add(parsed.hostname)
            # If origin has no explicit port, also permit standard HTTP/HTTPS ports
            if ":" not in parsed.netloc:
                allowed_hosts.add(f"{parsed.netloc}:80")
                allowed_hosts.add(f"{parsed.netloc}:443")

    if extra_allowed:
        for host in extra_allowed.split(","):
            host = host.strip()
            if host and re.match(r"^[a-zA-Z0-9.\-_:\[\]]+$", host):
                allowed_hosts.add(host)
                h_name = host.split(":")[0].strip("[]")
                jupyter_hostnames.add(h_name)

    is_remote = bool(public_origin or extra_allowed)
    allow_remote_str = "True" if is_remote else "False"

    # Format Nginx map entries
    allowed_host_entries = "\n".join(f"        {h} 1;" for h in sorted(allowed_hosts))
    scheme_entries = "\n".join(f"        {h} {scheme};" for h, scheme in sorted(public_schemes.items()))
    if not scheme_entries:
        scheme_entries = "        # default loopback only"

    nginx_content = f"""worker_processes 1;
pid /tmp/nginx.pid;
error_log /dev/stderr warn;

events {{
    worker_connections 512;
}}

http {{
    include /etc/nginx/mime.types;
    types {{
        text/yaml yaml yml;
        application/schema+json schema.json;
    }}
    default_type application/octet-stream;
    access_log /dev/stdout;
    sendfile on;
    keepalive_timeout 65;
    client_max_body_size 32m;

    # Temp paths for non-root execution (UID 1000)
    client_body_temp_path /tmp/nginx/client;
    proxy_temp_path /tmp/nginx/proxy;
    fastcgi_temp_path /tmp/nginx/fastcgi;
    uwsgi_temp_path /tmp/nginx/uwsgi;
    scgi_temp_path /tmp/nginx/scgi;

    map $http_upgrade $connection_upgrade {{
        default upgrade;
        '' close;
    }}

    map $http_host $rag_allowed_host {{
        default 0;
{allowed_host_entries}
    }}

    map $http_host $rag_public_scheme {{
        default http;
{scheme_entries}
    }}

    map $uri $rag_cache_control {{
        default "no-cache";
        ~^/health/ no-store;
        ~*\\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ "public, max-age=3600";
    }}

    server {{
        listen 8080 default_server;
        server_name _;

        if ($rag_allowed_host = 0) {{
            return 444;
        }}

        absolute_redirect off;
        root /usr/share/nginx/html;
        index index.html;

        # Standard Security & Framing Headers
        add_header Content-Security-Policy "frame-ancestors {frame_ancestors}" always;
        add_header X-Content-Type-Options nosniff always;
        add_header Referrer-Policy same-origin always;
        add_header Cache-Control $rag_cache_control always;

        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_set_header X-Forwarded-Proto $rag_public_scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_connect_timeout 5s;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;

        # Health endpoints
        location = /health/live {{
            default_type application/json;
            return 200 '{{"status":"live"}}';
        }}

        location = /health/ready {{
            alias /tmp/rag-health/ready.json;
            default_type application/json;
            error_page 404 =503 @not_ready;
        }}

        location @not_ready {{
            default_type application/json;
            return 503 '{{"status":"starting-or-unavailable"}}';
        }}

        location = /health/status.json {{
            alias /tmp/rag-health/status.json;
            default_type application/json;
        }}

        # Trailing slash redirects preserving arguments
        location = /vscode {{ return 308 /vscode/$is_args$args; }}
        location = /jupyter {{ return 308 /jupyter/$is_args$args; }}
        location = /slides {{ return 308 /slides/$is_args$args; }}
        location = /browser {{ return 308 /browser/$is_args$args; }}
        location = /excalidraw {{ return 308 /excalidraw/$is_args$args; }}
        location = /preview/8000 {{ return 308 /preview/8000/$is_args$args; }}

        # Course Catalog, Courses & Schemas
        location /catalog/ {{
            alias /usr/share/nginx/html/catalog/;
            default_type application/json;
        }}

        location /courses/ {{
            alias /usr/share/nginx/html/courses/;
        }}

        location /schemas/ {{
            alias /usr/share/nginx/html/schemas/;
            default_type application/json;
        }}

        # 1. VS Code proxy (prefix stripped)
        location /vscode/ {{
            proxy_set_header Host $http_host;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $rag_public_scheme;
            proxy_set_header X-Forwarded-Prefix /vscode;
            proxy_hide_header Content-Security-Policy;
            add_header Content-Security-Policy "frame-ancestors {frame_ancestors}" always;
            proxy_pass http://127.0.0.1:8081/;
        }}

        # Websockify fallback endpoint (for noVNC defaults)
        location /websockify {{
            proxy_pass http://127.0.0.1:6080/websockify;
            proxy_http_version 1.1;
            proxy_set_header Host $http_host;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_read_timeout 3600s;
        }}

        # 2. JupyterLab proxy (prefix preserved)
        location /jupyter/ {{
            proxy_pass http://127.0.0.1:8888;
        }}

        # 3. Chromium Browser proxy (noVNC + websockify)
        location /browser/ {{
            proxy_pass http://127.0.0.1:6080/;
            proxy_http_version 1.1;
            proxy_set_header Host $http_host;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_read_timeout 3600s;
        }}

        # 4. Reveal.js Slides with 3D Vector Space
        location /slides/ {{
            alias /usr/share/nginx/slides/;
            index index.html;
        }}

        # 5. Full-stack Preview for port 8000
        location /preview/8000/ {{
            proxy_set_header X-Forwarded-Prefix /preview/8000;
            proxy_pass http://127.0.0.1:8000/;
        }}

        location /preview/ {{
            default_type application/json;
            return 404 '{{"error":"unsupported-preview-port","supported":[8000]}}';
        }}

        # 6. Studio Controller API
        location /api/ {{
            proxy_pass http://127.0.0.1:8082/api/;
        }}

        # 6. Studio Web UI
        location / {{
            try_files $uri $uri/ =404;
        }}
    }}
}}
"""

    dest_nginx = Path("/tmp/rag-config/nginx.conf")
    dest_nginx.write_text(nginx_content, encoding="utf-8")
    print(f"[render_config] Rendered /tmp/rag-config/nginx.conf (allowed hosts: {len(allowed_hosts)})")

    # Render Jupyter Server Config (Safe JSON string serialization prevents Python code injection)
    jupyter_hostnames_repr = repr(sorted(list(jupyter_hostnames)))
    csp_header_json = json.dumps(f"frame-ancestors {frame_ancestors}")

    jupyter_content = f"""# jupyter_server_config.py — Studio Universal v4.2 Runtime Config
# Generated by scripts/render_config.py
c = get_config()

# General Server Settings
c.LabApp.extension_manager = "readonly"
c.ServerApp.ip = "127.0.0.1"
c.ServerApp.port = 8888
c.ServerApp.port_retries = 0
c.ServerApp.open_browser = False
c.ServerApp.root_dir = "/workspace"
c.ServerApp.base_url = "/jupyter/"
c.ServerApp.default_url = "/lab"

# Security & Origin Policies
c.ServerApp.trust_xheaders = True
c.ServerApp.allow_remote_access = {allow_remote_str}
c.ServerApp.local_hostnames = {jupyter_hostnames_repr}
c.IdentityProvider.token = ""
c.PasswordIdentityProvider.hashed_password = ""
c.ServerApp.allow_origin = "*"
c.ServerApp.allow_origin_pat = ".*"
c.ServerApp.disable_check_xsrf = True

# Framing Header
c.ServerApp.tornado_settings = {{
    "headers": {{
        "Content-Security-Policy": {csp_header_json}
    }}
}}

# Kernel Resource Lifecycle Management
c.MappingKernelManager.cull_idle_timeout = 1800
c.MappingKernelManager.cull_interval = 60
c.MappingKernelManager.cull_connected = False
c.MappingKernelManager.cull_busy = False
"""
    dest_jupyter = Path("/tmp/rag-config/jupyter_server_config.py")
    dest_jupyter.write_text(jupyter_content, encoding="utf-8")
    print(f"[render_config] Rendered /tmp/rag-config/jupyter_server_config.py")

if __name__ == "__main__":
    main()
