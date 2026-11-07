#!/usr/bin/env python3
"""
keyword_limitation_demo.py — The Lexical Mismatch Problem
=========================================================
Demonstrates why traditional exact-keyword (sparse) search fails when queries
and documents use different synonyms or phrasings, and how dense embeddings
solve this fundamental limitation.

Supports:
  --step lexical-search   (Task t1_1)
  --step semantic-ranking (Task t1_2)
  --json                  Machine-readable JSON schema output
"""

import argparse
import sys
from pathlib import Path
import numpy as np

# Add workspace root to import rag_course
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rag_course.config import get_policies_dir
from rag_course.loader import get_model
from rag_course.metrics import (
    cosine_similarity,
    compute_input_hash,
    generate_step_result,
    output_step_json,
)

QUERY = "distributed workforce policies"


def load_policy_corpus() -> dict:
    """Loads explicit policy files from data/policies/."""
    policies_dir = get_policies_dir()
    corpus = {}
    policy_files = sorted(policies_dir.glob("Policy_*.txt"))
    for pf in policy_files:
        corpus[pf.name] = pf.read_text(encoding="utf-8").strip()
    return corpus


def keyword_search(query: str, corpus: dict):
    """Simple lexical keyword matching (checks query token presence)."""
    query_terms = [t.lower() for t in query.split()]
    matches = []
    for doc_name, text in corpus.items():
        text_lower = text.lower()
        matched_terms = [t for t in query_terms if t in text_lower]
        if matched_terms:
            matches.append((doc_name, matched_terms, text))
    return matches


def semantic_search(query: str, corpus: dict):
    """Dense vector embedding search using CPU SentenceTransformers."""
    model = get_model()

    doc_names = list(corpus.keys())
    doc_texts = list(corpus.values())

    doc_embeddings = model.encode(doc_texts, convert_to_numpy=True)
    query_embedding = model.encode([query], convert_to_numpy=True)[0]

    scores = []
    for idx, d_emb in enumerate(doc_embeddings):
        sim = cosine_similarity(query_embedding, d_emb)
        scores.append((doc_names[idx], sim, doc_texts[idx]))

    scores.sort(key=lambda x: x[1], reverse=True)
    return scores


def run_lexical_step(corpus: dict, as_json: bool):
    matches = keyword_search(QUERY, corpus)
    input_hash = compute_input_hash({"query": QUERY, "corpus": corpus})
    metrics = {
        "query": QUERY,
        "matches_found": len(matches),
        "matched_documents": [m[0] for m in matches],
        "synonym_mismatch_detected": len(matches) == 0,
    }

    if as_json:
        result = generate_step_result(
            exercise_id="lexical-search",
            track="script",
            metrics=metrics,
            status="PASS",
            input_hash=input_hash,
        )
        output_step_json(result)
        return

    from rich.console import Console
    from rich.panel import Panel
    console = Console()
    console.print(Panel(f"[bold cyan]Query:[/bold cyan] [yellow]\"{QUERY}\"[/yellow]",
                        title="[bold]Traditional Lexical Keyword Search[/bold]",
                        border_style="cyan"))

    if not matches:
        console.print("[bold red]✘ 0 matching documents found![/bold red]")
        console.print("[dim]Explanation: None of the query tokens ('distributed', 'workforce', 'policies') appear verbatim in the policy documents.[/dim]\n")
    else:
        for name, terms, text in matches:
            console.print(f"  • {name}: matched terms {terms}")


def run_semantic_step(corpus: dict, as_json: bool):
    scores = semantic_search(QUERY, corpus)
    input_hash = compute_input_hash({"query": QUERY, "corpus": corpus})
    top_doc = scores[0][0] if scores else ""
    top_score = round(scores[0][1], 4) if scores else 0.0

    rankings = [
        {"document": name, "similarity": round(score, 4), "rank": idx + 1}
        for idx, (name, score, _) in enumerate(scores)
    ]

    metrics = {
        "query": QUERY,
        "top_document": top_doc,
        "top_similarity": top_score,
        "rankings": rankings,
    }

    if as_json:
        result = generate_step_result(
            exercise_id="semantic-ranking",
            track="script",
            metrics=metrics,
            status="PASS" if top_doc == "Policy_01_RemoteWork.txt" else "FAIL",
            input_hash=input_hash,
        )
        output_step_json(result)
        return

    from rich.console import Console
    from rich.table import Table
    console = Console()

    table = Table(title="Dense Semantic Similarity Ranking")
    table.add_column("Rank", justify="center", style="bold yellow", width=6)
    table.add_column("Document", style="cyan", width=26)
    table.add_column("Cosine Similarity", justify="center", style="green", width=18)
    table.add_column("Document Content Preview", style="white")

    for rank, (name, score, text) in enumerate(scores, 1):
        preview = text[:95] + "..." if len(text) > 95 else text
        table.add_row(f"#{rank}", name, f"{score:.4f}", preview)

    console.print(table)
    console.print(
        f"\n[bold green]Key Takeaway:[/bold green] Semantic embeddings correctly ranked "
        f"[cyan]{top_doc}[/cyan] #1 because 'telecommuting' and 'remote work' "
        f"map to the same geometric region as 'distributed workforce'!"
    )


def main():
    parser = argparse.ArgumentParser(description="Demonstrate lexical vs semantic retrieval limitations.")
    parser.add_argument("--step", choices=["lexical-search", "semantic-ranking"], help="Specific step to execute.")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format.")
    args = parser.parse_args()

    corpus = load_policy_corpus()
    if not corpus:
        if args.json:
            result = generate_step_result(
                exercise_id=args.step or "lexical-vs-semantic",
                track="script",
                metrics={"error": "Policy corpus is empty or missing"},
                status="FAIL",
            )
            output_step_json(result)
        else:
            print("Error: Policy corpus is empty or missing at data/policies/", file=sys.stderr)
        sys.exit(1)

    if args.step == "lexical-search":
        run_lexical_step(corpus, args.json)
    elif args.step == "semantic-ranking":
        run_semantic_step(corpus, args.json)
    else:
        # Run both
        if args.json:
            # Combined summary
            matches = keyword_search(QUERY, corpus)
            scores = semantic_search(QUERY, corpus)
            metrics = {
                "lexical": {
                    "query": QUERY,
                    "matches_found": len(matches),
                    "matched_documents": [m[0] for m in matches],
                },
                "semantic": {
                    "query": QUERY,
                    "top_document": scores[0][0] if scores else "",
                    "top_similarity": round(scores[0][1], 4) if scores else 0.0,
                },
            }
            result = generate_step_result(
                exercise_id="lexical-vs-semantic",
                track="script",
                metrics=metrics,
                status="PASS",
                input_hash=compute_input_hash({"query": QUERY, "corpus": corpus}),
            )
            output_step_json(result)
        else:
            run_lexical_step(corpus, False)
            print()
            run_semantic_step(corpus, False)


if __name__ == "__main__":
    main()
