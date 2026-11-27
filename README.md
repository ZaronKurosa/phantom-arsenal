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

## Game modes (`1` / `2` / `3` / `4`)

- **SOLO**: one hero sword follows you. Double-click / double-pinch summons a short-lived blade echo.
- **ARSENAL**: the formation of 8 swords orbits the main sword. With two hands the formation splits between them.
- **MASTER**: the formation stays hidden until you summon it, then every animation is available.
- **TRIAL**: an obstacle course. Rings and blocks fly down the chamber toward your lead sword, each labelled with the action it demands.
  - **Ring**: have the sword inside the ring and perform the labelled action just before it reaches you (within about 1 s) to clear it. Wrong move or wrong position costs a shield.
  - **Block**: be in its path and perform the labelled action to shatter it, or steer out of the way to dodge it for a few points. Being in its path without the move costs a shield.
  - 5 shields. The endless **Gauntlet** speeds up every 6 obstacles; **Warm-up** and **Master's Trial** are fixed courses; you can build your own (below). The HUD shows the next obstacle and how to perform its action with your current input.

## Gesture Lab (`G`, or the Lab button, or "Gesture Lab" on the title screen)

A separate full screen with three tabs:

1. **Gestures & keys**: choose which action every hand gesture, mouse click and key triggers (Dash, Spin, Teleport, Swipe, Summon, Cycle/Expand/Collapse formation, Cinematic, Next sword, or any task). Includes three extra hand gestures (grab, release, pinch start; unbound by default), and "+ Bind a new key" to bind any free key. Each row has a Test button. Bindings are saved in the browser's localStorage.
2. **Tasks**: build your own moves as a chain of actions with delays (up to 6 steps), e.g. Teleport → Dash +0.4 s → Spin +0.8 s. Three built-ins (Whirlwind, Blink Strike, Triple Cut) can be copied and edited. A task can be bound to any gesture/key and can be demanded by obstacles in TRIAL.
3. **Trial courses**: build courses obstacle by obstacle (ring/block, required action or task, lane, height, gap), then Save & play.

Fixed keys that cannot be rebound: 1-9, R, Tab, F, H, B, I, G, Q, E, A, D, T, Shift, Esc.

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
| Point with one finger + flick | Dash |
| Two fingers open (index + middle) | Own gesture, unbound by default; bind it in the Gesture Lab |
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
| 1 / 2 / 3 / 4 | SOLO / ARSENAL / MASTER / TRIAL |
| Space | Cycle formation (rebindable) |
| ← → ↑ ↓ | Swipe |
| 5 / 6 / 7 / 8 / 9 | Katana / Greatsword / Left Void Dagger / Right Void Dagger / Twin Void Daggers |
| Tab | Next weapon |
| R | Reset |
| C | Cinematic (rebindable) |
| G | Gesture Lab |
| B / I | Toggle camera preview / cycle input |
| F / H | Fullscreen / help |

## Weapons

Four weapons, each its own procedural model and entry animation (switch with 5-9, Tab, or the ARMORY panel). Choosing one dismisses the current weapon, then plays the new weapon's entry exactly once.

- **Gothic Katana (5)**: black metallic sheath and handle, silver engravings, violet runes, curved blade, purple aura. Selecting it plays the full *Purple Awakening*: 1 Summoning, 2 Rune Awakening, 3 Unsheathing (curved reveal + violet flash), 4 Sheath Dissolution (thousands of particles spiral, then disperse), 5 Final Presentation (idle float, embers, smooth hand-over to your hand).
- **Gothic Greatsword (6)**: large black and silver blade, horned guard, central violet crystal, energy running down the fuller. Rises from the floor with an impact shockwave.
- **Left / Right Void Dagger (7 / 8)**: two *separate* weapons (own model, materials and controller), mirrored hooked blades. Each whirls in from its own side.
- **Twin Void Daggers (9)**: both daggers at once. **Camera:** left hand wields the left dagger and right hand the right one, independently and at the same time; if both move together they sync (glow + arc between them). **Mouse:** no button = mirrored pair, hold left button = right dagger only, hold right button = left dagger only, both = both. Left click = right dagger dashes, right click = left dagger spins.

All of it is procedural (no downloaded assets).

## Architecture

```
src/
  main.js              app wiring, title flow, activation, auto quality
  camera/              CameraManager (getUserMedia, status, timeouts)
  tracking/            HandTracker (MediaPipe, One-Euro smoothing), GestureRecognizer
  input/               InputManager, MouseInput, DemoDirector, ControlState, ActionMap (gesture→action bindings, tasks, courses)
  trial/               ObstacleCourse (TRIAL mode: rings, blocks, judging, scoring)
  scene/               SceneManager (chamber, bloom), LightingManager
  swords/              Sword, SwordFormation, SwordAnimations, SwordController
  weapons/             WeaponRegistry, WeaponManager, WeaponSwitcher, WeaponAnimations, Katana, KatanaAwakening, Greatsword, VoidDagger, TwinDaggerController, WeaponKit, WeaponReveal
  effects/             ParticleSystem (pooled), MagicEffects
  ui/                  UIManager (HUD, panels, toasts), LabScreen (Gesture Lab)
  utils/               MathUtils, Smoothing, Emitter
```

Camera, mouse and demo all produce the same input-agnostic `ControlState`, so the sword code does not know where input comes from.

## Honest limitations

- Tested: all mouse/keyboard/demo paths, TRIAL judging (ring pass/wrong/miss, block smash/hit/dodge, game over, retry), Gesture Lab rebinding, custom tasks, custom keys and custom courses (49 browser checks), mode and input switching, camera failure fallbacks, resizing, and the camera pipeline (fake webcam → WASM + model load → detection loop) in headless Chromium.
- Weapon system (headless Chromium, software GL): old swords fully removed (no references remain); all four models build, register and render; katana awakening plays through every phase to hand-over; greatsword and dagger entries play; switching with 5-9 / Tab (including rapid and mid-animation switches) never shows two weapon models at once and never replays an entry from tracking updates; twin daggers follow their own hand/button independently (synthetic two-hand input, 14 checks); mouse pair scheme (no button / LMB / RMB) verified; no console errors.
- **Not yet verified:** twin-dagger control with real hands (the left/right hand assignment comes from MediaPipe's handedness label, which can swap with mirrored webcams; if the daggers appear on the wrong hands, flip it in `HandTracker`), and the katana awakening's look and frame rate on a real GPU (only measured on a software renderer).
- **Not verified with real hands.** The gesture thresholds (`src/tracking/GestureRecognizer.js`, `CFG`) were checked against synthetic hand skeletons only. Expect to tune them for your camera, lighting and distance.
- The new hand gestures (grab / release / pinch start) are derived from pose changes and were tested with synthetic poses only, like the rest of the camera gestures.
- Frame rate was measured on a software renderer (~20 FPS). On a real GPU it should be much higher; the app lowers quality automatically if FPS stays under ~34.
- The page loads Google Fonts (Cinzel, Inter, JetBrains Mono) and falls back to system fonts offline.
