// Runs in <head> before the stylesheet so the first paint already has the right theme (no flash).
// Classic script on purpose: no inline <script>, so a strict CSP can allow it as 'self'.
(function () {
  var root = document.documentElement;
  var theme = null;

  // Only the two known values are ever accepted from storage.
  try {
    var stored = window.localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') theme = stored;
  } catch (e) {
    // Storage blocked (privacy mode, sandbox): fall through to the system preference.
  }

  if (theme !== 'light' && theme !== 'dark') {
    var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    theme = prefersLight ? 'light' : 'dark';
  }
  root.setAttribute('data-theme', theme);

  // Reveal targets stay hidden until src/ui/motion.js has set their start states.
  // Skipped under reduced motion; failsafe shows everything if the motion module never loads.
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion) {
    root.classList.add('js');
    window.setTimeout(function () {
      if (root.getAttribute('data-motion') !== 'ready') root.classList.remove('js');
    }, 4000);
  }
})();
