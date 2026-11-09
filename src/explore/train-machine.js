// The station train's state machine (pure, unit-tested; the 3D side lives in train.js).
//   idle ──enterStation()──▶ arriving (≈6 s ease-out from the west) ──▶ stopped: "openOverlay"
//   stopped ──overlayClosed()──▶ departing (ease-in to the east) ──▶ idle: "despawn"
// If the visitor opens the Journey overlay themselves while the train is still arriving, it does not
// re-open on stop; if they close it before the train stops, it pulls out again after a short dwell.
// Under reduced motion the train appears at the platform and vanishes on close (no travel).

export const easeOutCubic = (k) => 1 - (1 - k) ** 3;
export const easeInCubic = (k) => k ** 3;

export function createTrainMachine({ enterX, stopX, exitX, arrive = 6, depart = 6, dwell = 1.2, reducedMotion = false }) {
  let state = 'idle';
  let t = 0;
  let x = enterX;
  let overlayOpen = false;
  let closedEarly = false;
  let fresh = false; // first step in the current state

  const go = (next) => {
    state = next;
    t = 0;
    fresh = true;
  };

  return {
    get state() {
      return state;
    },
    get x() {
      return x;
    },
    /** True while the train is in the scene. */
    get visible() {
      return state !== 'idle';
    },
    /** Visitor entered the station zone. Returns false when a train is already running. */
    enterStation() {
      if (state !== 'idle') return false;
      overlayOpen = false;
      closedEarly = false;
      x = reducedMotion ? stopX : enterX;
      go('arriving');
      return true;
    },
    overlayOpened() {
      overlayOpen = true;
    },
    overlayClosed() {
      if (!overlayOpen) return;
      overlayOpen = false;
      if (state === 'stopped') go('departing');
      else if (state === 'arriving') closedEarly = true;
    },
    /** Advance by dt seconds → { x, dx, events[] } (events: "stopped", "openOverlay", "departing", "despawn"). */
    step(dt) {
      const events = [];
      const before = x;
      t += dt;
      const first = fresh;
      fresh = false;
      if (state === 'arriving') {
        const k = reducedMotion ? 1 : Math.min(1, t / arrive);
        x = enterX + (stopX - enterX) * easeOutCubic(k);
        if (k >= 1) {
          x = stopX;
          go('stopped');
          events.push('stopped');
          if (!overlayOpen && !closedEarly) events.push('openOverlay');
        }
      } else if (state === 'stopped') {
        if (closedEarly && t >= dwell) {
          closedEarly = false;
          go('departing');
        }
      } else if (state === 'departing') {
        const k = reducedMotion ? 1 : Math.min(1, t / depart);
        x = stopX + (exitX - stopX) * easeInCubic(k);
        if (first) events.push('departing');
        if (k >= 1) {
          x = enterX;
          go('idle');
          events.push('despawn');
        }
      }
      return { x, dx: state === 'idle' ? 0 : x - before, events };
    },
  };
}
