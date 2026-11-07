"""
mini_rag_project/config.py — Configuration Settings for Minimal RAG System
"""

import os
from pathlib import Path
from dataclasses import dataclass

BASE_DIR = Path(__file__).resolve().parent

@dataclass
class RAGConfig:
    # Directory paths
    data_dir: Path = BASE_DIR / "data" / "documents"
    storage_dir: Path = BASE_DIR / "chroma_storage"
    
    # Vector store settings
    collection_name: str = "corporate_policies"
    model_name: str = "sentence-transformers/all-MiniLM-L6-v2"
    distance_space: str = "l2"  # ChromaDB default: Squared Euclidean distance
    
    # Chunking parameters
    chunk_size: int = 350
    chunk_overlap: int = 50
    
    # Retrieval parameters
    top_k: int = 3
    similarity_threshold: float = 0.45

config = RAGConfig()
