// Case files (lazy chunk, loaded on the first E / tap / star-counter press). One reusable native
// <dialog> shows a building's case file. The content is the SAME DOM as Classic: the section's
// .container is moved into the dialog while it is open and put back on close (nothing is copied, so
// the project filters, modal deep links, lightbox and promo player keep working). Also here: the star
// flight to the HUD counter, the case board (progress + reset), the Case Closed stamp and the
// Deputy's Commission certificate. DOM is built with createElement / textContent only.
import { ZONE_ANCHORS } from './zones.js';
import { STAR, el } from './hud.js';

/** Engagement rule for a star: open ≥ 3 s, or any interaction inside the case file. */
export const ENGAGE_MS = 3000;

export const CERTIFICATE_TEXT = "Every case on Byte Island is closed, deputy. Umer's ready to ride with your team.";
export const BARKEEP_TEXT = 'The barkeep will answer in P5.';
export const INTERVIEW_DRAFT = 'Hi Umer, I closed every case on Byte Island and would like to schedule an interview with you about a role on our team. When would suit you?';

/** Optional links the page may carry later (none today): a booking URL, a phone-free CV, an email. */
function pageLinks() {
  const booking = document.querySelector('[data-booking-url]')?.getAttribute('data-booking-url') ?? '';
  const cv = document.querySelector('a[data-cv-download]')?.getAttribute('href') ?? '';
  const mail = document.querySelector('main a[href^="mailto:"]')?.getAttribute('href') ?? '';
  return {
    booking: /^https:\/\/[^\s"'<>]+$/.test(booking) ? booking : '',
    cv: /^\/[\w/.-]+\.pdf$/.test(cv) ? cv : '',
    mail: /^mailto:[^\s"'<>?]+$/.test(mail) ? mail : '',
  };
}

/** Focusable elements inside a root, in tab order (for the focus trap). */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';
const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((n) => !n.closest('[inert], [hidden]') && n.getClientRects().length > 0);

export function createCaseFiles({ host, canvasHost, starButton, zones, sound, announce, reducedMotion = false, onOpenChange, onEngaged, onReset, getStars, onClassic, onTravel }) {
  const closeBtn = el('button', { type: 'button', class: 'xp-btn xp-case__close' }, [el('span', { 'aria-hidden': 'true', text: '✕' }), el('span', { text: 'Close' })]);
  const eyebrow = el('p', { class: 'xp-eyebrow xp-case__eyebrow' });
  const body = el('div', { class: 'xp-case__body' });
  const foot = el('div', { class: 'xp-case__foot' });
  const dialog = el('dialog', { class: 'xp-case', 'aria-modal': 'true' }, [
    el('div', { class: 'xp-case__sheet' }, [el('div', { class: 'xp-case__bar' }, [eyebrow, closeBtn]), body, foot]),
  ]);
  host.append(dialog);

  let mounted = null; // { container, marker } while a Classic section is inside
  let current = null; // { kind: 'zone' | 'board' | 'certificate', zone? }
  let engageTimer = 0;
  let engaged = false;
  let disposed = false;

  // ── moving the Classic section in and out ──
  function mountSection(zoneId) {
    const section = document.querySelector(ZONE_ANCHORS[zoneId] ?? '#none');
    const container = section?.querySelector(':scope > .container');
    if (!container) return null;
    const marker = document.createComment(' explore: case file open ');
    container.before(marker);
    const wrap = el('div', { class: 'section xp-case__section', 'data-from': section.id }, [container]);
    body.append(wrap);
    // Reveals wait for scroll in Classic; inside the dialog they finish at once (src/ui/motion.js).
    window.dispatchEvent(new CustomEvent('revealall', { detail: { root: container } }));
    return { container, marker, wrap, title: container.querySelector('.section__title') };
  }
  function unmountSection() {
    if (!mounted) return;
    for (const media of mounted.container.querySelectorAll('video, audio')) media.pause();
    mounted.marker.replaceWith(mounted.container);
    mounted.wrap.remove();
    mounted = null;
  }

  // ── engagement → star ──
  function engage() {
    if (engaged || current?.kind !== 'zone') return;
    engaged = true;
    clearTimeout(engageTimer);
    onEngaged?.(current.zone);
  }
  const interacted = (e) => {
    if (e.target instanceof Element && e.target.closest('.xp-case__close')) return;
    if (e.type === 'keydown' && (e.key === 'Escape' || e.key === 'Tab' || e.key === 'Shift')) return;
    engage();
  };
  for (const type of ['pointerdown', 'keydown', 'input', 'change', 'wheel']) body.addEventListener(type, interacted, { passive: true });
  body.addEventListener('scroll', interacted, { passive: true });

  // ── open / close ──
  function reset() {
    clearTimeout(engageTimer);
    unmountSection();
    body.replaceChildren();
    foot.replaceChildren();
    dialog.removeAttribute('aria-labelledby');
    dialog.removeAttribute('data-kind');
    body.scrollTop = 0;
  }

  function show(kind, labelId) {
    if (labelId) dialog.setAttribute('aria-labelledby', labelId);
    dialog.dataset.kind = kind;
    if (!dialog.open) {
      dialog.showModal();
      onOpenChange?.(true, current);
    }
    closeBtn.focus({ preventScroll: true });
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('close', () => {
    if (disposed) return;
    const was = current;
    reset();
    current = null;
    canvasHost.focus({ preventScroll: true }); // keys go back to the game
    onOpenChange?.(false, was);
  });
  // Esc: close through our path (restores the section) and keep the browser from double-handling.
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  closeBtn.addEventListener('click', close);
  // Clicking the dimmed backdrop (outside the sheet) closes too.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  // Focus trap: Tab and Shift+Tab cycle inside the dialog (showModal already makes the page inert).
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = focusables(dialog);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  function classicLink(zoneId) {
    const a = el('a', { class: 'xp-btn', href: ZONE_ANCHORS[zoneId] }, [el('span', { text: 'Read it in Classic' })]);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      close();
      onClassic?.(ZONE_ANCHORS[zoneId]);
    });
    return a;
  }

  /** Open a building's case file. zone: { zone, title }. opts.interview pre-fills the telegram. */
  function open(zone, { interview = false } = {}) {
    if (dialog.open) reset();
    current = { kind: 'zone', zone: zone.zone, title: zone.title };
    engaged = false;
    eyebrow.textContent = `Case file · ${zone.title}`;
    if (zone.zone === 'about') body.append(el('p', { class: 'xp-case__wanted', 'aria-hidden': 'true', text: 'Wanted' }));
    if (interview && zone.zone === 'contact') body.append(interviewDraft());
    mounted = mountSection(zone.zone);
    if (zone.zone === 'chat') foot.append(el('p', { class: 'xp-case__note', text: BARKEEP_TEXT }));
    foot.append(classicLink(zone.zone));
    show('zone', mounted?.title?.id);
    if (zone.zone === 'about') dialog.dataset.kind = 'wanted';
    engageTimer = setTimeout(engage, ENGAGE_MS);
  }

  function interviewDraft() {
    const id = 'xp-interview-draft';
    const text = el('textarea', { id, class: 'xp-case__draft', rows: '4', readonly: true });
    text.value = INTERVIEW_DRAFT;
    const copy = el('button', { type: 'button', class: 'xp-btn' }, [el('span', { text: 'Copy the draft' })]);
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(INTERVIEW_DRAFT);
        announce?.('Interview request copied. Send it through one of the links below.');
        copy.firstChild.textContent = 'Copied';
      } catch {
        text.select();
      }
    });
    return el('div', { class: 'xp-case__interview paper case-frame' }, [
      el('p', { class: 'hud-label', text: 'Telegram draft · interview request' }),
      el('label', { class: 'xp-case__label', for: id, text: 'Your message, ready to send' }),
      text,
      copy,
    ]);
  }

  // ── case board (below 8/8): progress, travel and reset ──
  function resetButton() {
    const b = el('button', { type: 'button', class: 'xp-btn xp-case__reset' }, [el('span', { text: 'Reset badges' })]);
    let armed = 0;
    b.addEventListener('click', () => {
      if (!armed) {
        b.firstChild.textContent = 'Press again to reset';
        armed = setTimeout(() => {
          armed = 0;
          b.firstChild.textContent = 'Reset badges';
        }, 3000);
        return;
      }
      clearTimeout(armed);
      armed = 0;
      onReset?.();
      announce?.('Badges reset. Every case file is open again.');
      close();
    });
    return b;
  }

  function openBoard() {
    if (dialog.open) reset();
    current = { kind: 'board' };
    const earned = getStars();
    eyebrow.textContent = 'Case board · Byte Island';
    const list = el(
      'ul',
      { class: 'xp-board__list' },
      zones.map((z) => {
        const has = earned.has(z.zone);
        const go = el('button', { type: 'button', class: 'xp-btn xp-board__go' }, [el('span', { text: 'Ride there' })]);
        go.addEventListener('click', () => {
          close();
          onTravel?.(z);
        });
        return el('li', { class: `xp-board__item${has ? ' is-earned' : ''}` }, [
          STAR(),
          el('span', { class: 'xp-board__name', text: z.title }),
          el('span', { class: 'sr-only', text: has ? ' (star earned)' : ' (open)' }),
          go,
        ]);
      }),
    );
    body.append(
      el('div', { class: 'xp-board' }, [
        el('h2', { id: 'xp-board-title', class: 'xp-board__title', text: 'Case board' }),
        el('p', { class: 'xp-board__text', text: `${earned.size} of ${zones.length} case files closed. Open a building to earn its star; close all ${zones.length} to finish the job.` }),
        list,
      ]),
    );
    foot.append(resetButton());
    show('board', 'xp-board-title');
  }

  // ── the Deputy's Commission ──
  function openCertificate() {
    if (dialog.open) reset();
    current = { kind: 'certificate' };
    eyebrow.textContent = 'Case closed · Byte Island';
    const links = pageLinks();
    const actions = [];
    const interview = el('button', { type: 'button', class: 'xp-btn xp-btn--ink' }, [el('span', { text: 'Schedule an interview' })]);
    interview.addEventListener('click', () => {
      if (links.booking) {
        window.open(links.booking, '_blank', 'noopener,noreferrer');
        return;
      }
      const telegraph = zones.find((z) => z.zone === 'contact') ?? { zone: 'contact', title: 'Telegraph Office' };
      open(telegraph, { interview: true });
    });
    actions.push(interview);
    if (links.cv) actions.push(el('a', { class: 'xp-btn', href: links.cv, download: '' }, [el('span', { text: 'Download CV' })]));
    if (links.mail) actions.push(el('a', { class: 'xp-btn', href: `${links.mail}?subject=${encodeURIComponent('Interview request (via Byte Island)')}` }, [el('span', { text: 'Email Umer' })]));
    body.append(
      el('div', { class: 'xp-cert paper case-frame' }, [
        el('p', { class: 'hud-label', text: "Byte Island · Sheriff's Department" }),
        el('h2', { id: 'xp-cert-title', class: 'xp-cert__title', text: "Deputy's Commission" }),
        el('p', { class: 'xp-cert__text', text: CERTIFICATE_TEXT }),
        el('ul', { class: 'xp-cert__seals', 'aria-label': 'Case files closed' }, zones.map((z) => el('li', {}, [STAR(), el('span', { text: z.title })]))),
        el('p', { class: 'xp-cert__stamp', 'aria-hidden': 'true', text: 'Case closed' }),
        el('div', { class: 'xp-cert__actions' }, actions),
      ]),
    );
    foot.append(resetButton());
    show('certificate', 'xp-cert-title');
  }

  // ── the star's flight to the counter (transform + opacity only) ──
  function flyStar() {
    sound?.tone({ freq: 1318.5, gain: 0.05, release: 0.35 });
    sound?.tone({ freq: 1568, gain: 0.045, release: 0.4, at: 0.09 });
    sound?.tone({ freq: 2093, gain: 0.04, release: 0.6, at: 0.18 });
    const pulse = () => starButton.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
    if (reducedMotion) {
      starButton.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 300 });
      return;
    }
    const from = (mounted?.title ?? eyebrow).getBoundingClientRect();
    const to = starButton.getBoundingClientRect();
    const star = el('span', { class: 'xp-flystar', 'aria-hidden': 'true' }, [STAR()]);
    // Inside the dialog so it renders in the top layer, above the backdrop.
    (dialog.open ? dialog : host).append(star);
    const x0 = from.left + Math.min(from.width, 220) / 2 - 24;
    const y0 = from.top + from.height / 2 - 24;
    const x1 = to.left + 22 - 24;
    const y1 = to.top + to.height / 2 - 24;
    const anim = star.animate(
      [
        { transform: `translate(${x0}px, ${y0}px) scale(0.2) rotate(0deg)`, opacity: 0 },
        { transform: `translate(${x0}px, ${y0 - 30}px) scale(1.5) rotate(160deg)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${x1}px, ${y1}px) scale(0.55) rotate(720deg)`, opacity: 1, offset: 0.9 },
        { transform: `translate(${x1}px, ${y1}px) scale(0.4) rotate(760deg)`, opacity: 0 },
      ],
      { duration: 1150, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' },
    );
    anim.finished.then(pulse, () => {}).finally(() => star.remove());
  }

  // ── the CASE CLOSED stamp (resolves when it has landed and held) ──
  function stamp() {
    const s = el('div', { class: 'xp-stamp', role: 'img', 'aria-label': 'Case closed' }, [el('span', { text: 'Case closed' })]);
    host.append(s);
    sound?.noise({ type: 'lowpass', freq: 180, q: 0.7, gain: 0.5, decay: 0.35, at: reducedMotion ? 0 : 0.42 });
    const frames = reducedMotion
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { transform: 'translate(-50%, -50%) scale(2.6) rotate(-4deg)', opacity: 0 },
          { transform: 'translate(-50%, -50%) scale(0.94) rotate(-11deg)', opacity: 1, offset: 0.75 },
          { transform: 'translate(-50%, -50%) scale(1) rotate(-10deg)', opacity: 1 },
        ];
    const anim = s.animate(frames, { duration: reducedMotion ? 250 : 520, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1.2)', fill: 'forwards' });
    return anim.finished
      .catch(() => {})
      .then(() => new Promise((r) => setTimeout(r, 1500)))
      .then(() => s.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' }).finished.catch(() => {}))
      .then(() => s.remove());
  }

  return {
    open,
    openBoard,
    openCertificate,
    close,
    flyStar,
    stamp,
    get isOpen() {
      return dialog.open;
    },
    get current() {
      return current;
    },
    dialog,
    dispose() {
      disposed = true;
      clearTimeout(engageTimer);
      if (dialog.open) dialog.close(); // restores the Classic section synchronously
      unmountSection();
      dialog.remove();
    },
  };
}
