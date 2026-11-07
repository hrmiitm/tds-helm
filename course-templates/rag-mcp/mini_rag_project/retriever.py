"""
mini_rag_project/retriever.py — Semantic Proximity Retriever using ChromaDB (HNSW + L2)
"""

from dataclasses import dataclass
from typing import Optional
import chromadb
from chromadb.config import Settings
from chromadb.utils import embedding_functions

try:
    from config import config
except ImportError:
    from .config import config


@dataclass
class SearchResult:
    chunk_id: str
    document_text: str
    source_file: str
    chunk_index: int
    l2_distance: float
    similarity_score: float


class SemanticRetriever:
    def __init__(self, storage_path: Optional[str] = None, collection_name: Optional[str] = None):
        self.storage_path = str(storage_path or config.storage_dir)
        self.collection_name = collection_name or config.collection_name
        
        # Initialize persistent client
        self.client = chromadb.PersistentClient(
            path=self.storage_path,
            settings=Settings(anonymized_telemetry=False)
        )
        
        # Initialize embedding function
        self.embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=config.model_name
        )
        
        # Access collection
        self.collection = self.client.get_collection(
            name=self.collection_name,
            embedding_function=self.embedding_fn
        )

    def retrieve(self, query: str, top_k: Optional[int] = None, where_filter: Optional[dict] = None) -> list[SearchResult]:
        """
        Execute semantic retrieval using HNSW + Squared L2 distance.
        """
        k = top_k or config.top_k
        query_kwargs = {
            "query_texts": [query],
            "n_results": k
        }
        if where_filter:
            query_kwargs["where"] = where_filter

        raw_results = self.collection.query(**query_kwargs)

        results: list[SearchResult] = []
        if not raw_results or not raw_results.get("ids") or len(raw_results["ids"][0]) == 0:
            return results

        ids = raw_results["ids"][0]
        docs = raw_results["documents"][0]
        metas = raw_results["metadatas"][0]
        distances = raw_results["distances"][0]

        for i in range(len(ids)):
            l2_dist = float(distances[i])
            # Convert ChromaDB Squared L2 distance to normalized similarity score: Sim = 1 - d² / 2
            sim_score = max(0.0, 1.0 - (l2_dist / 2.0))
            
            results.append(SearchResult(
                chunk_id=ids[i],
                document_text=docs[i],
                source_file=metas[i].get("source_file", "unknown"),
                chunk_index=metas[i].get("chunk_index", 0),
                l2_distance=round(l2_dist, 4),
                similarity_score=round(sim_score, 4)
            ))

        return results


if __name__ == "__main__":
    retriever = SemanticRetriever()
    test_query = "What is the policy for telecommuting and working from home?"
    print(f"Testing Retrieval for: '{test_query}'")
    matches = retriever.retrieve(test_query, top_k=2)
    for rank, m in enumerate(matches, 1):
        print(f"Rank #{rank}: [{m.source_file}] (L2 Distance: {m.l2_distance:.4f}, Sim: {m.similarity_score:.4f})")
        print(f"  Excerpt: {m.document_text[:120]}...\n")
