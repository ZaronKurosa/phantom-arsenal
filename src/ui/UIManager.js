import { Emitter } from '../utils/Emitter.js';
import { HAND_CONNECTIONS } from '../tracking/HandTracker.js';
import { VARIANTS } from '../swords/SwordGeometry.js';
import { MODES } from '../swords/SwordController.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* Gesture reference content                                            */
/* ------------------------------------------------------------------ */
const REFERENCE = {
  camera: {
    title: 'HAND GESTURES',
    rows: [
      ['Move hand', 'Sword follows. Hand size = depth (closer to camera = closer to you).'],
      ['Open palm', 'Hover mode. In MASTER, hold it to summon the formation.'],
      ['Closed fist', 'Follow mode, formation gathers. In MASTER, hold to recall.'],
      ['Pinch', 'Precision positioning. Release the pinch to teleport.'],
      ['Rotate wrist', 'Tilts the sword. A fast twist makes it spin.'],
      ['Spread fingers', 'Expands the formation. Bring fingers together to collapse it.'],
      ['Swipe', 'Open-palm swipe changes formation (SOLO: dash).'],
      ['Quick move', 'Fist or point flick: sword dashes (formation follows in a wave).'],
      ['Two hands', 'Right hand leads, left hand places the formation. Hold both palms open for the cinematic formation.'],
    ],
    keys: true,
  },
  mouse: {
    title: 'MOUSE & KEYS',
    rows: [
      ['Move', 'Sword follows the cursor.'],
      ['Wheel', 'Depth. Alt + wheel = formation spread.'],
      ['Click', 'Dash toward the cursor.'],
      ['Hold click', 'Follow mode, formation gathers.'],
      ['Shift', 'Precision mode. Release Shift to teleport.'],
      ['Right-click', 'Spin animation.'],
      ['Double-click', 'Summon / recall the swords (SOLO: blade echo).'],
      ['Space', 'Cycle formation (summons if none).'],
      ['Arrows', 'Swipe: change formation (SOLO: dash).'],
      ['Q / E', 'Collapse / expand formation.'],
      ['A / D', 'Rotate wrist (tilt sword and formation).'],
      ['C · Middle-click', 'Cinematic formation.'],
      ['T', 'Twin hands: mirrored second hand for two-hand play.'],
    ],
    keys: true,
  },
  demo: {
    title: 'DEMO',
    rows: [
      ['Autoplay', 'A ghost hand tours SOLO, ARSENAL and MASTER: spins, dashes, teleports, formations and the cinematic finale.'],
      ['Take over', 'Pick CAMERA or MOUSE at any time. Your mode and formation are kept.'],
    ],
    keys: true,
  },
};
const KEYS = [
  ['1 · 2 · 3', 'Switch mode'],
  ['Tab', 'Next sword'],
  ['R', 'Reset scene'],
  ['I', 'Next input'],
  ['F · H · B', 'Fullscreen · guide · preview'],
];

/* ------------------------------------------------------------------ */
/* Sword icons                                                          */
/* ------------------------------------------------------------------ */
const ICONS = {
  nightfang: `<svg viewBox="0 0 40 90" fill="currentColor"><path d="M20 2l5 50h-10z"/><path d="M6 54c4 2 8 1 14 2 6-1 10 0 14-2l-2 5c-4 0-8 1-12 1s-8-1-12-1z"/><path d="M5 50l3 4-2 2zM35 50l-3 4 2 2z"/><rect x="18" y="58" width="4" height="22" rx="1"/><path d="M20 80l4 5-4 4-4-4z"/></svg>`,
  wraith: `<svg viewBox="0 0 40 90" fill="currentColor"><path d="M17 3c10 8 13 30 11 50h-9c0-18-1-34-2-50z"/><path d="M12 54h18l-3 4H15z"/><path d="M20 49l-9 5 9-1z"/><rect x="18" y="58" width="4" height="22" rx="1"/><circle cx="20" cy="84" r="4" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  requiem: `<svg viewBox="0 0 40 90" fill="currentColor"><path d="M20 2c3 8 7 12 6 18 3 4 5 8 3 12 2 5 3 10 1 16H10c-2-6-1-11 1-16-2-4 0-8 3-12-1-6 3-10 6-18z"/><path d="M4 56c8 0 12 1 16 4 4-3 8-4 16-4l-3 12-7-6h-12l-7 6z"/><rect x="18" y="62" width="4" height="18" rx="1"/><path d="M20 80l5 5-5 5-5-5z"/></svg>`,
  mixed: `<svg viewBox="0 0 40 90" fill="currentColor"><path d="M10 6l3 42H7z" opacity=".9"/><path d="M20 2l4 46h-8z"/><path d="M30 8c6 8 6 24 3 40h-5c1-14 0-28 2-40z" opacity=".9"/><path d="M4 50h32v3H4z"/><rect x="18" y="53" width="4" height="26"/><path d="M20 80l4 5-4 4-4-4z"/></svg>`,
};

/**
 * Owns every piece of DOM. It never touches the scene; main.js wires it to
 * the input manager and sword controller through events.
 */
export class UIManager extends Emitter {
  constructor() {
    super();
    this.el = {
      hud: $('hud'),
      title: $('title'),
      guide: $('guide'),
      veil: $('veil'),
      app: $('app'),
      stage: $('stage'),
      toasts: $('toasts'),
      camCard: $('camCard'),
      camVideo: $('camVideo'),
      camOverlay: $('camOverlay'),
      camLabel: $('camLabel'),
      cursor: $('handCursor'),
      refPanel: $('refPanel'),
      refList: $('refList'),
      refTitle: $('refTitle'),
    };
    this.previewOn = true;
    this.helpOn = true;
    this.inputMode = 'none';
    this.ctx = this.el.camOverlay.getContext('2d');
    this._actionTimer = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._bindStatic();
    this._buildSwordPanel();
    this.setReference('camera');
    this._sizeOverlay();
    window.addEventListener('resize', () => this._sizeOverlay());
    document.addEventListener('fullscreenchange', () => this._syncFullscreen());
  }

  /* ----------------------------- wiring ----------------------------- */

  _bindStatic() {
    $('btnStart').addEventListener('click', () => this.emit('start', { input: 'camera' }));
    $('titleMouse').addEventListener('click', () => this.emit('start', { input: 'mouse' }));
    $('titleDemo').addEventListener('click', () => this.emit('start', { input: 'demo' }));
    $('guideMouse').addEventListener('click', () => this.emit('input', { mode: 'mouse' }));
    $('guideDemo').addEventListener('click', () => this.emit('input', { mode: 'demo' }));

    for (const b of document.querySelectorAll('[data-input]')) {
      b.addEventListener('click', () => this.emit('input', { mode: b.dataset.input }));
    }
    for (const b of document.querySelectorAll('[data-mode]')) {
      b.addEventListener('click', () => this.emit('gameMode', { mode: b.dataset.mode }));
    }
    $('btnReset').addEventListener('click', () => this.emit('reset', {}));
    $('btnFullscreen').addEventListener('click', () => this.toggleFullscreen());
    $('btnPreview').addEventListener('click', () => this.togglePreview());
    $('btnHelp').addEventListener('click', () => this.toggleHelp());
    $('refClose').addEventListener('click', () => this.toggleHelp(false));
    this.togglePreview(true);
  }

  _buildSwordPanel() {
    const grid = $('swordGrid');
    const items = [...VARIANTS.map((v) => ({ id: v.id, name: v.name, title: v.desc })), { id: 'mixed', name: 'Mixed', title: 'A different blade in every slot' }];
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'sword-card';
      b.dataset.variant = it.id;
      b.dataset.ui = '';
      b.title = it.title;
      b.innerHTML = `${ICONS[it.id]}<span>${it.name.split(' ').pop()}</span>`;
      b.addEventListener('click', () => this.emit('variant', { choice: it.id }));
      grid.appendChild(b);
    }
  }

  /* ----------------------------- screens ---------------------------- */

  hideTitle() {
    this.el.title.classList.add('is-hidden');
  }

  showHud(v = true) {
    this.el.hud.classList.toggle('is-hidden', !v);
  }

  showGuide(v, { title, text, steps } = {}) {
    this.el.guide.classList.toggle('is-hidden', !v);
    if (title) $('guideTitle').textContent = title;
    if (text) $('guideText').textContent = text;
    if (steps !== undefined) $('guideSteps').style.display = steps ? '' : 'none';
  }

  setGuideText(text) {
    $('guideText').textContent = text;
  }

  setVeil(dim) {
    this.el.veil.classList.toggle('dim', dim);
  }

  /* ----------------------------- status ----------------------------- */

  setInputMode(mode, availability = {}) {
    this.inputMode = mode;
    for (const b of document.querySelectorAll('[data-input]')) {
      b.classList.toggle('active', b.dataset.input === mode);
      if (b.dataset.input === 'camera') b.disabled = availability.camera === false;
    }
    const names = { camera: 'CAMERA · HAND TRACKING', mouse: 'MOUSE · KEYBOARD', demo: 'DEMO · AUTOPLAY', none: '—' };
    $('activeInput').textContent = `INPUT · ${names[mode] || '—'}`;
    this.setReference(mode === 'none' ? 'camera' : mode);
    this.el.cursor.classList.toggle('on', mode === 'camera' || mode === 'demo');
    if (mode !== 'camera') this.clearOverlay();
    this._syncPreview();
    this._updateCamLabel();
  }

  setGameMode(mode) {
    for (const b of document.querySelectorAll('[data-mode]')) b.classList.toggle('active', b.dataset.mode === mode);
    $('modeDesc').textContent = MODES[mode]?.desc || '';
  }

  setCameraStatus(status, message = '') {
    const labels = {
      idle: ['IDLE', ''],
      requesting: ['REQUESTING…', 'warn'],
      active: ['ACTIVE', 'ok'],
      denied: ['PERMISSION DENIED', 'bad'],
      unavailable: ['UNAVAILABLE', 'bad'],
      disconnected: ['DISCONNECTED', 'bad'],
      error: ['ERROR', 'bad'],
    };
    const [text, cls] = labels[status] || labels.idle;
    $('camStatus').textContent = text;
    this._setChip('chipCamera', cls);
    this._camStatus = status;
    this._updateCamLabel();
  }

  setTracking(text, level = '') {
    $('trackStatus').textContent = text;
    this._setChip('chipTrack', level);
  }

  _setChip(id, cls) {
    const el = $(id);
    el.classList.remove('ok', 'warn', 'bad');
    if (cls) el.classList.add(cls);
  }

  _updateCamLabel() {
    const l = this.el.camLabel;
    if (this.inputMode === 'camera' && this._camStatus === 'active') l.textContent = 'LIVE · LOCAL ONLY';
    else if (this._camStatus === 'requesting') l.textContent = 'AWAITING PERMISSION';
    else l.textContent = 'CAMERA OFF';
  }

  setGesture(label) {
    const el = $('gestureLabel');
    if (el.textContent !== label) el.textContent = label;
  }

  flashAction(text) {
    const el = $('actionLabel');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._actionTimer);
    this._actionTimer = setTimeout(() => el.classList.remove('show'), 1700);
  }

  setFormation(name) {
    $('formationLabel').textContent = name ? `FORMATION · ${name.toUpperCase()}` : '';
  }

  setSwordCount(n) {
    const el = $('swordCount');
    if (el.textContent !== String(n)) el.textContent = String(n);
  }

  setVariant(choice) {
    for (const b of document.querySelectorAll('.sword-card')) b.classList.toggle('active', b.dataset.variant === choice);
  }

  /** Call every frame with the raw frame time; updates the label twice a second. */
  tickFps(dt, quality) {
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      const fps = Math.round(this._fpsFrames / this._fpsAcc);
      $('fpsValue').textContent = String(fps);
      $('qualityValue').textContent = ['LOW', 'MED', 'HIGH'][quality] || '';
      this.fps = fps;
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
  }

  /* --------------------------- reference ---------------------------- */

  setReference(mode) {
    const ref = REFERENCE[mode] || REFERENCE.camera;
    this.el.refTitle.textContent = ref.title;
    const list = this.el.refList;
    list.innerHTML = '';
    for (const [k, v] of ref.rows) {
      const li = document.createElement('li');
      li.innerHTML = `<b>${k}</b><span>${v}</span>`;
      list.appendChild(li);
    }
    if (ref.keys) {
      const sep = document.createElement('li');
      sep.className = 'ref-sep';
      sep.textContent = 'ALWAYS AVAILABLE';
      list.appendChild(sep);
      for (const [k, v] of KEYS) {
        const li = document.createElement('li');
        li.innerHTML = `<b>${k}</b><span>${v}</span>`;
        list.appendChild(li);
      }
    }
  }

  toggleHelp(force) {
    this.helpOn = force ?? !this.helpOn;
    this.el.refPanel.classList.toggle('is-closed', !this.helpOn);
    $('btnHelp').setAttribute('aria-pressed', String(this.helpOn));
  }

  togglePreview(force) {
    this.previewOn = force ?? !this.previewOn;
    this._syncPreview();
    $('btnPreview').setAttribute('aria-pressed', String(this.previewOn));
  }

  /** The preview card is shown only while the camera is the active input. */
  _syncPreview() {
    this.el.camCard.classList.toggle('is-off', !(this.previewOn && this.inputMode === 'camera'));
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await (document.documentElement.requestFullscreen?.() ?? Promise.reject(new Error('unsupported')));
    } catch {
      this.toast({ level: 'info', text: 'Fullscreen is not available in this browser or context.', timeout: 3000 });
    }
  }

  _syncFullscreen() {
    const on = !!document.fullscreenElement;
    $('btnFullscreen').setAttribute('aria-pressed', String(on));
  }

  /* ------------------------------ toasts ---------------------------- */

  toast({ level = 'info', title = '', text = '', actions = [], timeout = 4000 } = {}) {
    const box = this.el.toasts;
    while (box.children.length >= 3) box.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = `toast ${level}`;
    if (title) {
      const h = document.createElement('h4');
      h.textContent = title;
      el.appendChild(h);
    }
    const p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
    const dismiss = () => {
      if (!el.isConnected || el.classList.contains('leaving')) return;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 400);
    };
    if (actions.length) {
      const row = document.createElement('div');
      row.className = 'toast-actions';
      for (const a of actions) {
        const b = document.createElement('button');
        b.textContent = a.label;
        b.addEventListener('click', () => {
          dismiss();
          a.run?.();
        });
        row.appendChild(b);
      }
      const close = document.createElement('button');
      close.textContent = 'Dismiss';
      close.addEventListener('click', dismiss);
      row.appendChild(close);
      el.appendChild(row);
    }
    box.appendChild(el);
    if (timeout) setTimeout(dismiss, timeout);
    return el;
  }

  /* ------------------------ hand overlay + cursor -------------------- */

  _sizeOverlay() {
    const c = this.el.camOverlay;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.max(2, Math.round(r.width * dpr));
    c.height = Math.max(2, Math.round(r.height * dpr));
  }

  clearOverlay() {
    const c = this.el.camOverlay;
    this.ctx.clearRect(0, 0, c.width, c.height);
  }

  /** Draws the 21 landmarks of each tracked hand over the (mirrored) preview. */
  drawHands(hands, video) {
    if (!this.previewOn) return;
    const c = this.el.camOverlay;
    if (!c.width || c.width < 4) this._sizeOverlay();
    const g = this.ctx;
    const W = c.width;
    const H = c.height;
    g.clearRect(0, 0, W, H);
    const vw = video?.videoWidth || 16;
    const vh = video?.videoHeight || 9;
    // reproduce object-fit: cover so landmarks line up with the picture
    const s = Math.max(W / vw, H / vh);
    const ox = (W - vw * s) / 2;
    const oy = (H - vh * s) / 2;
    const px = (p) => ox + p.x * vw * s;
    const py = (p) => oy + p.y * vh * s;

    for (const hand of hands) {
      const lm = hand.landmarks;
      g.lineWidth = Math.max(1.2, W / 220);
      g.strokeStyle = 'rgba(215,218,230,0.85)';
      g.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        g.moveTo(px(lm[a]), py(lm[a]));
        g.lineTo(px(lm[b]), py(lm[b]));
      }
      g.stroke();
      g.fillStyle = '#a66bff';
      const r = Math.max(2, W / 110);
      for (let i = 0; i < lm.length; i++) {
        g.beginPath();
        g.arc(px(lm[i]), py(lm[i]), i % 4 === 0 && i > 0 ? r * 1.3 : r, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.font = `${Math.round(W / 24)}px "JetBrains Mono", monospace`;
      g.fillText(hand.side === 'Left' ? 'L' : 'R', px(lm[0]) - r, py(lm[0]) + r * 5);
    }
  }

  /** Ring that shows where the tracked hand is mapped on screen. */
  setCursor(state, mode) {
    const el = this.el.cursor;
    if (!state || !state.active || (mode !== 'camera' && mode !== 'demo')) {
      el.classList.remove('on');
      return;
    }
    const r = this.el.stage.getBoundingClientRect();
    const h = state.primary;
    const nx = Math.max(-0.96, Math.min(0.96, h.pos.x));
    const ny = Math.max(-0.92, Math.min(0.92, h.pos.y));
    const x = (nx * 0.5 + 0.5) * r.width;
    const y = (-ny * 0.5 + 0.5) * r.height;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    el.classList.add('on');
    el.classList.toggle('fist', h.pose === 'fist');
    el.classList.toggle('pinch', h.pose === 'pinch');
  }
}
