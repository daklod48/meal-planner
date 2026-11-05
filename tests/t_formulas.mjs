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
// 2026-11-05 DRI hand checks (worked on paper from the IOM 2005 equations and RDA table, not from planner.js):
// man 23 y, 178 cm, 68.4 kg, PAL 1.76 = "active" (PA 1.25): 662 - 9.53*23 + 1.25*(15.91*68.4 + 539.6*1.78) = 3003.73 kcal; protein 0.8*68.4 = 54.72 g.
// woman 30 y, 165 cm, 60 kg, no activity given = low active (PA 1.12), 2nd trimester: 354 - 6.91*30 + 1.12*(9.36*60 + 726*1.65) + 340 = 2457.34; protein 1.1*60 = 66.
// boy 7 y, 120 cm, 22 kg, low active (PA 1.13): 88.5 - 61.9*7 + 1.13*(26.7*22 + 903*1.2) + 20 = 1563.43; protein 0.95*22 = 20.9.
// girl 15 y lactating 0-6 months, 160 cm, 55 kg, PAL 1.76 (PA 1.31): 135.3 - 30.8*15 + 1.31*(10*55 + 934*1.6) + 25 + 330 = 2706.46; protein 1.3*55 = 71.5.
// toddler 2 y, 12.5 kg: 89*12.5 - 100 + 20 = 1032.5; protein 1.05*12.5 = 13.13.
const hand = [
  [{ body: { sex: 'm', birth_date: '2003-05-14', height_cm: 178 }, activity: { pal: 1.76 }, goal: { type: 'maintain' } }, 68.4, '2026-10-19', 3003.73, 54.72],
  [{ body: { sex: 'f', birth_date: '1996-01-01', height_cm: 165, life_stage: 'pregnant', trimester: 2 }, goal: { type: 'maintain' } }, 60, '2026-10-19', 2457.34, 66],
  [{ body: { sex: 'm', birth_date: '2019-01-01', height_cm: 120 }, goal: { type: 'maintain' } }, 22, '2026-10-19', 1563.43, 20.9],
  [{ body: { sex: 'f', birth_date: '2011-01-01', height_cm: 160, life_stage: 'lactating', lactation_period: '0-6' }, activity: { pal: 1.76 }, goal: { type: 'maintain' } }, 55, '2026-10-19', 2706.46, 71.5],
  [{ body: { sex: 'f', birth_date: '2024-06-01', height_cm: 88 }, goal: { type: 'maintain' } }, 12.5, '2026-10-19', 1032.5, 13.13],
];
hand.forEach(([pr, kg, d, kcal, prot], i) => { const x = P.targets(pr, kg, d); if (x.kcal !== kcal || x.protein_g !== prot) { bad++; console.log('DRI hand check', i, 'expected', kcal, prot, 'got', x.kcal, x.protein_g); } });
// No fixed protein minimum: an adult with no own g/kg gets the DRI 0.8 g/kg, not 1.6.
if (P.targets(hand[0][0], 68.4, '2026-10-19').protein_g_per_kg !== 0.8) { bad++; console.log('adult default protein is not the DRI 0.8 g/kg'); }
console.log(bad ? 'FAIL ' + bad : 'PASS ' + cases.length + ' cases equal in JS and Python; hand checks ok');
process.exit(bad ? 1 : 0);
