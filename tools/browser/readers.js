// Meal Planner readers for Order online and Eat out (session 4, 2026-10-19). Pasted by the run inside the shop's own page
// (wolt.com, foodora.cz, menicka.cz) after dish-core.js and MPD.T; `dine.py terms` writes all of it into data/runs/<REQ>/read.js.
// It reads the sites' own data (the JSON their pages use, or the fetched HTML), never the visible page, so Chrome's translation
// does not matter. Nothing is clicked, nothing is bought. Output: ONE tab-separated table written into the page (MPR.write()),
// first line = the header, read once with get_page_text. Every venue is read and counted (row L = ledger); the table keeps the best ones.
var MPR = (function () {
  var S = { src: null, state: 'idle', done: 0, total: 0, failed: 0, rows: [], ledger: {}, errors: [] };
  var HEAD = ['kind', 'venue', 'venue_name', 'lat', 'lng', 'eta_min', 'eta_max', 'fee', 'min_order', 'service_pct', 'service_min', 'open', 'item', 'dish', 'price', 'weight', 'desc', 'url', 'rest'];
  var STOP = ['restaurace', 'restaurant', 'bistro', 'praha', 'prague', 'chodov', 'westfield', 'kunratice', 'the', 'and', 'cafe', 'kavarna', 'pizzeria', 'pizzerie', 'bar', 'grill', 'food', 'centrum', 'roztylska', 'express', 'expres'];
  function tokens(s) { return MPD.fold(s).split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 3 && STOP.indexOf(w) < 0; }); }
  function dist(a, b, c, d) { var R = 6371000, p1 = a * Math.PI / 180, p2 = c * Math.PI / 180, dp = (c - a) * Math.PI / 180, dl = (d - b) * Math.PI / 180;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2); return 2 * R * Math.asin(Math.sqrt(h)); }
  // a delivery venue is the same restaurant as a surveyed one when it is within 150 m and shares a name word (stop words aside)
  function matchRest(name, lat, lng) {
    var rs = P().rests || [], tv = tokens(name), best = null, bd = 1e9;
    rs.forEach(function (r) { if (lat == null || r.lat == null) return; var d = dist(lat, lng, r.lat, r.lng); if (d > 150) return;
      var tr = tokens(r.name); if (!tv.some(function (w) { return tr.indexOf(w) >= 0; })) return; if (d < bd) { bd = d; best = r.id; } });
    return best;
  }
  function clean(s) { return String(s == null ? '' : s).replace(/[\t\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function row(o) { return HEAD.map(function (k) { return clean(o[k]); }).join('|'); }
  function num(s) { var m = String(s == null ? '' : s).replace(/\s/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; }
  function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  // 19/10 (review): a 403, or a page that is not JSON (a robot-check page answers 200 with HTML), BLOCKS the source: no retry,
  // no further requests, state 'blocked'. The run then skips the site (never touch a robot check).
  function block(why) { S.blocked = why; S.ledger.blocked = why; throw new Error('blocked: ' + why); }
  async function getJSON(url, opt) {
    var st = 0;
    for (var a = 0; a < 4; a++) {
      if (S.blocked) throw new Error('blocked: ' + S.blocked);
      var r = null;
      try { r = await fetch(url, opt); st = r.status; } catch (e) { st = 'network'; }
      if (r && r.ok) { var tx = await r.text(); try { return JSON.parse(tx); } catch (e) { block('HTTP 200 but not JSON (robot check?)'); } }
      if (st === 403) block('HTTP 403 (robot check)');
      if (r && st !== 429 && st < 500) break;
      await sleep(1000 * Math.pow(2, a));
    }
    throw new Error('HTTP ' + st);
  }
  async function pool(list, n, fn, side) { var i = 0; async function w() { while (i < list.length && !S.blocked) { var k = i++; try { await fn(list[k]); } catch (e) { S.failed++; S.errors.push(String(e).slice(0, 60)); } if (!side) S.done++; else S.phase2 = (S.phase2 || 0) + 1; } } var ws = []; for (var j = 0; j < n; j++) ws.push(w()); await Promise.all(ws); }
  function P() { return MPR.params; }

  // ---------------- Wolt (consumer-api.wolt.com, used by wolt.com itself)
  async function woltList() {
    var p = P(), j = await getJSON('https://consumer-api.wolt.com/v1/pages/restaurants?lat=' + p.lat + '&lon=' + p.lng);
    var seen = {}, out = [];
    (j.sections || []).forEach(function (s) { (s.items || []).forEach(function (it) { var v = it.venue; if (v && v.slug && !seen[v.slug]) { seen[v.slug] = 1; out.push(v); } }); });
    return out;
  }
  function woltEta(v) { var m = String(v.estimate_range || '').match(/(\d+)\D+(\d+)/); if (m) return [+m[1], +m[2]]; return v.estimate ? [v.estimate, v.estimate] : [null, null]; }
  async function woltMenu(slug) {
    var a = await getJSON('https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/' + slug + '/assortment?language=cs');
    return (a.items || []).map(function (i) {
      var price = (i.price || 0) / 100;
      return { item: i.id, dish: i.name, price: price, weight: i.unit_info || '', desc: (i.description || '').slice(0, 160),
        url: 'https://wolt.com/cs/cze/prague/restaurant/' + slug + '/itemid-' + i.id, est: MPD.estimate(i.name, i.description || '', i.unit_info || '', 'dish', null, price) };
    });
  }
  async function woltDyn(slug) {
    var p = P(), d = await getJSON('https://consumer-api.wolt.com/order-xp/web/v1/venue/slug/' + slug + '/dynamic/?lat=' + p.lat + '&lon=' + p.lng + '&selected_delivery_method=homedelivery');
    var v = d.venue || {}, fee = null, minimum = null, open = (v.delivery_open_status && v.delivery_open_status.value) || '';
    ((v.header && v.header.delivery_method_statuses) || []).forEach(function (s) {
      if (s.delivery_method !== 'DELIVERY') return;
      (s.metadata || []).forEach(function (m) { if (m.meaning === 'DELIVERY_FEE') fee = num(m.value); if (m.meaning === 'ORDER_MINIMUM') minimum = num(m.value); });
    });
    var eta = null; (v.delivery_configs || []).forEach(function (c) { if (c.method === 'homedelivery' && c.estimate) eta = [c.estimate.min, c.estimate.max]; });
    return { fee: fee, min_order: minimum, open: open, eta: eta };
  }

  // ---------------- foodora (disco listing + cz.fd-api.com vendor menus, used by foodora.cz itself)
  function fdHeaders() {
    var ck = {}; document.cookie.split('; ').forEach(function (c) { var i = c.indexOf('='); ck[c.slice(0, i)] = decodeURIComponent(c.slice(i + 1)); });
    return { 'x-fp-api-key': 'volo', 'perseus-client-id': ck.dhhPerseusGuestId || '', 'perseus-session-id': ck.dhhPerseusSessionId || '' };
  }
  async function fdList() {
    var p = P(), out = [], off = 0, total = 1;
    while (off < total && off < 2000) {
      var j = await getJSON('https://disco.deliveryhero.io/listing/api/v1/pandora/vendors?latitude=' + p.lat + '&longitude=' + p.lng + '&language_id=1&include=characteristics&dynamic_pricing=0&configuration=Variant1&country=cz&vertical=restaurants&limit=100&offset=' + off + '&sort=&use_free_delivery_label=false&opening_type=delivery', { headers: { 'x-disco-client-id': 'web' } });
      var it = (j.data && j.data.items) || []; total = (j.data && j.data.available_count) || 0; out = out.concat(it); off += 100; if (!it.length) break;
    }
    return out;
  }
  async function fdMenu(code) {
    var p = P(), j = await getJSON('https://cz.fd-api.com/api/v5/vendors/' + code + '?include=menus&language_id=1&opening_type=delivery&basket_currency=CZK&latitude=' + p.lat + '&longitude=' + p.lng, { headers: fdHeaders() });
    var out = [], data = j.data || {};
    ((data.menus || [])[0] || { menu_categories: [] }).menu_categories.forEach(function (c) {
      (c.products || []).forEach(function (pr) {
        var v = (pr.product_variations || [])[0] || {}; if (pr.is_sold_out) return;
        var price = (v.price || 0) + (v.container_price || 0);
        out.push({ item: pr.code || pr.id, dish: pr.name, price: price, weight: '', desc: (pr.description || '').slice(0, 160),
          url: 'https://www.foodora.cz/restaurant/' + code + '/' + (data.url_key || ''), est: MPD.estimate(pr.name, pr.description || '', '', 'dish', null, price) });
      });
    });
    return out;
  }

  // ---------------- menicka.cz (daily lunch menus: each surveyed restaurant's own page, today's block only)
  function today() { var d = new Date(); return d.getDate() + '.' + (d.getMonth() + 1) + '.' + d.getFullYear(); }
  async function menicka(list) {
    var out = [];
    await pool(list, 2, async function (x) {
      var t = await (await fetch(x.url)).text(), d = new DOMParser().parseFromString(t, 'text/html'), rid = (x.url.match(/(\d+)-?[^/]*\.html/) || [])[1] || x.url;
      var day = null;
      d.querySelectorAll('.menicka').forEach(function (m) { var h = clean((m.querySelector('.nadpis') || m).textContent).slice(0, 40); if (!day && h.indexOf(today()) >= 0) day = m; });
      var dishes = [];
      if (day) day.querySelectorAll('li.jidlo').forEach(function (li) {
        var raw = clean((li.querySelector('.polozka') || li).textContent).replace(/^\d+\.\s*/, '').replace(/^pol[eé]vka\s*\+\s*/i, '');
        // the allergen numbers after the dish ("(1,3,7)" or "1, 3, 7") are KEPT as desc "A:1,3,7" for the allergy check (19/10 review)
        var al = raw.match(/\s*\(\s*(\d+[a-z]?(?:\s*,\s*\d+[a-z]?)*)\s*\)\s*$/i) || raw.match(/((?:\s+\d+[a-z]?)(?:\s*,?\s*\d+[a-z]?)*)$/i);
        var codes = al ? al[1].replace(/\s+/g, '').replace(/^,|,$/g, '').toLowerCase() : '';
        var nm = al ? raw.slice(0, raw.length - al[0].length).trim() : raw, price = num((li.querySelector('.cena') || {}).textContent);
        var g = nm.match(/^(\d+(?:[.,]\d+)?\s*(?:g|kg))\s+/i), name = g ? nm.slice(g[0].length) : nm;
        dishes.push({ item: rid + '-' + (dishes.length + 1), dish: name, price: price, weight: g ? g[1] : '', desc: codes ? 'A:' + codes.replace(/[^0-9a-z,]/g, '') : '', url: x.url, est: MPD.estimate(name, '', g ? g[1] : '', 'meat', null, price) });
      });
      out.push({ v: { rid: rid, name: clean((d.querySelector('h1') || {}).textContent) || x.rest, url: x.url, rest: x.rest, today: !!day }, items: dishes });
    });
    return out;
  }

  async function run(src) {
    var p = P(); S = { src: src, state: 'running', done: 0, total: 0, failed: 0, rows: [], ledger: {}, errors: [], started: Date.now() };
    var mode = p.mode || (p.max_min ? 'order' : 'eatout');
    if (src === 'wolt') {
      var vs = await woltList(), keep = [];
      S.ledger.listed = vs.length;
      if (mode === 'venues') { vs.forEach(function (v) { var e = woltEta(v); S.rows.push({ kind: 'V', venue: v.slug, venue_name: v.name, lat: v.location && v.location[1], lng: v.location && v.location[0], eta_min: e[0], eta_max: e[1], url: 'https://wolt.com/cs/cze/prague/restaurant/' + v.slug }); }); S.state = 'done'; return; }
      var todo = vs.filter(function (v) {
        if (mode === 'eatout') { v._rest = matchRest(v.name, v.location && v.location[1], v.location && v.location[0]); return !!v._rest; }
        if (v.online === false) { S.ledger.closed_now = (S.ledger.closed_now || 0) + 1; return false; }
        var e = woltEta(v); if (e[1] === null) { S.ledger.no_time = (S.ledger.no_time || 0) + 1; return true; }
        if (e[1] > p.max_min) { S.ledger.too_slow = (S.ledger.too_slow || 0) + 1; return false; } return true;
      });
      S.total = todo.length;
      await pool(todo, 2, async function (v) { var items = await woltMenu(v.slug); keep.push({ v: v, items: items }); });
      await finish(keep, function (k) { return k.v.slug; }, mode, async function (k) {
        var dy;
        try { dy = await woltDyn(k.v.slug); } catch (err) { if (mode !== 'eatout') throw err; dy = { fee: null, min_order: null, open: 'hours not read', eta: null }; }  // eat out needs no fee
        var e = dy.eta || woltEta(k.v);
        return { kind: 'V', venue: k.v.slug, venue_name: k.v.name, lat: k.v.location && k.v.location[1], lng: k.v.location && k.v.location[0], eta_min: e[0], eta_max: e[1],
          fee: dy.fee, min_order: dy.min_order, service_pct: 0, service_min: 0, open: dy.open, url: 'https://wolt.com/cs/cze/prague/restaurant/' + k.v.slug, rest: k.v._rest || '' };
      });
    } else if (src === 'foodora') {
      var fv = await fdList(), keepf = [];
      S.ledger.listed = fv.length;
      if (mode === 'venues') { fv.forEach(function (v) { S.rows.push({ kind: 'V', venue: v.code, venue_name: v.name, lat: v.latitude, lng: v.longitude, eta_min: v.minimum_delivery_time, eta_max: v.minimum_delivery_time, fee: v.minimum_delivery_fee, min_order: v.minimum_order_amount, service_pct: v.service_fee_percentage_amount, url: 'https://www.foodora.cz/restaurant/' + v.code + '/' + (v.url_key || '') }); }); S.state = 'done'; return; }
      var todof = fv.filter(function (v) {
        if (mode === 'eatout') { v._rest = matchRest(v.name, v.latitude, v.longitude); return !!v._rest; }
        if (v.is_active === false) { S.ledger.inactive = (S.ledger.inactive || 0) + 1; return false; }
        if (v.minimum_delivery_time && v.minimum_delivery_time > p.max_min) { S.ledger.too_slow = (S.ledger.too_slow || 0) + 1; return false; } return true;
      });
      S.total = todof.length;
      await pool(todof, 2, async function (v) { var items = await fdMenu(v.code); keepf.push({ v: v, items: items }); });
      await finish(keepf, function (k) { return k.v.code; }, mode, async function (k) {
        var v = k.v;
        return { kind: 'V', venue: v.code, venue_name: v.name, lat: v.latitude, lng: v.longitude, eta_min: v.minimum_delivery_time, eta_max: v.minimum_delivery_time,
          fee: v.minimum_delivery_fee, min_order: v.minimum_order_amount, service_pct: v.service_fee_percentage_amount || 0, service_min: 0, open: v.is_active === false ? 'not active' : '',
          url: 'https://www.foodora.cz/restaurant/' + v.code + '/' + (v.url_key || ''), rest: v._rest || '' };
      });
    } else if (src === 'menicka') {
      var list = await menicka(p.menicka || []);
      S.total = list.length; S.ledger.listed = list.length; S.ledger.no_menu_today = list.filter(function (k) { return !k.v.today; }).length;
      await finish(list, function (k) { return k.v.rid; }, 'eatout', async function (k) { return { kind: 'V', venue: k.v.rid, venue_name: k.v.name, url: k.v.url, rest: k.v.rest, open: k.v.today ? 'daily menu ' + today() : 'no daily menu today' }; });
    }
  }
  async function finish(keep, idOf, mode, venueRow) {
    var dishesSeen = 0, okSeen = 0;
    keep.forEach(function (k) { dishesSeen += k.items.length; k.ok = k.items.filter(function (x) { return x.est && !x.est.skip && x.price > 0; }); okSeen += k.ok.length; k.score = MPD.venueScore(k.ok, P().meals || 3); });
    S.ledger.read = keep.length; S.ledger.failed = S.failed; S.ledger.dishes = dishesSeen; S.ledger.dishes_estimated = okSeen;
    var ranked = keep.filter(function (k) { return k.ok.length; }).sort(function (a, b) { return b.score - a.score || (idOf(a) < idOf(b) ? -1 : 1); });
    S.ledger.with_meals = ranked.length;
    if (mode === 'order') ranked = ranked.slice(0, P().venues || 20);
    S.ledger.kept = ranked.length;
    var vrows = {};
    await pool(ranked, 2, async function (k) { try { vrows[idOf(k)] = await venueRow(k); } catch (e) { S.errors.push('venue ' + idOf(k)); } }, true);
    ranked.forEach(function (k) {
      var vr = vrows[idOf(k)]; if (!vr) return;
      S.rows.push(vr);
      MPD.shortlist(k.ok, P().dishes || 6).forEach(function (x) { S.rows.push({ kind: 'D', venue: idOf(k), item: x.item, dish: x.dish, price: x.price, weight: x.weight, desc: String(x.desc || '').slice(0, 160) }); });  // the same 160 characters the estimate saw (19/10 review: 60 lost meat words)
    });
    S.state = S.blocked ? 'blocked' : 'done';
  }
  return {
    params: null,
    start: function (src) { run(src).catch(function (e) { S.state = 'error'; S.errors.push(String(e).slice(0, 80)); }); return 'started ' + src; },
    status: function () { return S.src + ' ' + S.state + ': ' + S.done + '/' + S.total + ' read, ' + (S.phase2 ? S.phase2 + ' venue details, ' : '') + S.failed + ' failed, ' + S.rows.length + ' rows, ' + Math.round((Date.now() - (S.started || Date.now())) / 1000) + ' s' + (S.errors.length ? ', errors: ' + S.errors.slice(0, 3).join(' | ') : ''); },
    write: function () {
      var led = Object.keys(S.ledger).map(function (k) { return k + ' ' + S.ledger[k]; }).join(', ');
      var lines = [HEAD.join('|')].concat(S.rows.map(row)).concat([row({ kind: 'L', desc: S.src + ': ' + led })]);
      document.body.innerHTML = '<pre id="mpv" translate="no"></pre>';
      document.getElementById('mpv').textContent = lines.join('\n');
      return 'written ' + S.rows.length + ' rows';
    },
    _S: function () { return S; }
  };
})();
