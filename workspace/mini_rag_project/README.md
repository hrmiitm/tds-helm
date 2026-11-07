# 🏢 Minimal Production RAG Project

A modular, production-structured Retrieval-Augmented Generation (RAG) system built with pure Python modules, ChromaDB vector storage (HNSW + Squared $L_2$ distance), and strict context grounding.

---

## 📂 Project Directory Structure

```
mini_rag_project/
├── data/
│   └── documents/
│       ├── Policy_01_RemoteWork.txt
│       ├── Policy_02_InformationSecurity.txt
│       └── Policy_03_TimeOffAndLeaves.txt
├── config.py           # Typed RAGConfig settings dataclass
├── ingest.py           # Document chunking & ChromaDB vector ingestion
├── retriever.py        # Semantic proximity retriever with HNSW + L2
├── generator.py        # Context synthesizer & refusal logic
├── main.py             # CLI application entry point
├── verify_rag.py       # Automated verification test suite (6/6 assertions)
├── requirements.txt    # Project dependencies
└── README.md           # Documentation & operational guide
```

---

## 🚀 Execution & Usage

### 1. Ingest Knowledge Base Documents
```bash
python ingest.py
```
Outputs chunk counts, vector indexing status, and creates the persistent ChromaDB collection (`corporate_policies`) using HNSW with Squared Euclidean ($L_2$) distance.

### 2. Query the Knowledge Base via CLI
```bash
python main.py --query "What is the policy for telecommuting and working from home?"
```

### 3. Run Automated Verification Tests
```bash
python verify_rag.py
```
Executes 6 automated assertions testing ingestion count, distance metric configuration, retrieval ranking, source citation fidelity, and out-of-domain hallucination refusal.

