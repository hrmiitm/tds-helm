/**
 * RAG Studio v4.2 — Master Application Controller
 * Dual-Pane Tabbed Workspace, Multi-Course Catalog, Persistent Annotations & Focus Engine
 */

(function () {
  'use strict';

  // =========================================================================
  // APPLICATION STATE
  // =========================================================================
  const state = {
    // Multi-Course Context
    currentCourseId: 'rag-intro',
    courses: [],
    
    // Curriculum & Progress
    modules: [],
    currentModuleIndex: 0,
    currentTaskIndex: 0,
    answers: {}, // { [taskId]: { answered: bool, correct: bool, value: any } }
    
    // Layout & Panes
    leftView: 'tasks', // 'tasks' | 'slides'
    rightTab: 'vscode', // 'vscode' | 'jupyter' | 'browser' | 'whiteboard'
    activePane: 'right', // 'left' | 'right'
    isFocused: false,
    isSwapped: false,
    theme: 'dark', // 'dark' | 'light'

    // Annotations & iPad Laser
    annotationMode: 'off', // 'off' | 'laser' | 'pen' | 'interact'
    penTool: 'pen', // 'pen' | 'highlighter' | 'erase'
    penColor: '#f43f5e',
    penSize: 3,

    // Session Timer
    timerSeconds: 3600,
    timerRunning: true,
    timerInterval: null,
  };

  // Module-scoped handler references
  let setAnnotationMode = () => {};

  // Clean Lucide SVG Icon Repository
  function getLucideIcon(name, size = 16) {
    const icons = {
      'layers': '<polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline>',
      'cpu': '<rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line>',
      'cloud': '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path>',
      'bot': '<rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8" y2="16"></line><line x1="16" y1="16" x2="16" y2="16"></line>',
      'book-open': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>',
      'target': '<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle>',
      'package': '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>',
      'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>',
      'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline>',
      'check': '<polyline points="20 6 9 17 4 12"></polyline>',
      'x': '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
      'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>',
      'lightbulb': '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path>'
    };
    const body = icons[name] || icons['layers'];
    return `<svg class="svg-icon svg-icon-${name}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  // =========================================================================
  // DOM REFERENCES
  // =========================================================================
  const dom = {
    body: document.body,
    workspaceContainer: document.getElementById('workspace-container'),
    paneLeft: document.getElementById('pane-left'),
    paneRight: document.getElementById('pane-right'),
    splitDivider: document.getElementById('split-divider'),
    floatingFocusHud: document.getElementById('floating-focus-hud'),
    btnHudExitFocus: document.getElementById('btn-hud-exit-focus'),
    btnHudAnnotate: document.getElementById('btn-hud-annotate'),
    hudAnnotateText: document.getElementById('hud-annotate-text'),
    focusTouchExitBtn: document.getElementById('btn-focus-touch-exit'),
    btnFocusTouchExit: document.getElementById('btn-focus-touch-exit'),
    focusActionsDock: document.getElementById('focus-actions-dock'),
    btnFocusAnnotatePersistent: document.getElementById('btn-focus-annotate-persistent'),
    btnFocusExitPersistent: document.getElementById('btn-focus-exit-persistent'),
    dockAnnotateLabel: document.getElementById('dock-annotate-label'),
    mobilePaneSwitcher: document.getElementById('mobile-pane-switcher'),
    btnMobilePaneLeft: document.getElementById('btn-mobile-pane-left'),
    btnMobilePaneRight: document.getElementById('btn-mobile-pane-right'),
    
    // Header Controls
    moduleSelect: document.getElementById('module-select'),
    btnChangeChapter: document.getElementById('btn-change-chapter'),
    topbarChapterIcon: document.getElementById('topbar-chapter-icon'),
    topbarChapterBadge: document.getElementById('topbar-chapter-badge'),
    topbarChapterTitle: document.getElementById('topbar-chapter-title'),
    btnCourseCatalog: document.getElementById('btn-course-catalog'),
    courseTitleText: document.getElementById('course-title-text'),
    stepCounter: document.getElementById('step-counter'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    healthIndicatorBadge: document.getElementById('health-indicator-badge'),
    btnFocusToggle: document.getElementById('btn-focus-toggle'),
    focusBtnText: document.getElementById('focus-btn-text'),
    btnAnnotateMenu: document.getElementById('btn-annotate-menu'),
    annotationDropdown: document.getElementById('annotation-dropdown'),
    btnToolLaser: document.getElementById('btn-tool-laser'),
    btnToolPen: document.getElementById('btn-tool-pen'),
    btnToolInteract: document.getElementById('btn-tool-interact'),
    btnToolOff: document.getElementById('btn-tool-off'),
    btnThemeToggle: document.getElementById('btn-theme-toggle'),
    themeIcon: document.getElementById('theme-icon'),
    btnResetEnv: document.getElementById('btn-reset-env'),
    btnSwapPanes: document.getElementById('btn-swap-panes'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    timerDisplay: document.getElementById('timer-display'),
    sessionTimerWidget: document.getElementById('session-timer-widget'),
    btnProgressModal: document.getElementById('btn-progress-modal'),

    // Left Pane
    tabLeftTasks: document.getElementById('tab-left-tasks'),
    tabLeftSlides: document.getElementById('tab-left-slides'),
    viewPanelTasks: document.getElementById('view-panel-tasks'),
    viewPanelSlides: document.getElementById('view-panel-slides'),
    btnFullscreenSlides: document.getElementById('btn-fullscreen-slides'),
    btnReloadLeft: document.getElementById('btn-reload-left'),
    iframeLeftSlides: document.getElementById('iframe-left-slides'),

    // Task & Solution Subtabs
    subtabBtnTask: document.getElementById('subtab-btn-task'),
    subtabBtnSolution: document.getElementById('subtab-btn-solution'),
    subviewTask: document.getElementById('subview-task'),
    subviewSolution: document.getElementById('subview-solution'),
    taskBadgeModule: document.getElementById('task-badge-module'),
    taskBadgeId: document.getElementById('task-badge-id'),
    taskBadgeTrack: document.getElementById('task-badge-track'),
    taskTitle: document.getElementById('task-title'),
    taskInstructions: document.getElementById('task-instructions'),
    commandsList: document.getElementById('commands-list'),
    btnSwitchToVscode: document.getElementById('btn-switch-to-vscode'),
    btnSwitchToJupyter: document.getElementById('btn-switch-to-jupyter'),
    questionPrompt: document.getElementById('question-prompt'),
    questionBody: document.getElementById('question-body'),
    answerStatusPill: document.getElementById('answer-status-pill'),
    feedbackAlert: document.getElementById('feedback-alert'),
    feedbackIcon: document.getElementById('feedback-icon'),
    feedbackTitle: document.getElementById('feedback-title'),
    feedbackText: document.getElementById('feedback-text'),
    hintToggleBtn: document.getElementById('hint-toggle-btn'),
    hintContentBox: document.getElementById('hint-content-box'),
    btnPrevTask: document.getElementById('btn-prev-task'),
    btnNextTask: document.getElementById('btn-next-task'),
    solutionContentBody: document.getElementById('solution-content-body'),

    // Right Pane Tab Strip & Panels
    tabToolVscode: document.getElementById('tab-tool-vscode'),
    tabToolJupyter: document.getElementById('tab-tool-jupyter'),
    tabWorkspaceBrowser: document.getElementById('tab-workspace-browser'),
    tabToolPreview: document.getElementById('tab-workspace-browser'),
    tabToolWhiteboard: document.getElementById('tab-tool-whiteboard'),
    rightTabStatus: document.getElementById('right-tab-status'),
    btnDirectLink: document.getElementById('btn-direct-link'),
    btnReloadRight: document.getElementById('btn-reload-right'),
    panelToolVscode: document.getElementById('panel-tool-vscode'),
    panelToolJupyter: document.getElementById('panel-tool-jupyter'),
    panelWorkspaceBrowser: document.getElementById('panel-workspace-browser'),
    panelToolPreview: document.getElementById('panel-workspace-browser'),
    panelToolWhiteboard: document.getElementById('panel-tool-whiteboard'),
    iframeVscode: document.getElementById('iframe-vscode'),
    iframeJupyter: document.getElementById('iframe-jupyter'),
    iframeBrowser: document.getElementById('iframe-browser'),
    iframePreview: document.getElementById('iframe-browser'),
    iframeExcalidraw: document.getElementById('iframe-excalidraw'),

    // Preview Tools
    // Screen Annotation Overlay & Draggable Toolbar
    screenAnnotationWrapper: document.getElementById('screen-annotation-wrapper'),
    screenAnnotationCanvas: document.getElementById('screen-annotation-canvas'),
    floatingPenToolbar: document.getElementById('floating-pen-toolbar'),
    floatingToolbarHandle: document.getElementById('floating-toolbar-handle'),
    toolModeLaser: document.getElementById('tool-mode-laser'),
    toolModePen: document.getElementById('tool-mode-pen'),
    toolModeHighlighter: document.getElementById('tool-mode-highlighter'),
    toolModeErase: document.getElementById('tool-mode-erase'),
    toolModeInteract: document.getElementById('tool-mode-interact'),
    btnFloatingUndo: document.getElementById('btn-floating-undo'),
    btnFloatingClear: document.getElementById('btn-floating-clear'),
    btnFloatingClose: document.getElementById('btn-floating-close'),

    // Modals
    chapterSelectModal: document.getElementById('chapter-select-modal'),
    btnCloseChapterModal: document.getElementById('btn-close-chapter-modal'),
    chapterCardRag: document.getElementById('chapter-card-rag'),
    chapterCardMcp: document.getElementById('chapter-card-mcp'),
    btnSelectRag: document.getElementById('btn-select-rag'),
    btnSelectMcp: document.getElementById('btn-select-mcp'),
    fullscreenSlidesModal: document.getElementById('fullscreen-slides-modal'),
    iframeModalSlides: document.getElementById('iframe-modal-slides'),
    btnModalAnnotate: document.getElementById('btn-modal-annotate'),
    btnModalExitSlides: document.getElementById('btn-modal-exit-slides'),
    catalogModal: document.getElementById('catalog-modal'),
    btnCloseCatalogModal: document.getElementById('btn-close-catalog-modal'),
    coursesCatalogGrid: document.getElementById('courses-catalog-grid'),
    resetEnvModal: document.getElementById('reset-env-modal'),
    btnCloseResetModal: document.getElementById('btn-close-reset-modal'),
    btnCancelReset: document.getElementById('btn-cancel-reset'),
    btnConfirmReset: document.getElementById('btn-confirm-reset'),
    progressModal: document.getElementById('progress-modal'),
    btnCloseProgressModal: document.getElementById('btn-close-progress-modal'),
    progressJsonView: document.getElementById('progress-json-view'),
    btnExportProgress: document.getElementById('btn-export-progress'),
    importFileInput: document.getElementById('import-file-input'),
    btnResetProgress: document.getElementById('btn-reset-progress'),
    healthModal: document.getElementById('health-modal'),
    btnCloseHealthModal: document.getElementById('btn-close-health-modal'),
    healthChecksTable: document.getElementById('health-checks-table'),
    btnReprobeHealth: document.getElementById('btn-reprobe-health'),
    toastContainer: document.getElementById('toast-container'),
  };

  // =========================================================================
  // INITIALIZATION
  // =========================================================================
  async function init() {
    loadSavedPreferences();
    setupSplitDivider();
    setupFocusMode();
    setupThemeToggle();
    setupAnnotationsAndLaser();
    setupLeftPaneSwitcher();
    setupRightPaneTabStrip();
    setupBrowserToolbar();
    setupSessionTimer();
    setupCourseCatalog();
    setupChapterSelection();
    setupResetEnvironment();
    setupModals();
    await loadCurriculum();
    startHealthHeartbeat();
    setupGlobalMessageListener();
    setupSlideKeyboardForwarding();
    setActivePane(state.activePane || 'left');

    // Unified single chapter mode - active course is rag-mcp
    localStorage.setItem('rag_studio_active_course', 'rag-mcp');
  }

  // =========================================================================
  // GLOBAL MESSAGE LISTENER (Slide Deck & Iframe Coordination)
  // =========================================================================
  function setupGlobalMessageListener() {
    window.addEventListener('message', (event) => {
      if (!event.data) return;
      if (event.data.type === 'CLOSE_SLIDES' || event.data.type === 'EXIT_FOCUS') {
        if (state.isFocused) {
          toggleFocusMode(false);
        }
        closeFullscreenSlides();
      } else if (event.data.type === 'toggle-annotation') {
        setAnnotationMode(event.data.mode || 'laser');
        if (dom.floatingPenToolbar) {
          dom.floatingPenToolbar.classList.remove('hidden');
        }
      }
    });
  }

  // =========================================================================
  // SLIDE KEYBOARD NAVIGATION FORWARDING
  // =========================================================================
  function setupSlideKeyboardForwarding() {
    window.addEventListener('keydown', (e) => {
      // Do not forward keyboard navigation if user is typing in form controls or editable fields
      const activeEl = document.activeElement;
      const tag = activeEl ? activeEl.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (activeEl && activeEl.isContentEditable)) {
        return;
      }

      // Check if fullscreen slides modal is open or left pane view is slides
      const isModalOpen = dom.fullscreenSlidesModal && !dom.fullscreenSlidesModal.classList.contains('hidden');
      const isLeftSlides = (state.leftView === 'slides' || (dom.viewPanelSlides && dom.viewPanelSlides.classList.contains('active')));

      if (!isModalOpen && !isLeftSlides) return;

      // If another modal (not slides) is active, do not forward
      if (!isModalOpen) {
        const isOtherModalOpen =
          (dom.chapterSelectModal && !dom.chapterSelectModal.classList.contains('hidden')) ||
          (dom.catalogModal && !dom.catalogModal.classList.contains('hidden')) ||
          (dom.resetEnvModal && !dom.resetEnvModal.classList.contains('hidden')) ||
          (dom.progressModal && !dom.progressModal.classList.contains('hidden')) ||
          (dom.healthModal && !dom.healthModal.classList.contains('hidden'));
        if (isOtherModalOpen) return;
      }

      // Identify active slides iframe
      const activeIframe = isModalOpen ? dom.iframeModalSlides : dom.iframeLeftSlides;
      if (!activeIframe || !activeIframe.contentWindow) return;

      // Determine navigation direction
      let direction = null;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || ((e.key === ' ' || e.code === 'Space') && !e.shiftKey)) {
        direction = 'next';
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || ((e.key === ' ' || e.code === 'Space') && e.shiftKey)) {
        direction = 'prev';
      }

      if (direction) {
        e.preventDefault();
        try {
          activeIframe.contentWindow.postMessage({ type: 'reveal-navigate', direction }, '*');
        } catch (err) {
          console.warn('Failed to forward slide navigation message:', err);
        }
      }
    });
  }

  // =========================================================================
  // LOCAL PREFERENCES
  // =========================================================================
  function loadSavedPreferences() {
    try {
      const savedTheme = localStorage.getItem('rag_studio_theme');
      if (savedTheme) {
        state.theme = savedTheme;
        applyTheme(savedTheme);
      }

      const savedSplit = localStorage.getItem('rag_studio_split_width');
      if (savedSplit) {
        dom.paneLeft.style.width = savedSplit;
      }

      const savedCourse = localStorage.getItem('rag_studio_active_course');
      if (savedCourse) {
        state.currentCourseId = savedCourse;
      }

      updateTopbarChapterBadge(state.currentCourseId);
      loadProgress();
    } catch (e) {
      console.warn('Failed to load local preferences:', e);
    }
  }

  function getAnswersStorageKey() {
    return `rag_studio_answers_${state.currentCourseId || 'rag-intro'}`;
  }

  function loadProgress() {
    try {
      const key = getAnswersStorageKey();
      const savedAnswers = localStorage.getItem(key) || (state.currentCourseId === 'rag-intro' ? localStorage.getItem('rag_studio_answers') : null);
      if (savedAnswers) {
        state.answers = JSON.parse(savedAnswers);
      } else {
        state.answers = {};
      }
    } catch (e) {
      console.warn('Failed to load local progress:', e);
    }
  }

  function saveProgress() {
    try {
      const key = getAnswersStorageKey();
      localStorage.setItem(key, JSON.stringify(state.answers));
    } catch (e) {
      console.warn('Failed to save answers:', e);
    }
  }

  // =========================================================================
  // THEME SWITCHER
  // =========================================================================
  function setupThemeToggle() {
    if (!dom.btnThemeToggle) return;
    dom.btnThemeToggle.addEventListener('click', () => {
      const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
      state.theme = nextTheme;
      applyTheme(nextTheme);
      try {
        localStorage.setItem('rag_studio_theme', nextTheme);
      } catch (e) {}
      showToast(`Switched to ${nextTheme === 'dark' ? 'Dark' : 'Light'} theme`);
    });
  }

  const SVG_THEME_SUN = '<svg class="svg-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>';
  const SVG_THEME_MOON = '<svg class="svg-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>';

  function applyTheme(theme) {
    if (theme === 'light') {
      dom.body.classList.remove('dark-theme');
      dom.body.classList.add('light-theme');
      if (dom.themeIcon) dom.themeIcon.innerHTML = SVG_THEME_SUN;
    } else {
      dom.body.classList.remove('light-theme');
      dom.body.classList.add('dark-theme');
      if (dom.themeIcon) dom.themeIcon.innerHTML = SVG_THEME_MOON;
    }

    broadcastTheme(theme);
  }

  function broadcastTheme(theme) {
    const msg = { type: 'SET_THEME', theme: theme };
    const targets = [
      dom.iframeLeftSlides,
      dom.iframeModalSlides,
      dom.iframeExcalidraw,
    ];
    targets.forEach(iframe => {
      if (iframe && iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage(msg, '*');
        } catch (e) {}
      }
    });
  }

  // =========================================================================
  // SPLITTER & PANE TRACKING (Touch-Friendly Pointer Events)
  // =========================================================================
  function setupSplitDivider() {
    let isDragging = false;

    if (dom.splitDivider) {
      dom.splitDivider.addEventListener('pointerdown', (e) => {
        isDragging = true;
        try {
          dom.splitDivider.setPointerCapture(e.pointerId);
        } catch (err) {}
        dom.body.style.cursor = 'col-resize';
        dom.body.style.userSelect = 'none';
      });

      const handlePointerMove = (e) => {
        if (!isDragging) return;
        const containerRect = dom.workspaceContainer.getBoundingClientRect();
        let leftWidth = e.clientX - containerRect.left;
        const minWidth = 320;
        const maxWidth = containerRect.width - 380;

        if (leftWidth < minWidth) leftWidth = minWidth;
        if (leftWidth > maxWidth) leftWidth = maxWidth;

        const pct = (leftWidth / containerRect.width) * 100;
        dom.paneLeft.style.width = `${pct}%`;
        try {
          localStorage.setItem('rag_studio_split_width', `${pct}%`);
        } catch (err) {}
      };

      const handlePointerUp = (e) => {
        if (isDragging) {
          isDragging = false;
          try {
            if (e && e.pointerId && dom.splitDivider.hasPointerCapture(e.pointerId)) {
              dom.splitDivider.releasePointerCapture(e.pointerId);
            }
          } catch (err) {}
          dom.body.style.cursor = '';
          dom.body.style.userSelect = '';
        }
      };

      dom.splitDivider.addEventListener('pointermove', handlePointerMove);
      dom.splitDivider.addEventListener('pointerup', handlePointerUp);
      dom.splitDivider.addEventListener('pointercancel', handlePointerUp);

      // Window fallback listeners for edge cases
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    }

    // Pane focus indicators
    dom.paneLeft.addEventListener('click', () => setActivePane('left'));
    dom.paneRight.addEventListener('click', () => setActivePane('right'));
    dom.paneLeft.addEventListener('focusin', () => setActivePane('left'));
    dom.paneRight.addEventListener('focusin', () => setActivePane('right'));

    // Mobile pane switcher tabs
    if (dom.btnMobilePaneLeft) {
      dom.btnMobilePaneLeft.addEventListener('click', () => setActivePane('left'));
    }
    if (dom.btnMobilePaneRight) {
      dom.btnMobilePaneRight.addEventListener('click', () => setActivePane('right'));
    }

    // Swap Panes
    if (dom.btnSwapPanes) {
      dom.btnSwapPanes.addEventListener('click', () => {
        state.isSwapped = !state.isSwapped;
        dom.workspaceContainer.classList.toggle('swapped', state.isSwapped);
        showToast(state.isSwapped ? 'Swapped: Workspaces on Left' : 'Standard: Learning on Left');
      });
    }

    // Native Fullscreen
    if (dom.btnFullscreen) {
      dom.btnFullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    }
  }

  function setActivePane(pane) {
    state.activePane = pane;
    dom.paneLeft.classList.toggle('focused-active', pane === 'left');
    dom.paneRight.classList.toggle('focused-active', pane === 'right');

    if (dom.workspaceContainer) {
      dom.workspaceContainer.setAttribute('data-active-pane', pane);
    }
    if (dom.btnMobilePaneLeft) {
      dom.btnMobilePaneLeft.classList.toggle('active', pane === 'left');
      dom.btnMobilePaneLeft.setAttribute('aria-selected', String(pane === 'left'));
    }
    if (dom.btnMobilePaneRight) {
      dom.btnMobilePaneRight.classList.toggle('active', pane === 'right');
      dom.btnMobilePaneRight.setAttribute('aria-selected', String(pane === 'right'));
    }
  }

  // =========================================================================
  // TRUE IMMERSIVE FOCUS MODE & AUTO-HIDING ESCAPE HUD
  // =========================================================================
  function setupFocusMode() {
    if (!dom.btnFocusToggle) return;

    let hudTimer = null;
    let hudHideTimer = null;

    function showFocusHud() {
      if (!state.isFocused || !dom.floatingFocusHud) return;
      if (hudTimer) clearTimeout(hudTimer);
      if (hudHideTimer) clearTimeout(hudHideTimer);

      dom.floatingFocusHud.classList.remove('hidden');
      void dom.floatingFocusHud.offsetWidth; // Force layout recalculation for smooth transition
      dom.floatingFocusHud.classList.add('hud-visible');

      hudTimer = setTimeout(() => {
        if (!dom.floatingFocusHud) return;
        dom.floatingFocusHud.classList.remove('hud-visible');
        hudHideTimer = setTimeout(() => {
          if (dom.floatingFocusHud && !dom.floatingFocusHud.classList.contains('hud-visible')) {
            dom.floatingFocusHud.classList.add('hidden');
          }
        }, 400);
      }, 2500);
    }

    function hideFocusHud() {
      if (hudTimer) clearTimeout(hudTimer);
      if (hudHideTimer) clearTimeout(hudHideTimer);
      if (dom.floatingFocusHud) {
        dom.floatingFocusHud.classList.remove('hud-visible');
        dom.floatingFocusHud.classList.add('hidden');
      }
    }

    // Reveal on hover: If mouse moves within 45px of the top edge (e.clientY <= 45), reveal the HUD
    window.addEventListener('mousemove', (e) => {
      if (state.isFocused && e.clientY <= 45) {
        showFocusHud();
      }
    }, { passive: true });

    // Touchscreen gesture: reveal HUD when tapping or touching near top boundary (<= 45px)
    window.addEventListener('touchstart', (e) => {
      if (state.isFocused && e.touches && e.touches[0] && e.touches[0].clientY <= 45) {
        showFocusHud();
      }
    }, { passive: true });

    function toggleFocusMode(enable) {
      const targetState = typeof enable === 'boolean' ? enable : !state.isFocused;
      if (targetState) {
        enterFocusMode();
      } else {
        exitFocusMode();
      }
    }

    dom.btnFocusToggle.addEventListener('click', () => {
      toggleFocusMode(!state.isFocused);
    });

    if (dom.btnHudExitFocus) {
      dom.btnHudExitFocus.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFocusMode(false);
      });
    }

    if (dom.btnFocusTouchExit) {
      dom.btnFocusTouchExit.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFocusMode(false);
      });
    }

    function toggleFocusAnnotator() {
      if (state.annotationMode === 'off') {
        setAnnotationMode('pen');
      } else {
        setAnnotationMode('off');
      }
    }

    if (dom.btnHudAnnotate) {
      dom.btnHudAnnotate.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFocusAnnotator();
      });
    }

    if (dom.btnFocusAnnotatePersistent) {
      dom.btnFocusAnnotatePersistent.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFocusAnnotator();
      });
    }

    if (dom.btnFocusExitPersistent) {
      dom.btnFocusExitPersistent.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFocusMode(false);
      });
    }

    // Keyboard shortcut for toggling annotation anywhere: Ctrl+Shift+A or Alt+A
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) || (e.altKey && (e.key === 'A' || e.key === 'a'))) {
        e.preventDefault();
        toggleFocusAnnotator();
      }
    });

    // Global Esc Key handler to exit focus or modals
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (state.isFocused) {
          toggleFocusMode(false);
        } else if (dom.fullscreenSlidesModal && !dom.fullscreenSlidesModal.classList.contains('hidden')) {
          closeFullscreenSlides();
        } else {
          let closedAny = false;
          if (dom.chapterSelectModal && !dom.chapterSelectModal.classList.contains('hidden')) {
            dom.chapterSelectModal.classList.add('hidden');
            closedAny = true;
          }
          if (dom.catalogModal && !dom.catalogModal.classList.contains('hidden')) {
            dom.catalogModal.classList.add('hidden');
            closedAny = true;
          }
          if (dom.resetEnvModal && !dom.resetEnvModal.classList.contains('hidden')) {
            dom.resetEnvModal.classList.add('hidden');
            closedAny = true;
          }
          if (dom.progressModal && !dom.progressModal.classList.contains('hidden')) {
            dom.progressModal.classList.add('hidden');
            closedAny = true;
          }
          if (dom.healthModal && !dom.healthModal.classList.contains('hidden')) {
            dom.healthModal.classList.add('hidden');
            closedAny = true;
          }
          if (!closedAny && state.annotationMode !== 'off') {
            setAnnotationMode('off');
          }
        }
      }
    });

    // Wire iframe Escape bubbling to parent focus mode controller
    function wireIframeEscape(iframeEl) {
      if (!iframeEl) return;
      const bind = () => {
        try {
          const doc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
          if (doc) {
            doc.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') {
                if (state.isFocused) {
                  toggleFocusMode(false);
                } else if (dom.fullscreenSlidesModal && !dom.fullscreenSlidesModal.classList.contains('hidden')) {
                  closeFullscreenSlides();
                }
              } else if ((e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) || (e.altKey && (e.key === 'A' || e.key === 'a'))) {
                e.preventDefault();
                toggleFocusAnnotator();
              }
            });
          }
        } catch (err) {}
      };
      iframeEl.addEventListener('load', bind);
      bind();
    }

    [dom.iframeVscode, dom.iframeJupyter, dom.iframeBrowser, dom.iframeExcalidraw, dom.iframeLeftSlides, dom.fullscreenSlidesIframe].forEach(wireIframeEscape);

    function enterFocusMode() {
      state.isFocused = true;
      dom.body.classList.add('immersive-focus');

      if (state.activePane === 'left') {
        dom.body.classList.add('focus-left-active');
        dom.body.classList.remove('focus-right-active');
        dom.workspaceContainer.classList.add('focus-left');
        dom.workspaceContainer.classList.remove('focus-right');
      } else {
        dom.body.classList.add('focus-right-active');
        dom.body.classList.remove('focus-left-active');
        dom.workspaceContainer.classList.add('focus-right');
        dom.workspaceContainer.classList.remove('focus-left');
      }

      showFocusHud();

      if (dom.btnFocusToggle) dom.btnFocusToggle.classList.add('active');
      if (dom.focusBtnText) dom.focusBtnText.textContent = 'Exit Focus (Esc)';
      try {
        window.parent?.postMessage({ type: 'STUDIO_FOCUS_STATE', isFocused: true }, '*');
      } catch (_) {}

      setTimeout(() => {
        dom.iframeLeftSlides?.contentWindow?.postMessage({ type: 'REVEAL_LAYOUT' }, '*');
        dom.iframeModalSlides?.contentWindow?.postMessage({ type: 'REVEAL_LAYOUT' }, '*');
      }, 50);
      setTimeout(() => {
        dom.iframeLeftSlides?.contentWindow?.postMessage({ type: 'REVEAL_LAYOUT' }, '*');
        dom.iframeModalSlides?.contentWindow?.postMessage({ type: 'REVEAL_LAYOUT' }, '*');
      }, 200);

      showToast(`Focused on ${state.activePane === 'left' ? 'Learning' : 'Workspace'} View (Press Esc or Exit Focus on top to restore)`);
    }

    function exitFocusMode() {
      state.isFocused = false;
      dom.body.classList.remove('immersive-focus', 'focus-left-active', 'focus-right-active');
      dom.workspaceContainer.classList.remove('focus-left', 'focus-right');
      hideFocusHud();

      if (dom.btnFocusToggle) dom.btnFocusToggle.classList.remove('active');
      if (dom.focusBtnText) dom.focusBtnText.textContent = 'Focus View';
      try {
        window.parent?.postMessage({ type: 'STUDIO_FOCUS_STATE', isFocused: false }, '*');
      } catch (_) {}

      setTimeout(() => {
        dom.iframeLeftSlides?.contentWindow?.postMessage({ type: 'REVEAL_LAYOUT' }, '*');
      }, 50);
      setTimeout(() => {
        dom.iframeLeftSlides?.contentWindow?.postMessage({ type: 'REVEAL_LAYOUT' }, '*');
      }, 200);

      showToast('Split view restored');
    }
  }

  // =========================================================================
  // LEFT PANE: TASKS VS SLIDES SWITCHER
  // =========================================================================
  function setupLeftPaneSwitcher() {
    if (dom.tabLeftTasks) {
      dom.tabLeftTasks.addEventListener('click', () => switchLeftView('tasks'));
    }
    if (dom.tabLeftSlides) {
      dom.tabLeftSlides.addEventListener('click', () => switchLeftView('slides'));
    }

    // Fullscreen Slides Modal
    if (dom.btnFullscreenSlides) {
      dom.btnFullscreenSlides.addEventListener('click', openFullscreenSlides);
    }

    // Modal Top Bar Actions (Annotate and Exit Focus on Top)
    if (dom.btnModalAnnotate) {
      dom.btnModalAnnotate.addEventListener('click', () => {
        toggleFocusAnnotator();
      });
    }
    if (dom.btnModalExitSlides) {
      dom.btnModalExitSlides.addEventListener('click', () => {
        closeFullscreenSlides();
      });
    }

    // Reload Left View
    if (dom.btnReloadLeft) {
      dom.btnReloadLeft.addEventListener('click', () => {
        if (state.leftView === 'slides') {
          if (dom.iframeLeftSlides) dom.iframeLeftSlides.src = '/slides/';
          showToast('Reloaded slides presentation');
        } else {
          renderCurrentTask();
          showToast('Refreshed task instructions');
        }
      });
    }
  }

  function switchLeftView(view) {
    state.leftView = view;
    setActivePane('left');

    if (dom.tabLeftTasks) dom.tabLeftTasks.classList.toggle('active', view === 'tasks');
    if (dom.tabLeftSlides) dom.tabLeftSlides.classList.toggle('active', view === 'slides');
    if (dom.viewPanelTasks) dom.viewPanelTasks.classList.toggle('active', view === 'tasks');
    if (dom.viewPanelSlides) dom.viewPanelSlides.classList.toggle('active', view === 'slides');

    if (view === 'slides' && dom.iframeLeftSlides) {
      broadcastTheme(state.theme);
      try {
        dom.iframeLeftSlides.contentWindow?.postMessage({ type: 'REVEAL_LAYOUT' }, '*');
      } catch (_) {}
      setTimeout(() => {
        try {
          dom.iframeLeftSlides.contentWindow?.postMessage({ type: 'REVEAL_LAYOUT' }, '*');
        } catch (_) {}
      }, 50);
      setTimeout(() => {
        try {
          dom.iframeLeftSlides.contentWindow?.postMessage({ type: 'REVEAL_LAYOUT' }, '*');
        } catch (_) {}
      }, 200);
    }
  }

  function openFullscreenSlides() {
    if (!dom.fullscreenSlidesModal) return;
    dom.fullscreenSlidesModal.classList.remove('hidden');
    const targetSrc = `/slides/?chapter=${state.currentCourseId || 'rag-mcp'}`;
    if (dom.iframeModalSlides && (!dom.iframeModalSlides.src || !dom.iframeModalSlides.src.includes('/slides/'))) {
      dom.iframeModalSlides.src = targetSrc;
    }
    try {
      window.parent?.postMessage({ type: 'STUDIO_FOCUS_STATE', isFocused: true }, '*');
    } catch (_) {}
    setTimeout(() => {
      broadcastTheme(state.theme);
      try {
        dom.iframeModalSlides?.contentWindow?.postMessage({ type: 'REVEAL_LAYOUT' }, '*');
      } catch (_) {}
    }, 50);
    setTimeout(() => {
      try {
        dom.iframeModalSlides?.contentWindow?.postMessage({ type: 'REVEAL_LAYOUT' }, '*');
      } catch (_) {}
    }, 200);
  }

  function closeFullscreenSlides() {
    if (!dom.fullscreenSlidesModal) return;
    dom.fullscreenSlidesModal.classList.add('hidden');
    try {
      window.parent?.postMessage({ type: 'STUDIO_FOCUS_STATE', isFocused: false }, '*');
    } catch (_) {}
  }

  // =========================================================================
  // RIGHT PANE: TAB STRIP (VS Code, Jupyter, Chromium Browser, Excalidraw)
  // =========================================================================
  function setupRightPaneTabStrip() {
    const tabs = [
      { id: 'vscode', btn: dom.tabToolVscode, panel: dom.panelToolVscode, label: '/workspace', direct: '/vscode/?folder=/workspace' },
      { id: 'jupyter', btn: dom.tabToolJupyter, panel: dom.panelToolJupyter, label: '/workspace/src/notebooks', direct: '/jupyter/lab/tree/src/notebooks' },
      { id: 'browser', btn: dom.tabWorkspaceBrowser, panel: dom.panelWorkspaceBrowser, label: 'Chromium', direct: '/browser/vnc.html?autoconnect=true&resize=remote&reconnect=true&path=browser/websockify' },
      { id: 'whiteboard', btn: dom.tabToolWhiteboard, panel: dom.panelToolWhiteboard, label: 'Excalidraw', direct: '/excalidraw/' }
    ];

    tabs.forEach(t => {
      if (t.btn) {
        t.btn.addEventListener('click', () => switchRightTab(t.id));
      }
    });

    if (dom.btnReloadRight) {
      dom.btnReloadRight.addEventListener('click', () => {
        const active = state.rightTab;
        if (active === 'vscode' && dom.iframeVscode) {
          dom.iframeVscode.src = dom.iframeVscode.src;
          showToast('Reloaded VS Code');
        } else if (active === 'jupyter' && dom.iframeJupyter) {
          dom.iframeJupyter.src = dom.iframeJupyter.src;
          showToast('Reloaded JupyterLab');
        } else if ((active === 'browser' || active === 'preview') && dom.iframeBrowser) {
          dom.iframeBrowser.src = '/browser/vnc.html?autoconnect=true&resize=remote&reconnect=true&path=browser/websockify';
          showToast('Reloaded Chromium Browser');
        } else if (active === 'whiteboard' && dom.iframeExcalidraw) {
          dom.iframeExcalidraw.src = dom.iframeExcalidraw.src;
          showToast('Reloaded Excalidraw');
        }
      });
    }

    if (dom.btnSwitchToVscode) {
      dom.btnSwitchToVscode.addEventListener('click', () => switchRightTab('vscode'));
    }
    if (dom.btnSwitchToJupyter) {
      dom.btnSwitchToJupyter.addEventListener('click', () => switchRightTab('jupyter'));
    }
  }

  function switchRightTab(tabId) {
    if (tabId === 'preview') tabId = 'browser';
    state.rightTab = tabId;
    setActivePane('right');

    const browserBtn = dom.tabWorkspaceBrowser || dom.tabToolPreview;
    const browserPanel = dom.panelWorkspaceBrowser || dom.panelToolPreview;

    const tabsMap = {
      vscode: { btn: dom.tabToolVscode, panel: dom.panelToolVscode, label: '/workspace', direct: '/vscode/?folder=/workspace' },
      jupyter: { btn: dom.tabToolJupyter, panel: dom.panelToolJupyter, label: '/workspace/notebooks', direct: '/jupyter/lab/tree/notebooks' },
      browser: { btn: browserBtn, panel: browserPanel, label: 'Chromium', direct: '/browser/vnc.html?autoconnect=true&resize=remote&reconnect=true&path=browser/websockify' },
      whiteboard: { btn: dom.tabToolWhiteboard, panel: dom.panelToolWhiteboard, label: 'Excalidraw', direct: '/excalidraw/' }
    };

    Object.keys(tabsMap).forEach(key => {
      const item = tabsMap[key];
      const isCur = key === tabId;
      if (item.btn) item.btn.classList.toggle('active', isCur);
      if (item.panel) item.panel.classList.toggle('active', isCur);
    });

    const current = tabsMap[tabId];
    if (current) {
      if (dom.rightTabStatus) dom.rightTabStatus.textContent = current.label;
      if (dom.btnDirectLink) {
        dom.btnDirectLink.href = current.direct;
        dom.btnDirectLink.style.display = 'inline-flex';
      }
    }

    // Switch to iframeBrowser when the browser tab is selected
    if (tabId === 'browser') {
      if (dom.iframeBrowser) {
        const browserSrc = '/browser/vnc.html?autoconnect=true&resize=remote&reconnect=true&path=browser/websockify';
        if (!dom.iframeBrowser.src || dom.iframeBrowser.src === 'about:blank' || !dom.iframeBrowser.src.includes('/browser/vnc.html')) {
          dom.iframeBrowser.src = browserSrc;
        }
      }
    }

    if (tabId === 'whiteboard') {
      broadcastTheme(state.theme);
    }
  }

  function setupBrowserToolbar() {
    const input = document.getElementById('browser-address-input');
    const form = document.getElementById('browser-address-form');
    const btnGo = document.getElementById('btn-browser-go');
    const btnBack = document.getElementById('btn-browser-back');
    const btnForward = document.getElementById('btn-browser-forward');
    const btnReload = document.getElementById('btn-browser-reload');
    const btnHome = document.getElementById('btn-browser-home');
    const btnExternal = document.getElementById('btn-browser-external');
    const quickLinks = document.querySelectorAll('.quick-link-pill');

    async function navigateTo(url) {
      if (!url) return;
      let targetUrl = url.trim();
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
          targetUrl = 'https://' + targetUrl;
        } else {
          targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(targetUrl);
        }
      }

      if (input) input.value = targetUrl;
      if (btnExternal) btnExternal.href = targetUrl;

      try {
        await fetch('/api/v1/browser/navigate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: targetUrl })
        });
        showToast(`Browsing: ${targetUrl}`);
      } catch (e) {
        console.warn('Browser navigation call failed:', e);
      }
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        navigateTo(input ? input.value : '');
      });
    }

    if (btnGo) {
      btnGo.addEventListener('click', () => {
        navigateTo(input ? input.value : '');
      });
    }

    if (btnHome) {
      btnHome.addEventListener('click', () => {
        navigateTo('https://www.google.com');
      });
    }

    if (btnReload) {
      btnReload.addEventListener('click', () => {
        if (dom.iframeBrowser) {
          dom.iframeBrowser.src = dom.iframeBrowser.src;
          showToast('Reloaded browser view');
        }
      });
    }

    quickLinks.forEach(pill => {
      pill.addEventListener('click', () => {
        const url = pill.getAttribute('data-url');
        if (url) navigateTo(url);
      });
    });
  }

  // =========================================================================
  // MULTI-COURSE CATALOG & CHAPTER SWITCHER
  // =========================================================================
  function setupCourseCatalog() {
    const defaultCatalog = [
      {
        id: 'rag-mcp',
        title: 'Foundations of RAG & Vector Databases',
        description: 'Master multimodal embeddings, vector similarity math, ChromaDB HNSW indexing, and modular Python RAG systems.',
        badge: 'RAG & Vectors',
        badgeClass: 'badge-active',
        modules: 8,
        tasks: 10,
        icon: 'layers',
        active: true
      }
    ];

    if (dom.btnCourseCatalog) {
      dom.btnCourseCatalog.addEventListener('click', async () => {
        if (dom.chapterSelectModal) dom.chapterSelectModal.classList.add('hidden');
        let catalog = defaultCatalog;
        try {
          const res = await fetch('catalog/index.json').catch(() => fetch('/catalog/index.json'));
          if (res && res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.courses)) {
              catalog = data.courses;
            }
          }
        } catch (e) {}
        renderCatalogCourses(catalog);
        if (dom.catalogModal) dom.catalogModal.classList.remove('hidden');
      });
    }

    if (dom.btnCloseCatalogModal) {
      dom.btnCloseCatalogModal.addEventListener('click', () => {
        if (dom.catalogModal) dom.catalogModal.classList.add('hidden');
      });
    }

    function renderCatalogCourses(coursesList) {
      if (!dom.coursesCatalogGrid) return;
      dom.coursesCatalogGrid.innerHTML = '';

      coursesList.forEach(course => {
        const isActive = (course.id === state.currentCourseId);
        const card = document.createElement('div');
        card.className = `catalog-course-card ${isActive ? 'active-course' : ''}`;

        const iconName = course.icon || (course.id === 'rag-intro' ? 'layers' : course.id === 'mcp-agentic' ? 'cpu' : course.id === 'gcp-intro' ? 'cloud' : 'bot');
        const iconSvg = getLucideIcon(iconName, 18);

        card.innerHTML = `
          <div class="catalog-card-header">
            <span class="catalog-card-badge ${isActive ? 'badge-active' : 'badge-available'}">
              ${isActive ? 'Currently Active' : 'Available'}
            </span>
            <span style="font-size: 11.5px; color: var(--text-dim);">${course.modules || course.moduleCount || 4} Modules</span>
          </div>
          <div class="catalog-course-header-row" style="display: flex; align-items: center; gap: 8px; margin: 6px 0 4px 0;">
            <span class="catalog-course-icon" style="display: inline-flex; align-items: center; color: var(--accent-cyan);">${iconSvg}</span>
            <h4 class="catalog-course-title" style="margin: 0;">${course.title}</h4>
          </div>
          <p class="catalog-course-desc">${course.description}</p>
          <div class="catalog-card-meta">
            <span>${course.tasks || course.taskCount || 8} Hands-on Tasks</span>
            <button class="btn-select-course ${isActive ? 'active' : ''}">
              ${isActive ? 'Selected' : 'Switch Course'}
            </button>
          </div>
        `;

        card.addEventListener('click', async () => {
          if (course.id !== state.currentCourseId) {
            if (dom.catalogModal) dom.catalogModal.classList.add('hidden');
            await selectChapter(course.id);
            renderCatalogCourses(coursesList);
          }
        });

        dom.coursesCatalogGrid.appendChild(card);
      });
    }
  }

  // =========================================================================
  // CHAPTER SELECTION CONTROLLER (Flagship Chapters)
  // =========================================================================
  function setupChapterSelection() {
    if (dom.btnChangeChapter) {
      dom.btnChangeChapter.addEventListener('click', () => {
        openChapterSelectionModal();
      });
    }

    if (dom.btnCloseChapterModal) {
      dom.btnCloseChapterModal.addEventListener('click', () => {
        if (dom.chapterSelectModal) dom.chapterSelectModal.classList.add('hidden');
      });
    }

    // Card 1: RAG
    if (dom.chapterCardRag) {
      dom.chapterCardRag.addEventListener('click', () => {
        selectChapter('rag-intro');
      });
    }
    if (dom.btnSelectRag) {
      dom.btnSelectRag.addEventListener('click', (e) => {
        e.stopPropagation();
        selectChapter('rag-intro');
      });
    }

    // Card 2: MCP
    if (dom.chapterCardMcp) {
      dom.chapterCardMcp.addEventListener('click', () => {
        selectChapter('mcp-agentic');
      });
    }
    if (dom.btnSelectMcp) {
      dom.btnSelectMcp.addEventListener('click', (e) => {
        e.stopPropagation();
        selectChapter('mcp-agentic');
      });
    }
  }

  function openChapterSelectionModal() {
    if (dom.catalogModal) dom.catalogModal.classList.add('hidden');
    updateChapterCardsActiveState();
    if (dom.chapterSelectModal) {
      dom.chapterSelectModal.classList.remove('hidden');
    }
  }

  function updateChapterCardsActiveState() {
    const isRAG = (state.currentCourseId === 'rag-intro');
    const isMCP = (state.currentCourseId === 'mcp-agentic');

    if (dom.chapterCardRag) {
      dom.chapterCardRag.classList.toggle('active-chapter', isRAG);
      const status = dom.chapterCardRag.querySelector('#chapter-status-rag');
      if (status) status.textContent = isRAG ? 'Currently Active' : 'Available';
      const btn = dom.chapterCardRag.querySelector('.btn-select-chapter');
      if (btn) btn.innerHTML = isRAG ? '<span>Active Chapter</span>' : '<span>Launch Chapter 1</span> <span class="arrow-icon"><svg class="svg-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></span>';
    }

    if (dom.chapterCardMcp) {
      dom.chapterCardMcp.classList.toggle('active-chapter', isMCP);
      const status = dom.chapterCardMcp.querySelector('#chapter-status-mcp');
      if (status) status.textContent = isMCP ? 'Currently Active' : 'Available';
      const btn = dom.chapterCardMcp.querySelector('.btn-select-chapter');
      if (btn) btn.innerHTML = isMCP ? '<span>Active Chapter</span>' : '<span>Launch Chapter 2</span> <span class="arrow-icon"><svg class="svg-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></span>';
    }
  }

  function updateTopbarChapterBadge(courseId) {
    if (dom.topbarChapterIcon) {
      dom.topbarChapterIcon.innerHTML = getLucideIcon('layers', 16);
    }
    if (dom.topbarChapterBadge) {
      dom.topbarChapterBadge.textContent = 'RAG & Vectors';
      dom.topbarChapterBadge.className = 'topbar-chapter-badge badge-ch1';
    }
    if (dom.topbarChapterTitle) {
      dom.topbarChapterTitle.textContent = 'Foundations of RAG & Vector Databases';
    }
    if (dom.courseTitleText) {
      dom.courseTitleText.textContent = 'RAG & Vectors';
    }
  }

  async function selectChapter(courseId) {
    if (!courseId) return;

    state.currentCourseId = courseId;
    localStorage.setItem('rag_studio_active_course', courseId);
    loadProgress();

    updateTopbarChapterBadge(courseId);
    updateChapterCardsActiveState();

    // Update slides iframes to match selected chapter
    const slidesUrl = `/slides/?chapter=${courseId}`;
    if (dom.iframeLeftSlides) {
      dom.iframeLeftSlides.src = slidesUrl;
    }
    if (dom.iframeModalSlides) {
      dom.iframeModalSlides.src = slidesUrl;
    }

    if (dom.chapterSelectModal) {
      dom.chapterSelectModal.classList.add('hidden');
    }

    const isRAG = (courseId === 'rag-intro');
    const toastTitle = isRAG
      ? 'Chapter 1: Vector Databases & RAG Fundamentals'
      : 'Chapter 2: Model Context Protocol (MCP) & Autonomous Agent Tools';
    showToast(`Switched chapter to: ${toastTitle}`);

    // Notify backend controller about chapter switch
    try {
      await fetch('/api/v1/switch-chapter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapter: courseId })
      });
    } catch (e) {
      // Offline / standalone mode graceful handling
    }

    await loadCurriculum(courseId);
  }

  // =========================================================================
  // ENVIRONMENT RESET WORKSPACE
  // =========================================================================
  function setupResetEnvironment() {
    if (dom.btnResetEnv) {
      dom.btnResetEnv.addEventListener('click', () => {
        if (dom.resetEnvModal) dom.resetEnvModal.classList.remove('hidden');
      });
    }

    if (dom.btnCloseResetModal) {
      dom.btnCloseResetModal.addEventListener('click', () => {
        if (dom.resetEnvModal) dom.resetEnvModal.classList.add('hidden');
      });
    }

    if (dom.btnCancelReset) {
      dom.btnCancelReset.addEventListener('click', () => {
        if (dom.resetEnvModal) dom.resetEnvModal.classList.add('hidden');
      });
    }

    if (dom.btnConfirmReset) {
      dom.btnConfirmReset.addEventListener('click', async () => {
        if (dom.resetEnvModal) dom.resetEnvModal.classList.add('hidden');
        showToast('Resetting workspace to clean template state...');

        try {
          const res = await fetch('/api/v1/workspace/reset', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ scope: 'environment', course_id: state.currentCourseId })
          });

          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            setTimeout(() => {
              if (dom.iframeVscode) dom.iframeVscode.src = dom.iframeVscode.src;
              if (dom.iframeJupyter) dom.iframeJupyter.src = dom.iframeJupyter.src;
              if (dom.iframeBrowser) dom.iframeBrowser.src = dom.iframeBrowser.src;
              showToast(data.message || 'Workspace successfully restored to template');
            }, 600);
          } else {
            throw new Error(`HTTP ${res.status}`);
          }
        } catch (err) {
          console.warn('[workspace-reset] Backend reset API unavailable, using graceful fallback:', err);
          setTimeout(() => {
            if (dom.iframeVscode) dom.iframeVscode.src = dom.iframeVscode.src;
            if (dom.iframeJupyter) dom.iframeJupyter.src = dom.iframeJupyter.src;
            if (dom.iframeBrowser) dom.iframeBrowser.src = dom.iframeBrowser.src;
            showToast('Workspace interface refreshed');
          }, 600);
        }
      });
    }
  }

  // =========================================================================
  // CURRICULUM LOADER & TASK CONTROLLER
  // =========================================================================
  async function loadCurriculum(courseId = null) {
    const targetCourse = 'rag-mcp';
    state.currentCourseId = 'rag-mcp';
    localStorage.setItem('rag_studio_active_course', 'rag-mcp');
    loadProgress();

    const candidateUrls = [
      'tasks.json',
      '/tasks.json',
      'courses/rag-mcp/tasks.json',
      '/courses/rag-mcp/tasks.json'
    ];

    let loadedData = null;
    let successfulUrl = null;
    for (const url of candidateUrls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          loadedData = await res.json();
          successfulUrl = url;
          break;
        }
      } catch (err) {}
    }

    if (loadedData && Array.isArray(loadedData.modules)) {
      console.log(`[curriculum] Loaded course '${targetCourse}' from ${successfulUrl} (${loadedData.modules.length} modules)`);
      state.modules = loadedData.modules;
      state.currentModuleIndex = 0;
      state.currentTaskIndex = 0;
      updateTopbarChapterBadge(targetCourse);
      populateModuleDropdown();
      renderCurrentTask();
    } else {
      console.error('Failed to load curriculum for:', targetCourse);
      showToast(`Error loading curriculum for ${targetCourse}`);
    }
  }

  function populateModuleDropdown() {
    if (!dom.moduleSelect) return;
    dom.moduleSelect.innerHTML = '';
    state.modules.forEach((mod, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `${mod.title}`;
      dom.moduleSelect.appendChild(opt);
    });
    dom.moduleSelect.value = state.currentModuleIndex || 0;

    if (!dom.moduleSelect.dataset.hasChangeListener) {
      dom.moduleSelect.dataset.hasChangeListener = 'true';
      dom.moduleSelect.addEventListener('change', (e) => {
        state.currentModuleIndex = parseInt(e.target.value, 10);
        state.currentTaskIndex = 0;
        renderCurrentTask();
      });
    }
  }

  function renderCurrentTask() {
    const mod = state.modules[state.currentModuleIndex];
    if (!mod || !mod.tasks || mod.tasks.length === 0) return;

    const task = mod.tasks[state.currentTaskIndex];
    if (!task) return;

    if (dom.taskBadgeModule) dom.taskBadgeModule.textContent = `Module ${state.currentModuleIndex + 1}`;
    if (dom.taskBadgeId) dom.taskBadgeId.textContent = task.id;
    if (dom.taskTitle) dom.taskTitle.textContent = task.title;
    if (dom.taskInstructions) dom.taskInstructions.textContent = task.instructions || '';
    if (dom.solutionContentBody) dom.solutionContentBody.textContent = task.referenceSolution || task.solution || 'No solution provided.';

    if (dom.stepCounter) dom.stepCounter.textContent = `Task ${state.currentTaskIndex + 1} of ${mod.tasks.length}`;

    renderCommands(task.commands || []);
    renderQuestionForm(task);

    if (dom.btnPrevTask) {
      dom.btnPrevTask.disabled = (state.currentModuleIndex === 0 && state.currentTaskIndex === 0);
    }
    const isLastTask = (state.currentTaskIndex === mod.tasks.length - 1);
    const isLastModule = (state.currentModuleIndex === state.modules.length - 1);
    if (dom.btnNextTask) {
      dom.btnNextTask.innerHTML = (isLastTask && isLastModule)
        ? '<span>Course Completed</span>'
        : '<span>Next Task</span> <svg class="svg-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
    }

    switchTaskSubtab('task');
  }

  function renderCommands(commands) {
    if (!dom.commandsList) return;
    dom.commandsList.innerHTML = '';
    if (!commands || commands.length === 0) {
      dom.commandsList.innerHTML = '<div class="command-snippet-item"><span class="command-text"># No commands required</span></div>';
      return;
    }

    commands.forEach(cmd => {
      const item = document.createElement('div');
      item.className = 'command-snippet-item';
      
      const txt = document.createElement('span');
      txt.className = 'command-text';
      txt.textContent = cmd;

      const btn = document.createElement('button');
      btn.className = 'btn-copy-command';
      btn.innerHTML = `${getLucideIcon('copy', 13)} <span>Copy</span>`;
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(cmd).then(() => {
          btn.innerHTML = `${getLucideIcon('check', 13)} <span>Copied</span>`;
          setTimeout(() => {
            btn.innerHTML = `${getLucideIcon('copy', 13)} <span>Copy</span>`;
          }, 1500);
        });
      });

      item.appendChild(txt);
      item.appendChild(btn);
      dom.commandsList.appendChild(item);
    });
  }

  function renderQuestionForm(task) {
    const q = task.question;
    if (dom.questionPrompt) dom.questionPrompt.textContent = q ? q.prompt : 'Verify your implementation using the terminal.';
    if (dom.questionBody) dom.questionBody.innerHTML = '';
    if (dom.feedbackAlert) dom.feedbackAlert.className = 'feedback-alert hidden';
    if (dom.hintContentBox) {
      dom.hintContentBox.className = 'hint-content-box hidden';
      dom.hintContentBox.textContent = (q && q.hint) ? q.hint : 'No hints available.';
    }

    const saved = state.answers[task.id];
    if (saved && saved.answered) {
      updateAnswerPill(saved.correct);
      showFeedback(saved.correct, q ? q.explanation : '');
    } else {
      updateAnswerPill(null);
    }

    if (!q || !dom.questionBody) return;

    if (q.type === 'mcq') {
      const list = document.createElement('div');
      list.className = 'options-list';
      q.options.forEach((optItem, optIdx) => {
        let optText = '';
        if (typeof optItem === 'object' && optItem !== null) {
          optText = optItem.text || optItem.label || optItem.title || optItem.value || '';
        } else {
          optText = String(optItem ?? '');
        }
        if (typeof optText === 'object') {
          try {
            optText = JSON.stringify(optText);
          } catch (_) {
            optText = '';
          }
        }
        const isObj = (typeof optItem === 'object' && optItem !== null);
        const optVal = isObj ? (optItem.id !== undefined ? optItem.id : optIdx) : optIdx;

        const isSelected = saved && (saved.value === optVal || saved.value === optIdx);

        const label = document.createElement('label');
        label.className = 'mcq-option-label';
        if (isSelected) {
          label.classList.add('selected');
          if (saved.correct) label.classList.add('correct');
          else label.classList.add('incorrect');
        }

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `mcq-${task.id}`;
        input.value = optVal;
        input.checked = !!isSelected;
        input.addEventListener('change', () => {
          validateMCQ(task, optVal, optIdx);
        });

        const span = document.createElement('span');
        span.textContent = optText;

        label.appendChild(input);
        label.appendChild(span);
        list.appendChild(label);
      });
      dom.questionBody.appendChild(list);
    } else if (q.type === 'numeric' || q.type === 'nat') {
      const group = document.createElement('div');
      group.className = 'numeric-input-group';

      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'numeric-input-field';
      input.placeholder = 'Enter numeric result (e.g. 12 or 384)';
      if (saved && saved.value !== undefined) input.value = saved.value;

      const submitBtn = document.createElement('button');
      submitBtn.className = 'btn btn-primary';
      submitBtn.textContent = 'Submit';
      submitBtn.addEventListener('click', () => {
        validateNumeric(task, input.value);
      });

      group.appendChild(input);
      group.appendChild(submitBtn);
      dom.questionBody.appendChild(group);
    }
  }

  function validateMCQ(task, selectedVal, selectedIdx) {
    const q = task.question;
    if (typeof selectedVal === 'number' && selectedIdx === undefined) {
      selectedIdx = selectedVal;
    }
    const isCorrect = (selectedVal === q.correctOptionId || selectedIdx === q.correct_index);
    state.answers[task.id] = { answered: true, correct: isCorrect, value: selectedVal };
    saveProgress();

    if (dom.questionBody) {
      const labels = dom.questionBody.querySelectorAll('.mcq-option-label');
      labels.forEach((lbl) => {
        const radio = lbl.querySelector('input[type="radio"]');
        if (radio && radio.checked) {
          lbl.classList.add('selected');
          lbl.classList.toggle('correct', isCorrect);
          lbl.classList.toggle('incorrect', !isCorrect);
        } else {
          lbl.classList.remove('selected', 'correct', 'incorrect');
        }
      });
    }

    updateAnswerPill(isCorrect);
    showFeedback(isCorrect, q.explanation);
  }

  function validateNumeric(task, rawValue) {
    const q = task.question;
    const strVal = String(rawValue || '').trim().toLowerCase();
    const val = parseFloat(rawValue);
    let isCorrect = false;

    // Check direct numeric comparison
    if (!isNaN(val) && typeof q.expected === 'number') {
      const expected = q.expected;
      const absTol = q.absoluteTolerance !== undefined ? q.absoluteTolerance : 0.001;
      const relTol = q.relativeTolerance || 0;
      const maxDiff = Math.max(absTol, relTol * Math.abs(expected));
      if (Math.abs(val - expected) <= maxDiff) {
        isCorrect = true;
      }
    }

    // Check textual or alternative matches (e.g. 'Doc #23', '30 paragraphs')
    if (!isCorrect && task.solution) {
      const solClean = String(task.solution).trim().toLowerCase();
      if (strVal === solClean || strVal.includes(solClean)) {
        isCorrect = true;
      }
    }

    state.answers[task.id] = { answered: true, correct: isCorrect, value: rawValue };
    saveProgress();

    updateAnswerPill(isCorrect);
    showFeedback(isCorrect, q.explanation);
  }

  function updateAnswerPill(isCorrect) {
    if (!dom.answerStatusPill) return;
    if (isCorrect === true) {
      dom.answerStatusPill.className = 'answer-status-pill status-correct';
      dom.answerStatusPill.textContent = 'Verified';
    } else if (isCorrect === false) {
      dom.answerStatusPill.className = 'answer-status-pill status-incorrect';
      dom.answerStatusPill.textContent = 'Try Again';
    } else {
      dom.answerStatusPill.className = 'answer-status-pill status-unanswered';
      dom.answerStatusPill.textContent = 'Not Answered';
    }
  }

  function showFeedback(isCorrect, explanation) {
    if (!dom.feedbackAlert) return;
    dom.feedbackAlert.className = `feedback-alert ${isCorrect ? 'correct' : 'incorrect'}`;
    if (dom.feedbackIcon) dom.feedbackIcon.innerHTML = isCorrect ? getLucideIcon('check', 16) : getLucideIcon('x', 16);
    if (dom.feedbackTitle) dom.feedbackTitle.textContent = isCorrect ? 'Objective Verified' : 'Incorrect Answer';
    if (dom.feedbackText) dom.feedbackText.textContent = explanation || '';
  }

  // Navigation Buttons
  if (dom.btnPrevTask) {
    dom.btnPrevTask.addEventListener('click', () => {
      if (state.currentTaskIndex > 0) {
        state.currentTaskIndex--;
        renderCurrentTask();
      } else if (state.currentModuleIndex > 0) {
        state.currentModuleIndex--;
        state.currentTaskIndex = state.modules[state.currentModuleIndex].tasks.length - 1;
        if (dom.moduleSelect) dom.moduleSelect.value = state.currentModuleIndex;
        renderCurrentTask();
      }
    });
  }

  if (dom.btnNextTask) {
    dom.btnNextTask.addEventListener('click', () => {
      const mod = state.modules[state.currentModuleIndex];
      if (state.currentTaskIndex < mod.tasks.length - 1) {
        state.currentTaskIndex++;
        renderCurrentTask();
      } else if (state.currentModuleIndex < state.modules.length - 1) {
        state.currentModuleIndex++;
        state.currentTaskIndex = 0;
        if (dom.moduleSelect) dom.moduleSelect.value = state.currentModuleIndex;
        renderCurrentTask();
      } else {
        showToast('All modules completed');
      }
    });
  }

  // Task Subtabs (Instructions vs Solution)
  if (dom.subtabBtnTask) dom.subtabBtnTask.addEventListener('click', () => switchTaskSubtab('task'));
  if (dom.subtabBtnSolution) dom.subtabBtnSolution.addEventListener('click', () => switchTaskSubtab('solution'));

  function switchTaskSubtab(tab) {
    if (dom.subtabBtnTask) dom.subtabBtnTask.classList.toggle('active', tab === 'task');
    if (dom.subtabBtnSolution) dom.subtabBtnSolution.classList.toggle('active', tab === 'solution');
    if (dom.subviewTask) dom.subviewTask.classList.toggle('active', tab === 'task');
    if (dom.subviewSolution) dom.subviewSolution.classList.toggle('active', tab === 'solution');
  }

  // Hint Toggle
  if (dom.hintToggleBtn) {
    dom.hintToggleBtn.addEventListener('click', () => {
      if (!dom.hintContentBox) return;
      const isHidden = dom.hintContentBox.classList.contains('hidden');
      dom.hintContentBox.classList.toggle('hidden', !isHidden);
      dom.hintToggleBtn.innerHTML = `${getLucideIcon('lightbulb', 14)} <span>${isHidden ? 'Hide Hint' : 'Show Hint'}</span>`;
    });
  }

  // =========================================================================
  // PERSISTENT LIVE ANNOTATION, IPAD LASER & DRAGGABLE DOCK
  // =========================================================================
  function setupAnnotationsAndLaser() {
    const canvas = dom.screenAnnotationCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Drawing states
    let isPointerDown = false;
    let penStrokes = []; // Persistent array of { mode, color, size, points: [{x, y}] }
    let currentPenStroke = null;
    let laserStrokes = []; // Array of { points: [{x, y, time}] }
    let currentLaserStroke = null;
    let laserCursor = { x: -100, y: -100, active: false };

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // Menu dropdown toggler
    if (dom.btnAnnotateMenu) {
      dom.btnAnnotateMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dom.annotationDropdown) dom.annotationDropdown.classList.toggle('hidden');
      });
    }
    window.addEventListener('click', () => {
      if (dom.annotationDropdown) dom.annotationDropdown.classList.add('hidden');
    });

    // Tool Activation
    if (dom.btnToolLaser) dom.btnToolLaser.addEventListener('click', () => setAnnotationMode('laser'));
    if (dom.btnToolPen) dom.btnToolPen.addEventListener('click', () => setAnnotationMode('pen'));
    if (dom.btnToolInteract) dom.btnToolInteract.addEventListener('click', () => setAnnotationMode('interact'));
    if (dom.btnToolOff) dom.btnToolOff.addEventListener('click', () => setAnnotationMode('off'));
    if (dom.btnFloatingClose) dom.btnFloatingClose.addEventListener('click', () => setAnnotationMode('off'));

    // Floating toolbar mode buttons
    if (dom.toolModeLaser) {
      dom.toolModeLaser.addEventListener('click', () => setAnnotationMode('laser'));
    }
    if (dom.toolModePen) {
      dom.toolModePen.addEventListener('click', () => {
        state.penTool = 'pen';
        setAnnotationMode('pen');
      });
    }
    if (dom.toolModeHighlighter) {
      dom.toolModeHighlighter.addEventListener('click', () => {
        state.penTool = 'highlighter';
        setAnnotationMode('pen');
      });
    }
    if (dom.toolModeErase) {
      dom.toolModeErase.addEventListener('click', () => {
        state.penTool = 'erase';
        setAnnotationMode('pen');
      });
    }
    if (dom.toolModeInteract) {
      dom.toolModeInteract.addEventListener('click', () => setAnnotationMode('interact'));
    }

    // Color Swatches
    document.querySelectorAll('.floating-color-dot').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.floating-color-dot').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.penColor = btn.getAttribute('data-color') || '#f43f5e';
        if (state.penTool === 'erase' || state.annotationMode === 'interact') {
          state.penTool = 'pen';
          setAnnotationMode('pen');
        }
      });
    });

    // Stroke Sizes
    document.querySelectorAll('.floating-size-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.floating-size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.penSize = parseInt(btn.getAttribute('data-size') || '3', 10);
      });
    });

    // Canvas Rendering & Loop Management
    let laserRafId = null;

    function renderStaticCanvas() {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      penStrokes.forEach(stroke => drawSingleSmoothStroke(ctx, stroke));
      if (state.annotationMode === 'laser' && laserCursor.active) {
        drawLaserBeacon(ctx, laserCursor.x, laserCursor.y);
      }
    }

    function startLaserLoop() {
      if (laserRafId !== null) return;
      laserRafId = requestAnimationFrame(renderAnnotationLoop);
    }

    function stopLaserLoop() {
      if (laserRafId !== null) {
        cancelAnimationFrame(laserRafId);
        laserRafId = null;
      }
    }

    // Undo & Clear All
    if (dom.btnFloatingUndo) {
      dom.btnFloatingUndo.addEventListener('click', () => {
        penStrokes.pop();
        renderStaticCanvas();
      });
    }
    if (dom.btnFloatingClear) {
      dom.btnFloatingClear.addEventListener('click', () => {
        penStrokes = [];
        laserStrokes = [];
        stopLaserLoop();
        renderStaticCanvas();
        showToast('All screen drawings cleared');
      });
    }

    // Draggable Floating Toolbar Mechanics
    const toolbar = dom.floatingPenToolbar;
    const handle = dom.floatingToolbarHandle;
    let isDraggingToolbar = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let toolbarStartX = 0;
    let toolbarStartY = 0;

    function clampToolbarToBounds() {
      if (!toolbar) return;
      const rect = toolbar.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const maxW = Math.max(10, window.innerWidth - rect.width - 10);
      const maxH = Math.max(10, window.innerHeight - rect.height - 10);

      let currentX = rect.left;
      let currentY = rect.top;

      let clampedX = Math.max(10, Math.min(maxW, currentX));
      let clampedY = Math.max(10, Math.min(maxH, currentY));

      if (Math.abs(clampedX - currentX) > 1 || Math.abs(clampedY - currentY) > 1 || toolbar.style.transform !== 'none') {
        toolbar.style.left = `${clampedX}px`;
        toolbar.style.top = `${clampedY}px`;
        toolbar.style.bottom = 'auto';
        toolbar.style.transform = 'none';
        try {
          localStorage.setItem('rag_studio_annotation_pos', JSON.stringify({ x: clampedX, y: clampedY }));
        } catch (err) {}
      }
    }

    window.addEventListener('resize', () => {
      resizeCanvas();
      clampToolbarToBounds();
    });
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        resizeCanvas();
        clampToolbarToBounds();
      }, 150);
    });

    // Restore saved toolbar coordinates
    try {
      const savedPos = localStorage.getItem('rag_studio_annotation_pos');
      if (savedPos && toolbar) {
        const { x, y } = JSON.parse(savedPos);
        toolbar.style.left = `${x}px`;
        toolbar.style.top = `${y}px`;
        toolbar.style.bottom = 'auto';
        toolbar.style.transform = 'none';
      }
    } catch (e) {}

    if (toolbar) {
      toolbar.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button, input, select, textarea, a')) return;
        isDraggingToolbar = true;
        try {
          toolbar.setPointerCapture(e.pointerId);
        } catch (_) {}
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        const rect = toolbar.getBoundingClientRect();
        toolbarStartX = rect.left;
        toolbarStartY = rect.top;
        toolbar.style.bottom = 'auto';
        toolbar.style.transform = 'none';
        toolbar.classList.add('is-dragging');
      });

      toolbar.addEventListener('pointermove', (e) => {
        if (!isDraggingToolbar) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        let newX = toolbarStartX + dx;
        let newY = toolbarStartY + dy;

        const maxW = Math.max(10, window.innerWidth - toolbar.offsetWidth - 10);
        const maxH = Math.max(10, window.innerHeight - toolbar.offsetHeight - 10);
        newX = Math.max(10, Math.min(maxW, newX));
        newY = Math.max(10, Math.min(maxH, newY));

        toolbar.style.left = `${newX}px`;
        toolbar.style.top = `${newY}px`;
      });

      const stopDrag = (e) => {
        if (isDraggingToolbar) {
          isDraggingToolbar = false;
          if (e && e.pointerId) {
            try {
              toolbar.releasePointerCapture(e.pointerId);
            } catch (_) {}
          }
          toolbar.classList.remove('is-dragging');
          try {
            const rect = toolbar.getBoundingClientRect();
            localStorage.setItem('rag_studio_annotation_pos', JSON.stringify({ x: rect.left, y: rect.top }));
          } catch (err) {}
        }
      };
      toolbar.addEventListener('pointerup', stopDrag);
      toolbar.addEventListener('pointercancel', stopDrag);
    }

    function updateToolModeButtons() {
      const mode = state.annotationMode;
      const subtool = state.penTool;
      if (dom.toolModeLaser) dom.toolModeLaser.classList.toggle('active', mode === 'laser');
      if (dom.toolModePen) dom.toolModePen.classList.toggle('active', mode === 'pen' && subtool === 'pen');
      if (dom.toolModeHighlighter) dom.toolModeHighlighter.classList.toggle('active', mode === 'pen' && subtool === 'highlighter');
      if (dom.toolModeErase) dom.toolModeErase.classList.toggle('active', mode === 'pen' && subtool === 'erase');
      if (dom.toolModeInteract) dom.toolModeInteract.classList.toggle('active', mode === 'interact');
    }

    setAnnotationMode = function(mode) {
      if (mode === 'annotate') mode = 'pen';
      state.annotationMode = mode;
      if (dom.annotationDropdown) dom.annotationDropdown.classList.add('hidden');
      updateToolModeButtons();

      const toolbarActive = (mode !== 'off');
      const pointerCapturing = (mode === 'pen' || mode === 'laser');

      if (dom.screenAnnotationWrapper) {
        dom.screenAnnotationWrapper.classList.toggle('pointer-events-none', !pointerCapturing);
        dom.screenAnnotationWrapper.classList.toggle('pointer-events-auto', pointerCapturing);
        dom.screenAnnotationWrapper.style.pointerEvents = pointerCapturing ? 'auto' : 'none';
      }
      if (dom.floatingPenToolbar) {
        dom.floatingPenToolbar.classList.toggle('hidden', !toolbarActive);
        if (toolbarActive) setTimeout(clampToolbarToBounds, 50);
      }
      if (dom.btnAnnotateMenu) {
        dom.btnAnnotateMenu.classList.toggle('active', toolbarActive);
      }
      if (dom.btnHudAnnotate) {
        dom.btnHudAnnotate.classList.toggle('active', toolbarActive);
        if (dom.hudAnnotateText) {
          dom.hudAnnotateText.textContent = toolbarActive ? 'Annotating' : 'Annotate';
        }
      }
      if (dom.btnFocusAnnotatePersistent) {
        dom.btnFocusAnnotatePersistent.classList.toggle('active', toolbarActive);
        if (dom.dockAnnotateLabel) {
          dom.dockAnnotateLabel.textContent = toolbarActive ? 'Annotating' : 'Annotate';
        }
      }

      if (mode === 'off') {
        stopLaserLoop();
        laserCursor.active = false;
        laserStrokes = [];
        renderStaticCanvas();
        showToast('Annotation dock closed');
      } else if (mode === 'interact') {
        stopLaserLoop();
        laserCursor.active = false;
        laserStrokes = [];
        renderStaticCanvas();
        showToast('Interact mode: overlay click-through enabled');
      } else if (mode === 'laser') {
        laserCursor.active = true;
        renderStaticCanvas();
        showToast('Laser mode active');
      } else if (mode === 'pen') {
        stopLaserLoop();
        laserCursor.active = false;
        laserStrokes = [];
        renderStaticCanvas();
        showToast('Screen Pen active');
      }
    };

    // Pointer Interception across the entire screen
    canvas.addEventListener('pointerdown', (e) => {
      if (state.annotationMode === 'interact' || state.annotationMode === 'off') return;
      isPointerDown = true;
      const pt = { x: e.clientX, y: e.clientY, time: Date.now() };

      if (state.annotationMode === 'laser') {
        currentLaserStroke = { points: [pt] };
        laserStrokes.push(currentLaserStroke);
        laserCursor = { x: e.clientX, y: e.clientY, active: true };
        startLaserLoop();
      } else if (state.annotationMode === 'pen') {
        currentPenStroke = {
          mode: state.penTool,
          color: state.penColor,
          size: state.penSize,
          points: [{ x: e.clientX, y: e.clientY }]
        };
        penStrokes.push(currentPenStroke);
        renderStaticCanvas();
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      const now = Date.now();
      laserCursor.x = e.clientX;
      laserCursor.y = e.clientY;
      laserCursor.active = (state.annotationMode === 'laser');

      if (isPointerDown) {
        if (state.annotationMode === 'laser' && currentLaserStroke) {
          const lastPt = currentLaserStroke.points[currentLaserStroke.points.length - 1];
          if (!lastPt || Math.hypot(e.clientX - lastPt.x, e.clientY - lastPt.y) > 3) {
            currentLaserStroke.points.push({ x: e.clientX, y: e.clientY, time: now });
          }
          startLaserLoop();
        } else if (state.annotationMode === 'pen' && currentPenStroke) {
          const pts = currentPenStroke.points;
          const lastPt = pts[pts.length - 1];
          if (!lastPt || Math.hypot(e.clientX - lastPt.x, e.clientY - lastPt.y) > 2) {
            pts.push({ x: e.clientX, y: e.clientY });
            renderStaticCanvas();
          }
        }
      } else if (state.annotationMode === 'laser') {
        if (laserRafId === null) {
          renderStaticCanvas();
        }
      }
    });

    const stopDrawing = () => {
      isPointerDown = false;
      currentLaserStroke = null;
      currentPenStroke = null;
      if (state.annotationMode === 'pen') {
        renderStaticCanvas();
      }
    };
    canvas.addEventListener('pointerup', stopDrawing);
    canvas.addEventListener('pointercancel', stopDrawing);
    canvas.addEventListener('pointerleave', () => {
      laserCursor.active = false;
      stopDrawing();
      if (laserRafId === null) {
        renderStaticCanvas();
      }
    });

    // Main Animation Loop (Runs ONLY when laser mode is active and strokes exist or user draws)
    function renderAnnotationLoop() {
      // If not in laser mode or no strokes left and not actively drawing, pause RAF loop
      if (state.annotationMode !== 'laser' || (laserStrokes.length === 0 && !isPointerDown)) {
        laserRafId = null;
        renderStaticCanvas();
        return;
      }

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const now = Date.now();

      // 1. Draw persistent smooth pen & highlighter strokes
      penStrokes.forEach(stroke => drawSingleSmoothStroke(ctx, stroke));

      // 2. Draw iPad-style decaying glowing laser trails
      if (laserStrokes.length > 0) {
        laserStrokes = laserStrokes.filter(stroke => {
          stroke.points = stroke.points.filter(p => (now - p.time) < 1800);
          return stroke.points.length > 0;
        });

        laserStrokes.forEach(stroke => {
          drawLaserStroke(ctx, stroke.points, now);
        });
      }

      // 3. Draw active pointer beacon if laser mode is active
      if (state.annotationMode === 'laser' && laserCursor.active && (!isPointerDown || laserStrokes.length === 0)) {
        drawLaserBeacon(ctx, laserCursor.x, laserCursor.y);
      }

      // Continue loop only if laser strokes exist or user is holding pointer down
      if (state.annotationMode === 'laser' && (laserStrokes.length > 0 || isPointerDown)) {
        laserRafId = requestAnimationFrame(renderAnnotationLoop);
      } else {
        laserRafId = null;
        renderStaticCanvas();
      }
    }

    // Initial static canvas render (eliminates idle battery drain)
    renderStaticCanvas();

    // Exponential decay calculator for 1.8s decay
    function calcLaserDecay(age) {
      if (age >= 1800) return 0;
      const progress = Math.max(0, 1 - (age / 1800));
      return Math.max(0, Math.min(1, progress * Math.exp(-2.2 * (age / 1800))));
    }

    // Apple Keynote / Google Slides Continuous Laser Ribbon Renderer
    function drawLaserStroke(context, points, now) {
      if (!points || points.length === 0) return;

      const validPoints = points.filter(p => (now - p.time) <= 1800);
      const len = validPoints.length;
      if (len === 0) return;

      if (len === 1) {
        const p = validPoints[0];
        const alpha = calcLaserDecay(now - p.time);
        drawLaserBeacon(context, p.x, p.y, alpha);
        return;
      }

      const tip = validPoints[len - 1];
      const tail = validPoints[0];
      const tipAlpha = calcLaserDecay(now - tip.time);

      // Render continuous smooth polyline using midpoints to completely eliminate beaded segment joints
      function buildSmoothPath(ctx) {
        ctx.beginPath();
        ctx.moveTo(validPoints[0].x, validPoints[0].y);
        for (let i = 1; i < len - 1; i++) {
          const midX = (validPoints[i].x + validPoints[i + 1].x) / 2;
          const midY = (validPoints[i].y + validPoints[i + 1].y) / 2;
          ctx.quadraticCurveTo(validPoints[i].x, validPoints[i].y, midX, midY);
        }
        ctx.lineTo(tip.x, tip.y);
      }

      // Linear gradient along trajectory for seamless natural fade
      const grad = context.createLinearGradient(tail.x, tail.y, tip.x, tip.y);
      grad.addColorStop(0, 'rgba(255, 30, 80, 0)');
      grad.addColorStop(0.3, `rgba(255, 45, 90, ${0.4 * tipAlpha})`);
      grad.addColorStop(0.7, `rgba(255, 50, 100, ${0.8 * tipAlpha})`);
      grad.addColorStop(1, `rgba(255, 50, 100, ${0.98 * tipAlpha})`);

      // Pass 1: Diffused Neon Laser Aura
      context.save();
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.shadowColor = '#ff2055';
      context.shadowBlur = 16;
      context.strokeStyle = grad;
      context.lineWidth = 6;
      buildSmoothPath(context);
      context.stroke();
      context.restore();

      // Pass 2: High-Intensity Glowing Core
      context.save();
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.shadowColor = '#ffffff';
      context.shadowBlur = 6;
      context.strokeStyle = `rgba(255, 255, 255, ${0.9 * tipAlpha})`;
      context.lineWidth = 2.2;
      buildSmoothPath(context);
      context.stroke();
      context.restore();

      // Laser Tip Beacon
      drawLaserBeacon(context, tip.x, tip.y, tipAlpha);
    }

    // Glowing Laser Pointer Tip Indicator Dot
    function drawLaserBeacon(context, x, y, alpha = 1) {
      if (alpha <= 0.01) return;
      context.save();

      // 1. Wide diffused aura
      const grad1 = context.createRadialGradient(x, y, 1, x, y, 22);
      grad1.addColorStop(0, `rgba(255, 30, 80, ${0.5 * alpha})`);
      grad1.addColorStop(0.5, `rgba(255, 30, 80, ${0.18 * alpha})`);
      grad1.addColorStop(1, 'rgba(255, 30, 80, 0)');
      context.beginPath();
      context.arc(x, y, 22, 0, Math.PI * 2);
      context.fillStyle = grad1;
      context.fill();

      // 2. Focused vibrant beacon
      const grad2 = context.createRadialGradient(x, y, 0, x, y, 8);
      grad2.addColorStop(0, `rgba(255, 255, 255, ${0.95 * alpha})`);
      grad2.addColorStop(0.3, `rgba(255, 50, 95, ${0.95 * alpha})`);
      grad2.addColorStop(1, `rgba(255, 30, 80, ${0.4 * alpha})`);
      context.beginPath();
      context.arc(x, y, 8, 0, Math.PI * 2);
      context.fillStyle = grad2;
      context.shadowColor = '#ff2055';
      context.shadowBlur = 12;
      context.fill();

      // 3. Hot white pinpoint center
      context.beginPath();
      context.arc(x, y, 2.5, 0, Math.PI * 2);
      context.fillStyle = `rgba(255, 255, 255, ${0.98 * alpha})`;
      context.shadowColor = '#ffffff';
      context.shadowBlur = 4;
      context.fill();

      context.restore();
    }

    // Smooth Bézier Curve Pen Stroke Renderer
    function drawSingleSmoothStroke(context, stroke) {
      const pts = stroke.points;
      if (!pts || pts.length === 0) return;

      context.save();
      context.lineCap = 'round';
      context.lineJoin = 'round';

      if (stroke.mode === 'erase') {
        context.globalCompositeOperation = 'destination-out';
        context.lineWidth = stroke.size * 6;
      } else if (stroke.mode === 'highlighter') {
        context.globalAlpha = 0.35;
        context.strokeStyle = stroke.color;
        context.lineWidth = stroke.size * 4.5;
      } else {
        context.globalAlpha = 1.0;
        context.strokeStyle = stroke.color;
        context.lineWidth = stroke.size;
      }

      if (pts.length === 1) {
        context.beginPath();
        context.arc(pts[0].x, pts[0].y, (context.lineWidth || 3) / 2, 0, Math.PI * 2);
        context.fillStyle = (stroke.mode === 'erase' ? '#000000' : stroke.color);
        context.fill();
      } else if (pts.length === 2) {
        context.beginPath();
        context.moveTo(pts[0].x, pts[0].y);
        context.lineTo(pts[1].x, pts[1].y);
        context.stroke();
      } else {
        context.beginPath();
        context.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const midX = (pts[i].x + pts[i + 1].x) / 2;
          const midY = (pts[i].y + pts[i + 1].y) / 2;
          context.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }
        context.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        context.stroke();
      }

      context.restore();
    }
  }

  // =========================================================================
  // HEALTH & READINESS HEARTBEAT
  // =========================================================================
  function startHealthHeartbeat() {
    checkHealth();
    setInterval(checkHealth, 10000);
  }

  async function checkHealth() {
    if (!dom.statusDot || !dom.statusText) return;
    try {
      const res = await fetch('/health/ready');
      if (res.ok) {
        dom.statusDot.className = 'status-dot status-healthy';
        dom.statusText.textContent = 'Hub Ready';
      } else {
        dom.statusDot.className = 'status-dot status-degraded';
        dom.statusText.textContent = 'Degraded';
      }
    } catch (e) {
      dom.statusDot.className = 'status-dot status-unhealthy';
      dom.statusText.textContent = 'Disconnected';
    }
  }

  // =========================================================================
  // SESSION TIMER
  // =========================================================================
  function setupSessionTimer() {
    if (dom.sessionTimerWidget) {
      dom.sessionTimerWidget.addEventListener('click', () => {
        state.timerRunning = !state.timerRunning;
        showToast(state.timerRunning ? 'Timer resumed' : 'Timer paused');
      });
    }

    state.timerInterval = setInterval(() => {
      if (state.timerRunning && state.timerSeconds > 0) {
        state.timerSeconds--;
        const m = Math.floor(state.timerSeconds / 60);
        const s = state.timerSeconds % 60;
        if (dom.timerDisplay) {
          dom.timerDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
      }
    }, 1000);
  }

  // =========================================================================
  // MODALS & TOASTS
  // =========================================================================
  function setupModals() {
    // Backdrop click dismiss for ALL modals
    [dom.chapterSelectModal, dom.catalogModal, dom.resetEnvModal, dom.progressModal, dom.healthModal].forEach(modal => {
      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) modal.classList.add('hidden');
        });
      }
    });

    // Progress Modal
    if (dom.btnProgressModal) {
      dom.btnProgressModal.addEventListener('click', () => {
        if (dom.progressJsonView) {
          dom.progressJsonView.value = JSON.stringify(state.answers, null, 2);
        }
        if (dom.progressModal) dom.progressModal.classList.remove('hidden');
      });
    }
    if (dom.btnCloseProgressModal) {
      dom.btnCloseProgressModal.addEventListener('click', () => {
        if (dom.progressModal) dom.progressModal.classList.add('hidden');
      });
    }

    if (dom.btnExportProgress) {
      dom.btnExportProgress.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(state.answers, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `rag-progress-${Date.now()}.json`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
        showToast('Exported progress JSON');
      });
    }

    if (dom.importFileInput) {
      dom.importFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const parsed = JSON.parse(event.target.result);
            state.answers = parsed;
            saveProgress();
            renderCurrentTask();
            if (dom.progressJsonView) {
              dom.progressJsonView.value = JSON.stringify(state.answers, null, 2);
            }
            showToast('Imported progress successfully!');
          } catch (err) {
            showToast(`Import failed: ${err.message}`);
          }
        };
        reader.readAsText(file);
      });
    }

    if (dom.btnResetProgress) {
      dom.btnResetProgress.addEventListener('click', () => {
        if (confirm('Reset all verified task answers?')) {
          state.answers = {};
          saveProgress();
          renderCurrentTask();
          if (dom.progressJsonView) dom.progressJsonView.value = '{}';
          showToast('All answers reset');
        }
      });
    }

    // Health Diagnostics Modal
    if (dom.healthIndicatorBadge) {
      dom.healthIndicatorBadge.addEventListener('click', openHealthModal);
    }
    if (dom.btnCloseHealthModal) {
      dom.btnCloseHealthModal.addEventListener('click', () => {
        if (dom.healthModal) dom.healthModal.classList.add('hidden');
      });
    }
    if (dom.btnReprobeHealth) {
      dom.btnReprobeHealth.addEventListener('click', probeHealthDetails);
    }

    async function openHealthModal() {
      if (dom.healthModal) dom.healthModal.classList.remove('hidden');
      await probeHealthDetails();
    }

    async function probeHealthDetails() {
      if (!dom.healthChecksTable) return;
      dom.healthChecksTable.innerHTML = '<div class="health-check-row"><span>Probing services...</span></div>';
      const endpoints = [
        { name: 'Gateway Nginx Live (/health/live)', url: '/health/live' },
        { name: 'Hub Ready Marker (/health/ready)', url: '/health/ready' },
        { name: 'VS Code Health (/vscode/healthz)', url: '/vscode/healthz' },
        { name: 'JupyterLab API (/jupyter/api)', url: '/jupyter/api' },
        { name: 'Chromium Browser (/browser/vnc.html)', url: '/browser/vnc.html' },
        { name: 'Microservice API (/preview/8000/health)', url: '/preview/8000/health' }
      ];

      const rows = [];
      for (const ep of endpoints) {
        try {
          const res = await fetch(ep.url);
          const ok = res.ok;
          rows.push(`
            <div class="health-check-row">
              <span><strong>${ep.name}</strong></span>
              <span class="status-indicator-badge">
                <span class="status-dot ${ok ? 'status-healthy' : 'status-unhealthy'}"></span>
                <span>${res.status} ${res.statusText}</span>
              </span>
            </div>
          `);
        } catch (err) {
          rows.push(`
            <div class="health-check-row">
              <span><strong>${ep.name}</strong></span>
              <span class="status-indicator-badge">
                <span class="status-dot status-unhealthy"></span>
                <span>Error (${err.message})</span>
              </span>
            </div>
          `);
        }
      }
      dom.healthChecksTable.innerHTML = rows.join('');
    }
  }

  function showToast(message) {
    if (!dom.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast-item';
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  // =========================================================================
  // BOOTSTRAP
  // =========================================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
