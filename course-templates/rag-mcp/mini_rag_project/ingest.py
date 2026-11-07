"""
mini_rag_project/ingest.py — Knowledge Base Ingestion & Vector Index Building
"""

import sys
import shutil
from pathlib import Path
import chromadb
from chromadb.config import Settings
from chromadb.utils import embedding_functions

# Import configuration
try:
    from config import config
except ImportError:
    from .config import config


def chunk_text(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    """
    Split text into overlapping character windows, prioritizing paragraph/sentence breaks.
    """
    if len(text) <= chunk_size:
        return [text.strip()]
    
    chunks = []
    start = 0
    stride = chunk_size - chunk_overlap
    
    while start < len(text):
        end = min(start + chunk_size, len(text))
        
        # If not at the end of text, attempt to break on newline or space
        if end < len(text):
            break_pt = text.rfind("\n", start + chunk_overlap, end)
            if break_pt == -1:
                break_pt = text.rfind(" ", start + chunk_overlap, end)
            if break_pt != -1:
                end = break_pt
        
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
            
        if end >= len(text):
            break
        start += stride
        
    return chunks


def run_ingestion(reset_db: bool = True) -> int:
    """
    Ingest text documents from data directory into ChromaDB persistent collection.
    Returns the total number of chunks ingested.
    """
    print("=" * 65)
    print("🚀 MINIMAL RAG PROJECT — KNOWLEDGE BASE INGESTION PIPELINE")
    print("=" * 65)
    print(f"📁 Source Documents Directory : {config.data_dir}")
    print(f"💾 ChromaDB Storage Directory  : {config.storage_dir}")
    print(f"🧠 Embedding Model Backbone   : {config.model_name}")
    print(f"📐 Distance Metric Space       : {config.distance_space} (Squared Euclidean)")
    print("-" * 65)

    if not config.data_dir.exists():
        raise FileNotFoundError(f"Data directory not found: {config.data_dir}")

    # Discover documents
    doc_files = sorted(list(config.data_dir.glob("*.txt")))
    if not doc_files:
        raise ValueError(f"No .txt documents found in {config.data_dir}")

    print(f"✔ Discovered {len(doc_files)} policy text documents.")

    # Prepare chunks and metadata
    all_chunks = []
    all_metadatas = []
    all_ids = []

    for doc_path in doc_files:
        content = doc_path.read_text(encoding="utf-8")
        doc_chunks = chunk_text(content, config.chunk_size, config.chunk_overlap)
        print(f"  • {doc_path.name:<32s} -> {len(doc_chunks):2d} chunks generated")
        
        for idx, chunk in enumerate(doc_chunks):
            chunk_id = f"{doc_path.stem}_chunk_{idx:02d}"
            all_chunks.append(chunk)
            all_ids.append(chunk_id)
            all_metadatas.append({
                "source_file": doc_path.name,
                "document_stem": doc_path.stem,
                "chunk_index": idx,
                "char_length": len(chunk)
            })

    total_chunks = len(all_chunks)
    print("-" * 65)
    print(f"✔ Total Knowledge Chunks to Ingest: {total_chunks}")

    # If reset requested, clean old storage
    if reset_db and config.storage_dir.exists():
        shutil.rmtree(config.storage_dir, ignore_errors=True)

    config.storage_dir.mkdir(parents=True, exist_ok=True)

    # Initialize ChromaDB persistent client
    client = chromadb.PersistentClient(
        path=str(config.storage_dir),
        settings=Settings(anonymized_telemetry=False)
    )

    # Initialize embedding function using cached local model
    embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name=config.model_name
    )

    # Create collection with explicit HNSW + Squared L2 configuration
    collection = client.get_or_create_collection(
        name=config.collection_name,
        metadata={"hnsw:space": config.distance_space},
        embedding_function=embedding_fn
    )

    # Ingest documents in batch
    collection.add(
        documents=all_chunks,
        metadatas=all_metadatas,
        ids=all_ids
    )

    stored_count = collection.count()
    print("=" * 65)
    print(f"✔ INGESTION SUCCESSFUL: {stored_count} vectors indexed in collection '{config.collection_name}'")
    print("=" * 65)
    return stored_count


if __name__ == "__main__":
    count = run_ingestion(reset_db=True)
    sys.exit(0 if count > 0 else 1)
