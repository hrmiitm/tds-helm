# Studio Universal v4.2 — Foundations of RAG & Vector Databases 🚀

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
        │  (5-Mode Slot Manager,  │                  │   │   │                 │   /health/live (200)    │
        │   Tasks, MCQs, State)   │                  │   │   │                 │   /health/ready (JSON)  │
        └─────────────────────────┘                  │   │   │                 └─────────────────────────┘
                                                     │   │   │
                     ┌───────────────────────────────┘   │   └──────────────────────────┐
                     │ /slides/                          │                              │ /preview/8000/
                     ▼                                   │                              ▼
        ┌─────────────────────────┐                      │                 ┌─────────────────────────┐
        │   Reveal.js + Three.js  │                      │                 │   Full-Stack API App    │
        │   Interactive 3D Deck   │                      │                 │   FastAPI microservice  │
        │  & Dimension Inspector  │                      │                 │   (docs & OpenAPI spec) │
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
                                          │   Data, Labs, Notebooks,     │
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
3. **Reveal.js Deck with KaTeX Typography & Three.js 3D Space:**
   - Bundled offline KaTeX (`slides/vendor/katex/`) rendering crisp mathematical formulas ($\mathbf{W}, \mathbf{b}, d_{L2}^2, \text{Sim}_{\cos}$).
   - 3D interactive WebGL vector space visualizer with PCA projections, cluster semantics, and collapsible interview questions on every slide.
4. **Pedagogical Notebooks & Modular Production System:**
   - 3 guided notebooks step-by-step through environment verification, mathematical similarity, and ChromaDB vector indexing.
   - Production Python package `mini_rag_project/` demonstrating real-world clean architecture with `config.py`, `ingest.py`, `retriever.py`, `generator.py`, and `main.py`.

---

## 📚 Curriculum Structure

The course is organized into **3 core modules** with **7 interactive tasks**, supported by both hands-on Jupyter notebooks and standalone Python scripts:

| Module | Title | Notebook Track | Modular Python Track | Verification Objective |
|:---:|---|---|---|---|
| **0** | **Workspace & Knowledge Base Setup** | `00_environment_and_workspace_setup.ipynb` | `labs/00_env_check.py` | CPU offline model verification, ChromaDB storage validation, and directory permissions. |
| **1** | **Embeddings, Similarity & Indexing** | `01_embeddings_similarity_and_indexing.ipynb` | `labs/embeddings_lab.py`<br>`labs/chunking_lab.py` | 384-dim sentence embeddings, Cosine vs Dot Product vs L2 distance math, and HNSW graphs. |
| **2** | **ChromaDB & Production Mini-RAG** | `02_chromadb_setup_ingestion_retrieval.ipynb` | `mini_rag_project/main.py`<br>`mini_rag_project/verify_rag.py` | Persistent collection indexing, metadata filtering, top-k retrieval, and grounded citation prompt assembly. |

### Diagnostic Verification Gate
Learners and CI pipelines can run the end-to-end diagnostic verifier at any time:
```bash
python /workspace/labs/verify_rag.py --json
# or for the production project:
python /workspace/mini_rag_project/verify_rag.py
```

---

## 📽️ Reveal.js Presentation Deck

The integrated presentation deck is accessible at `http://localhost:8080/slides/` or via the **Presentation Slides** tab:

1. **Slide 1 — Multimodal Embeddings & High-Dimensional Projections:**
   - Text chunks, images, and video represented as high-dimensional vectors ($D=384$) projected to 3D with PCA.
   - Collapsible Interview Question: *Why do embedding models output fixed-length vectors regardless of input token length?*
2. **Slide 2 — Vector Similarity Metrics Overview:**
   - Comparison of Cosine Similarity, Dot Product, and Squared Euclidean Distance ($L2$ — ChromaDB default).
   - Collapsible Interview Question: *When are Cosine Similarity and Squared Euclidean Distance monotonically equivalent?*
3. **Slide 3 — Similarity Mathematics & Geometric Projections:**
   - Full mathematical formulas, angle geometry, unit hypersphere normalization, and numerical examples.
   - Collapsible Interview Question: *Why does ChromaDB use Squared Euclidean ($L2^2$) rather than standard Euclidean ($L2$)?*
4. **Slide 4 — Vector Indexing Architecture (HNSW vs IVF):**
   - Skip-list inspired Hierarchical Navigable Small World graphs vs Inverted File Index clustering.
   - Collapsible Interview Question: *What is the curse of dimensionality, and why do exact k-NN searches fail at scale?*
5. **Slide 5 — ChromaDB Query Engine & HNSW Search Mechanics:**
   - Multi-layer graph traversal, beam search `efSearch`, and distance computations.
   - Collapsible Interview Question: *What happens if `efSearch` is smaller than top-$k$, and how does it impact recall?*
6. **Slide 6 — Grounded RAG Pipeline & Synthesis:**
   - Query embedding, semantic retrieval, context window assembly, and citation grounding.
   - Collapsible Interview Question: *How do you prevent the Lost-in-the-Middle phenomenon when feeding multiple retrieved chunks into an LLM?*
7. **Slide 7 — Retrieval Failure Modes & Production Defenses:**
   - Lexical mismatch, semantic drift, chunk fragmentation, and mitigation via hybrid search / reranking.
   - Collapsible Interview Question: *How do you evaluate RAG retrieval quality without human labels in production?*
8. **Slide 8 — End-to-End Hands-on RAG Architecture:**
   - Visual architectural pipeline mapping raw documents to clean answers, linking directly to `mini_rag_project/`.
   - Collapsible Interview Question: *How do you handle real-time document updates and deletions in a persistent vector database without full re-indexing?*

---

## 🔒 Security & Offline Invariants

1. **Non-Root Container:** All services run strictly as user `coder` (UID 1000).
2. **Deterministic Offline Embeddings:** The `sentence-transformers/all-MiniLM-L6-v2` model is pre-baked into `/opt/hf_cache/` at build time. Telemetry and external HuggingFace network calls are disabled (`HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`).
3. **Single CPU Thread Budget:** High-concurrency thread contention is prevented via `OMP_NUM_THREADS=1`, `MKL_NUM_THREADS=1`, `OPENBLAS_NUM_THREADS=1`, and `torch.set_num_threads(1)`.
4. **Token-Free XSRF-Protected JupyterLab:** JupyterLab runs behind Nginx with CSRF/XSRF cookie verification and WebSocket origin checks.
5. **Host-Native Electron:** Electron runs natively on the host machine connecting over HTTP/WebSocket, avoiding brittle X11 or display socket mounts.

---

## 📄 License & Credits

Built on open standards: code-server, JupyterLab, Reveal.js, Three.js, KaTeX, ChromaDB, and Sentence-Transformers.
Distributed under the Apache 2.0 License.
