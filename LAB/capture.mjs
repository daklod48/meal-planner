// Improvement Lab captures: every main screen of the web app at phone 390x844 and laptop 1440x900, plus measured
// numbers for the scorer (load time, bytes, small tap targets, small text, sideways scroll, console errors).
// Run from the repository root: LC_ALL=C.UTF-8 node LAB/capture.mjs <run number, e.g. 00>
import { chromium } from '../tests/pw.mjs';
import http from 'http';
import fs from 'fs';
import path from 'path';

const RUN = process.argv[2] || '00';
const ROOT = path.resolve('.');
const OUT = path.join(ROOT, 'LAB', 'captures', 'run-' + RUN);
fs.mkdirSync(OUT, { recursive: true });
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
const browser = await chromium.launch();
const metrics = { run: RUN, date: new Date().toISOString(), sizes: {} };

async function audit(page) {
  return page.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const taps = Array.from(document.querySelectorAll('button, a, select, input:not([type=hidden]), summary')).filter(vis);
    const small = taps.filter(el => { const r = el.getBoundingClientRect(); return r.height < 44 && !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'); });
    const texts = Array.from(document.querySelectorAll('body *')).filter(el => vis(el) && Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim()));
    const tiny = texts.filter(el => parseFloat(getComputedStyle(el).fontSize) < 12);
    return { taps: taps.length, taps_under_44px: small.length, examples_small: small.slice(0, 6).map(el => (el.textContent || el.name || el.id || el.tagName).trim().slice(0, 30)),
      texts_under_12px: tiny.length, sideways_scroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      first_content_y: Math.round(((document.querySelector('#main > *') || document.body).getBoundingClientRect().top)) };
  });
}

for (const [label, vp] of [['phone', { width: 390, height: 844 }], ['laptop', { width: 1440, height: 900 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: label === 'phone' ? 2 : 1, locale: 'en-GB', timezoneId: 'Europe/Prague' });
  // never the live Firebase project (2026-11-08): practice backend, Google's servers refused
  await ctx.addInitScript('window.__MP_TEST__ = Object.assign(window.__MP_TEST__ || {}, { forceLocal: true });');
  await ctx.route(/googleapis\.com|firebaseapp\.com|firebaseio\.com/, r => r.abort());
  const page = await ctx.newPage();
  const errors = []; let bytes = 0;
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', async r => { try { const b = await r.body(); bytes += b.length; } catch (e) { /* ignore */ } });
  const m = { screens: {} };
  const t0 = Date.now();
  await page.goto(URL0, { waitUntil: 'load' });
  await page.waitForSelector('button[data-act="web-demo"]');
  m.home_ready_ms = Date.now() - t0;
  m.home_bytes = bytes;
  const shot = async (name) => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${label}-${name}.png`), fullPage: true });
    m.screens[name] = await audit(page);
  };
  await shot('01-home');
  await page.click('button[data-to="signup"]'); await shot('02-sign-up');
  await page.click('button[data-to="home"]');
  const t1 = Date.now();
  await page.click('button[data-act="web-demo"]');
  await page.waitForFunction(() => /New plan for/.test(document.getElementById('main').textContent));
  m.demo_ready_ms = Date.now() - t1;
  await shot('03-new-plan');
  await page.click('details.why-targets summary').catch(() => {});
  await page.click('#mode-cook').catch(() => {});
  await shot('04-new-plan-cook-form');
  await page.click('#nav button[data-view="profiles"]'); await shot('05-profiles');
  await page.click('button[data-act="edit-user"]'); await shot('06-profile-edit');
  await page.click('button[data-act="pf-cancel"]').catch(() => {});
  await page.click('#nav button[data-view="requests"]'); await shot('07-requests');
  await page.click('button[data-act="open-request"]'); await shot('08-result');
  await page.click('#nav button[data-view="history"]'); await shot('09-history');
  // Since lab run 1 Foods and Shops sit under Settings > More on the phone.
  const goView = async v => { if (await page.isVisible(`#nav button[data-view="${v}"]`)) await page.click(`#nav button[data-view="${v}"]`); else { await page.click('#nav button[data-view="settings"]'); await page.click(`.more-row button[data-view="${v}"]`); } };
  await goView('foods'); await shot('10-foods');
  await goView('shops'); await shot('11-shops');
  await page.click('#nav button[data-view="settings"]'); await shot('12-settings');
  m.total_bytes = bytes;
  m.console_errors = errors;
  metrics.sizes[label] = m;
  await ctx.close();
}
const kb = f => Math.round(fs.statSync(path.join(ROOT, f)).size / 1024);
metrics.code_kb = { 'app.js': kb('app/js/app.js'), 'web.js': kb('app/js/web.js'), 'i18n.js': kb('app/js/i18n.js'), 'app.css': kb('app/css/app.css'), 'web.css': kb('app/css/web.css'),
  'firebase (loaded only when the config is set)': kb('app/vendor/firebase/firebase-app.js') + kb('app/vendor/firebase/firebase-auth.js') + kb('app/vendor/firebase/firebase-firestore.js') };
fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 1));
await browser.close(); server.close();
console.log('captures in', OUT, fs.readdirSync(OUT).length, 'files');
console.log(JSON.stringify({ phone: { home_ms: metrics.sizes.phone.home_ready_ms, demo_ms: metrics.sizes.phone.demo_ready_ms, kb: Math.round(metrics.sizes.phone.total_bytes / 1024), errors: metrics.sizes.phone.console_errors.length },
  small_taps_phone: Object.fromEntries(Object.entries(metrics.sizes.phone.screens).map(([k, v]) => [k, v.taps_under_44px])),
  first_content_y_phone: Object.fromEntries(Object.entries(metrics.sizes.phone.screens).map(([k, v]) => [k, v.first_content_y])) }));
