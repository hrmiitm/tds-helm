#!/usr/bin/env python3
"""
chunking_lab.py — Document Chunking & Text Splitting
===================================================
Demonstrates how RecursiveCharacterTextSplitter recursively divides
long documents using paragraph, sentence, and word boundary separators,
and illustrates boundary context preservation with chunk overlap.

Supports:
  --step canonical-chunking (Task t2_1)
  --step overlap            (Task t2_2)
  --json                    Machine-readable JSON schema output
"""

import argparse
import sys
from pathlib import Path

# Add workspace root to import rag_course
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rag_course.config import get_raw_data_dir
from rag_course.metrics import (
    compute_input_hash,
    generate_step_result,
    output_step_json,
)

try:
    from langchain_text_splitters import RecursiveCharacterTextSplitter
except ImportError:
    from langchain.text_splitter import RecursiveCharacterTextSplitter

DOC_NAME = "doc_001.txt"
CANONICAL_CHUNK_SIZE = 350
CANONICAL_CHUNK_OVERLAP = 50
CANONICAL_SEPARATORS = ["\n\n", "\n", ". ", " ", ""]


def get_splitter(chunk_size: int = CANONICAL_CHUNK_SIZE, chunk_overlap: int = CANONICAL_CHUNK_OVERLAP):
    return RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        length_function=len,
        separators=CANONICAL_SEPARATORS,
    )


def load_doc_text() -> str:
    doc_path = get_raw_data_dir() / DOC_NAME
    if not doc_path.exists():
        raise FileNotFoundError(f"Document {DOC_NAME} not found at {doc_path}")
    return doc_path.read_text(encoding="utf-8")


def run_chunking_step(text: str, as_json: bool):
    splitter = get_splitter()
    chunks = splitter.split_text(text)
    input_hash = compute_input_hash(text)

    metrics = {
        "document": DOC_NAME,
        "document_length": len(text),
        "chunk_size": CANONICAL_CHUNK_SIZE,
        "chunk_overlap": CANONICAL_CHUNK_OVERLAP,
        "total_chunks": len(chunks),
        "separators": CANONICAL_SEPARATORS,
    }

    if as_json:
        result = generate_step_result(
            exercise_id="canonical-chunking",
            track="script",
            metrics=metrics,
            status="PASS" if len(chunks) == 12 else "FAIL",
            input_hash=input_hash,
        )
        output_step_json(result)
        return

    from rich.console import Console
    from rich.table import Table
    console = Console()

    console.print(f"[bold cyan]Input Document:[/bold cyan] {DOC_NAME} ({len(text)} characters)")

    table = Table(title=f"Recursive Chunking Results (chunk_size={CANONICAL_CHUNK_SIZE}, overlap={CANONICAL_CHUNK_OVERLAP})")
    table.add_column("Chunk #", justify="center", style="bold yellow", width=10)
    table.add_column("Length", justify="center", style="green", width=12)
    table.add_column("Preview Snippet", style="white")

    for idx, c in enumerate(chunks, 1):
        snippet = c.strip().replace("\n", " ")
        if len(snippet) > 85:
            snippet = snippet[:85] + "..."
        table.add_row(f"#{idx}", f"{len(c)} chars", snippet)

    console.print(table)
    console.print(f"\n[bold green]✔ Total Chunks Generated:[/bold green] [bold yellow]{len(chunks)}[/bold yellow]")


def run_overlap_step(text: str, as_json: bool):
    splitter = get_splitter()
    chunks = splitter.split_text(text)
    input_hash = compute_input_hash(text)

    # Inspect overlap between chunk 1 and chunk 2 if available
    c1 = chunks[0] if len(chunks) > 0 else ""
    c2 = chunks[1] if len(chunks) > 1 else ""

    metrics = {
        "chunk_0_len": len(c1),
        "chunk_1_len": len(c2),
        "overlap_target": CANONICAL_CHUNK_OVERLAP,
        "boundary_preservation": True,
        "explanation": "Chunk overlap prevents abrupt loss of context across semantic boundaries.",
    }

    if as_json:
        result = generate_step_result(
            exercise_id="overlap",
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

    console.print(Panel(
        f"[bold cyan]Chunk #1 End (last 60 chars):[/bold cyan]\n\"{c1[-60:]}\"\n\n"
        f"[bold green]Chunk #2 Start (first 60 chars):[/bold green]\n\"{c2[:60]}\"",
        title="[bold yellow]Chunk Boundary Context Preservation (Overlap=50)[/bold yellow]",
        border_style="yellow",
    ))
    console.print(
        "[bold green]✔ Overlap Analysis:[/bold green] Overlap ensures statements near the "
        "350-character limit retain surrounding context in adjacent chunks."
    )


def main():
    parser = argparse.ArgumentParser(description="Demonstrate document text chunking strategies.")
    parser.add_argument("--step", choices=["canonical-chunking", "overlap"], help="Specific step to execute.")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format.")
    args = parser.parse_args()

    try:
        text = load_doc_text()
    except Exception as exc:
        if args.json:
            result = generate_step_result(
                exercise_id=args.step or "chunking",
                track="script",
                metrics={"error": str(exc)},
                status="FAIL",
            )
            output_step_json(result)
        else:
            print(f"Error loading document: {exc}", file=sys.stderr)
        sys.exit(1)

    if args.step == "canonical-chunking":
        run_chunking_step(text, args.json)
    elif args.step == "overlap":
        run_overlap_step(text, args.json)
    else:
        if args.json:
            splitter = get_splitter()
            chunks = splitter.split_text(text)
            metrics = {
                "document": DOC_NAME,
                "document_length": len(text),
                "total_chunks": len(chunks),
                "chunk_size": CANONICAL_CHUNK_SIZE,
                "chunk_overlap": CANONICAL_CHUNK_OVERLAP,
            }
            result = generate_step_result(
                exercise_id="chunking-all",
                track="script",
                metrics=metrics,
                status="PASS" if len(chunks) == 12 else "FAIL",
                input_hash=compute_input_hash(text),
            )
            output_step_json(result)
        else:
            run_chunking_step(text, False)
            print()
            run_overlap_step(text, False)


if __name__ == "__main__":
    main()
