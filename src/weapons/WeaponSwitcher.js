/**
 * WeaponSwitcher: the transition state machine.
 *
 *   idle ──request──▶ dismissing ──(old weapons fully hidden)──▶ entering ──(entry done)──▶ idle
 *
 * - The old lead weapon(s) are dismissed first; the new models are built and
 *   placed only after every old model is completely hidden, so two weapon
 *   models can never occupy the same position.
 * - A request that arrives mid-transition replaces the pending one (only the
 *   latest choice is ever built); an entry in progress is cancelled with a
 *   quick dismissal, never left half-finished on screen.
 * - Entry animations are started exactly once per switch, here, by an
 *   explicit request. Per-frame tracking never touches this class.
 */
export class WeaponSwitcher {
  constructor(manager) {
    this.m = manager;
    this.state = 'idle'; // 'idle' | 'dismissing' | 'entering'
    this.pending = null; // { id, instant }
    this.waiting = 0; // dismissals still running
    this.formationWait = 0; // seconds until formation blades have faded
    this.entries = [];
    this.token = 0;
    this.skipNext = false;
  }

  get busy() {
    return this.state !== 'idle';
  }

  /** Ask for a loadout. Always accepted; the latest request wins. */
  request(id, { instant = false } = {}) {
    this.pending = { id, instant };
    if (!instant && this.state !== 'dismissing') this.skipNext = false;
    if (instant) {
      this._cancelEntries();
      this.m._swap(id, { instant: true });
      this.pending = null;
      this.state = 'idle';
      this.waiting = 0;
      return;
    }
    if (this.state === 'dismissing') return; // pending replaced, dismissal already underway
    this._beginDismiss();
  }

  /** Skip the running entry animation to its end (blade out, resting pose). */
  skip() {
    for (const e of this.entries) e.skip?.();
    // asked while the old weapon is still leaving: skip the entry that follows too
    if (this.state === 'dismissing') this.skipNext = true;
  }

  _cancelEntries() {
    this.m.anims.clear();
    this.entries = [];
  }

  _beginDismiss() {
    const wasEntering = this.state === 'entering';
    this.state = 'dismissing';
    const token = ++this.token;
    this.entries = [];
    const leads = this.m.visibleLeads();
    this.waiting = leads.length;
    this.m._emit('dismissing', this.pending?.id);
    for (const s of leads) {
      this.m.anims.dismiss(s, {
        quick: wasEntering,
        onDone: () => {
          if (token === this.token) this.waiting--;
        },
      });
    }
    this.formationWait = this.m.dismissFormation(wasEntering);
    if (this.waiting <= 0) this.waiting = 0;
  }

  update(dt) {
    if (this.state === 'dismissing') {
      this.formationWait -= dt;
      if (this.waiting <= 0 && this.formationWait <= 0 && !this.m.anims.isAnyDismissing()) {
        const { id } = this.pending;
        this.pending = null;
        this.entries = this.m._swap(id, { instant: false });
        if (this.skipNext) for (const e of this.entries) e.skip?.();
        this.skipNext = false;
        this.state = this.entries.length ? 'entering' : 'idle';
        this.m._emit(this.state === 'entering' ? 'entering' : 'ready', id);
      }
    } else if (this.state === 'entering') {
      if (this.pending) {
        this._beginDismiss();
        return;
      }
      if (this.entries.every((e) => e.done)) {
        this.state = 'idle';
        this.entries = [];
        this.m._emit('ready', this.m.loadoutId);
      }
    }
  }
}
