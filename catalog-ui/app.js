// catalog-ui/app.js — Studio Universal Chapter Hub & Orchestrator Frontend

(() => {
  'use strict';

  // State Management
  const state = {
    chapters: [],
    activeChapterId: null,
    activeSessionUrl: null,
    currentOperation: null,
    engine: { type: 'docker', connected: true },
    theme: localStorage.getItem('studio_theme') || 'dark',
    pendingResetChapterId: null,
    isBusy: false
  };

  // DOM Elements
  const dom = {
    catalogView: document.getElementById('catalog-view'),
    workspaceView: document.getElementById('workspace-view'),
    chaptersGrid: document.getElementById('chapters-grid'),
    chapterSearch: document.getElementById('chapter-search'),
    engineStatusBadge: document.getElementById('engine-status-badge'),
    engineDot: document.getElementById('engine-dot'),
    engineNameLabel: document.getElementById('engine-name-label'),
    btnRefreshCatalog: document.getElementById('btn-refresh-catalog'),
    btnToggleTheme: document.getElementById('btn-toggle-theme'),
    toastContainer: document.getElementById('toast-container'),
    
    // Operation Banner
    operationBanner: document.getElementById('operation-banner'),
    operationStatusText: document.getElementById('operation-status-text'),
    btnCancelOperation: document.getElementById('btn-cancel-operation'),

    // Workspace View
    workspaceIframe: document.getElementById('workspace-iframe'),
    btnBackToCatalog: document.getElementById('btn-back-to-catalog'),
    activeChapterBadge: document.getElementById('active-chapter-badge'),
    activeChapterName: document.getElementById('active-chapter-name'),

    // Modals
    modalBack: document.getElementById('modal-back'),
    btnStopAndReturn: document.getElementById('btn-stop-and-return'),
    btnKeepAndReturn: document.getElementById('btn-keep-and-return'),
    btnCancelReturn: document.getElementById('btn-cancel-return'),

    modalReset: document.getElementById('modal-reset'),
    resetChapterTargetName: document.getElementById('reset-chapter-target-name'),
    btnCancelReset: document.getElementById('btn-cancel-reset'),
    btnConfirmReset: document.getElementById('btn-confirm-reset')
  };

  // Determine API base: Electron IPC bridge or HTTP Fetch
  const isElectron = !!(window.studioDesktop && window.studioDesktop.isElectron);

  async function apiCall(method, path, body = null) {
    if (isElectron) {
      return await window.studioDesktop.invokeApi(method, path, body);
    }
    const res = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: body ? JSON.stringify(body) : null
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || err.error || `API error ${res.status}`);
    }
    return await res.json();
  }

  // =========================================================================
  // TOAST NOTIFICATIONS (Replaces blocking alerts)
  // =========================================================================
  function showToast(message, type = 'info', duration = 4000) {
    const container = dom.toastContainer || document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `studio-toast toast-${type}`;

    const iconSvg = type === 'error'
      ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
      : type === 'success'
      ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`
      : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;

    toast.innerHTML = `
      <span class="toast-icon">${iconSvg}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
      <button class="toast-close" title="Dismiss">&times;</button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.classList.add('toast-fadeout');
      setTimeout(() => toast.remove(), 200);
    });

    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add('toast-fadeout');
        setTimeout(() => toast.remove(), 200);
      }
    }, duration);
  }

  // =========================================================================
  // INITIALIZATION
  // =========================================================================
  async function init() {
    applyTheme(state.theme);
    setupEventListeners();
    await refreshState();
    startEventStream();
  }

  function applyTheme(theme) {
    state.theme = theme;
    localStorage.setItem('studio_theme', theme);
    document.body.className = theme === 'light' ? 'light-theme' : 'dark-theme';
  }

  function setupEventListeners() {
    // Theme toggle
    dom.btnToggleTheme.addEventListener('click', () => {
      applyTheme(state.theme === 'light' ? 'dark' : 'light');
    });

    // Refresh
    dom.btnRefreshCatalog.addEventListener('click', async () => {
      showToast('Refreshing catalog...', 'info', 1500);
      await refreshState();
    });

    // Search
    dom.chapterSearch.addEventListener('input', (e) => {
      renderChapters(e.target.value.toLowerCase().trim());
    });

    // Cancel operation
    dom.btnCancelOperation.addEventListener('click', async () => {
      if (state.currentOperation?.operationId) {
        try {
          await apiCall('POST', `/orchestrator/v1/operations/${state.currentOperation.operationId}/cancel`);
          showToast('Operation cancelled', 'info');
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
      hideOperation();
      setBusy(false);
    });

    // Back to catalog from workspace
    dom.btnBackToCatalog.addEventListener('click', () => {
      dom.modalBack.classList.remove('hidden');
    });

    // Persistent Focus Controls on Top Bar
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'STUDIO_FOCUS_STATE') {
        const controls = document.getElementById('catalog-focus-controls');
        if (controls) {
          if (event.data.isFocused) {
            controls.classList.remove('hidden');
          } else {
            controls.classList.add('hidden');
          }
        }
      }
    });

    const btnCatalogAnnotate = document.getElementById('btn-catalog-annotate');
    if (btnCatalogAnnotate) {
      btnCatalogAnnotate.addEventListener('click', () => {
        dom.workspaceIframe?.contentWindow?.postMessage({ type: 'toggle-annotation', mode: 'pen' }, '*');
      });
    }

    const btnCatalogExitFocus = document.getElementById('btn-catalog-exit-focus');
    if (btnCatalogExitFocus) {
      btnCatalogExitFocus.addEventListener('click', () => {
        dom.workspaceIframe?.contentWindow?.postMessage({ type: 'EXIT_FOCUS' }, '*');
        document.getElementById('catalog-focus-controls')?.classList.add('hidden');
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const controls = document.getElementById('catalog-focus-controls');
        if (controls && !controls.classList.contains('hidden')) {
          dom.workspaceIframe?.contentWindow?.postMessage({ type: 'EXIT_FOCUS' }, '*');
          controls.classList.add('hidden');
        }
      }
    });

    dom.btnCancelReturn.addEventListener('click', () => {
      dom.modalBack.classList.add('hidden');
    });

    dom.btnStopAndReturn.addEventListener('click', async () => {
      dom.modalBack.classList.add('hidden');
      if (state.activeChapterId) {
        await stopChapter(state.activeChapterId);
      }
      showCatalogView();
    });

    dom.btnKeepAndReturn.addEventListener('click', () => {
      dom.modalBack.classList.add('hidden');
      showCatalogView();
    });

    // Reset Modal
    dom.btnCancelReset.addEventListener('click', () => {
      dom.modalReset.classList.add('hidden');
      state.pendingResetChapterId = null;
    });

    dom.btnConfirmReset.addEventListener('click', async () => {
      const chapterId = state.pendingResetChapterId;
      dom.modalReset.classList.add('hidden');
      if (chapterId) {
        await resetChapter(chapterId);
      }
    });
  }

  // =========================================================================
  // STATE & DATA REFRESH
  // =========================================================================
  async function refreshState() {
    try {
      // 1. Fetch system state
      let stateData = null;
      try {
        stateData = await apiCall('GET', '/orchestrator/v1/state');
      } catch (e) {
        stateData = {
          engine: { type: 'docker', connected: true },
          activeChapterId: null,
          currentOperation: null,
          sessionUrl: null
        };
      }

      state.engine = stateData.engine || state.engine;
      state.activeChapterId = stateData.activeChapterId;
      state.activeSessionUrl = stateData.sessionUrl;
      state.currentOperation = stateData.currentOperation;
      updateEngineBadge();

      // 2. Fetch chapters catalog
      let chaptersData = [];
      try {
        const catRes = await apiCall('GET', '/orchestrator/v1/chapters');
        chaptersData = catRes.chapters || [];
      } catch (e) {
        chaptersData = [
          {
            id: 'rag-mcp',
            title: 'Foundations of RAG & Vector Databases',
            badge: 'RAG & Vector Search',
            description: 'Master multimodal embeddings, vector similarity math, ChromaDB HNSW indexing, and modular Python RAG systems.',
            difficulty: 'Intermediate',
            estimatedMinutes: 180,
            tasks: 10,
            state: state.activeChapterId === 'rag-mcp' ? 'RUNNING' : 'NOT_STARTED'
          }
        ];
      }

      state.chapters = chaptersData;
      renderChapters(dom.chapterSearch.value.toLowerCase().trim());

    } catch (err) {
      console.error('Failed to refresh orchestrator state:', err);
    }
  }

  function updateEngineBadge() {
    dom.engineNameLabel.textContent = (state.engine.type || 'Docker').toUpperCase();
    dom.engineDot.className = `status-dot ${state.engine.connected ? 'status-connected' : 'status-error'}`;
    dom.engineStatusBadge.title = state.engine.connected ? `Connected to ${state.engine.type}` : 'Engine disconnected';
  }

  // =========================================================================
  // RENDER CHAPTER CARDS
  // =========================================================================
  function renderChapters(query = '') {
    dom.chaptersGrid.innerHTML = '';

    const filtered = state.chapters.filter(ch => {
      if (!query) return true;
      return ch.title.toLowerCase().includes(query) ||
             (ch.description && ch.description.toLowerCase().includes(query)) ||
             ch.id.toLowerCase().includes(query);
    });

    if (filtered.length === 0) {
      dom.chaptersGrid.innerHTML = '<div class="loading-placeholder">No chapters found matching your query.</div>';
      return;
    }

    filtered.forEach(chapter => {
      const chState = chapter.state || chapter.status || (state.activeChapterId === chapter.id ? 'RUNNING' : 'NOT_STARTED');
      const isRunning = (chState === 'RUNNING' || state.activeChapterId === chapter.id);
      const isStopped = (chState === 'STOPPED');
      const isBusy = (state.isBusy || chState === 'STARTING' || chState === 'PREPARING' || chState === 'STOPPING' || chState === 'RESETTING');

      const card = document.createElement('div');
      card.className = `chapter-card ${isRunning ? 'card-running' : ''} ${state.isBusy ? 'card-busy' : ''}`;
      card.dataset.id = chapter.id;

      let statusDotClass = 'status-stopped';
      let statusLabel = 'Not Started';

      if (isRunning) {
        statusDotClass = 'status-healthy';
        statusLabel = 'Running (Port 8080)';
      } else if (isStopped) {
        statusDotClass = 'status-stopped';
        statusLabel = 'Stopped';
      } else if (isBusy) {
        statusDotClass = 'status-busy';
        statusLabel = formatPhaseName(chState);
      }

      const badgeClass = chapter.id === 'mcp-agentic' ? 'badge-ch2' : '';

      card.innerHTML = `
        <div class="card-top">
          <span class="chapter-badge ${badgeClass}">${escapeHtml(chapter.badge || chapter.id)}</span>
          <span class="card-status-pill">
            <span class="status-dot ${statusDotClass}"></span>
            <span class="status-text-label">${statusLabel}</span>
          </span>
        </div>

        <h3 class="chapter-title">${escapeHtml(chapter.title)}</h3>
        <p class="chapter-description">${escapeHtml(chapter.description || '')}</p>

        <div class="card-meta-row">
          <span class="meta-item">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            ${chapter.estimatedMinutes || 120} min
          </span>
          <span class="meta-item">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
            ${chapter.tasks || 10} Tasks
          </span>
          <span class="meta-item">
            ${chapter.difficulty || 'Intermediate'}
          </span>
        </div>

        <div class="card-actions-row">
          ${isRunning ? `
            <button class="btn-success btn-action-launch" data-id="${chapter.id}" ${state.isBusy ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              <span>Resume Studio</span>
            </button>
            <button class="btn-secondary btn-action-stop" data-id="${chapter.id}" title="Stop container to free RAM" ${state.isBusy ? 'disabled' : ''}>
              <span>Stop</span>
            </button>
            <button class="btn-subtle btn-action-reset" data-id="${chapter.id}" title="Reset chapter data" ${state.isBusy ? 'disabled' : ''}>
              <span>Reset</span>
            </button>
          ` : isStopped ? `
            <button class="btn-primary btn-action-launch" data-id="${chapter.id}" ${state.isBusy ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              <span>Resume</span>
            </button>
            <button class="btn-subtle btn-action-reset" data-id="${chapter.id}" title="Reset chapter data" ${state.isBusy ? 'disabled' : ''}>
              <span>Reset</span>
            </button>
          ` : `
            <button class="btn-primary btn-action-launch" data-id="${chapter.id}" ${state.isBusy ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              <span>Launch Chapter</span>
            </button>
            <button class="btn-subtle btn-action-reset" data-id="${chapter.id}" title="Reset chapter data" ${state.isBusy ? 'disabled' : ''}>
              <span>Reset</span>
            </button>
          `}
        </div>
      `;

      // Attach button events
      const launchBtn = card.querySelector('.btn-action-launch');
      if (launchBtn) {
        launchBtn.addEventListener('click', () => launchChapter(chapter.id));
      }

      const stopBtn = card.querySelector('.btn-action-stop');
      if (stopBtn) {
        stopBtn.addEventListener('click', () => stopChapter(chapter.id));
      }

      const resetBtn = card.querySelector('.btn-action-reset');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => promptResetChapter(chapter.id, chapter.title));
      }

      dom.chaptersGrid.appendChild(card);
    });
  }

  function setBusy(busy) {
    state.isBusy = busy;
    const cards = dom.chaptersGrid.querySelectorAll('.chapter-card');
    cards.forEach(c => {
      if (busy) {
        c.classList.add('card-busy');
      } else {
        c.classList.remove('card-busy');
      }
      c.querySelectorAll('button').forEach(btn => {
        btn.disabled = busy;
      });
    });
  }

  // =========================================================================
  // CHAPTER LIFECYCLE ACTIONS
  // =========================================================================
  async function launchChapter(chapterId) {
    setBusy(true);
    showOperation(`Preparing chapter ${chapterId}...`);
    try {
      const res = await apiCall('POST', `/orchestrator/v1/chapters/${chapterId}/launch`);
      
      const sessionUrl = res.sessionUrl || `/s/${chapterId}/${res.generation || 1}/`;
      state.activeChapterId = chapterId;
      state.activeSessionUrl = sessionUrl;

      // Update active chapter header info
      const ch = state.chapters.find(c => c.id === chapterId);
      dom.activeChapterBadge.textContent = ch ? (ch.badge || chapterId) : chapterId;
      dom.activeChapterName.textContent = ch ? (ch.title || chapterId) : chapterId;

      // Transition to Workspace View
      showWorkspaceView(sessionUrl);
      hideOperation();
      setBusy(false);
      await refreshState();

    } catch (err) {
      hideOperation();
      setBusy(false);
      showToast(`Failed to launch chapter: ${err.message}`, 'error', 6000);
      await refreshState();
    }
  }

  async function stopChapter(chapterId) {
    setBusy(true);
    showOperation(`Stopping ${chapterId} and saving workspace...`);
    try {
      await apiCall('POST', `/orchestrator/v1/chapters/${chapterId}/stop`);
      if (state.activeChapterId === chapterId) {
        state.activeChapterId = null;
        state.activeSessionUrl = null;
      }
      hideOperation();
      setBusy(false);
      showToast('Chapter stopped successfully. Workspace progress saved.', 'success', 3500);
      await refreshState();
    } catch (err) {
      hideOperation();
      setBusy(false);
      showToast(`Failed to stop chapter: ${err.message}`, 'error', 6000);
      await refreshState();
    }
  }

  function promptResetChapter(chapterId, chapterTitle) {
    state.pendingResetChapterId = chapterId;
    dom.resetChapterTargetName.textContent = chapterTitle || chapterId;
    dom.modalReset.classList.remove('hidden');
  }

  async function resetChapter(chapterId) {
    setBusy(true);
    showOperation(`Resetting ${chapterId} to factory defaults...`);
    try {
      const confirmRes = await apiCall('POST', `/orchestrator/v1/chapters/${chapterId}/reset-confirmation`);
      await apiCall('POST', `/orchestrator/v1/chapters/${chapterId}/reset`, { token: confirmRes.token });
      hideOperation();
      setBusy(false);
      showToast('Chapter reset complete. Starter notebooks and files re-seeded.', 'success', 4000);
      await refreshState();
    } catch (err) {
      hideOperation();
      setBusy(false);
      showToast(`Failed to reset chapter: ${err.message}`, 'error', 6000);
      await refreshState();
    }
  }

  // =========================================================================
  // VIEW SWITCHING
  // =========================================================================
  function showCatalogView() {
    dom.catalogView.classList.remove('hidden');
    dom.workspaceView.classList.add('hidden');
    dom.workspaceIframe.src = 'about:blank';
    refreshState();
  }

  function showWorkspaceView(url) {
    dom.catalogView.classList.add('hidden');
    dom.workspaceView.classList.remove('hidden');
    dom.workspaceIframe.src = url;
  }

  function showOperation(text) {
    dom.operationStatusText.textContent = text;
    dom.operationBanner.classList.remove('hidden');
  }

  function hideOperation() {
    dom.operationBanner.classList.add('hidden');
  }

  function formatPhaseName(phase, details) {
    switch (phase) {
      case 'PREPARING':
        return 'Preparing chapter workspace...';
      case 'STOPPING_PREVIOUS':
        return 'Stopping previous chapter gracefully...';
      case 'PREPARING_VOLUMES':
        return 'Setting up persistent storage volumes...';
      case 'CLEANING_STALE_CONTAINER':
        return 'Cleaning up old container instance...';
      case 'STARTING_CONTAINER':
        return 'Starting Docker container environment...';
      case 'WAITING_FOR_SERVICES':
        if (details?.message) return details.message;
        if (details?.elapsedSeconds !== undefined) {
          return `Starting services: VS Code, Jupyter, ChromaDB... (${details.elapsedSeconds}s)`;
        }
        return 'Waiting for services to become ready...';
      case 'STOPPING':
        return 'Gracefully stopping chapter and saving files...';
      case 'RESETTING':
        return 'Initiating factory reset...';
      case 'REMOVING_CONTAINER':
        return 'Removing container instance...';
      case 'RESETTING_VOLUME':
        return 'Re-seeding starter notebooks and clearing database...';
      case 'READY':
        return 'Ready! Loading workspace...';
      default:
        return details?.message || phase || 'Processing...';
    }
  }

  // =========================================================================
  // REAL-TIME SERVER-SENT EVENTS
  // =========================================================================
  function startEventStream() {
    if (isElectron || typeof EventSource === 'undefined') return;

    try {
      const evtSource = new EventSource('/orchestrator/v1/events');
      
      const handleServerEvent = (action, ev) => {
        if (!ev) return;

        if (ev.operationId) {
          state.currentOperation = {
            operationId: ev.operationId,
            type: ev.type,
            chapterId: ev.chapterId,
            phase: ev.phase,
          };
        }

        if (action === 'operation_started') {
          const typeName = ev.type === 'launch' ? 'Starting chapter' : ev.type === 'stop' ? 'Stopping chapter' : 'Resetting chapter';
          showOperation(`${typeName}...`);
          setBusy(true);
        } else if (action === 'phase_changed') {
          const text = formatPhaseName(ev.phase, ev.details);
          showOperation(text);
        } else if (action === 'operation_succeeded') {
          state.currentOperation = null;
          hideOperation();
          setBusy(false);
          refreshState();
        } else if (action === 'operation_failed') {
          state.currentOperation = null;
          hideOperation();
          setBusy(false);
          const errMsg = ev.error?.message || 'Operation failed';
          showToast(errMsg, 'error', 6000);
          refreshState();
        } else if (action === 'operation_cancelled') {
          state.currentOperation = null;
          hideOperation();
          setBusy(false);
          showToast('Operation cancelled', 'info');
          refreshState();
        } else {
          refreshState();
        }
      };

      const eventNames = [
        'operation_started',
        'phase_changed',
        'operation_succeeded',
        'operation_failed',
        'operation_cancelled',
        'state_changed',
        'message'
      ];

      eventNames.forEach(name => {
        evtSource.addEventListener(name, (e) => {
          try {
            const data = JSON.parse(e.data);
            handleServerEvent(data.action || name, data);
          } catch (_) {}
        });
      });

      evtSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          handleServerEvent(data.action || 'message', data);
        } catch (_) {}
      };

      evtSource.onerror = () => {
        evtSource.close();
        setTimeout(startEventStream, 5000);
      };
    } catch (_) {}
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Start app on DOM ready
  document.addEventListener('DOMContentLoaded', init);
})();
