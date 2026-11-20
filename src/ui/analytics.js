// P10 privacy-friendly analytics (first-party, cookie-less). One tiny beacon to same-origin POST /api/collect with
// {"e":"<event>"}: no id, no referrer, no path, no storage, no third-party script. Nothing is sent when the browser
// says Do Not Track or Global Privacy Control. It never blocks the UI and never throws. Used by Classic and its lazy
// chunks only; the Explore chunk does not import it (Explore entry is counted through the "modechange" event).
import { ANALYTICS_EVENTS } from '../shared/analytics-events.js';

/** false when Do Not Track or Global Privacy Control is on. */
export function trackingAllowed(nav = globalThis.navigator, win = globalThis.window) {
  const dnt = nav?.doNotTrack ?? win?.doNotTrack ?? nav?.msDoNotTrack;
  if (dnt === '1' || dnt === 'yes' || dnt === 1) return false;
  if (nav?.globalPrivacyControl === true) return false;
  return true;
}

const sentOnce = new Set();

/** Count one event (a name from the allow-list). `once` = at most once per page load. */
export function track(event, { once = false } = {}) {
  try {
    if (!ANALYTICS_EVENTS.includes(event) || !trackingAllowed()) return false;
    // Development and preview runs on this computer are not visitors.
    if (/^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(globalThis.location?.hostname ?? '')) return false;
    if (once) {
      if (sentOnce.has(event)) return false;
      sentOnce.add(event);
    }
    const body = JSON.stringify({ e: event });
    if (navigator.sendBeacon?.('/api/collect', new Blob([body], { type: 'application/json' }))) return true;
    fetch('/api/collect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'omit', cache: 'no-store' }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** Page load = pageview_classic; entering Explore = pageview_explore (via the mode event); data-event links (CV download). */
export function initAnalytics() {
  track('pageview_classic', { once: true });
  window.addEventListener('modechange', (e) => {
    if (e.detail?.mode === 'explore') track('pageview_explore');
  });
  document.addEventListener('click', (e) => {
    const link = e.target instanceof Element ? e.target.closest('a[data-event]') : null;
    if (link) track(link.getAttribute('data-event'));
  });
}
