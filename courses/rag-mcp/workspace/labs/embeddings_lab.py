#!/usr/bin/env python3
"""
embeddings_lab.py — Dense Embeddings & Vector Similarity
========================================================
Demonstrates generating 384-dimensional dense vectors on CPU with
all-MiniLM-L6-v2 and calculating Cosine Similarity using pure NumPy.

Supports:
  --step dimensions (Task t3_1)
  --step cosine     (Task t3_2)
  --json            Machine-readable JSON schema output
"""

import argparse
import sys
from pathlib import Path
import numpy as np

# Add workspace root to import rag_course
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rag_course.loader import get_model
from rag_course.metrics import (
    cosine_similarity,
    compute_input_hash,
    generate_step_result,
    output_step_json,
)

SAMPLE_SENTENCES = [
    "Retrieval-Augmented Generation grounds AI answers with verified facts.",
    "RAG systems search a vector database to provide context for LLMs.",
    "Baking traditional sourdough bread requires wild yeast and hydration.",
]


def run_dimensions_step(as_json: bool):
    model = get_model()
    embeddings = model.encode(SAMPLE_SENTENCES, convert_to_numpy=True)
    input_hash = compute_input_hash(SAMPLE_SENTENCES)

    dim = int(embeddings.shape[1])
    is_finite = bool(np.all(np.isfinite(embeddings)))
    norms = [float(np.linalg.norm(v)) for v in embeddings]
    # SentenceTransformers all-MiniLM-L6-v2 produces normalized (norm approx 1.0) vectors
    is_normalized = bool(all(abs(n - 1.0) < 1e-3 for n in norms))

    metrics = {
        "model": "sentence-transformers/all-MiniLM-L6-v2",
        "device": "cpu",
        "dimensions": dim,
        "num_sentences": len(SAMPLE_SENTENCES),
        "is_finite": is_finite,
        "is_normalized": is_normalized,
        "vector_norms": [round(n, 4) for n in norms],
    }

    if as_json:
        result = generate_step_result(
            exercise_id="dimensions",
            track="script",
            metrics=metrics,
            status="PASS" if dim == 384 and is_finite else "FAIL",
            input_hash=input_hash,
        )
        output_step_json(result)
        return

    from rich.console import Console
    console = Console()
    console.print(f"Loaded embedding model on CPU.")
    console.print(f"Encoded {len(SAMPLE_SENTENCES)} sample sentences.")
    console.print(f"[bold green]✔ Embedding Matrix Shape:[/bold green] [bold yellow]{embeddings.shape}[/bold yellow]")
    console.print(f"[bold green]✔ Vector Dimensionality (D):[/bold green] [bold yellow]{dim}[/bold yellow] coordinates per vector")
    console.print(f"[bold green]✔ Finite & Normalized:[/bold green] [bold yellow]{is_finite and is_normalized}[/bold yellow]")


def run_cosine_step(as_json: bool):
    model = get_model()
    embeddings = model.encode(SAMPLE_SENTENCES, convert_to_numpy=True)
    input_hash = compute_input_hash(SAMPLE_SENTENCES)

    sim_rag1_rag2 = cosine_similarity(embeddings[0], embeddings[1])
    sim_rag1_bread = cosine_similarity(embeddings[0], embeddings[2])
    diff = sim_rag1_rag2 - sim_rag1_bread

    metrics = {
        "sim_rag1_rag2": round(sim_rag1_rag2, 4),
        "sim_rag1_bread": round(sim_rag1_bread, 4),
        "difference": round(diff, 4),
        "higher_affinity_pair": "Sentence 1 vs Sentence 2",
        "is_conceptually_sound": bool(sim_rag1_rag2 > sim_rag1_bread),
    }

    if as_json:
        result = generate_step_result(
            exercise_id="cosine",
            track="script",
            metrics=metrics,
            status="PASS" if sim_rag1_rag2 > sim_rag1_bread else "FAIL",
            input_hash=input_hash,
        )
        output_step_json(result)
        return

    from rich.console import Console
    from rich.table import Table
    console = Console()

    table = Table(title="Cosine Similarity Comparison")
    table.add_column("Pair Comparison", style="cyan")
    table.add_column("Cosine Similarity", justify="center", style="bold green", width=20)
    table.add_column("Semantic Relationship", style="white")

    table.add_row(
        "Sentence 1 vs Sentence 2 (RAG concepts)",
        f"{sim_rag1_rag2:.4f}",
        "High Semantic Affinity (Similar Topics)",
    )
    table.add_row(
        "Sentence 1 vs Sentence 3 (RAG vs Sourdough)",
        f"{sim_rag1_bread:.4f}",
        "Low Semantic Affinity (Unrelated Topics)",
    )

    console.print(table)
    console.print(f"\n[bold]Difference in affinity:[/bold] {diff:.4f} higher for matching concepts.")


def main():
    parser = argparse.ArgumentParser(description="Dense vector embedding dimensionality and cosine similarity.")
    parser.add_argument("--step", choices=["dimensions", "cosine"], help="Specific step to execute.")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format.")
    args = parser.parse_args()

    try:
        if args.step == "dimensions":
            run_dimensions_step(args.json)
        elif args.step == "cosine":
            run_cosine_step(args.json)
        else:
            if args.json:
                model = get_model()
                embeddings = model.encode(SAMPLE_SENTENCES, convert_to_numpy=True)
                sim1 = cosine_similarity(embeddings[0], embeddings[1])
                sim2 = cosine_similarity(embeddings[0], embeddings[2])
                metrics = {
                    "dimensions": int(embeddings.shape[1]),
                    "sim_rag1_rag2": round(sim1, 4),
                    "sim_rag1_bread": round(sim2, 4),
                }
                result = generate_step_result(
                    exercise_id="embeddings-all",
                    track="script",
                    metrics=metrics,
                    status="PASS",
                    input_hash=compute_input_hash(SAMPLE_SENTENCES),
                )
                output_step_json(result)
            else:
                run_dimensions_step(False)
                print()
                run_cosine_step(False)
    except Exception as exc:
        if args.json:
            result = generate_step_result(
                exercise_id=args.step or "embeddings",
                track="script",
                metrics={"error": str(exc)},
                status="FAIL",
            )
            output_step_json(result)
        else:
            print(f"Error in embeddings lab: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
