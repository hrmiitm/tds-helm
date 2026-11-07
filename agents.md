# AGENTS.md — System Architecture & Operational Guide for Autonomous Agents & Engineers

> **Document Classification:** Engineering Architecture, Autonomous Subagent Specs, & Operational Manual  
> **Platform Version:** 4.2.0 (Studio Universal: Foundations of RAG & Vector Databases)  
> **Repository:** `tds-helm`  
> **Target Audience:** Autonomous AI coding agents (Antigravity, Cursor, Copilot, Cline, etc.) and DevOps engineers.

---

## 1. Project Mission & Mental Model

### 1.1 Core Objective
**Studio Universal v4.2** is a containerized, self-contained interactive learning platform designed for hands-on technical education in **Retrieval-Augmented Generation (RAG) & Vector Databases**. It unifies structured curriculum tasks, verified Python labs, interactive JupyterLab notebooks, VS Code, and professional Reveal.js slides into a single-port gateway (`http://127.0.0.1:8080`) accessible via native desktop applications (Electron) or any modern web browser across Linux, macOS, and Windows.

### 1.2 Universal Quick-Start Contracts
Any user or agent can clone this repository and immediately build and launch the environment with zero guesswork:
* **Linux / macOS / WSL2:**
  ```bash
  ./setup.sh
  ```
  *(Checks Docker/Node.js, builds `rag-studio:4.2.0` if missing, starts the host orchestrator gateway on port 8080, and launches the native Electron desktop client or browser).*
* **Windows (PowerShell):**
  ```powershell
  .\setup.ps1
  ```
* **Complete Clean Uninstallation:**
  ```bash
  ./uninstall.sh           # Linux / macOS
  .\uninstall.ps1          # Windows PowerShell
  ```
  *(Safely stops running containers, removes volume mounts, purges container images, and removes desktop application shortcuts without leaving orphaned resources).*

---

## 2. Directory Structure & Invariants

```
.
├── setup.sh                    # Universal 1-command launcher (Linux / macOS / WSL2)
├── setup.ps1                   # Universal 1-command launcher (Windows PowerShell)
├── uninstall.sh                # Clean uninstall launcher (Linux / macOS)
├── uninstall.ps1               # Clean uninstall launcher (Windows PowerShell)
├── clean-uninstall.sh          # Full-featured uninstaller engine with CLI flags
├── clean-uninstall.ps1         # Full-featured Windows uninstaller engine
├── Dockerfile                  # Multi-stage production container build (python:3.11-slim)
├── .dockerignore               # Build context filter
├── .gitignore                  # Git repository ignores (node_modules, venvs, caches)
├── entrypoint.sh               # Non-root process supervisor running under tini (UID 1000)
├── nginx.conf                  # Nginx internal reverse-proxy configuration
├── catalog/                    # Host-level Course Catalog registry
│   └── index.json              # Course metadata (rag-mcp: Foundations of RAG & Vector Databases)
├── catalog-ui/                 # Host Catalog UI (served when no chapter is running)
│   ├── index.html              # Catalog selection view & workspace container frame
│   ├── app.js                  # SSE lifecycle client, launch/stop/reset controller
│   └── style.css               # KodeKloud-inspired catalog styling
├── orchestrator/               # Host Node.js/TypeScript container orchestrator
│   ├── package.json            # Express + Docker/Podman engine adapters
│   ├── src/                    # TypeScript source (engine, state manager, gateway)
│   └── dist/                   # Compiled JavaScript (server.js, gateway router)
├── desktop-app/                # Native host-side Electron wrapper
│   ├── package.json            # Electron dependencies and build targets
│   ├── main.js                 # BrowserWindow, shortcut passthrough, safe navigation
│   ├── preload.js              # Secure IPC bridge
│   └── renderer.js             # Offline polling and reconnection logic
├── studio-web/                 # Dual-Pane Web Studio Interface
│   ├── index.html              # Dual-pane split view, modals, and tool tabs
│   ├── app.js                  # Studio state manager, annotator, focus mode controller
│   ├── style.css               # Unified studio stylesheet
│   └── tasks.json              # Canonical task instructions and verification questions
├── slides/                     # Offline Presentation Deck (43 Curated Slides)
│   ├── index.html              # Reveal.js presentation with interview ribbons & doc links
│   ├── dist/                   # Local bundled Reveal.js engine and CSS
│   ├── vendor/                 # Local offline Plotly for 3D PCA plot
│   └── data/                   # Sample image for cross-modal slide
├── courses/
│   └── rag-mcp/                # Canonical Course Content Bundle
│       ├── course.yaml         # Course definition schema (v2, 6 modules, slideIds, taskIds)
│       ├── tasks.json          # 48 interactive tasks across 6 modules
│       ├── slides/             # Slides mirror for container packaging
│       └── workspace/          # Starter template files populated into learner workspace
├── workspace/                  # Learner Computational Workspace (mounted into container)
│   ├── notebooks/              # 6 Interactive JupyterLab notebooks (00 through 05)
│   │   ├── 00_markdown_chunking.ipynb          # Module A: Headings, paragraphs, word windows
│   │   ├── 01_vector_math.ipynb                # Module B: Cosine, Dot product & Squared L2 math
│   │   ├── 02_pca_and_embeddings.ipynb         # Module C: 3D PCA projection & toy vectors
│   │   ├── 03_chromadb_search.ipynb            # Module D: ChromaDB collection indexing & query
│   │   ├── 04_ann_indexes.ipynb                # Module E: HNSW graph search & IVF inverted lists
│   │   └── 05_gemini_multimodal_optional.ipynb # Module F: Gemini text & multimodal embeddings
│   ├── data/                   # field_notes.md, toy_vectors.json, cat_illustration.png
│   ├── guides/                 # TEACHING_NOTES.md & REFERENCE_NOTEBOOK_REVIEW.md
│   └── assessments/            # QUESTION_SHEET.md, questions.json & quiz.html
└── packages/
    └── rag_course/             # Local Python package pre-installed in container
```

---

## 3. High-Level Architecture & Network Flow

```
                               ┌────────────────────────────────────────────────────────┐
                               │                    User Client                         │
                               │   (Native Electron App  OR  Modern Web Browser)        │
                               └──────────────────────────┬─────────────────────────────┘
                                                          │ HTTP / WebSockets
                                                          ▼
                               ┌────────────────────────────────────────────────────────┐
                               │        Host Orchestrator Gateway (Port 8080)           │
                               │  - Serves catalog-ui/ when idle                        │
                               │  - Manages single-active container lifecycle           │
                               │  - Proxies traffic to dynamic container port           │
                               └──────────────────────────┬─────────────────────────────┘
                                                          │ Internal Proxy Port
                                                          ▼
        ══════════════════════════════════════════════════╪══════════════════════════════════════
         Docker Container: rag-studio-rag-mcp             │ (Non-root user `coder` UID 1000)
                                                          ▼
                                           ┌─────────────────────────────┐
                                           │    Container Nginx Gateway  │
                                           └──────┬───┬───┬───┬───┬──────┘
                   ┌──────────────────────────────┘   │   │   │   └───────────────────────┐
                   │ /                                │   │   │                           │ /health/
                   ▼                                  │   │   │                           ▼
        ┌─────────────────────┐                       │   │   │                ┌──────────────────────┐
        │  Studio Web Shell   │                       │   │   │                │ Supervisor Health    │
        │  (HTML/CSS/JS)      │                       │   │   │                │ Live / Ready Checks  │
        └──────────┬──────────┘                       │   │   │                └──────────────────────┘
                   │                                  │   │   │
        ┌──────────┴──────────┐                       │   │   └───────────────┐
        │ Left Pane Embed     │                       │   │                   │ /preview/8000/
        │ - Tasks & Labs      │                       │   │                   ▼
        │ - Presentation Deck │                       │   │        ┌──────────────────────────┐
        │   (/slides/)        │                       │   │        │ User FastAPI App         │
        └─────────────────────┘                       │   │        │ OpenAPI Docs & Endpoints │
                                                      │   │        └──────────────────────────┘
                                                      │   │
                                     ┌────────────────┘   └────────────────┐
                                     │ /vscode/                            │ /jupyter/
                                     ▼                                     ▼
                          ┌─────────────────────┐               ┌─────────────────────┐
                          │   code-server       │               │    JupyterLab 4     │
                          │   VS Code Engine    │               │   Python 3.11 RAG   │
                          └─────────────────────┘               └─────────────────────┘
```

---

## 4. The 8-Slide Pedagogical Curriculum

All slides are bundled offline in [`slides/index.html`](file:///home/kit/Documents/Sep2026/TDS/agent-rag-learning/slides/index.html) and styled with 16:9 responsive layouts:

1. **Slide 1: Multimodal Embeddings & Latent Space Projections**
   - 5 Chunks: `"Cat"`, `"Dog"`, `"On the table cat is there."`, `Cat Image [Visual]`, `Pet Care Video [YouTube]`.
   - Joint Multimodal Embedding Model $\to$ Dense 384-d vectors $\to$ PCA 3D Projections.
   - Interactive Three.js 3D vector space with origin $(0,0,0)$, labeled axes, and mathematical inspector.
   - *Interview Question:* Why do modern embedding models output unusual dimensions (e.g., 384, 768, 1536) instead of round numbers?
2. **Slide 2: Vector Similarity & Indexing Architectures**
   - Similarity Metrics: Cosine Similarity, Dot Product, Squared Euclidean Distance ($L_2^2$, default in ChromaDB).
   - Indexing Methods: HNSW (Hierarchical Navigable Small World, default in ChromaDB) and IVF (Inverted File Index).
   - Comprehensive comparative architectural matrix.
   - *Interview Question:* When is Dot Product identical to Cosine Similarity, and why does ChromaDB use Squared $L_2$ by default?
3. **Slide 3: Vector Similarity Mathematics & Slide-1 Case Study**
   - Mathematical formulations: $\cos(\theta)$, $\mathbf{u} \cdot \mathbf{v}$, $d^2 = 2 - 2\cos(\theta)$.
   - Exact numerical step-by-step calculations across all 5 chunks from Slide 1.
   - **Interactive 3D PCA Similarity Visualizer:** Real-time SVG isometric vector projection showing vectors $\mathbf{u}$, $\mathbf{v}$, distance chord $d^2$, and angle arc $\theta$.
   - *Interview Question:* What is the "curse of dimensionality" in distance metrics, and why does Cosine similarity outperform raw Euclidean distance?
4. **Slide 4: Vector Indexing Mechanisms: IVF & HNSW Deep Dive**
   - IVF: $k$-means Voronoi partitioning, centroids, inverted posting lists, $n_{\text{probe}}$ search.
   - HNSW: Skip-list hierarchy, layer decay factor $P(l) = \frac{1}{m_L}\exp(-l/m_L)$, greedy multi-layer search, $efSearch$.
   - Latency, memory footprint, boundary recall, and streaming ingestion matrix.
   - *Interview Question:* Why do traditional spatial database indexes (like B-trees or R-trees) fail in high-dimensional search?
5. **Slide 5: ChromaDB Execution Engine: HNSW + L2 Search Mechanics**
   - `hnswlib` C++ engine, SIMD AVX-512 acceleration, and default hyperparameter configuration.
   - Executable Python search snippet with ChromaDB.
   - **Interactive ChromaDB Query Simulator:** Live HNSW beam search simulation through layers with sub-millisecond execution telemetry.
   - *Interview Question:* In ChromaDB, what does a distance score of 0.0 vs 0.64 mean, and how do you convert $L_2$ distance into a normalized percentage?
6. **Slide 6: Document Chunking Strategies & Overlap Math**
   - Fixed-size vs recursive character splitting.
   - Overlap window mathematics: $N = \lceil \frac{L - O}{S - O} \rceil$.
   - Interactive visual chunk stepper highlighting active text and duplicate overlap.
   - *Interview Question:* What trade-offs govern chunk size and overlap selection, and how does sliding overlap resolve sentence truncation?
7. **Slide 7: Grounded Prompt Synthesis & Source Attribution**
   - Prompt anatomy: system context, retrieved documents, bracketed citations `[Doc 1]`, and strict refusal directives.
   - Interactive prompt component builder.
   - *Interview Question:* What prompt constraints are required to enforce context grounding and prevent parametric hallucinations?
8. **Slide 8: Production RAG System: Modular Python Architecture**
   - Transitioning from exploratory notebooks to decoupled production Python modules (`ingest.py`, `retriever.py`, `generator.py`, `main.py`).
   - Production FastAPI microservice serving `/query` and `/health`.
   - *Interview Question:* Why is a decoupled modular architecture preferred over single-file monoliths or notebooks in production RAG systems?

---

## 5. Focus View & Fullscreen Sizing Contracts

To avoid UI regression, agents and developers must uphold these display invariants:
1. **Top Bar Header Visibility:**
   - In Focus View (`body.immersive-focus`), `.app-header` stays visible at `z-index: 1002` with high-contrast, glowing action buttons on the top bar:
     - `[ ✕ Exit Focus (Esc) ]` (rose badge)
     - `[ ✏️ Annotate ]` (cyan badge)
   - When opened in the outer catalog frame, `#catalog-focus-controls` in `catalog-ui/index.html` displays these identical top-bar controls.
   - In Fullscreen Slides modal (`#fullscreen-slides-modal`), `.modal-fullscreen-header` is fixed at the top with dedicated Annotate and Exit Focus controls.
2. **Reveal.js Layout Recalculation:**
   - Whenever view mode changes (focus toggled, pane tab switched, window resized), the parent window MUST post message `{ type: 'REVEAL_LAYOUT' }` to the slides iframe.
   - `slides/app.js` runs `triggerRevealLayout()`, calling `Reveal.layout()` and Three.js `camera.updateProjectionMatrix()` + `renderer.setSize()`.
   - `.reveal-viewport` MUST use `width: 100% !important; height: calc(100vh - 52px) !important;` to ensure slides never display as a blank or black surface.

---

## 6. Verification & Automated Testing

Automated end-to-end tests verify system integrity:
* **UI & Slides Rendering Verification:**
  ```bash
  node -e "require('./scratch/test_studio_e2e.js')" # or standalone puppeteer/CDP scripts
  ```
  *(Confirms Split View, Focus View, Fullscreen Modal, KaTeX equations, and 3D vector space render with 0 console errors).*
* **Python RAG Lab Test Suite:**
  ```bash
  python workspace/mini_rag_project/verify_rag.py --json
  ```
  *(Tests ingestion, ChromaDB querying, answer generation, and source attribution).*
* **Engine Preflight Inventory:**
  ```bash
  ./clean-uninstall.sh --dry-run
  ```
