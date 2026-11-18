// Control C7: content pipeline integrity + PII guard.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertNoPii, scanText } from '../../scripts/content/guard.mjs';
import { ContentError, parseContentFile, validate } from '../../scripts/content/load.mjs';
import { escapeHtml, html, isSafeUrl, renderHeroHeading, renderMarkdown, renderProfileCard } from '../../scripts/content/render.mjs';
import { profileSchema } from '../../src/shared/content-schema.js';
import { buildSite } from '../helpers/build-site.js';

const fixture = (name) => readFileSync(new URL(`../fixtures/content/${name}`, import.meta.url), 'utf8');
const load = (name) => parseContentFile(fixture(name), `tests/fixtures/content/${name}`);

describe('C7 markdown bodies are neutralised', () => {
  const out = renderMarkdown(load('xss-body.md').body).toString();

  it('raw HTML (<script>, <img onerror>) is escaped, never emitted', () => {
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/<[^>]*\son\w+=/i);
    expect(out).toContain('&lt;script&gt;');
  });

  it('javascript:, data:, vbscript: and protocol-relative links render as plain text', () => {
    const hrefs = [...out.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    // Images are disabled: "![image](https://…)" degrades to "!" + an ordinary external link (nothing loads).
    expect(hrefs).toEqual(['https://evil.example/pixel.png', 'https://example.com/page', '/about', '#about']);
    expect(out).toContain('[js link](javascript:alert(1))'); // shown as text, not a link
    expect(out).not.toMatch(/href="\s*(?:javascript|data|vbscript):/i);
    expect(out).not.toMatch(/href="\/\//);
  });

  it('external links get target="_blank" rel="noopener noreferrer"; internal ones do not', () => {
    expect(out).toContain('<a href="https://example.com/page" target="_blank" rel="noopener noreferrer">');
    expect(out).toContain('<a href="/about">');
    expect(out).toContain('<a href="#about">');
  });

  it('the URL allowlist only accepts http(s), "/" and "#"', () => {
    for (const ok of ['https://a.example', 'http://a.example', '/x', '#y']) expect(isSafeUrl(ok), ok).toBe(true);
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example', 'mailto:a', 'file:///c']) {
      expect(isSafeUrl(bad), bad).toBe(false);
    }
  });
});

describe('C7 front-matter strings are escaped', () => {
  const { data, body } = load('profile-xss.md');
  const profile = { ...validate(profileSchema, data, 'profile-xss.md'), body };

  it('escapeHtml covers & < > " \'', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    expect(html`<p title="${'"><script>'}">${'<b>'}</p>`.toString()).toBe('<p title="&quot;&gt;&lt;script&gt;">&lt;b&gt;</p>');
  });

  it('hero heading and profile card never emit fixture markup', () => {
    const out = renderHeroHeading({ profile }).toString() + renderProfileCard({ profile }, { photoSize: { width: 300, height: 300 }, cvHref: null }).toString();
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<img src=x/i);
    expect(out).not.toMatch(/<b>bold/);
    expect(out).toContain('Umer &lt;script&gt;alert(1)&lt;/script&gt;');
    // Attribute break-out attempt stays inside alt="…"
    expect(out).toContain('alt="x&quot; onerror=&quot;alert(1)"');
    // No tag gains an event-handler attribute (quoted values removed before checking).
    const attributes = [...out.matchAll(/<[a-z][^>]*>/gi)].map((m) => m[0].replace(/"[^"]*"/g, '""'));
    for (const tag of attributes) expect(tag, tag).not.toMatch(/\son\w+=/i);
  });
});

describe('C7 front matter is data, never code', () => {
  it.each(['js-frontmatter.md', 'javascript-frontmatter.md', 'coffee-frontmatter.md'])(
    '%s is rejected and not evaluated',
    (name) => {
      delete globalThis.__CONTENT_PWNED__;
      expect(() => load(name)).toThrow(ContentError);
      expect(() => load(name)).toThrow(/language-tagged front matter/);
      expect(globalThis.__CONTENT_PWNED__).toBeUndefined();
    },
  );

  it('YAML custom tags (!!js/function) are rejected', () => {
    delete globalThis.__CONTENT_PWNED__;
    expect(() => load('yaml-js-tag.md')).toThrow(ContentError);
    expect(globalThis.__CONTENT_PWNED__).toBeUndefined();
  });
});

describe('C7 PII guard', () => {
  it.each([
    ['pii-phone-local.md', 'phone number', 6],
    ['pii-phone-intl.md', 'phone number', 5],
    ['pii-phone-generic.md', 'phone number', 5],
    ['pii-cnic.md', 'CNIC number', 5],
    ['pii-email.md', 'email address', 5],
  ])('%s fails the build with file + line', (name, kind, line) => {
    const file = `tests/fixtures/content/${name}`;
    expect(() => assertNoPii([{ file, raw: fixture(name) }])).toThrow(new RegExp(`${file.replace(/\./g, '\\.')}:${line}:\\d+: looks like a ${kind}`));
  });

  it('error messages never repeat the personal data itself', () => {
    try {
      assertNoPii([{ file: 'f.md', raw: fixture('pii-email.md') + fixture('pii-phone-intl.md') }]);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.message).not.toContain('someone@example.com');
      expect(error.message).not.toContain('300 0000000');
    }
  });

  it('P3.3: the declared public email is allowed; any other email and every phone number still fail', () => {
    const PUBLIC = 'mumerfarooq.ned@gmail.com';
    const allow = { allowEmails: [PUBLIC] };
    expect(scanText(`Write to ${PUBLIC} or <mailto:${PUBLIC.toUpperCase()}>`, allow)).toEqual([]);
    expect(scanText(`Write to ${PUBLIC}`)).toHaveLength(1); // not allowed unless declared
    expect(scanText(`Write to someone@example.com`, allow).map((f) => f.kind)).toEqual(['email address']);
    expect(scanText(`${PUBLIC} · +92 300 0000000`, allow).map((f) => f.kind)).toEqual(['phone number']);
    expect(scanText(`${PUBLIC} · 0300-0000000`, allow).map((f) => f.kind)).toEqual(['phone number']);
    expect(() => assertNoPii([{ file: 'f.md', raw: `${PUBLIC}\n0300 000 0000` }], allow)).toThrow(/f\.md:2:\d+: looks like a phone number/);
    expect(() => assertNoPii([{ file: 'f.md', raw: `${PUBLIC}\n` }], allow)).not.toThrow();
  });

  it('P3.3: the email is declared once, in content/profile.md links.email, and the schema accepts one plain address only', () => {
    const profile = readFileSync(new URL('../../content/profile.md', import.meta.url), 'utf8');
    expect(profile).toMatch(/^ {2}email: mumerfarooq\.ned@gmail\.com$/m);
    const base = profileSchema.shape;
    expect(base.links.shape.email.safeParse('mumerfarooq.ned@gmail.com').success).toBe(true);
    for (const bad of ['mailto:x@y.com', 'a@b.com, c@d.com', 'a@b.com?subject=x', '<a@b.com>', '+92 300 0000000']) {
      expect(base.links.shape.email.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('ordinary numbers, dates and handles are not flagged', () => {
    expect(scanText(fixture('pii-clean.md'))).toEqual([]);
  });
});

describe('C7 built site', () => {
  let site;
  beforeAll(async () => {
    site = await buildSite();
  }, 120_000);

  // SVG path data is numeric noise, not content.
  const visibleHtml = () => site.indexHtml.replace(/<svg[\s\S]*?<\/svg>/g, '');

  it('dist/index.html contains no phone number or CNIC, and no email except the declared public one', () => {
    const PUBLIC = 'mumerfarooq.ned@gmail.com';
    // P5: the contact form's email placeholder is an example on the reserved example.com domain (RFC 2606),
    // shown only as an input placeholder, never as text or a link.
    const PLACEHOLDER = 'your-email@example.com';
    expect(scanText(visibleHtml(), { allowEmails: [PUBLIC, PLACEHOLDER] })).toEqual([]);
    const emails = new Set(site.indexHtml.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/g) ?? []);
    expect([...emails].sort()).toEqual([PUBLIC, PLACEHOLDER].sort());
    expect(site.indexHtml.match(/your-email@example\.com/g)).toHaveLength(1);
    expect(site.indexHtml).toContain('placeholder="your-email@example.com"');
  });

  it('P3.3: the public email is a plain mailto link in Contact and the footer only (not the menu), no obfuscation', () => {
    const links = [...site.indexHtml.matchAll(/<a\b[^>]*href="mailto:([^"]+)"[^>]*>/g)];
    expect(links.map((m) => m[1])).toEqual(['mumerfarooq.ned@gmail.com', 'mumerfarooq.ned@gmail.com']);
    for (const [tag] of links) {
      expect(tag).toMatch(/\bdata-email\b/);
      expect(tag).not.toMatch(/target=|onclick/i);
    }
    const contact = site.indexHtml.slice(site.indexHtml.indexOf('<section id="contact"'), site.indexHtml.indexOf('</section>', site.indexHtml.indexOf('<section id="contact"')));
    expect(contact).toContain('href="mailto:mumerfarooq.ned@gmail.com"');
    const footer = site.indexHtml.slice(site.indexHtml.indexOf('<footer class="site-footer"'));
    expect(footer).toContain('href="mailto:mumerfarooq.ned@gmail.com"');
    const menu = site.indexHtml.match(/<nav[^>]*class="[^"]*menu[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(menu).not.toContain('mailto:');
  });

  it('every external link carries target="_blank" rel="noopener noreferrer"', () => {
    const links = [...site.indexHtml.matchAll(/<a\b[^>]*href="https?:\/\/[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(links.length).toBeGreaterThan(0);
    for (const tag of links) {
      expect(tag, tag).toMatch(/target="_blank"/);
      expect(tag, tag).toMatch(/rel="noopener noreferrer"/);
    }
  });
});
