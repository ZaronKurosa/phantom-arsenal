import './styles.css';
import { SceneManager } from './scene/SceneManager.js';
import { ParticleSystem } from './effects/ParticleSystem.js';
import { MagicEffects } from './effects/MagicEffects.js';
import { Sword } from './swords/Sword.js';
import { SwordController } from './swords/SwordController.js';
import { CameraManager } from './camera/CameraManager.js';
import { HandTracker } from './tracking/HandTracker.js';
import { GestureRecognizer } from './tracking/GestureRecognizer.js';
import { InputManager } from './input/InputManager.js';
import { UIManager } from './ui/UIManager.js';
import { lerp } from './utils/MathUtils.js';

const FORWARDED_EVENTS = ['dash', 'swipe', 'spin', 'teleport', 'cinematic', 'summon', 'formation', 'reset', 'variant'];

class App {
  constructor() {
    this.ui = new UIManager();
    this.sm = new SceneManager(this.ui.el.stage);
    this.particles = new ParticleSystem(2600);
    this.sm.scene.add(this.particles.points);
    this.sm.onViewport = (h, fov, pr) => {
      this.particles.setViewport(h, fov, pr);
      Sword.setViewport(h, fov, pr);
    };
    this.sm.resize();

    this.fx = new MagicEffects(this.sm.scene, this.particles, this.sm);
    this.controller = new SwordController(this.sm, this.fx);

    this.camera = new CameraManager(this.ui.el.camVideo);
    this.tracker = new HandTracker(this.camera);
    this.gestures = new GestureRecognizer();
    this.input = new InputManager({
      camera: this.camera,
      tracker: this.tracker,
      gestures: this.gestures,
      mouseTarget: this.ui.el.stage,
      getGameMode: () => this.controller.mode,
    });

    this.started = false;
    this.activated = false;
    this.time = 0;
    this.last = performance.now();
    this.exposure = 0.5;
    this.lowFpsTime = 0;
    this.state = this.input.state;

    this._wire();
    this.controller.setMode('arsenal', { announce: false }); // atmospheric backdrop for the title screen
    this.ui.setGameMode('arsenal');
    this.ui.setVariant('mixed');
    this.ui.setCameraStatus('idle');
    this.ui.setInputMode('none', this.input.available);
    this.ui.setTracking('—');
    this.ui.setVeil(true);

    requestAnimationFrame((t) => this._frame(t));
  }

  /* ------------------------------------------------------------------ */

  _wire() {
    const { ui, input, controller, camera, tracker } = this;

    ui.on('start', ({ input: mode }) => this.start(mode));
    ui.on('input', ({ mode }) => this.selectInput(mode));
    ui.on('gameMode', ({ mode }) => this.setGameMode(mode));
    ui.on('variant', ({ choice }) => controller.setVariantChoice(choice));
    ui.on('reset', () => controller.reset());

    input.on('gameMode', ({ mode }) => this.setGameMode(mode));
    for (const name of FORWARDED_EVENTS) {
      input.on(name, (payload) => {
        if (!this.started) return;
        controller.trigger(name, payload || {});
      });
      ui.on(name, () => {});
    }
    input.on('fullscreen', () => ui.toggleFullscreen());
    input.on('help', () => ui.toggleHelp());
    input.on('preview', () => ui.togglePreview());
    input.on('notify', (n) => ui.toast(n));
    input.on('busy', ({ text }) => {
      if (text) this._busyText = text;
      this._syncGuide();
    });
    input.on('mode', ({ mode, auto }) => {
      ui.setInputMode(mode, input.available);
      if (mode === 'mouse' || mode === 'demo') this.activate();
      if (mode === 'mouse' && auto) ui.toggleHelp(true);
      this._syncGuide();
    });

    controller.on('action', ({ name }) => ui.flashAction(name));
    controller.on('formation', ({ name }) => ui.setFormation(name));
    controller.on('variant', ({ choice }) => ui.setVariant(choice));
    controller.on('mode', ({ mode }) => {
      ui.setGameMode(mode);
      ui.setFormation(mode === 'solo' ? '' : controller.formation.type.name);
    });

    camera.on('status', ({ status, message }) => ui.setCameraStatus(status, message));
    tracker.on('hands', (hands) => {
      if (input.mode === 'camera') ui.drawHands(hands, camera.video);
    });
    tracker.on('status', ({ state }) => {
      if (state === 'loading') ui.setGuideText('Loading the hand-tracking model…');
    });
  }

  /* ------------------------------------------------------------------ */

  async start(inputMode = 'camera') {
    if (this.started) return;
    this.started = true;
    this.ui.hideTitle();
    this.input.enableKeys(true);
    if (inputMode === 'camera') {
      this.ui.showGuide(true, { title: 'Awakening the arsenal…', text: 'Requesting camera access…', steps: false });
      await this.input.setMode('camera'); // falls back to mouse automatically on any failure
    } else {
      await this.input.setMode(inputMode);
    }
    this._syncGuide();
  }

  async selectInput(mode) {
    if (!this.started) {
      this.start(mode);
      return;
    }
    await this.input.setMode(mode);
    this._syncGuide();
  }

  setGameMode(mode) {
    this.controller.setMode(mode);
    this.ui.setGameMode(mode);
    if (mode !== 'solo') this.ui.setFormation(this.controller.formation.type.name);
  }

  /** Wake the chamber: lift the veil, show the HUD, settle into SOLO. */
  activate() {
    if (this.activated) return;
    this.activated = true;
    this.ui.showHud(true);
    this.ui.setVeil(false);
    this.ui.showGuide(false);
    if (this.input.mode !== 'demo') this.setGameMode('solo');
    this.ui.setVariant(this.controller.variantChoice);
  }

  _syncGuide() {
    const { input, ui } = this;
    const waitingForHand = input.mode === 'camera' && !this.activated;
    if (input.busy) {
      ui.showGuide(true, { title: 'Awakening the arsenal…', text: this._busyText || 'Requesting camera access…', steps: false });
    } else if (waitingForHand) {
      ui.showGuide(true, {
        title: 'Show me your hand',
        text: 'Raise one hand into view. The chamber awakens when I can see it.',
        steps: true,
      });
    } else {
      ui.showGuide(false);
    }
  }

  /* ------------------------------------------------------------------ */

  _frame(nowMs) {
    requestAnimationFrame((t) => this._frame(t));
    const dt = Math.min(0.05, Math.max(0.0005, (nowMs - this.last) / 1000));
    this.last = nowMs;
    this.time += dt;

    const { input, controller, fx, particles, sm, ui } = this;

    Sword.tick(this.time);
    const state = input.update(dt, nowMs);
    this.state = state;

    // Camera mode: the chamber wakes as soon as a hand is tracked.
    if (!this.activated && input.mode === 'camera' && state.active) this.activate();

    controller.update(dt, this.time, state);
    fx.update(dt);
    particles.update(dt);
    sm.update(dt, controller.main.group.position, controller.main.glow);

    this.exposure = lerp(this.exposure, this.activated ? 1.05 : 0.6, 1 - Math.exp(-2.5 * dt));
    sm.renderer.toneMappingExposure = this.exposure;
    sm.render();

    this._updateHud(dt, state);
    this._adaptQuality(dt);
  }

  _updateHud(dt, state) {
    const { ui, input, controller } = this;
    ui.tickFps(dt, this.sm.quality);
    ui.setGesture(state.label || '—');
    ui.setSwordCount(controller.activeCount);
    ui.setCursor(state, input.mode);

    switch (input.mode) {
      case 'camera':
        if (!this.tracker.ready) ui.setTracking('LOADING', 'warn');
        else if (state.twoHands) ui.setTracking('2 HANDS', 'ok');
        else if (state.active) ui.setTracking('1 HAND', 'ok');
        else ui.setTracking('SEARCHING…', 'warn');
        break;
      case 'mouse':
        ui.setTracking('MOUSE', 'ok');
        break;
      case 'demo':
        ui.setTracking('GHOST HAND', 'ok');
        break;
      default:
        ui.setTracking('—');
    }
  }

  /** Step quality down if the frame rate stays low (never up, to avoid flapping). */
  _adaptQuality(dt) {
    if (!this.activated) return;
    const fps = this.ui.fps || 60;
    if (fps < 34) this.lowFpsTime += dt;
    else this.lowFpsTime = Math.max(0, this.lowFpsTime - dt * 2);
    if (this.lowFpsTime > 3 && this.sm.quality > 0) {
      this.sm.setQuality(this.sm.quality - 1);
      this.lowFpsTime = 0;
      this.ui.toast({ level: 'info', text: `Frame rate was low — visual quality reduced to ${['LOW', 'MEDIUM', 'HIGH'][this.sm.quality]}.`, timeout: 3500 });
    }
  }
}

const app = new App();
window.__phantom = app; // handy for debugging in the console
