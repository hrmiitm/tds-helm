# RAG Studio Workspace — Foundations of RAG: Embeddings & Vector Search

Welcome to your hands-on computational workspace! This environment contains 6 interactive Jupyter notebooks, guided datasets, and assessments exploring the complete path from raw text chunks to learned embeddings, vector similarity math, PCA projections, ChromaDB indexing, and approximate nearest neighbor (ANN) graphs.

---

## 📂 Directory Layout

```
/workspace
├── notebooks/
│   ├── 00_markdown_chunking.ipynb          # Module A: Headings, paragraph splitters & word windows
│   ├── 01_vector_math.ipynb                # Module B: Cosine, Dot product & Squared Euclidean (L2) math
│   ├── 02_pca_and_embeddings.ipynb         # Module C: 3D PCA projection, latent space & MiniLM
│   ├── 03_chromadb_search.ipynb            # Module D: ChromaDB collection indexing, querying & metadata
│   ├── 04_ann_indexes.ipynb                # Module E: HNSW graph search & IVF inverted lists
│   └── 05_gemini_multimodal_optional.ipynb # Module F: Text vs multimodal embeddings (extension)
├── data/
│   ├── field_notes.md                      # Source document for chunking & inspection experiments
│   ├── toy_vectors.json                    # 10 pedagogical vectors (6D) for geometric intuition
│   └── cat_illustration.png                # Sample image for multimodal embedding demonstration
├── guides/
│   ├── TEACHING_NOTES.md                   # Facilitator guide, verbal questions & timing outline
│   └── REFERENCE_NOTEBOOK_REVIEW.md        # Technical architectural notes & reference review
└── assessments/
    ├── QUESTION_SHEET.md                   # Printable/readable question sheet (48 questions)
    ├── questions.json                      # Full structured MCQ and NAT question specification
    └── quiz.html                           # Browser self-graded assessment interface
```

---

## ⚡ Quick Start

1. Open **JupyterLab** or **VS Code** in the right pane.
2. Navigate to `notebooks/` and open `00_markdown_chunking.ipynb`.
3. Follow the tasks on the left pane under **Tasks & Labs** or inside the notebook's task board.
4. Run the code cells, modify parameters marked with `✏️ EDIT`, observe outputs, and submit your answers in the Tasks pane to track progress!
