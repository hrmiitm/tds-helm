# Studio Universal v4.2 — Foundations of RAG: Embeddings & Vector Search 🚀

[![Version](https://img.shields.io/badge/version-4.2.0-blue.svg)](release-manifest.json)
[![Architecture](https://img.shields.io/badge/architecture-Universal%20Single--Port%20Hub-emerald.svg)](spec.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20(WSL2)%20%7C%20Linux-orange.svg)](#cross-platform-quick-start)
[![Engine](https://img.shields.io/badge/execution-Strict%20CPU%20(Offline%20MiniLM)-purple.svg)](#strict-offline--cpu-invariants)

A production-grade, containerized interactive hands-on learning lab and engineering environment. Studio Universal v4.2 unifies structured curriculum, computational JupyterLab notebooks, VS Code development, and interactive Reveal.js presentations into a **single-port universal hub** (`:8080`) serving both modern web browsers and native Electron desktop clients across Linux, macOS, and Windows.

---

## ⚡ Cross-Platform Quick Start

Studio Universal provides 1-command automated launchers that inspect your system, build container images if required, start the single-port hub on port 8080, and launch the Electron desktop shell (or browser fallback).

### Linux & macOS (Any Distribution / WSL2)

```bash
git clone https://github.com/hrmiitm/tds-helm.git
cd tds-helm
./setup.sh
```

To stop containers, prune volumes, and perform a 100% clean teardown:
```bash
./uninstall.sh
```

### Windows (PowerShell 5.1 / 7+)

```powershell
git clone https://github.com/hrmiitm/tds-helm.git
cd tds-helm
.\setup.ps1
```

To stop containers, prune volumes, and clean up on Windows:
```powershell
.\uninstall.ps1
```

---

## 🏛️ Architecture & Core Features

Studio Universal v4.2 introduces major UX and architectural advancements adhering to the `theclaymethod/unslop` human-centered design principles:

```
                                  ┌──────────────────────────────────────────────┐
                                  │                Learner Client                │
                                  │   (Web Browser  OR  Host Electron App)       │
                                  └──────────────────────┬───────────────────────┘
                                                         │ HTTP / WebSockets (Port 8080)
═════════════════════════════════════════════════════════╪════════════════════════════════════════════════
 Docker Container (Non-root `coder` UID 1000)            │
                                                         ▼
                                          ┌──────────────────────────────┐
                                          │     Nginx Gateway (:8080)    │
                                          └──────┬───┬───┬───┬───┬───────┘
                     ┌───────────────────────────┘   │   │   │   └──────────────────────────┐
                     │ /                             │   │   │                              │ /health/
                     ▼                               │   │   │                              ▼
        ┌─────────────────────────┐                  │   │   │                 ┌─────────────────────────┐
        │     Studio Web UI       │                  │   │   │                 │   Supervisor Probes     │
        │  (6 Modules, 48 Tasks,  │                  │   │   │                 │   /health/live (200)    │
        │   MCQs & NAT, State)    │                  │   │   │                 │   /health/ready (JSON)  │
        └─────────────────────────┘                  │   │   │                 └─────────────────────────┘
                                                     │   │   │
                     ┌───────────────────────────────┘   │   └──────────────────────────┐
                     │ /slides/                          │                              │ /preview/8000/
                     ▼                                   │                              ▼
        ┌─────────────────────────┐                      │                 ┌─────────────────────────┐
        │   Reveal.js + Plotly    │                      │                 │   Full-Stack API App    │
        │   43 Visual Slides,     │                      │                 │   FastAPI microservice  │
        │  3D PCA & HNSW Explorer │                      │                 │   (docs & OpenAPI spec) │
        └─────────────────────────┘                      │                 └─────────────────────────┘
                                                         │
                     ┌───────────────────────────────────┴──────────────────────────────┐
                     │ /vscode/                                                         │ /jupyter/
                     ▼                                                                  ▼
        ┌─────────────────────────┐                                        ┌─────────────────────────┐
        │   VS Code (code-server) │                                        │    JupyterLab 4.x       │
        │   Port 8081 (internal)  │                                        │   Port 8888 (internal)  │
        │   Terminal & Extensions │                                        │   Kernel: rag-kernel    │
        └─────────────────────────┘                                        └─────────────────────────┘
                                                         │
                                                         ▼
                                          ┌──────────────────────────────┐
                                          │      Shared /workspace       │
                                          │   6 Labs, Data, Notebooks,   │
                                          │   Pre-baked MiniLM Cache     │
                                          └──────────────────────────────┘
```

1. **True Immersive Focus Mode:**
   - Hides top chrome and expands active tools (VS Code, JupyterLab, Slides, or Excalidraw) to 100vw × 100vh.
   - Features an auto-hiding top HUD with instant exit and annotation toggles. Pressing `Esc` or clicking exit instantly restores the split workspace view.
2. **Persistent Annotator, iPad Laser & Floating Dock:**
   - **🔴 Laser**: iPad-style decaying neon trail with glowing outer halo (~2s fading decay) that works over all iframes (VS Code, Jupyter, Slides).
   - **✏️ Draw / Pen**: Smooth drawing with Bézier curves, highlighter, color picker, and eraser.
   - **👆 Interact**: Switches overlay canvas to `pointer-events: none`, allowing learners to freely click, scroll, and type in VS Code or Jupyter while preserving drawn annotations.
   - **Draggable Dock**: Grab handle allows positioning the toolbar anywhere on screen with boundary clamping.
3. **43-Slide Reveal.js Deck with Interview Ribbons & Official Documentation:**
   - 43 curated visual slides covering document chunking, high-dimensional latent space, vector metrics math, 3D PCA, HNSW graph traversal, IVF inverted lists, and ChromaDB architecture.
   - **Interview Thinking Prompt** on every slide encouraging learners to reason before revealing solutions.
   - **Official Documentation Link** on every slide directing to authoritative docs (ChromaDB, scikit-learn, Faiss, Gemini, Sentence-Transformers).
   - **Interactive Explorers**: Real-time chunking parameter slider, live similarity metric scaling, 3D PCA scatter plot using local offline Plotly, multi-layer HNSW graph hops, and IVF cluster probe visualizer.
4. **6 Pedagogical Labs & 48 Auto-Graded Tasks:**
   - 6 structured Jupyter notebooks containing embedded task boards, editable experiments, hints, and fully open worked answers.
   - 48 auto-graded questions (31 Numeric Answer Type + 17 Multiple Choice Questions) integrated directly into the Studio task runner with instant validation.

---

## 📚 Curriculum Structure (6 Modules · 48 Tasks)

The workshop is organized into **6 core modules** containing **48 interactive tasks**:

| Module | Code | Notebook | Topics & Practical Objectives | Tasks |
|:---:|:---:|---|---|:---:|
| **A** | `mod_chunking` | `00_markdown_chunking.ipynb` | Inspect source markdown, count headings/paragraphs/words, test word-window chunkers, and analyze chunk overlap trade-offs. | 8 |
| **B** | `mod_vector_math` | `01_vector_math.ipynb` | Compute and compare Cosine Similarity, Dot Product, and Squared Euclidean ($L2$) distance; study scaling invariance and the normalization identity $d^2 = 2 - 2\cos(\theta)$. | 10 |
| **C** | `mod_pca_embeddings` | `02_pca_and_embeddings.ipynb` | High-dimensional latent geometry, 6D toy vectors, 3D PCA variance projection, pairwise distance distortion, and pre-baked MiniLM embeddings. | 8 |
| **D** | `mod_chromadb` | `03_chromadb_search.ipynb` | `PersistentClient` setup, collection creation, explicit vector insertion, distance ranking, metadata filtering (`where`), and disk re-opening. | 8 |
| **E** | `mod_ann_indexes` | `04_ann_indexes.ipynb` | Approximate Nearest Neighbor algorithms: HNSW graph search (`ef_search`, $M$), IVF inverted file lists (`n_probe`), and Recall@k evaluation. | 8 |
| **F** | `mod_gemini_multimodal` | `05_gemini_multimodal_optional.ipynb` | Text-only vs multimodal models, shared embedding spaces, retrieval task types, API key security, and cross-modal search. | 6 |

---

## 📽️ Integrated Presentation Deck

The integrated presentation deck is accessible at `http://localhost:8080/slides/` or via the **Presentation Slides** tab:

- **Slides 01–06 (Module A):** Document ingestion, chunking trade-offs, and interactive chunk window sizing.
- **Slides 07–16 (Module C):** Representation geometry, "Why not store cat = 1, dog = 2?", multimodal inputs, and live 3D PCA rotation.
- **Slides 17–24 (Module B):** Vector distance metrics, Cosine vs Dot Product vs Squared $L2$, scaling playground, and normalization identities.
- **Slides 25–37 (Modules D & E):** Vector databases, exact search, HNSW multi-layer navigation, IVF cluster probes, ChromaDB query mechanics, and recall evaluation.
- **Slides 38–43 (Module F & RAG):** Gemini text vs multimodal models, end-to-end RAG architecture, retrieval failure modes, and retrospective checklist.

---

## 🔒 Security & Offline Invariants

1. **Non-Root Container:** All services run strictly as user `coder` (UID 1000).
2. **Deterministic Offline Embeddings:** The `sentence-transformers/all-MiniLM-L6-v2` model is pre-baked into `/opt/hf_cache/` at build time. Telemetry and external HuggingFace network calls are disabled (`HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`).
3. **Single CPU Thread Budget:** High-concurrency thread contention is prevented via `OMP_NUM_THREADS=1`, `MKL_NUM_THREADS=1`, `OPENBLAS_NUM_THREADS=1`, and `torch.set_num_threads(1)`.
4. **Token-Free XSRF-Protected JupyterLab:** JupyterLab runs behind Nginx with CSRF/XSRF cookie verification and WebSocket origin checks.
5. **Host-Native Electron:** Electron runs natively on the host machine connecting over HTTP/WebSocket, avoiding brittle X11 or display socket mounts.

---

## 📄 License & Credits

Built on open standards: code-server, JupyterLab, Reveal.js, Plotly, ChromaDB, hnswlib, and Sentence-Transformers.
Distributed under the Apache 2.0 License.
