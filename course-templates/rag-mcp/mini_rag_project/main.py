"""
mini_rag_project/main.py — End-to-End RAG Pipeline CLI Application
"""

import sys
import argparse
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


def main():
    parser = argparse.ArgumentParser(description="Minimal End-to-End Corporate Policy RAG Pipeline")
    parser.add_argument("--query", "-q", type=str, default="What are the rules and equipment allowances for telecommuting?",
                        help="User question to answer via grounded retrieval")
    parser.add_argument("--top-k", "-k", type=int, default=config.top_k,
                        help="Number of chunks to retrieve from ChromaDB")
    parser.add_argument("--ingest", action="store_true",
                        help="Trigger re-ingestion of knowledge base documents before querying")
    args = parser.parse_args()

    # Step 1: Ingestion if database does not exist or --ingest passed
    if args.ingest or not config.storage_dir.exists():
        print("📦 Initializing knowledge base ingestion...")
        run_ingestion(reset_db=True)

    # Step 2: Retrieve relevant passages
    print("\n" + "=" * 70)
    print(f"🔍 RETRIEVING CONTEXT FOR: '{args.query}'")
    print("=" * 70)
    retriever = SemanticRetriever()
    results = retriever.retrieve(args.query, top_k=args.top_k)

    if not results:
        print("⚠ No matching document chunks found in vector database.")
        sys.exit(1)

    print(f"{'Rank':4s} | {'Source Document':30s} | {'Squared L2':10s} | {'Similarity':10s}")
    print("-" * 70)
    for idx, r in enumerate(results, 1):
        print(f"#{idx:<3d} | {r.source_file:30s} | {r.l2_distance:10.4f} | {r.similarity_score:10.4f}")

    # Step 3: Grounded Answer Synthesis
    print("\n" + "=" * 70)
    print("📝 GROUNDED ANSWER SYNTHESIS:")
    print("=" * 70)
    synthesizer = ContextSynthesizer()
    response = synthesizer.generate_response(args.query, results)

    print(f"Status        : {response['status']}")
    print(f"Top Similarity: {response['top_similarity']:.4f}")
    print(f"Citations     : {', '.join(response.get('citations', []))}")
    print("-" * 70)
    print(response["answer"])
    print("=" * 70)


if __name__ == "__main__":
    main()
