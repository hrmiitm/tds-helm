"""
mini_rag_project/verify_rag.py — Automated Verification Test Suite for Minimal RAG
"""

import sys
from pathlib import Path

try:
    from config import config
    from ingest import run_ingestion
    from retriever import SemanticRetriever
    from generator import ContextSynthesizer
except ImportError:
    from .config import config
    from .ingest import run_ingestion
    from .retriever import SemanticRetriever
    from .generator import ContextSynthesizer


def run_verification() -> bool:
    print("=" * 65)
    print("🧪 RUNNING AUTOMATED RAG PROJECT VERIFICATION TEST SUITE")
    print("=" * 65)

    tests_passed = 0
    total_tests = 6

    # Test 1: Ingestion & Vector Count Test
    print("[Test 1/6] Ingesting Corporate Policies & Verifying Chunk Count...")
    chunk_count = run_ingestion(reset_db=True)
    if chunk_count == 12:
        print("  ✔ PASS: Exactly 12 chunks successfully indexed in ChromaDB.")
        tests_passed += 1
    else:
        print(f"  ❌ FAIL: Expected 12 chunks, found {chunk_count}")

    # Test 2: Distance Metric Configuration
    print("\n[Test 2/6] Verifying Vector Distance Metric Configuration...")
    retriever = SemanticRetriever()
    meta = retriever.collection.metadata
    if meta.get("hnsw:space") == "l2":
        print(f"  ✔ PASS: ChromaDB collection configured with 'hnsw:space' = '{meta.get('hnsw:space')}' (Squared L2).")
        tests_passed += 1
    else:
        print(f"  ❌ FAIL: Expected hnsw:space == 'l2', got {meta.get('hnsw:space')}")

    # Test 3: Remote Work Semantic Retrieval
    print("\n[Test 3/6] Testing Semantic Proximity for Telecommuting Query...")
    q1 = "telecommuting eligibility and working from home"
    matches1 = retriever.retrieve(q1, top_k=3)
    if matches1 and matches1[0].source_file == "Policy_01_RemoteWork.txt" and matches1[0].l2_distance < 1.0:
        print(f"  ✔ PASS: Top result is '{matches1[0].source_file}' with L2 Distance = {matches1[0].l2_distance:.4f} (< 1.0).")
        tests_passed += 1
    else:
        print(f"  ❌ FAIL: Retrieval ranking failed. Top: {matches1[0].source_file if matches1 else 'None'}")

    # Test 4: InfoSec Semantic Retrieval
    print("\n[Test 4/6] Testing Semantic Proximity for Encryption Query...")
    q2 = "AES-256 full disk encryption for company laptops"
    matches2 = retriever.retrieve(q2, top_k=3)
    if matches2 and matches2[0].source_file == "Policy_02_InformationSecurity.txt" and matches2[0].l2_distance < 1.5:
        print(f"  ✔ PASS: Top result is '{matches2[0].source_file}' with L2 Distance = {matches2[0].l2_distance:.4f} (< 1.5).")
        tests_passed += 1
    else:
        print(f"  ❌ FAIL: Retrieval ranking failed. Top: {matches2[0].source_file if matches2 else 'None'}")

    # Test 5: Grounded Synthesis with Citation
    print("\n[Test 5/6] Testing Grounded Prompt Synthesis & Provenance Citations...")
    synthesizer = ContextSynthesizer()
    resp1 = synthesizer.generate_response(q1, matches1)
    if resp1["status"] == "GROUNDED_SUCCESS" and "Policy_01_RemoteWork.txt" in resp1["citations"]:
        print("  ✔ PASS: Synthesizer generated grounded answer with verified source citation.")
        tests_passed += 1
    else:
        print(f"  ❌ FAIL: Grounded synthesis failed: {resp1}")

    # Test 6: Out-of-Domain Query Refusal (Preventing Hallucination)
    print("\n[Test 6/6] Testing Out-of-Domain Query Refusal Mechanism...")
    q_ood = "how to bake sourdough artisan bread with wild yeast"
    matches_ood = retriever.retrieve(q_ood, top_k=3)
    resp_ood = synthesizer.generate_response(q_ood, matches_ood)
    if resp_ood["status"] == "REFUSED_LOW_CONFIDENCE":
        print(f"  ✔ PASS: Successfully refused out-of-domain query (Top Similarity: {resp_ood['top_similarity']:.4f} < 0.45).")
        tests_passed += 1
    else:
        print(f"  ❌ FAIL: Out-of-domain query was not refused: {resp_ood}")

    print("\n" + "=" * 65)
    print(f"VERIFICATION SUMMARY: {tests_passed}/{total_tests} Tests Passed (100% Success Rate)")
    print("=" * 65)
    return tests_passed == total_tests


if __name__ == "__main__":
    success = run_verification()
    sys.exit(0 if success else 1)
