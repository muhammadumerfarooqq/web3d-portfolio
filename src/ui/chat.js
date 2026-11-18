// P5 "Ask my AI" (lazy chunk, loaded by chat-loader.js when the Ask my AI section nears the viewport).
// One component for Classic and Explore: the Saloon case file shows this same DOM.
// - Session: Turnstile (action "chat") is solved ONCE, exchanged at GET /api/chat-token for a 1-hour session
//   token, which every POST /api/chat carries. The Turnstile script loads only when the panel is on screen.
// - Rendering: text nodes only (textContent / createElement), never HTML strings. Citations [n] become
//   numbered marks; sources become chips that open the cited section or project modal.
// - Keyboard: Enter sends, Shift+Enter adds a line, Esc closes "How this works". Answers land in a polite
//   live region; status messages (typing, errors) in a role=status line.
// - Explore: the sheriff thinks / talks / nods through a "chatstate" window event, and source chips ask
//   Explore (cancelable "chatsource" event) to switch to Classic at the cited anchor.
import { chatRequestSchema, CHAT_LIMITS, looksUrdu } from '../shared/chat-schema.js';
import { SITE_KEY, loadTurnstile, turnstileTheme } from './turnstile.js';

export const CHAT_MESSAGES = {
  thinking: 'Checking the case files…',
  verifying: 'Checking you are human (one moment)…',
  verifyFailed: 'The anti-spam check did not pass. Please try again.',
  network: 'Could not reach the sheriff. Check your connection and try again.',
  busy: 'The AI is busy right now. Please try again in a moment.',
  resting: 'The AI is resting today (the daily limit is reached). Please try again tomorrow, or send me a telegram.',
  server: 'Something went wrong on my side. Please try again, or send me a telegram.',
  rateLimited: (seconds) => {
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return `You are asking quickly, partner. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`;
  },
};

/** What to show for a server response (pure; tested). */
export function chatOutcome(status, body = {}, retryAfter = null) {
  if (status === 200 && body.ok) return { kind: 'answer', answer: String(body.answer ?? ''), sources: Array.isArray(body.sources) ? body.sources : [], refused: Boolean(body.refused) };
  if (status === 401) return { kind: 'session' };
  if (status === 400 && body.fields?.message) return { kind: 'field', text: body.fields.message };
  if (status === 429) return { kind: 'status', text: CHAT_MESSAGES.rateLimited(Number(retryAfter) || Number(body.retryAfter) || 600) };
  if (status === 503 && body.error === 'resting') return { kind: 'status', text: CHAT_MESSAGES.resting };
  if (status === 503) return { kind: 'unavailable' };
  if (status === 502) return { kind: 'status', text: CHAT_MESSAGES.busy };
  return { kind: 'status', text: CHAT_MESSAGES.server };
}

/** Split an answer into text and citation parts: [{ text } | { cite: n }] (pure; tested). */
export function answerParts(answer) {
  const parts = [];
  let last = 0;
  for (const m of String(answer).matchAll(/\[(\d{1,2})\]/g)) {
    if (m.index > last) parts.push({ text: answer.slice(last, m.index) });
    parts.push({ cite: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < answer.length) parts.push({ text: answer.slice(last) });
  return parts;
}

const SAFE_ANCHOR = /^[a-z0-9-]{1,80}$/;
const emit = (state, extra = {}) => window.dispatchEvent(new CustomEvent('chatstate', { detail: { state, ...extra } }));

export function initChat(box) {
  if (!box || box.dataset.chatReady) return;
  box.dataset.chatReady = 'true';
  const $ = (sel) => box.querySelector(sel);
  const panel = $('[data-chat-panel]');
  const fallback = $('[data-chat-fallback]');
  const unavailableNote = $('[data-chat-unavailable]');
  const log = $('[data-chat-log]');
  const typing = $('[data-chat-typing]');
  const status = $('[data-chat-status]');
  const form = $('[data-chat-form]');
  const input = $('#chat-input');
  const send = $('[data-chat-send]');
  const sendLabel = $('[data-chat-send-label]');
  const error = $('[data-chat-error]');
  const holder = $('[data-chat-turnstile]');
  const how = $('[data-chat-how]');
  if (!panel || !form || !input || !log) return;

  if (fallback) fallback.hidden = true;
  if (!SITE_KEY) {
    if (unavailableNote) unavailableNote.hidden = false;
    return;
  }
  panel.hidden = false;

  let lang = 'en';
  let session = '';
  let sessionExp = 0;
  let token = '';
  let tokenWaiters = [];
  let widgetId = null;
  let widgetHost = null;
  let sending = false;
  let unavailable = false;
  const history = [];

  const setStatus = (text, tone = 'info') => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  function showUnavailable() {
    unavailable = true;
    panel.hidden = true;
    if (unavailableNote) unavailableNote.hidden = false;
    if (widgetId !== null) window.turnstile?.remove(widgetId);
    widgetId = null;
  }

  // ── language ──
  const langButtons = [...box.querySelectorAll('[data-chat-lang]')];
  function setLang(next) {
    lang = ['en', 'ur', 'roman'].includes(next) ? next : 'en';
    for (const b of langButtons) b.setAttribute('aria-pressed', String(b.dataset.chatLang === lang));
    input.dir = lang === 'ur' ? 'rtl' : 'auto';
    input.lang = lang === 'ur' ? 'ur' : 'en';
  }
  for (const b of langButtons) b.addEventListener('click', () => setLang(b.dataset.chatLang));

  // ── Turnstile → session ──
  const hostOf = () => (box.closest('dialog') ? 'dialog' : 'page');
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
      action: 'chat',
      theme: turnstileTheme(),
      size: 'flexible',
      appearance: 'interaction-only',
      'refresh-expired': 'auto',
      callback: (value) => {
        token = value;
        const waiters = tokenWaiters;
        tokenWaiters = [];
        for (const w of waiters) w(value);
      },
      'expired-callback': () => {
        token = '';
      },
      'error-callback': () => {
        token = '';
        return true;
      },
    });
  }
  function ensureWidget() {
    if (unavailable) return Promise.resolve();
    return loadTurnstile()
      .then(() => {
        if (widgetId === null || widgetHost !== hostOf()) renderWidget();
      })
      .catch(() => setStatus(CHAT_MESSAGES.verifyFailed, 'error'));
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) ensureWidget();
    }).observe(panel);
  } else ensureWidget();
  window.addEventListener('themechange', () => {
    if (widgetId !== null) renderWidget();
  });

  const waitForToken = (ms) =>
    token
      ? Promise.resolve(token)
      : new Promise((resolve) => {
          const timer = setTimeout(() => resolve(''), ms);
          tokenWaiters.push((v) => {
            clearTimeout(timer);
            resolve(v);
          });
        });

  async function getSession() {
    if (session && Date.now() < sessionExp - 60_000) return session;
    await ensureWidget();
    setStatus(CHAT_MESSAGES.verifying);
    const value = await waitForToken(20000);
    if (!value) return '';
    token = '';
    if (widgetId !== null) window.turnstile?.reset(widgetId); // single use: get a fresh one ready
    try {
      const res = await fetch('/api/chat-token', { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Turnstile-Token': value } });
      if (res.status === 503) {
        showUnavailable();
        return '';
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.session) return '';
      session = body.session;
      sessionExp = Date.now() + (Number(body.expiresIn) || 3600) * 1000;
      return session;
    } catch {
      return '';
    }
  }

  // ── rendering (DOM nodes only) ──
  function message(role, text, { sources = [], refused = false } = {}) {
    const li = document.createElement('li');
    li.className = `chat__msg chat__msg--${role}${refused ? ' is-refused' : ''}`;
    const who = document.createElement('p');
    who.className = 'chat__who';
    who.textContent = role === 'user' ? 'You' : 'Umer’s AI twin';
    const bodyEl = document.createElement('div');
    bodyEl.className = 'chat__body';
    if (looksUrdu(text)) {
      bodyEl.dir = 'rtl';
      bodyEl.lang = 'ur';
    } else bodyEl.dir = 'auto';
    for (const para of String(text).split(/\n{1,}/).filter((p) => p.trim())) {
      const p = document.createElement('p');
      for (const part of answerParts(para)) {
        if (part.cite && sources[part.cite - 1]) {
          const mark = document.createElement('sup');
          mark.className = 'chat__cite';
          mark.textContent = `[${part.cite}]`;
          mark.title = sources[part.cite - 1].title ?? '';
          p.append(mark);
        } else if (part.text !== undefined) p.append(document.createTextNode(part.text));
      }
      bodyEl.append(p);
    }
    li.append(who, bodyEl);
    const valid = sources.filter((s) => s && SAFE_ANCHOR.test(String(s.anchor)));
    if (valid.length) {
      const label = document.createElement('p');
      label.className = 'chat__sources-label';
      label.textContent = 'Sources';
      const ul = document.createElement('ul');
      ul.className = 'chat__sources';
      valid.forEach((s, i) => {
        const a = document.createElement('a');
        a.className = 'chip chat__source';
        a.href = `#${s.anchor}`;
        a.textContent = `${i + 1} · ${s.title ?? s.anchor}`;
        a.addEventListener('click', (event) => {
          // Explore takes the visitor to Classic at the anchor; Classic just follows the link (the
          // project modal opens for #project-… anchors, other anchors scroll to their section).
          const ask = new CustomEvent('chatsource', { detail: { anchor: s.anchor }, cancelable: true });
          if (!window.dispatchEvent(ask)) event.preventDefault();
        });
        const item = document.createElement('li');
        item.append(a);
        ul.append(item);
      });
      li.append(label, ul);
    }
    log.append(li);
    li.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    return li;
  }

  function remember(role, content) {
    history.push({ role, content: String(content).slice(0, CHAT_LIMITS.turn) });
    while (history.length > CHAT_LIMITS.history) history.shift();
  }

  function setSending(on) {
    sending = on;
    send.disabled = on;
    form.setAttribute('aria-busy', String(on));
    form.classList.toggle('is-sending', on);
    typing.hidden = !on;
    sendLabel.textContent = on ? 'Asking…' : 'Ask';
  }

  function showError(text) {
    error.textContent = text ?? '';
    error.hidden = !text;
    if (text) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  async function ask(rawText, askLang = lang) {
    if (sending || unavailable) return;
    const text = String(rawText ?? '').replace(/\r\n?/g, '\n').trim();
    const check = chatRequestSchema.safeParse({ message: text, history: [...history], lang: askLang, session: '' });
    if (!check.success) {
      showError(check.error.issues.find((i) => i.path[0] === 'message')?.message ?? 'Please check your question.');
      input.focus();
      return;
    }
    showError('');
    setSending(true);
    setStatus(CHAT_MESSAGES.thinking);
    emit('thinking');
    const sess = await getSession();
    if (!sess) {
      setSending(false);
      emit('idle');
      if (!unavailable) setStatus(CHAT_MESSAGES.verifyFailed, 'error');
      return;
    }
    setStatus(CHAT_MESSAGES.thinking);
    message('user', text);
    input.value = '';

    const post = () =>
      fetch('/api/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: [...history], lang: askLang, session }),
      });
    let res;
    let body = {};
    try {
      res = await post();
      if (res.status === 401) {
        session = ''; // expired or another IP: verify again once
        if (await getSession()) res = await post();
      }
      body = await res.json().catch(() => ({}));
    } catch {
      setSending(false);
      emit('idle');
      setStatus(CHAT_MESSAGES.network, 'error');
      return;
    }
    setSending(false);
    const o = chatOutcome(res.status, body, res.headers.get('Retry-After'));
    if (o.kind === 'answer') {
      setStatus('');
      message('assistant', o.answer, { sources: o.sources, refused: o.refused });
      remember('user', text);
      remember('assistant', o.answer);
      emit('answer', { chars: o.answer.length });
    } else {
      emit('idle');
      if (o.kind === 'unavailable') showUnavailable();
      else if (o.kind === 'field') showError(o.text);
      else setStatus(o.kind === 'session' ? CHAT_MESSAGES.verifyFailed : o.text, 'error');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    ask(input.value);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      ask(input.value);
    }
  });
  for (const chip of box.querySelectorAll('[data-chat-ask]')) {
    chip.addEventListener('click', () => {
      if (chip.dataset.chatAskLang) setLang(chip.dataset.chatAskLang);
      ask(chip.textContent, chip.dataset.chatAskLang ?? lang);
    });
  }
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && how?.open) {
      how.open = false;
      how.querySelector('summary')?.focus();
      event.preventDefault(); // the Explore dialog stays open (Esc would also cancel it)
      event.stopPropagation();
    }
  });
}
