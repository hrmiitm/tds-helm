/**
 * slides/app.js — Interactive Presentation Deck Logic
 * ==================================================
 * Implements Reveal.js lifecycle, Three.js 3D semantic vector space,
 * mathematical inspection of 384-d vectors vs 3D projections,
 * and interactive educational components for Slides 1 through 8.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Global deck state
let revealDeck = null;
let vectorsData = null;
let threeApp = null;

/* =========================================================================
   KATEX MATHEMATICAL RENDERING PIPELINE
   ========================================================================= */
function renderAllMath() {
  try {
    if (window.renderMathInElement) {
      window.renderMathInElement(document.body, {
        delimiters: [
          {left: '$$', right: '$$', display: true},
          {left: '\\[', right: '\\]', display: true},
          {left: '\\(', right: '\\)', display: false},
          {left: '$', right: '$', display: false}
        ],
        ignoredClasses: ['katex', 'katex-display'],
        throwOnError: false
      });
    }
  } catch (err) {
    console.warn('Safe math rendering caught error:', err);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 0. Auto-render initial math expressions on DOM ready
    try {
      renderAllMath();
    } catch (e) {
      console.warn('Initial math rendering caught error:', e);
    }

    // 1. Fetch vectors.json
    try {
      const resp = await fetch('./vectors.json');
      if (resp.ok) {
        vectorsData = await resp.json();
      }
    } catch (e) {
      console.warn('Failed to fetch vectors.json, using embedded fallback', e);
    }

    if (!vectorsData) {
      vectorsData = getEmbeddedVectorsFallback();
    }

    // 2. Setup Deck Navigation Controls & Fullscreen Close Handler
    setupDeckHeaderNav();
    setupCloseButtonAndEscape();
    setupKeyboardAndMessageNavigation();

    // 3. Initialize Slide 1 (Three.js 3D Space) if canvas container exists
    if (document.getElementById('vector-canvas-container')) {
      try {
        threeApp = initVectorSpace3D(vectorsData);
      } catch (e) {
        console.warn('Failed to initialize 3D vector space:', e);
      }
    }

    // 4. Initialize Reveal.js with strict keyboard isolation
    await initRevealDeck();

    // Auto-render math after Reveal initialization and refresh layout
    try {
      renderAllMath();
    } catch (e) {
      console.warn('Post-Reveal math rendering caught error:', e);
    }
    triggerRevealLayout();

    // 5. Initialize interactive widgets on all slides
    try { initSlide3SimilarityVisualizer(); } catch (e) { console.warn('Slide 3 Visualizer init:', e); }
    try { initSlide5ChromaSimulator(); } catch (e) { console.warn('Slide 5 Chroma simulator init:', e); }
    try { initSlide5Chunking(); } catch (e) { console.warn('Chunking init:', e); }
    try { initSlide7PromptSynthesis(); } catch (e) { console.warn('Prompt synthesis init:', e); }

    // 6. Setup Theme Listener for synchronization with Parent Hub
    setupThemeListener();

  } catch (err) {
    console.error('Presentation deck initialization error:', err);
  }
});

/* =========================================================================
   REVEAL.JS INITIALIZATION (Section 8.2 Contract)
   ========================================================================= */
async function initRevealDeck() {
  const widget = document.querySelector('.vector-widget');

  // Initialize Reveal.js singleton per Section 8.2 Contract and update.md 16:9 stage
  await Reveal.initialize({
    embedded: true,
    mouseWheel: false,
    autoSlide: 0,
    controls: false, // Custom accessible header navigation
    progress: true,
    history: true,
    hash: true,
    center: false,
    transition: 'slide',
    width: 1280,
    height: 720,
    margin: 0.04,
    minScale: 0.2,
    maxScale: 1.5,
    // Allow keyboard navigation across slides unless typing in inputs or interacting with 3D controls
    keyboardCondition: (event) => {
      const active = document.activeElement;
      const target = event.target;
      const tag = (active ? active.tagName : '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active && active.isContentEditable)) {
        return false;
      }
      if (widget) {
        const isInsideWidget = widget.contains(active) || widget.contains(target);
        if (isInsideWidget && ['BUTTON', 'SELECT', 'INPUT'].includes((target.tagName || '').toUpperCase())) {
          return false;
        }
      }
      return true;
    }
  });

  revealDeck = Reveal;
  window.revealDeck = Reveal;

  // Listen to slide changes to manage rendering lifecycle & header indicator
  Reveal.on('slidechanged', (event) => {
    updateSlideIndicator(event.indexh);

    // Stop/start 3D rendering loop based on slide visibility
    if (threeApp) {
      const curSlide = event.currentSlide;
      const hasWidget = curSlide && curSlide.querySelector('.vector-widget');
      if (hasWidget || event.indexh === 0) {
        threeApp.startRendering();
      } else {
        threeApp.stopRendering();
      }
    }

    // Re-render math if any dynamic slide elements were added
    try {
      renderAllMath();
    } catch (e) {
      console.warn('Slide change math rendering caught error:', e);
    }
  });

  // Initial indicator update
  updateSlideIndicator(Reveal.getIndices().h);
  if (threeApp) {
    const curSlide = Reveal.getCurrentSlide();
    if (Reveal.getIndices().h === 0 || (curSlide && curSlide.querySelector('.vector-widget'))) {
      threeApp.startRendering();
    }
  }
}

function setupDeckHeaderNav() {
  const btnPrev = document.getElementById('btn-slide-prev');
  const btnNext = document.getElementById('btn-slide-next');
  const btnLaser = document.getElementById('btn-slide-laser');
  const btnAnnotate = document.getElementById('btn-slide-annotate');

  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (typeof Reveal !== 'undefined' && Reveal.prev) Reveal.prev();
      else if (revealDeck) revealDeck.prev();
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (typeof Reveal !== 'undefined' && Reveal.next) Reveal.next();
      else if (revealDeck) revealDeck.next();
    });
  }

  if (btnLaser) {
    btnLaser.addEventListener('click', () => {
      if (window.parent) {
        window.parent.postMessage({ type: 'toggle-annotation', mode: 'laser' }, '*');
      }
    });
  }

  if (btnAnnotate) {
    btnAnnotate.addEventListener('click', () => {
      if (window.parent) {
        window.parent.postMessage({ type: 'toggle-annotation', mode: 'annotate' }, '*');
      }
    });
  }
}

function triggerRevealLayout() {
  if (typeof Reveal !== 'undefined' && typeof Reveal.layout === 'function') {
    Reveal.layout();
  }
  if (threeApp && typeof threeApp.onResize === 'function') {
    threeApp.onResize();
  }
}

function setupKeyboardAndMessageNavigation() {
  // Global resize and layout listeners
  window.addEventListener('resize', triggerRevealLayout);

  window.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === 'reveal-navigate') {
      if (e.data.direction === 'next') Reveal.next();
      else if (e.data.direction === 'prev') Reveal.prev();
    } else if (e.data.type === 'REVEAL_LAYOUT' || e.data.type === 'STUDIO_FOCUS_STATE' || e.data.type === 'CONTAINER_RESIZE') {
      triggerRevealLayout();
      setTimeout(triggerRevealLayout, 50);
      setTimeout(triggerRevealLayout, 150);
      setTimeout(triggerRevealLayout, 300);
    }
  });

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => triggerRevealLayout());
    ro.observe(document.body);
    const rev = document.querySelector('.reveal');
    if (rev) ro.observe(rev);
  }

  // Ensure Reveal.js responds to arrow keys (ArrowRight, ArrowLeft, PageDown, PageUp, Space)
  window.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const tag = active ? active.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active && active.isContentEditable)) {
      return;
    }

    const widget = document.querySelector('.vector-widget');
    if (widget && (widget.contains(active) || widget.contains(e.target))) {
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'PageDown' || ((e.key === ' ' || e.code === 'Space') && !e.shiftKey)) {
      e.preventDefault();
      if (typeof Reveal !== 'undefined' && typeof Reveal.next === 'function') {
        Reveal.next();
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || ((e.key === ' ' || e.code === 'Space') && e.shiftKey)) {
      e.preventDefault();
      if (typeof Reveal !== 'undefined' && typeof Reveal.prev === 'function') {
        Reveal.prev();
      }
    }
  });
}

function setupCloseButtonAndEscape() {
  const btnClose = document.getElementById('btn-slide-close');
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      // Exit browser fullscreen if active
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      // Post message to parent window
      try {
        window.parent?.postMessage({ type: 'CLOSE_SLIDES' }, '*');
        window.parent?.postMessage({ type: 'EXIT_FOCUS' }, '*');
      } catch (_) {}
    });
  }

  // Listen for Escape inside the slide frame
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      try {
        window.parent?.postMessage({ type: 'CLOSE_SLIDES' }, '*');
        window.parent?.postMessage({ type: 'EXIT_FOCUS' }, '*');
      } catch (_) {}
    }
  });
}

function updateSlideIndicator(index) {
  const indicator = document.getElementById('deck-slide-indicator');
  const titleDisplay = document.getElementById('deck-title-center');
  const visibleSections = document.querySelectorAll('.reveal .slides > section');
  const total = visibleSections.length || 8;
  const current = index + 1;

  if (indicator) {
    indicator.textContent = `Slide ${current} of ${total}`;
  }

  const currentSection = visibleSections[index];
  if (currentSection && titleDisplay) {
    const titleEl = currentSection.querySelector('.slide-title');
    const titleText = titleEl ? titleEl.textContent.trim() : '';
    titleDisplay.textContent = `${current}. ${titleText}`;
  }
}

/* =========================================================================
   SLIDE 4: THREE.JS 3D SEMANTIC VECTOR SPACE (Sections 8.1, 8.2, 8.3)
   ========================================================================= */
function initVectorSpace3D(vectors) {
  const widget = document.querySelector('.vector-widget');
  if (!widget) return null;

  const container = widget.querySelector('.canvas-container');
  const canvas = widget.querySelector('canvas');
  const labelsLayer = widget.querySelector('.canvas-labels-layer');
  const deckNavigation = document.querySelector('.deck-navigation');
  const fallbackEl = widget.querySelector('.webgl-fallback');

  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let animationFrameId = null;
  let isRendering = false;

  // Visual meshes
  const pointMeshes = [];
  const labelElements = [];
  let rayOriginVectorA = null;
  let rayOriginVectorB = null;
  let originAngleArc = null;
  let originPointMesh = null;

  // Selection state
  let selectedPointA = 'cat';
  let selectedPointB = 'cat_table';

  // Pointer tracking for picking (Section 8.2, rule 4: < 5px movement)
  let pointerStart = { x: 0, y: 0 };
  let pointerMoved = false;
  const raycaster = new THREE.Raycaster();
  const mouseCoords = new THREE.Vector2();
  const initialCameraPos = new THREE.Vector3(0, 3.5, 9.5);

  // Test WebGL support
  let isWebGLAvailable = false;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'default'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    isWebGLAvailable = true;
  } catch (err) {
    console.warn('WebGL initialization failed, enabling 2D fallback:', err);
    isWebGLAvailable = false;
  }

  // Handle WebGL context loss gracefully (Section 8.3)
  if (canvas) {
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      console.warn('WebGL context lost');
      stopRenderLoop();
      showWebGLFallback();
    }, false);

    canvas.addEventListener('webglcontextrestored', () => {
      console.info('WebGL context restored');
      hideWebGLFallback();
      initScene();
      startRenderLoop();
    }, false);
  }

  // Define initScene in scope so WebGL restoration and initial boot build scene safely
  function initScene() {
    if (!renderer) return;

    if (!scene) {
      scene = new THREE.Scene();
    } else {
      while (scene.children.length > 0) {
        const obj = scene.children[0];
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
        scene.remove(obj);
      }
    }
    scene.background = new THREE.Color(0x030712);

    if (!camera) {
      camera = new THREE.PerspectiveCamera(
        45,
        container.clientWidth / (container.clientHeight || 1),
        0.1,
        100
      );
    }
    camera.position.copy(initialCameraPos);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    // Grid plane & Origin
    const gridHelper = new THREE.GridHelper(10, 20, 0x334155, 0x1e293b);
    gridHelper.position.y = -2.5;
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(2.0);
    scene.add(axesHelper);

    // Origin point
    const originGeom = new THREE.SphereGeometry(0.1, 16, 16);
    const originMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
    originPointMesh = new THREE.Mesh(originGeom, originMat);
    scene.add(originPointMesh);

    // OrbitControls
    if (!controls) {
      controls = new OrbitControls(camera, canvas);
      controls.listenToKeyEvents(canvas); // NEVER window/document
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
    }
    controls.target.set(0, 0, 0);

    // Populate 3D Scene with vocabulary points
    pointMeshes.length = 0;
    if (labelsLayer) labelsLayer.innerHTML = '';
    labelElements.length = 0;

    const clusterColors = {
      'A': { hex: 0x38bdf8, css: '#38bdf8' }, // Royalty
      'B': { hex: 0x34d399, css: '#34d399' }, // Remote Work
      'C': { hex: 0xfbbf24, css: '#fbbf24' }  // Bread / Pastry
    };

    const sphereGeom = new THREE.SphereGeometry(0.2, 32, 32);

    vectors.vocabulary.forEach((item) => {
      const col = clusterColors[item.cluster] || { hex: 0xffffff, css: '#ffffff' };
      const material = new THREE.MeshStandardMaterial({
        color: col.hex,
        roughness: 0.3,
        metalness: 0.2,
        emissive: col.hex,
        emissiveIntensity: 0.2
      });

      const mesh = new THREE.Mesh(sphereGeom, material);
      mesh.position.set(item.projected_3d[0], item.projected_3d[1], item.projected_3d[2]);
      mesh.userData = item;
      scene.add(mesh);
      pointMeshes.push(mesh);

      // Create 2D HTML label
      if (labelsLayer) {
        const label = document.createElement('div');
        label.className = `point-label cluster-${item.cluster.toLowerCase()}`;
        label.textContent = item.label;
        label.setAttribute('data-id', item.id);
        label.addEventListener('click', (e) => {
          e.stopPropagation();
          handlePointSelection(item.id);
        });
        labelsLayer.appendChild(label);
        labelElements.push({ element: label, position: mesh.position, id: item.id });
      }
    });

    // Vector ray origin indicators
    const lineMatA = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 });
    const lineMatB = new THREE.LineBasicMaterial({ color: 0xf43f5e, linewidth: 2 });

    const geomLineA = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(1,1,1)]);
    const geomLineB = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(1,1,1)]);

    rayOriginVectorA = new THREE.Line(geomLineA, lineMatA);
    rayOriginVectorB = new THREE.Line(geomLineB, lineMatB);
    scene.add(rayOriginVectorA);
    scene.add(rayOriginVectorB);
    originAngleArc = null;

    updateRayVectors();
  }

  // 1. Set Canvas attributes and interactive pointer picking
  if (canvas) {
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '3D Semantic Vector Space Visualization');

    canvas.addEventListener('pointerdown', (e) => {
      canvas.focus({ preventScroll: true });
      pointerStart.x = e.clientX;
      pointerStart.y = e.clientY;
      pointerMoved = false;
    });

    canvas.addEventListener('pointermove', (e) => {
      const dx = Math.abs(e.clientX - pointerStart.x);
      const dy = Math.abs(e.clientY - pointerStart.y);
      if (dx >= 5 || dy >= 5) {
        pointerMoved = true;
      }
    });

    // Pointer-up picking (strict < 5px movement, primary button)
    canvas.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || pointerMoved || !camera) return;

      const rect = canvas.getBoundingClientRect();
      mouseCoords.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseCoords.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouseCoords, camera);
      const intersects = raycaster.intersectObjects(pointMeshes);

      if (intersects.length > 0) {
        const hitPoint = intersects[0].object.userData;
        handlePointSelection(hitPoint.id);
      }
    });
  }

  // 2. Bubble-phase event isolation on the widget (Section 8.2)
  const pointerEvents = [
    'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
    'lostpointercapture', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick'
  ];
  for (const type of pointerEvents) {
    widget.addEventListener(type, (event) => event.stopPropagation());
  }

  const cancelableEvents = [
    'wheel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'contextmenu'
  ];
  for (const type of cancelableEvents) {
    widget.addEventListener(type, (event) => {
      event.stopPropagation();
      if (event.target === canvas && event.cancelable) {
        event.preventDefault();
      }
    }, { passive: false });
  }

  const canvasKeys = new Set([
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    ' ', 'PageUp', 'PageDown', 'Home', 'End', 'Enter'
  ]);

  for (const type of ['keydown', 'keyup']) {
    widget.addEventListener(type, (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        // Cancel selection state and return focus to deck navigation
        if (type === 'keydown' && deckNavigation) {
          deckNavigation.focus({ preventScroll: true });
        }
      } else if (event.target === canvas && canvasKeys.has(event.key)) {
        event.preventDefault();
      }
    });
  }

  // 3. Handle Blur, cancel gestures (Section 8.2 rule 7)
  window.addEventListener('blur', () => { pointerMoved = true; });

  // 4. Visibilitychange listener to conserve GPU cycles & battery
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopRenderLoop();
    } else {
      const currentSlide = (typeof revealDeck !== 'undefined' && revealDeck)
        ? revealDeck.getCurrentSlide()
        : document.querySelector('.reveal .slides section.present');
      const isSlide4 = (revealDeck && revealDeck.getIndices().h === 3) ||
                       (currentSlide && (currentSlide.id === 'vector-space-3d' || currentSlide.getAttribute('data-slide-id') === 'vector-space-3d'));
      if (isSlide4) {
        startRenderLoop();
      }
    }
  });

  // 5. Initialize WebGL scene or fallback view
  if (isWebGLAvailable) {
    initScene();
  } else {
    showWebGLFallback();
  }

  // 6. Setup accessible controls & inspector (ALWAYS called, even in 2D fallback mode)
  setupAccessibleToolbar();
  populateDropdownSelectors();
  updateRayVectors();
  updateMathematicalInspector();

  // ResizeObserver for dynamic layout / splitter adjustments (Section 8.3)
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const width = entry.contentRect.width;
      const height = entry.contentRect.height;
      if (width > 0 && height > 0 && renderer && camera) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
      }
    }
  });
  resizeObserver.observe(container);

  // Render loop
  function render() {
    if (!isRendering) return;
    if (controls) controls.update();
    if (renderer && scene && camera) {
      renderer.render(scene, camera);
      updateOverlayLabels();
    }
    animationFrameId = requestAnimationFrame(render);
  }

  function startRenderLoop() {
    if (!renderer || !scene || !camera) return;
    if (!isRendering) {
      isRendering = true;
      render();
    }
  }

  function stopRenderLoop() {
    isRendering = false;
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  function updateOverlayLabels() {
    if (!labelsLayer || !camera || !renderer) return;
    const halfWidth = canvas.clientWidth / 2;
    const halfHeight = canvas.clientHeight / 2;
    const tempVec = new THREE.Vector3();

    labelElements.forEach(({ element, position, id }) => {
      tempVec.copy(position).project(camera);
      // Only show if in front of camera
      if (tempVec.z < 1) {
        element.style.display = 'block';
        const x = (tempVec.x * halfWidth) + halfWidth;
        const y = -(tempVec.y * halfHeight) + halfHeight;
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;

        // Selection styling
        element.classList.toggle('selected-a', id === selectedPointA);
        element.classList.toggle('selected-b', id === selectedPointB);
      } else {
        element.style.display = 'none';
      }
    });
  }

  function handlePointSelection(pointId) {
    if (selectedPointA === pointId) {
      // Already Point A, do nothing or swap
      return;
    }
    // Update Point B, or shift A -> B and set new A
    selectedPointB = selectedPointA;
    selectedPointA = pointId;

    updateDropdowns();
    updateRayVectors();
    updateMathematicalInspector();
  }

  function updateRayVectors() {
    updateVectorVisualization();
  }

  function updateVectorVisualization() {
    if (!scene || !rayOriginVectorA || !rayOriginVectorB) return;
    const itemA = vectors.vocabulary.find(v => v.id === selectedPointA);
    const itemB = vectors.vocabulary.find(v => v.id === selectedPointB);

    if (itemA && itemB) {
      const posA = new THREE.Vector3(...itemA.projected_3d);
      const posB = new THREE.Vector3(...itemB.projected_3d);

      // Update lines from origin
      if (rayOriginVectorA.geometry) rayOriginVectorA.geometry.dispose();
      if (rayOriginVectorB.geometry) rayOriginVectorB.geometry.dispose();

      rayOriginVectorA.geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        posA
      ]);
      rayOriginVectorB.geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        posB
      ]);

      // Draw angular arc connecting normalized vectors at radius r=1.5
      if (originAngleArc) {
        scene.remove(originAngleArc);
        if (originAngleArc.geometry) originAngleArc.geometry.dispose();
      }

      const normA = posA.clone().normalize();
      const normB = posB.clone().normalize();
      const arcRadius = 1.3;

      const curvePoints = [];
      const numSegments = 24;
      for (let s = 0; s <= numSegments; s++) {
        const t = s / numSegments;
        const interp = new THREE.Vector3().lerpVectors(normA, normB, t).normalize().multiplyScalar(arcRadius);
        curvePoints.push(interp);
      }

      const arcGeom = new THREE.BufferGeometry().setFromPoints(curvePoints);
      const arcMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, linewidth: 2 });
      originAngleArc = new THREE.Line(arcGeom, arcMat);
      scene.add(originAngleArc);
    }
  }

  function updateMathematicalInspector() {
    const itemA = vectors.vocabulary.find(v => v.id === selectedPointA);
    const itemB = vectors.vocabulary.find(v => v.id === selectedPointB);
    if (!itemA || !itemB) return;

    // Retrieve pairwise precalculated metrics or compute directly
    const pairKey = `${selectedPointA}:${selectedPointB}`;
    const pairReverse = `${selectedPointB}:${selectedPointA}`;
    const pairwiseInfo = (vectors && vectors.pairwise && (vectors.pairwise[pairKey] || vectors.pairwise[pairReverse])) || calculatePairwise(itemA, itemB);

    // Update UI elements
    const termADisp = document.getElementById('inspector-term-a');
    const termBDisp = document.getElementById('inspector-term-b');
    const normADisp = document.getElementById('inspector-norm-a');
    const normBDisp = document.getElementById('inspector-norm-b');
    const cosDisp = document.getElementById('inspector-true-cosine');
    const angleTrueDisp = document.getElementById('inspector-true-angle');
    const angleProjDisp = document.getElementById('inspector-proj-angle');

    if (termADisp) termADisp.textContent = `${itemA.label} (${itemA.cluster_name})`;
    if (termBDisp) termBDisp.textContent = `${itemB.label} (${itemB.cluster_name})`;
    if (normADisp) normADisp.textContent = itemA.norm.toFixed(4);
    if (normBDisp) normBDisp.textContent = itemB.norm.toFixed(4);

    if (cosDisp) {
      cosDisp.textContent = pairwiseInfo.cosine_similarity.toFixed(4);
      cosDisp.className = 'stat-value ' + (pairwiseInfo.cosine_similarity > 0.6 ? 'highlight-emerald' : (pairwiseInfo.cosine_similarity > 0.3 ? 'highlight-cyan' : 'highlight-amber'));
    }

    if (angleTrueDisp) {
      angleTrueDisp.textContent = `${pairwiseInfo.true_angle_degrees.toFixed(1)}°`;
    }

    if (angleProjDisp) {
      angleProjDisp.textContent = `${pairwiseInfo.projected_angle_degrees.toFixed(1)}°`;
    }

    const dotDisp = document.getElementById('inspector-dot-product');
    const l2Disp = document.getElementById('inspector-squared-l2');
    if (dotDisp) {
      const dotVal = pairwiseInfo.dot_product !== undefined ? pairwiseInfo.dot_product : pairwiseInfo.cosine_similarity;
      dotDisp.textContent = dotVal.toFixed(4);
    }
    if (l2Disp) {
      const l2Val = pairwiseInfo.squared_l2 !== undefined ? pairwiseInfo.squared_l2 : (2.0 - 2.0 * pairwiseInfo.cosine_similarity);
      l2Disp.textContent = l2Val.toFixed(4);
    }
  }

  function calculatePairwise(uItem, vItem) {
    const u = uItem.vector_384d;
    const v = vItem.vector_384d;
    let dot = 0;
    let l2sq = 0;
    for (let i = 0; i < u.length; i++) {
      dot += u[i] * v[i];
      const diff = u[i] - v[i];
      l2sq += diff * diff;
    }
    const s = Math.max(Math.min(dot / (uItem.norm * vItem.norm), 1.0), -1.0);
    const angleDeg = Math.acos(s) * 180 / Math.PI;

    const pU = new THREE.Vector3(...uItem.projected_3d).normalize();
    const pV = new THREE.Vector3(...vItem.projected_3d).normalize();
    const projDot = Math.max(Math.min(pU.dot(pV), 1.0), -1.0);
    const projAngleDeg = Math.acos(projDot) * 180 / Math.PI;

    return {
      dot_product: dot,
      cosine_similarity: s,
      squared_l2: l2sq,
      true_angle_degrees: angleDeg,
      projected_cosine: projDot,
      projected_angle_degrees: projAngleDeg
    };
  }

  function setupAccessibleToolbar() {
    const btnReset = document.getElementById('btn-cam-reset');
    const btnRotLeft = document.getElementById('btn-cam-left');
    const btnRotRight = document.getElementById('btn-cam-right');
    const btnTiltUp = document.getElementById('btn-cam-up');
    const btnTiltDown = document.getElementById('btn-cam-down');
    const btnZoomIn = document.getElementById('btn-cam-zoomin');
    const btnZoomOut = document.getElementById('btn-cam-zoomout');

    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (camera && controls) {
          camera.position.copy(initialCameraPos);
          controls.target.set(0, 0, 0);
          controls.update();
        }
      });
    }

    const ROT_ANGLE = 0.26; // ~15 deg
    if (btnRotLeft) {
      btnRotLeft.addEventListener('click', () => {
        rotateCameraHorizontal(-ROT_ANGLE);
      });
    }
    if (btnRotRight) {
      btnRotRight.addEventListener('click', () => {
        rotateCameraHorizontal(ROT_ANGLE);
      });
    }
    if (btnTiltUp) {
      btnTiltUp.addEventListener('click', () => {
        rotateCameraVertical(-ROT_ANGLE);
      });
    }
    if (btnTiltDown) {
      btnTiltDown.addEventListener('click', () => {
        rotateCameraVertical(ROT_ANGLE);
      });
    }
    if (btnZoomIn) {
      btnZoomIn.addEventListener('click', () => {
        if (camera && controls) {
          camera.position.multiplyScalar(0.85);
          controls.update();
        }
      });
    }
    if (btnZoomOut) {
      btnZoomOut.addEventListener('click', () => {
        if (camera && controls) {
          camera.position.multiplyScalar(1.15);
          controls.update();
        }
      });
    }
  }

  function rotateCameraHorizontal(angle) {
    if (!camera || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    const radius = Math.sqrt(offset.x * offset.x + offset.z * offset.z);
    let theta = Math.atan2(offset.x, offset.z);
    theta += angle;
    offset.x = radius * Math.sin(theta);
    offset.z = radius * Math.cos(theta);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
    controls.update();
  }

  function rotateCameraVertical(angle) {
    if (!camera || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    offset.y += angle * 3.0;
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
    controls.update();
  }

  function populateDropdownSelectors() {
    const selectA = document.getElementById('select-point-a');
    const selectB = document.getElementById('select-point-b');

    if (selectA && selectB) {
      selectA.innerHTML = '';
      selectB.innerHTML = '';

      vectors.vocabulary.forEach((item) => {
        const optA = document.createElement('option');
        optA.value = item.id;
        optA.textContent = `${item.label} [${item.cluster}]`;
        selectA.appendChild(optA);

        const optB = document.createElement('option');
        optB.value = item.id;
        optB.textContent = `${item.label} [${item.cluster}]`;
        selectB.appendChild(optB);
      });

      selectA.value = selectedPointA;
      selectB.value = selectedPointB;

      selectA.addEventListener('change', (e) => {
        selectedPointA = e.target.value;
        updateRayVectors();
        updateMathematicalInspector();
      });

      selectB.addEventListener('change', (e) => {
        selectedPointB = e.target.value;
        updateRayVectors();
        updateMathematicalInspector();
      });
    }
  }
  const setupDropdownSelectors = populateDropdownSelectors;

  function updateDropdowns() {
    const selectA = document.getElementById('select-point-a');
    const selectB = document.getElementById('select-point-b');
    if (selectA) selectA.value = selectedPointA;
    if (selectB) selectB.value = selectedPointB;
  }

  function showWebGLFallback() {
    if (fallbackEl) fallbackEl.classList.add('active');
    if (canvas) canvas.style.display = 'none';
    if (labelsLayer) labelsLayer.style.display = 'none';
    setupFallback2DVisualization();
  }

  function hideWebGLFallback() {
    if (fallbackEl) fallbackEl.classList.remove('active');
    if (canvas) canvas.style.display = 'block';
    if (labelsLayer) labelsLayer.style.display = 'block';
  }

  function setupFallback2DVisualization() {
    const svgContainer = widget.querySelector('.fallback-svg-container');
    if (!svgContainer) return;

    svgContainer.innerHTML = `
      <svg viewBox="-120 -120 240 240" width="100%" height="100%">
        <!-- Grid axes -->
        <line x1="-110" y1="0" x2="110" y2="0" stroke="#334155" stroke-dasharray="2,2"/>
        <line x1="0" y1="-110" x2="0" y2="110" stroke="#334155" stroke-dasharray="2,2"/>
        <circle cx="0" cy="0" r="3" fill="#94a3b8"/>
        
        <!-- Clusters -->
        <!-- Cluster A (Royalty) -->
        <g id="svg-cluster-a" style="cursor:pointer;">
          <circle cx="50" cy="-60" r="6" fill="#38bdf8" data-id="king"/>
          <text x="60" y="-55" fill="#38bdf8" font-size="10" font-family="sans-serif">king/queen</text>
          <circle cx="35" cy="-45" r="5" fill="#38bdf8" data-id="queen"/>
          <text x="45" y="-40" fill="#38bdf8" font-size="9" font-family="sans-serif">man/woman</text>
        </g>
        
        <!-- Cluster B (Remote Work) -->
        <g id="svg-cluster-b" style="cursor:pointer;">
          <circle cx="-65" cy="-20" r="6" fill="#34d399" data-id="telecommuting"/>
          <text x="-115" y="-25" fill="#34d399" font-size="10" font-family="sans-serif">telecommuting</text>
          <circle cx="-50" cy="-35" r="5" fill="#34d399" data-id="remote_work"/>
          <text x="-105" y="-40" fill="#34d399" font-size="9" font-family="sans-serif">remote work</text>
        </g>
        
        <!-- Cluster C (Bread) -->
        <g id="svg-cluster-c" style="cursor:pointer;">
          <circle cx="-20" cy="65" r="6" fill="#fbbf24" data-id="sourdough"/>
          <text x="-10" y="75" fill="#fbbf24" font-size="10" font-family="sans-serif">sourdough/bread</text>
        </g>
      </svg>
    `;

    svgContainer.querySelectorAll('[data-id]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-id');
        if (id) handlePointSelection(id);
      });
    });
  }

  return {
    startRendering: () => startRenderLoop(),
    stopRendering: () => stopRenderLoop(),
    onResize: () => {
      if (!renderer || !camera || !container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
        if (labelsLayer && typeof updateLabels === 'function') {
          updateLabels();
        }
      }
    },
    updateTheme: (theme) => {
      if (scene) {
        scene.background = new THREE.Color(theme === 'light' ? 0xf8fafc : 0x030712);
      }
    }
  };
}

/* =========================================================================
   SLIDE 3: INTERACTIVE 3D PCA SIMILARITY VISUALIZER (Sketch Slide 3)
   ========================================================================= */
function initSlide3SimilarityVisualizer() {
  const select = document.getElementById('slide3-candidate-select');
  const svg = document.getElementById('slide3-pca-svg');
  if (!select || !svg) return;

  const candData = {
    'cat_table': {
      label: 'Target v (Table Cat):',
      coords: '[-2.19, -0.12, -0.27]',
      cosine: '0.6792',
      dot: '0.6792',
      l2: '0.6416',
      angle: '47.2°',
      targetName: 'Table Cat',
      svgEndpoint: { x: 95, y: 120 }
    },
    'dog': {
      label: 'Target v (Dog):',
      coords: '[-0.62, 1.08, 0.11]',
      cosine: '0.6606',
      dot: '0.6606',
      l2: '0.6787',
      angle: '48.7°',
      targetName: 'Dog',
      svgEndpoint: { x: 175, y: 35 }
    },
    'cat_image': {
      label: 'Target v (Cat Visual):',
      coords: '[-2.69, -0.52, 0.06]',
      cosine: '0.5336',
      dot: '0.5336',
      l2: '0.9327',
      angle: '57.7°',
      targetName: 'Cat Visual',
      svgEndpoint: { x: 75, y: 135 }
    },
    'pet_video': {
      label: 'Target v (Pet Video):',
      coords: '[-2.47, -0.69, 0.60]',
      cosine: '0.4918',
      dot: '0.4918',
      l2: '1.0164',
      angle: '60.5°',
      targetName: 'Pet Video',
      svgEndpoint: { x: 85, y: 155 }
    }
  };

  const anchorCoord = { x: 135, y: 55 }; // "Cat" (Cyan vector)
  const origin = { x: 230, y: 110 };

  function renderVisualizer() {
    const val = select.value || 'cat_table';
    const d = candData[val] || candData['cat_table'];

    const candLabel = document.getElementById('slide3-cand-label');
    const candCoords = document.getElementById('slide3-cand-coords');
    const calcCosine = document.getElementById('slide3-calc-cosine');
    const calcDot = document.getElementById('slide3-calc-dot');
    const calcL2 = document.getElementById('slide3-calc-l2');
    const calcAngle = document.getElementById('slide3-calc-angle');

    if (candLabel) candLabel.textContent = d.label;
    if (candCoords) candCoords.textContent = d.coords;
    if (calcCosine) calcCosine.textContent = d.cosine;
    if (calcDot) calcDot.textContent = d.dot;
    if (calcL2) calcL2.textContent = d.l2;
    if (calcAngle) calcAngle.textContent = d.angle;

    const targetPt = d.svgEndpoint;

    // Draw SVG Isometric Vector Stage
    svg.innerHTML = `
      <defs>
        <marker id="arrow-cyan" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
        </marker>
        <marker id="arrow-rose" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#f43f5e" />
        </marker>
      </defs>

      <!-- Isometric 3D Grid & Axes -->
      <line x1="${origin.x}" y1="${origin.y}" x2="${origin.x + 130}" y2="${origin.y - 75}" stroke="rgba(148, 163, 184, 0.25)" stroke-width="1.5" />
      <line x1="${origin.x}" y1="${origin.y}" x2="${origin.x - 170}" y2="${origin.y - 75}" stroke="rgba(148, 163, 184, 0.25)" stroke-width="1.5" />
      <line x1="${origin.x}" y1="${origin.y}" x2="${origin.x}" y2="${origin.y + 60}" stroke="rgba(148, 163, 184, 0.25)" stroke-width="1.5" />
      <text x="${origin.x + 135}" y="${origin.y - 75}" fill="#64748b" font-size="10" font-family="monospace">+X (PCA 1)</text>
      <text x="${origin.x - 175}" y="${origin.y - 80}" fill="#64748b" font-size="10" font-family="monospace">+Y (PCA 2)</text>
      <text x="${origin.x + 8}" y="${origin.y + 55}" fill="#64748b" font-size="10" font-family="monospace">+Z (PCA 3)</text>

      <!-- Distance chord between endpoints (Amber dashed) -->
      <line x1="${anchorCoord.x}" y1="${anchorCoord.y}" x2="${targetPt.x}" y2="${targetPt.y}" stroke="#fbbf24" stroke-width="2" stroke-dasharray="4,4" opacity="0.85" />
      <text x="${(anchorCoord.x + targetPt.x) / 2 - 15}" y="${(anchorCoord.y + targetPt.y) / 2 - 8}" fill="#fbbf24" font-size="10" font-family="monospace" font-weight="700">d²=${d.l2}</text>

      <!-- Vector u: "Cat" (Cyan) -->
      <line x1="${origin.x}" y1="${origin.y}" x2="${anchorCoord.x}" y2="${anchorCoord.y}" stroke="#38bdf8" stroke-width="2.5" marker-end="url(#arrow-cyan)" />
      <circle cx="${anchorCoord.x}" cy="${anchorCoord.y}" r="4" fill="#38bdf8" />
      <rect x="${anchorCoord.x - 30}" y="${anchorCoord.y - 20}" width="42" height="15" rx="3" fill="rgba(15, 23, 42, 0.85)" stroke="#38bdf8" stroke-width="1" />
      <text x="${anchorCoord.x - 24}" y="${anchorCoord.y - 9}" fill="#38bdf8" font-size="9" font-weight="700">u: "Cat"</text>

      <!-- Vector v: Candidate (Rose) -->
      <line x1="${origin.x}" y1="${origin.y}" x2="${targetPt.x}" y2="${targetPt.y}" stroke="#f43f5e" stroke-width="2.5" marker-end="url(#arrow-rose)" />
      <circle cx="${targetPt.x}" cy="${targetPt.y}" r="4" fill="#f43f5e" />
      <rect x="${targetPt.x - 35}" y="${targetPt.y + 6}" width="70" height="15" rx="3" fill="rgba(15, 23, 42, 0.85)" stroke="#f43f5e" stroke-width="1" />
      <text x="${targetPt.x - 30}" y="${targetPt.y + 17}" fill="#f43f5e" font-size="9" font-weight="700">v: ${d.targetName}</text>

      <!-- Origin sphere -->
      <circle cx="${origin.x}" cy="${origin.y}" r="3" fill="#cbd5e1" />
      <text x="${origin.x + 6}" y="${origin.y + 12}" fill="#94a3b8" font-size="9">Origin (0,0,0)</text>

      <!-- Hypersphere Angle theta arc indicator -->
      <path d="M ${origin.x - 22} ${origin.y - 12} A 25 25 0 0 1 ${origin.x - 14} ${origin.y - 20}" fill="none" stroke="#c084fc" stroke-width="2" />
      <text x="${origin.x - 48}" y="${origin.y - 22}" fill="#c084fc" font-size="9" font-weight="700">θ=${d.angle}</text>
    `;
  }

  select.addEventListener('change', renderVisualizer);
  renderVisualizer();
}

/* =========================================================================
   SLIDE 5: INTERACTIVE CHROMADB HNSW + L2 SIMULATOR (Sketch Slide 5)
   ========================================================================= */
function initSlide5ChromaSimulator() {
  const input = document.getElementById('slide5-query-input');
  const btn = document.getElementById('btn-slide5-query');
  const resultsContainer = document.getElementById('slide5-results-container');
  const presetBtns = document.querySelectorAll('.btn-preset-query');

  if (!btn || !resultsContainer) return;

  function runSimulation(queryText) {
    const q = (queryText || (input ? input.value : '') || 'Where is the cat?').trim().toLowerCase();
    if (input) input.value = queryText || input.value;

    let doc1 = { text: '"On the table cat is there."', id: 'chunk_3', type: 'sentence', d2: '0.6416', sim: '67.92%' };
    let doc2 = { text: '"Cat Image (Visual Feature)"', id: 'chunk_4', type: 'image', d2: '0.9327', sim: '53.36%' };

    if (q.includes('dog') || q.includes('puppy') || q.includes('bark') || q.includes('pet')) {
      doc1 = { text: '"Dog"', id: 'chunk_2', type: 'word', d2: '0.6787', sim: '66.06%' };
      doc2 = { text: '"Pet Care Guide [Video]"', id: 'chunk_5', type: 'video', d2: '1.0164', sim: '49.18%' };
    } else if (q.includes('photo') || q.includes('visual') || q.includes('image') || q.includes('picture')) {
      doc1 = { text: '"Cat Image (Visual Feature)"', id: 'chunk_4', type: 'image', d2: '0.5120', sim: '74.40%' };
      doc2 = { text: '"Cat"', id: 'chunk_1', type: 'word', d2: '0.6840', sim: '65.80%' };
    }

    resultsContainer.innerHTML = `
      <div style="color: var(--accent-cyan); font-weight: 700; margin-bottom: 4px;">
        ⚡ ChromaDB Engine: Embedding "${escapeHtml(q)}" via all-MiniLM-L6-v2...
      </div>
      <div style="color: #94a3b8; line-height: 1.4;">
        <span>→ Vectorized to S³⁸³ unit vector (||q||₂ = 1.0000)</span><br>
        <span style="color: var(--accent-amber);">[HNSW Layer 2]</span> Global entry point chunk_1 (d²=1.42) → greedy hop to ${doc1.id}<br>
        <span style="color: var(--accent-amber);">[HNSW Layer 1]</span> Traversed 3 edges → converged to ${doc1.id}<br>
        <span style="color: var(--accent-green);">[HNSW Layer 0]</span> Beam search efSearch=10 → Returned 2 nearest neighbors:
      </div>
      <div style="margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px;">
        <div style="margin-bottom: 4px;">
          <strong style="color: #38bdf8;">1. ${doc1.text}</strong> [${doc1.id}]<br>
          <span style="color: var(--accent-emerald);">Squared L2: ${doc1.d2}</span> | <span>Normalized Sim: <strong>${doc1.sim}</strong></span>
        </div>
        <div>
          <strong style="color: #fca5a5;">2. ${doc2.text}</strong> [${doc2.id}]<br>
          <span style="color: var(--accent-emerald);">Squared L2: ${doc2.d2}</span> | <span>Normalized Sim: <strong>${doc2.sim}</strong></span>
        </div>
      </div>
      <div style="margin-top: 6px; font-size: 0.68rem; color: var(--accent-cyan); text-align: right;">
        Execution Latency: 0.42 ms (AVX-512 SIMD)
      </div>
    `;
  }

  btn.addEventListener('click', () => runSimulation());
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runSimulation();
    });
  }

  presetBtns.forEach(pBtn => {
    pBtn.addEventListener('click', () => {
      const q = pBtn.getAttribute('data-query');
      runSimulation(q);
    });
  });

  // Run initial simulation
  runSimulation('Where is the cat sitting?');
}

/* =========================================================================
   SLIDE 2: LEXICAL MATCHING VS DENSE SEMANTICS SANDBOX
   ========================================================================= */
function initSlide2LexicalVsDense() {
  const queryBtns = document.querySelectorAll('.btn-query-select');
  const bm25Score = document.getElementById('slide2-bm25-score');
  const bm25Status = document.getElementById('slide2-bm25-status');
  const denseScore = document.getElementById('slide2-dense-score');
  const denseStatus = document.getElementById('slide2-dense-status');
  const queryTextDisplay = document.getElementById('slide2-active-query');

  const queryDatabase = {
    'dist_work': {
      query: 'distributed workforce guidelines',
      bm25: '0.00 (0 term matches)',
      bm25Badge: 'badge-red',
      bm25Text: 'FAIL: Exact vocabulary mismatch against "telecommute"',
      dense: '0.8142 (Cosine Proximity)',
      denseBadge: 'badge-green',
      denseText: 'RETRIEVED: High semantic similarity in 384-d MiniLM space'
    },
    'telecommute': {
      query: 'telecommuting eligibility requirements',
      bm25: '14.82 (2 term matches)',
      bm25Badge: 'badge-green',
      bm25Text: 'MATCH: Exact hits on "telecommute" and "eligible"',
      dense: '0.8875 (Cosine Proximity)',
      denseBadge: 'badge-green',
      denseText: 'RETRIEVED: Shared vocabulary + semantic context'
    },
    'sourdough': {
      query: 'sourdough starter fermentation schedule',
      bm25: '0.00 (0 term matches)',
      bm25Badge: 'badge-red',
      bm25Text: 'REJECTED: No keyword overlap',
      dense: '0.1420 (Cosine Proximity)',
      denseBadge: 'badge-amber',
      denseText: 'REJECTED: Cosine distance identifies distractor'
    }
  };

  queryBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      queryBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const qKey = btn.getAttribute('data-query');
      const data = queryDatabase[qKey];
      if (!data) return;

      if (queryTextDisplay) queryTextDisplay.textContent = `"${data.query}"`;
      if (bm25Score) bm25Score.textContent = data.bm25;
      if (bm25Status) {
        bm25Status.textContent = data.bm25Text;
        bm25Status.className = `card-badge ${data.bm25Badge}`;
      }
      if (denseScore) denseScore.textContent = data.dense;
      if (denseStatus) {
        denseStatus.textContent = data.denseText;
        denseStatus.className = `card-badge ${data.denseBadge}`;
      }
    });
  });
}

/* =========================================================================
   SLIDE 3: TOKENIZATION & 384-D EMBEDDING INSPECTOR
   ========================================================================= */
function initSlide3Tokenization() {
  const tokenButtons = document.querySelectorAll('.btn-token-sample');
  const tokenListContainer = document.getElementById('slide3-tokens-list');
  const tokenDimsDisplay = document.getElementById('slide3-token-dims');

  const tokenSamples = {
    'telecommuting': {
      text: 'telecommuting',
      tokens: ['tele', '##com', '##mu', '##ting'],
      ids: [2839, 4128, 5921, 2384],
      dims: '384 float32 dimensions (L2 Normalized, norm = 1.000)'
    },
    'distributed_workforce': {
      text: 'distributed workforce policies',
      tokens: ['distributed', 'work', '##force', 'policies'],
      ids: [4621, 2147, 4920, 3968],
      dims: '384 float32 dimensions (Mean Pooled over 4 tokens)'
    },
    'sourdough_bread': {
      text: 'sourdough bread baking',
      tokens: ['sour', '##dough', 'bread', 'baking'],
      ids: [8942, 17290, 6214, 11429],
      dims: '384 float32 dimensions (Unit Hypersphere S³⁸³)'
    }
  };

  tokenButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tokenButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const key = btn.getAttribute('data-token-key');
      const item = tokenSamples[key];
      if (!item || !tokenListContainer) return;

      tokenListContainer.innerHTML = item.tokens.map((tok, i) => `
        <span class="code-inline" style="display:inline-flex; flex-direction:column; align-items:center; margin: 0 4px; padding: 4px 8px;">
          <span style="font-weight:700; color:#fff;">${tok}</span>
          <span style="font-size:0.65rem; color:#94a3b8;">ID: ${item.ids[i]}</span>
        </span>
      `).join('');

      if (tokenDimsDisplay) {
        tokenDimsDisplay.textContent = item.dims;
      }
    });
  });
}

/* =========================================================================
   SLIDE 5: CHUNKING STRATEGIES & BOUNDARY OVERLAP INTERACTION
   ========================================================================= */
function initSlide5Chunking() {
  const fullDocument = (
    "Remote Work & Telecommuting Guidelines. Full-time employees are eligible to telecommute " +
    "and perform their professional duties from home or an alternate location up to three days " +
    "per calendar week upon manager approval. Employees must maintain reliable internet connectivity " +
    "and comply with all physical and cybersecurity standards while working remotely. Expense claims " +
    "for home office equipment must follow standard procurement rules. Travel reimbursement requests " +
    "for on-site meetings must be submitted at least fourteen days in advance of the scheduled corporate gathering."
  );

  let currentChunkIndex = 0;
  const chunkSize = 350;
  const chunkOverlap = 50;
  const stepSize = chunkSize - chunkOverlap; // 300

  const totalChunks = Math.ceil((fullDocument.length - chunkOverlap) / stepSize);

  const btnPrev = document.getElementById('btn-chunk-prev');
  const btnNext = document.getElementById('btn-chunk-next');
  const chunkDisplay = document.getElementById('chunk-text-content');
  const chunkIdxDisplay = document.getElementById('chunk-indicator-idx');
  const chunkSpanDisplay = document.getElementById('chunk-char-span');
  const overlapSpanDisplay = document.getElementById('chunk-overlap-span');

  function renderChunk() {
    const start = currentChunkIndex * stepSize;
    const end = Math.min(start + chunkSize, fullDocument.length);
    const overlapStart = Math.max(start, end - chunkOverlap);

    if (chunkDisplay) {
      const prefixText = fullDocument.slice(0, start);
      const activeText = fullDocument.slice(start, overlapStart);
      const overlapText = fullDocument.slice(overlapStart, end);
      const suffixText = fullDocument.slice(end);

      chunkDisplay.innerHTML = `
        <span style="opacity: 0.35;">${escapeHtml(prefixText)}</span>
        <span class="chunk-highlight-active">${escapeHtml(activeText)}</span>
        <span class="chunk-highlight-overlap">${escapeHtml(overlapText)}</span>
        <span style="opacity: 0.35;">${escapeHtml(suffixText)}</span>
      `;
    }

    if (chunkIdxDisplay) {
      chunkIdxDisplay.textContent = `Chunk #${currentChunkIndex + 1} of ${totalChunks}`;
    }
    if (chunkSpanDisplay) {
      chunkSpanDisplay.textContent = `Chars [${start} - ${end}] (${end - start} chars)`;
    }
    if (overlapSpanDisplay) {
      overlapSpanDisplay.textContent = end < fullDocument.length ? `Next Overlap: 50 chars` : `Final chunk boundary`;
    }

    if (btnPrev) btnPrev.disabled = (currentChunkIndex === 0);
    if (btnNext) btnNext.disabled = (currentChunkIndex >= totalChunks - 1);
  }

  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (currentChunkIndex > 0) {
        currentChunkIndex--;
        renderChunk();
      }
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (currentChunkIndex < totalChunks - 1) {
        currentChunkIndex++;
        renderChunk();
      }
    });
  }

  renderChunk();
}

/* =========================================================================
   SLIDE 6: HNSW INDEXING INTERACTIVE STEPPER & TRADEOFF INSPECTOR
   ========================================================================= */
function initSlide6HNSW() {
  let step = 0;
  const btnStep = document.getElementById('btn-hnsw-step');
  const btnReset = document.getElementById('btn-hnsw-reset');
  const statusLog = document.getElementById('hnsw-traversal-log');
  const allNodes = document.querySelectorAll('.hnsw-node');

  const stepsConfig = [
    {
      activeId: 'node-l2-1',
      text: 'Step 1: Enter Layer 2 (Expressway) at Entry Point node E. Compute distance to query q: d = 0.65.'
    },
    {
      activeId: 'node-l2-2',
      text: 'Step 2: Greedy hop in Layer 2 to neighbor node B: d = 0.42. Local minimum reached on Layer 2.'
    },
    {
      activeId: 'node-l1-3',
      text: 'Step 3: Descend entry point into Layer 1 (Regional). Explore neighbor node F: d = 0.28.'
    },
    {
      activeId: 'node-l0-7',
      text: 'Step 4: Descend into Layer 0 (Dense Ground Layer). Local beam search with ef_search=16 identifies top nearest neighbor!'
    }
  ];

  function applyStep(s) {
    allNodes.forEach(node => {
      node.classList.remove('active-search', 'visited', 'target');
    });

    for (let i = 0; i < s; i++) {
      const prevNode = document.getElementById(stepsConfig[i].activeId);
      if (prevNode) prevNode.classList.add('visited');
    }

    if (s < stepsConfig.length) {
      const curr = document.getElementById(stepsConfig[s].activeId);
      if (curr) {
        if (s === stepsConfig.length - 1) {
          curr.classList.add('target');
        } else {
          curr.classList.add('active-search');
        }
      }
      if (statusLog) statusLog.textContent = stepsConfig[s].text;
    } else {
      if (statusLog) statusLog.textContent = 'Search complete! Top-K nearest neighbors returned with bounded logarithmic efficiency.';
    }
  }

  if (btnStep) {
    btnStep.addEventListener('click', () => {
      if (step < stepsConfig.length) {
        applyStep(step);
        step++;
      }
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      step = 0;
      allNodes.forEach(node => node.classList.remove('active-search', 'visited', 'target'));
      if (statusLog) statusLog.textContent = 'Click "Next Traversal Step" to trace query vector entry point and layer descent.';
    });
  }
}

/* =========================================================================
   SLIDE 7: GROUNDED PROMPT SYNTHESIS ANATOMY
   ========================================================================= */
function initSlide7PromptSynthesis() {
  const tabs = document.querySelectorAll('.btn-prompt-filter');
  const promptBlocks = document.querySelectorAll('.prompt-block');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const filter = tab.getAttribute('data-filter');
      promptBlocks.forEach(block => {
        if (filter === 'all' || block.classList.contains(`block-${filter}`)) {
          block.style.opacity = '1';
          block.style.transform = 'scale(1)';
        } else {
          block.style.opacity = '0.25';
          block.style.transform = 'scale(0.98)';
        }
      });
    });
  });
}

/* =========================================================================
   SYNTAX HIGHLIGHTING UTILITY (JSON)
   ========================================================================= */
function highlightJson(jsonObj) {
  const jsonStr = typeof jsonObj === 'string' ? jsonObj : JSON.stringify(jsonObj, null, 2);
  const escaped = jsonStr
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
    let cls = 'tok-num';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'tok-key';
      } else {
        cls = 'tok-str';
      }
    } else if (/true|false/.test(match)) {
      cls = 'tok-bool';
    } else if (/null/.test(match)) {
      cls = 'tok-bool';
    }
    return `<span class="${cls}">${match}</span>`;
  });
}

/* =========================================================================
   SLIDE 13: INTERACTIVE MCP PROTOCOL SIMULATOR
   ========================================================================= */
function initSlide13Simulator() {
  const container = document.querySelector('[data-slide-id="mcp-protocol-simulator"]');
  if (!container) return;

  const actionButtons = container.querySelectorAll('.mcp-sim-btn');
  const transportButtons = container.querySelectorAll('.mcp-transport-btn');
  const paramsBar = container.querySelector('#sim-params-bar');
  const queryInput = container.querySelector('#sim-query-input');
  const topkSelect = container.querySelector('#sim-topk-select');
  const btnExecute = container.querySelector('#btn-sim-execute');

  const reqTagEl = container.querySelector('#sim-req-tag');
  const resTagEl = container.querySelector('#sim-res-tag');
  const requestDisplay = container.querySelector('#sim-request-display');
  const responseDisplay = container.querySelector('#sim-response-display');
  const telemetryTransport = container.querySelector('#sim-telemetry-transport');
  const telemetryLatency = container.querySelector('#sim-telemetry-latency');

  let currentAction = 'tools/list';
  let currentTransport = 'stdio';
  let requestIdCounter = 1;

  function updateSimulator(incrementId = false) {
    if (incrementId) {
      requestIdCounter++;
    }
    const currentId = requestIdCounter;

    // Active button states
    actionButtons.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-action') === currentAction);
    });
    transportButtons.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-transport') === currentTransport);
    });

    let reqPayload = null;
    let resPayload = null;
    let reqLabel = currentAction;
    let resLabel = '200 OK';
    let latencyStr = currentTransport === 'stdio' ? '0.6 ms' : '11.8 ms';

    if (currentAction === 'tools/list') {
      if (paramsBar) {
        paramsBar.style.opacity = '0.45';
        if (queryInput) queryInput.disabled = true;
        if (topkSelect) topkSelect.disabled = true;
        if (btnExecute) btnExecute.disabled = true;
      }

      reqLabel = 'tools/list';
      reqPayload = {
        jsonrpc: '2.0',
        id: currentId,
        method: 'tools/list',
        params: {}
      };

      resPayload = {
        jsonrpc: '2.0',
        id: currentId,
        result: {
          tools: [
            {
              name: 'search_knowledge_base',
              description: 'Query corporate vector store using 384-dimensional all-MiniLM-L6-v2 embeddings and ChromaDB nearest neighbor index.',
              inputSchema: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'Semantic query string for nearest neighbor search'
                  },
                  top_k: {
                    type: 'integer',
                    description: 'Number of nearest neighbor chunks (1-10)',
                    default: 3
                  }
                },
                required: ['query']
              }
            },
            {
              name: 'calculate_similarity',
              description: 'Compute cosine similarity and angle between two text embeddings.',
              inputSchema: {
                type: 'object',
                properties: {
                  text_a: { type: 'string' },
                  text_b: { type: 'string' }
                },
                required: ['text_a', 'text_b']
              }
            }
          ]
        }
      };
      latencyStr = currentTransport === 'stdio' ? '0.6 ms' : '11.8 ms';

    } else if (currentAction === 'tools/call') {
      if (paramsBar) {
        paramsBar.style.opacity = '1.0';
        if (queryInput) queryInput.disabled = false;
        if (topkSelect) topkSelect.disabled = false;
        if (btnExecute) btnExecute.disabled = false;
      }

      const q = (queryInput ? queryInput.value.trim() : '') || 'remote work policy';
      const k = topkSelect ? parseInt(topkSelect.value, 10) : 2;

      reqLabel = 'tools/call: search_kb';
      reqPayload = {
        jsonrpc: '2.0',
        id: currentId,
        method: 'tools/call',
        params: {
          name: 'search_knowledge_base',
          arguments: {
            query: q,
            top_k: k
          }
        }
      };

      const qLower = q.toLowerCase();
      let matchedChunks = [];

      if (qLower.includes('travel') || qLower.includes('flight') || qLower.includes('hotel')) {
        matchedChunks.push(
          '[Doc 1 (Score: 0.865, ID: policy_03_chunk_0)]\nTravel Expenses: Flight reservations must be submitted via the corporate travel procurement portal at least 14 days in advance. Economy class is standard for domestic flights under 6 hours.'
        );
        matchedChunks.push(
          '[Doc 2 (Score: 0.781, ID: policy_03_chunk_1)]\nPer Diem Reimbursement: Meals and incidental travel expenses follow standardized destination tier allowances.'
        );
      } else if (qLower.includes('equipment') || qLower.includes('stipend') || qLower.includes('hardware') || qLower.includes('desk')) {
        matchedChunks.push(
          '[Doc 1 (Score: 0.871, ID: policy_02_chunk_0)]\nHome Office Equipment Stipend: Full-time telecommuting staff receive an annual reimbursement of up to $500 for ergonomic monitors and furniture upon manager approval.'
        );
        matchedChunks.push(
          '[Doc 2 (Score: 0.725, ID: policy_02_chunk_1)]\nHardware Refresh Cycle: Corporate laptops and security tokens are replaced every 36 months.'
        );
      } else {
        matchedChunks.push(
          '[Doc 1 (Score: 0.884, ID: policy_01_chunk_0)]\nRemote Work Guidelines: Full-time employees may telecommute up to 3 days weekly upon manager approval. Core collaboration hours are 10:00 AM to 4:00 PM EST.'
        );
        matchedChunks.push(
          '[Doc 2 (Score: 0.742, ID: policy_01_chunk_1)]\nEquipment & Security: Telecommuting staff must use corporate VPN and encrypted hardware for all proprietary operations.'
        );
      }

      const returnedContent = matchedChunks.slice(0, k).join('\n\n');

      resPayload = {
        jsonrpc: '2.0',
        id: currentId,
        result: {
          content: [
            {
              type: 'text',
              text: returnedContent
            }
          ],
          isError: false
        }
      };
      latencyStr = currentTransport === 'stdio' ? '1.2 ms' : '14.5 ms';

    } else if (currentAction === 'resources/read') {
      if (paramsBar) {
        paramsBar.style.opacity = '0.45';
        if (queryInput) queryInput.disabled = true;
        if (topkSelect) topkSelect.disabled = true;
        if (btnExecute) btnExecute.disabled = true;
      }

      reqLabel = 'resources/read';
      reqPayload = {
        jsonrpc: '2.0',
        id: currentId,
        method: 'resources/read',
        params: {
          uri: 'rag://policies/telecommute'
        }
      };

      resPayload = {
        jsonrpc: '2.0',
        id: currentId,
        result: {
          contents: [
            {
              uri: 'rag://policies/telecommute',
              mimeType: 'text/markdown',
              text: '# Corporate Policy: Flexible & Remote Work\nEffective: Jan 2026 | Version: 4.2\n\n1. Scope: All regular full-time employees in good standing.\n2. Allowance: Up to 3 days telecommuting per calendar week with written manager approval.\n3. Core Working Hours: 10:00 AM – 4:00 PM EST.\n4. Device Standards: Encrypted corporate laptops with active zero-trust VPN required.\n5. Annual Review: Remote arrangements re-certified annually by Department Director.'
            }
          ]
        }
      };
      latencyStr = currentTransport === 'stdio' ? '0.4 ms' : '9.2 ms';

    } else if (currentAction === 'prompts/get') {
      if (paramsBar) {
        paramsBar.style.opacity = '0.45';
        if (queryInput) queryInput.disabled = true;
        if (topkSelect) topkSelect.disabled = true;
        if (btnExecute) btnExecute.disabled = true;
      }

      reqLabel = 'prompts/get';
      reqPayload = {
        jsonrpc: '2.0',
        id: currentId,
        method: 'prompts/get',
        params: {
          name: 'grounded_rag_query',
          arguments: {
            topic: 'telecommuting approval guidelines',
            strictness: 'high'
          }
        }
      };

      resPayload = {
        jsonrpc: '2.0',
        id: currentId,
        result: {
          description: 'Standard prompt template enforcing strict citation grounding and anti-hallucination guardrails.',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: 'Answer user questions regarding "telecommuting approval guidelines" strictly using ONLY the provided document chunks below. If information is missing, explicitly reply "I do not have sufficient information." Always attribute claims with bracketed citations like [Doc 1].'
              }
            }
          ]
        }
      };
      latencyStr = currentTransport === 'stdio' ? '0.3 ms' : '8.6 ms';
    }

    if (reqTagEl) reqTagEl.textContent = reqLabel;
    if (resTagEl) resTagEl.textContent = resLabel;
    if (requestDisplay) requestDisplay.innerHTML = highlightJson(reqPayload);
    if (responseDisplay) responseDisplay.innerHTML = highlightJson(resPayload);
    if (telemetryTransport) {
      telemetryTransport.textContent = currentTransport === 'stdio'
        ? 'stdio (Subprocess Pipe)'
        : 'SSE (Remote Stream http://127.0.0.1:8000/sse)';
    }
    if (telemetryLatency) telemetryLatency.textContent = latencyStr;
  }

  // Action button click handlers
  actionButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      currentAction = btn.getAttribute('data-action');
      updateSimulator(true);
    });
  });

  // Transport toggle click handlers
  transportButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      currentTransport = btn.getAttribute('data-transport');
      updateSimulator(false);
    });
  });

  // Execute / Send button
  if (btnExecute) {
    btnExecute.addEventListener('click', () => {
      currentAction = 'tools/call';
      updateSimulator(true);
    });
  }

  if (queryInput) {
    queryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        currentAction = 'tools/call';
        updateSimulator(true);
      }
    });
  }

  if (topkSelect) {
    topkSelect.addEventListener('change', () => {
      if (currentAction === 'tools/call') {
        updateSimulator(true);
      }
    });
  }

  // Initial render
  updateSimulator(false);
}

/* =========================================================================
   SLIDE 15: AUTONOMOUS REACT AGENT LOOP STEPPER
   ========================================================================= */
function initSlide15ReActLoop() {
  const container = document.querySelector('[data-slide-id="autonomous-chatbot-loop"]');
  if (!container) return;

  const stepPills = container.querySelectorAll('.react-step-pill');
  const titleEl = container.querySelector('#react-phase-title');
  const badgeEl = container.querySelector('#react-phase-badge');
  const descEl = container.querySelector('#react-phase-desc');
  const insightEl = container.querySelector('#react-phase-insight');
  const codeHeaderEl = container.querySelector('#react-code-header');
  const codeBodyEl = container.querySelector('#react-code-body');
  const counterEl = container.querySelector('#react-step-counter');
  const btnPrev = container.querySelector('#btn-react-prev');
  const btnNext = container.querySelector('#btn-react-next');

  let currentStep = 0;

  const phases = [
    {
      title: 'Phase 1: User Question Ingestion',
      badge: 'INPUT_RECEIVED',
      badgeClass: 'badge-blue',
      desc: 'User submits a natural language question. The agent inspects its system instructions: never answer policy questions from memory; always ground via vector retrieval.',
      insight: 'The ReAct loop decouples internal reasoning from action execution, preventing hallucinations.',
      codeHeader: 'User Turn Ingestion Envelope',
      codeType: 'json',
      code: {
        turn: 1,
        role: 'user',
        content: 'Can a full-time engineer telecommute 4 days a week under our current remote work policy?',
        grounding_constraints: {
          hallucination_tolerance: 0.0,
          require_citations: true
        }
      }
    },
    {
      title: 'Phase 2: Model Thought (Reasoning)',
      badge: 'INNER_MONOLOGUE',
      badgeClass: 'badge-purple',
      desc: 'The model generates an explicit Thought turn. It realizes it lacks the 2026 policy details in parametric memory and formulates an actionable retrieval plan.',
      insight: 'Generating an explicit Thought step allocates compute to planning, reducing reasoning errors.',
      codeHeader: 'Agent Reasoning Monologue',
      codeType: 'text',
      code: `[AGENT THOUGHT TRACE]
1. User asks whether a full-time engineer can telecommute 4 days a week.
2. My parametric neural weights cut off prior to latest 2026 handbook revisions.
3. Invariant: I must NOT guess or approximate the day limit.
4. Action: Invoke MCP tool 'search_knowledge_base' with query:
   "telecommute days per week full-time engineer" (top_k=2).`
    },
    {
      title: 'Phase 3: Outbound MCP Tool Action',
      badge: 'DISPATCHING_TOOL',
      badgeClass: 'badge-amber',
      desc: 'The agent constructs a strongly-typed JSON-RPC 2.0 tool execution request and transmits it through the MCP client to the FastMCP RAG server over stdio.',
      insight: 'Tool schemas are negotiated at startup; FastMCP guarantees parameter types match before executing Python code.',
      codeHeader: 'JSON-RPC 2.0 Outbound Request (stdio)',
      codeType: 'json',
      code: {
        jsonrpc: '2.0',
        id: 104,
        method: 'tools/call',
        params: {
          name: 'search_knowledge_base',
          arguments: {
            query: 'telecommute days per week full-time',
            top_k: 2
          }
        }
      }
    },
    {
      title: 'Phase 4: ChromaDB Nearest Neighbor Search',
      badge: 'CHROMA_HNSW_SEARCH',
      badgeClass: 'badge-blue',
      desc: 'The FastMCP RAG server converts the query into a 384-d vector with all-MiniLM-L6-v2, then executes sub-linear HNSW graph traversal on ChromaDB.',
      insight: 'Sub-linear HNSW graph traversal identifies nearest semantic clusters on the hypersphere in under 2 milliseconds.',
      codeHeader: 'Vector Engine Search Telemetry',
      codeType: 'text',
      code: `# ChromaDB HNSW Traversal Log
Query Vector: [0.0382, -0.0521, 0.0891, ..., -0.0142] (Norm: 1.000)
Index: HNSW (M=16, efConstruction=100, Metric=Cosine)
Distance Calculations: 14 hops across Layer 2 -> Layer 0
Nearest Neighbor: policy_01_chunk_0
Cosine Similarity: 0.8824 (Angle: 28.06°)
Status: Traversal Completed in 1.14 ms`
    },
    {
      title: 'Phase 5: Observation Ingestion',
      badge: 'OBSERVATION_INGESTED',
      badgeClass: 'badge-green',
      desc: 'The MCP server returns the retrieved document chunks in the JSON-RPC response envelope. The host injects this observation back into the model context.',
      insight: 'The observation provides factual ground truth with exact chunk identifiers and relevance scores.',
      codeHeader: 'MCP Inbound Result Envelope',
      codeType: 'json',
      code: {
        jsonrpc: '2.0',
        id: 104,
        result: {
          content: [
            {
              type: 'text',
              text: '[Doc 1 (Score: 0.882, ID: policy_01_chunk_0)]\nRemote Work Guidelines: Full-time employees may telecommute up to 3 days weekly upon manager approval. Core collaboration hours are 10:00 AM to 4:00 PM EST.'
            }
          ],
          isError: false
        }
      }
    },
    {
      title: 'Phase 6: Attributed Response Synthesis',
      badge: 'ATTRIBUTED_RESPONSE',
      badgeClass: 'badge-green',
      desc: 'Conditioned strictly on the retrieved context, the LLM generates the final answer to the user, citing [Doc 1] to provide complete verifiable provenance.',
      insight: 'Every factual assertion is deterministically tied back to [Doc 1], ensuring auditable source attribution.',
      codeHeader: 'Grounded Attributed Model Output',
      codeType: 'text',
      code: `[FINAL ATTRIBUTED RESPONSE]
No, full-time employees are not permitted to telecommute 4 days a week.

Under the current Remote Work Guidelines, full-time employees are eligible to telecommute up to a maximum of 3 days per week, subject to manager approval [Doc 1].

Attribution:
- Source: [Doc 1] (policy_01_chunk_0)
- Verified Score: 0.882 (Cosine Match)
- Hallucination Check: PASSED (0 ungrounded claims)`
    }
  ];

  function renderStep(idx) {
    currentStep = Math.max(0, Math.min(idx, phases.length - 1));
    const p = phases[currentStep];

    stepPills.forEach((pill, i) => {
      pill.classList.toggle('active', i === currentStep);
      pill.setAttribute('aria-selected', i === currentStep ? 'true' : 'false');
    });

    if (titleEl) titleEl.textContent = p.title;
    if (badgeEl) {
      badgeEl.textContent = p.badge;
      badgeEl.className = 'card-badge ' + p.badgeClass;
    }
    if (descEl) descEl.textContent = p.desc;
    if (insightEl) insightEl.innerHTML = p.insight;
    if (codeHeaderEl) codeHeaderEl.textContent = p.codeHeader;
    if (counterEl) counterEl.textContent = `Phase ${currentStep + 1} of ${phases.length}`;

    if (codeBodyEl) {
      if (p.codeType === 'json') {
        codeBodyEl.innerHTML = highlightJson(p.code);
      } else {
        codeBodyEl.innerHTML = escapeHtml(p.code);
      }
    }

    if (btnPrev) btnPrev.disabled = currentStep === 0;
    if (btnNext) btnNext.disabled = currentStep === phases.length - 1;
  }

  stepPills.forEach((pill, i) => {
    pill.addEventListener('click', () => renderStep(i));
  });

  if (btnPrev) {
    btnPrev.addEventListener('click', () => renderStep(currentStep - 1));
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => renderStep(currentStep + 1));
  }

  renderStep(0);
}

/* =========================================================================
   EMBEDDED FALLBACK DATA
   ========================================================================= */
function getEmbeddedVectorsFallback() {
  return {
    "model": "sentence-transformers/all-MiniLM-L6-v2",
    "dimensions": 384,
    "vocabulary": [
      { "id": "king", "label": "king", "cluster": "A", "cluster_name": "Royalty & Gender", "norm": 1.0, "projected_3d": [2.3, -2.3, 1.9], "vector_384d": [] },
      { "id": "queen", "label": "queen", "cluster": "A", "cluster_name": "Royalty & Gender", "norm": 1.0, "projected_3d": [2.1, -2.1, 1.8], "vector_384d": [] },
      { "id": "man", "label": "man", "cluster": "A", "cluster_name": "Royalty & Gender", "norm": 1.0, "projected_3d": [1.5, -1.2, 0.9], "vector_384d": [] },
      { "id": "woman", "label": "woman", "cluster": "A", "cluster_name": "Royalty & Gender", "norm": 1.0, "projected_3d": [1.4, -1.0, 0.8], "vector_384d": [] },
      { "id": "telecommuting", "label": "telecommuting", "cluster": "B", "cluster_name": "Remote Work", "norm": 1.0, "projected_3d": [-2.2, -0.8, -1.5], "vector_384d": [] },
      { "id": "remote work", "label": "remote work", "cluster": "B", "cluster_name": "Remote Work", "norm": 1.0, "projected_3d": [-2.4, -0.9, -1.4], "vector_384d": [] },
      { "id": "distributed workforce", "label": "distributed workforce", "cluster": "B", "cluster_name": "Remote Work", "norm": 1.0, "projected_3d": [-1.9, -1.1, -1.7], "vector_384d": [] },
      { "id": "sourdough", "label": "sourdough", "cluster": "C", "cluster_name": "Baking & Pastry", "norm": 1.0, "projected_3d": [-0.6, 2.8, -0.4], "vector_384d": [] },
      { "id": "bread", "label": "bread", "cluster": "C", "cluster_name": "Baking & Pastry", "norm": 1.0, "projected_3d": [-0.8, 2.9, -0.3], "vector_384d": [] },
      { "id": "pastry", "label": "pastry", "cluster": "C", "cluster_name": "Baking & Pastry", "norm": 1.0, "projected_3d": [-0.4, 2.5, -0.5], "vector_384d": [] }
    ],
    "pairwise": {
      "king:queen": { "cosine_similarity": 0.6807, "true_angle_degrees": 47.1, "projected_cosine": 0.9998, "projected_angle_degrees": 1.12 },
      "king:man": { "cosine_similarity": 0.3217, "true_angle_degrees": 71.2, "projected_cosine": -0.0538, "projected_angle_degrees": 93.08 },
      "telecommuting:remote work": { "cosine_similarity": 0.4737, "true_angle_degrees": 61.7, "projected_cosine": 0.9906, "projected_angle_degrees": 7.86 },
      "king:bread": { "cosine_similarity": 0.2630, "true_angle_degrees": 74.8, "projected_cosine": -0.3718, "projected_angle_degrees": 111.82 }
    }
  };
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


/* =========================================================================
   THEME SYNCHRONIZATION WITH PARENT UNIVERSAL HUB
   ========================================================================= */
function setupThemeListener() {
  function applyDeckTheme(theme) {
    if (theme === 'light') {
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
      document.body.classList.add('dark-theme');
    }

    if (threeApp && threeApp.updateTheme) {
      threeApp.updateTheme(theme);
    }
  }

  // Listen to postMessage from parent RAG Studio window
  window.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'SET_THEME') {
      applyDeckTheme(event.data.theme);
    } else if (event.data.type === 'studio.theme' && event.data.payload) {
      applyDeckTheme(event.data.payload.theme);
    }
  });

  // Local storage initial check
  try {
    const savedTheme = localStorage.getItem('rag_studio_theme');
    if (savedTheme) {
      applyDeckTheme(savedTheme);
    }
  } catch (e) {}
}
