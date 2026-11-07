# Field notes: Building a tiny RAG assistant

This reference document describes a small retrieval system. Students should inspect its text before choosing a chunking strategy. A chunk is a slice of source content, not an embedding and not an answer.

## Ingestion

The first step is loading source documents from files. Each document should retain a stable identifier and source metadata so a retrieved passage can later be cited.

Before adding a file to an index, check its encoding and remove duplicate files. Do not accidentally train or evaluate on the answer key.

## Chunking

A simple word window cuts a document into segments of fixed length. Overlap repeats a few previous words to preserve context across a boundary.

Too-small chunks can lose the connection between a claim and its evidence. Too-large chunks can mix unrelated topics and waste the embedding model's context window.

## Embeddings

An embedding model maps a chunk of text into a numerical vector. Similar vectors may capture semantic relatedness; the exact meaning depends on the model and task.

For retrieval, use compatible document and query embeddings from the same model and dimensions. Do not compare vectors from unrelated embedding spaces.

## Search

A nearest-neighbor search returns candidate chunks. Cosine similarity compares direction, whereas dot product also depends on length.

A squared Euclidean distance adds squared coordinate differences. Smaller distances mean nearer points, whereas larger cosine similarities mean more aligned points.

## Evaluation

Evaluate whether the relevant source passage appears in the top results. This is retrieval quality, not the same thing as the final answer being correct.

Also measure retrieval latency, index-build time, and storage. Approximate indexes can trade recall for faster or cheaper search.
