# =============================================================================
# Studio Universal (v4.2.0) — Production Dockerfile
# Base: python:3.11-slim-bookworm (Debian 12 Bookworm)
# Architecture: Single-Port Universal Hub behind Nginx (port 8080)
# Engine: code-server + Native JupyterLab 4.x + Reveal.js/Three.js + Baked MiniLM
# Reference: spec.md Revision 4.2.0
# =============================================================================

FROM python:3.11-slim-bookworm

LABEL maintainer="Google DeepMind / Studio Universal Team"
LABEL description="Containerized Universal Hands-on Learning Platform"
LABEL version="4.2.0"

USER root

# 1. System packages & build prerequisites
RUN apt-get update && apt-get install -y --no-install-recommends \
        nginx \
        curl \
        ca-certificates \
        git \
        tini \
        util-linux \
        procps \
        libgomp1 \
        libstdc++6 \
        build-essential \
        python3-dev \
        chromium \
        xvfb \
        x11vnc \
        novnc \
        websockify \
        openbox \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 2. Install official code-server
RUN curl -fsSL https://code-server.dev/install.sh | sh

# 3. Create non-root learner user 'coder' (UID 1000)
RUN useradd -m -s /bin/bash -u 1000 coder && \
    mkdir -p /workspace /home/coder/.local/share/code-server/User /home/coder/.config/chromium \
    && chown -R coder:coder /workspace /home/coder

# 4. Create and configure Python 3.11 Virtual Environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# 5. Install PyTorch CPU and Course Dependencies
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir \
        torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir \
        "jupyterlab>=4.0.0" \
        "jupyter-server>=2.0.0" \
        ipykernel \
        "chromadb>=0.5.0" \
        "sentence-transformers>=3.0.0" \
        transformers \
        tokenizers \
        huggingface-hub \
        numpy \
        pandas \
        matplotlib \
        rich \
        pydantic \
        langchain-text-splitters \
        fastapi \
        uvicorn \
        "mcp>=1.0.0" \
        "fastmcp>=0.4.0"

# 6. Register canonical Jupyter kernelspec
RUN /opt/venv/bin/python -m ipykernel install --prefix=/opt/venv \
    --name rag-kernel --display-name 'Python 3.11 (RAG Stack)'

# 7. CPU Optimization & Model Caching Invariants (spec.md Section 4.2)
ENV PATH="/opt/venv/bin:$PATH" \
    RAG_MODEL_PATH=/opt/hf_cache/models/all-MiniLM-L6-v2 \
    HF_HOME=/opt/hf_cache \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TOKENIZERS_PARALLELISM=false \
    ANONYMIZED_TELEMETRY=False \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# 8. Bake Sentence-Transformers Model into Layer
COPY scripts/bake_model.py /tmp/bake_model.py
# Temporarily enable network for model baking, then restore offline invariants
RUN HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 python /tmp/bake_model.py /opt/hf_cache/models/all-MiniLM-L6-v2 && \
    rm /tmp/bake_model.py

# 9. Copy Web UI, Deck, Course Catalog, Schemas, and Gateway Config
COPY studio-web/ /usr/share/nginx/html/
COPY catalog/ /usr/share/nginx/html/catalog/
COPY courses/ /usr/share/nginx/html/courses/
COPY schemas/ /usr/share/nginx/html/schemas/
COPY authoring/ /opt/authoring/
COPY slides/ /usr/share/nginx/slides/
COPY nginx.conf /etc/nginx/nginx.conf
COPY config/jupyter_server_config.py /etc/jupyter/jupyter_server_config.py

# 10. Copy Scripts and Process Supervisor
COPY scripts/ /scripts/
COPY scripts/rag_healthcheck.py /usr/local/bin/rag-healthcheck
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /scripts/*.py /scripts/*.sh /usr/local/bin/rag-healthcheck /entrypoint.sh

# 11. Install Course Package into Virtual Environment
COPY packages/rag_course/ /tmp/rag-course-pkg/
RUN pip install --no-cache-dir /tmp/rag-course-pkg && rm -rf /tmp/rag-course-pkg

# 12. Seed Course Templates & Workspace
COPY course-templates/ /opt/course-templates/
COPY workspace/ /opt/course-template/

# 12. Create necessary runtime directories and set ownership
RUN mkdir -p /tmp/rag-config /tmp/rag-health /tmp/nginx/client /tmp/nginx/proxy \
    /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi /home/coder/.config/chromium && \
    chown -R coder:coder /workspace /home/coder \
    /tmp/rag-config /tmp/rag-health /tmp/nginx && \
    chmod -R a+rX /opt/course-templates /opt/course-template /opt/hf_cache /usr/share/nginx/html /usr/share/nginx/slides /opt/authoring /scripts

# 13. Expose Universal Hub Port & Set Healthcheck
EXPOSE 8080

HEALTHCHECK --interval=20s --timeout=10s --start-period=120s --retries=3 \
    CMD ["/usr/local/bin/rag-healthcheck"]

# 14. Switch to non-root learner user
USER coder
WORKDIR /workspace

ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/entrypoint.sh"]
