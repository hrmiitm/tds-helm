#!/usr/bin/env python3
"""
bake_model.py — RAG Studio v4.0 Build-Time Model Pre-Cacher
Downloads sentence-transformers/all-MiniLM-L6-v2 into the target directory,
verifies offline loading, and checks tensor dimensionality and normalization.
"""

import os
import sys
import numpy as np

def main():
    target_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("RAG_MODEL_PATH", "/opt/hf_cache/models/all-MiniLM-L6-v2")
    print(f"[bake_model] Starting pre-cache into {target_dir}...")
    os.makedirs(target_dir, exist_ok=True)

    # 1. Download model snapshot using SentenceTransformer
    from sentence_transformers import SentenceTransformer
    model_name = "sentence-transformers/all-MiniLM-L6-v2"
    
    print(f"[bake_model] Downloading '{model_name}'...")
    model = SentenceTransformer(model_name, device="cpu")
    
    # Save the model directly into target_dir
    print(f"[bake_model] Saving local copy to {target_dir}...")
    model.save(target_dir)

    # 2. Test loading completely offline
    print("[bake_model] Verifying offline loading...")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

    offline_model = SentenceTransformer(target_dir, device="cpu", local_files_only=True)
    
    # 3. Test CPU encode on two sample sentences
    test_sentences = ["Machine learning vector embeddings.", "Artificial intelligence semantic search."]
    embeddings = offline_model.encode(test_sentences, convert_to_numpy=True, normalize_embeddings=True)

    # 4. Verify invariants
    assert embeddings.shape == (2, 384), f"Expected shape (2, 384), got {embeddings.shape}"
    assert np.all(np.isfinite(embeddings)), "Embeddings contain non-finite values (NaN/Inf)"

    norms = np.linalg.norm(embeddings, axis=1)
    assert np.allclose(norms, [1.0, 1.0], atol=1e-3), f"Embeddings not unit-normalized: {norms}"

    print(f"[bake_model] SUCCESS: Model validated offline at {target_dir}")
    print(f"[bake_model] Embedding shape: {embeddings.shape}, Norms: {norms}")

if __name__ == "__main__":
    main()

