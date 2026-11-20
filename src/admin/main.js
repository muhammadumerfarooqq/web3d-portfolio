// P7 admin page. Plain DOM, text nodes only (no HTML strings). Everything goes through the same-origin /api/admin/*
// endpoints: this page never talks to Supabase. The access token lives in a module variable ONLY (no localStorage,
// no sessionStorage, no cookie): a reload means logging in again. 15 minutes without activity logs out
// (and revokes the session on the server). Views: login → TOTP (enrol or code) → tabs "Case order" and "Telegrams".
import { MESSAGE_STATUSES } from '../shared/admin-schema.js';
import { move } from '../shared/project-order.js';
import { SITE_KEY, loadTurnstile, turnstileTheme } from '../ui/turnstile.js';

const IDLE_MS = 15 * 60 * 1000;
const STATUS_LABEL = { new: 'New', reading: 'Reading', replied: 'Replied', archived: 'Archived' };
const root = document.querySelector('[data-admin-root]');

let token = '';
let idleTimer = 0;

/** createElement helper: attrs are set with setAttribute / properties, children are strings (text nodes) or nodes. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

const live = h('p', { class: 'admin-status', role: 'status', 'aria-live': 'polite' });
function say(text, tone = 'info') {
  live.textContent = text;
  live.dataset.tone = tone;
}

async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`/api/admin/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, retry: res.headers.get('Retry-After'), data };
  } catch {
    return { status: 0, retry: null, data: {} };
  }
}

// ───────────── session ─────────────
function resetIdle() {
  window.clearTimeout(idleTimer);
  if (!token) return;
  idleTimer = window.setTimeout(() => logout('You were signed out after 15 minutes without activity.'), IDLE_MS);
}
for (const type of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(type, resetIdle, { passive: true });

async function logout(message = 'Signed out.') {
  const t = token;
  token = '';
  window.clearTimeout(idleTimer);
  if (t) await fetch('/api/admin/logout', { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: '{}', credentials: 'omit' }).catch(() => {});
  showLogin(message);
}

function endSession() {
  token = '';
  window.clearTimeout(idleTimer);
  showLogin('Your session ended. Please sign in again.', 'error');
}

function mount(...nodes) {
  root.replaceChildren(...nodes);
}

const WAIT = (s) => `Too many attempts. Please wait ${Math.max(1, Math.ceil(Number(s) / 60) || 10)} minute(s) and try again.`;

// ───────────── login ─────────────
function showLogin(message = '', tone = 'info') {
  let widgetId = null;
  let captcha = '';
  let waiters = [];
  const email = h('input', { class: 'field__input', id: 'admin-email', name: 'email', type: 'email', autocomplete: 'username', required: true, maxlength: 254, spellcheck: 'false' });
  const password = h('input', { class: 'field__input', id: 'admin-password', name: 'password', type: 'password', autocomplete: 'current-password', required: true, maxlength: 200 });
  const holder = h('div', { class: 'admin-turnstile' });
  const submit = h('button', { class: 'btn btn--ink', type: 'submit' }, 'Sign in');

  const form = h(
    'form',
    { class: 'admin-card paper case-frame', novalidate: true, 'aria-labelledby': 'admin-login-title' },
    h('h2', { class: 'admin-card__title', id: 'admin-login-title' }, 'Sign in'),
    h('p', { class: 'admin-note' }, 'Only the owner can sign in. A code from your authenticator app is asked for next.'),
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'admin-email' }, 'Email'), email),
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'admin-password' }, 'Password'), password),
    holder,
    submit,
    live,
  );
  mount(form);
  say(message, tone);
  email.focus();

  const renderWidget = () =>
    loadTurnstile()
      .then((t) => {
        if (widgetId !== null) t.remove(widgetId);
        captcha = '';
        widgetId = t.render(holder, {
          sitekey: SITE_KEY,
          action: 'admin',
          theme: turnstileTheme(),
          appearance: 'interaction-only',
          'refresh-expired': 'auto',
          callback: (v) => {
            captcha = v;
            for (const w of waiters.splice(0)) w(v);
          },
          'expired-callback': () => {
            captcha = '';
          },
          'error-callback': () => {
            captcha = '';
            return true;
          },
        });
      })
      .catch(() => say('The anti-spam check could not load. Check your connection.', 'error'));
  if (SITE_KEY) renderWidget();
  else say('Sign-in is not available: the anti-spam key is missing.', 'error');

  const waitCaptcha = () => (captcha ? Promise.resolve(captcha) : new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(''), 20000);
    waiters.push((v) => {
      window.clearTimeout(timer);
      resolve(v);
    });
  }));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!SITE_KEY) return;
    if (!email.value.trim() || !password.value) return say('Enter your email and password.', 'error');
    submit.disabled = true;
    say('Checking you are human…');
    const value = await waitCaptcha();
    if (!value) {
      submit.disabled = false;
      return say('The anti-spam check did not finish. Try again.', 'error');
    }
    say('Signing in…');
    const { status, retry, data } = await api('login', { method: 'POST', body: { email: email.value.trim(), password: password.value, token: value } });
    password.value = '';
    if (status === 200 && data.ok && data.accessToken) {
      token = data.accessToken;
      resetIdle();
      if (widgetId !== null) window.turnstile?.remove(widgetId);
      return data.mfa === 'enroll' ? showEnroll() : showCode();
    }
    submit.disabled = false;
    renderWidget();
    if (status === 429) say(WAIT(retry), 'error');
    else if (status === 400 && data.error === 'verification_failed') say('The anti-spam check failed. Please try again.', 'error');
    else if (status === 503) say('Admin sign-in is not configured on the server.', 'error');
    else if (status === 0) say('Could not reach the server.', 'error');
    else say('Email or password not accepted.', 'error');
  });
}

// ───────────── TOTP ─────────────
function codeForm({ title, intro, extra = [], onSubmit }) {
  const code = h('input', { class: 'field__input admin-code', id: 'admin-code', name: 'code', inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: 6, autocomplete: 'one-time-code', required: true, 'aria-describedby': 'admin-code-hint' });
  const submit = h('button', { class: 'btn btn--ink', type: 'submit' }, 'Verify');
  const form = h(
    'form',
    { class: 'admin-card paper case-frame', novalidate: true, 'aria-labelledby': 'admin-code-title' },
    h('h2', { class: 'admin-card__title', id: 'admin-code-title' }, title),
    h('p', { class: 'admin-note' }, intro),
    ...extra,
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'admin-code' }, '6-digit code'), code, h('p', { class: 'field__hint', id: 'admin-code-hint' }, 'The code changes every 30 seconds.')),
    submit,
    h('button', { class: 'btn', type: 'button', onclick: () => logout('Signed out.') }, 'Cancel'),
    live,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = code.value.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(value)) return say('Enter the 6 digits from your app.', 'error');
    submit.disabled = true;
    say('Checking the code…');
    const result = await onSubmit(value);
    code.value = '';
    if (!result) {
      submit.disabled = false;
      code.focus();
    }
  });
  mount(form);
  code.focus();
  return form;
}

async function verifyCode(code, factorId) {
  const { status, retry, data } = await api('mfa/verify', { method: 'POST', auth: true, body: factorId ? { code, factorId } : { code } });
  if (status === 200 && data.ok && data.accessToken) {
    token = data.accessToken;
    resetIdle();
    showDashboard();
    return true;
  }
  if (status === 401 && data.error === 'unauthorized') endSession();
  else if (status === 429) say(WAIT(retry), 'error');
  else if (status === 401) say('That code is not right. Try the next one.', 'error');
  else say('Could not verify the code.', 'error');
  return false;
}

function showCode() {
  codeForm({ title: 'Enter your code', intro: 'Open your authenticator app and type the current 6-digit code.', onSubmit: (code) => verifyCode(code) });
  say('');
}

async function showEnroll() {
  mount(h('div', { class: 'admin-card paper case-frame' }, h('p', { class: 'admin-note' }, 'Preparing two-step sign-in…'), live));
  const { status, data } = await api('mfa/enroll', { method: 'POST', auth: true, body: {} });
  if (status === 409) return showCode();
  if (status !== 200 || !data.ok) {
    if (status === 401) return endSession();
    return showLogin('Could not start the two-step setup. Please try again.', 'error');
  }
  const extra = [
    h('ol', { class: 'admin-steps' },
      h('li', {}, 'Open an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis, 1Password…).'),
      h('li', {}, 'Scan the code below, or type the secret or the otpauth link in by hand.'),
      h('li', {}, 'Type the 6-digit code it shows.')),
    data.qr ? h('img', { class: 'admin-qr', src: data.qr, alt: 'QR code for your authenticator app', width: 200, height: 200 }) : null,
    h('p', { class: 'hud-label' }, 'Secret'),
    h('p', { class: 'admin-secret', tabindex: 0 }, data.secret || '(unavailable)'),
    h('p', { class: 'hud-label' }, 'otpauth link'),
    h('p', { class: 'admin-secret admin-secret--small', tabindex: 0 }, data.uri || '(unavailable)'),
  ];
  codeForm({ title: 'Set up two-step sign-in', intro: 'Two-step sign-in is required. This is shown only once.', extra, onSubmit: (code) => verifyCode(code, data.factorId) });
  say('');
}

// ───────────── dashboard ─────────────
function showDashboard() {
  const tabs = [
    ['order', 'Case order'],
    ['messages', 'Telegrams'],
    ['stats', 'Stats'],
  ];
  const panels = {};
  const buttons = {};
  const select = (id) => {
    for (const [key] of tabs) {
      const on = key === id;
      buttons[key].setAttribute('aria-selected', String(on));
      buttons[key].tabIndex = on ? 0 : -1;
      panels[key].hidden = !on;
    }
    if (id === 'order') loadOrder();
    else if (id === 'stats') loadStats();
    else loadMessages();
  };
  const list = h('div', { class: 'admin-tabs', role: 'tablist', 'aria-label': 'Admin sections' });
  for (const [key, label] of tabs) {
    buttons[key] = h('button', { class: 'admin-tab', type: 'button', role: 'tab', id: `tab-${key}`, 'aria-controls': `panel-${key}`, 'aria-selected': 'false', onclick: () => select(key) }, label);
    buttons[key].addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const next = tabs[(tabs.findIndex(([k]) => k === key) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length][0];
      select(next);
      buttons[next].focus();
    });
    panels[key] = h('section', { class: 'admin-panel', role: 'tabpanel', id: `panel-${key}`, 'aria-labelledby': `tab-${key}`, hidden: true });
    list.append(buttons[key]);
  }
  const bar = h('div', { class: 'admin-bar' }, list, h('button', { class: 'btn btn--sm', type: 'button', onclick: () => logout('Signed out.') }, 'Log out'));
  mount(bar, panels.order, panels.messages, panels.stats, live);
  orderPanel = panels.order;
  messagesPanel = panels.messages;
  statsPanel = panels.stats;
  say('');
  select('order');
}

let orderPanel;
let messagesPanel;
let statsPanel;

async function guarded(path, options) {
  const res = await api(path, { ...options, auth: true });
  if (res.status === 401 || res.status === 403) {
    endSession();
    return null;
  }
  return res;
}

// ───── Case order ─────
async function loadOrder() {
  orderPanel.replaceChildren(h('p', { class: 'admin-note' }, 'Loading the case order…'));
  const res = await guarded('projects-order');
  if (!res) return;
  if (res.status !== 200 || !res.data.ok) return orderPanel.replaceChildren(h('p', { class: 'admin-note' }, 'Could not load the order. Try again.'));
  renderOrder(res.data.projects.map((p) => ({ slug: p.slug, title: p.title ?? p.slug })));
}

function renderOrder(items) {
  let current = items;
  let dragFrom = -1;
  const ol = h('ol', { class: 'admin-order', 'aria-label': 'Projects in the order they are shown' });
  const save = h('button', { class: 'btn btn--ink', type: 'button' }, 'Save order');

  const paint = (focusIndex = -1, focusDir = '') => {
    ol.replaceChildren(
      ...current.map((item, i) => {
        const up = h('button', { class: 'btn btn--sm', type: 'button', 'aria-label': `Move ${item.title} up`, disabled: i === 0, onclick: () => shift(i, i - 1, 'up') }, 'Up');
        const down = h('button', { class: 'btn btn--sm', type: 'button', 'aria-label': `Move ${item.title} down`, disabled: i === current.length - 1, onclick: () => shift(i, i + 1, 'down') }, 'Down');
        const li = h('li', { class: 'admin-order__item', draggable: 'true', 'data-index': i }, h('span', { class: 'admin-order__pos', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'admin-order__title' }, item.title), h('span', { class: 'admin-order__moves' }, up, down));
        li.addEventListener('dragstart', (e) => {
          dragFrom = i;
          e.dataTransfer?.setData('text/plain', item.slug);
          li.classList.add('is-dragging');
        });
        li.addEventListener('dragend', () => li.classList.remove('is-dragging'));
        li.addEventListener('dragover', (e) => e.preventDefault());
        li.addEventListener('drop', (e) => {
          e.preventDefault();
          if (dragFrom >= 0 && dragFrom !== i) shift(dragFrom, i, '');
          dragFrom = -1;
        });
        if (i === focusIndex) queueMicrotask(() => (focusDir === 'down' && !down.disabled ? down : focusDir === 'up' && !up.disabled ? up : up.disabled ? down : up).focus());
        return li;
      }),
    );
  };
  function shift(from, to, dir) {
    current = move(current, from, to);
    paint(dir ? to : -1, dir);
    save.disabled = false;
    say(`${current[to].title} is now number ${to + 1} of ${current.length}. Not saved yet.`);
  }
  save.addEventListener('click', async () => {
    save.disabled = true;
    say('Saving…');
    const res = await guarded('projects-order', { method: 'POST', body: { order: current.map((p) => p.slug) } });
    if (!res) return;
    if (res.status === 200 && res.data.ok) say('Saved. The live site shows this order within a refresh.', 'ok');
    else {
      save.disabled = false;
      say('Could not save the order. Nothing changed.', 'error');
    }
  });
  save.disabled = true;
  paint();
  orderPanel.replaceChildren(
    h('p', { class: 'admin-note' }, 'This is the order of the "Featured" sort in the Bounties section. Drag a row, or use the Up and Down buttons, then press Save.'),
    ol,
    save,
  );
}

// ───── Telegrams ─────
async function loadMessages() {
  messagesPanel.replaceChildren(h('p', { class: 'admin-note' }, 'Loading the telegrams…'));
  const res = await guarded('messages');
  if (!res) return;
  if (res.status !== 200 || !res.data.ok) return messagesPanel.replaceChildren(h('p', { class: 'admin-note' }, 'Could not load the messages. Try again.'));
  renderMessages(res.data.messages);
}

function renderMessages(messages) {
  const board = h('div', { class: 'admin-board' });
  const draw = () => {
    board.replaceChildren(
      ...MESSAGE_STATUSES.map((status) => {
        const mine = messages.filter((m) => m.status === status);
        return h(
          'section',
          { class: 'admin-column', 'aria-labelledby': `col-${status}` },
          h('h2', { class: 'admin-column__title', id: `col-${status}` }, `${STATUS_LABEL[status]} `, h('span', { class: 'admin-count' }, String(mine.length))),
          mine.length === 0 ? h('p', { class: 'admin-note' }, 'Nothing here.') : null,
          ...mine.map((m) => card(m)),
        );
      }),
    );
  };
  function card(m) {
    const sel = h('select', { class: 'field__input admin-select', id: `status-${m.id}`, 'aria-label': `Status of the message from ${m.name}` }, ...MESSAGE_STATUSES.map((s) => h('option', { value: s, selected: s === m.status }, STATUS_LABEL[s])));
    sel.addEventListener('change', async () => {
      const next = sel.value;
      sel.disabled = true;
      const res = await guarded('messages', { method: 'PATCH', body: { id: m.id, status: next } });
      if (!res) return;
      if (res.status === 200 && res.data.ok) {
        m.status = next;
        draw();
        say(`Moved the message from ${m.name} to ${STATUS_LABEL[next]}.`, 'ok');
        document.getElementById(`status-${m.id}`)?.focus();
      } else {
        sel.disabled = false;
        sel.value = m.status;
        say('Could not change the status. Nothing changed.', 'error');
      }
    });
    const when = new Date(m.createdAt);
    return h(
      'article',
      { class: 'admin-message paper' },
      h('p', { class: 'admin-message__who' }, m.name),
      h('p', { class: 'admin-message__meta' }, m.email),
      h('p', { class: 'admin-message__meta' }, `${m.subject} · `, h('time', { datetime: when.toISOString() }, Number.isNaN(when.getTime()) ? '' : when.toLocaleString())),
      m.emailFailed ? h('p', { class: 'admin-message__flag' }, 'The notification email failed; this message is only here.') : null,
      h('p', { class: 'admin-message__text' }, m.message),
      h('label', { class: 'field__label', for: `status-${m.id}` }, 'Status'),
      sel,
    );
  }
  draw();
  messagesPanel.replaceChildren(h('button', { class: 'btn btn--sm', type: 'button', onclick: loadMessages }, 'Refresh'), board);
}

// ───── Stats (P10): the anonymous daily counters of the last 14 days, as a plain table ─────
async function loadStats() {
  statsPanel.replaceChildren(h('p', { class: 'admin-note' }, 'Loading the counters…'));
  const res = await guarded('stats');
  if (!res) return;
  if (res.status !== 200 || !res.data.ok) return statsPanel.replaceChildren(h('p', { class: 'admin-note' }, 'Could not load the counters. Try again.'));
  const { days, events, stats } = res.data;
  const count = new Map(stats.map((r) => [`${r.day}|${r.event}`, r.count]));
  const head = h('tr', {}, h('th', { scope: 'col' }, 'Event'), ...days.map((d) => h('th', { scope: 'col' }, d.slice(5))));
  const rows = events.map((e) => h('tr', {}, h('th', { scope: 'row' }, e), ...days.map((d) => h('td', {}, String(count.get(`${d}|${e}`) ?? 0)))));
  statsPanel.replaceChildren(
    h('p', { class: 'admin-note' }, 'Anonymous daily totals (UTC days, newest first). Nothing is stored about who: no cookies, no IP address, no referrer. A visitor whose browser says Do Not Track is not counted.'),
    h('div', { class: 'admin-table-wrap', tabindex: 0, role: 'region', 'aria-label': 'Daily counters, scroll sideways on small screens' }, h('table', { class: 'admin-table' }, h('caption', { class: 'admin-note' }, 'Events per day, last 14 days'), h('thead', {}, head), h('tbody', {}, ...rows))),
    h('button', { class: 'btn btn--sm', type: 'button', onclick: loadStats }, 'Refresh'),
  );
}

if (root) showLogin();
