// Input: keyboard (WASD and the arrow keys, identical; Shift = run, Space = jump, E = interact,
// H = whistle), mouse drag to orbit, wheel to zoom, and on touch a virtual joystick + jump / run /
// interact buttons with drag-to-orbit on the right half of the screen. Keys typed into form fields are
// ignored. P3.4: a plain click on the 3D view turns on pointer-lock look (the mouse turns the camera
// without dragging); Esc releases it (the browser's own rule), and Tab is never captured.
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

export function createInput({ surface, joystickBase, joystickKnob, buttons, onOrbit, onZoom, onKey, onDrag, onPointerLock }) {
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
  const locked = () => document.pointerLockElement === surface;
  on(surface, 'pointerdown', (e) => {
    surface.focus({ preventScroll: true }); // keys now go to the game, not a previously focused button
    if (locked()) return; // pointer-lock look: the mouse already turns the camera
    if (e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.45) return; // left half = joystick zone
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), type: e.pointerType, moved: false };
    surface.setPointerCapture?.(e.pointerId);
  });
  on(surface, 'pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) {
      drag.moved = true;
      onDrag?.(true);
    }
    onOrbit(e.clientX - drag.x, e.clientY - drag.y);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const click = e.type === 'pointerup' && drag.type === 'mouse' && !drag.moved && performance.now() - drag.t0 < 350;
    if (drag.moved) onDrag?.(false);
    drag = null;
    // A plain click (no drag) turns on pointer-lock look. Never while paused (an overlay is open).
    if (click && !paused && surface.requestPointerLock) {
      try {
        const r = surface.requestPointerLock();
        r?.catch?.(() => {});
      } catch {
        // pointer lock unavailable (embedded, headless): drag-to-look still works
      }
    }
  };
  on(document, 'pointerlockchange', () => onPointerLock?.(locked()));
  on(document, 'mousemove', (e) => {
    if (locked() && !paused) onOrbit(e.movementX || 0, e.movementY || 0);
  });
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
      if (on && locked()) document.exitPointerLock?.();
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
    /** Leave pointer-lock look (cinematic, overlays, exit). */
    releasePointer() {
      if (locked()) document.exitPointerLock?.();
    },
    get pointerLocked() {
      return locked();
    },
    dispose() {
      if (locked()) document.exitPointerLock?.();
      for (const off of listeners) off();
    },
  };
}
