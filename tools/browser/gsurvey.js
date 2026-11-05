// Meal Planner restaurant survey on Google Maps (session 4, 2026-10-19). Used once per place ("meal planner, refresh restaurants for
// <place>"), never by the daily run. Paste on a google.com/maps page. MPG.collect() reads the result list of the search page that
// is open (scrolls it to the end) and adds every place to localStorage 'mp_g'; navigate to the next search and call it again.
// MPG.walk(lat, lng) asks the OpenStreetMap foot router (routing.openstreetmap.de, OSRM table service) for the walking time and
// distance from the place to every collected restaurant in ONE request, then MPG.write() puts the table into the page.
// MPG.clear() removes the localStorage key at the end.
var MPG = (function () {
  function load() { try { return JSON.parse(localStorage.getItem('mp_g') || '[]'); } catch (e) { return []; } }
  function save(a) { localStorage.setItem('mp_g', JSON.stringify(a)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function clean(s) { return String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  async function collect(query) {
    var feed = document.querySelector('[role=feed]');
    for (var i = 0; i < 25 && feed; i++) {
      feed.scrollTop = feed.scrollHeight; await sleep(900);
      if (/Dostali jste se na konec seznamu|reached the end of the list/i.test(feed.innerText)) break;
    }
    var have = load(), seen = {}; have.forEach(function (x) { seen[x.name + '|' + x.lat] = 1; });
    var added = 0;
    document.querySelectorAll('a[href*="/maps/place/"]').forEach(function (a) {
      var m = a.href.match(/!3d(-?[\d.]+)!4d(-?[\d.]+)/), card = a.closest('[role=article]') || a.parentElement;
      var name = clean(a.getAttribute('aria-label')); if (!m || !name) return;
      var text = clean(card ? card.innerText : '');
      if (/Sponzorov|Sponsored/.test(text)) return;
      var k = name + '|' + m[1]; if (seen[k]) return; seen[k] = 1;
      have.push({ name: name, lat: +m[1], lng: +m[2], text: text.slice(0, 300), url: a.href.split('?')[0], q: query || '' }); added++;
    });
    save(have);
    return 'added ' + added + ', total ' + have.length;
  }
  async function walk(lat, lng, maxM) {
    var a = load(), keep = [];
    a.forEach(function (x) { var d = dist(lat, lng, x.lat, x.lng); x.line_m = Math.round(d); if (d <= (maxM || 2500)) keep.push(x); });
    for (var i = 0; i < keep.length; i += 90) {
      var part = keep.slice(i, i + 90), coords = [lng + ',' + lat].concat(part.map(function (x) { return x.lng + ',' + x.lat; })).join(';');
      var r = await fetch('https://routing.openstreetmap.de/routed-foot/table/v1/foot/' + coords + '?sources=0&annotations=duration,distance'), j = await r.json();
      part.forEach(function (x, k) { x.walk_s = j.durations[0][k + 1]; x.walk_m = j.distances[0][k + 1]; });
    }
    save(a);
    return 'walk read for ' + keep.length + ' of ' + a.length;
  }
  function dist(a, b, c, d) { var R = 6371000, p1 = a * Math.PI / 180, p2 = c * Math.PI / 180, dp = (c - a) * Math.PI / 180, dl = (d - b) * Math.PI / 180;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2); return 2 * R * Math.asin(Math.sqrt(h)); }
  function write() {
    var a = load(), lines = ['name\tlat\tlng\ttext\turl\tline_m\twalk_s\twalk_m'];
    a.forEach(function (x) { if (x.walk_s === undefined) return; lines.push([x.name, x.lat, x.lng, x.text, x.url, x.line_m, x.walk_s, x.walk_m].map(clean).join('\t')); });
    document.body.innerHTML = '<pre id="mpg" translate="no"></pre>'; document.getElementById('mpg').textContent = lines.join('\n');
    return 'written ' + (lines.length - 1) + ' rows';
  }
  return { collect: collect, walk: walk, write: write, clear: function () { localStorage.removeItem('mp_g'); return 'cleared'; }, _load: load };
})();
'gsurvey loaded'
