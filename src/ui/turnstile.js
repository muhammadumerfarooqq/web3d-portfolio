// Cloudflare Turnstile loader shared by the contact form (P4) and the chat (P5). The script comes from
// the one third-party origin the CSP allows and is loaded once, only when a widget is actually needed.
export const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';

let scriptPromise = null;

export function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TURNSTILE_SRC;
    s.async = true;
    s.defer = true;
    s.addEventListener('load', () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile'))));
    s.addEventListener('error', () => {
      scriptPromise = null;
      s.remove();
      reject(new Error('turnstile'));
    });
    document.head.append(s);
  });
  return scriptPromise;
}

/** Turnstile's theme for the current site theme (day = light, night = dark). */
export const turnstileTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
