"""
rag_course.metrics — Vector metrics and canonical evaluation schema
===================================================================
Provides standard similarity and distance calculations, deterministic
input hashing, and the canonical step result JSON generator required
by spec.md Section 6.3.
"""

import hashlib
import json
import math
from typing import Any, Dict, Optional, Sequence, Union
import numpy as np


def cosine_similarity(
    u: Union[np.ndarray, Sequence[float]],
    v: Union[np.ndarray, Sequence[float]]
) -> float:
    """
    Computes standard cosine similarity between vectors u and v:
    s = dot(u, v) / (norm(u) * norm(v)), clamped to [-1.0, 1.0].
    """
    arr_u = np.asarray(u, dtype=float)
    arr_v = np.asarray(v, dtype=float)

    norm_u = float(np.linalg.norm(arr_u))
    norm_v = float(np.linalg.norm(arr_v))

    if norm_u == 0.0 or norm_v == 0.0 or not math.isfinite(norm_u) or not math.isfinite(norm_v):
        return 0.0

    dot = float(np.dot(arr_u, arr_v))
    similarity = dot / (norm_u * norm_v)
    return float(np.clip(similarity, -1.0, 1.0))


def cosine_distance(
    u: Union[np.ndarray, Sequence[float]],
    v: Union[np.ndarray, Sequence[float]]
) -> float:
    """
    Computes cosine distance: 1.0 - cosine_similarity(u, v).
    Smaller values indicate closer geometric orientation.
    """
    return float(1.0 - cosine_similarity(u, v))


def compute_input_hash(data: Union[str, bytes, Sequence[str], Dict[str, Any]]) -> str:
    """Computes a deterministic SHA-256 hex digest for exercise inputs."""
    hasher = hashlib.sha256()
    if isinstance(data, bytes):
        hasher.update(data)
    elif isinstance(data, str):
        hasher.update(data.encode("utf-8"))
    elif isinstance(data, (list, tuple)):
        for item in data:
            hasher.update(str(item).encode("utf-8"))
    elif isinstance(data, dict):
        hasher.update(json.dumps(data, sort_keys=True).encode("utf-8"))
    else:
        hasher.update(str(data).encode("utf-8"))
    return hasher.hexdigest()


def generate_step_result(
    exercise_id: str,
    track: str,
    metrics: Dict[str, Any],
    status: str = "PASS",
    input_hash: Optional[str] = None,
    schema_version: str = "1.0.0"
) -> Dict[str, Any]:
    """
    Generates the canonical schema dictionary for automated grading and verification:
    {
      "schemaVersion": "1.0.0",
      "exerciseId": "...",
      "track": "script" | "notebook",
      "inputHash": "...",
      "metrics": {...},
      "status": "PASS" | "FAIL"
    }
    """
    return {
        "schemaVersion": schema_version,
        "exerciseId": exercise_id,
        "track": track,
        "inputHash": input_hash or "",
        "metrics": metrics,
        "status": status,
    }


def output_step_json(result: Dict[str, Any]) -> None:
    """Pretty prints the step result dictionary to standard output."""
    print(json.dumps(result, indent=2))
