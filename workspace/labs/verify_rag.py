#!/usr/bin/env python3
"""
verify_rag.py — Comprehensive Diagnostic Environment Verifier
=============================================================
Verifies that all core RAG prerequisites, dependencies, CPU embedding
pipelines, text chunking, and ChromaDB vector operations comply with
spec.md Section 12.1 release gates.

Supports:
  --json                   Outputs structured JSON diagnostic report
  --step environment-check (Task t5_2)
"""

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

# Add workspace root to import rag_course
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rag_course.config import get_workspace_dir, get_raw_data_dir
from rag_course.metrics import generate_step_result, output_step_json


class DiagnosticCheck:
    def __init__(self, name: str, fn: Callable[[], str]):
        self.name = name
        self.fn = fn
        self.status = "PENDING"
        self.detail = ""
        self.duration_ms = 0.0

    def run(self, skip_reason: Optional[str] = None) -> bool:
        if skip_reason:
            self.status = "SKIP"
            self.detail = skip_reason
            return True

        start = time.perf_counter()
        try:
            msg = self.fn()
            self.status = "PASS"
            self.detail = str(msg)
            return True
        except Exception as exc:
            self.status = "FAIL"
            self.detail = str(exc)
            return False
        finally:
            self.duration_ms = round((time.perf_counter() - start) * 1000, 2)


def check_python_version() -> str:
    v = sys.version_info
    # Spec requires exact Python 3.11 in release container
    if not (v.major == 3 and v.minor == 11):
        raise AssertionError(f"Expected Python 3.11.x, found Python {v.major}.{v.minor}.{v.micro}")
    return f"CPython {v.major}.{v.minor}.{v.micro} (executable: {sys.executable})"


def check_workspace_writable() -> str:
    ws = get_workspace_dir()
    test_file = ws / f".verify_write_test_{int(time.time())}.tmp"
    try:
        test_file.write_text("rag-verify-write-probe", encoding="utf-8")
        read_back = test_file.read_text(encoding="utf-8")
        assert read_back == "rag-verify-write-probe"
    finally:
        if test_file.exists():
            test_file.unlink()
    return f"Writable workspace confirmed at {ws}"


def check_dependencies() -> str:
    modules = [
        "numpy",
        "pandas",
        "matplotlib",
        "rich",
        "fastapi",
        "uvicorn",
        "pydantic",
        "sentence_transformers",
        "chromadb",
        "langchain_text_splitters",
    ]
    loaded = []
    for m in modules:
        __import__(m)
        loaded.append(m)
    return f"All {len(loaded)} core packages imported successfully"


def check_cpu_tensors() -> str:
    import torch
    # Verify execution device is CPU
    t = torch.tensor([1.0, 2.0, 3.0], device="cpu")
    assert t.device.type == "cpu", f"Device must be cpu, got {t.device.type}"
    assert torch.get_num_threads() >= 1
    return f"PyTorch {torch.__version__} CPU execution verified (threads={torch.get_num_threads()})"


def check_model_loading_and_dimensions() -> str:
    from rag_course.loader import get_model
    import numpy as np

    model = get_model()
    sentences = ["Verification test sentence for dense embeddings."]
    embs = model.encode(sentences, convert_to_numpy=True)

    if embs.shape != (1, 384):
        raise AssertionError(f"Expected shape (1, 384), got {embs.shape}")
    if not np.all(np.isfinite(embs)):
        raise AssertionError("Embedding vector contains non-finite values (NaN or Inf)")

    norm = float(np.linalg.norm(embs[0]))
    if abs(norm - 1.0) > 1e-2:
        raise AssertionError(f"Vector is not normalized (norm={norm:.4f})")

    return f"all-MiniLM-L6-v2 loaded: shape=(1, 384), finite, normalized (norm={norm:.4f})"


def check_canonical_chunking() -> str:
    from rag_course.config import get_raw_data_dir
    try:
        from langchain_text_splitters import RecursiveCharacterTextSplitter
    except ImportError:
        from langchain.text_splitter import RecursiveCharacterTextSplitter

    doc_file = get_raw_data_dir() / "doc_001.txt"
    if not doc_file.exists():
        raise FileNotFoundError(f"Missing raw document at {doc_file}")

    text = doc_file.read_text(encoding="utf-8")
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=350,
        chunk_overlap=50,
        length_function=len,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    chunks = splitter.split_text(text)
    if len(chunks) != 12:
        raise AssertionError(f"Canonical chunking produced {len(chunks)} chunks, expected exactly 12")

    return f"doc_001.txt partitioned into exactly {len(chunks)} canonical chunks (len={len(text)})"


def check_chromadb_cosine_lifecycle() -> str:
    import chromadb

    temp_db_dir = tempfile.mkdtemp(prefix="rag_chroma_verify_")
    try:
        # Phase 1: create client and collection
        client = chromadb.PersistentClient(path=temp_db_dir)
        col = client.create_collection(
            name="verify_collection",
            embedding_function=None,
            metadata={"hnsw:space": "cosine"},
        )

        test_ids = ["v1", "v2"]
        test_docs = ["Document about information retrieval", "Document about bread baking"]
        # Dummy unit vectors in 384 dimensions
        vec1 = [0.0] * 384
        vec1[0] = 1.0
        vec2 = [0.0] * 384
        vec2[1] = 1.0

        col.add(ids=test_ids, documents=test_docs, embeddings=[vec1, vec2])
        if col.count() != 2:
            raise AssertionError(f"Expected 2 indexed items, got {col.count()}")

        # Phase 2: query nearest neighbor
        res = col.query(query_embeddings=[vec1], n_results=1)
        if res["ids"][0][0] != "v1":
            raise AssertionError(f"Query returned wrong nearest neighbor: {res['ids'][0][0]}")
        dist = float(res["distances"][0][0])
        if dist > 0.05:
            raise AssertionError(f"Self-cosine distance should be ~0.0, got {dist}")

        # Phase 3: reopen collection to verify persistence and idempotency
        del col
        del client

        client2 = chromadb.PersistentClient(path=temp_db_dir)
        col2 = client2.get_collection(name="verify_collection", embedding_function=None)
        if col2.count() != 2:
            raise AssertionError(f"Reopened collection count is {col2.count()}, expected 2")

        # Stable IDs rerun check
        col2.upsert(ids=["v1"], documents=["Updated doc text"], embeddings=[vec1])
        if col2.count() != 2:
            raise AssertionError(f"Upsert changed total count unexpectedly to {col2.count()}")

        return "ChromaDB cosine collection lifecycle (add, query, persist, reopen, upsert) passed"
    finally:
        shutil.rmtree(temp_db_dir, ignore_errors=True)


def run_verification(as_json: bool = False, step_id: str = "environment-check"):
    checks: List[DiagnosticCheck] = [
        DiagnosticCheck("Python Engine (3.11)", check_python_version),
        DiagnosticCheck("Workspace Permissions", check_workspace_writable),
        DiagnosticCheck("Package Dependencies", check_dependencies),
        DiagnosticCheck("CPU Tensor Execution", check_cpu_tensors),
        DiagnosticCheck("Model & 384D Embeddings", check_model_loading_and_dimensions),
        DiagnosticCheck("Canonical Text Splitter", check_canonical_chunking),
        DiagnosticCheck("ChromaDB Cosine Index", check_chromadb_cosine_lifecycle),
    ]

    model_loaded = False
    all_passed = True
    check_results = []

    for idx, c in enumerate(checks):
        skip_reason = None
        if c.name == "ChromaDB Cosine Index" and not model_loaded and idx > 4:
            # If model check failed earlier, skip dependent checks
            pass

        success = c.run(skip_reason)
        if c.name == "Model & 384D Embeddings" and success:
            model_loaded = True

        if c.status == "FAIL":
            all_passed = False

        check_results.append({
            "name": c.name,
            "status": c.status,
            "detail": c.detail,
            "duration_ms": c.duration_ms,
        })

    overall_status = "PASS" if all_passed else "FAIL"

    if as_json:
        metrics = {
            "overall_status": overall_status,
            "passed_checks": sum(1 for c in check_results if c["status"] == "PASS"),
            "total_checks": len(check_results),
            "checks": check_results,
        }
        result = generate_step_result(
            exercise_id=step_id,
            track="script",
            metrics=metrics,
            status=overall_status,
        )
        output_step_json(result)
        return 0 if all_passed else 1

    from rich.console import Console
    from rich.table import Table
    console = Console()

    console.print("\n[bold cyan]=== RAG Interactive Platform Comprehensive Verification ===[/bold cyan]\n")

    table = Table(title="System Verification Results")
    table.add_column("Component / Release Gate", style="cyan", width=32)
    table.add_column("Status", justify="center", width=10)
    table.add_column("Timing", justify="right", style="dim", width=12)
    table.add_column("Diagnostic Detail", style="white")

    for r in check_results:
        st = r["status"]
        if st == "PASS":
            st_formatted = "[bold green]PASS[/bold green]"
        elif st == "FAIL":
            st_formatted = "[bold red]FAIL[/bold red]"
        else:
            st_formatted = "[bold yellow]SKIP[/bold yellow]"
        table.add_row(r["name"], st_formatted, f"{r['duration_ms']:.1f} ms", r["detail"])

    console.print(table)

    if all_passed:
        console.print("\n[bold green]✔ All systems operational. Lab environment is verified and ready.[/bold green]\n")
        return 0
    else:
        console.print("\n[bold red]✘ One or more release gates failed verification.[/bold red]\n")
        return 1


def main():
    parser = argparse.ArgumentParser(description="Comprehensive RAG environment verification suite.")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON diagnostic report.")
    parser.add_argument("--step", choices=["environment-check"], default="environment-check", help="Tagged step ID.")
    args = parser.parse_args()

    sys.exit(run_verification(as_json=args.json, step_id=args.step))


if __name__ == "__main__":
    main()
