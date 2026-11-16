// The horse's state machine (pure, unit-tested; movement lives in horse.js).
//   absent ──whistle (reachable)──▶ called (the sheriff whistles) ──▶ travel (gallop → trot → walk)
//   travel ──arrived──▶ greet (HeadShake) ──▶ idle ──(a while)──▶ wander ──▶ idle
//   idle / greet / wander ──mount (near)──▶ mounting ──▶ ridden ──dismount (slow)──▶ dismounting ──▶ idle
// whistle() when the sheriff stands where the horse cannot reach (the dock, inside a building, the
// rocks) returns { ok: false, reason: 'unreachable' } and changes nothing. Whistling again while the
// horse is idle somewhere else sends it travelling again.

export const HORSE_TIMING = { whistle: 1.1, greet: 1.7, mount: 0.5, dismount: 0.45, wanderAfter: 18, wander: 4 };

export function createHorseMachine(timing = {}) {
  const T = { ...HORSE_TIMING, ...timing };
  let state = 'absent';
  let t = 0;
  let fresh = false;
  const go = (next) => {
    state = next;
    t = 0;
    fresh = true;
  };
  const riding = () => state === 'mounting' || state === 'ridden' || state === 'dismounting';

  return {
    get state() {
      return state;
    },
    get riding() {
      return riding();
    },
    /** The player pressed H. */
    whistle({ reachable }) {
      if (riding()) return { ok: false, reason: 'riding' };
      if (state === 'called' || state === 'travel') return { ok: false, reason: 'coming' };
      if (!reachable) return { ok: false, reason: 'unreachable' };
      go('called');
      return { ok: true };
    },
    /** horse.js reached the spot beside the sheriff. */
    arrived() {
      if (state === 'travel') go('greet');
    },
    /** The wander stroll finished. */
    settled() {
      if (state === 'wander') go('idle');
    },
    mount({ near }) {
      if (!near || !['greet', 'idle', 'wander'].includes(state)) return false;
      go('mounting');
      return true;
    },
    dismount({ speed }) {
      if (state !== 'ridden' || Math.abs(speed) > 1.0) return false;
      go('dismounting');
      return true;
    },
    /** Opening a case file while riding: off at once, no blend. */
    forceDismount() {
      if (!riding()) return false;
      go('idle');
      return true;
    },
    /** Advance timers → events: "depart", "greeted", "mounted", "dismounted", "wander". */
    step(dt) {
      const events = [];
      t += dt;
      const first = fresh;
      fresh = false;
      if (state === 'called' && t >= T.whistle) {
        go('travel');
        events.push('depart');
      } else if (state === 'greet') {
        if (first) events.push('greeting');
        if (t >= T.greet) {
          go('idle');
          events.push('greeted');
        }
      } else if (state === 'mounting' && t >= T.mount) {
        go('ridden');
        events.push('mounted');
      } else if (state === 'dismounting' && t >= T.dismount) {
        go('idle');
        events.push('dismounted');
      } else if (state === 'idle' && t >= T.wanderAfter) {
        go('wander');
        events.push('wander');
      } else if (state === 'wander' && t >= T.wander) {
        go('idle');
      }
      return events;
    },
  };
}
