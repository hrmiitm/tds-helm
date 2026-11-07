# jupyter_server_config.py — RAG Studio v4.0 Jupyter Server Configuration
# Reference: spec.md Section 3.3
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
c.ServerApp.allow_remote_access = False
c.ServerApp.local_hostnames = ["localhost", "127.0.0.1"]
c.IdentityProvider.token = ""
c.PasswordIdentityProvider.hashed_password = ""
c.ServerApp.allow_origin = "*"
c.ServerApp.allow_origin_pat = ".*"
c.ServerApp.disable_check_xsrf = True

# Framing Header (Allows embedding by the same-origin studio-web shell)
c.ServerApp.tornado_settings = {
    "headers": {
        "Content-Security-Policy": "frame-ancestors 'self'"
    }
}

# Kernel Resource Lifecycle Management (spec Section 3.3 & 5.3)
c.MappingKernelManager.cull_idle_timeout = 1800
c.MappingKernelManager.cull_interval = 60
c.MappingKernelManager.cull_connected = False
c.MappingKernelManager.cull_busy = False

