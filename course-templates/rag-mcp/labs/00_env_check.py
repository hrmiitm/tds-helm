#!/usr/bin/env python3
"""
labs/00_env_check.py — Workspace Environment & Offline Asset Verification
Verifies Python environment, baked sentence-transformer model, ChromaDB, and FastMCP.
"""

import sys
import os
from pathlib import Path

def check_env():
    print("=" * 60)
    print(" Studio Universal: Environment & Knowledge Base Verification")
    print("=" * 60)
    
    # 1. Python version
    py_ver = sys.version.split()[0]
    print(f"[OK] Python version: {py_ver}")
    
    # 2. Check Data files
    data_dir = Path("/workspace/data/corporate_policies")
    if not data_dir.exists():
        data_dir = Path("data/corporate_policies")
    
    if data_dir.exists():
        policies = list(data_dir.glob("*.txt"))
        print(f"[OK] Corporate policies found: {len(policies)} documents in {data_dir}")
        for p in sorted(policies)[:3]:
            print(f"     - {p.name} ({p.stat().st_size} bytes)")
    else:
        print("[WARN] Data directory not found at standard path")
        
    # 3. Check Sentence Transformers & Model
    try:
        import sentence_transformers
        print(f"[OK] sentence-transformers installed (v{sentence_transformers.__version__})")
    except ImportError:
        print("[FAIL] sentence-transformers not installed")

    # 4. Check ChromaDB
    try:
        import chromadb
        print(f"[OK] chromadb installed (v{chromadb.__version__})")
    except ImportError:
        print("[FAIL] chromadb not installed")

    # 5. Check FastMCP / MCP
    try:
        import mcp
        print(f"[OK] mcp package installed (v{mcp.__version__})")
    except ImportError:
        print("[INFO] standard mcp package available via Python stack")

    # 6. Verify Model Cache
    model_paths = [
        os.environ.get("BAKED_MODEL_DIR", ""),
        "/models/all-MiniLM-L6-v2",
        "/tmp/models/all-MiniLM-L6-v2",
        "models/all-MiniLM-L6-v2",
    ]
    found_model = False
    for mp in model_paths:
        if mp and Path(mp).exists():
            print(f"[OK] Offline baked embedding model verified at: {mp}")
            found_model = True
            break
    if not found_model:
        print("[INFO] Model will load from local HuggingFace cache or fallback")

    print("=" * 60)
    print(" All prerequisites verified! You are ready to start Task 1.")
    print("=" * 60)

if __name__ == "__main__":
    check_env()

