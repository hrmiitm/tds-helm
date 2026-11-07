# Review of the instructor-supplied reference notebooks

Original attachments examined:

- `Gerate_Embeddings_Using_Gemini.ipynb` — showed Gemini Embedding 001 text arrays, cosine matrices, PCA 3D scatter plots, and an early Chroma write/query example.
- `Demo_Storing_and_Querying_ChromaDB.ipynb` — showed Colab Secrets, Gemini 001 embedding generation, writing to Chroma and querying vector embeddings.

## What the new curriculum preserves

The eight-example programming/phones/lights/Apple comparison idea, explicit embedding dimensionality, covariance-free cosine similarity demonstration, PCA interactive 3D view, stored embeddings and query flow.

## What the new curriculum updates

1. Clear separation of **learned semantic embeddings** and **manually authored illustrative vectors**.
2. A fixed accessible Markdown document and reproducible chunk count tasks before embeddings.
3. Cosine, dot and squared-L2 arithmetic before database lookup; explicit score directions.
4. PCA showing **different** projected coordinates and demonstrating projection distance loss.
5. Modern `chromadb.PersistentClient(path=...)` rather than `chromadb.Client(Settings(persist_directory=...))`.
6. Newer Chroma collection `configuration={"hnsw":{"space":"l2"}}` rather than legacy metadata-only HNSW settings.
7. Optional `gemini-embedding-2` for text/image comparison; **Gemini 001 is text-only**.
8. Fixed NAT outputs from offline exercises; online model outputs are never treated as fixed numeric answers.
9. Offline browser self-test and solution key for the instructor.

The reference notebooks were used for teaching coverage, not blindly concatenated or duplicated.
