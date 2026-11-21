import { Emitter } from '../utils/Emitter.js';

/**
 * Owns the getUserMedia stream and the <video> element.
 *
 * status: 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable' | 'disconnected' | 'error'
 *
 * Never hangs: the permission request is raced against a timeout so the app
 * can always fall back to mouse mode.
 */
export class CameraManager extends Emitter {
  constructor(videoEl) {
    super();
    this.video = videoEl;
    this.stream = null;
    this.status = 'idle';
    this.errorMessage = '';
    this.requestTimeoutMs = 20000;
  }

  static isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  _setStatus(status, message = '') {
    this.status = status;
    this.errorMessage = message;
    this.emit('status', { status, message });
  }

  async start() {
    if (this.status === 'active' && this.stream?.active) return true;
    if (!CameraManager.isSupported()) {
      this._setStatus('unavailable', 'This browser does not support camera access (or the page is not served over HTTPS / localhost).');
      return false;
    }

    this._setStatus('requesting');
    try {
      const stream = await this._withTimeout(
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: 'user',
            width: { ideal: 960 },
            height: { ideal: 540 },
            frameRate: { ideal: 60, max: 60 },
          },
        }),
        this.requestTimeoutMs,
      );
      this.stream = stream;
      this.video.srcObject = stream;
      this.video.muted = true;
      this.video.playsInline = true;
      await this._withTimeout(this.video.play(), 6000);

      // Wait for real frames so tracking never starts on a 0x0 video.
      await this._waitForFrames();

      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => this._onTrackEnded());
        track.addEventListener('mute', () => this.emit('muted', true));
        track.addEventListener('unmute', () => this.emit('muted', false));
      }
      this._setStatus('active');
      return true;
    } catch (err) {
      this._releaseStream();
      this._handleStartError(err);
      return false;
    }
  }

  _handleStartError(err) {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      this._setStatus('denied', 'Camera permission was denied.');
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
      this._setStatus('unavailable', 'No camera was found on this device.');
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      this._setStatus('unavailable', 'The camera is busy or in use by another application.');
    } else if (name === 'TimeoutError') {
      this._setStatus('unavailable', 'The camera did not respond in time.');
    } else {
      this._setStatus('error', err?.message || 'Unknown camera error.');
    }
  }

  _onTrackEnded() {
    if (this.status !== 'active') return;
    this._releaseStream();
    this._setStatus('disconnected', 'The camera was disconnected.');
  }

  _waitForFrames() {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const check = () => {
        if (this.video.videoWidth > 0 && this.video.readyState >= 2) return resolve();
        if (performance.now() - t0 > 6000) {
          const e = new Error('No video frames');
          e.name = 'TimeoutError';
          return reject(e);
        }
        requestAnimationFrame(check);
      };
      check();
    });
  }

  _withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const e = new Error('Timed out');
        e.name = 'TimeoutError';
        reject(e);
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  _releaseStream() {
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        try {
          t.stop();
        } catch {
          /* already stopped */
        }
      }
    }
    this.stream = null;
    this.video.srcObject = null;
  }

  stop() {
    this._releaseStream();
    // Keep failure states (denied / unavailable / disconnected) visible in the UI.
    if (this.status === 'active' || this.status === 'requesting') this._setStatus('idle');
  }

  get isActive() {
    return this.status === 'active' && !!this.stream?.active;
  }

  get width() {
    return this.video.videoWidth || 0;
  }
  get height() {
    return this.video.videoHeight || 0;
  }
}
