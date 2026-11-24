import * as THREE from 'three';
import { Emitter } from '../utils/Emitter.js';
import { clamp, rand } from '../utils/MathUtils.js';

/**
 * TRIAL mode: rings and blocks fly toward you down the chamber. Each one
 * shows the action it demands. When an obstacle reaches the plane of your lead
 * sword it is judged:
 *
 *   RING   sword inside the ring AND the required action performed just before -> PASS
 *          inside without the action, or outside the ring                     -> shield lost
 *   BLOCK  sword in its path AND required action performed just before        -> SMASH
 *          sword in its path without the action                               -> shield lost
 *          sword clear of the block                                           -> DODGE (small score)
 *
 * "Performed" means the SwordController fired that action (or a custom task
 * containing it) within the last ACTION_WINDOW seconds - whichever input
 * device produced it.
 */

const SPAWN_Z = -19;
const DESPAWN_Z = 6.5;
const ACTION_WINDOW = 0.95;
const MAX_SHIELDS = 5;
const RING_R = 1.2;
const RING_TOL = 1.18; // how far from the ring centre still counts as "through"
const BLOCK_HALF = 0.85;
const BLOCK_TOL = 0.95;
const LANE_X = 3.1;
const LANE_Y = [-1.5, 0.35, 2.2];

const ACTION_COLORS = {
  dash: 0xd7dae6,
  spin: 0xa66bff,
  teleport: 0xe0b3ff,
  swipe: 0xbfc8ff,
  summon: 0x8f7bff,
  formation: 0x9ad0ff,
  expand: 0x9ad0ff,
  collapse: 0x9ad0ff,
  cinematic: 0xffd9a0,
  variant: 0xc7c7d6,
};
const TASK_COLOR = 0xffe9b8;

const ringGeo = new THREE.TorusGeometry(RING_R, 0.11, 14, 56);
const discGeo = new THREE.CircleGeometry(RING_R, 40);
const blockGeo = new THREE.BoxGeometry(BLOCK_HALF * 2, BLOCK_HALF * 2, BLOCK_HALF * 2);
const edgeGeo = new THREE.EdgesGeometry(blockGeo);
const labelCache = new Map();

function labelTexture(text) {
  let t = labelCache.get(text);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 112;
  const g = c.getContext('2d');
  g.font = '600 44px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.roundRect?.(14, 18, 356, 76, 14);
  if (!g.roundRect) g.rect(14, 18, 356, 76);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.fillText(text.toUpperCase(), 192, 58, 340);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  labelCache.set(text, t);
  return t;
}

export class ObstacleCourse extends Emitter {
  constructor({ scene, fx, controller, sm, actionMap, getInputMode }) {
    super();
    this.scene = scene;
    this.fx = fx;
    this.ctl = controller;
    this.sm = sm;
    this.map = actionMap;
    this.getInputMode = getInputMode || (() => 'mouse');

    this.root = new THREE.Group();
    this.root.name = 'trial-course';
    scene.add(this.root);

    this.obstacles = [];
    this.fired = {}; // action id -> time (course clock) it last fired
    this.clock = 0;
    this.active = false;
    this.courseId = 'course:gauntlet';
    this.course = null;
    this.best = 0;
    this.log = []; // judged obstacles (used by tests / debugging)
    this._resetState();

    this.ctl.on('fired', ({ action }) => {
      this.fired[action] = this.clock;
    });
  }

  /* ----------------------------- lifecycle --------------------------- */

  _resetState() {
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.shields = MAX_SHIELDS;
    this.level = 1;
    this.judged = 0;
    this.over = false;
    this.cleared = false;
    this.spawnTimer = 1.8;
    this.itemIndex = 0;
    this.spawned = 0;
    this._lastKey = '';
  }

  setActive(on) {
    if (on === this.active) return;
    this.active = on;
    if (on) this.start(this.courseId);
    else this._clearObstacles();
    this.emit('active', { active: on });
  }

  start(courseId = this.courseId) {
    const course = this.map.getCourse(courseId) || this.map.getCourse('course:gauntlet');
    this.course = course;
    this.courseId = course.id;
    this._clearObstacles();
    this._resetState();
    this.fired = {};
    this.log = [];
    this.emit('state', this.snapshot());
    this.emit('course', { id: course.id, name: course.name });
  }

  restart() {
    this.start(this.courseId);
  }

  _clearObstacles() {
    for (const ob of this.obstacles) this._dispose(ob);
    this.obstacles.length = 0;
  }

  _dispose(ob) {
    this.root.remove(ob.group);
    ob.group.traverse((o) => {
      if (o.material && !o.userData.shared) o.material.dispose?.();
    });
  }

  /* ----------------------------- spawning ---------------------------- */

  get speed() {
    return this.course?.endless ? Math.min(11, 5.4 + (this.level - 1) * 0.65) : 6.2;
  }

  _gauntletPick() {
    const pool = ['dash', 'spin', 'teleport'];
    if (this.level >= 3) for (const t of this.map.allTasks()) if (t.gauntlet) pool.push(t.id);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _spawn(type, action, x, y) {
    if (!this.map.actionExists(action)) action = 'dash';
    const color = ACTION_COLORS[action] ?? TASK_COLOR;
    const group = new THREE.Group();
    group.position.set(x, y, SPAWN_Z);
    let body;

    if (type === 'ring') {
      const mat = new THREE.MeshStandardMaterial({ color: 0x1a1426, emissive: color, emissiveIntensity: 1.9, metalness: 0.6, roughness: 0.35 });
      body = new THREE.Mesh(ringGeo, mat);
      const disc = new THREE.Mesh(
        discGeo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      group.add(disc);
    } else {
      const mat = new THREE.MeshStandardMaterial({ color: 0x0b0910, emissive: color, emissiveIntensity: 0.14, metalness: 0.3, roughness: 0.75, envMapIntensity: 0.3 });
      body = new THREE.Mesh(blockGeo, mat);
      const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color }));
      edges.userData.shared = false;
      group.add(edges);
      const cap = new THREE.Mesh(blockGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false }));
      cap.scale.setScalar(1.02);
      group.add(cap);
    }
    body.userData.body = true;
    group.add(body);

    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(this.map.actionName(action)), transparent: true, depthWrite: false, toneMapped: false }));
    label.userData.shared = false;
    label.scale.set(2.6, 0.76, 1);
    label.position.y = (type === 'ring' ? RING_R : BLOCK_HALF) + 0.85;
    group.add(label);

    group.scale.setScalar(0.01);
    this.root.add(group);
    const ob = { type, action, color, x, y, z: SPAWN_Z, group, body, resolved: false, dying: 0, age: 0 };
    this.obstacles.push(ob);
    this.spawned++;
    return ob;
  }

  _spawnNext() {
    const c = this.course;
    if (c.endless) {
      const type = Math.random() < 0.55 ? 'ring' : 'block';
      const lane = [-1, 0, 1][Math.floor(Math.random() * 3)];
      const h = [0, 1, 2][Math.floor(Math.random() * 3)];
      this._spawn(type, this._gauntletPick(), lane * LANE_X + rand(-0.35, 0.35), LANE_Y[h] + rand(-0.2, 0.2));
      this.spawnTimer = Math.max(1.25, 2.7 - (this.level - 1) * 0.16);
      return;
    }
    const item = c.items[this.itemIndex++];
    this._spawn(item.type, item.action, item.lane * LANE_X, LANE_Y[item.height + 1]);
    const nxt = c.items[this.itemIndex];
    this.spawnTimer = nxt ? nxt.gap : 0;
  }

  /* ------------------------------ judging ---------------------------- */

  _performed(action) {
    const t = this.fired[action];
    return t !== undefined && this.clock - t <= ACTION_WINDOW;
  }

  _judge(ob) {
    const m = this.ctl.main;
    const p = m.pos; // the sword's anchor, not its transient dash offset
    const dx = p.x - ob.x;
    const dy = p.y - ob.y;
    const ok = this._performed(ob.action);
    const name = this.map.actionName(ob.action).toUpperCase();
    let kind;
    let text;
    let good = true;

    if (ob.type === 'ring') {
      const inside = Math.hypot(dx, dy) < RING_TOL;
      if (inside && ok) {
        kind = 'pass';
        text = `RING CLEARED · ${name}`;
      } else if (inside) {
        kind = 'wrong';
        good = false;
        text = `NEEDED ${name}`;
      } else {
        kind = 'miss';
        good = false;
        text = 'MISSED THE RING';
      }
    } else {
      const aligned = Math.abs(dx) < BLOCK_TOL && Math.abs(dy) < BLOCK_TOL;
      if (aligned && ok) {
        kind = 'smash';
        text = `SHATTERED · ${name}`;
      } else if (aligned) {
        kind = 'hit';
        good = false;
        text = `BLOCKED · NEEDED ${name}`;
      } else {
        kind = 'dodge';
        text = 'DODGED';
      }
    }

    this.judged++;
    ob.resolved = true;
    ob.dying = 0.001;
    ob.kind = kind;

    const pos = ob.group.position;
    if (good) {
      const gain = { pass: 100, smash: 150, dodge: 40 }[kind] + (kind === 'dodge' ? 0 : this.combo * 10);
      this.score += gain;
      if (kind !== 'dodge') this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      if (kind === 'smash') {
        this.fx.burst(pos, new THREE.Color(ob.color), 70, 5, 0.16, 1.0);
        this.fx.shockwave(pos, new THREE.Color(ob.color), 4, 0.7);
        this.sm.lighting.pulse(0.6);
        this.sm.shake(0.5);
      } else if (kind === 'pass') {
        this.fx.halo(pos, new THREE.Color(ob.color), 40, RING_R, 3.4, 0.11);
        this.fx.shockwave(pos, new THREE.Color(ob.color), 3.2, 0.6);
        this.sm.lighting.pulse(0.4);
      }
      // the course ramps up every few obstacles
      if (this.course.endless && this.judged % 6 === 0) {
        this.level++;
        text += `  ·  LEVEL ${this.level}`;
      }
    } else {
      this.shields--;
      this.combo = 0;
      this.fx.burst(pos, new THREE.Color(0xff8a9a), 36, 3.4, 0.12, 0.8);
      this.sm.shake(1.1);
      this.sm.lighting.pulse(0.8);
      if (this.shields <= 0) this._end(false);
    }

    this.log.push({ kind, action: ob.action, type: ob.type, ok, dx: +dx.toFixed(2), dy: +dy.toFixed(2) });
    this.best = Math.max(this.best, this.score);
    this.emit('result', { kind, good, text, action: ob.action });
  }

  _end(cleared) {
    this.over = true;
    this.cleared = cleared;
    this.best = Math.max(this.best, this.score);
    this.emit('end', { cleared, score: this.score, best: this.best, bestCombo: this.bestCombo });
  }

  /* ------------------------------ frame ------------------------------ */

  update(dt, time) {
    if (!this.active || !this.course) return;
    this.clock += dt;
    const sz = this.ctl.main.pos.z;
    const speed = this.speed;

    if (!this.over) {
      this.spawnTimer -= dt;
      const more = this.course.endless || this.itemIndex < this.course.items.length;
      if (more && this.spawnTimer <= 0) this._spawnNext();
    }

    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const ob = this.obstacles[i];
      ob.age += dt;
      if (!ob.resolved) {
        ob.z += (this.over ? speed * 0.25 : speed) * dt;
        ob.group.position.z = ob.z;
        ob.group.scale.setScalar(clamp((ob.z - SPAWN_Z) / 3.5, 0.01, 1));
        if (ob.type === 'ring') ob.body.rotation.z += dt * 0.6;
        else ob.group.rotation.z = Math.sin(ob.age * 1.3 + ob.x) * 0.05;
        if (!this.over && ob.z >= sz) this._judge(ob);
      }
      if (ob.dying > 0) {
        // resolved obstacles swell and fade out
        ob.dying += dt;
        const k = clamp(ob.dying / 0.45, 0, 1);
        ob.group.scale.setScalar(1 + k * (ob.kind === 'smash' ? 0.3 : 0.6));
        ob.group.traverse((o) => {
          const mat = o.material;
          if (mat && 'opacity' in mat) {
            mat.transparent = true;
            mat.opacity = Math.min(mat.opacity, 1 - k) ;
          }
        });
        if (k >= 1) {
          this._dispose(ob);
          this.obstacles.splice(i, 1);
          continue;
        }
        ob.z += speed * dt;
        ob.group.position.z = ob.z;
      }
      if (ob.z > DESPAWN_Z) {
        this._dispose(ob);
        this.obstacles.splice(i, 1);
      }
    }

    // finite course: done when everything spawned and judged
    if (!this.over && !this.course.endless && this.itemIndex >= this.course.items.length && !this.obstacles.some((o) => !o.resolved)) {
      this._end(true);
    }

    const snap = this.snapshot();
    const key = JSON.stringify(snap);
    if (key !== this._lastKey) {
      this._lastKey = key;
      this.emit('state', snap);
    }
  }

  /** The next unresolved obstacle (closest to the sword plane). */
  nextObstacle() {
    let best = null;
    for (const ob of this.obstacles) if (!ob.resolved && (!best || ob.z > best.z)) best = ob;
    return best;
  }

  snapshot() {
    const nxt = this.nextObstacle();
    const device = this.getInputMode();
    return {
      course: this.course?.name || '',
      courseId: this.courseId,
      endless: !!this.course?.endless,
      score: this.score,
      combo: this.combo,
      shields: this.shields,
      maxShields: MAX_SHIELDS,
      level: this.level,
      best: this.best,
      over: this.over,
      cleared: this.cleared,
      progress: this.course && !this.course.endless ? `${Math.min(this.judged, this.course.items.length)}/${this.course.items.length}` : '',
      next: nxt
        ? { type: nxt.type, action: nxt.action, name: this.map.actionName(nxt.action), hint: this.map.hintFor(nxt.action, device) }
        : null,
    };
  }
}
