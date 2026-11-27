import { Emitter } from '../utils/Emitter.js';

/**
 * The player's "profile": which physical gesture / button triggers which
 * action, the custom tasks (action sequences) they created, and their
 * obstacle courses. Persisted in localStorage (best effort).
 *
 *   trigger  = something the player physically does   ("mouse.click", "cam.flick", "key.g")
 *   action   = something the swords do                ("dash", "spin", "task:whirlwind")
 */

const STORE_KEY = 'phantom-arsenal.profile.v1';

export const ACTIONS = [
  { id: 'dash', name: 'Dash', desc: 'Lunge forward' },
  { id: 'spin', name: 'Spin', desc: 'Whirl the blade(s)' },
  { id: 'teleport', name: 'Teleport', desc: 'Vanish and reappear at the pointer' },
  { id: 'swipe', name: 'Swipe', desc: 'Next formation (SOLO / TRIAL: dash)' },
  { id: 'summon', name: 'Summon / recall', desc: 'Call or dismiss the formation' },
  { id: 'formation', name: 'Cycle formation', desc: 'Halo, Fan, Orbit, Wings, Helix' },
  { id: 'expand', name: 'Expand formation', desc: 'Spread the swords out' },
  { id: 'collapse', name: 'Collapse formation', desc: 'Pull the swords in' },
  { id: 'cinematic', name: 'Cinematic', desc: 'The 5-second crown-of-blades sequence' },
  { id: 'variant', name: 'Next weapon', desc: 'Cycle Katana / Greatsword / Left dagger / Right dagger / Twin daggers' },
];

/** Every physical trigger the app can detect. `short` is the label used in hints. */
export const TRIGGERS = [
  // camera (hand) gestures
  { id: 'cam.flick', group: 'camera', name: 'Point & flick', short: 'Point-flick', desc: 'Point with one finger (index only) and flick fast', def: 'dash' },
  { id: 'cam.twoFingers', group: 'camera', name: 'Two fingers open', short: 'Two fingers', desc: 'Hold up index + middle finger, the others closed', def: null },
  { id: 'cam.wristSpin', group: 'camera', name: 'Fast wrist twist', short: 'Wrist twist', desc: 'Rotate the wrist quickly', def: 'spin' },
  { id: 'cam.pinchRelease', group: 'camera', name: 'Pinch, then release', short: 'Pinch-release', desc: 'Pinch, move, open the fingers', def: 'teleport' },
  { id: 'cam.swipe', group: 'camera', name: 'Open-palm swipe', short: 'Palm swipe', desc: 'Sweep an open hand sideways', def: 'swipe' },
  { id: 'cam.twoPalms', group: 'camera', name: 'Both palms open (hold)', short: 'Two palms', desc: 'Hold both open hands up for half a second', def: 'cinematic' },
  { id: 'cam.grab', group: 'camera', name: 'Open palm → fist (grab)', short: 'Grab', desc: 'Close an open hand into a fist', def: null },
  { id: 'cam.release', group: 'camera', name: 'Fist → open palm (release)', short: 'Release', desc: 'Open a closed fist', def: null },
  { id: 'cam.pinchStart', group: 'camera', name: 'Pinch start', short: 'Pinch', desc: 'Touch thumb and index finger together', def: null },
  // mouse
  { id: 'mouse.click', group: 'mouse', name: 'Left click', short: 'Click', desc: 'Quick tap of the left button', def: 'dash' },
  { id: 'mouse.doubleClick', group: 'mouse', name: 'Double-click', short: 'Double-click', desc: 'Two quick taps', def: 'summon' },
  { id: 'mouse.rightClick', group: 'mouse', name: 'Right click', short: 'Right-click', desc: 'Right mouse button', def: 'spin' },
  { id: 'mouse.middleClick', group: 'mouse', name: 'Middle click', short: 'Middle-click', desc: 'Wheel button', def: 'cinematic' },
  { id: 'mouse.shiftRelease', group: 'mouse', name: 'Hold Shift, then release', short: 'Shift-release', desc: 'Precision mode, then let go', def: 'teleport' },
  // keyboard
  { id: 'key.Space', group: 'keyboard', name: 'Space', short: 'Space', desc: '', def: 'formation' },
  { id: 'key.ArrowLeft', group: 'keyboard', name: 'Arrow ←', short: '←', desc: '', def: 'swipe' },
  { id: 'key.ArrowRight', group: 'keyboard', name: 'Arrow →', short: '→', desc: '', def: 'swipe' },
  { id: 'key.ArrowUp', group: 'keyboard', name: 'Arrow ↑', short: '↑', desc: '', def: 'swipe' },
  { id: 'key.ArrowDown', group: 'keyboard', name: 'Arrow ↓', short: '↓', desc: '', def: 'swipe' },
  { id: 'key.c', group: 'keyboard', name: 'Key C', short: 'C', desc: '', def: 'cinematic' },
];

/** Keys the app itself needs; they cannot be rebound. */
const RESERVED_KEYS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'r', 'i', 'f', 'h', 'b', 'g', 'q', 'e', 'a', 'd', 't', 'tab', 'escape', 'shift', 'control', 'alt', 'meta', 'capslock', 'dead']);

const BUILTIN_TASKS = [
  { id: 'task:whirlwind', name: 'Whirlwind', builtin: true, gauntlet: true, steps: [{ action: 'spin', delay: 0 }, { action: 'dash', delay: 0.5 }] },
  { id: 'task:blink-strike', name: 'Blink Strike', builtin: true, gauntlet: true, steps: [{ action: 'teleport', delay: 0 }, { action: 'dash', delay: 0.5 }] },
  { id: 'task:triple-cut', name: 'Triple Cut', builtin: true, gauntlet: true, steps: [{ action: 'dash', delay: 0 }, { action: 'dash', delay: 0.3 }, { action: 'dash', delay: 0.6 }] },
];

const it = (type, action, lane, height, gap = 2.4) => ({ type, action, lane, height, gap });
const BUILTIN_COURSES = [
  { id: 'course:gauntlet', name: 'Gauntlet (endless)', builtin: true, endless: true, items: [] },
  {
    id: 'course:warmup',
    name: 'Warm-up',
    builtin: true,
    items: [
      it('ring', 'spin', 0, 0, 1.2),
      it('block', 'dash', 1, 0, 2.6),
      it('ring', 'dash', -1, 1, 2.6),
      it('block', 'spin', 0, -1, 2.6),
      it('ring', 'spin', 1, 1, 2.4),
      it('ring', 'teleport', -1, 0, 2.4),
      it('block', 'dash', 0, 0, 2.2),
      it('ring', 'dash', 0, 1, 2.2),
    ],
  },
  {
    id: 'course:masters',
    name: "Master's Trial",
    builtin: true,
    items: [
      it('ring', 'task:whirlwind', 0, 0, 1.4),
      it('block', 'task:blink-strike', -1, 0, 3),
      it('ring', 'task:triple-cut', 1, 1, 3),
      it('block', 'spin', 0, -1, 2.4),
      it('ring', 'teleport', -1, 1, 2.4),
      it('block', 'task:whirlwind', 1, 0, 2.8),
      it('ring', 'task:blink-strike', 0, 0, 2.8),
      it('block', 'task:triple-cut', 0, 1, 3),
    ],
  },
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'task';

export class ActionMap extends Emitter {
  constructor() {
    super();
    this.bindings = {}; // trigger id -> action id | null   (overrides of the defaults)
    this.customKeys = []; // extra keyboard triggers: [{ id: 'key.g', key: 'g' }]
    this.customTasks = [];
    this.customCourses = [];
    this._load();
  }

  /* ------------------------------ lookup ----------------------------- */

  triggers() {
    const custom = this.customKeys.map((k) => ({
      id: k.id,
      group: 'keyboard',
      name: `Key ${k.key.length === 1 ? k.key.toUpperCase() : k.key}`,
      short: k.key.length === 1 ? k.key.toUpperCase() : k.key,
      desc: 'Custom key',
      def: null,
      custom: true,
    }));
    return [...TRIGGERS, ...custom];
  }

  getTrigger(id) {
    return this.triggers().find((t) => t.id === id) || null;
  }

  hasTrigger(id) {
    return TRIGGERS.some((t) => t.id === id) || this.customKeys.some((k) => k.id === id);
  }

  allTasks() {
    return [...BUILTIN_TASKS, ...this.customTasks];
  }

  getTask(id) {
    return this.allTasks().find((t) => t.id === id) || null;
  }

  actionExists(id) {
    return ACTIONS.some((a) => a.id === id) || !!this.getTask(id);
  }

  actionName(id) {
    if (!id) return 'None';
    return ACTIONS.find((a) => a.id === id)?.name || this.getTask(id)?.name || id;
  }

  /** Everything a trigger can be bound to (base actions first, then tasks). */
  actionChoices() {
    return [...ACTIONS.map((a) => ({ id: a.id, name: a.name, desc: a.desc })), ...this.allTasks().map((t) => ({ id: t.id, name: `Task · ${t.name}`, desc: `${t.steps.length} steps` }))];
  }

  /** Action fired by a trigger (null = unbound). */
  resolve(triggerId) {
    let v;
    if (Object.prototype.hasOwnProperty.call(this.bindings, triggerId)) v = this.bindings[triggerId];
    else v = TRIGGERS.find((t) => t.id === triggerId)?.def ?? null;
    return v && this.actionExists(v) ? v : null;
  }

  /** Trigger ids that currently fire this action. */
  triggersFor(actionId) {
    return this.triggers().filter((t) => this.resolve(t.id) === actionId);
  }

  /** Short human hint for how to perform an action with the given input device. */
  hintFor(actionId, device) {
    const want = device === 'camera' ? ['camera'] : device === 'mouse' ? ['mouse', 'keyboard'] : ['camera', 'mouse', 'keyboard'];
    const hits = this.triggersFor(actionId).filter((t) => want.includes(t.group));
    if (hits.length) return hits.slice(0, 2).map((t) => t.short).join(' / ');
    // a task made of this action can also satisfy it
    return device === 'demo' ? '' : 'not bound';
  }

  /* ----------------------------- bindings ---------------------------- */

  setBinding(triggerId, actionId) {
    if (!this.hasTrigger(triggerId)) return false;
    const def = TRIGGERS.find((t) => t.id === triggerId)?.def ?? null;
    const v = actionId || null;
    if (v === def) delete this.bindings[triggerId];
    else this.bindings[triggerId] = v;
    this._changed();
    return true;
  }

  addKeyTrigger(rawKey) {
    const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;
    if (RESERVED_KEYS.has(key.toLowerCase())) return { ok: false, reason: `"${rawKey}" is used by the app itself.` };
    const id = `key.${key === ' ' ? 'Space' : key}`;
    if (this.hasTrigger(id)) return { ok: false, reason: 'That key already has a binding row.', id };
    this.customKeys.push({ id, key });
    this._changed();
    return { ok: true, id };
  }

  removeKeyTrigger(id) {
    this.customKeys = this.customKeys.filter((k) => k.id !== id);
    delete this.bindings[id];
    this._changed();
  }

  resetBindings() {
    this.bindings = {};
    this.customKeys = [];
    this._changed();
  }

  /* ------------------------------ tasks ------------------------------ */

  /** Create or overwrite a custom task. Returns the saved task. */
  saveTask({ id, name, steps, gauntlet = true }) {
    const clean = steps
      .filter((s) => ACTIONS.some((a) => a.id === s.action))
      .map((s) => ({ action: s.action, delay: Math.max(0, Math.min(5, Number(s.delay) || 0)) }));
    if (!clean.length) return null;
    const title = (name || '').trim().slice(0, 28) || 'New task';
    let task = id ? this.customTasks.find((t) => t.id === id) : null;
    if (task) {
      Object.assign(task, { name: title, steps: clean, gauntlet });
    } else {
      let nid = `task:${slug(title)}`;
      let n = 2;
      while (this.getTask(nid)) nid = `task:${slug(title)}-${n++}`;
      task = { id: nid, name: title, builtin: false, gauntlet, steps: clean };
      this.customTasks.push(task);
    }
    this._changed();
    return task;
  }

  removeTask(id) {
    const t = this.customTasks.find((x) => x.id === id);
    if (!t) return false;
    this.customTasks = this.customTasks.filter((x) => x.id !== id);
    for (const k of Object.keys(this.bindings)) if (this.bindings[k] === id) delete this.bindings[k];
    this._changed();
    return true;
  }

  /* ----------------------------- courses ----------------------------- */

  allCourses() {
    return [...BUILTIN_COURSES, ...this.customCourses];
  }

  getCourse(id) {
    return this.allCourses().find((c) => c.id === id) || null;
  }

  saveCourse({ id, name, items }) {
    const clean = items.map((o) => ({
      type: o.type === 'block' ? 'block' : 'ring',
      action: this.actionExists(o.action) ? o.action : 'dash',
      lane: Math.max(-1, Math.min(1, Math.round(Number(o.lane) || 0))),
      height: Math.max(-1, Math.min(1, Math.round(Number(o.height) || 0))),
      gap: Math.max(1, Math.min(8, Number(o.gap) || 2.4)),
    }));
    if (!clean.length) return null;
    const title = (name || '').trim().slice(0, 28) || 'My course';
    let course = id ? this.customCourses.find((c) => c.id === id) : null;
    if (course) {
      Object.assign(course, { name: title, items: clean });
    } else {
      let cid = `course:${slug(title)}`;
      let n = 2;
      while (this.getCourse(cid)) cid = `course:${slug(title)}-${n++}`;
      course = { id: cid, name: title, builtin: false, items: clean };
      this.customCourses.push(course);
    }
    this._changed();
    return course;
  }

  removeCourse(id) {
    const before = this.customCourses.length;
    this.customCourses = this.customCourses.filter((c) => c.id !== id);
    if (this.customCourses.length !== before) this._changed();
    return this.customCourses.length !== before;
  }

  /* --------------------------- persistence --------------------------- */

  _changed() {
    this._save();
    this.emit('change', {});
  }

  _save() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ bindings: this.bindings, customKeys: this.customKeys, tasks: this.customTasks, courses: this.customCourses }),
      );
    } catch {
      /* storage unavailable: the profile just lives for this session */
    }
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.bindings && typeof d.bindings === 'object') this.bindings = d.bindings;
      if (Array.isArray(d.customKeys)) this.customKeys = d.customKeys.filter((k) => k && typeof k.id === 'string' && typeof k.key === 'string');
      if (Array.isArray(d.tasks)) this.customTasks = d.tasks.filter((t) => t && t.id && Array.isArray(t.steps));
      if (Array.isArray(d.courses)) this.customCourses = d.courses.filter((c) => c && c.id && Array.isArray(c.items));
    } catch {
      /* corrupt or unavailable: start from defaults */
    }
  }
}
