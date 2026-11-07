"""
rag_course.loader — Safe, deterministic embedding model loader
==============================================================
Loads the pinned sentence-transformers/all-MiniLM-L6-v2 model strictly on CPU
using baked offline assets. Enforces 1-thread execution per specification budget.
"""

import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

# Enforce thread limits and offline flags before importing torch/transformers
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

CANONICAL_MODEL_DIR = "/opt/hf_cache/models/all-MiniLM-L6-v2"
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"


def _configure_cpu_threads():
    """Sets CPU thread pool to 1 for deterministic evaluation and memory safety."""
    try:
        import torch
        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
    except ImportError:
        pass


@lru_cache(maxsize=1)
def get_model(model_path_or_name: Optional[str] = None):
    """
    Returns cached SentenceTransformer model instance on CPU.
    Tries loading in order:
    1. Explicit argument if provided
    2. os.environ["RAG_MODEL_PATH"]
    3. Baked container path /opt/hf_cache/models/all-MiniLM-L6-v2
    4. Local huggingface cache snapshots if found
    5. Fallback with sentence-transformers/all-MiniLM-L6-v2
    """
    _configure_cpu_threads()
    from sentence_transformers import SentenceTransformer

    candidate_path = model_path_or_name or os.environ.get("RAG_MODEL_PATH")

    # 1. If explicit path or env var is valid existing path
    if candidate_path and Path(candidate_path).exists():
        return SentenceTransformer(candidate_path, device="cpu", local_files_only=True)

    # 2. Check canonical baked image path
    if Path(CANONICAL_MODEL_DIR).exists():
        return SentenceTransformer(CANONICAL_MODEL_DIR, device="cpu", local_files_only=True)

    # 3. Check for snapshot directory in user cache (useful in local dev / CI before container build)
    user_hub_cache = Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface")) / "hub"
    model_hub_dir = user_hub_cache / "models--sentence-transformers--all-MiniLM-L6-v2" / "snapshots"
    if model_hub_dir.exists():
        snapshots = list(model_hub_dir.glob("*"))
        if snapshots:
            return SentenceTransformer(str(snapshots[0]), device="cpu", local_files_only=True)

    # 4. Standard loader with local_files_only=True
    try:
        return SentenceTransformer(candidate_path or MODEL_NAME, device="cpu", local_files_only=True)
    except Exception:
        # Final fallback allowing download if not yet cached in development
        return SentenceTransformer(candidate_path or MODEL_NAME, device="cpu", local_files_only=False)
