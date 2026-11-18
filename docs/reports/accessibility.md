# Accessibility check (P11 E1)

Run on 2026-11-18 by `node scripts/qa/a11y-check.mjs --write`: axe-core 4.14.0 (from node_modules) in real Chrome against the production build served by `vite preview`, rule sets wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice, desktop 1280×900. Classic mode only (Explore is a 3D canvas; its text equivalents are the Classic sections, see LIMITATIONS).

| Run | axe violations | rules passed | need manual review |
|---|---|---|---|
| dark theme | 0 | 55 | 2 |
| light theme | 0 | 55 | 2 |
| dark theme, reduced motion | 0 | 54 | 2 |

Needs manual review (axe cannot decide): aria-valid-attr-value (1 node(s), e.g. #stack-button ), color-contrast (72 node(s)), color-contrast (20 node(s)).

### Page facts (same in every run)

```
{
 "lang": "en",
 "landmarks": [
  [
   "header",
   1
  ],
  [
   "nav",
   2
  ],
  [
   "main",
   1
  ],
  [
   "footer",
   1
  ]
 ],
 "h1": 1,
 "imgNoAlt": 0,
 "skipLink": true,
 "targetBlankNoRel": 0,
 "chatPanel": true,
 "mic": {
  "hidden": false,
  "label": "Record your question with the microphone",
  "pressed": "false"
 }
}
```

### Keyboard, dark theme

- 68 Tab stops in one pass, no keyboard trap (the pass ends when focus leaves the document).
- Chat order: message box (#58) → microphone (#59) → Ask (#60): correct.
- Focused controls with no outline: 0.

### What this does not prove

- axe finds roughly a third of WCAG problems automatically; contrast of text over images or gradients, meaningful alt text, reading order and screen-reader wording need a human (items under "need manual review").
- Not run: a real screen reader (NVDA / VoiceOver), mobile TalkBack, Explore mode.
