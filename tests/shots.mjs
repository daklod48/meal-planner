// Screenshots of three screens, from the data the last t_app.mjs run left in tests/out/data (for a look at the layout).
import { chromium } from './pw.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = path.resolve('.');
const server = http.createServer((q, s) => { const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html; charset=utf-8' : p.endsWith('.css') ? 'text/css' : 'text/javascript; charset=utf-8' }); fs.createReadStream(p).pipe(s); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const files = {}; (function walk(d, pre) { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); if (fs.statSync(f).isDirectory()) walk(f, pre + n + '/'); else files[pre + n] = fs.readFileSync(f, 'utf8'); } })('tests/out/data', '');
const b = await chromium.launch(); const scheme = process.argv[2] || 'light';
const page = await b.newPage({ viewport: { width: Number(process.argv[3] || 1200), height: 900 }, colorScheme: scheme });
await page.addInitScript(f => { window.__MP_TEST__ = { dirPromise: (async () => { const r = await navigator.storage.getDirectory(); const d = await r.getDirectoryHandle('MP', { create: true }); await d.getDirectoryHandle('app', { create: true }); for (const [p, t] of Object.entries(f)) { let x = await d.getDirectoryHandle('data', { create: true }); const a = p.split('/'); for (const n of a.slice(0, -1)) x = await x.getDirectoryHandle(n, { create: true }); const w = await (await x.getFileHandle(a[a.length - 1], { create: true })).createWritable(); await w.write(t); await w.close(); } return d; })() }; }, files);
await page.goto(`http://127.0.0.1:${server.address().port}/app/MealPlanner.html`);
await page.waitForSelector('#nav button');
await page.click('#nav button[data-view="requests"]'); await page.click('button[data-act="open-request"]'); await page.waitForTimeout(300);
await page.screenshot({ path: `tests/out/shot-result-${scheme}.png`, fullPage: true });
await page.click('#nav button[data-view="history"]'); await page.waitForTimeout(200);
await page.screenshot({ path: `tests/out/shot-history-${scheme}.png`, fullPage: false });
await page.click('#nav button[data-view="profiles"]'); await page.click('button[data-act="edit-user"]'); await page.waitForTimeout(200);
await page.screenshot({ path: `tests/out/shot-profile-${scheme}.png`, fullPage: false });
await b.close(); server.close(); console.log('shots done');
