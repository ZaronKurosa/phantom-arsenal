import { Emitter } from '../utils/Emitter.js';
import { DEFAULT_LOADOUT, LOADOUTS, LOADOUT_BY_ID, WEAPONS } from './WeaponRegistry.js';
import { WeaponAnimations } from './WeaponAnimations.js';
import { WeaponSwitcher } from './WeaponSwitcher.js';

const FORMATION_FADE = 0.55;

/**
 * WeaponManager: which weapon(s) the player is wielding.
 *
 * It owns the loadout (one of the four weapons, or the twin daggers), maps it
 * onto the controller's swords (lead = main, partner = the second dagger,
 * formation = the orbiting copies), and runs switches through WeaponSwitcher.
 * It contains no input code and no model code.
 *
 * Events: 'weapon' { phase: 'dismissing'|'entering'|'ready', id, loadout }
 */
export class WeaponManager extends Emitter {
  constructor(controller, effects, lighting, sceneManager) {
    super();
    this.c = controller;
    this.anims = new WeaponAnimations(effects, lighting, sceneManager);
    this.switcher = new WeaponSwitcher(this);
    this.loadoutId = DEFAULT_LOADOUT;
    this.fx = effects;
    this.lighting = lighting;
    this.sm = sceneManager;
    this._resummon = false;
  }

  /* ------------------------------ queries ------------------------------ */

  get loadout() {
    return LOADOUT_BY_ID[this.loadoutId];
  }
  get twin() {
    return !!this.loadout.twin;
  }
  /** twin daggers are equipped and both daggers are actually on stage */
  get twinActive() {
    return this.twin && this.c.partner.appearTarget === 1;
  }
  get transitioning() {
    return this.switcher.busy;
  }
  get state() {
    return this.switcher.state;
  }

  /** how much the player's hand/mouse controls the lead weapon (the katana eases it in) */
  get control() {
    if (this.switcher.state === 'dismissing') return 1;
    const e = this.switcher.entries[0];
    if (this.switcher.state === 'entering' && e?.awakening) return e.awakening.handoff;
    return 1;
  }

  /** dash / spin / teleport are held back while a weapon is arriving or leaving */
  get blocksActions() {
    const s = this.switcher.state;
    if (s === 'idle') return false;
    if (s === 'dismissing') return true;
    const e = this.switcher.entries[0];
    if (e?.awakening) return e.awakening.handoff < 0.7;
    return true;
  }

  visibleLeads() {
    return this.leadSwords().filter((s) => s.appearTarget === 1 && s.appear > 0.02);
  }

  leadSwords() {
    return this.twin ? [this.c.main, this.c.partner] : [this.c.main];
  }

  /* ------------------------------ commands ------------------------------ */

  /**
   * Choose a loadout. Selecting the one already equipped skips a running
   * entry animation, or replays it when idle.
   */
  select(id, { instant = false } = {}) {
    if (!LOADOUT_BY_ID[id]) return false;
    if (id === this.loadoutId && !this.switcher.busy) {
      if (instant) return true;
      this.switcher.request(id); // replay the entry
      return true;
    }
    if (id === this.loadoutId && this.switcher.state === 'entering') {
      this.switcher.skip();
      return true;
    }
    this.switcher.request(id, { instant });
    return true;
  }

  cycle(dir = 1) {
    const i = LOADOUTS.findIndex((l) => l.id === (this.switcher.pending?.id ?? this.loadoutId));
    const next = LOADOUTS[(i + dir + LOADOUTS.length) % LOADOUTS.length];
    this.select(next.id);
    return next.id;
  }

  /** Play the entry animation of what is equipped now (used when the chamber first wakes). */
  reenter() {
    this.switcher.request(this.loadoutId);
  }

  skip() {
    this.switcher.skip();
  }

  /* --------------------------- used by the switcher --------------------------- */

  /** Fade the formation copies out. Returns how long to wait before swapping their models. */
  dismissFormation(quick) {
    let any = false;
    for (const s of this.c.swords) {
      if (s.appearTarget === 1 || s.appear > 0.02) {
        any = true;
        s.show(false);
      }
    }
    this._resummon = this._resummon || any;
    return any ? (quick ? 0.35 : FORMATION_FADE) : 0;
  }

  /**
   * Put the new weapon(s) on stage. Called only when every old model is hidden.
   * @returns {object[]} entry handles (one per lead weapon)
   */
  _swap(id, { instant }) {
    const lo = LOADOUT_BY_ID[id];
    const c = this.c;
    this.loadoutId = id;

    // lead weapon(s)
    const [leadId, partnerId] = lo.weapons;
    c.main.setWeapon(leadId);
    if (partnerId) c.partner.setWeapon(partnerId);

    // formation: the lead weapon's lite copies (daggers alternate left / right)
    c.swords.forEach((s, i) => {
      const fid = lo.twin || leadId.startsWith('dagger') ? (i % 2 ? 'dagger-left' : 'dagger-right') : leadId;
      s.setWeapon(fid);
      s.scaleMul = 1;
      s.spinAngle = 0;
      s.offset.set(0, 0, 0);
      s.teleportTo(c.main.pos);
    });
    this.c.onLoadoutApplied?.(lo);

    // prepare the lead swords for their entry: invisible until the animation reveals them
    for (const s of [c.main, c.partner]) {
      s.scaleMul = 1;
      s.spinAngle = 0;
      s.offset.set(0, 0, 0);
    }
    if (lo.twin) {
      // two separate daggers, one either side of the lead: never on the same spot
      const p = c.main.pos.clone();
      c.main.teleportTo(p.clone().setX(Math.min(p.x + 0.9, 3)));
      c.partner.teleportTo(p.clone().setX(Math.max(p.x - 0.9, -3)));
      c.main.snapOrientation();
      c.partner.snapOrientation();
    } else {
      c.partner.show(false);
      c.partner.appear = 0;
      c.partner.group.visible = false;
    }

    const leads = this.leadSwords();
    if (instant) {
      for (const s of leads) {
        s.appear = 1;
        s.appearTarget = 1;
        const ud = s.model.userData;
        ud.awakening?.finish();
        ud.RV && (ud.RV.uReveal.value = 9);
      }
      this._emit('ready', id);
      return [];
    }
    const handles = leads.map((s, i) => this.anims.enter(s, { delay: i * 0.12 }));
    return handles;
  }

  _emit(phase, id) {
    this.emit('weapon', { phase, id: id ?? this.loadoutId, loadout: LOADOUT_BY_ID[id ?? this.loadoutId] });
  }

  update(dt, time) {
    this.anims.update(dt, time);
    this.switcher.update(dt);
    // the formation copies return (through the controller's own summon effect) once the lead weapon has settled
    if (this._resummon && !this.switcher.busy) {
      this._resummon = false;
      this.c._wasDeployed = false;
    }
  }

  weaponName(id) {
    return WEAPONS[id]?.name ?? id;
  }
}
