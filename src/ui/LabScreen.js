import { Emitter } from '../utils/Emitter.js';
import { ACTIONS } from '../input/ActionMap.js';

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};

const GROUPS = [
  { id: 'camera', title: 'HAND GESTURES', sub: 'Camera mode. What each hand movement does.' },
  { id: 'mouse', title: 'MOUSE', sub: 'Mouse mode. What each click does.' },
  { id: 'keyboard', title: 'KEYBOARD', sub: 'Works in every mode except DEMO. Bind any free key to any action or task.' },
];
const LANES = [['-1', 'Left'], ['0', 'Centre'], ['1', 'Right']];
const HEIGHTS = [['-1', 'Low'], ['0', 'Middle'], ['1', 'High']];

/**
 * "Gesture Lab": a full screen to
 *   1. change which gesture / click / key triggers which action,
 *   2. build custom tasks (sequences of actions) and bind them like any action,
 *   3. design obstacle courses for TRIAL mode and play them.
 *
 * Emits: 'close', 'test' {action}, 'play' {courseId}
 */
export class LabScreen extends Emitter {
  constructor(map, root) {
    super();
    this.map = map;
    this.root = root;
    this.tab = 'bindings';
    this.recording = false;
    this.msgText = '';
    this.msgKind = '';
    this.taskDraft = this._blankTask();
    this.courseDraft = this._blankCourse();
    this._onKeyDown = (e) => this._keydown(e);
    window.addEventListener('keydown', this._onKeyDown, true);
    this.map.on('change', () => this.isOpen && this.render());
    this.render();
  }

  get isOpen() {
    return !this.root.classList.contains('is-hidden');
  }

  open(tab) {
    if (tab) this.tab = tab;
    this.root.classList.remove('is-hidden');
    this.render();
    this.emit('open', {});
  }

  close() {
    if (!this.isOpen) return;
    this.recording = false;
    this.root.classList.add('is-hidden');
    this.emit('close', {});
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  _keydown(e) {
    if (!this.isOpen) return;
    if (this.recording) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        this.recording = false;
        this._say('Key binding cancelled.');
        return this.render();
      }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      this.recording = false;
      const res = this.map.addKeyTrigger(e.key);
      if (res.ok) this._say(`Key ${e.key.length === 1 ? e.key.toUpperCase() : e.key} added. Choose what it does.`, 'ok');
      else this._say(res.reason, 'bad');
      return this.render();
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.close();
    } else if (e.key.toLowerCase() === 'g' && !/^(input|textarea|select)$/i.test(e.target?.tagName || '')) {
      e.stopPropagation();
      this.close();
    }
  }

  _say(text, kind = '') {
    this.msgText = text;
    this.msgKind = kind;
    const n = this.root.querySelector('.lab-msg');
    if (n) {
      n.textContent = text;
      n.className = `lab-msg ${kind}`;
    }
  }

  /* ----------------------------- drafts ------------------------------ */

  _blankTask() {
    return { id: null, name: '', gauntlet: true, steps: [{ action: 'dash', delay: 0 }, { action: 'spin', delay: 0.4 }] };
  }

  _blankCourse() {
    return {
      id: null,
      name: '',
      items: [
        { type: 'ring', action: 'spin', lane: 0, height: 0, gap: 2.4 },
        { type: 'block', action: 'dash', lane: 1, height: 0, gap: 2.4 },
      ],
    };
  }

  /* ----------------------------- rendering --------------------------- */

  render() {
    const root = this.root;
    root.replaceChildren();
    const tabs = [
      ['bindings', 'Gestures & keys'],
      ['tasks', 'Tasks'],
      ['courses', 'Trial courses'],
    ];
    const card = el(
      'div',
      { class: 'lab-card', role: 'dialog', 'aria-label': 'Gesture Lab' },
      el(
        'header',
        { class: 'lab-head' },
        el('div', {}, el('div', { class: 'lab-kicker', text: 'WORKSHOP' }), el('h2', { class: 'lab-title', text: 'GESTURE LAB' })),
        el(
          'nav',
          { class: 'lab-tabs', role: 'tablist' },
          tabs.map(([id, label]) =>
            el('button', { class: `lab-tab${this.tab === id ? ' active' : ''}`, role: 'tab', 'data-tab': id, 'aria-selected': String(this.tab === id), onclick: () => ((this.tab = id), this.render()), text: label }),
          ),
        ),
        el('button', { class: 'lab-close', id: 'labClose', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => this.close(), text: '×' }),
      ),
      el('div', { class: 'lab-body' }, this.tab === 'bindings' ? this._bindingsTab() : this.tab === 'tasks' ? this._tasksTab() : this._coursesTab()),
      el('footer', { class: 'lab-foot' }, el('span', { class: `lab-msg ${this.msgKind}`, text: this.msgText || 'Changes are saved automatically on this device.' }), el('span', { class: 'lab-hint', text: 'G or Esc to close' })),
    );
    root.append(card);
  }

  _actionSelect(value, onChange, { allowNone = true, tasks = true, attrs = {} } = {}) {
    const sel = el('select', { class: 'lab-sel', ...attrs });
    if (allowNone) sel.append(el('option', { value: '', text: '— not bound —' }));
    const base = el('optgroup', { label: 'Actions' });
    for (const a of ACTIONS) base.append(el('option', { value: a.id, text: a.name, title: a.desc }));
    sel.append(base);
    if (tasks && this.map.allTasks().length) {
      const g = el('optgroup', { label: 'Tasks' });
      for (const t of this.map.allTasks()) g.append(el('option', { value: t.id, text: t.name }));
      sel.append(g);
    }
    sel.value = value || '';
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  /* ---------------------------- bindings tab ------------------------- */

  _bindingsTab() {
    const out = [el('p', { class: 'lab-lead', text: 'Pick what each gesture, click or key does. Tasks you create appear in every list. Use Test to try an action on the sword right now.' })];
    for (const g of GROUPS) {
      const rows = this.map.triggers().filter((t) => t.group === g.id);
      const sec = el('section', { class: 'lab-sec' }, el('h3', { text: g.title }), el('p', { class: 'lab-sub', text: g.sub }));
      for (const t of rows) {
        const action = this.map.resolve(t.id);
        sec.append(
          el(
            'div',
            { class: 'lab-row', 'data-trigger': t.id },
            el('div', { class: 'lab-row-name' }, el('b', { text: t.name }), t.desc && el('small', { text: t.desc })),
            this._actionSelect(action, (v) => this.map.setBinding(t.id, v || null), { attrs: { 'data-trigger': t.id } }),
            el('button', { class: 'lab-btn', text: 'Test', disabled: !action, onclick: () => this.emit('test', { action }) }),
            t.custom ? el('button', { class: 'lab-btn danger', title: 'Remove this key', text: '×', onclick: () => this.map.removeKeyTrigger(t.id) }) : el('span', { class: 'lab-spacer' }),
          ),
        );
      }
      if (g.id === 'keyboard') {
        sec.append(
          el('button', {
            class: `lab-btn wide${this.recording ? ' recording' : ''}`,
            id: 'labBindKey',
            text: this.recording ? 'Press the key you want to bind…  (Esc cancels)' : '+ Bind a new key',
            onclick: () => {
              this.recording = !this.recording;
              this.render();
            },
          }),
        );
      }
      if (g.id === 'camera') {
        sec.append(el('p', { class: 'lab-note', text: 'Grab, Release and Pinch start are read from changes of your hand pose. They are off by default because you make those poses constantly while steering; bind them to something light.' }));
      }
      out.push(sec);
    }
    out.push(
      el('button', {
        class: 'lab-btn wide danger',
        id: 'labResetBindings',
        text: 'Reset all gestures & keys to defaults',
        onclick: () => {
          this.map.resetBindings();
          this._say('Bindings restored to defaults.', 'ok');
        },
      }),
    );
    return out;
  }

  /* ------------------------------ tasks tab -------------------------- */

  _tasksTab() {
    const d = this.taskDraft;
    const list = el('section', { class: 'lab-sec' }, el('h3', { text: 'YOUR TASKS' }), el('p', { class: 'lab-sub', text: 'A task is a chain of actions that runs from a single gesture. Bind it on the first tab, play it in the TRIAL.' }));
    for (const t of this.map.allTasks()) {
      list.append(
        el(
          'div',
          { class: 'lab-row task', 'data-task': t.id },
          el('div', { class: 'lab-row-name' }, el('b', { text: t.name + (t.builtin ? '  ·  built-in' : '') }), el('small', { text: t.steps.map((s) => `${this.map.actionName(s.action)}${s.delay ? ` +${s.delay}s` : ''}`).join('  →  ') })),
          el('button', { class: 'lab-btn', text: 'Test', onclick: () => this.emit('test', { action: t.id }) }),
          t.builtin
            ? el('button', { class: 'lab-btn', text: 'Copy', title: 'Edit a copy', onclick: () => ((this.taskDraft = { id: null, name: `${t.name} copy`, gauntlet: true, steps: t.steps.map((s) => ({ ...s })) }), this.render()) })
            : el('button', { class: 'lab-btn', text: 'Edit', onclick: () => ((this.taskDraft = { id: t.id, name: t.name, gauntlet: t.gauntlet !== false, steps: t.steps.map((s) => ({ ...s })) }), this.render()) }),
          t.builtin ? el('span', { class: 'lab-spacer' }) : el('button', { class: 'lab-btn danger', text: '×', title: 'Delete task', onclick: () => ((this.taskDraft.id === t.id && (this.taskDraft = this._blankTask())), this.map.removeTask(t.id), this._say('Task deleted.')) }),
        ),
      );
    }

    const form = el('section', { class: 'lab-sec lab-form' }, el('h3', { text: d.id ? 'EDIT TASK' : 'NEW TASK' }));
    form.append(
      el('label', { class: 'lab-field' }, el('span', { text: 'Name' }), el('input', { class: 'lab-in', id: 'taskName', type: 'text', maxlength: '28', placeholder: 'e.g. Phantom Rush', value: d.name, oninput: (e) => (d.name = e.target.value) })),
    );
    const steps = el('div', { class: 'lab-steps' });
    d.steps.forEach((s, i) => {
      steps.append(
        el(
          'div',
          { class: 'lab-step', 'data-step': String(i) },
          el('span', { class: 'lab-step-n', text: String(i + 1) }),
          this._actionSelect(s.action, (v) => (s.action = v), { allowNone: false, tasks: false, attrs: { 'data-role': 'step-action' } }),
          el('label', { class: 'lab-delay' }, el('span', { text: 'after' }), el('input', { class: 'lab-in num', type: 'number', min: '0', max: '5', step: '0.1', value: String(s.delay), 'data-role': 'step-delay', oninput: (e) => (s.delay = Number(e.target.value) || 0) }), el('span', { text: 's' })),
          el('button', { class: 'lab-btn danger', text: '×', title: 'Remove step', disabled: d.steps.length < 2, onclick: () => (d.steps.splice(i, 1), this.render()) }),
        ),
      );
    });
    form.append(steps);
    form.append(
      el(
        'div',
        { class: 'lab-actions' },
        el('button', { class: 'lab-btn', id: 'taskAddStep', text: '+ Add step', disabled: d.steps.length >= 6, onclick: () => (d.steps.push({ action: 'dash', delay: 0.4 }), this.render()) }),
        el('label', { class: 'lab-check' }, el('input', { type: 'checkbox', checked: d.gauntlet ? '' : null, onchange: (e) => (d.gauntlet = e.target.checked) }), el('span', { text: 'Appears in the endless Gauntlet' })),
      ),
    );
    form.append(
      el(
        'div',
        { class: 'lab-actions' },
        el('button', {
          class: 'lab-btn primary',
          id: 'taskSave',
          text: d.id ? 'Save changes' : 'Create task',
          onclick: () => {
            const saved = this.map.saveTask(d);
            if (!saved) return this._say('Add at least one step.', 'bad');
            this.taskDraft = this._blankTask();
            this._say(`Task "${saved.name}" saved. Bind it on the Gestures & keys tab.`, 'ok');
            this.render();
          },
        }),
        el('button', { class: 'lab-btn', text: 'Try these steps', onclick: () => this._tryDraft() }),
        d.id && el('button', { class: 'lab-btn', text: 'Cancel edit', onclick: () => ((this.taskDraft = this._blankTask()), this.render()) }),
      ),
    );
    return [list, form];
  }

  /** Play an unsaved draft by saving it under a temporary id. */
  _tryDraft() {
    const d = this.taskDraft;
    if (!d.steps.length) return;
    this.emit('testSteps', { steps: d.steps.map((s) => ({ ...s })) });
  }

  /* ----------------------------- courses tab ------------------------- */

  _coursesTab() {
    const d = this.courseDraft;
    const list = el('section', { class: 'lab-sec' }, el('h3', { text: 'TRIAL COURSES' }), el('p', { class: 'lab-sub', text: 'Rings must be flown through with the right action. Blocks must be smashed with it, or dodged.' }));
    for (const c of this.map.allCourses()) {
      list.append(
        el(
          'div',
          { class: 'lab-row course', 'data-course': c.id },
          el('div', { class: 'lab-row-name' }, el('b', { text: c.name + (c.builtin ? '  ·  built-in' : '') }), el('small', { text: c.endless ? 'Endless, speeds up every 6 obstacles' : `${c.items.length} obstacles` })),
          el('button', { class: 'lab-btn primary', text: 'Play', onclick: () => this.emit('play', { courseId: c.id }) }),
          c.builtin
            ? el('button', { class: 'lab-btn', text: 'Copy', disabled: !!c.endless, onclick: () => ((this.courseDraft = { id: null, name: `${c.name} copy`, items: c.items.map((o) => ({ ...o })) }), this.render()) })
            : el('button', { class: 'lab-btn', text: 'Edit', onclick: () => ((this.courseDraft = { id: c.id, name: c.name, items: c.items.map((o) => ({ ...o })) }), this.render()) }),
          c.builtin ? el('span', { class: 'lab-spacer' }) : el('button', { class: 'lab-btn danger', text: '×', title: 'Delete course', onclick: () => ((this.courseDraft.id === c.id && (this.courseDraft = this._blankCourse())), this.map.removeCourse(c.id), this._say('Course deleted.', ''), this.render()) }),
        ),
      );
    }

    const form = el('section', { class: 'lab-sec lab-form' }, el('h3', { text: d.id ? 'EDIT COURSE' : 'NEW COURSE' }));
    form.append(el('label', { class: 'lab-field' }, el('span', { text: 'Name' }), el('input', { class: 'lab-in', id: 'courseName', type: 'text', maxlength: '28', placeholder: 'e.g. Shadow Run', value: d.name, oninput: (e) => (d.name = e.target.value) })));
    const rows = el('div', { class: 'lab-steps' });
    d.items.forEach((o, i) => {
      const mk = (opts, val, key, role) => {
        const s = el('select', { class: 'lab-sel small', 'data-role': role });
        for (const [v, t] of opts) s.append(el('option', { value: v, text: t }));
        s.value = String(val);
        s.addEventListener('change', () => (o[key] = key === 'type' ? s.value : Number(s.value)));
        return s;
      };
      rows.append(
        el(
          'div',
          { class: 'lab-step course-item', 'data-item': String(i) },
          el('span', { class: 'lab-step-n', text: String(i + 1) }),
          mk([['ring', 'Ring'], ['block', 'Block']], o.type, 'type', 'item-type'),
          this._actionSelect(o.action, (v) => (o.action = v), { allowNone: false, attrs: { 'data-role': 'item-action' } }),
          mk(LANES, o.lane, 'lane', 'item-lane'),
          mk(HEIGHTS, o.height, 'height', 'item-height'),
          el('label', { class: 'lab-delay' }, el('span', { text: 'gap' }), el('input', { class: 'lab-in num', type: 'number', min: '1', max: '8', step: '0.2', value: String(o.gap), 'data-role': 'item-gap', oninput: (e) => (o.gap = Number(e.target.value) || 2.4) }), el('span', { text: 's' })),
          el('button', { class: 'lab-btn danger', text: '×', title: 'Remove', disabled: d.items.length < 2, onclick: () => (d.items.splice(i, 1), this.render()) }),
        ),
      );
    });
    form.append(rows);
    form.append(
      el(
        'div',
        { class: 'lab-actions' },
        el('button', { class: 'lab-btn', id: 'courseAdd', text: '+ Add obstacle', disabled: d.items.length >= 30, onclick: () => (d.items.push({ type: 'ring', action: 'dash', lane: 0, height: 0, gap: 2.4 }), this.render()) }),
      ),
    );
    form.append(
      el(
        'div',
        { class: 'lab-actions' },
        el('button', {
          class: 'lab-btn primary',
          id: 'courseSave',
          text: d.id ? 'Save changes' : 'Create course',
          onclick: () => {
            const c = this.map.saveCourse(d);
            if (!c) return this._say('Add at least one obstacle.', 'bad');
            this.courseDraft = this._blankCourse();
            this._say(`Course "${c.name}" saved.`, 'ok');
            this.render();
          },
        }),
        el('button', {
          class: 'lab-btn',
          id: 'courseSavePlay',
          text: 'Save & play',
          onclick: () => {
            const c = this.map.saveCourse(d);
            if (!c) return this._say('Add at least one obstacle.', 'bad');
            this.courseDraft = this._blankCourse();
            this.emit('play', { courseId: c.id });
          },
        }),
        d.id && el('button', { class: 'lab-btn', text: 'Cancel edit', onclick: () => ((this.courseDraft = this._blankCourse()), this.render()) }),
      ),
    );
    return [list, form];
  }
}
