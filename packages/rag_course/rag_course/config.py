"""
rag_course.config — Workspace paths and environment configuration
================================================================
Provides deterministic path resolution for the course, whether running
inside Docker at /workspace, in a Jupyter notebook at /workspace/notebooks,
or in a local development environment.
"""

import os
from pathlib import Path


def get_workspace_dir() -> Path:
    """
    Resolves the canonical workspace directory.
    Checks in order:
    1. RAG_WORKSPACE environment variable
    2. Baked Docker container mount /workspace
    3. Package parent directory (workspace root containing rag_course)
    4. Current working directory or subfolder
    """
    env_ws = os.environ.get("RAG_WORKSPACE")
    if env_ws:
        p = Path(env_ws).resolve()
        if p.exists():
            return p

    docker_ws = Path("/workspace")
    if docker_ws.exists() and (docker_ws / "data").exists():
        return docker_ws.resolve()

    # Package root (parent of rag_course)
    pkg_parent = Path(__file__).resolve().parent.parent
    if (pkg_parent / "data").exists():
        return pkg_parent

    cwd = Path.cwd().resolve()
    if (cwd / "data").exists():
        return cwd
    if (cwd / "workspace" / "data").exists():
        return (cwd / "workspace").resolve()

    # Fallback to docker_ws if in docker even if data not yet seeded, else pkg_parent
    if docker_ws.exists():
        return docker_ws.resolve()
    return pkg_parent


def get_data_dir() -> Path:
    """Returns path to the workspace/data directory."""
    return get_workspace_dir() / "data"


def get_raw_data_dir() -> Path:
    """Returns path to the workspace/data/raw directory containing canonical articles."""
    return get_data_dir() / "raw"


def get_policies_dir() -> Path:
    """Returns path to workspace/data/policies containing policy fixtures."""
    return get_data_dir() / "policies"


def get_chroma_dir(track: str = "scripts") -> Path:
    """
    Returns isolated ChromaDB storage directory for the given track ('scripts' or 'notebooks').
    Ensures that script runs and notebook kernels do not concurrently corrupt the same embedded store.
    """
    chroma_path = get_data_dir() / "chroma_db" / track
    chroma_path.mkdir(parents=True, exist_ok=True)
    return chroma_path
