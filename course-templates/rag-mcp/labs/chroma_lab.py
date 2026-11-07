#!/usr/bin/env python3
"""
chroma_lab.py — ChromaDB Vector Store & HNSW Indexing
=====================================================
Demonstrates initializing ChromaDB, creating an HNSW cosine collection,
inserting chunks with metadata, and querying nearest neighbors.

Supports:
  --step index (Task t4_1)
  --step query (Task t4_2)
  --json       Machine-readable JSON schema output
"""

import argparse
import sys
from pathlib import Path
import chromadb

# Add workspace root to import rag_course
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rag_course.config import get_raw_data_dir, get_chroma_dir
from rag_course.loader import get_model
from rag_course.metrics import (
    compute_input_hash,
    generate_step_result,
    output_step_json,
)

try:
    from langchain_text_splitters import RecursiveCharacterTextSplitter
except ImportError:
    from langchain.text_splitter import RecursiveCharacterTextSplitter

COLLECTION_NAME = "rag_knowledge_base"
CANONICAL_CHUNK_SIZE = 350
CANONICAL_CHUNK_OVERLAP = 50
CANONICAL_SEPARATORS = ["\n\n", "\n", ". ", " ", ""]
DEFAULT_QUERY = "How does HNSW use skip lists and layers to navigate high-dimensional space?"


def get_client() -> chromadb.PersistentClient:
    db_path = get_chroma_dir("scripts")
    return chromadb.PersistentClient(path=str(db_path))


def get_collection(client: chromadb.PersistentClient, reset: bool = False):
    """
    Retrieves or creates the collection configured for cosine distance space.
    If reset is requested, safely deletes existing collection first.
    """
    if reset:
        try:
            client.delete_collection(COLLECTION_NAME)
        except Exception:
            pass

    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        embedding_function=None,
        metadata={"hnsw:space": "cosine"},
    )


def build_corpus_chunks():
    raw_dir = get_raw_data_dir()
    doc_paths = sorted(raw_dir.glob("doc_*.txt"))
    if not doc_paths:
        raise FileNotFoundError(f"No doc_*.txt files found in {raw_dir}")

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CANONICAL_CHUNK_SIZE,
        chunk_overlap=CANONICAL_CHUNK_OVERLAP,
        length_function=len,
        separators=CANONICAL_SEPARATORS,
    )

    ids = []
    chunks = []
    metas = []

    for path in doc_paths:
        filename = path.name
        text = path.read_text(encoding="utf-8")
        doc_chunks = splitter.split_text(text)
        for idx, chunk in enumerate(doc_chunks):
            ids.append(f"{filename}#c{idx:02d}")
            chunks.append(chunk)
            metas.append({"source": filename, "chunk_idx": idx})

    return ids, chunks, metas, doc_paths


def run_index_step(as_json: bool):
    client = get_client()
    collection = get_collection(client, reset=True)

    ids, chunks, metas, doc_paths = build_corpus_chunks()
    model = get_model()

    embeddings = model.encode(chunks, show_progress_bar=False, convert_to_numpy=True).tolist()

    collection.add(
        ids=ids,
        documents=chunks,
        embeddings=embeddings,
        metadatas=metas,
    )

    count = collection.count()
    input_hash = compute_input_hash({"ids": ids, "chunk_count": len(chunks)})

    metrics = {
        "collection_name": COLLECTION_NAME,
        "documents_processed": len(doc_paths),
        "indexed_chunks": count,
        "space": "cosine",
        "storage_path": str(get_chroma_dir("scripts")),
    }

    if as_json:
        result = generate_step_result(
            exercise_id="index",
            track="script",
            metrics=metrics,
            status="PASS" if count == len(chunks) else "FAIL",
            input_hash=input_hash,
        )
        output_step_json(result)
        return

    from rich.console import Console
    console = Console()
    console.print(f"[bold cyan]Initializing ChromaDB Vector Store at '{get_chroma_dir('scripts')}'...[/bold cyan]")
    console.print(f"Loaded {len(doc_paths)} documents → Partitioned into [bold yellow]{len(chunks)} chunks[/bold yellow].")
    console.print(f"[bold green]✔ Successfully indexed {count} chunks into '{COLLECTION_NAME}'![/bold green]\n")


def run_query_step(as_json: bool, query_str: str = DEFAULT_QUERY):
    client = get_client()
    try:
        collection = client.get_collection(name=COLLECTION_NAME, embedding_function=None)
    except Exception:
        # If not indexed yet, auto-index first
        run_index_step(as_json=False)
        collection = client.get_collection(name=COLLECTION_NAME, embedding_function=None)

    model = get_model()
    query_emb = model.encode([query_str], show_progress_bar=False, convert_to_numpy=True).tolist()

    results = collection.query(
        query_embeddings=query_emb,
        n_results=2,
        include=["documents", "metadatas", "distances"],
    )

    top_source = results["metadatas"][0][0]["source"] if results["metadatas"][0] else ""
    top_chunk_id = results["ids"][0][0] if results["ids"][0] else ""
    top_dist = round(float(results["distances"][0][0]), 4) if results["distances"][0] else 0.0

    retrieved_items = []
    for i in range(len(results["documents"][0])):
        retrieved_items.append({
            "rank": i + 1,
            "id": results["ids"][0][i],
            "source": results["metadatas"][0][i]["source"],
            "distance": round(float(results["distances"][0][i]), 4),
            "preview": results["documents"][0][i][:100],
        })

    input_hash = compute_input_hash({"query": query_str, "top_id": top_chunk_id})

    metrics = {
        "query": query_str,
        "top_source": top_source,
        "top_chunk_id": top_chunk_id,
        "top_distance": top_dist,
        "retrieved_count": len(retrieved_items),
        "results": retrieved_items,
    }

    if as_json:
        result = generate_step_result(
            exercise_id="query",
            track="script",
            metrics=metrics,
            status="PASS" if top_source == "doc_003.txt" else "FAIL",
            input_hash=input_hash,
        )
        output_step_json(result)
        return

    from rich.console import Console
    from rich.table import Table
    console = Console()

    console.print(f"[bold magenta]Testing Query:[/bold magenta] [yellow]\"{query_str}\"[/yellow]")

    table = Table(title="Top 2 Retrieved Passages")
    table.add_column("Rank", justify="center", style="bold yellow", width=6)
    table.add_column("Distance (Cosine)", justify="center", style="green", width=18)
    table.add_column("Source Document", style="cyan", width=18)
    table.add_column("Content Excerpt", style="white")

    for item in retrieved_items:
        table.add_row(f"#{item['rank']}", f"{item['distance']:.4f}", item["source"], item["preview"] + "...")

    console.print(table)


def main():
    parser = argparse.ArgumentParser(description="ChromaDB vector database indexing and HNSW query.")
    parser.add_argument("--step", choices=["index", "query"], help="Specific step to execute.")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format.")
    args = parser.parse_args()

    try:
        if args.step == "index":
            run_index_step(args.json)
        elif args.step == "query":
            run_query_step(args.json)
        else:
            if args.json:
                run_index_step(as_json=False)
                run_query_step(as_json=True)
            else:
                run_index_step(False)
                run_query_step(False)
    except Exception as exc:
        if args.json:
            result = generate_step_result(
                exercise_id=args.step or "chroma",
                track="script",
                metrics={"error": str(exc)},
                status="FAIL",
            )
            output_step_json(result)
        else:
            print(f"Error in chroma lab: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
