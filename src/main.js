// Portfolio entry (Classic mode shell). The 3D island arrives in P3 through src/ui/mode.js.
import { initCursor } from './ui/cursor.js';
import { initHud } from './ui/hud.js';
import { initLightbox } from './ui/lightbox.js';
import { initMenu } from './ui/menu.js';
import { initMode } from './ui/mode.js';
import { initMotion, initRevealMotion, yieldToMain } from './ui/motion.js';
import { initNav } from './ui/nav.js';
import { initGallery } from './ui/projects/gallery.js';
import { initSound } from './ui/sound.js';
import { initStart } from './ui/start.js';
import { initTheme } from './ui/theme.js';
import { initTimeline } from './ui/timeline.js';
import { initPlayer } from './ui/video.js';
import { initContactLoader } from './ui/contact-loader.js';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;

// One failing module must not take the rest of the shell down with it.
async function safely(name, init) {
  try {
    await init({ reduced });
  } catch (error) {
    console.error(`[${name}] failed to initialise`, error);
  }
}

// Critical path: what the first screen needs.
const CRITICAL = [
  ['theme', initTheme],
  ['sound', initSound],
  ['motion', initMotion], // Lenis: before nav/menu/start, which use the instance
  ['nav', initNav],
  ['menu', initMenu],
  ['mode', initMode], // html[data-mode] + "modechange": the hook P3 uses
  ['start', initStart], // intro + start screen
];

// The rest, one module per task (and one reveal per task), so start-up never blocks input for long.
const DEFERRED = [
  ['reveals', initRevealMotion],
  ['hud', initHud],
  ['timeline', initTimeline],
  ['gallery', initGallery],
  ['lightbox', initLightbox],
  // Players in the #video section; project players are enhanced when their modal opens.
  ['video', () => document.querySelectorAll('#video [data-player]').forEach(initPlayer)],
  ['cursor', initCursor],
  ['contact', initContactLoader], // P4: the form chunk loads when the Telegraph section nears the viewport
];

for (const el of document.querySelectorAll('[data-year]')) el.textContent = String(new Date().getFullYear());

for (const [name, init] of CRITICAL) await safely(name, init);
root.dataset.shell = 'ready'; // theme-init.js failsafe: start.js now owns the boot layer

for (const [name, init] of DEFERRED) {
  await yieldToMain();
  await safely(name, init);
}

// Reveal start states are set: let theme-init.js's hidden-until-ready rule go.
root.dataset.motion = 'ready';
window.dispatchEvent(new CustomEvent('motionready')); // nav.js lines up a #section deep link after this
