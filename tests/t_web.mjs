// The web app (index.html) end to end in Chromium, 2026-11-05: home page, sign up / sign in / sign out, login kept
// after a reload, two accounts kept apart, the demo account with its sample data, "Keep my data", phone and laptop
// showing the same data, the result-file bridge, DRI targets with sources, 390 px phone width, no console errors.
//
// Two backends, same checks:
//   LC_ALL=C.UTF-8 node tests/t_web.mjs                      practice backend (this browser only; no server)
//   MP_BACKEND=firebase ... firebase emulators:exec --project demo-meal-planner --only auth,firestore "node tests/t_web.mjs"
//                                                            the real Firebase SDK (app/vendor/firebase) against the Auth and
//                                                            Firestore emulators, with firestore.rules loaded (tests/README.md)
import { chromium } from './pw.mjs';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const ROOT = path.resolve('.');
const FB = process.env.MP_BACKEND === 'firebase';
const PL = createRequire(import.meta.url)('../app/js/planner.js');
const DELAY = 25;
let pass = 0, fail = 0;
const log = [];
function ok(name, cond, extra) { if (cond) { pass++; log.push('ok   ' + name); } else { fail++; log.push('FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 300) : '')); } }

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const p = path.join(ROOT, u);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ env: { ...process.env, LC_ALL: 'C.UTF-8' } });
const ctx = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/Prague' });
if (FB) {
  // The real Firebase code path, pointed at the local emulators (a demo- project never reaches Google).
  await ctx.route('**/app/js/firebase-config.js', r => r.fulfill({ contentType: 'text/javascript', body:
    "window.MP_FIREBASE_CONFIG = { apiKey: 'demo-key', authDomain: 'demo-meal-planner.firebaseapp.com', projectId: 'demo-meal-planner', appId: '1:1:web:1' };" +
    "window.__MP_TEST__ = { emulators: { auth: 9099, firestore: 8085 } };" }));
}
const errors = [];
function watch(p, tag) {
  // Firebase answers a wrong password or a taken e-mail with HTTP 400; Chrome logs that as "Failed to load resource".
  // Those come from the auth service and are the expected answers the app turns into a message; anything else counts.
  p.on('console', m => {
    const u = (m.location() && m.location().url) || '';
    if (/status of 400/.test(m.text()) && /identitytoolkit|:9099\//.test(u)) return;
    if (m.type() === 'error' || (m.type() === 'warning' && !/emulator/i.test(m.text()))) errors.push(tag + ' ' + m.type() + ': ' + m.text() + ' @ ' + u);
  });
  p.on('pageerror', e => errors.push(tag + ' pageerror: ' + e.message));
}
const laptop = await ctx.newPage(); await laptop.setViewportSize({ width: 1440, height: 900 }); watch(laptop, 'laptop');
let page = laptop;
const text = async (sel, p = page) => (await p.textContent(sel)) || '';
const settle = (p = page) => p.waitForFunction(() => window.MPStore && !window.MPStore.hasUnsaved(), null, { timeout: 15000 }).then(() => p.waitForTimeout(250));
const until = (fn, arg, p = page, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const noSideScroll = (p = page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function typeInto(sel, s) { await page.click(sel); await page.fill(sel, ''); await page.keyboard.type(s, { delay: DELAY }); }
const stamp = Date.now().toString(36);
const EMAIL1 = 'ngoc.anh.' + stamp + '@example.test', EMAIL2 = 'tomas.' + stamp + '@example.test', EMAIL3 = 'demo.' + stamp + '@example.test';

try {
  // ===== home page =====
  await page.goto(URL0);
  ok('home: lands on the home page with Try the demo, Sign up, Sign in', await until(() => document.querySelector('button[data-act="web-demo"]')) &&
    !!(await page.$('button[data-to="signup"]')) && !!(await page.$('button[data-to="signin"]')));
  const ex = PL.targets({ body: { sex: 'f', birth_date: '1996-03-01', height_cm: 168 }, goal: { type: 'maintain' } }, 62, '2026-11-05');
  const home = await text('#main');
  ok('home: worked example computed by planner.js (' + ex.protein_g + ' g, ' + Math.round(ex.kcal) + ' kcal)', home.includes(Math.round(ex.protein_g) + ' g protein') && home.includes(Math.round(ex.kcal).toLocaleString('en-GB') + ' kcal'), home.slice(0, 900));
  ok('home: says which backend is used', FB ? !home.includes('Practice mode') : home.includes('Practice mode'));
  await page.click('button[data-lang="cs"]');
  ok('home: Czech words', (await text('#main')).includes('Vyzkoušet ukázkový účet'));
  await page.click('button[data-lang="en"]');

  // ===== sign up: errors, then success =====
  await page.click('button[data-to="signup"]');
  ok('sign up: own screen with e-mail and password', !!(await page.$('#web-email')) && !!(await page.$('#web-pw')) && page.url().endsWith('#signup'));
  await typeInto('#web-email', 'not-an-email'); await typeInto('#web-pw', 'secret1'); await page.click('#web-auth [type=submit]');
  ok('sign up: a wrong e-mail is named', await until(() => /does not look right/.test(document.getElementById('web-auth-msg').textContent)));
  await typeInto('#web-email', EMAIL1); await typeInto('#web-pw', '123'); await page.click('#web-auth [type=submit]');
  ok('sign up: a short password is named', await until(() => /at least 6 characters/.test(document.getElementById('web-auth-msg').textContent)));
  await typeInto('#web-name', 'Ngọc Anh Trần'); await typeInto('#web-pw', 'heslo-123');
  await page.click('button[data-act="web-pw-toggle"]');
  ok('sign up: Show reveals the password', (await page.getAttribute('#web-pw', 'type')) === 'text');
  await page.click('#web-auth [type=submit]');
  ok('sign up: lands in the app on Profiles (no profile yet)', await until(() => /No profile yet/.test(document.getElementById('main').textContent)), await text('#main'));
  ok('sign up: header shows the account and Sign out', (await text('#acct')).includes('Ngọc Anh Trần') && (await text('#acct')).includes('Sign out'));

  // ===== a profile with pregnancy: DRI targets with their sources =====
  await page.click('button[data-act="new-user"]');
  await typeInto('#pf-name', 'Ngọc Anh Trần');
  await page.selectOption('#pf-body-sex', 'f');
  await page.fill('#pf-body-birth_date', '1997-02-11');
  await typeInto('#pf-body-height_cm', '162');
  await typeInto('#pf-weight', '58,5');
  await page.selectOption('#pf-body-life_stage', 'pregnant');
  await page.selectOption('#pf-body-trimester', '2');
  await page.selectOption('#pf-goal-type', 'maintain');
  const today = new Date().toISOString().slice(0, 10);
  const exp = PL.targets({ body: { sex: 'f', birth_date: '1997-02-11', height_cm: 162, life_stage: 'pregnant', trimester: 2 }, activity: { pal: 1.53 }, goal: { type: 'maintain' } }, 58.5, today);
  const pv = await text('#pf-preview');
  ok('DRI: pregnancy uses 1.1 g per kg (' + exp.protein_g + ' g) and adds 340 kcal', pv.includes('1.10 g per kg') && pv.includes(Math.round(exp.protein_g) + ' g protein') && pv.includes('340 kcal for trimester 2'), pv);
  ok('DRI: each target links its source', !!(await page.$('#pf-preview a[href="https://www.ncbi.nlm.nih.gov/books/NBK56068/table/summarytables.t4/"]')) && !!(await page.$('#pf-preview a[href="https://doi.org/10.17226/10490"]')));
  ok('DRI: no fixed protein minimum (own g/kg box is optional and empty)', (await page.inputValue('#pf-goal-protein_g_per_kg')) === '' && /optional/.test(await text('label[for="pf-goal-protein_g_per_kg"]')));
  await typeInto('#pf-budget-amount', '220');
  await page.click('button[data-act="pf-add"][data-list="locations"]');
  await page.keyboard.type('Home', { delay: DELAY });
  await page.click('button[data-act="pf-save"]');
  ok('profile saved: New plan shows the targets', await until(() => /New plan for Ngọc Anh Trần/.test(document.getElementById('main').textContent)));
  await settle();
  ok('profile saved: the plan screen says where the targets come from', (await text('#main')).includes('Where these targets come from'));

  // ===== kept after a reload (persistent login) =====
  await page.reload();
  ok('reload: still signed in, same profile, no sign-in screen', await until(() => /New plan for Ngọc Anh Trần/.test(document.getElementById('main').textContent)), await text('#main'));

  // ===== phone and laptop: same account, same data, live =====
  const phone = await ctx.newPage(); await phone.setViewportSize({ width: 390, height: 844 }); watch(phone, 'phone');
  await phone.goto(URL0);
  ok('phone: opens signed in on the same profile', await until(() => /New plan for Ngọc Anh Trần/.test(document.getElementById('main').textContent), null, phone), await text('#main', phone));
  ok('phone: no sideways scroll at 390 px (plan)', await noSideScroll(phone));
  await phone.click('#nav button[data-view="history"]');
  await page.click('#nav button[data-view="history"]');
  await typeInto('#hi-w_kg', '59,1');
  await page.click('button[data-act="add-weighin"]');
  await settle();
  ok('sync: a weigh-in typed on the laptop appears on the phone without reloading', await until(() => /59\.1/.test(document.getElementById('main').textContent), null, phone, 15000), (await text('#main', phone)).slice(0, 400));
  // and the other way: the phone changes the profile, the laptop sees it
  await phone.click('#nav button[data-view="profiles"]');
  await phone.click('button[data-act="edit-user"]');
  await phone.fill('#pf-budget-amount', '');
  await phone.click('#pf-budget-amount'); await phone.keyboard.type('260', { delay: DELAY });
  await phone.click('button[data-act="pf-save"]');
  await settle(phone);
  await page.click('#nav button[data-view="plan"]');
  ok('sync: a budget changed on the phone shows on the laptop', await until(() => /Budget 260\.00 CZK a day/.test(document.getElementById('main').textContent), null, page, 15000), (await text('#main')).slice(0, 300));
  await phone.close();

  // ===== sign out, wrong password, sign in again =====
  await page.click('button[data-act="web-signout"]');
  ok('sign out: back on the home page, nothing of the account on screen', await until(() => !!document.querySelector('button[data-act="web-demo"]')) && !(await text('#main')).includes('Ngọc') && (await text('#acct')) === '');
  await page.click('button[data-to="signin"]');
  await typeInto('#web-email', EMAIL1); await typeInto('#web-pw', 'wrong-pass'); await page.click('#web-auth [type=submit]');
  ok('sign in: a wrong password is refused with a plain message', await until(() => /E-mail or password is wrong/.test(document.getElementById('web-auth-msg').textContent)), await text('#web-auth-msg'));
  await typeInto('#web-pw', 'heslo-123'); await page.click('#web-auth [type=submit]');
  ok('sign in: the data is back (weigh-in 59.1 and budget 260)', await until(() => /Budget 260\.00 CZK a day/.test(document.getElementById('main').textContent)));

  // ===== a second account in the same browser sees nothing of the first =====
  await page.click('button[data-act="web-signout"]');
  await until(() => !!document.querySelector('button[data-act="web-demo"]'));
  await page.click('button[data-to="signup"]');
  await typeInto('#web-email', EMAIL2); await typeInto('#web-pw', 'heslo-456'); await page.click('#web-auth [type=submit]');
  ok('two accounts: the second one starts empty', await until(() => /No profile yet/.test(document.getElementById('main').textContent)) && !(await text('#main')).includes('Ngọc'));
  await page.click('button[data-act="web-signout"]');
  await until(() => !!document.querySelector('button[data-act="web-demo"]'));
  await page.click('button[data-to="signup"]');
  await typeInto('#web-email', EMAIL1); await typeInto('#web-pw', 'another-1'); await page.click('#web-auth [type=submit]');
  ok('sign up: an e-mail that has an account is refused', await until(() => /exists/.test(document.getElementById('web-auth-msg').textContent)));
  await page.click('button[data-to="home"]');

  // ===== demo account =====
  await page.click('button[data-act="web-demo"]');
  ok('demo: opens straight into the app with the sample person', await until(() => /New plan for Tomáš Dvořák/.test(document.getElementById('main').textContent)), await text('#main'));
  ok('demo: marked as demo with Keep my data', (await text('#acct')).includes('Demo account') && (await text('#acct')).includes('Keep my data'));
  await page.click('#nav button[data-view="history"]');
  const hist = await page.evaluate(() => { const u = window.MPStore.S().users['tomas-dvorak']; return u.history.weighins.map(w => w.date); });
  const newest = hist.sort().pop(), age = (Date.parse(today) - Date.parse(newest)) / 86400000;
  ok('demo: dates moved to the present (newest weigh-in within the last 2 days)', age >= 0 && age <= 2, { newest, today });
  ok('demo: birth date is not moved (age stays 23)', await page.evaluate(() => window.MPStore.S().users['tomas-dvorak'].profile.body.birth_date) === '2003-05-14');
  await page.click('#nav button[data-view="requests"]');
  await page.click('button[data-act="open-request"]');
  const rt = await text('#main');
  ok('demo: the Cook result opens with the three picks', rt.includes('Cheapest') && rt.includes('Fastest to your goal') && rt.includes('Best balance'));
  ok('demo: maths check agrees with tools/planner.py', rt.includes('the app and tools/planner.py give the same scores'));
  ok('demo: prices are not shown as old', (await page.$$('#main tr.stale')).length === 0);

  // ===== the result-file bridge (Settings > Prices from Claude's runs) =====
  await page.click('#nav button[data-view="settings"]');
  const rid = await page.evaluate(() => Object.keys(window.MPStore.S().results)[0]);
  const res = JSON.parse(await page.evaluate(id => window.MPWeb._test.space().files['data/results/' + id + '.json'], rid));
  res.options[0].label = 'Bridge test option'; res.finished = new Date().toISOString();
  await page.setInputFiles('#web-result-file', { name: rid + '.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(res)) });
  ok('bridge: a result file for a request here is added and opened', await until(() => /Bridge test option/.test(document.getElementById('main').textContent)), (await text('#main')).slice(0, 200));
  await page.click('#nav button[data-view="settings"]');
  await page.setInputFiles('#web-result-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{not json') });
  ok('bridge: a broken file is refused with a reason', await until(() => /not readable JSON/.test(document.getElementById('web-result-msg').textContent)));
  await page.setInputFiles('#web-result-file', { name: 'y.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ id: 'REQ-20200101-000000-nobody', options: [] })) });
  ok('bridge: a result for a request that is not here is refused', await until(() => /No request REQ-20200101-000000-nobody/.test(document.getElementById('web-result-msg').textContent)));

  // ===== keep the demo as a real account =====
  await page.click('#acct button[data-act="web-keep"]');
  await typeInto('#web-email', EMAIL3); await typeInto('#web-pw', 'keep-me-1'); await page.click('#web-auth [type=submit]');
  ok('keep: the demo becomes an account with an e-mail, data kept', await until(() => /New plan for Tomáš Dvořák/.test(document.getElementById('main').textContent)) && (await text('#acct')).includes(EMAIL3), await text('#acct'));
  await page.click('button[data-act="web-signout"]');
  await until(() => !!document.querySelector('button[data-act="web-demo"]'));
  await page.click('button[data-to="signin"]');
  await typeInto('#web-email', EMAIL3); await typeInto('#web-pw', 'keep-me-1'); await page.click('#web-auth [type=submit]');
  ok('keep: signing in again brings the demo data back', await until(() => /New plan for Tomáš Dvořák/.test(document.getElementById('main').textContent)));
  if (FB) {
    const uid = await page.evaluate(() => window.MPWeb._test.backend().user().uid);
    const r = await fetch(`http://127.0.0.1:8085/v1/projects/demo-meal-planner/databases/(default)/documents/spaces/${uid}/files?pageSize=100`, { headers: { Authorization: 'Bearer owner' } });
    const j = await r.json();
    ok('firebase: the files really are in Firestore (8 or more documents in this account\'s space)', (j.documents || []).length >= 8, (j.documents || []).length);
    ok('firebase: nothing of the account is in localStorage', await page.evaluate(() => !Object.keys(localStorage).some(k => k.startsWith('mp-local:space:'))));
  }

  // ===== phone width on the signed-out screens =====
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('button[data-act="web-signout"]');
  await until(() => !!document.querySelector('button[data-act="web-demo"]'));
  ok('390 px: home page has no sideways scroll', await noSideScroll());
  const tap = await page.evaluate(() => Array.from(document.querySelectorAll('#main button')).filter(b => b.offsetParent).map(b => b.getBoundingClientRect().height));
  ok('390 px: home buttons are at least 44 px tall', tap.every(x => x >= 44), tap);
  await page.click('button[data-to="signin"]');
  ok('390 px: sign-in page has no sideways scroll', await noSideScroll());
  ok('no console errors', errors.length === 0, errors);
} catch (e) {
  fail++; log.push('FAIL exception: ' + (e && e.stack || e).toString().slice(0, 600));
}
await browser.close(); server.close();
console.log(log.join('\n'));
console.log((fail ? 'FAIL ' + fail + ' of ' + (pass + fail) : 'PASS ' + pass + ' web checks') + ' (' + (FB ? 'Firebase emulators' : 'practice backend') + ')');
process.exit(fail ? 1 : 0);
