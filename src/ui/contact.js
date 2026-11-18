// P4 contact form (lazy chunk, loaded by contact-loader.js when the Telegraph section nears the
// viewport). One component for Classic and Explore: Explore's Telegraph case file shows this same DOM.
// - Validation: the SAME zod schema as the server (src/shared/contact-schema.js); inline errors linked
//   with aria-describedby, aria-invalid, and an error summary that takes focus on a failed submit.
// - Cloudflare Turnstile: its script loads only once the form itself is on screen; the theme follows the
//   site theme (day = light, night = dark); expiry, errors, theme changes and the form moving between
//   the page and the Explore dialog re-render it. Tokens are single use: reset after every attempt.
// - Spam layers handled by the server: honeypot (hidden field), time trap (a signed stamp fetched when
//   the form renders), Turnstile, rate limit. No-JS / no site key / 503 → the email link only.
// DOM is built with createElement / textContent only.
import { LIMITS, validateContact } from '../shared/contact-schema.js';

export const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';
const FIELDS = ['name', 'email', 'subject', 'message'];

export const MESSAGES = {
  sending: 'Sending your telegram…',
  needCheck: 'Please complete the anti-spam check above, then send again.',
  checkError: 'The anti-spam check could not load. Please try again in a moment, or email me directly.',
  tooFast: 'That was quick! Please wait a few seconds and send again.',
  stale: 'This form was open for a long time, so it has been refreshed. Please send again.',
  verification: 'The anti-spam check did not pass. Please complete it again and resend.',
  server: 'Something went wrong on my side. Please try again, or email me directly.',
  network: 'Could not reach the telegraph office. Check your connection and try again.',
  rateLimited: (seconds) => {
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    const wait = minutes >= 90 ? `${Math.ceil(minutes / 60)} hours` : `${minutes} minute${minutes === 1 ? '' : 's'}`;
    return `You have sent several telegrams already. Please try again in ${wait}, or email me directly.`;
  },
  summary: (n) => `Please fix ${n === 1 ? 'this problem' : `these ${n} problems`} before sending:`,
};

/** What to show for a server response: { kind: 'success' | 'fields' | 'status' | 'unavailable', … }. */
export function outcome(status, body = {}, retryAfter = null) {
  if (status === 200 && body.ok) return { kind: 'success' };
  if (status === 400 && body.error === 'invalid' && body.fields) return { kind: 'fields', fields: body.fields };
  if (status === 400 && body.error === 'too_fast') return { kind: 'status', text: MESSAGES.tooFast };
  if (status === 400 && body.error === 'stale_form') return { kind: 'status', text: MESSAGES.stale, refresh: true };
  if (status === 400 && body.error === 'verification_failed') return { kind: 'status', text: MESSAGES.verification };
  if (status === 429) return { kind: 'status', text: MESSAGES.rateLimited(Number(retryAfter) || Number(body.retryAfter) || 3600) };
  if (status === 503) return { kind: 'unavailable' };
  return { kind: 'status', text: MESSAGES.server };
}

let scriptPromise = null;
function loadTurnstile() {
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

const themeNow = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

export function initContact(box) {
  if (!box || box.dataset.contactReady) return;
  box.dataset.contactReady = 'true';
  const form = box.querySelector('[data-contact-form]');
  const notice = box.querySelector('[data-contact-unavailable]');
  const success = box.querySelector('[data-contact-success]');
  if (!form || !success) return;
  const $ = (sel) => form.querySelector(sel);
  const summary = $('[data-contact-summary]');
  const summaryTitle = $('[data-contact-summary-title]');
  const summaryList = $('[data-contact-summary-list]');
  const status = $('[data-contact-status]');
  const submit = $('[data-contact-submit]');
  const submitLabel = $('[data-contact-submit-label]');
  const holder = $('[data-turnstile]');
  const count = $('[data-contact-count]');
  const field = (name) => form.elements.namedItem(name);

  let stamp = '';
  let token = '';
  let widgetId = null;
  let widgetHost = null;
  let attempted = false;
  let sending = false;
  let unavailable = false;

  function setStatus(text, tone = 'info') {
    status.textContent = text;
    status.dataset.tone = tone;
  }

  function showUnavailable() {
    unavailable = true;
    form.hidden = true;
    success.hidden = true;
    if (notice) notice.hidden = false;
    if (widgetId !== null) window.turnstile?.remove(widgetId);
    widgetId = null;
  }

  if (!SITE_KEY) return showUnavailable();
  form.hidden = false;

  async function refreshStamp() {
    try {
      const res = await fetch('/api/contact-token', { credentials: 'same-origin', cache: 'no-store' });
      if (res.status === 503) return showUnavailable();
      const body = await res.json();
      if (res.ok && body.stamp) stamp = body.stamp;
    } catch {
      stamp = ''; // the server answers stale_form and the next attempt fetches a fresh one
    }
  }

  // ── Turnstile ──
  const hostOf = () => (form.closest('dialog') ? 'dialog' : 'page');
  function renderWidget() {
    const t = window.turnstile;
    if (!t || unavailable) return;
    if (widgetId !== null) {
      try {
        t.remove(widgetId);
      } catch {
        /* already gone */
      }
    }
    holder.replaceChildren();
    token = '';
    widgetHost = hostOf();
    widgetId = t.render(holder, {
      sitekey: SITE_KEY,
      action: 'contact',
      theme: themeNow(),
      size: 'flexible',
      'refresh-expired': 'manual',
      callback: (value) => {
        token = value;
        if (status.textContent === MESSAGES.needCheck || status.textContent === MESSAGES.checkError) setStatus('');
      },
      'expired-callback': () => {
        token = '';
        t.reset(widgetId);
      },
      'timeout-callback': () => {
        token = '';
        t.reset(widgetId);
      },
      'error-callback': () => {
        token = '';
        setStatus(MESSAGES.checkError, 'error');
        return true; // handled: no console noise; Turnstile retries on its own
      },
    });
  }
  function ensureWidget() {
    if (unavailable) return;
    loadTurnstile()
      .then(() => {
        if (widgetId === null || widgetHost !== hostOf()) renderWidget();
      })
      .catch(() => setStatus(MESSAGES.checkError, 'error'));
  }
  function resetWidget() {
    token = '';
    if (widgetId !== null) window.turnstile?.reset(widgetId);
  }
  // Load when the form is actually on screen (in the page, or in Explore's Telegraph case file); a move
  // between the two reloads the widget's iframe, so it is rendered again there.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) ensureWidget();
    }).observe(form);
  } else ensureWidget();
  window.addEventListener('themechange', () => {
    if (widgetId !== null) renderWidget();
  });

  // ── errors ──
  function setFieldError(name, message) {
    const input = field(name);
    const error = form.querySelector(`[data-error-for="${name}"]`);
    if (!input || !error) return;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    error.textContent = message ?? '';
    error.hidden = !message;
  }
  function renderSummary(errors, focus) {
    const names = FIELDS.filter((n) => errors[n]);
    summaryList.replaceChildren(
      ...names.map((n) => {
        const a = document.createElement('a');
        a.href = `#${field(n).id}`;
        a.textContent = errors[n];
        a.addEventListener('click', (e) => {
          e.preventDefault();
          field(n).focus();
        });
        const li = document.createElement('li');
        li.append(a);
        return li;
      }),
    );
    summaryTitle.textContent = MESSAGES.summary(names.length);
    summary.hidden = names.length === 0;
    if (focus && names.length) summary.focus();
  }
  function showErrors(errors, focus) {
    for (const n of FIELDS) setFieldError(n, errors[n]);
    renderSummary(errors, focus);
  }
  const values = () => Object.fromEntries(FIELDS.map((n) => [n, field(n).value]));

  // After a first attempt, errors update as the visitor fixes each field (on blur).
  for (const n of FIELDS) {
    field(n).addEventListener('blur', () => {
      if (!attempted) return;
      const r = validateContact(values());
      const errors = r.ok ? {} : r.errors;
      setFieldError(n, errors[n]);
      if (!summary.hidden) renderSummary(errors, false);
    });
  }
  const syncCount = () => {
    if (count) count.textContent = `${field('message').value.length} / ${LIMITS.message[1]}`;
  };
  field('message').addEventListener('input', syncCount);
  syncCount();

  function setSending(on) {
    sending = on;
    submit.disabled = on;
    form.setAttribute('aria-busy', String(on));
    form.classList.toggle('is-sending', on);
    submitLabel.textContent = on ? 'Sending…' : 'Send telegram';
  }

  function showSuccess() {
    form.reset();
    form.hidden = true;
    success.hidden = false;
    success.focus();
    refreshStamp();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || unavailable) return;
    attempted = true;
    const r = validateContact(values());
    if (!r.ok) {
      setStatus('');
      showErrors(r.errors, true);
      return;
    }
    showErrors({}, false);
    if (!token) {
      setStatus(MESSAGES.needCheck, 'error');
      ensureWidget();
      return;
    }
    setSending(true);
    setStatus(MESSAGES.sending);
    let res;
    let body = {};
    try {
      res = await fetch('/api/contact', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...r.data, website: field('website')?.value ?? '', stamp, token }),
      });
      body = await res.json().catch(() => ({}));
    } catch {
      setSending(false);
      resetWidget();
      setStatus(MESSAGES.network, 'error');
      return;
    }
    setSending(false);
    resetWidget();
    const o = outcome(res.status, body, res.headers.get('Retry-After'));
    if (o.kind === 'success') {
      setStatus('');
      attempted = false;
      showSuccess();
    } else if (o.kind === 'fields') {
      setStatus('');
      showErrors(o.fields, true);
    } else if (o.kind === 'unavailable') showUnavailable();
    else {
      if (o.refresh) await refreshStamp();
      setStatus(o.text, 'error');
    }
  });

  form.addEventListener('reset', () => {
    setTimeout(() => {
      attempted = false;
      showErrors({}, false);
      setStatus('');
      syncCount();
    });
  });

  box.querySelector('[data-contact-again]')?.addEventListener('click', () => {
    success.hidden = true;
    form.hidden = false;
    field('name').focus();
    ensureWidget();
  });

  refreshStamp();
}
