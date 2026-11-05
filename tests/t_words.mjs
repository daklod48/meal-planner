// Every word key exists in English and Czech, and no Czech text is left equal to English by mistake (names excepted).
import fs from 'fs';
global.window = {};
eval(fs.readFileSync('app/js/i18n.js', 'utf8'));
const { en, cs } = window.MPI18N;
const plural = k => /_(one|few|many)$/.test(k);  // plural forms differ per language; each needs its _other form in both
const miss = Object.keys(en).filter(k => !(k in cs) && !plural(k)).concat(Object.keys(cs).filter(k => !(k in en) && !plural(k)).map(k => 'extra in cs: ' + k))
  .concat([...Object.keys(en), ...Object.keys(cs)].filter(plural).map(k => k.replace(/_(one|few|many)$/, '_other')).filter(k => !(k in en) || !(k in cs)));
const same = Object.keys(en).filter(k => cs[k] === en[k] && !/^shop_|^save_error_x$|^ago_|^minutes_n$|^score_parts$/.test(k) && en[k].length > 6);
const app = fs.readFileSync('app/js/app.js', 'utf8');
const used = [...app.matchAll(/[^a-zA-Z_.]t\('([a-zA-Z0-9_]+)'/g)].map(m => m[1]).filter(k => !k.endsWith('_'));
const unknown = [...new Set(used)].filter(k => !(k in en));
if (miss.length) console.log('MISSING', miss);
if (same.length) console.log('SAME TEXT (check)', same);
if (unknown.length) console.log('USED BUT NOT DEFINED', unknown);
console.log(miss.length || unknown.length ? 'FAIL' : 'PASS words: ' + Object.keys(en).length + ' keys in both languages');
process.exit(miss.length || unknown.length ? 1 : 0);
