import { Emitter } from '../utils/Emitter.js';
import { HAND_CONNECTIONS } from '../tracking/HandTracker.js';
import { LOADOUTS } from '../weapons/WeaponRegistry.js';
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
      ['Point & flick', 'Point with one finger and flick fast: the sword dashes (formation follows in a wave).'],
      ['Two fingers', 'Hold up index + middle finger. Shows TWO FINGERS; bind it to any action in the Gesture Lab.'],
      ['Two hands', 'Right hand leads, left hand places the formation. Hold both palms open for the cinematic formation.'],
      ['4 · TRIAL', 'Fly through rings and smash blocks. Each shows the move it needs; use any gesture you bound to it.'],
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
      ['4 · TRIAL', 'Fly through rings and smash blocks. Each shows the move it needs.'],
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
  ['1 · 2 · 3 · 4', 'Switch mode'],
  ['G', 'Gesture Lab: rebind gestures, make tasks and courses'],
  ['Tab', 'Next weapon'],
  ['5 · 6 · 7 · 8 · 9', 'Katana · Greatsword · Left dagger · Right dagger · Twin daggers'],
  ['R', 'Reset scene'],
  ['I', 'Next input'],
  ['F · H · B', 'Fullscreen · guide · preview'],
];

/* ------------------------------------------------------------------ */
/* Sword icons                                                          */
/* ------------------------------------------------------------------ */
const DAGGER = (flip) =>
  `<g ${flip ? 'transform="translate(40 0) scale(-1 1)"' : ''}><path d="M13 14c-7 9-9 24-7 38h11c2-14 1-28-4-38z"/><path d="M4 54h20l-2 4H6z"/><path d="M9 54l-5 5 7-1z"/><rect x="11" y="58" width="4" height="18" rx="1"/><path d="M13 76l4 5-4 5-4-5z"/></g>`;
const ICONS = {
  katana: `<svg viewBox="0 0 40 90" fill="currentColor"><path d="M25 2c-8 13-11 33-9 52h6c-1-19 0-36 3-52z"/><ellipse cx="19" cy="57" rx="9" ry="3"/><rect x="16.5" y="59" width="5" height="22" rx="1"/><path d="M19 81l3 5-3 3-3-3z"/></svg>`,
  greatsword: `<svg viewBox="0 0 40 90" fill="currentColor"><path d="M20 1l8 12v38H12V13z"/><path d="M2 40c2 8 8 12 18 12s16-4 18-12c-3 4-8 6-12 6l-3 5h-6l-3-5c-4 0-9-2-12-6z"/><path d="M6 52h28l-3 5H9z"/><rect x="17.5" y="57" width="5" height="20" rx="1"/><path d="M20 77l5 6-5 6-5-6z"/></svg>`,
  'dagger-left': `<svg viewBox="0 0 40 90" fill="currentColor">${DAGGER(false)}</svg>`,
  'dagger-right': `<svg viewBox="0 0 40 90" fill="currentColor">${DAGGER(true)}</svg>`,
  twin: `<svg viewBox="0 0 80 90" fill="currentColor"><g transform="translate(-4 0)">${DAGGER(false)}</g><g transform="translate(44 0)">${DAGGER(true)}</g></svg>`,
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
    $('btnLab').addEventListener('click', () => this.emit('lab', {}));
    $('titleLab').addEventListener('click', () => this.emit('lab', {}));
    $('trLab').addEventListener('click', () => this.emit('lab', {}));
    $('trOverLab').addEventListener('click', () => this.emit('lab', {}));
    $('trRestart').addEventListener('click', () => this.emit('trialRetry', {}));
    $('trRetry').addEventListener('click', () => this.emit('trialRetry', {}));
    $('courseSelect').addEventListener('change', (e) => this.emit('course', { id: e.target.value }));
    $('refClose').addEventListener('click', () => this.toggleHelp(false));
    this.togglePreview(true);
  }

  _buildSwordPanel() {
    const grid = $('swordGrid');
    for (const l of LOADOUTS) {
      const b = document.createElement('button');
      b.className = 'sword-card';
      b.dataset.weapon = l.id;
      b.dataset.ui = '';
      b.title = `${l.name} (${l.key}): ${l.desc}`;
      b.innerHTML = `${ICONS[l.id]}<span>${l.short}</span><kbd>${l.key}</kbd>`;
      b.addEventListener('click', () => {
        this.emit('weapon', { id: l.id });
        b.blur(); // keep Space/Enter free for the scene instead of re-pressing this card
      });
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

  /* ------------------------------ trial HUD -------------------------- */

  setTrialVisible(v) {
    $('trialHud').classList.toggle('is-hidden', !v);
    if (!v) {
      $('trOver').classList.add('is-hidden');
      $('trBanner').classList.remove('show');
    }
  }

  setCourses(list, selected) {
    const sel = $('courseSelect');
    sel.replaceChildren();
    for (const c of list) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      sel.appendChild(o);
    }
    if (selected) sel.value = selected;
  }

  setTrial(st) {
    $('trScore').textContent = String(st.score);
    $('trCombo').textContent = String(st.combo);
    $('trBest').textContent = String(st.best);
    $('trLevelLabel').textContent = st.endless ? 'LEVEL' : 'PROGRESS';
    $('trLevel').textContent = st.endless ? String(st.level) : st.progress;
    const pips = $('trShields');
    let html = '';
    for (let i = 0; i < st.maxShields; i++) html += `<i class="${i < st.shields ? 'on' : ''}"></i>`;
    if (pips.innerHTML !== html) pips.innerHTML = html;
    if ($('courseSelect').value !== st.courseId && st.courseId) $('courseSelect').value = st.courseId;

    const next = $('trNext');
    if (st.over) next.textContent = '';
    else if (st.next) {
      const verb = st.next.type === 'ring' ? 'RING' : 'BLOCK';
      const how = st.next.hint ? ` · ${st.next.hint}` : '';
      next.innerHTML = '';
      const a = document.createElement('b');
      a.textContent = `NEXT ${verb}: ${st.next.name.toUpperCase()}`;
      const b = document.createElement('span');
      b.textContent = how || '';
      if (st.next.hint === 'not bound') b.className = 'warn';
      next.append(a, b);
    } else next.textContent = 'Obstacles incoming…';

    const over = $('trOver');
    over.classList.toggle('is-hidden', !st.over);
    if (st.over) {
      $('trOverTitle').textContent = st.cleared ? 'COURSE CLEARED' : 'TRIAL ENDED';
      $('trOverStats').textContent = `Score ${st.score}  ·  Best ${st.best}`;
    }
  }

  trialResult(text, good) {
    const el = $('trBanner');
    el.textContent = text;
    el.classList.toggle('bad', !good);
    el.classList.remove('show');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => el.classList.remove('show'), 1500);
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

  /** highlight the equipped loadout; `state` ('dismissing' | 'entering' | 'idle') marks a switch in progress */
  setWeapon(id, state = 'idle') {
    for (const b of document.querySelectorAll('.sword-card')) {
      b.classList.toggle('active', b.dataset.weapon === id);
      b.classList.toggle('busy', b.dataset.weapon === id && state !== 'idle');
    }
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
