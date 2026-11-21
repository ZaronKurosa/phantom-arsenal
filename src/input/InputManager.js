import { Emitter } from '../utils/Emitter.js';
import { MouseInput } from './MouseInput.js';
import { DemoDirector } from './DemoDirector.js';
import { createControlState } from './ControlState.js';

export const INPUT_MODES = ['camera', 'mouse', 'demo'];
const CAMERA_DEADLINE_MS = 30000;
const GESTURE_EVENTS = ['dash', 'swipe', 'spin', 'teleport', 'cinematic'];

/**
 * Single entry point for every way of controlling the scene.
 *
 *  - Detects which inputs exist (camera API present? permission blocked?).
 *  - Lets the user switch CAMERA / MOUSE / DEMO at any time.
 *  - Falls back to the mouse automatically (with a friendly notice) when the
 *    camera is denied, missing, broken, slow to load or unplugged.
 *  - Only the active source can emit events or move the sword, so camera and
 *    mouse can never fight over control.
 *  - Is stateless with respect to swords: the formation survives any switch.
 *
 * Emits:
 *   'mode' {mode, previous, auto}      active input changed
 *   'busy' {busy, text}                camera is starting up
 *   'notify' {level, title, text, actions}
 *   'gameMode' {mode}                  keyboard 1/2/3 (and demo script)
 *   'dash' 'swipe' 'spin' 'teleport' 'cinematic' 'summon' 'formation'
 *   'reset' 'variant' 'fullscreen' 'help' 'preview'
 */
export class InputManager extends Emitter {
  constructor({ camera, tracker, gestures, mouseTarget, getGameMode }) {
    super();
    this.camera = camera;
    this.tracker = tracker;
    this.gestures = gestures;
    this.getGameMode = getGameMode || (() => 'solo');

    this.mouse = new MouseInput(mouseTarget);
    this.demo = new DemoDirector();

    this.mode = 'none';
    this.busy = false;
    this.keysEnabled = false;
    this.state = createControlState();
    this.lastHandsAt = 0;
    this.modeBeforeDemo = null;
    this._switchId = 0;
    this.cameraIssue = null; // last camera failure, for the UI
    this.available = {
      camera: CameraSupport(),
      mouse: true,
      demo: true,
    };

    this._wire();
  }

  /* ------------------------------------------------------------------ */

  _wire() {
    // Gesture events (camera) – forwarded only while the camera is the active input
    for (const name of GESTURE_EVENTS) {
      this.gestures.on(name, (p) => {
        if (this.mode === 'camera') this.emit(name, p);
      });
    }

    this.tracker.on('hands', (hands) => {
      if (this.mode !== 'camera') return;
      const now = performance.now();
      this.lastHandsAt = now;
      const aspect = this.camera.width && this.camera.height ? this.camera.width / this.camera.height : 16 / 9;
      this.gestures.update(hands, now, aspect);
    });

    // Mouse events – only fire while attached (mouse active)
    for (const name of ['dash', 'spin', 'teleport', 'cinematic', 'summon']) {
      this.mouse.on(name, (p) => {
        if (this.mode === 'mouse') this.emit(name, p);
      });
    }
    this.mouse.on('twin', ({ on }) => this.emit('notify', { level: 'info', text: on ? 'Twin hands ON — a mirrored second hand joins your cursor.' : 'Twin hands OFF.', timeout: 2600 }));

    // Demo events
    for (const name of ['dash', 'swipe', 'spin', 'teleport', 'cinematic', 'summon', 'gameMode']) {
      this.demo.on(name, (p) => {
        if (this.mode === 'demo') this.emit(name, p);
      });
    }

    // Camera lifecycle
    this.camera.on('status', ({ status }) => {
      if (status === 'disconnected' && this.mode === 'camera') this._onCameraLost();
    });

    window.addEventListener('keydown', (e) => this._onKey(e));
  }

  _onKey(e) {
    if (!this.keysEnabled) return;
    if (e.ctrlKey || e.metaKey) return;
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const k = e.key;
    switch (k) {
      case '1':
        return this.emit('gameMode', { mode: 'solo' });
      case '2':
        return this.emit('gameMode', { mode: 'arsenal' });
      case '3':
        return this.emit('gameMode', { mode: 'master' });
      case ' ':
        e.preventDefault();
        return e.repeat ? undefined : this.emit('formation', { dir: 1 });
      case 'ArrowRight':
        e.preventDefault();
        return this.emit('swipe', { axis: 'right', dir: { x: 1, y: 0 } });
      case 'ArrowLeft':
        e.preventDefault();
        return this.emit('swipe', { axis: 'left', dir: { x: -1, y: 0 } });
      case 'ArrowUp':
        e.preventDefault();
        return this.emit('swipe', { axis: 'up', dir: { x: 0, y: 1 } });
      case 'ArrowDown':
        e.preventDefault();
        return this.emit('swipe', { axis: 'down', dir: { x: 0, y: -1 } });
      case 'Tab':
        e.preventDefault();
        return e.repeat ? undefined : this.emit('variant', {});
      default:
    }
    if (e.repeat) return;
    switch (k.toLowerCase()) {
      case 'r':
        return this.emit('reset', {});
      case 'c':
        return this.emit('cinematic', {});
      case 'f':
        return this.emit('fullscreen', {});
      case 'h':
      case '?':
        return this.emit('help', {});
      case 'b':
        return this.emit('preview', {});
      case 'i':
        return this.cycle();
      default:
    }
  }

  enableKeys(v = true) {
    this.keysEnabled = v;
  }

  /* ------------------------------------------------------------------ */
  /* Switching                                                            */
  /* ------------------------------------------------------------------ */

  cycle() {
    const next = INPUT_MODES[(INPUT_MODES.indexOf(this.mode) + 1) % INPUT_MODES.length];
    return this.setMode(next);
  }

  async setMode(mode, { auto = false } = {}) {
    if (!INPUT_MODES.includes(mode)) return false;
    if (mode === this.mode && !this.busy) return true;
    const id = ++this._switchId;

    if (mode === 'camera') return this._enterCamera(id);

    // Choosing something else cancels any camera start in flight.
    if (this.busy) {
      this.busy = false;
      this.emit('busy', { busy: false });
      if (this.camera.status !== 'active') this.camera.stop();
    }
    this._leave(this.mode);
    this._enter(mode, auto);
    return true;
  }

  _leave(mode) {
    if (mode === 'camera') {
      this.tracker.stop();
      this.camera.stop();
      this.gestures.reset();
    } else if (mode === 'mouse') {
      this.mouse.detach();
    } else if (mode === 'demo') {
      this.demo.stop();
      if (this.modeBeforeDemo) {
        this.emit('gameMode', { mode: this.modeBeforeDemo });
        this.modeBeforeDemo = null;
      }
    }
  }

  _enter(mode, auto = false) {
    const previous = this.mode;
    this.mode = mode;
    if (mode === 'mouse') {
      this.mouse.hasMoved = false;
      this.mouse.attach();
    } else if (mode === 'demo') {
      this.modeBeforeDemo = this.getGameMode();
      this.demo.start();
    }
    this.emit('mode', { mode, previous, auto });
  }

  async _enterCamera(id) {
    const previous = this.mode;
    this.busy = true;
    this.cameraIssue = null;
    this.emit('busy', { busy: true, text: 'Requesting camera access…' });

    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: 'timeout', message: 'The camera took too long to start.' }), CAMERA_DEADLINE_MS);
    });
    const result = await Promise.race([this._startCameraPipeline(id), deadline]);
    clearTimeout(timer);

    // Superseded by another choice (e.g. the user clicked MOUSE while waiting)
    if (id !== this._switchId) {
      if (this.mode !== 'camera') this.camera.stop();
      return false;
    }

    this.busy = false;
    this.emit('busy', { busy: false });

    if (!result.ok) {
      this.camera.stop();
      this.tracker.stop();
      this.cameraIssue = result;
      this._leave(previous);
      this._enter('mouse', true);
      this.emit('notify', this._friendlyCameraNotice(result));
      return false;
    }

    this._leave(previous);
    this.gestures.reset();
    this.mode = 'camera';
    this.lastHandsAt = performance.now();
    this.tracker.start();
    this.emit('mode', { mode: 'camera', previous, auto: false });
    return true;
  }

  async _startCameraPipeline(id) {
    const camOk = await this.camera.start();
    if (id !== this._switchId) return { ok: false, reason: 'cancelled' };
    if (!camOk) {
      return { ok: false, reason: this.camera.status, message: this.camera.errorMessage };
    }
    this.emit('busy', { busy: true, text: 'Awakening hand tracking…' });
    const ready = await this.tracker.init();
    if (id !== this._switchId) return { ok: false, reason: 'cancelled' };
    if (!ready) return { ok: false, reason: 'tracker', message: 'The hand-tracking model could not be loaded.' };
    return { ok: true };
  }

  _friendlyCameraNotice(result) {
    const retry = { label: 'Try camera again', run: () => this.setMode('camera') };
    const demo = { label: 'Watch demo', run: () => this.setMode('demo') };
    switch (result.reason) {
      case 'denied':
        return {
          level: 'warn',
          title: 'Camera access was declined',
          text: 'No problem — mouse mode is ready, every sword move works with it. To use hand tracking, allow the camera in your browser’s address bar.',
          actions: [retry, demo],
          timeout: 14000,
        };
      case 'unavailable':
        return {
          level: 'warn',
          title: 'No usable camera found',
          text: `${result.message || 'The camera is unavailable.'} Switched to mouse mode.`,
          actions: [retry, demo],
          timeout: 14000,
        };
      case 'tracker':
        return {
          level: 'warn',
          title: 'Hand tracking could not start',
          text: 'The tracking model failed to load (check your connection). Switched to mouse mode.',
          actions: [retry, demo],
          timeout: 14000,
        };
      case 'timeout':
        return {
          level: 'warn',
          title: 'Camera is taking too long',
          text: 'Switched to mouse mode so you are never stuck waiting.',
          actions: [retry, demo],
          timeout: 14000,
        };
      default:
        return {
          level: 'warn',
          title: 'Camera could not start',
          text: `${result.message || 'Unknown error.'} Switched to mouse mode.`,
          actions: [retry, demo],
          timeout: 14000,
        };
    }
  }

  _onCameraLost() {
    this._leave('camera');
    this._enter('mouse', true);
    this.emit('notify', {
      level: 'warn',
      title: 'Camera disconnected',
      text: 'The camera was unplugged or turned off. Switched to mouse mode — reconnect and try again whenever you like.',
      actions: [{ label: 'Reconnect camera', run: () => this.setMode('camera') }],
      timeout: 14000,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Frame                                                                */
  /* ------------------------------------------------------------------ */

  /** Returns the ControlState of the active input. */
  update(dt, now) {
    switch (this.mode) {
      case 'camera':
        // If the video stalls, let lost hands expire instead of freezing a ghost.
        if (now - this.lastHandsAt > 300) {
          this.gestures.update([], now);
          this.lastHandsAt = now - 200;
        }
        this.state = this.gestures.state;
        break;
      case 'mouse':
        this.state = this.mouse.update(dt);
        break;
      case 'demo':
        this.state = this.demo.update(dt);
        break;
      default:
        this.state.active = false;
        this.state.primary.present = false;
        this.state.secondary.present = false;
        this.state.twoHands = false;
        this.state.label = 'NO INPUT';
    }
    return this.state;
  }
}

function CameraSupport() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}
