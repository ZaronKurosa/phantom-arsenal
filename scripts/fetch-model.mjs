// Prepares the runtime assets MediaPipe needs so the app works fully offline:
//   1. copies the WASM runtime from node_modules into public/wasm
//   2. downloads the Hand Landmarker model into public/models
// Neither step can fail the build: if the model download is not possible the
// app falls back to loading it from Google's CDN at runtime.
import { existsSync, mkdirSync, writeFileSync, statSync, copyFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// 1. WASM runtime
try {
  const src = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
  const dst = join(root, 'public/wasm');
  if (existsSync(src)) {
    mkdirSync(dst, { recursive: true });
    let copied = 0;
    for (const f of readdirSync(src)) {
      const to = join(dst, f);
      if (!existsSync(to) || statSync(to).size !== statSync(join(src, f)).size) {
        copyFileSync(join(src, f), to);
        copied++;
      }
    }
    console.log(copied ? `[setup] copied ${copied} MediaPipe WASM file(s) to public/wasm` : '[setup] MediaPipe WASM already in place');
  } else {
    console.warn('[setup] node_modules/@mediapipe/tasks-vision not found - run "npm install" first');
  }
} catch (err) {
  console.warn('[setup] could not copy WASM files:', err.message);
}

// 2. Model
const out = join(root, 'public/models/hand_landmarker.task');
try {
  if (existsSync(out) && statSync(out).size > 1_000_000) {
    console.log('[setup] hand_landmarker.task already present');
  } else {
    mkdirSync(dirname(out), { recursive: true });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch(MODEL_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1_000_000) throw new Error('unexpectedly small file');
    writeFileSync(out, buf);
    console.log('[setup] saved hand_landmarker.task (' + (buf.length / 1e6).toFixed(1) + ' MB)');
  }
} catch (err) {
  console.warn('[setup] could not download the model (' + err.message + ').');
  console.warn('[setup] The app will fetch it from the CDN at runtime instead.');
}
process.exit(0);
