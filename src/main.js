// Portfolio entry (Classic mode shell). The 3D island and section content arrive in P2.2/P3.
import { initCursor } from './ui/cursor.js';
import { initHud } from './ui/hud.js';
import { initMagnetic } from './ui/magnetic.js';
import { initMenu } from './ui/menu.js';
import { initMotion } from './ui/motion.js';
import { initNav } from './ui/nav.js';
import { initSound } from './ui/sound.js';
import { initTheme } from './ui/theme.js';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// One failing module must not take the rest of the shell down with it.
function safely(name, init) {
  try {
    init({ reduced });
  } catch (error) {
    console.error(`[${name}] failed to initialise`, error);
  }
}

safely('theme', initTheme);
safely('sound', initSound);
safely('motion', initMotion); // before nav/menu: they use the Lenis instance
safely('nav', initNav);
safely('menu', initMenu);
safely('hud', initHud);
safely('cursor', initCursor);
safely('magnetic', initMagnetic);

for (const el of document.querySelectorAll('[data-year]')) el.textContent = String(new Date().getFullYear());

// Reveal start states are set: let theme-init.js's hidden-until-ready rule go.
document.documentElement.dataset.motion = 'ready';
