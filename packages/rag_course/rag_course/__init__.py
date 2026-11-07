"""
rag_course package
==================
Shared inputs, paths, model loader, and exercise verification helpers.
"""

from .config import (
    get_workspace_dir,
    get_data_dir,
    get_raw_data_dir,
    get_policies_dir,
    get_chroma_dir,
)
from .loader import get_model
from .metrics import (
    cosine_similarity,
    cosine_distance,
    compute_input_hash,
    generate_step_result,
    output_step_json,
)

__all__ = [
    "get_workspace_dir",
    "get_data_dir",
    "get_raw_data_dir",
    "get_policies_dir",
    "get_chroma_dir",
    "get_model",
    "cosine_similarity",
    "cosine_distance",
    "compute_input_hash",
    "generate_step_result",
    "output_step_json",
]
