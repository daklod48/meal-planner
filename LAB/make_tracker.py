#!/usr/bin/env python3
"""Builds LAB/tracker.html from LAB/runs.json and the captures: one file that opens by double-click (no server, no
file picker). Data embedded as JSON, thumbnails embedded as small base64 JPEGs. Run from the repository root:
python3 LAB/make_tracker.py"""
import base64
import io
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
runs = json.load(open(os.path.join(ROOT, 'runs.json'), encoding='utf-8'))
CRIT = [('beauty', 'Beauty'), ('clarity', 'Clarity'), ('flow', 'Flow'), ('trust', 'Trust'), ('mobile', 'Mobile'), ('speed', 'Speed'), ('accessibility', 'Access.'), ('delight', 'Delight')]


def thumb(path, box, width):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    im = im.crop((0, 0, w, min(h, int(w * box))))
    im = im.resize((width, int(width * im.size[1] / im.size[0])))
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=62, optimize=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()


for r in runs:
    d = os.path.join(ROOT, 'captures', 'run-%02d' % r['run'])
    r['thumbs'] = []
    for name, box, wd, cap in (('phone-03-new-plan.png', 844 / 390, 180, 'Phone, New plan'), ('phone-08-result.png', 844 / 390, 180, 'Phone, Result'), ('laptop-01-home.png', 900 / 1440, 360, 'Laptop, Home')):
        p = os.path.join(d, name)
        if os.path.exists(p):
            r['thumbs'].append({'src': thumb(p, box, wd), 'cap': cap})

data = json.dumps({'runs': runs, 'crit': CRIT}, ensure_ascii=False).replace('</', '<\\/')
html = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lab Tracker</title>
<style>
:root { --bg:#f6f5f1; --card:#fff; --text:#1d2321; --muted:#4f5a56; --line:#d5d9d5; --accent:#1f6b4f; --soft:#e3f0ea; --up:#1f6b4f; --down:#a3221b; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141816; --card:#1d2320; --text:#e8ece9; --muted:#aab4af; --line:#36403b; --accent:#6fcf9f; --soft:#23362c; --up:#6fcf9f; --down:#ff8f86; } }
:root[data-theme="dark"] { --bg:#141816; --card:#1d2320; --text:#e8ece9; --muted:#aab4af; --line:#36403b; --accent:#6fcf9f; --soft:#23362c; --up:#6fcf9f; --down:#ff8f86; }
* { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
main { max-width:1080px; margin:0 auto; padding:24px 16px 48px; }
h1 { font-size:1.7rem; margin:0 0 4px; } .muted { color:var(--muted); }
.panel { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; margin:16px 0; }
.chart svg { width:100%; height:auto; display:block; }
.cards { display:grid; gap:16px; }
.run { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; }
.run.best { border:2px solid var(--accent); }
.run header { display:flex; flex-wrap:wrap; align-items:baseline; gap:8px 16px; }
.run h2 { margin:0; font-size:1.25rem; } .total { font-size:1.6rem; font-weight:700; color:var(--accent); }
.tag { background:var(--soft); color:var(--accent); border-radius:999px; padding:2px 10px; font-size:.85rem; font-weight:700; }
.scores { display:grid; grid-template-columns:repeat(auto-fit,minmax(92px,1fr)); gap:8px; margin:12px 0; }
.sc { background:var(--bg); border-radius:10px; padding:6px 10px; } .sc b { font-size:1.15rem; } .sc small { display:block; color:var(--muted); }
.up { color:var(--up); font-weight:700; } .down { color:var(--down); font-weight:700; }
.thumbs { display:flex; gap:12px; flex-wrap:wrap; } figure { margin:0; } figure img { border:1px solid var(--line); border-radius:8px; display:block; max-width:100%; }
figcaption { font-size:.85rem; color:var(--muted); }
ul { padding-left:20px; } a { color:var(--accent); }
</style></head><body><main>
<h1>Improvement Lab: Meal Planner web app</h1>
<p class="muted">Rubric frozen 2026-11-05 (8 criteria, 1 to 10, total out of 80). Each run is scored by an independent subagent that sees only that run's screenshots, metrics and the rubric.</p>
<section class="panel chart" aria-label="Total score per run"><div id="chart"></div></section>
<section class="cards" id="cards"></section>
</main>
<script id="data" type="application/json">__DATA__</script>
<script>
var D = JSON.parse(document.getElementById('data').textContent), runs = D.runs, crit = D.crit;
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
var best = runs.reduce(function (a, r) { return r.total > a.total ? r : a; }, runs[0]);
(function chart() {
  var W = 640, H = 220, L = 40, R = 16, T = 16, B = 36, n = runs.length;
  var x = function (i) { return n === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (n - 1); }, y = function (v) { return T + (80 - v) * (H - T - B) / 80; };
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Total score per run, out of 80">';
  [0, 20, 40, 60, 80].forEach(function (v) { s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="12" fill="var(--muted)">' + v + '</text>'; });
  s += '<polyline fill="none" stroke="var(--accent)" stroke-width="3" points="' + runs.map(function (r, i) { return x(i) + ',' + y(r.total); }).join(' ') + '"/>';
  runs.forEach(function (r, i) {
    s += '<circle cx="' + x(i) + '" cy="' + y(r.total) + '" r="' + (r === best ? 7 : 5) + '" fill="var(--accent)"/>' +
      '<text x="' + x(i) + '" y="' + (y(r.total) - 12) + '" text-anchor="' + (n > 1 && i === n - 1 ? 'end' : n > 1 && i === 0 ? 'start' : 'middle') + '" font-size="13" font-weight="700" fill="var(--text)">' + r.total + (r === best ? ' best' : '') + '</text>' +
      '<text x="' + x(i) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="12" fill="var(--muted)">Run ' + r.run + '</text>';
  });
  document.getElementById('chart').innerHTML = s + '</svg>';
})();
document.getElementById('cards').innerHTML = runs.slice().reverse().map(function (r) {
  var prev = runs.filter(function (p) { return p.run === r.run - 1; })[0];
  var sc = crit.map(function (c) {
    var v = r.scores[c[0]], d = prev ? v - prev.scores[c[0]] : 0;
    return '<div class="sc"><small>' + esc(c[1]) + '</small><b>' + v + '</b> ' + (d > 0 ? '<span class="up">+' + d + '</span>' : d < 0 ? '<span class="down">' + d + '</span>' : '') + '</div>';
  }).join('');
  return '<article class="run' + (r === best ? ' best' : '') + '"><header><h2>Run ' + r.run + '</h2><span class="total">' + r.total + ' / 80</span>' +
    (r === best ? '<span class="tag">Best run</span>' : '') + '<span class="tag">' + esc(r.verdict) + '</span><span class="muted">' + esc(r.date) + '</span></header>' +
    '<p>' + esc(r.what_changed) + '</p>' + (r.innovation ? '<p><b>Innovation:</b> ' + esc(r.innovation) + '</p>' : '') +
    '<div class="scores">' + sc + '</div>' +
    '<div class="thumbs">' + (r.thumbs || []).map(function (t) { return '<figure><img src="' + t.src + '" alt="' + esc(t.cap) + ', run ' + r.run + '"><figcaption>' + esc(t.cap) + '</figcaption></figure>'; }).join('') + '</div>' +
    '<p><b>Top flaws found by the scorer:</b></p><ul>' + (r.flaws || []).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' +
    ((r.references || []).length ? '<p><b>References:</b> ' + r.references.map(function (x) { return '<a href="' + esc(x.url) + '">' + esc(x.name) + '</a> (' + esc(x.borrowed) + ')'; }).join('; ') + '</p>' : '') +
    '<p class="muted">Tests: ' + esc(r.tests) + '. Size: ' + esc(r.size && r.size.change_pct !== undefined ? '+' + r.size.change_pct + ' %' : 'baseline') + '. Scorer: ' + esc(r.scorer) + '. Tools: ' + esc((r.tools || []).join(', ')) + '. Captures: ' + esc(r.preview) + '.</p></article>';
}).join('');
</script></body></html>
'''.replace('__DATA__', data)
out = os.path.join(ROOT, 'tracker.html')
open(out, 'w', encoding='utf-8').write(html)
print('tracker:', out, os.path.getsize(out) // 1024, 'kB,', len(runs), 'runs')
