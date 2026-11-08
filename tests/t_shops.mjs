// Shops tab (build session 2): reads data/shops/shops.json and shows, per place, the shops you walk or ride to
// with walking-time bands (his rule 19/10/2026: 10 min or less green, then clearly different marks as the walk
// grows) and the services that deliver there. Run from MealPlanner/: LC_ALL=C.UTF-8 node tests/t_shops.mjs
// Uses the real data/shops/shops.json of this folder; also feeds a broken file to prove nothing crashes.
import { chromium } from './pw.mjs';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve('.');
// 2026-11-05: a copy without data/ (the share zip, the GitHub repo) uses the 19/10 survey fixture, the same file
// tests/t_cook.py uses; on the laptop with data/ the real survey is checked as before.
const SHOPS_FILE = fs.existsSync(path.join(ROOT, 'data/shops/shops.json')) ? 'data/shops/shops.json' : 'tests/fixtures/shops.json';
const SHOPS = JSON.parse(fs.readFileSync(path.join(ROOT, SHOPS_FILE), 'utf8'));
console.log('shops from ' + SHOPS_FILE);
let pass = 0, fail = 0;
const log = [];
function ok(name, cond, extra) { if (cond) { pass++; log.push('ok   ' + name); } else { fail++; log.push('FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 400) : '')); } }

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL = `http://127.0.0.1:${server.address().port}/app/MealPlanner.html`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-shops-'));
const INIT = `window.__MP_TEST__ = { dirPromise: navigator.storage.getDirectory().then(r => r.getDirectoryHandle('MealPlanner', { create: true })).then(d => d.getDirectoryHandle('app', { create: true }).then(() => d)) };`;
const errors = [];
const ctx = await chromium.launchPersistentContext(profileDir, { headless: true, viewport: { width: 1280, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Prague', env: { ...process.env, LC_ALL: 'C.UTF-8' } });
await ctx.addInitScript(INIT);
const page = ctx.pages()[0] || await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror ' + e.message));
async function writeF0(p, text) { return page.evaluate(async ([p, text]) => { let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('MealPlanner', { create: true }); const a = ('data/' + p).split('/'); for (const n of a.slice(0, -1)) d = await d.getDirectoryHandle(n, { create: true }); const w = await (await d.getFileHandle(a[a.length - 1], { create: true })).createWritable(); await w.write(text); await w.close(); }, [p, text]); }
// 2026-11-08: read the file back before going on. About 1 run in 6 (05/11 code too) reloaded the page before Chrome had
// finished the private-storage write, and the app found no shops file ("No shops yet"). Only the helper changed, no check.
async function writeF(p, text) {
  await writeF0(p, text);
  return page.evaluate(async ([p, n]) => { let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('MealPlanner'); const a = ('data/' + p).split('/');
    for (const x of a.slice(0, -1)) d = await d.getDirectoryHandle(x); const f = await (await d.getFileHandle(a[a.length - 1])).getFile(); return (await f.text()).length === n; }, [p, text.length]);
}
async function openShops() { await page.reload(); await page.waitForSelector('#nav button', { timeout: 10000 }); await page.click('#nav button[data-view="shops"]'); await page.waitForSelector('#main h2'); }
const band = w => (typeof w !== 'number' || w > 30) ? 'transit' : w <= 10 ? 'near' : w <= 20 ? 'mid' : 'far';

try {
  await page.goto(URL);
  await page.waitForSelector('#nav button', { timeout: 10000 });
  await writeF('shops/shops.json', JSON.stringify(SHOPS));
  await openShops();
  const names = Object.keys(SHOPS.locations);
  const got = await page.evaluate(() => [...document.querySelectorAll('#main h3')].map(e => e.textContent));
  ok('one heading per place: ' + names.join(', '), JSON.stringify(got) === JSON.stringify(names.map(n => SHOPS.locations[n].name)), got);
  const tables = await page.$$eval('#main table.shops', ts => ts.map(t => [...t.tBodies[0].rows].map(r => ({ cls: r.className, text: r.innerText, band: (r.querySelector('.band') || {}).className || '', links: [...r.querySelectorAll('a')].map(a => a.href) }))));
  ok('two tables per place (in person, delivered)', tables.length === names.length * 2, tables.length);
  names.forEach((n, i) => {
    const L = SHOPS.locations[n], inP = L.shops.filter(s => s.kind !== 'delivery'), del = L.shops.filter(s => s.kind === 'delivery');
    const rows = tables[2 * i], drows = tables[2 * i + 1];
    ok(n + ': every shop you go to is a row (' + inP.length + ')', rows.length === inP.length, rows.length);
    ok(n + ': every delivery service is a row (' + del.length + ')', drows.length === del.length, drows.length);
    const rank = { near: 0, mid: 1, far: 2, transit: 3 };
    const key = x => { const b = band(x.walk_min); const m = b === 'transit' ? x.transit_min : x.walk_min; return [rank[b], m ?? 999]; };
    const sorted = inP.slice().sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1]; });
    let bandsOk = true, orderOk = true, firstBad = null;
    rows.forEach((r, j) => {
      const s = sorted[j], want = band(s.walk_min);
      if (!r.text.includes(s.name)) { orderOk = false; firstBad = firstBad || [j, s.name, r.text.slice(0, 60)]; }
      if (r.cls !== 'row-' + want || !r.band.includes('band-' + want)) { bandsOk = false; firstBad = firstBad || [j, s.name, s.walk_min, r.cls, r.band]; }
    });
    ok(n + ': rows sorted by band, then walking minutes (tram/bus band: by tram/bus minutes)', orderOk, firstBad);
    const tr = rows.filter(r => r.cls === 'row-transit').map(r => parseInt((r.text.split('\t')[2] || '').match(/\d+/)?.[0] || '999'));
    ok(n + ': tram/bus rows go from fewest to most tram/bus minutes', tr.every((v, j) => j === 0 || tr[j - 1] <= v), tr);
    ok(n + ': band of every row follows the rule (<=10 near, <=20 mid, <=30 far, else tram/bus)', bandsOk, firstBad);
    const counts = {}; inP.forEach(s => { const b = band(s.walk_min); counts[b] = (counts[b] || 0) + 1; });
    const shown = {}; rows.forEach(r => { const b = r.cls.replace('row-', ''); shown[b] = (shown[b] || 0) + 1; });
    ok(n + ': band counts ' + JSON.stringify(counts), JSON.stringify(Object.entries(counts).sort()) === JSON.stringify(Object.entries(shown).sort()), shown);
    ok(n + ': every walkable row has a Google Maps route link', rows.every(r => r.links.some(h => h.startsWith('https://www.google.com/maps/dir/'))));
    const nearest = sorted[0];
    ok(n + ': nearest shop first with its minutes (' + nearest.name + ', ' + nearest.walk_min + ' min)', rows[0].text.includes(nearest.name) && rows[0].text.includes(nearest.walk_min + ' min'), rows[0].text.slice(0, 120));
    const fo = drows.find(r => /foodora/.test(r.text));
    ok(n + ': foodora row shows the 5 % service fee', !!fo && fo.text.includes('service fee 5 %'), fo && fo.text);
    const ro = drows.find(r => /Rohlík/.test(r.text));
    ok(n + ': Rohlík: time slot, fee shown in the cart, minimum 749 (never "closed")', !!ro && ro.text.includes('you pick a time slot') && ro.text.includes('shown in the cart') && ro.text.includes('749.00 CZK') && !ro.text.includes('closed'), ro && ro.text);
    const te = drows.find(r => /Tesco Online/.test(r.text));
    ok(n + ': Tesco Online minimum says not checked yet', !!te && te.text.includes('not checked yet'), te && te.text);
    const wo = drows.filter(r => /through Wolt/.test(r.text));
    ok(n + ': every Wolt fee says it was seen while not logged in', wo.length > 0 && wo.every(r => r.text.includes('seen 19. 10. 2026, not logged in')), wo.map(r => r.text.slice(0, 80)));
  });
  const legend = await page.$$eval('#main .legend.bands', ls => ls.map(l => l.innerText));
  ok('legend under each place lists 4 bands with symbols ● ◐ ○ ⇄', legend.length === names.length && legend.every(l => ['●', '◐', '○', '⇄', '10 min or less', '11 to 20 min', '21 to 30 min', 'over 30 min'].every(w => l.includes(w))), legend);
  const mainText = await page.textContent('#main');
  ok('Wolt shop closed at the check says so instead of a time', mainText.includes('not shown: the shop was closed when checked'));
  ok('a shop inside the mall shows "< 0.1 km", never "0.0 km"', mainText.includes('< 0.1 km') && !mainText.includes(' 0.0 km'));
  const colours = await page.evaluate(() => { const c = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).backgroundColor + '|' + getComputedStyle(e).color : null; }; return [c('.legend .band-near'), c('.legend .band-mid'), c('.legend .band-far'), c('.legend .band-transit')]; });
  ok('the 4 bands look different (colour)', new Set(colours).size === 4 && colours.every(Boolean), colours);
  // Czech
  await page.click('#langbtns button[data-lang="cs"]');
  await page.waitForTimeout(300);
  const cs = await page.textContent('#main');
  ok('Czech: band words and headings', ['10 min a méně', 'přes 30 min', 'Obchody, kam dojdete nebo dojedete', 'Doručení na místo', 'uvidíte v košíku', 'servisní poplatek 5 %', 'přes Wolt'].every(w => cs.includes(w)), cs.slice(0, 300));
  ok('Czech: opening hours in Czech day names (Po–Ne, zavřeno)', cs.includes('Po–Ne 07:00–22:00') && cs.includes('zavřeno') && !/\bMo–Su\b/.test(cs));
  await page.click('#langbtns button[data-lang="en"]');
  // phone width
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(300);
  const sw = await page.evaluate(() => document.scrollingElement.scrollWidth);
  ok('390 px phone width: no sideways page scroll (tables scroll inside their box)', sw <= 391, sw);
  await page.setViewportSize({ width: 1280, height: 900 });
  // broken and odd files never crash the page
  const odd = { locations: { X: { name: 'Odd place', surveyed: 'not a date', shops: [null, 5, 'x', { name: 'No numbers', walk_min: 'abc', transit_min: -3, distance_m: 'far', route_url: 'javascript:alert(1)', website: 'javascript:alert(2)' },
    { name: '<b>html</b>', kind: 'delivery', delivery_min: ['a', 3], delivery_fee: -1, min_order: null, service_fee_pct: 5 }, { name: 'Far', walk_min: 31, transit_min: 12 }, { name: 'Gone shop', walk_min: 5, closed_seen: '2026-11-02T10:00:00+01:00' }] }, Y: { shops: 'not a list' } } };
  await writeF('shops/shops.json', JSON.stringify(odd));
  errors.length = 0;
  await openShops();
  const oddText = await page.textContent('#main');
  ok('odd file: page still renders both places', oddText.includes('Odd place') && oddText.includes('Y'), oddText.slice(0, 200));
  ok('odd file: walk "abc" shown as not measured, band tram/bus', oddText.includes('walk not measured'));
  ok('odd file: html in a name is shown as text', oddText.includes('<b>html</b>'));
  ok('odd file: no javascript: links', await page.$$eval('#main a', as => as.every(a => !a.href.startsWith('javascript:'))));
  ok('odd file: 31 min walk is the tram/bus band', await page.$$eval('#main tr.row-transit', rs => rs.some(r => r.innerText.includes('Far'))));
  ok('a shop seen closed is greyed and says so', await page.$$eval('#main tr.stale', rs => rs.some(r => r.innerText.includes('Gone shop') && r.innerText.includes('Seen closed on 2. 11. 2026'))));
  await writeF('shops/shops.json', '{ broken');
  await openShops();
  ok('broken file: says the shops file cannot be read', (await page.textContent('#main')).includes('cannot be read'));
  ok('no JavaScript errors', errors.length === 0, errors);
} catch (e) {
  ok('test ran to the end', false, String(e && e.stack || e));
} finally {
  await ctx.close(); server.close();
}
console.log(log.join('\n'));
console.log(fail ? 'FAIL ' + fail + ' of ' + (pass + fail) : 'PASS shops: ' + pass + ' checks');
process.exit(fail ? 1 : 0);
