// End-to-end test of the app with REAL keystrokes (keyboard.type, 40 ms per key) and two test users.
// Run from MealPlanner/: LC_ALL=C.UTF-8 node tests/t_app.mjs
// The app runs on a local web server; its folder is the browser's private file system (same FileSystem API as a real
// folder, without the permission pop-up). Files the app writes are copied to tests/out/ at the end for the Python checks.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

const ROOT = path.resolve('.');
const OUT = path.join(ROOT, 'tests', 'out');
// 2026-11-05: price-read dates in the fixtures are shifted so the newest (19/10/2026 12:50 Prague) sits one hour before the real
// clock; the gaps between them stay the same. Before, the "older than 14 days = grey" checks passed only until 2/11/2026.
const SHIFT_MS = Date.now() - 3600000 - Date.parse('2026-10-19T12:50:00+02:00');
const ago = (iso) => new Date(Date.parse(iso) + SHIFT_MS).toISOString().slice(0, 19) + 'Z';
const DELAY = 40;
let pass = 0, fail = 0;
const log = [];
function ok(name, cond, extra) { if (cond) { pass++; log.push('ok   ' + name); } else { fail++; log.push('FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 400) : '')); } }

// ---------- static server ----------
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL = `http://127.0.0.1:${server.address().port}/app/MealPlanner.html`;

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-chrome-'));
const INIT = `window.__MP_TEST__ = { dirPromise: navigator.storage.getDirectory().then(r => r.getDirectoryHandle('MealPlanner', { create: true })).then(d => d.getDirectoryHandle('app', { create: true }).then(() => d)) };`;
let ctx, page;
const consoleErrors = [], missingText = [];
async function start() {
  ctx = await chromium.launchPersistentContext(profileDir, { headless: true, viewport: { width: 1280, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Prague', env: { ...process.env, LC_ALL: 'C.UTF-8' } });
  await ctx.addInitScript(INIT);
  page = ctx.pages()[0] || await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); if (m.type() === 'warning' && m.text().startsWith('missing text')) missingText.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror ' + e.message));
  page.on('dialog', d => d.dismiss());
  await page.goto(URL);
  await page.waitForSelector('#nav button', { timeout: 10000 });
}
async function stop() { await ctx.close(); }

// ---------- helpers ----------
async function typeInto(sel, text, name) {
  await page.click(sel);
  await page.keyboard.press('Control+A'); await page.keyboard.press('Delete');
  await page.keyboard.type(text, { delay: DELAY });
  const st = await page.evaluate(s => { const el = document.querySelector(s); return { v: el.value, focus: document.activeElement === el }; }, sel);
  ok('typed exactly + focus kept: ' + (name || sel), st.v === text && st.focus, st);
}
async function readF(p) { return page.evaluate(async p => { let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('MealPlanner'); const a = ('data/' + p).split('/'); for (const n of a.slice(0, -1)) d = await d.getDirectoryHandle(n); return await (await (await d.getFileHandle(a[a.length - 1])).getFile()).text(); }, p); }
async function writeF(p, text) { return page.evaluate(async ([p, text]) => { let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('MealPlanner'); const a = ('data/' + p).split('/'); for (const n of a.slice(0, -1)) d = await d.getDirectoryHandle(n, { create: true }); const w = await (await d.getFileHandle(a[a.length - 1], { create: true })).createWritable(); await w.write(text); await w.close(); }, [p, text]); }
async function listF(p) { return page.evaluate(async p => { let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('MealPlanner'); for (const n of ('data/' + p).split('/').filter(Boolean)) d = await d.getDirectoryHandle(n); const out = []; for await (const [n] of d.entries()) out.push(n); return out.sort(); }, p); }
async function saved() { await page.waitForFunction(() => !window.MPStore.hasUnsaved(), null, { timeout: 10000 }); await page.waitForTimeout(150); }
async function text(sel) { return (await page.textContent(sel)) || ''; }
async function nav(v) { await page.click(`#nav button[data-view="${v}"]`); }

try {
  await start();
  ok('first screen: profiles, no profile yet', (await text('#main')).includes('No profile yet'));

  // ===== user A, typed with real keys =====
  await page.click('button[data-act="new-user"]');
  await typeInto('#pf-name', 'Tomáš Dvořák', 'name with Czech letters');
  await page.selectOption('#pf-body-sex', 'm');
  await page.fill('#pf-body-birth_date', '2003-05-14');
  await typeInto('#pf-body-height_cm', '178', 'height');
  await typeInto('#pf-weight', '68,4', 'weight with Czech comma');
  await typeInto('#pf-goal-gain_kg', '3', 'gain kg');
  await typeInto('#pf-goal-weeks', '12', 'weeks');
  await typeInto('#pf-goal-protein_g_per_kg', '1,8', 'protein per kg');
  ok('preview at default activity 1.53 (2,958 kcal)', (await text('#pf-preview')).includes('2,958 kcal'));
  await page.selectOption('#pf-activity-pal', '1.76');
  const prev = await text('#pf-preview');
  ok('preview targets = planner (123 g, 3,402 kcal)', prev.includes('123 g protein and 3,402 kcal a day'), prev);
  ok('activity change keeps form values', (await page.inputValue('#pf-name')) === 'Tomáš Dvořák' && (await page.inputValue('#pf-goal-gain_kg')) === '3');
  await typeInto('#pf-budget-amount', '250', 'budget');
  await page.check('#pf-card-rohlik-xtra'); await page.check('#pf-card-lidl-plus');
  await page.click('button[data-act="pf-add"][data-list="locations"]');
  ok('new location row gets focus', await page.evaluate(() => document.activeElement.id) === 'pf-locations-0-name');
  await page.keyboard.type('Blanice kolej', { delay: DELAY });
  await typeInto('#pf-locations-0-address', 'Blanická 1, Praha 2', 'address');
  await page.click('button[data-act="pf-add"][data-list="locations"]');
  await page.keyboard.type('Westfield Chodov', { delay: DELAY });
  await page.click('button[data-act="pf-add"][data-list="accounts"]');
  await typeInto('#pf-accounts-0-account_name', 'Tomáš Dvořák', 'account name');
  await typeInto('#pf-likes', 'kuře, rýže, tvaroh', 'likes');
  // click elsewhere half-way: the form must survive
  await nav('foods');
  ok('being-typed bar shown elsewhere', (await text('#main')).includes('Being typed: a new profile'));
  await page.click('button[data-act="draft-continue"]');
  ok('form restored after leaving', (await page.inputValue('#pf-locations-1-name')) === 'Westfield Chodov' && (await page.inputValue('#pf-likes')) === 'kuře, rýže, tvaroh' && await page.isChecked('#pf-card-lidl-plus'));
  // Esc does not throw typing away
  await page.click('#pf-likes'); await page.keyboard.press('Escape');
  ok('Esc keeps the form', (await page.inputValue('#pf-likes')) === 'kuře, rýže, tvaroh');
  // missing-field message names the field
  await page.fill('#pf-body-height_cm', '');
  await page.click('button[data-act="pf-save"]');
  ok('error names the missing field', (await text('#pf-errors')).includes('Height (cm)'));
  await typeInto('#pf-body-height_cm', '178', 'height again');
  await page.click('button[data-act="pf-save"]');
  await page.waitForSelector('text=New plan for Tomáš Dvořák');
  await saved();
  const usersA = await listF('users');
  ok('user folder created', usersA.includes('tomas-dvorak'), usersA);
  const profA = JSON.parse(await readF('users/tomas-dvorak/profile.json'));
  ok('profile saved: cards, places, codes', JSON.stringify(profA.cards) === '["rohlik-xtra","lidl-plus"]' && profA.locations.map(l => l.id).join() === 'L-0001,L-0002' && profA.accounts[0].account_name === 'Tomáš Dvořák' && profA.activity.pal === 1.76, profA);

  // ===== request (Cook) =====
  await page.click('#mode-cook');
  await typeInto('#rq-days', '5', 'days');
  await page.locator('#rq-days').blur();
  await typeInto('#rq-wishes', 'bez ryb, jedno velké vaření v neděli', 'wishes');
  await page.click('button[data-act="send"]');
  await page.waitForSelector('.bar.flash');
  await saved();
  const reqs = await listF('requests');
  ok('request file written', reqs.length === 1 && /^REQ-\d{8}-\d{6}-tomas-dvorak\.json$/.test(reqs[0]), reqs);
  const req = JSON.parse(await readF('requests/' + reqs[0]));
  ok('request content', req.mode === 'cook' && req.days === 5 && req.budget_total === 1250 && req.location.name === 'Blanice kolej' && req.cards.length === 2 && req.targets.protein_g === 123.12 && req.wishes.startsWith('bez ryb'), req);
  ok('waiting text with steps', (await text('#main')).includes('Waiting for Claude since') && (await text('#main')).includes('Run now'));

  // ===== history =====
  await nav('history');
  await typeInto('#hi-w_kg', '69,0', 'weigh-in');
  await page.click('button[data-act="add-weighin"]');
  await typeInto('#hi-s_czk', '312,50', 'spend');
  await typeInto('#hi-s_shop', 'Lidl Budějovická', 'spend shop');
  await page.click('button[data-act="add-spend"]');
  await saved();
  const histA = JSON.parse(await readF('users/tomas-dvorak/history.json'));
  ok('history saved', histA.weighins.length === 2 && histA.spend.length === 1 && histA.spend[0].czk === 312.5 && histA.spend[0].id === 'S-0001', histA);
  ok('charts drawn', (await page.$$('figure.chart svg')).length === 2);

  // ===== user B: other cards, Czech =====
  await nav('profiles');
  await page.click('button[data-act="new-user"]');
  await typeInto('#pf-name', 'Ngọc Anh Trần', 'name with Vietnamese letters');
  await page.selectOption('#pf-lang', 'cs');
  await page.selectOption('#pf-body-sex', 'f');
  await page.fill('#pf-body-birth_date', '2001-02-03');
  await typeInto('#pf-body-height_cm', '162', 'height B');
  await typeInto('#pf-weight', '52', 'weight B');
  await page.selectOption('#pf-goal-type', 'typed');
  await typeInto('#pf-goal-typed_protein_g', '100', 'typed protein');
  await typeInto('#pf-goal-typed_kcal', '2100', 'typed kcal');
  await typeInto('#pf-budget-amount', '6000', 'budget B');
  await page.selectOption('#pf-budget-period', 'month');
  await page.check('#pf-card-billa-club');
  await page.click('button[data-act="pf-add"][data-list="cards_other"]');
  await page.keyboard.type('Košík Plus', { delay: DELAY });
  await page.click('button[data-act="pf-add"][data-list="locations"]');
  await page.keyboard.type('Hometown', { delay: DELAY });
  await page.dblclick('button[data-act="pf-save"]');
  await page.waitForSelector('text=Nový plán pro Ngọc Anh Trần');
  ok('B in Czech after creation', (await text('#nav')).includes('Požadavky a výsledky'));
  await saved();
  await page.click('#nav button[data-view="requests"]');
  ok('B sees no request of A', (await text('#main')).includes('Zatím žádné požadavky'));
  await page.click('#nav button[data-view="history"]');
  const histBtxt = await text('#main');
  ok('B history has only its own weigh-in', histBtxt.includes('52,0 kg') && !histBtxt.includes('69,0') && !histBtxt.includes('312'), histBtxt.slice(0, 300));
  const histB = JSON.parse(await readF('users/ngoc-anh-tran/history.json'));
  ok('B files apart; double click made one profile', histB.weighins.length === 1 && histB.spend.length === 0 && (await listF('users')).join() === 'ngoc-anh-tran,tomas-dvorak', await listF('users'));
  const profB = JSON.parse(await readF('users/ngoc-anh-tran/profile.json'));
  ok('B budget per month and own cards', profB.budget.period === 'month' && profB.cards.join() === 'billa-club' && profB.cards_other[0].key === 'other-kosik-plus', profB);

  // ===== switch back to A: English again, A's data =====
  await page.selectOption('#userpick', 'tomas-dvorak');
  await page.waitForSelector('text=New plan for Tomáš Dvořák');
  ok('A back in English', (await text('#nav')).includes('Requests and results'));
  await nav('requests');
  ok('A sees its request', (await page.$$('#main .list li')).length === 1);

  // ===== undo rules =====
  await nav('profiles');
  await page.click('button[data-act="edit-user"][data-id="tomas-dvorak"]');
  await typeInto('#pf-body-height_cm', '180', 'height 180');
  await page.click('button[data-act="pf-save"]');
  await page.waitForSelector('text=Profile of Tomáš Dvořák saved');
  await page.click('button[data-act="edit-user"][data-id="tomas-dvorak"]');
  await typeInto('#pf-body-height_cm', '181', 'height 181');
  await page.click('button[data-act="pf-save"]');
  await saved();
  let ch = JSON.parse(await readF('users/tomas-dvorak/changes.json')).list;
  const c180 = ch[ch.length - 2].id, c181 = ch[ch.length - 1].id;
  await nav('settings');
  await page.click(`#ch-${c180} button[data-act="undo"]`);
  const tmsg = await text('#toast');
  ok('undo refused, names the later change', tmsg.includes('Cannot undo') && tmsg.includes(c181), tmsg);
  await page.click(`#ch-${c181} button[data-act="undo"]`);
  await page.click(`#ch-${c180} button[data-act="undo"]`);
  await saved();
  const profA2 = JSON.parse(await readF('users/tomas-dvorak/profile.json'));
  ok('two undos bring 178 back', profA2.body.height_cm === 178, profA2.body);
  // undo the spending (independent, older) out of order
  ch = JSON.parse(await readF('users/tomas-dvorak/changes.json')).list;
  const cSpend = ch.find(c => c.label === 'spend_added').id;
  await page.click(`#ch-${cSpend} button[data-act="undo"]`);
  await saved();
  const histA2 = JSON.parse(await readF('users/tomas-dvorak/history.json'));
  ok('older independent change undone out of order; row kept in trash', histA2.spend.length === 0 && histA2._trash.length === 1 && histA2._trash[0].item.id === 'S-0001', histA2);
  // a new spend gets S-0002, never S-0001 again
  await nav('history');
  await typeInto('#hi-s_czk', '99', 'spend 2');
  await page.click('button[data-act="add-spend"]');
  await saved();
  const histA3 = JSON.parse(await readF('users/tomas-dvorak/history.json'));
  ok('code never reused', histA3.spend[0].id === 'S-0002', histA3.spend);
  ch = JSON.parse(await readF('users/tomas-dvorak/changes.json')).list;
  ok('every change logged with who/when/old/new', ch.every(c => c.id && c.at && c.who && Array.isArray(c.ops)) && new Set(ch.map(c => c.id)).size === ch.length && ch.find(c => c.label === 'profile_saved').ops.some(o => o.path === 'body.height_cm' && o.old === 178 && o.new === 180));

  // ===== audit 19/10: undo after a redo is refused; an untouched form shows the current value =====
  await nav('profiles');
  await page.click('button[data-act="edit-user"][data-id="tomas-dvorak"]');
  await typeInto('#pf-body-height_cm', '183', 'height 183');
  await page.click('button[data-act="pf-save"]');
  await saved();
  ch = JSON.parse(await readF('users/tomas-dvorak/changes.json')).list;
  const cA = ch[ch.length - 1].id;
  await page.click('button[data-act="edit-user"][data-id="tomas-dvorak"]');
  await typeInto('#pf-body-height_cm', '184', 'height 184');
  await page.click('button[data-act="pf-save"]');
  await saved();
  ch = JSON.parse(await readF('users/tomas-dvorak/changes.json')).list;
  const cB = ch[ch.length - 1].id;
  await nav('settings');
  await page.click(`#ch-${cB} button[data-act="undo"]`); await saved();
  ch = JSON.parse(await readF('users/tomas-dvorak/changes.json')).list;
  const cU = ch[ch.length - 1].id;
  await page.click(`#ch-${cU} button[data-act="undo"]`); await saved();   // redo: back to 184
  ch = JSON.parse(await readF('users/tomas-dvorak/changes.json')).list;
  const cR = ch[ch.length - 1].id;
  await page.click(`#ch-${cA} button[data-act="undo"]`);
  const tm2 = await text('#toast');
  ok('undo after a redo is refused and names the redo', tm2.includes('Cannot undo') && tm2.includes(cR), tm2);
  ok('height still 184', JSON.parse(await readF('users/tomas-dvorak/profile.json')).body.height_cm === 184);
  // open the form untouched, leave, undo, open again: the form shows the value after undo
  await nav('profiles');
  await page.click('button[data-act="edit-user"][data-id="tomas-dvorak"]');
  await nav('settings');
  await page.click(`#ch-${cR} button[data-act="undo"]`); await saved();
  await nav('profiles');
  await page.click('button[data-act="edit-user"][data-id="tomas-dvorak"]');
  ok('untouched form shows the value after undo (183)', (await page.inputValue('#pf-body-height_cm')) === '183');
  // custom activity number is shown as custom
  await page.selectOption('#pf-activity-pal', 'custom');
  await typeInto('#pf-activity-pal_custom', '1,6', 'custom activity');
  await page.click('button[data-act="pf-save"]'); await saved();
  await page.click('button[data-act="edit-user"][data-id="tomas-dvorak"]');
  ok('custom activity shown as custom 1.6', (await page.inputValue('#pf-activity-pal')) === 'custom' && (await page.inputValue('#pf-activity-pal_custom')) === '1.6');
  await page.click('button[data-act="pf-cancel"]');

  // ===== foods: search one letter at a time keeps the box =====
  const foods = { version: 1, updated: '2026-10-19T00:30:00+02:00', items: [
    { id: 'rohlik-1469745', shop: 'rohlik', name: 'Miil Tvaroh odtučněný 250 g', category: 'tvaroh', price: 17.91, currency: 'CZK', pack_g: 250, unit: 'g', per100g: { kcal: 64, protein: 12, fat: 0.5, carbs: 4 }, nutrition_label: 'exact', price_label: 'online', seen: ago('2026-10-18T20:00:00+02:00'), loyalty: [{ card: 'rohlik-xtra', price: 16.11 }], price_history: [] },
    { id: 'lidl-ovesne', shop: 'lidl', name: 'Ovesné vločky jemné 500 g', category: 'oats', price: 24.9, currency: 'CZK', pack_g: 500, unit: 'g', per100g: { kcal: 372, protein: 13, fat: 7, carbs: 59 }, nutrition_label: 'exact', price_label: 'leaflet', seen: ago('2026-09-20T10:00:00+02:00'), price_history: [] },
    { id: 'billa-kure', shop: 'billa', name: 'Kuřecí prsní řízky 500 g', category: 'chicken', price: 119.9, currency: 'CZK', pack_g: 500, unit: 'g', per100g: { kcal: 110, protein: 23, fat: 1.5, carbs: 0 }, nutrition_label: 'exact', price_label: 'online', seen: ago('2026-10-18T20:00:00+02:00'), loyalty: [{ card: 'billa-club', price: 99.9 }], price_history: [] }
  ] };
  await writeF('foods/foods.json', JSON.stringify(foods));
  await page.click('#nav button[data-view="settings"]'); await page.click('button[data-act="reload"]'); await page.waitForTimeout(300);
  await nav('foods');
  await page.click('#food-q');
  const q = 'odtucneny';
  let allKept = true;
  for (const ch1 of q) { await page.keyboard.type(ch1); await page.waitForTimeout(DELAY); const s = await page.evaluate(() => ({ f: document.activeElement.id, v: document.activeElement.value })); if (s.f !== 'food-q') allKept = false; }
  ok('search box keeps focus letter by letter', allKept && (await page.inputValue('#food-q')) === q);
  ok('accent-free search finds the Czech name', (await page.$$('#food-rows tr')).length === 1 && (await text('#food-rows')).includes('Tvaroh odtučněný'));
  ok('card price marked as his card', (await text('#food-rows')).includes('your card'));
  await page.fill('#food-q', '');
  await page.dispatchEvent('#food-q', 'input');
  ok('old leaflet price shown grey', (await page.$$('#food-rows tr.stale')).length === 1);

  // ===== result from "Claude": scored by planner.py, shown and picked =====
  const opts = [
    { id: 'O1', label: 'Rohlík only', kind: 'cook-online', shop: 'rohlik', days: 5, cost_regular: 980.5, card_savings: [{ card: 'rohlik-xtra', saving: 45.2 }], protein_g_per_day: 130, kcal_per_day: 3350, minutes_per_day: 35, taste: 4, nutrition_label: 'exact', price_seen: ago('2026-10-19T00:20:00+02:00'), delivery_fee: 0, min_order: 749, delivery_min: 120, items: [{ id: 'rohlik-1469745', name: 'Miil Tvaroh', packs: 10, cost: 179.1 }], cart: { shop: 'rohlik', url: 'https://www.rohlik.cz/', filled: true, cart_total_ours: 1001.5 }, notes: 'Cart checked: 1001.50 CZK vs 980.50 planned. <b>bold?</b>' },
    { id: 'O2', label: 'Lidl on foot + Rohlík', kind: 'cook-mixed', shop: 'lidl+rohlik', days: 5, cost_regular: 845, card_savings: [{ card: 'lidl-plus', saving: 30 }, { card: 'billa-club', saving: 10 }], protein_g_per_day: 124, kcal_per_day: 3300, minutes_per_day: 55, taste: 3, nutrition_label: 'exact', price_seen: ago('2026-09-20T10:00:00+02:00'), walk_min: 9, distance_m: 700, items: [{ id: 'lidl-kupi-vejce', shop: 'lidl', name: 'Vejce z podestýlky M', packs: 2, cost: 119.8 }, { id: 'rohlik-1', shop: 'rohlik', name: 'Rýže', packs: 1, cost: 32.9 }] },
    { id: 'O4', label: 'Broken option', kind: 'buffet', days: 5, protein_g_per_day: 300, kcal_per_day: 4000, taste: 5, cart: { url: 'javascript:alert(1)', filled: true }, route_url: 'data:text/html,x' },
    { id: 'O3', label: 'Billa only', kind: 'cook-shop', shop: 'billa', days: 5, cost_regular: 1300, protein_g_per_day: 140, kcal_per_day: 3500, minutes_per_day: 40, taste: 5, nutrition_label: 'table', price_seen: ago('2026-10-18T20:00:00+02:00'), walk_min: 6 }
  ];
  const result = { id: req.id, request: req, finished: '2026-10-19T00:40:00+02:00', status: 'done', options: opts };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result));
  execFileSync('python3', ['tools/planner.py', 'score-result', path.join(OUT, 'result.json')]);
  await writeF('results/' + req.id + '.json', fs.readFileSync(path.join(OUT, 'result.json'), 'utf8'));
  await nav('requests');
  await page.click('button[data-act="reload"]').catch(() => {});
  await nav('settings'); await page.click('button[data-act="reload"]'); await page.waitForTimeout(300);
  await nav('requests');
  await page.click('button[data-act="open-request"]');
  const rtxt = await text('#main');
  ok('result shown with three options', rtxt.includes('Cheapest') && rtxt.includes('Fastest to your goal') && rtxt.includes('Best balance'));
  ok('maths agree with planner.py', rtxt.includes('the app and tools/planner.py give the same scores'), rtxt.slice(0, 500));
  ok('price with and without card shown', rtxt.includes('without cards') && rtxt.includes('Your cards save'));
  ok('old price row grey', (await page.$$('tr.stale')).length === 1);
  ok('incomplete option listed, not picked, flagged', rtxt.includes('Broken option') && rtxt.includes('incomplete: price, minutes or id missing') && !(await page.$('#main .pick [data-opt="O4"]')));
  ok('no javascript: or data: links', (await page.$$('a[href^="javascript"], a[href^="data:"]')).length === 0);
  ok('unknown kind falls back to a word', rtxt.includes('Other') && !rtxt.includes('kind_buffet'));
  // session 3: run notes, checked cart total, shop of each item in a mixed option (all escaped)
  const all3 = await page.evaluate(() => document.getElementById('main').textContent);
  ok('S3: run notes shown on the option', all3.includes('Notes from the run: Cart checked: 1001.50 CZK vs 980.50 planned.'));
  ok('S3: notes are text, never HTML', all3.includes('<b>bold?</b>') && (await page.$$('#main .pick b, #main table b')).length === 0);
  ok('S3: checked cart total shown when the cart was filled', all3.includes('Cart filled with these items: 1') && all3.includes('you still press Order yourself'));
  ok('S3: shop named per item in a mixed option', all3.includes('Vejce z podestýlky M · lidl') && all3.includes('Rýže · rohlik') && !all3.includes('Miil Tvaroh · rohlik'));

  // session 3: the option whose cart was filled is shown even when it is not one of the three picks (19/10: his Rohlík option ranked last)
  const res2 = JSON.parse(fs.readFileSync(path.join(OUT, 'result.json'), 'utf8'));
  res2.options.forEach(o => { if (o.cart) o.cart.filled = false; });
  res2.options.push({ id: 'O5', label: 'Rohlík, dear', kind: 'cook-online', shop: 'rohlik', days: 5, cost_regular: 2400, protein_g_per_day: 100, kcal_per_day: 2600, minutes_per_day: 60, taste: 2, nutrition_label: 'exact', price_seen: ago('2026-10-19T00:20:00+02:00'), cart: { shop: 'rohlik', url: 'https://www.rohlik.cz/', filled: true, cart_total_ours: 2400 } });
  fs.writeFileSync(path.join(OUT, 'result2.json'), JSON.stringify(res2));
  execFileSync('python3', ['tools/planner.py', 'score-result', path.join(OUT, 'result2.json')]);
  const r2 = JSON.parse(fs.readFileSync(path.join(OUT, 'result2.json'), 'utf8'));
  const o3picked = Object.values(r2.scored.picks).includes('O5');
  await writeF('results/' + req.id + '.json', fs.readFileSync(path.join(OUT, 'result2.json'), 'utf8'));
  await nav('settings'); await page.click('button[data-act="reload"]'); await page.waitForTimeout(300);
  await nav('requests'); await page.click('button[data-act="open-request"]');
  ok('S3: filled-cart option shown as its own card when not picked', !o3picked && !!(await page.$('#pick-cart-O5')) && (await text('#main')).includes('In your cart (not one of the three)'), r2.scored.picks);
  ok('S3: an incomplete option never gets the cart card', !(await page.$('#pick-cart-O4')));
  // session 4: an Order online result plans 2 of 3 meals (targets_used) and lists dishes with their estimated nutrition
  const res4 = { id: req.id, request: req, finished: '2026-10-19T12:20:00+02:00', status: 'done',
    targets_used: { protein_g: 100, kcal: 1667, meals: 2, meals_usual: 3, share: 0.6667, day_protein_g: 150, day_kcal: 2500 },
    options: [
      { id: 'O1', label: 'Rohlík.cz ready meals', kind: 'order', shop: 'rohlik', days: 3, cost_regular: 764.4, card_savings: [], protein_g_per_day: 86.4, kcal_per_day: 1667, minutes_per_day: 7.7, taste: 3, nutrition_label: 'exact', price_seen: ago('2026-10-19T11:50:00+02:00'), min_order: 749,
        items: [{ id: 'rohlik:1374849', name: 'Rohlik.cz Kuřecí paprikáš s těstovinami', packs: 3, packs_per_day: 1, cost: 382.2, price: 127.4, protein_g: 46.1, kcal: 842.7, nutrition_label: 'exact', url: 'https://www.rohlik.cz/1374849', basis: 'Rohlík label' }], cart: { shop: 'rohlik', url: 'https://www.rohlik.cz/', filled: false } },
      { id: 'O2', label: 'Restaurace KOBRA', kind: 'order', shop: 'wolt', days: 3, cost_regular: 1044, card_savings: [], protein_g_per_day: 100, kcal_per_day: 1422.5, minutes_per_day: 58, taste: 3, nutrition_label: 'estimate', price_seen: ago('2026-10-19T11:50:00+02:00'), delivery_min: '40-50', delivery_fee: 0, min_order: 140,
        items: [{ id: 'wolt:36d7', name: '150g Kuřecí nudličky s omáčkou na kari, vařená rýže', packs: 3, packs_per_day: 1, cost: 507, price: 169, protein_g: 46.5, kcal: 728, nutrition_label: 'estimate', url: 'https://wolt.com/cs/cze/prague/restaurant/restaurace-kobra/itemid-36d7', basis: 'curry, meat weight 150 g from the menu' }],
        cart: { shop: 'wolt', url: 'https://wolt.com/cs/cze/prague/restaurant/restaurace-kobra', filled: true, cart_total_ours: 338 } },
      { id: 'O3', label: 'Bistro without a menu online', kind: 'eatout', shop: 'eatout', days: 3, cost_regular: null, card_savings: [], protein_g_per_day: 0, kcal_per_day: 0, minutes_per_day: 40, taste: 3, nutrition_label: 'estimate', price_seen: null, delivery_min: null, delivery_fee: null, min_order: null,
        items: [], recipes: [], cart: { shop: 'eatout', url: '', filled: false }, notes: 'No menu online: price unknown, shown but not scored.' }] };
  fs.writeFileSync(path.join(OUT, 'result4.json'), JSON.stringify(res4));
  execFileSync('python3', ['tools/planner.py', 'score-result', path.join(OUT, 'result4.json')]);
  await writeF('results/' + req.id + '.json', fs.readFileSync(path.join(OUT, 'result4.json'), 'utf8'));
  await nav('settings'); await page.click('button[data-act="reload"]'); await page.waitForTimeout(300);
  await nav('requests'); await page.click('button[data-act="open-request"]');
  const t4 = await page.evaluate(() => document.getElementById('main').textContent);
  ok('S4: the meals planned are named with their share of the day', t4.includes('Planned for 2 meals a day: 100 g protein and 1,667 kcal (2 of your 3 meals'), t4.slice(0, 300));
  ok('S4: maths agree when scored on the meal targets', t4.includes('the app and tools/planner.py give the same scores'));
  ok('S4: each dish with its nutrition and label', t4.includes('one: 46.5 g protein, 728 kcal (estimate)') && t4.includes('one: 46.1 g protein, 843 kcal (shop label (exact))'), t4.slice(t4.indexOf('What is inside'), t4.indexOf('What is inside') + 300));
  ok('S4: dish links to its own page, delivery time shown', !!(await page.$('#main a[href="https://wolt.com/cs/cze/prague/restaurant/restaurace-kobra/itemid-36d7"]')) && t4.includes('delivery 40-50 min'));
  const rowNoMenu = await page.evaluate(() => { const tr = [...document.querySelectorAll('#main tr')].find((x) => x.textContent.includes('Bistro without a menu online')); return tr ? tr.textContent : ''; });
  ok('S4 review: a restaurant with no price shows "–", never "0.00 CZK"', rowNoMenu !== '' && !rowNoMenu.includes('0.00 CZK'), rowNoMenu);
  await writeF('results/' + req.id + '.json', fs.readFileSync(path.join(OUT, 'result.json'), 'utf8'));
  await nav('settings'); await page.click('button[data-act="reload"]'); await page.waitForTimeout(300);
  await nav('requests'); await page.click('button[data-act="open-request"]');  await page.click('button[data-act="pick"][data-opt="O2"] >> nth=0');
  await saved();
  const histA4 = JSON.parse(await readF('users/tomas-dvorak/history.json'));
  ok('pick recorded in history', histA4.plans.length === 1 && histA4.plans[0].option_id === 'O2' && histA4.plans[0].id === 'P-0001', histA4.plans);
  // ===== S5: the price watch wrote an update file -> "Prices changed, re-plan?" on the plan that holds the product =====
  await writeF('updates/2026-10-18.json', JSON.stringify({ created: '2026-10-18T22:10:00+02:00', source: 'rohlik', changes: [{ food_id: 'rohlik-1469745', old: 10, new: 20, pct: 100, sold_out: false, report: true }] }));
  await writeF('updates/2026-10-20.json', JSON.stringify({ created: '2026-10-20T22:10:00+02:00', source: 'rohlik', changes: [{ food_id: 'rohlik-9999', old: 10, new: 20, pct: 100, sold_out: false, report: true }, { food_id: 'rohlik-1469745', old: 17.91, new: 18.5, pct: 3.3, sold_out: false, report: false }] }));
  await nav('settings'); await page.click('button[data-act="reload"]'); await page.waitForTimeout(300);
  await nav('requests'); await page.click('button[data-act="open-request"]');
  const tU0 = await text('#main');
  ok('S5: an update older than the result, a product not in the plan, or a move under 5 % (the watch line) shows no banner', !tU0.includes('Prices changed since this plan') && !tU0.includes('Sold out since this plan'), tU0.slice(0, 200));
  // 2026-11-05: time stamps compared as moments, not text, on the night Prague left summer time (25/10/2026, 01:00 UTC)
  const resOrig = fs.readFileSync(path.join(OUT, 'result.json'), 'utf8');
  const dstUpd = (created) => JSON.stringify({ created, source: 'rohlik', changes: [{ food_id: 'rohlik-1469745', old: 17.91, new: 20.06, pct: 12.0, sold_out: false, report: true }] });
  const reopen = async () => { await nav('settings'); await page.click('button[data-act="reload"]'); await page.waitForTimeout(300); await nav('requests'); await page.click('button[data-act="open-request"]'); return text('#main'); };
  await writeF('results/' + req.id + '.json', JSON.stringify(Object.assign(JSON.parse(resOrig), { finished: '2026-10-25T02:40:00+02:00' })));  // 00:40 UTC
  await writeF('updates/2026-10-25.json', dstUpd('2026-10-25T02:10:00+01:00'));  // 01:10 UTC: 30 min LATER, though "02:10" < "02:40" as text
  const tD1 = await reopen();
  ok('time zones: a watch at 02:10+01:00 is after a result at 02:40+02:00, so the banner shows', tD1.includes('Prices changed since this plan: 1 item, biggest change 12'), tD1.slice(0, 200));
  await writeF('results/' + req.id + '.json', JSON.stringify(Object.assign(JSON.parse(resOrig), { finished: '2026-10-25T02:10:00+01:00' })));  // 01:10 UTC
  await writeF('updates/2026-10-25.json', dstUpd('2026-10-25T02:40:00+02:00'));  // 00:40 UTC: 30 min EARLIER, though "02:40" > "02:10" as text
  const tD2 = await reopen();
  ok('time zones: a watch at 02:40+02:00 is before a result at 02:10+01:00, so no banner', !tD2.includes('Prices changed since this plan'), tD2.slice(tD2.indexOf('Prices changed'), tD2.indexOf('Prices changed') + 80));
  await writeF('updates/2026-10-25.json', JSON.stringify({ created: '2026-10-25T02:40:00+02:00', source: 'rohlik', changes: [] }));  // folder cannot delete in tests either: emptied
  await writeF('results/' + req.id + '.json', resOrig);
  await writeF('updates/2026-10-20-1b.json', JSON.stringify({ created: '2026-10-20T22:11:00+02:00', source: 'rohlik', changes: [{ food_id: 'rohlik-1', item_ids: ['rohlik-1'], old: 32.9, new: null, pct: null, sold_out: true, report: true }] }));
  await nav('settings'); await page.click('button[data-act="reload"]'); await page.waitForTimeout(300);
  await nav('requests'); await page.click('button[data-act="open-request"]');
  const tU0b = await text('#main');
  ok('S5: only a sold-out product = the sold-out wording, never "biggest change 0 %"', tU0b.includes('Sold out since this plan: 1 item') && !tU0b.includes('biggest change 0'), tU0b.slice(tU0b.indexOf('Sold out'), tU0b.indexOf('Sold out') + 80));
  await writeF('updates/2026-10-20-2.json', JSON.stringify({ created: '2026-10-20T22:12:00+02:00', source: 'rohlik', changes: [{ food_id: 'rohlik-1469745', name: 'Miil Tvaroh', old: 17.91, new: 20.11, pct: 12.3, sold_out: false, report: true }, { food_id: 'rohlik-1', item_ids: ['rohlik-1'], old: 32.9, new: null, pct: null, sold_out: true, report: true }] }));
  await nav('settings'); await page.click('button[data-act="reload"]'); await page.waitForTimeout(300);
  await nav('requests'); await page.click('button[data-act="open-request"]');
  const tU1 = await text('#main');
  ok('S5: a 12.3 % move and a sold-out product in the plan show the banner with the count and the biggest change; the sold-out product reported on two nights counts once', tU1.includes('Prices changed since this plan: 2 items, biggest change 12.3 %') && !!(await page.$('button[data-act="replan"]')), tU1.slice(tU1.indexOf('Prices changed'), tU1.indexOf('Prices changed') + 120));
  await page.click('button[data-act="replan"]');
  await page.waitForTimeout(200);
  const tU2 = await text('#main');
  ok('S5: Re-plan opens the request form filled from the old request (same days and budget)', (await page.inputValue('#rq-days')) === '5' && (await page.inputValue('#rq-budget_total')) === String(req.budget_total), [await page.inputValue('#rq-days'), await page.inputValue('#rq-budget_total')]);
  await nav('requests'); await page.click('button[data-act="open-request"]');
  // Back returns to the same request in the list
  await page.click('.bar.back button');
  ok('back lands on the request, highlighted', await page.evaluate(id => document.getElementById('rq-' + id).classList.contains('hl'), req.id));

  // ===== draft survives a browser restart =====
  await nav('plan');
  await page.click('#mode-eatout');
  await typeInto('#rq-wishes', 'jen obědy', 'wishes before restart');
  await saved();
  await stop();
  await start();
  ok('after restart: A still chosen', (await text('#main')).includes('New plan for Tomáš Dvořák'));
  ok('after restart: half-typed plan kept', (await page.inputValue('#rq-wishes')) === 'jen obědy' && (await page.getAttribute('#mode-eatout', 'aria-checked')) === 'true');

  // ===== file written by someone else is not overwritten =====
  const pth = 'users/tomas-dvorak/history.json';
  const other = JSON.parse(await readF(pth)); other.notes.push({ id: 'N-0099', date: '2026-10-19', text: 'written by another program' });
  await writeF(pth, JSON.stringify(other, null, 1));
  await nav('history');
  await typeInto('#hi-w_kg', '69,4', 'weigh-in during conflict');
  await page.click('button[data-act="add-weighin"]');
  await page.waitForFunction(() => document.querySelector('#savestate').className.includes('error'), null, { timeout: 5000 });
  ok('conflict: save refused and said', (await text('#savestate')).includes('changed by another window'));
  ok('conflict: other program\'s note kept', JSON.parse(await readF(pth)).notes.some(n => n.id === 'N-0099'));
  await page.click('#savestate button[data-act="reload"]');
  await page.waitForTimeout(400);
  ok('after reload: status clean', !(await text('#savestate')).includes('Not saved'));

  // ===== browser killed in the middle of a save: files stay whole =====
  const beforeKill = await readF('users/tomas-dvorak/history.json');
  await page.evaluate(() => { window.__MP_TEST__.slowSave = 4000; });
  await nav('history');
  await typeInto('#hi-w_kg', '70,1', 'weigh-in before kill');
  await page.click('button[data-act="add-weighin"]');
  await page.waitForTimeout(800);
  ok('save is in progress when killed', await page.evaluate(() => window.MPStore.status().state === 'saving'));
  try { execFileSync('pkill', ['-9', '-f', profileDir]); } catch (e) { /* already gone */ }
  await new Promise(r => setTimeout(r, 1000));
  try { await ctx.close(); } catch (e) { /* dead */ }
  await start();
  const afterKill = await readF('users/tomas-dvorak/history.json');
  let whole = true; try { JSON.parse(afterKill); } catch (e) { whole = false; }
  ok('after kill: history.json whole and unchanged (old version kept)', whole && afterKill === beforeKill);
  ok('after kill: app opens normally', (await text('#main')).includes('Tomáš Dvořák'));

  // ===== phone width: no sideways scroll =====
  await page.setViewportSize({ width: 390, height: 800 });
  for (const v of ['profiles', 'plan', 'requests', 'history', 'foods', 'settings']) {
    await nav(v);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    ok('390 px no sideways scroll: ' + v, w <= 390, w);
  }

  // ===== copy files out for the Python checks =====
  const all = await page.evaluate(async () => {
    const out = {};
    async function walk(d, pre) { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await walk(h, pre + n + '/'); else out[pre + n] = await (await h.getFile()).text(); } }
    await walk(await (await (await navigator.storage.getDirectory()).getDirectoryHandle('MealPlanner')).getDirectoryHandle('data'), '');
    return out;
  });
  for (const [p, t] of Object.entries(all)) { const f = path.join(OUT, 'data', p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); }
  let badJson = 0; for (const [p, t] of Object.entries(all)) { if (p.endsWith('.json')) { try { JSON.parse(t); } catch (e) { badJson++; } } }
  ok('every saved file is whole JSON (' + Object.keys(all).length + ' files)', badJson === 0);
  const py = JSON.parse(execFileSync('python3', ['tools/planner.py', 'targets', path.join(OUT, 'data/users/tomas-dvorak/profile.json'), '--weight', '68.4', '--as-of', req.created.slice(0, 10)], { encoding: 'utf8' }));
  const appT = await page.evaluate(d => window.MPPlanner.targets(window.MPStore.S().users['tomas-dvorak'].profile, 68.4, d), req.created.slice(0, 10));
  ok('planner.py reads the app\'s profile: same targets as the app', py.protein_g === appT.protein_g && py.kcal === appT.kcal && py.pal === 1.6, { py: [py.protein_g, py.kcal, py.pal], app: [appT.protein_g, appT.kcal] });

  ok('no console errors', consoleErrors.length === 0, consoleErrors);
  ok('no missing words', missingText.length === 0, missingText);
} catch (e) {
  fail++; log.push('CRASH ' + (e.stack || e)); log.push('console: ' + JSON.stringify(consoleErrors).slice(0, 1500));
  try { await page.screenshot({ path: path.join(OUT, 'crash.png'), fullPage: true }); } catch (x) { /* ignore */ }
} finally {
  try { await ctx.close(); } catch (e) { /* closed */ }
  server.close();
}
console.log(log.join('\n'));
console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass} checks`);
process.exit(fail ? 1 : 0);
