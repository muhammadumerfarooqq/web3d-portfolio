// Runs in <head> before the stylesheet so the first paint already has the right theme (no flash).
// Classic script on purpose: no inline <script>, so a strict CSP can allow it as 'self'.
(function () {
  var root = document.documentElement;
  var theme = null;
  var introSeen = false;

  // Only known values are ever accepted from storage.
  try {
    var stored = window.localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') theme = stored;
  } catch (e) {
    // Storage blocked (privacy mode, sandbox): fall through to the system preference.
  }
  // P3.4b: the opening plays once per browser session (sessionStorage "intro"), and ?replay=1 forces
  // it. Mirrors introSeenThisSession() in src/ui/boot-rules.js; start.js then owns html[data-boot].
  try {
    var replay = /(?:^\?|&)replay=1(?:&|$)/.test(window.location.search);
    introSeen = !replay && window.sessionStorage.getItem('intro') === 'seen';
  } catch (e) {
    introSeen = false; // no session storage: treat as a new session
  }

  if (theme !== 'light' && theme !== 'dark') {
    var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    theme = prefersLight ? 'light' : 'dark';
  }
  root.setAttribute('data-theme', theme);

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Boot layer (src/ui/start.js): first visit with motion → the intro covers the page from the first
  // frame; otherwise straight to the start screen. Without JS this never runs and the Classic page shows.
  root.setAttribute('data-boot', introSeen || reduceMotion ? 'start' : 'intro');

  // Reveal targets stay hidden until src/ui/motion.js has set their start states (skipped under
  // reduced motion).
  if (!reduceMotion) root.classList.add('js');

  // Failsafes: if the module never loads (or stalls), show everything and drop the boot layer.
  // data-shell="ready" means start.js has taken over the boot layer; data-motion="ready" means
  // every reveal has its start state.
  window.setTimeout(function () {
    if (root.getAttribute('data-shell') !== 'ready') root.removeAttribute('data-boot');
    if (root.getAttribute('data-motion') !== 'ready') root.classList.remove('js');
  }, 4000);
})();
