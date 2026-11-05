// Contrast of every text/background pair in app.css, light and dark. Needs 4.5 : 1 (WCAG AA, normal text).
import fs from 'fs';
const css = fs.readFileSync('app/css/app.css', 'utf8');
function vars(block) { const o = {}; for (const m of block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)) o[m[1]] = m[2]; return o; }
const light = vars(css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {'))));
const dStart = css.indexOf(':root {', css.indexOf('prefers-color-scheme: dark'));
const dark = vars(css.slice(dStart, css.indexOf('}', dStart)));
function lum(hex) { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
const pairs = [['text', 'bg'], ['text', 'card'], ['muted', 'card'], ['muted', 'bg'], ['accent', 'card'], ['accent', 'bg'], ['accent-text', 'accent'], ['warn', 'warn-bg'], ['warn', 'card'],
  ['error', 'card'], ['error', 'error-bg'], ['stale', 'card'], ['text', 'accent-soft'], ['muted', 'accent-soft'], ['accent', 'accent-soft'], ['text', 'hl'], ['bg', 'text'], ['text', 'warn-bg'], ['text', 'error-bg'], ['muted', 'warn-bg']];
let bad = 0;
for (const [name, v] of [['light', light], ['dark', dark]]) for (const [f, b] of pairs) { const r = ratio(v[f], v[b]); if (r < 4.5) { bad++; console.log('LOW', name, f, 'on', b, r.toFixed(2)); } }
// chart strokes need 3 : 1 against the card (non-text)
for (const [name, v] of [['light', light], ['dark', dark]]) for (const f of ['chart', 'goal', 'over']) { const r = ratio(v[f], v.card); if (r < 3) { bad++; console.log('LOW chart', name, f, r.toFixed(2)); } }
console.log(bad ? 'FAIL ' + bad : 'PASS contrast: ' + pairs.length * 2 + ' text pairs >= 4.5, 6 chart colours >= 3');
process.exit(bad ? 1 : 0);
