// Twin test: app/js/planner.js and tools/planner.py must give equal results on every fixture case.
// Run from MealPlanner/: node tests/t_formulas.mjs
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import fs from 'fs';
const require = createRequire(import.meta.url);
const P = require('../app/js/planner.js');
const cases = JSON.parse(fs.readFileSync('tests/fixtures/formulas.json', 'utf8'));
const run = c => { const a = c.args; return P[c.fn].apply(null, a); };
const js = cases.map(c => JSON.parse(JSON.stringify(run(JSON.parse(JSON.stringify(c))))));
const py = JSON.parse(execFileSync('python3', ['tools/planner.py', 'fixtures', 'tests/fixtures/formulas.json'], { encoding: 'utf8', maxBuffer: 1 << 26 }));
function eq(a, b, path) {
  if (typeof a === 'number' && typeof b === 'number') { if (a !== b) return path + ': ' + a + ' vs ' + b; return null; }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? null : path + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b);
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (JSON.stringify(ka) !== JSON.stringify(kb)) return path + ': keys ' + ka + ' vs ' + kb;
  for (const k of ka) { const e = eq(a[k], b[k], path + '.' + k); if (e) return e; }
  return null;
}
let bad = 0;
js.forEach((x, i) => { const e = eq(x, py[i], '#' + i + ' ' + cases[i].fn); if (e) { bad++; if (bad < 10) console.log('DIFF', e); } });
// Hand checks against numbers known from the consult (18/10): tvaroh 167.5 g protein per 100 CZK, rizek 88.9.
const t = P.foodMetrics(cases.find(c => c.fn === 'foodMetrics').args[0], []);
if (t.protein_per_100czk !== 167.5) { bad++; console.log('tvaroh expected 167.5 got', t.protein_per_100czk); }
const rz = P.foodMetrics(cases.filter(c => c.fn === 'foodMetrics')[1].args[0], []);
if (Math.round(rz.protein_per_100czk * 10) / 10 !== 88.9) { bad++; console.log('rizek expected 88.9 got', rz.protein_per_100czk); }
// Mifflin by hand: man 68.4 kg, 178 cm, 23 y: 10*68.4 + 6.25*178 - 5*23 + 5 = 1686.5
const tg = P.targets(cases[0].args[0], 68.4, '2026-10-19');
if (tg.bmr !== 1686.5) { bad++; console.log('bmr expected 1686.5 got', tg.bmr); }
console.log(bad ? 'FAIL ' + bad : 'PASS ' + cases.length + ' cases equal in JS and Python; hand checks ok');
process.exit(bad ? 1 : 0);
