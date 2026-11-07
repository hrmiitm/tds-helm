# Facilitator guide · Embedding / Lab

**Audience:** Python-familiar students beginning practical embeddings and vector search. The workshop is optimized for self-paced use and an instructor-led walkthrough.

## Expected learning outcomes

Students can distinguish raw document, chunk, learned embedding, similarity metric, ANN index and vector database; calculate cosine/dot/squared-L2; explain PCA's projection limits; build Chroma with explicit embeddings; contrast HNSW and IVF and measure recall@k; distinguish Gemini text-only vs multimodal capabilities.

## Suggested teaching outline (120 minutes instructor-led, or 3–5 hours self-paced)

| Time | Topic | Student action |
|---|---|---|
| 00–15 | Why retrieval, chunks, overlap | Run Lab A and submit A quiz |
| 15–40 | Embedding vector + formulas | Draw q,a,b and run Lab B |
| 40–60 | 3D PCA and toy vs real models | Rotate slide plot; run Lab C |
| 60–85 | Chroma storage / scoring / filters | Run Lab D; explain distances |
| 85–105 | Exact vs HNSW vs IVF | Run Lab E; vary n_probe |
| 105–120 | Learned models + RAG recap | Discuss Lab F; short retrieval retrospective |

## Prepared questions to ask verbally

1. If two embeddings have 768 dimensions, does that imply compatible semantic coordinates? **No.**
2. Does Chroma's `l2` return the Euclidean distance sqrt(sum squares)? **No, squared distance.**
3. Is HNSW a distance metric? **No, an approximate search index.**
4. Why is a PCA plot dangerous as evidence of quantitative similarity? **Projection discards information.**
5. Does a great ANN recall guarantee a correct RAG answer? **No, later generation and evidence use can fail.**

## Review/edit checkpoints

- A: students must inspect real Markdown. Change 40/10 → 60/10 → 40/0. Correct chunk totals 10, 6, 8.
- B: cosine q/a = 1; dot q/a = 2; squared-L2 q/a = 1. Scaling to s=5 changes dot to 10, not cosine.
- C: each 6D toy vector → 3D PCA; the projection changes some pairwise distances; 3D coordinates must differ among records.
- D: use `PersistentClient(path=...)`, not older `Settings(persist_directory=...)` pattern. The 10 toy records can be queried without model download.
- E: `n_probe=12` scans all 12 IVF lists; `ef_search` is an HNSW knob. Recall@k compares with exact results.
- F: optional online calls; keep keys in Secrets/environment. Gemini 001 for text; Embedding 2 for cross-modal.

## Known environment limitations

Chroma, hnswlib and Gemini are not installed on every classroom machine. Run `%pip` cells and allow a restart if the notebook kernel has imported conflicting packages. Colab may change dependency versions. If Gemini's current production model ID differs by region or account, check its linked documentation. Do not grade any API-produced cosine as a fixed NAT — embeddings/provider versions can change.

## Release management

Distribute the **same unified ZIP** to everyone. Each notebook has an end-of-lab **Hints** section and **fully open worked answers**; invite students to attempt tasks before scrolling. The browser's answer-checking script is inspectable and unsuitable for secure exams. If you need proctored grades, use a private, server-side grader instead.
