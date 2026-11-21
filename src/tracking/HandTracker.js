import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { Emitter } from '../utils/Emitter.js';
import { LandmarkSmoother } from '../utils/Smoothing.js';

const CDN_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/** Landmark connections for drawing the skeleton. */
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/**
 * Wraps MediaPipe HandLandmarker.
 *
 * Emits 'hands' every processed frame with an array of tracked hands:
 *   { id, side: 'Left'|'Right', score, landmarks[21] (mirrored, smoothed, 0..1),
 *     world[21] (metric, raw), handSize }
 * Coordinates are in "selfie" space: x grows to the right of the *user's view*.
 */
export class HandTracker extends Emitter {
  constructor(cameraManager, { minConfidence = 0.6 } = {}) {
    super();
    this.camera = cameraManager;
    this.minConfidence = minConfidence;
    this.landmarker = null;
    this.ready = false;
    this.loading = false;
    this.running = false;
    this.delegate = '';
    this.smoothers = new Map(); // keyed by slot (0/1)
    this.lastVideoTime = -1;
    this.lastFrameTs = performance.now();
    this.lastHands = [];
    this.lastSeen = 0;
    this.detectFps = 0;
    this._fpsCount = 0;
    this._fpsT0 = performance.now();
    this._raf = 0;
    this._loop = this._loop.bind(this);
  }

  async init() {
    if (this.ready) return true;
    if (this.loading) return false;
    this.loading = true;
    this.emit('status', { state: 'loading' });
    try {
      const base = import.meta.env.BASE_URL || './';
      const fileset = await FilesetResolver.forVisionTasks(new URL(base + 'wasm', location.href).href);
      const modelCandidates = [new URL(base + 'models/hand_landmarker.task', location.href).href, CDN_MODEL];
      let lastErr = null;

      for (const delegate of ['GPU', 'CPU']) {
        for (const modelAssetPath of modelCandidates) {
          try {
            // Skip a local model path that does not exist (dev server returns index.html).
            if (modelAssetPath.startsWith(location.origin)) {
              const head = await fetch(modelAssetPath, { method: 'HEAD' });
              const type = head.headers.get('content-type') || '';
              if (!head.ok || type.includes('text/html')) continue;
            }
            this.landmarker = await HandLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetPath, delegate },
              runningMode: 'VIDEO',
              numHands: 2,
              minHandDetectionConfidence: this.minConfidence,
              minHandPresenceConfidence: this.minConfidence,
              minTrackingConfidence: 0.5,
            });
            this.delegate = delegate;
            this.ready = true;
            this.loading = false;
            this.emit('status', { state: 'ready', delegate });
            return true;
          } catch (err) {
            lastErr = err;
            console.warn(`[HandTracker] ${delegate} with ${modelAssetPath} failed`, err);
          }
        }
      }
      throw lastErr || new Error('Could not load hand tracking model');
    } catch (err) {
      this.loading = false;
      this.emit('status', { state: 'error', message: err?.message || String(err) });
      return false;
    }
  }

  start() {
    if (!this.ready || this.running) return;
    this.running = true;
    this.lastVideoTime = -1;
    this.lastFrameTs = performance.now();
    this._raf = requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this.lastHands = [];
    for (const s of this.smoothers.values()) s.reset();
    this.emit('hands', []);
  }

  _loop() {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._loop);

    const video = this.camera.video;
    if (!this.camera.isActive || video.readyState < 2 || video.paused) return;
    if (video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrameTs) / 1000);
    this.lastFrameTs = now;

    let result;
    try {
      result = this.landmarker.detectForVideo(video, now);
    } catch (err) {
      console.warn('[HandTracker] detect failed', err);
      return;
    }

    this._fpsCount++;
    if (now - this._fpsT0 >= 1000) {
      this.detectFps = this._fpsCount;
      this._fpsCount = 0;
      this._fpsT0 = now;
    }

    const hands = [];
    const n = result?.landmarks?.length || 0;
    for (let i = 0; i < n; i++) {
      const cat = result.handedness?.[i]?.[0];
      const score = cat?.score ?? 0;
      if (score < this.minConfidence) continue;

      // MediaPipe assumes a mirrored (selfie) input. We feed the raw frame, so the
      // label is inverted with respect to the user's real hand. Swap it back.
      const side = cat?.categoryName === 'Left' ? 'Right' : 'Left';

      // Mirror x so that moving your hand to the right moves it right on screen.
      const raw = result.landmarks[i].map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
      const slot = side === 'Left' ? 0 : 1;
      let sm = this.smoothers.get(slot);
      if (!sm) {
        sm = new LandmarkSmoother();
        this.smoothers.set(slot, sm);
      }
      const landmarks = sm.smooth(raw, dt);
      const world = result.worldLandmarks?.[i] || null;
      hands.push({ id: slot, side, score, landmarks, world, handSize: handSize(landmarks, video) });
    }

    // Reset the smoother for hands that vanished so re-acquisition doesn't lag.
    const present = new Set(hands.map((h) => h.id));
    for (const [slot, sm] of this.smoothers) if (!present.has(slot)) sm.reset();

    if (hands.length) this.lastSeen = now;
    this.lastHands = hands;
    this.emit('hands', hands);
  }

  dispose() {
    this.stop();
    try {
      this.landmarker?.close();
    } catch {
      /* ignore */
    }
    this.landmarker = null;
    this.ready = false;
  }
}

/** Apparent hand size in normalized-screen units: wrist -> middle MCP plus palm width. */
function handSize(lm, video) {
  const aspect = (video.videoWidth || 16) / (video.videoHeight || 9);
  const palm = Math.hypot((lm[0].x - lm[9].x) * aspect, lm[0].y - lm[9].y);
  const width = Math.hypot((lm[5].x - lm[17].x) * aspect, lm[5].y - lm[17].y);
  return (palm + width) * 0.5;
}
