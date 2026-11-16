// Explore DOM layer (createElement / textContent only; no HTML strings). "Back to Classic" is the
// first focusable element. Contains the case-file loader, the HUD (logo, control legend, zone chips
// for fast travel, sound / day-night / quality controls, the star counter), the interactive tutorial,
// the zone prompt, the edge arrow, an aria-live announcer, touch controls and the ?debug=1 overlay.
// The case-file overlays, star animation and Case Closed ceremony live in case-files.js (lazy).

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

export const STAR = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'xp-star');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M12 1.5l2.6 6.1 6.6.5-5 4.3 1.6 6.4L12 15.4l-5.8 3.4 1.6-6.4-5-4.3 6.6-.5z');
  svg.append(p);
  return svg;
};

const KEYCAPS = [
  ['KeyW', 'W', 'forward'],
  ['KeyA', 'A', 'left'],
  ['KeyS', 'S', 'back'],
  ['KeyD', 'D', 'right'],
  ['Shift', 'Shift', 'run'],
  ['Space', 'Space', 'jump'],
];

export function createHud({ zones, tiers, quality, sound, music = true, night, touch, debug, onExit, onTravel, onSound, onMusic, onTime, onQuality, onSkipTutorial, onInteract, onStars, onReplay, showTutorial }) {
  const root = el('div', { class: 'xp', 'data-explore': true, role: 'application', 'aria-label': 'Explore the island: 3D town' });

  const back = el('button', { type: 'button', class: 'xp-btn xp-back', 'data-explore-back': true }, [el('span', { 'aria-hidden': 'true', text: '←' }), el('span', { text: 'Back to Classic' })]);
  back.addEventListener('click', onExit);

  // The play surface takes focus (keys go to the game); Back to Classic stays first in tab order.
  const canvasHost = el('div', { class: 'xp-canvas', tabindex: '-1', 'aria-label': '3D view of the town' });

  // ── Loader ──
  const bar = el('span', { class: 'xp-loader__fill' });
  const pct = el('span', { class: 'xp-loader__pct', text: '0%' });
  const progress = el('div', { class: 'xp-loader__bar', role: 'progressbar', 'aria-label': 'Loading the town', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, [bar]);
  const loaderMsg = el('p', { class: 'xp-loader__msg', text: 'Loading the town, the sheriff and the night sky…' });
  const loader = el('div', { class: 'xp-loader' }, [
    el('div', { class: 'xp-loader__card' }, [
      el('p', { class: 'xp-eyebrow', text: 'Case file · Explore mode' }),
      el('p', { class: 'xp-loader__title', text: 'A new sheriff arrives in town' }),
      progress,
      el('div', { class: 'xp-loader__row' }, [loaderMsg, pct]),
    ]),
  ]);

  // ── HUD ──
  const badge = el('span', { class: 'xp-badge__count', text: `0/${zones.length}` });
  const starBtn = el('button', { type: 'button', class: 'xp-btn xp-badge', 'aria-label': `Stars: 0 of ${zones.length}. Open the case board` }, [STAR(), badge]);
  starBtn.addEventListener('click', () => onStars?.());
  const soundBtn = el('button', { type: 'button', class: 'xp-btn xp-icon', 'aria-pressed': String(sound), 'aria-label': 'Sound' }, [el('span', { 'aria-hidden': 'true', text: '♪' })]);
  soundBtn.addEventListener('click', () => onSound(soundBtn.getAttribute('aria-pressed') !== 'true'));
  const musicBtn = el('button', { type: 'button', class: 'xp-btn xp-icon', 'aria-pressed': String(music), 'aria-label': 'Music' }, [el('span', { 'aria-hidden': 'true', text: '♫' })]);
  musicBtn.addEventListener('click', () => onMusic?.(musicBtn.getAttribute('aria-pressed') !== 'true'));
  const timeBtn = el('button', { type: 'button', class: 'xp-btn', 'aria-pressed': String(night), 'aria-label': 'Night' }, [el('span', { text: night ? 'Night' : 'Golden hour' })]);
  timeBtn.addEventListener('click', () => onTime(timeBtn.getAttribute('aria-pressed') !== 'true'));
  const qSelect = el('select', { class: 'xp-select', 'aria-label': 'Graphics quality' }, [el('option', { value: 'auto', text: 'Auto' }), ...tiers.map((t) => el('option', { value: t, text: t[0] + t.slice(1).toLowerCase() }))]);
  qSelect.value = quality;
  qSelect.addEventListener('change', () => onQuality(qSelect.value));

  const chips = zones.map((z) => {
    const b = el('button', { type: 'button', class: 'xp-chip', 'data-zone': z.zone }, [el('span', { text: z.title })]);
    b.addEventListener('click', () => onTravel(z));
    return b;
  });

  const top = el('div', { class: 'xp-top' }, [
    el('div', { class: 'xp-top__left' }, [el('span', { class: 'xp-logo' }, [STAR(), el('span', { text: 'UMER' })])]),
    el('div', { class: 'xp-top__right' }, [starBtn, soundBtn, musicBtn, timeBtn, qSelect]),
  ]);
  // The control legend follows the mode (P3.4): on foot or in the saddle.
  const LEGEND = {
    walk: touch ? 'Stick to walk · drag to look · Open to enter a building · Whistle for your horse' : 'WASD / arrows walk · Shift run · Space jump · E open · H whistle · drag or click to look (Esc releases)',
    ride: touch ? 'Stick up: faster · down: slower / back · left / right: turn · Open to dismount' : 'W / ↑ faster · S / ↓ slower, back · A D / ← → turn · E dismount · drag or click to look',
  };
  const legendText = el('span', { text: LEGEND.walk });
  const legend = el('p', { class: 'xp-legend', 'data-legend': 'walk' }, [legendText]);
  const notice = el('p', { class: 'xp-notice', text: 'Everything here is also in the Classic portfolio.' });
  // One scrolling row (never wraps into the legend or the prompt); the fade marks the hidden side.
  const zoneNav = el('nav', { class: 'xp-zones is-start', 'aria-label': 'Fast travel to a building' }, chips);
  const updateFade = () => {
    const max = zoneNav.scrollWidth - zoneNav.clientWidth;
    zoneNav.classList.toggle('is-start', zoneNav.scrollLeft <= 2);
    zoneNav.classList.toggle('is-end', zoneNav.scrollLeft >= max - 2);
  };
  zoneNav.addEventListener('scroll', updateFade, { passive: true });
  const fadeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(updateFade) : null;
  fadeObserver?.observe(zoneNav);
  const replay = el('button', { type: 'button', class: 'xp-link' }, [el('span', { text: 'Replay arrival' })]);
  replay.addEventListener('click', () => onReplay?.());
  const bottom = el('div', { class: 'xp-bottom' }, [zoneNav, el('div', { class: 'xp-bottom__meta' }, [legend, el('span', { class: 'xp-bottom__end' }, [replay, notice])])]);
  // A short line for things the sheriff should know ("Your horse can't reach you here").
  const toast = el('p', { class: 'xp-toast', role: 'status' });
  toast.hidden = true;
  let toastTimer = 0;

  // ── Prompt, arrow, announcer ──
  const promptTitle = el('span', { class: 'xp-prompt__title' });
  const promptBtn = el('button', { type: 'button', class: 'xp-prompt' }, [el('kbd', { text: touch ? 'Tap' : 'E' }), promptTitle]);
  promptBtn.hidden = true;
  promptBtn.addEventListener('click', () => onInteract());
  const arrow = el('div', { class: 'xp-arrow', 'aria-hidden': 'true' }, [el('span', { class: 'xp-arrow__tip' }), el('span', { class: 'xp-arrow__label' })]);
  const announcer = el('p', { class: 'sr-only', 'aria-live': 'polite', role: 'status' });

  // ── Tutorial ──
  const caps = new Map();
  const capEls = KEYCAPS.map(([, label, action]) => {
    const c = el('kbd', { class: `xp-key${label.length > 1 ? ' xp-key--wide' : ''}`, text: label });
    caps.set(action, c);
    return c;
  });
  const skip = el('button', { type: 'button', class: 'xp-btn', 'data-tutorial-skip': true }, [el('span', { text: 'Skip' })]);
  const tutorial = el('div', { class: 'xp-tutorial', role: 'region', 'aria-label': 'Controls tutorial' }, [
    el('p', { class: 'xp-eyebrow', text: 'Learn the ropes' }),
    el('p', { class: 'xp-tutorial__title', text: touch ? 'Use the stick to walk, the buttons to run and jump' : 'Walk, run and jump to get going' }),
    el('div', { class: 'xp-keys' }, touch ? [] : [el('div', { class: 'xp-keys__row' }, [capEls[0]]), el('div', { class: 'xp-keys__row' }, capEls.slice(1, 4)), el('div', { class: 'xp-keys__row' }, capEls.slice(4))]),
    skip,
  ]);
  tutorial.hidden = !showTutorial;
  skip.addEventListener('click', () => onSkipTutorial());

  // ── Touch controls ──
  const knob = el('span', { class: 'xp-stick__knob' });
  const stickBase = el('div', { class: 'xp-stick', 'aria-hidden': 'true' }, [knob]);
  const jumpBtn = el('button', { type: 'button', class: 'xp-touch xp-touch--jump', 'aria-label': 'Jump' }, [el('span', { text: 'Jump' })]);
  const runBtn = el('button', { type: 'button', class: 'xp-touch xp-touch--run', 'aria-label': 'Run', 'aria-pressed': 'false' }, [el('span', { text: 'Run' })]);
  const useBtn = el('button', { type: 'button', class: 'xp-touch xp-touch--use', 'aria-label': 'Open' }, [el('span', { text: 'Open' })]);
  const whistleBtn = el('button', { type: 'button', class: 'xp-touch xp-touch--whistle', 'aria-label': 'Whistle for your horse' }, [el('span', { text: 'Whistle' })]);
  const touchLayer = el('div', { class: 'xp-touchpad' }, [stickBase, el('div', { class: 'xp-touch__buttons' }, [whistleBtn, runBtn, jumpBtn, useBtn])]);
  touchLayer.hidden = !touch;

  const debugBox = el('pre', { class: 'xp-debug', 'aria-hidden': 'true' });
  debugBox.hidden = !debug;

  const hud = el('div', { class: 'xp-hud' }, [top, bottom, promptBtn, toast, arrow, tutorial, touchLayer]);
  hud.hidden = true;
  // Order matters: Back to Classic is the first focusable element and is visible during loading too.
  root.append(back, canvasHost, hud, loader, announcer, debugBox);
  document.body.append(root);

  return {
    root,
    canvasHost,
    back,
    hud,
    starButton: starBtn,
    surface: canvasHost,
    touchEls: { joystickBase: stickBase, joystickKnob: knob, buttons: { jump: jumpBtn, run: runBtn, interact: useBtn, whistle: whistleBtn } },
    setProgress(v) {
      bar.style.transform = `scaleX(${v / 100})`;
      pct.textContent = `${v}%`;
      progress.setAttribute('aria-valuenow', String(v));
    },
    loaderMessage(text) {
      loaderMsg.textContent = text;
    },
    showError(text) {
      loader.hidden = false;
      loaderMsg.textContent = text;
      loader.classList.add('is-error');
      pct.textContent = '';
      const btn = el('button', { type: 'button', class: 'xp-btn xp-btn--ink' }, [el('span', { text: 'Back to Classic' })]);
      btn.addEventListener('click', onExit);
      loader.querySelector('.xp-loader__card').append(btn);
      btn.focus();
    },
    ready() {
      loader.classList.add('is-done');
      hud.hidden = false;
      setTimeout(() => {
        loader.hidden = true;
      }, 700);
      canvasHost.focus({ preventScroll: true });
    },
    announce(text) {
      announcer.textContent = '';
      requestAnimationFrame(() => {
        announcer.textContent = text;
      });
    },
    setPrompt(zone) {
      promptBtn.hidden = !zone;
      if (zone) promptTitle.textContent = zone.title;
      for (const c of chips) c.classList.toggle('is-near', Boolean(zone) && c.dataset.zone === zone.zone);
    },
    setArrow(angle, label) {
      if (angle === null) {
        arrow.hidden = true;
        return;
      }
      arrow.hidden = false;
      arrow.style.transform = `rotate(${angle}rad)`;
      arrow.lastChild.style.rotate = `${-angle}rad`; // label stays upright
      arrow.lastChild.textContent = label;
    },
    /** Earned stars: the counter, its label and a star on each chip. */
    setStars(earned) {
      badge.textContent = `${earned.size}/${zones.length}`;
      starBtn.setAttribute('aria-label', `Stars: ${earned.size} of ${zones.length}. ${earned.size === zones.length ? "Open the Deputy's Commission" : 'Open the case board'}`);
      starBtn.classList.toggle('is-complete', earned.size === zones.length);
      for (const c of chips) c.classList.toggle('is-visited', earned.has(c.dataset.zone));
    },
    /** Hide the HUD chrome during the Case Closed ceremony. */
    setCinematic(on) {
      root.classList.toggle('is-cinematic', on);
    },
    keycap(action, down) {
      caps.get(action)?.classList.toggle('is-down', down);
      if (down) caps.get(action)?.classList.add('is-done');
    },
    tutorialDone() {
      return [...caps.values()].every((c) => c.classList.contains('is-done'));
    },
    hideTutorial() {
      tutorial.hidden = true;
    },
    setSound(on) {
      soundBtn.setAttribute('aria-pressed', String(on));
    },
    setMusic(on) {
      musicBtn.setAttribute('aria-pressed', String(on));
    },
    /** 'walk' | 'ride': the legend lists the controls for the current mode. */
    setLegend(mode) {
      const m = mode === 'ride' ? 'ride' : 'walk';
      if (legend.dataset.legend === m) return;
      legend.dataset.legend = m;
      legendText.textContent = LEGEND[m];
    },
    /** A short notice above the prompt for ~3.5 s, also announced. */
    notice(text) {
      toast.textContent = text;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.hidden = true;
      }, 3500);
    },
    setNight(on) {
      timeBtn.setAttribute('aria-pressed', String(on));
      timeBtn.setAttribute('aria-label', on ? 'Night' : 'Golden hour');
      timeBtn.firstChild.textContent = on ? 'Night' : 'Golden hour';
    },
    setQuality(q) {
      qSelect.value = q;
    },
    debug(text) {
      if (!debugBox.hidden) debugBox.textContent = text;
    },
    dispose() {
      fadeObserver?.disconnect();
      root.remove();
    },
  };
}
