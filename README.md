# PHANTOM ARSENAL

Command a legion of enchanted flying swords with your bare hands, through your webcam, in a real-time 3D gothic chamber. No webcam? Drive the same swords with your mouse, or let the built-in DEMO play.

Stack: Three.js (WebGL, bloom post-processing, procedural geometry) · MediaPipe Hand Landmarker · vanilla JS modules · Vite.
All camera processing happens locally in your browser. No video ever leaves your machine.

## Run it

```bash
npm install        # also copies the MediaPipe WASM and downloads the hand model (postinstall)
npm run dev        # open the printed localhost URL (Chrome / Edge recommended)
```

Other scripts: `npm run build`, `npm run preview`, `npm run setup` (re-run the asset step).

`getUserMedia` needs a secure context: `localhost` works, a plain-HTTP LAN address does not.
If the model download is blocked during install, the app fetches the model from Google's CDN at runtime instead.

## Input modes

Switch any time from the top bar or with `I`. The swords, mode and formation are preserved when you switch.

| Input | What it is |
|---|---|
| **CAMERA** | MediaPipe hand tracking. Asked for only after you click Start. |
| **MOUSE** | Full alternative; every game mode and animation is reachable. |
| **DEMO** | A scripted ~52 s loop through all modes, formations and the cinematic. No input required. |

If the camera is denied, missing, disconnected or too slow to start (30 s), the app says so and offers/switches to mouse. It never sits on a loading screen.

## Game modes (`1` / `2` / `3`)

- **SOLO**: one hero sword follows you. Double-click / double-pinch summons a short-lived blade echo.
- **ARSENAL**: the formation of 8 swords orbits the main sword. With two hands the formation splits between them.
- **MASTER**: the formation stays hidden until you summon it, then every animation is available.

## Camera gestures

| Gesture | Effect |
|---|---|
| Move hand | Sword follows (hand size = depth, wrist roll = blade roll) |
| Open palm | Hover |
| Fist | Follow tightly |
| Pinch | Precision control; release = teleport |
| Open palm (from nothing) | Summon formation |
| Spread / close fingers | Expand / collapse formation |
| Swipe | Next formation (Halo, Crescent Fan, Orbit, Wings, Helix) |
| Quick flick | Dash |
| Wrist spin | Spin blades |
| Both open palms held up for ~0.5 s | Cinematic sequence |

## Mouse & keyboard

| Control | Effect |
|---|---|
| Move | Sword follows cursor |
| Wheel | Depth |
| Hold left button | Fist / follow |
| Click | Dash toward the cursor |
| Double-click | Summon (echo in SOLO) |
| Right button | Spin |
| Middle button | Cinematic |
| Shift (hold, release) | Pinch / teleport |
| Q / E | Close / spread formation |
| A / D | Roll |
| T | Twin hands (two-hand mode) |
| 1 / 2 / 3 | SOLO / ARSENAL / MASTER |
| Space | Cycle formation |
| ← → ↑ ↓ | Swipe |
| Tab | Next sword variant |
| R | Reset |
| C | Cinematic |
| B / I | Toggle camera preview / cycle input |
| F / H | Fullscreen / help |

Sword variants: **Nightfang** (broadsword), **Crescent Wraith** (curved reaper blade), **Requiem** (greatsword). All are procedural meshes: black metal blade, silver edges, gothic guard, violet rune glow, core, orbiting motes.

## Architecture

```
src/
  main.js              app wiring, title flow, activation, auto quality
  camera/              CameraManager (getUserMedia, status, timeouts)
  tracking/            HandTracker (MediaPipe, One-Euro smoothing), GestureRecognizer
  input/               InputManager, MouseInput, DemoDirector, ControlState
  scene/               SceneManager (chamber, bloom), LightingManager
  swords/              SwordGeometry, Sword, SwordFormation, SwordAnimations, SwordController
  effects/             ParticleSystem (pooled), MagicEffects
  ui/                  UIManager (HUD, panels, toasts)
  utils/               MathUtils, Smoothing, Emitter
```

Camera, mouse and demo all produce the same input-agnostic `ControlState`, so the sword code does not know where input comes from.

## Honest limitations

- Tested: all mouse/keyboard/demo paths, mode and input switching, camera failure fallbacks, resizing, and the camera pipeline (fake webcam → WASM + model load → detection loop) in headless Chromium.
- **Not verified with real hands.** The gesture thresholds (`src/tracking/GestureRecognizer.js`, `CFG`) were checked against synthetic hand skeletons only. Expect to tune them for your camera, lighting and distance.
- Frame rate was measured on a software renderer (~20 FPS). On a real GPU it should be much higher; the app lowers quality automatically if FPS stays under ~34.
- The page loads Google Fonts (Cinzel, Inter, JetBrains Mono) and falls back to system fonts offline.
