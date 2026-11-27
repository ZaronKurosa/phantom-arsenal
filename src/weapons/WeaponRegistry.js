import { buildKatana, disposeKatana } from './Katana.js';
import { KatanaAwakening, katanaIdleTick } from './KatanaAwakening.js';
import { buildGreatsword, disposeGreatsword } from './Greatsword.js';
import { buildVoidDagger, disposeVoidDagger } from './VoidDagger.js';

/**
 * The four weapons of the arsenal and the "loadouts" the player can pick.
 *
 * WEAPONS   the four individual weapon models (each its own model + builder).
 * LOADOUTS  what the armory offers: each weapon on its own, plus TWIN VOID
 *           DAGGERS, which equips the two separate daggers together (one per hand).
 */

export const WEAPONS = {
  katana: {
    id: 'katana',
    name: 'Gothic Katana',
    short: 'Katana',
    desc: 'Curved blade in a runed black sheath. Awakens with the full Purple Awakening unsheathing.',
    entry: 'katana',
    color: 0x9a5cff,
    leadScale: 1.3,
    formationScale: 0.9,
  },
  greatsword: {
    id: 'greatsword',
    name: 'Gothic Greatsword',
    short: 'Greatsword',
    desc: 'Horned crossguard, central violet crystal, energy running down the fuller.',
    entry: 'greatsword',
    color: 0x9a5cff,
    leadScale: 1.3,
    formationScale: 0.62,
  },
  'dagger-left': {
    id: 'dagger-left',
    name: 'Left Void Dagger',
    short: 'Left Dagger',
    desc: 'Hooked blade curving left. A separate weapon, independent of its twin.',
    entry: 'dagger',
    side: 'left',
    color: 0x9a5cff,
    leadScale: 1.45,
    formationScale: 1.0,
  },
  'dagger-right': {
    id: 'dagger-right',
    name: 'Right Void Dagger',
    short: 'Right Dagger',
    desc: 'Hooked blade curving right. A separate weapon, independent of its twin.',
    entry: 'dagger',
    side: 'right',
    color: 0x9a5cff,
    leadScale: 1.45,
    formationScale: 1.0,
  },
};

export const LOADOUTS = [
  { id: 'katana', key: '5', name: 'Gothic Katana', short: 'Katana', desc: WEAPONS.katana.desc, weapons: ['katana'] },
  { id: 'greatsword', key: '6', name: 'Gothic Greatsword', short: 'Greatsword', desc: WEAPONS.greatsword.desc, weapons: ['greatsword'] },
  { id: 'dagger-left', key: '7', name: 'Left Void Dagger', short: 'Left Dagger', desc: WEAPONS['dagger-left'].desc, weapons: ['dagger-left'] },
  { id: 'dagger-right', key: '8', name: 'Right Void Dagger', short: 'Right Dagger', desc: WEAPONS['dagger-right'].desc, weapons: ['dagger-right'] },
  {
    id: 'twin',
    key: '9',
    name: 'Twin Void Daggers',
    short: 'Twin Daggers',
    desc: 'Both daggers at once. Left hand wields the left dagger, right hand the right one.',
    weapons: ['dagger-right', 'dagger-left'], // [lead (right hand), partner (left hand)]
    twin: true,
  },
];

export const LOADOUT_BY_ID = Object.fromEntries(LOADOUTS.map((l) => [l.id, l]));
export const DEFAULT_LOADOUT = 'katana';

export function weaponMeta(id) {
  const m = WEAPONS[id];
  if (!m) throw new Error(`Unknown weapon "${id}"`);
  return m;
}

/**
 * Build a weapon model.
 * @param {string} id        key of WEAPONS
 * @param {{ lite?: boolean }} opts  lite = formation blade: katana without sheath/awakening
 */
export function createWeaponModel(id, { lite = false } = {}) {
  const meta = weaponMeta(id);
  let model;
  switch (id) {
    case 'katana': {
      model = buildKatana({ full: !lite });
      if (!lite) {
        const aw = new KatanaAwakening(model);
        model.userData.awakening = aw;
        // before / after the cinematic the katana is fully formed and idles
        aw.finish();
      }
      const ud = model.userData;
      ud.tick = (dt, time, sword) => {
        if (ud.awakening?.running) ud.awakening.update(dt, time, sword);
        else katanaIdleTick(model, dt, time, sword);
      };
      break;
    }
    case 'greatsword':
      model = buildGreatsword();
      break;
    default:
      model = buildVoidDagger(meta.side);
  }
  model.userData.weaponId = id;
  model.userData.lite = lite;
  return model;
}

export function disposeWeaponModel(model) {
  if (!model) return;
  switch (model.userData.kind) {
    case 'katana':
      disposeKatana(model);
      break;
    case 'greatsword':
      disposeGreatsword(model);
      break;
    case 'dagger':
      disposeVoidDagger(model);
      break;
    default:
  }
}
