// The Nocturne stage of the CMS editor: the paper sheet, the 3D typewriter under it, the carriage
// physics and the typing sounds. Adapted from Typewriter Nocturne
// (Chaosnap/Typewriter-Nocturne 1.2.0, MIT: lib/nocturne/stage-controller.ts + carriage-physics.ts +
// app/nocturne/stage-layout.ts), with the terminal replaced by the CMS Markdown editor.
//
// The machine is built from the same layout the DOM uses, so the bail, the type head and the paper
// scale line up with the editor's own columns. Keys are observed passively (capture phase, never
// preventDefault / stopPropagation), so CodeMirror and IMEs see them exactly as before.

import {TypewriterSounds} from './sound.js';
import {GlowLayer} from './glow-layer.js';
import {buildRig, toUnit} from './light-model.js';
import {PaperLight} from './paper-light.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** The two carriages: typing advances tooth by tooth, a return slides the carriage back. */
const ESCAPEMENT = {acceleration: 60000, maxSpeed: 3200, restitution: 0.22};
const CARRIAGE_RETURN = {acceleration: 14000, maxSpeed: 2600, restitution: 0.3};
const STRIKE = {frequency: 9, damping: 0.5};
const VIBRATOR = {frequency: 10, damping: 0.6};
const PLATEN = {frequency: 6, damping: 0.9};
const STRIKE_TRAVEL = 3.5;
const VIBRATOR_LIFT = 7;
/** Platen rotation per line feed, degrees. */
const LINE_FEED_DEGREES = 10;
const SHEET_OVERHANG = 12;
const REBUILD_DELAY = 140;
/** Dust in the beam is animated about twenty times a second. */
const AMBIENT_INTERVAL = 50;

/** The lighting the stage runs with: the Balanced preset of Typewriter Nocturne. */
const LIGHTING = {
  source: 'theme',
  intensity: 1,
  spread: 74,
  aim: 0,
  reach: 1,
  position: {x: 0.5, y: 0.1},
  window: {columns: 3, rows: 2, slant: 0, x: 0.34, y: 0.23},
  softness: 0.65,
  grain: 0.1,
  // 字符落点（光标）不额外打光：纸面上只有打字头那一道聚光
  cursorGlow: 0,
  paperIllumination: 0.5,
  particles: 0.45
};

const rest = () => ({position: 0, velocity: 0});
const moving = (body, target = 0) => body.position !== target || body.velocity !== 0;

/**
 * The writing desk: Paper & Ink, the theme whose lamp sits on the carriage. It is the same desk
 * under the CMS's light and dark chrome on purpose — the page is ivory, the lamp is warm, and the
 * cone rises from the type head, exactly as the original project's hero screenshot.
 * (Midnight Study's desk lamp was tried first; on a dark paper it read as black and white.)
 */
const THEME = {
  // The desk around the sheet is neutral black; only the paper and its lamp keep colour.
  room: '#151515',
  light: '#ffd29a',
  source: 'carriage',
  trim: '#c9a35c',
  environment: 0.55,
  exposure: 1,
  paper: {color: '#f4ecdb', appearance: 'light'},
  ink: '#2b231c',
  shade: 0.42,
  // Where a desk lamp would stand, in sheet coordinates (0–1). The carriage lamp ignores it.
  lightPosition: {x: 0.5, y: 1},
  // Cotton: a fine rag sheet, felted rather than crumpled.
  surface: {crinkle: 0.3, felt: 1, laid: 0, linen: 0, mottle: 0.08, age: 0}
};

const SERIF_STACK = "'EB Garamond', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Songti SC', 'Noto Serif CJK SC', serif";

const CANDIDATE_KEYS = /^(Arrow(Up|Down|Left|Right)|Page(Up|Down)|Tab|Minus|Equal|Comma|Period)$/;

/** The kind of a keydown, or null for keys that strike no type (shortcuts, modifiers). */
function keyKind(event) {
  if (event.isComposing || event.key === 'Process' || event.keyCode === 229) {
    return CANDIDATE_KEYS.test(event.code) ? 'select' : null;
  }
  if (event.key === 'Dead') {
    return null;
  }
  // Shortcuts and control keys (Ctrl+C, Cmd+…) strike no type. AltGr arrives as Ctrl+Alt.
  if (event.metaKey || (event.ctrlKey && !event.altKey)) {
    return null;
  }
  switch (event.key) {
    case 'Enter':
      return 'return';
    case 'Backspace':
    case 'Delete':
      return 'backspace';
    case ' ':
      return 'space';
    case 'Tab':
      return 'tab';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    default:
      return Array.from(event.key).length === 1 ? 'key' : null;
  }
}

/** The kind of a change of the preedit text from `previous` to `next`. */
function compositionKind(previous, next) {
  const before = Array.from(previous).length;
  const after = Array.from(next).length;
  if (after > before) return 'compose';
  if (after < before) return 'backspace';
  return previous === next ? null : 'select';
}

/**
 * Geometry of the typewriter stage for a given size: where the sheet, the platen, the paper bail
 * and the editor sit. Mirrors stageLayout() in Typewriter Nocturne.
 */
function stageLayout(width, height, paperWidth = 1) {
  const machineHeight = clamp(height * 0.3, 160, 300);
  // Side margins of about 8.5% leave room for the platen ends and knobs without wide empty bands.
  const margins = width < 720 ? 40 : 2 * clamp(width * 0.085, 64, 150);
  const narrowest = Math.round(Math.max(160, Math.min(width - margins, 1240)));
  const margin = Math.round((width - narrowest) / 2);
  // The platen runs a little past the narrowest sheet on both sides, to its knobs.
  const reach = Math.min(margin * 0.45, 90);
  const platen = {left: margin - reach, right: margin + narrowest + reach};
  const sheetWidth = Math.round(narrowest + 2 * reach * clamp(paperWidth, 0, 1));
  const sheetX = Math.round((width - sheetWidth) / 2);
  const machineTop = height - machineHeight;
  const platenRadius = machineHeight * 0.12;
  const platenY = machineTop + machineHeight * 0.24;
  const bailY = machineTop + machineHeight * 0.08;
  const textHeight = Math.max(80, Math.round(bailY - 16));
  return {
    width,
    height,
    machine: true,
    machineHeight,
    machineTop,
    sheet: {x: sheetX, y: -SHEET_OVERHANG, width: sheetWidth, height: Math.ceil(platenY + SHEET_OVERHANG)},
    margin,
    platen,
    platenY,
    platenRadius,
    bailY,
    text: {x: sheetX, y: 0, width: sheetWidth, height: textHeight}
  };
}

// --- Carriage physics (app/nocturne/carriage-physics.ts) ----------------------------------------

/** The carriage advances to `target` tooth by tooth and stops at the margin. */
function stepImpact(body, target, params, dt) {
  let {position, velocity} = body;
  let remaining = clamp(dt, 0, 0.1);
  while (remaining > 0) {
    const h = Math.min(1 / 480, remaining);
    remaining -= h;
    const offset = target - position;
    if (Math.abs(offset) < 0.25 && Math.abs(velocity) < 25) return {position: target, velocity: 0};
    const direction = Math.sign(offset) || -Math.sign(velocity);
    velocity = clamp(velocity + direction * params.acceleration * h, -params.maxSpeed, params.maxSpeed);
    const next = position + velocity * h;
    if ((next - target) * (position - target) < 0 || next === target) {
      position = target - Math.sign(velocity) * 1e-6;
      velocity = -velocity * params.restitution;
    } else {
      position = next;
    }
  }
  return {position, velocity};
}

// The head hangs from its rail like a pendulum: horizontal acceleration of the carriage tips it
// (pseudo-force -a/L), gravity restores it, friction in the bushings damps it.
function stepSway(body, acceleration, dt) {
  const w = 2 * Math.PI * 4.2;
  const zeta = 0.16;
  const length = 3600;
  let {position, velocity} = body;
  let remaining = clamp(dt, 0, 0.1);
  while (remaining > 0) {
    const h = Math.min(1 / 480, remaining);
    remaining -= h;
    velocity += (-w * w * position - 2 * zeta * w * velocity - acceleration / length) * h;
    position = clamp(position + velocity * h, -0.09, 0.09);
  }
  if (Math.abs(position) < 1e-4 && Math.abs(velocity) < 1e-3) return {position: 0, velocity: 0};
  return {position, velocity};
}

function stepSpring(body, target, frequency, damping, dt) {
  const w = 2 * Math.PI * frequency;
  let {position, velocity} = body;
  let remaining = clamp(dt, 0, 0.1);
  while (remaining > 0) {
    const h = Math.min(1 / 480, remaining);
    remaining -= h;
    velocity += (-w * w * (position - target) - 2 * damping * w * velocity) * h;
    position += velocity * h;
  }
  if (Math.abs(position - target) < 0.002 && Math.abs(velocity) < 0.02) return {position: target, velocity: 0};
  return {position, velocity};
}

/** A key that changes only when the model would look different (a quarter pixel, a tenth of a degree). */
function machineLook(state) {
  return [
    Math.round(state.headX * 4),
    Math.round(state.sway * 2000),
    Math.round(state.strike * 40),
    Math.round(state.vibrator * 40),
    Math.round(state.platenTurn * 3600),
    Math.round(state.spool * 100),
    state.lamp,
    state.intensity
  ].join();
}

const reduceMotionQuery = () => window.matchMedia('(prefers-reduced-motion: reduce)');

export class NocturneStage {
  /**
   * @param {object} options
   * @param {HTMLElement} options.stageEl
   * @param {HTMLElement} options.sheetEl
   * @param {HTMLElement} options.tailEl
   * @param {HTMLCanvasElement} options.canvasEl
   * @param {() => import('@codemirror/view').EditorView | null} options.getView
   */
  constructor({stageEl, sheetEl, canvasEl, paperCanvasEl, glowCanvasEl, getView}) {
    this.stageEl = stageEl;
    this.sheetEl = sheetEl;
    this.canvasEl = canvasEl;
    this.paperCanvasEl = paperCanvasEl;
    this.glowCanvasEl = glowCanvasEl;
    this.getView = getView;

    this.active = false;
    this.options = {sound: true, volume: 0.4, voice: 'standard', variation: 1};

    this.sounds = new TypewriterSounds();
    this.machine = null;
    this.machineLoading = false;
    this.machineFailed = false;

    this.paperLight = null;
    this.lightFailed = false;
    this.glow = null;
    this.drawnLight = '';
    this.lightDirty = true;
    this.lastAmbient = 0;
    this.caret = null;

    this.layout = null;
    this.grid = {left: 0, cols: 0, cellWidth: 9};
    this.specKey = '';
    this.drawnLook = '';
    this.dirty = true;
    this.preedit = '';

    this.carriage = rest();
    this.targetX = 0;
    this.returning = false;
    this.sway = rest();
    this.strike = rest();
    this.vibrator = rest();
    this.platen = rest();
    this.platenTarget = 0;
    this.spool = 0;
    this.armed = true;
    this.bellPending = false;

    this.raf = 0;
    this.timer = 0;
    this.lastTime = 0;
    this.caretFrame = 0;
    this.rebuildTimer = 0;
    this.resizeObserver = null;

    this.reduceMotion = reduceMotionQuery();
    this.mediaQuery = null;
    this.bound = {
      keydown: (event) => this.onKeyDown(event),
      compositionStart: (event) => this.onCompositionStart(event),
      compositionUpdate: (event) => this.onCompositionUpdate(event),
      compositionEnd: (event) => this.onCompositionEnd(event),
      selectionChange: () => this.scheduleCaret(),
      pointerUp: () => this.scheduleCaret(),
      scroll: () => this.scheduleCaret(),
      resize: () => this.onResize(),
      visibility: () => {
        if (!document.hidden) this.schedule();
      },
      reducedChange: () => this.schedule()
    };
  }

  // --- Lifecycle ---------------------------------------------------------------------------------

  setActive(active) {
    if (this.active === active) {
      return;
    }
    this.active = active;
    if (active) {
      this.stageEl.classList.add('is-live');
      this.attach();
      this.syncLayout();
      this.syncSounds();
      this.sounds.configure(this.soundSettings());
      void this.ensureMachine();
      this.schedule();
    } else {
      this.stageEl.classList.remove('is-live');
      this.detach();
      this.sounds.close();
      this.stopFrames();
      // Back to a plain block: the sheet fills the wrapper again.
      this.sheetEl.style.cssText = '';
      this.stageEl.style.removeProperty('--tn-text-h');
      this.stageEl.style.removeProperty('--tn-machine-height');
    }
  }

  /** @param {{sound?: boolean, volume?: number, voice?: string}} options */
  setOptions(options) {
    Object.assign(this.options, options);
    if (!this.active) {
      return;
    }
    this.syncSounds();
    this.sounds.configure(this.soundSettings());
  }

  destroy() {
    this.setActive(false);
    this.machine?.dispose?.();
    this.machine = null;
    this.paperLight?.dispose?.();
    this.paperLight = null;
    this.glow = null;
    this.sounds.close();
    clearTimeout(this.rebuildTimer);
    if (this.caretFrame) cancelAnimationFrame(this.caretFrame);
    this.caretFrame = 0;
  }

  soundSettings() {
    return {
      sound: this.options.sound,
      volume: this.options.volume,
      voice: this.options.voice,
      variation: this.options.variation
    };
  }

  syncSounds() {
    if (!this.options.sound) {
      this.sounds.close();
    }
  }

  attach() {
    const {bound} = this;
    // Capture + passive: CodeMirror and the input method receive every key exactly as before.
    this.stageEl.addEventListener('keydown', bound.keydown, {capture: true, passive: true});
    this.stageEl.addEventListener('compositionstart', bound.compositionStart, {capture: true, passive: true});
    this.stageEl.addEventListener('compositionupdate', bound.compositionUpdate, {capture: true, passive: true});
    this.stageEl.addEventListener('compositionend', bound.compositionEnd, {capture: true, passive: true});
    document.addEventListener('selectionchange', bound.selectionChange);
    this.stageEl.addEventListener('pointerup', bound.pointerUp);
    this.stageEl.addEventListener('scroll', bound.scroll, true);
    window.addEventListener('resize', bound.resize);
    document.addEventListener('visibilitychange', bound.visibility);
    this.reduceMotion.addEventListener?.('change', bound.reducedChange);

    this.mediaQuery = window.matchMedia('(max-width: 700px)');
    this.mediaQuery.addEventListener?.('change', bound.resize);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(this.stageEl);
    }
  }

  detach() {
    const {bound} = this;
    this.stageEl.removeEventListener('keydown', bound.keydown, {capture: true});
    this.stageEl.removeEventListener('compositionstart', bound.compositionStart, {capture: true});
    this.stageEl.removeEventListener('compositionupdate', bound.compositionUpdate, {capture: true});
    this.stageEl.removeEventListener('compositionend', bound.compositionEnd, {capture: true});
    document.removeEventListener('selectionchange', bound.selectionChange);
    this.stageEl.removeEventListener('pointerup', bound.pointerUp);
    this.stageEl.removeEventListener('scroll', bound.scroll, true);
    window.removeEventListener('resize', bound.resize);
    document.removeEventListener('visibilitychange', bound.visibility);
    this.reduceMotion.removeEventListener?.('change', bound.reducedChange);
    this.mediaQuery?.removeEventListener?.('change', bound.resize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.mediaQuery = null;
  }

  // --- Layout ------------------------------------------------------------------------------------

  onResize() {
    if (!this.active) {
      return;
    }
    // Reposition at once; rebuild the model and its textures once the window has settled.
    this.applyLayout();
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      if (this.active) {
        this.applyLayout();
        this.buildMachine();
      }
    }, REBUILD_DELAY);
  }

  syncLayout() {
    this.applyLayout();
    this.buildMachine();
    this.updateTarget(true);
  }

  applyLayout() {
    const width = this.stageEl.clientWidth;
    const height = this.stageEl.clientHeight;
    if (!width || !height) {
      return;
    }
    const layout = stageLayout(width, height, 1);
    this.layout = layout;
    const text = layout.text;
    // The sheet runs from the stage top down behind the platen; the editor inside stops above the
    // bail, leaving the strip where the bail and the type head sit.
    Object.assign(this.sheetEl.style, {
      left: `${text.x}px`,
      top: '0px',
      width: `${text.width}px`,
      height: `${layout.platenY}px`
    });
    this.canvasEl.style.width = `${width}px`;
    this.canvasEl.style.height = `${height}px`;
    this.stageEl.style.setProperty('--tn-text-h', `${text.height}px`);
    this.stageEl.style.setProperty('--tn-machine-height', `${layout.machineHeight}px`);
    this.resizeLightLayers();
  }

  /** The CodeMirror grid: where the text starts and how wide a column is. */
  measureGrid() {
    const view = this.getView();
    const layout = this.layout;
    if (!layout) {
      return {left: 0, cols: 40, cellWidth: 9};
    }
    const stageRect = this.stageEl.getBoundingClientRect();
    if (!view) {
      const cellWidth = this.fallbackCharWidth();
      return {
        left: layout.text.x + 24,
        cols: Math.max(20, Math.floor((layout.text.width - 48) / cellWidth)),
        cellWidth
      };
    }
    const content = view.contentDOM.getBoundingClientRect();
    const cellWidth = this.charWidth(view);
    const left = Math.max(0, content.left - stageRect.left);
    const cols = clamp(Math.floor(content.width / cellWidth), 20, 200);
    return {left, cols, cellWidth};
  }

  charWidth(view) {
    const width = view?.defaultCharacterWidth;
    if (width > 0) {
      return width;
    }
    return this.fallbackCharWidth();
  }

  fallbackCharWidth() {
    const view = this.getView();
    const target = view?.contentDOM || this.sheetEl.querySelector('.cm-content');
    const font = target ? getComputedStyle(target).font : '15px "Courier Prime", monospace';
    const canvas = this.fallbackCanvas || (this.fallbackCanvas = document.createElement('canvas'));
    const context = canvas.getContext('2d');
    context.font = font;
    return Math.max(4, context.measureText('M').width);
  }

  // --- Light -------------------------------------------------------------------------------------

  paperSpec() {
    const theme = THEME;
    return {
      id: 'cotton',
      name: 'Nocturne',
      appearance: theme.paper.appearance,
      paper: theme.paper.color,
      ink: theme.ink,
      surface: theme.surface
    };
  }

  ensureLightLayers() {
    if (!this.paperLight && !this.lightFailed) {
      this.paperLight = PaperLight.create(this.paperCanvasEl, () => {
        this.drawnLight = '';
        this.dirty = true;
        this.schedule();
      });
      this.lightFailed = this.paperLight === null;
    }
    if (!this.glow) {
      this.glow = new GlowLayer(this.glowCanvasEl);
    }
  }

  resizeLightLayers() {
    const layout = this.layout;
    if (!this.active || !layout) {
      return;
    }
    this.ensureLightLayers();
    const width = layout.text.width;
    const height = Math.max(1, layout.platenY);
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    this.paperLight?.build({width, height, pixelRatio, paper: this.paperSpec(), texture: 1});
    this.glow?.resize(width, height, pixelRatio);
    this.drawnLight = '';
    this.lightDirty = true;
    this.schedule();
  }

  rig() {
    const theme = THEME;
    const layout = this.layout;
    return buildRig(
      LIGHTING,
      {light: {source: theme.source, color: theme.light, position: theme.lightPosition}},
      {
        width: layout.text.width,
        height: Math.max(1, layout.platenY),
        // Sheet coordinates: the paper starts at the stage top; the lamp rides just above the bail.
        headX: this.carriage.position - layout.text.x,
        railY: layout.bailY + 12
      }
    );
  }

  lightFrame(rig) {
    const theme = THEME;
    const floor = theme.paper.appearance === 'light' ? 0.6 : 0.64;
    const ambient = Math.min(1, Math.max(floor, 1 - theme.shade * (0.55 + 0.45 * LIGHTING.intensity)));
    const room = toUnit(theme.room);
    const strength = 0.4;
    const tint = (c) => 1 + (0.6 + c * 1.5 - 1) * strength;
    return {
      rig,
      lamp: true,
      tint: toUnit(theme.light),
      ambient,
      ambientTint: [tint(room[0]), tint(room[1]), tint(room[2])],
      relief: 2 * LIGHTING.paperIllumination,
      grain: LIGHTING.grain,
      time: 0,
      // The pointed beam of the default preset: the cone keeps a clean edge up the page.
      soft: false
    };
  }

  glowFrame(rig, now) {
    const theme = THEME;
    const light = toUnit(theme.light);
    const [r, g, b] = light.map((c) => Math.round(c * 255));
    // On a dark sheet the lamp shows as the paper itself lit, warm and dim.
    let pool = [r, g, b];
    if (theme.paper.appearance === 'dark') {
      const sheet = toUnit(theme.paper.color);
      pool = light.map((c, i) => Math.min(255, Math.round(c * sheet[i] * 600)));
    }
    return {
      rig,
      lamp: true,
      rgb: `${r}, ${g}, ${b}`,
      poolRgb: pool.join(', '),
      appearance: theme.paper.appearance,
      intensity: LIGHTING.intensity,
      particles: this.particlesOn() ? LIGHTING.particles : 0,
      cursorGlow: LIGHTING.cursorGlow,
      cursor: this.caret,
      time: now / 1000
    };
  }

  particlesOn() {
    return this.machineMoves() && LIGHTING.particles > 0;
  }

  // --- Machine -----------------------------------------------------------------------------------

  async ensureMachine() {
    if (this.machine || this.machineLoading || this.machineFailed) {
      return this.machine;
    }
    this.machineLoading = true;
    try {
      const {createMachine} = await import('./typewriter-machine.js');
      if (!this.active) {
        return null;
      }
      this.machine = createMachine(this.canvasEl, () => {
        this.dirty = true;
        this.schedule();
      });
      if (!this.machine) {
        this.machineFailed = true;
      } else {
        this.buildMachine();
      }
    } catch (error) {
      this.machineFailed = true;
      console.warn('Typewriter model unavailable:', error);
    } finally {
      this.machineLoading = false;
    }
    return this.machine;
  }

  buildMachine() {
    const layout = this.layout;
    if (!this.active || !layout || !this.machine) {
      return;
    }
    const grid = this.measureGrid();
    this.grid = grid;
    const theme = THEME;
    const key = JSON.stringify([
      layout.width,
      layout.height,
      Math.round(grid.left),
      grid.cols,
      Math.round(grid.cellWidth * 100) / 100
    ]);
    if (key === this.specKey) {
      return;
    }
    this.specKey = key;
    this.machine.build({
      layout,
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      quality: 'medium',
      grid: {
        left: Math.round(grid.left),
        cols: grid.cols,
        cellWidth: Math.round(grid.cellWidth * 100) / 100
      },
      theme,
      paper: theme.paper,
      serif: SERIF_STACK
    });
    this.stageEl.dataset.machine = 'built';
    this.dirty = true;
    this.drawnLook = '';
    // The head should already stand where the caret is when the model appears.
    this.updateTarget(true);
    this.schedule();
  }

  // --- Caret -------------------------------------------------------------------------------------

  scheduleCaret() {
    if (!this.active || this.caretFrame) {
      return;
    }
    this.caretFrame = requestAnimationFrame(() => {
      this.caretFrame = 0;
      this.updateTarget();
    });
  }

  updateTarget(immediate = false) {
    if (!this.active || !this.layout) {
      return;
    }
    const width = this.layout.width;
    const view = this.getView();
    let x = null;
    if (view) {
      const rect = this.stageEl.getBoundingClientRect();
      const head = Math.min(view.state.selection.main.head, view.state.doc.length);
      let coords = null;
      try {
        coords = view.coordsAtPos(head, 1);
      } catch {
        coords = null;
      }
      if (coords) {
        const cellWidth = this.charWidth(view);
        const left = coords.left - rect.left;
        x = left + cellWidth / 2;
        // Caret position in sheet coordinates, for the glow round it.
        this.caret = {x: left - this.layout.text.x + cellWidth / 2, y: coords.top - rect.top};
      }
    }
    if (x === null) {
      const grid = this.grid;
      x = grid.left + grid.cellWidth / 2;
    }
    x = clamp(x, 10, Math.max(10, width - 10));
    this.targetX = x;
    if (immediate || !this.machineMoves()) {
      this.carriage = {position: x, velocity: 0};
    } else if (x < this.carriage.position - 4 * Math.max(1, this.grid.cellWidth)) {
      this.returning = true;
    }
    if (this.bellPending) {
      this.bellPending = false;
      this.checkMarginBell();
    }
    // 车架的目标位置变了：物理会自己把模型带过去，下面的帧会看到 headX 变化
    this.schedule();
  }

  /** The margin bell rings once when the carriage reaches the last eight columns. */
  checkMarginBell() {
    const {left, cols, cellWidth} = this.grid;
    if (!cols || !cellWidth) {
      return;
    }
    const column = (this.targetX - left) / cellWidth;
    if (column < cols - 9) {
      this.armed = true;
    } else if (column >= cols - 7 && this.armed && this.options.sound) {
      this.armed = false;
      this.sounds.play('bell', {pan: this.pan()});
    }
  }

  pan() {
    const width = this.layout?.width || 0;
    return width > 0 ? clamp((this.carriage.position / width) * 1.4 - 0.7, -0.7, 0.7) : 0;
  }

  // --- Keys --------------------------------------------------------------------------------------

  isEditorTarget(target) {
    return target instanceof Element && Boolean(target.closest('.cm-content'));
  }

  onKeyDown(event) {
    if (!this.isEditorTarget(event.target)) {
      return;
    }
    const kind = keyKind(event);
    if (!kind) {
      return;
    }
    this.handleKey(kind, event.repeat);
    this.scheduleCaret();
  }

  onCompositionStart(event) {
    if (!this.isEditorTarget(event.target)) {
      return;
    }
    this.preedit = '';
  }

  onCompositionUpdate(event) {
    if (!this.isEditorTarget(event.target)) {
      return;
    }
    const kind = compositionKind(this.preedit || '', event.data || '');
    this.preedit = event.data || '';
    if (kind) {
      this.handleKey(kind, false);
    }
    this.scheduleCaret();
  }

  onCompositionEnd(event) {
    if (!this.isEditorTarget(event.target)) {
      return;
    }
    if (event.data) {
      this.handleKey('commit', false);
    }
    this.preedit = '';
    this.scheduleCaret();
  }

  play(kind, repeat = false, gain = 1) {
    this.sounds.play(kind, {repeat, pan: this.pan(), gain});
  }

  /** The type bar throws the head at the platen; the ribbon lifts; the spools advance. */
  throwTypeBar(force = 1) {
    this.strike = {position: this.strike.position, velocity: 30 * STRIKE_TRAVEL * force};
    this.vibrator = {position: this.vibrator.position, velocity: 16 * VIBRATOR_LIFT * force};
    this.spool += 0.07 * force;
  }

  handleKey(kind, repeat) {
    switch (kind) {
      case 'return':
        this.play('return', repeat);
        this.platenTarget += LINE_FEED_DEGREES;
        this.armed = true;
        break;
      case 'backspace':
        this.play('backspace', repeat);
        break;
      case 'up':
      case 'down':
        // Recalling shell history turns the platen back or forward by one notch.
        this.play('history', repeat);
        this.platenTarget += kind === 'up' ? -LINE_FEED_DEGREES / 2 : LINE_FEED_DEGREES / 2;
        break;
      case 'left':
      case 'right':
        this.play('nudge', repeat);
        break;
      case 'tab':
        this.play('tab', repeat);
        break;
      case 'select':
        this.play('select', repeat);
        this.vibrator = {position: this.vibrator.position, velocity: 6 * VIBRATOR_LIFT};
        break;
      case 'commit':
        this.play('commit');
        this.throwTypeBar(1.35);
        break;
      case 'compose':
        // A keystroke inside an input method: the key is struck while the text is still preedit.
        this.play('key', repeat, 0.85);
        this.throwTypeBar(0.8);
        break;
      default:
        this.play(kind === 'space' ? 'space' : 'key', repeat);
        this.throwTypeBar(1);
        this.bellPending = true;
    }
    if (!this.machineMoves()) {
      this.platen = {position: this.platenTarget, velocity: 0};
      this.strike = rest();
      this.vibrator = rest();
    }
    this.dirty = true;
    this.schedule();
  }

  // --- Frames ------------------------------------------------------------------------------------

  machineMoves() {
    return !this.reduceMotion.matches;
  }

  schedule(delay = 0) {
    if (!this.active || document.hidden) {
      return;
    }
    if (delay > 0) {
      // Ambient frames (dust in the beam) are paced, not drawn at the display's rate.
      if (this.timer || this.raf) {
        return;
      }
      this.timer = setTimeout(() => {
        this.timer = 0;
        this.frame(performance.now());
      }, delay);
      return;
    }
    if (this.raf) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = 0;
    }
    this.raf = requestAnimationFrame((now) => this.frame(now));
  }

  stopFrames() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.raf = 0;
    this.timer = 0;
  }

  step(dt) {
    if (!this.machineMoves()) {
      this.carriage = {position: this.targetX, velocity: 0};
      this.sway = rest();
      this.strike = rest();
      this.vibrator = rest();
      this.platen = {position: this.platenTarget, velocity: 0};
      return false;
    }
    const before = this.carriage.velocity;
    const params = this.returning ? CARRIAGE_RETURN : ESCAPEMENT;
    this.carriage = stepImpact(this.carriage, this.targetX, params, dt);
    const acceleration = dt > 0 ? (this.carriage.velocity - before) / dt : 0;
    this.sway = stepSway(this.sway, acceleration, dt);
    if (!moving(this.carriage, this.targetX)) {
      this.returning = false;
    }
    // The head is thrown forward, stopped by the platen, and springs back.
    const strike = stepSpring(this.strike, 0, STRIKE, dt);
    this.strike = strike.position < 0 ? rest() : strike;
    this.vibrator = stepSpring(this.vibrator, 0, VIBRATOR, dt);
    this.platen = stepSpring(this.platen, this.platenTarget, PLATEN, dt);
    return (
      moving(this.carriage, this.targetX) ||
      moving(this.sway) ||
      moving(this.strike) ||
      moving(this.vibrator) ||
      moving(this.platen, this.platenTarget)
    );
  }

  machineState() {
    return {
      headX: this.carriage.position,
      sway: this.sway.position,
      strike: this.strike.position / STRIKE_TRAVEL,
      vibrator: this.vibrator.position / VIBRATOR_LIFT,
      spool: this.spool,
      platenTurn: this.platen.position / 360,
      lamp: true,
      intensity: 1
    };
  }

  frame(now) {
    this.raf = 0;
    if (!this.active || !this.layout) {
      return;
    }
    const interval = this.lastTime ? now - this.lastTime : 0;
    const dt = interval ? Math.min(0.05, interval / 1000) : 1 / 60;
    this.lastTime = now;

    const movingNow = this.step(dt);

    // The lamp: the paper light only redraws when the head (or the lamp) moved; the glow layer
    // also carries the dust motes, paced by AMBIENT_INTERVAL.
    const rig = this.rig();
    const lightLook = `${Math.round(this.carriage.position)}|${this.layout.width}x${this.layout.height}`;
    const lightChanged = this.lightDirty || lightLook !== this.drawnLight;
    const ambientDue = this.particlesOn() && now - this.lastAmbient >= AMBIENT_INTERVAL;
    if (lightChanged) {
      this.paperLight?.render(this.lightFrame(rig));
      this.drawnLight = lightLook;
      this.lightDirty = false;
    }
    if (lightChanged || ambientDue) {
      this.glow?.render(this.glowFrame(rig, now));
      if (ambientDue) {
        this.lastAmbient = now;
      }
    }

    // The machine.
    let pending = false;
    if (this.machine) {
      const state = this.machineState();
      const look = machineLook(state);
      if (this.dirty || look !== this.drawnLook) {
        const drew = this.machine.render(state);
        if (drew) {
          this.drawnLook = look;
          this.dirty = false;
          this.stageEl.dataset.machine = 'drawn';
        } else {
          // Shaders are still compiling; ask for a frame until the model can be drawn.
          pending = true;
        }
      }
    }

    if (movingNow || pending) {
      this.schedule();
    } else if (this.particlesOn()) {
      this.schedule(AMBIENT_INTERVAL);
    } else {
      this.lastTime = 0;
    }
  }
}
