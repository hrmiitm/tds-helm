#!/usr/bin/env python3
"""
rag_pipeline_lab.py — Grounded Prompt Assembly & End-to-End RAG
===============================================================
Demonstrates the complete Retrieval-Augmented Generation workflow:
1. User question → CPU dense embedding
2. Vector retrieval from ChromaDB HNSW cosine index
3. Grounded context synthesis into an LLM prompt with citations

Supports:
  --step grounded-prompt   (Task t5_1)
  --step environment-check (Task t5_2)
  --json                   Machine-readable JSON schema output
"""

import argparse
import sys
from pathlib import Path
import chromadb

# Add workspace root to import rag_course
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rag_course.config import get_chroma_dir
from rag_course.loader import get_model
from rag_course.metrics import (
    compute_input_hash,
    generate_step_result,
    output_step_json,
)

COLLECTION_NAME = "rag_knowledge_base"
DEFAULT_QUESTION = "What is the computational complexity of exact k-NN compared to approximate search?"


def assemble_rag_prompt(user_question: str, top_k: int = 2):
    db_path = get_chroma_dir("scripts")
    client = chromadb.PersistentClient(path=str(db_path))

    try:
        collection = client.get_collection(COLLECTION_NAME, embedding_function=None)
    except Exception:
        # Auto-index if not present
        from labs.chroma_lab import run_index_step
        run_index_step(as_json=False)
        collection = client.get_collection(COLLECTION_NAME, embedding_function=None)

    model = get_model()
    query_emb = model.encode([user_question], show_progress_bar=False, convert_to_numpy=True).tolist()

    results = collection.query(
        query_embeddings=query_emb,
        n_results=top_k,
        include=["documents", "metadatas", "distances"],
    )

    docs = results["documents"][0]
    metas = results["metadatas"][0]
    ids = results["ids"][0]
    dists = results["distances"][0]

    context_sections = []
    citations = []
    for idx, (doc, meta, chunk_id, dist) in enumerate(zip(docs, metas, ids, dists), 1):
        source = meta.get("source", "Unknown")
        citation = f"{source} (id: {chunk_id})"
        citations.append(citation)
        context_sections.append(
            f"[Passage {idx} | Source: {citation} | Distance: {dist:.4f}]\n{doc.strip()}"
        )

    formatted_context = "\n\n".join(context_sections)

    prompt = f"""You are a specialized AI technical assistant. Answer the user's question using ONLY the verified context below.
If the answer cannot be determined from the context, state that clearly. Always cite the supporting document and passage id.

--- VERIFIED CONTEXT ---
{formatted_context}
--- END CONTEXT ---

USER QUESTION: {user_question}

GROUNDED ANSWER:"""

    return prompt, docs, metas, citations


def run_grounded_prompt_step(as_json: bool, question: str = DEFAULT_QUESTION):
    prompt, docs, metas, citations = assemble_rag_prompt(question, top_k=2)
    input_hash = compute_input_hash({"question": question, "citations": citations})

    metrics = {
        "user_question": question,
        "retrieved_chunks": len(docs),
        "citations": citations,
        "prompt_character_length": len(prompt),
        "citations_present": len(citations) > 0,
        "grounding_constraint_enforced": "Answer the user's question using ONLY the verified context below" in prompt,
    }

    if as_json:
        result = generate_step_result(
            exercise_id="grounded-prompt",
            track="script",
            metrics=metrics,
            status="PASS" if len(docs) == 2 and metrics["citations_present"] else "FAIL",
            input_hash=input_hash,
        )
        output_step_json(result)
        return

    from rich.console import Console
    from rich.panel import Panel
    console = Console()

    console.print(Panel(f"[bold white]{question}[/bold white]", title="[bold cyan]User Input Question[/bold cyan]"))
    console.print(Panel(prompt, title="[bold green]Assembled Grounded Prompt for LLM[/bold green]", border_style="green"))
    console.print(
        "[bold yellow]✔ Prompt Synthesized Successfully![/bold yellow] "
        "The prompt includes verified retrieved passages with explicit citations."
    )


def run_environment_check_step(as_json: bool):
    # Delegate to verify_rag
    from labs.verify_rag import run_verification
    run_verification(as_json=as_json, step_id="environment-check")


def main():
    parser = argparse.ArgumentParser(description="End-to-End Grounded RAG prompt synthesis.")
    parser.add_argument("--step", choices=["grounded-prompt", "environment-check"], help="Specific step to execute.")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format.")
    args = parser.parse_args()

    try:
        if args.step == "grounded-prompt":
            run_grounded_prompt_step(args.json)
        elif args.step == "environment-check":
            run_environment_check_step(args.json)
        else:
            if args.json:
                run_grounded_prompt_step(as_json=True)
            else:
                run_grounded_prompt_step(False)
    except Exception as exc:
        if args.json:
            result = generate_step_result(
                exercise_id=args.step or "rag-pipeline",
                track="script",
                metrics={"error": str(exc)},
                status="FAIL",
            )
            output_step_json(result)
        else:
            print(f"Error in RAG pipeline: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
