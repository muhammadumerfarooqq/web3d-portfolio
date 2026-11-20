// P10: the EN | اردو switch. Tiny (it ships in Classic's entry); the translator, the dictionaries and the Urdu text are
// lazy chunks fetched only when Urdu is wanted. theme-init.js has already set <html lang dir> from ?lang=ur or the
// stored choice, so Urdu pages never flash LTR; here the text is swapped before the reveal animations start.
const wantsUrdu = () => document.documentElement.getAttribute('lang') === 'ur';

export async function initLangLoader() {
  let chunk = null;
  const load = () => (chunk ??= import('../i18n/apply.js'));
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  for (const b of document.querySelectorAll('[data-lang]')) {
    b.setAttribute('aria-pressed', String(b.dataset.lang === (wantsUrdu() ? 'ur' : 'en')));
    b.addEventListener('click', async () => {
      const lang = b.dataset.lang === 'ur' ? 'ur' : 'en';
      if (lang === (wantsUrdu() ? 'ur' : 'en')) return;
      try {
        await (await load()).applyLang(lang, { count: true });
      } catch (error) {
        console.error('[i18n] could not switch language', error);
      }
    });
  }
  if (wantsUrdu()) await (await load()).applyLang('ur', { save: fromUrl === 'ur' });
}
