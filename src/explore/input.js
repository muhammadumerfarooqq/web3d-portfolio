// Input: keyboard (WASD / arrows, Shift = run, Space = jump, E = interact), mouse drag to orbit,
// wheel to zoom, and on touch a virtual joystick + jump / run / interact buttons with drag-to-orbit
// on the right half of the screen. Keys typed into form fields are ignored.
const KEYMAP = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'run',
  ShiftRight: 'run',
  Space: 'jump',
  KeyE: 'interact',
  KeyH: 'whistle',
  Enter: 'interact',
};

export function createInput({ surface, joystickBase, joystickKnob, buttons, onOrbit, onZoom, onKey }) {
  const state = { forward: false, back: false, left: false, right: false, run: false, jump: false, interact: false, whistle: false, x: 0, y: 0 };
  const listeners = [];
  const on = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    listeners.push(() => el.removeEventListener(type, fn, opts));
  };
  let paused = false; // a case-file overlay or the ceremony owns the keyboard
  const typing = (e) => e.target instanceof HTMLElement && e.target.closest('input, select, textarea, [contenteditable="true"]');

  on(window, 'keydown', (e) => {
    const action = KEYMAP[e.code];
    if (paused || !action || typing(e)) return;
    // Space and arrows would scroll or activate the focused button: claim them while playing.
    if (e.target instanceof HTMLElement && e.target.closest('button, a, select') && (e.code === 'Space' || e.code === 'Enter')) return;
    if (action !== 'interact') e.preventDefault();
    state[action] = true;
    onKey?.(action, true);
  });
  on(window, 'keyup', (e) => {
    const action = KEYMAP[e.code];
    if (!action) return;
    // One-shot actions stay latched until the frame loop takes them (a tap shorter than a frame counts).
    if (action !== 'interact' && action !== 'jump' && action !== 'whistle') state[action] = false;
    onKey?.(action, false);
  });
  on(window, 'blur', () => {
    for (const k of Object.keys(state)) state[k] = typeof state[k] === 'boolean' ? false : 0;
  });

  // Mouse / touch drag to orbit.
  let drag = null;
  on(surface, 'pointerdown', (e) => {
    surface.focus({ preventScroll: true }); // keys now go to the game, not a previously focused button
    if (e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.45) return; // left half = joystick zone
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    surface.setPointerCapture?.(e.pointerId);
  });
  on(surface, 'pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    onOrbit(e.clientX - drag.x, e.clientY - drag.y);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  const endDrag = (e) => {
    if (drag && drag.id === e.pointerId) drag = null;
  };
  on(surface, 'pointerup', endDrag);
  on(surface, 'pointercancel', endDrag);
  on(surface, 'wheel', (e) => {
    e.preventDefault();
    onZoom(e.deltaY);
  }, { passive: false });

  // Virtual joystick.
  let stick = null;
  const R = 46;
  const setKnob = (dx, dy) => {
    joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  on(joystickBase, 'pointerdown', (e) => {
    const r = joystickBase.getBoundingClientRect();
    stick = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    joystickBase.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  on(joystickBase, 'pointermove', (e) => {
    if (!stick || stick.id !== e.pointerId) return;
    let dx = e.clientX - stick.cx;
    let dy = e.clientY - stick.cy;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    setKnob(dx, dy);
    state.x = dx / R;
    state.y = -dy / R;
    state.run = len > R * 0.95 ? true : state.runLatched === true;
  });
  const endStick = (e) => {
    if (!stick || stick.id !== e.pointerId) return;
    stick = null;
    setKnob(0, 0);
    state.x = 0;
    state.y = 0;
    state.run = state.runLatched === true;
  };
  on(joystickBase, 'pointerup', endStick);
  on(joystickBase, 'pointercancel', endStick);

  const hold = (el, action) => {
    on(el, 'pointerdown', (e) => {
      e.preventDefault();
      state[action] = true;
      onKey?.(action, true);
    });
    const up = () => {
      state[action] = false;
      onKey?.(action, false);
    };
    on(el, 'pointerup', up);
    on(el, 'pointercancel', up);
    on(el, 'pointerleave', up);
  };
  if (buttons.jump) hold(buttons.jump, 'jump');
  if (buttons.interact) hold(buttons.interact, 'interact');
  if (buttons.whistle) on(buttons.whistle, 'click', () => (state.whistle = true));
  if (buttons.run) {
    on(buttons.run, 'click', () => {
      state.runLatched = !state.runLatched;
      state.run = state.runLatched;
      buttons.run.setAttribute('aria-pressed', String(state.runLatched));
      onKey?.('run', state.run);
    });
  }

  return {
    state,
    /** Consume one-shot actions (jump, interact) so holding the key does not repeat them. */
    /** Pause (overlay open): keys reach the page untouched and held keys are released. */
    setPaused(on) {
      paused = on;
      for (const k of Object.keys(state)) if (typeof state[k] === 'boolean' && k !== 'runLatched') state[k] = false;
      state.x = 0;
      state.y = 0;
      state.run = state.runLatched === true;
    },
    take(action) {
      const v = state[action];
      state[action] = false;
      return v;
    },
    dispose() {
      for (const off of listeners) off();
    },
  };
}
