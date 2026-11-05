// Meal Planner dish rules (session 4, 2026-10-19). TWIN of estimate() in tools/dine.py: same steps, same order, same rounding.
// Used inside the shop page only to SHORTLIST dishes; tools/dine.py re-estimates every kept dish and is the one that counts.
// tests/t_dine.py runs both on the fixture dishes and fails on any difference. MPD.T (the table) is appended by `dine.py terms`.
var MPD = (function () {
  function fold(s) { return String(s == null ? '' : s).normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase(); }  // = cook.fold: drop every combining mark (Mn)
  // = dine.py gtext(): every Unicode space Python's \s knows (JS \s lacks U+0085 and U+001C-001F) and the BOM become ' '
  function gtext(s) { return fold(s || '').replace(/[\s\u0085\u001c-\u001f\ufeff]+/g, ' '); }
  function norm(s) { return ' ' + fold(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).join(' ') + ' '; }
  function r(x, d) { if (x === null || x === undefined || isNaN(x)) return null; var m = Math.pow(10, d), s = x < 0 ? -1 : 1; return s * Math.floor(Math.abs(x) * m + 0.5) / m; }
  function has(t, ws) { for (var i = 0; i < ws.length; i++) if (t.indexOf(' ' + ws[i]) >= 0) return true; return false; }
  function firstKey(t, pairs) { for (var i = 0; i < pairs.length; i++) if (has(t, pairs[i][1])) return pairs[i][0]; return null; }
  var G = '(?<![0-9])([0-9]{1,5}(?:[.,][0-9]+)?) *(kg|g)(?![a-z])';
  function gramsOf(m) { var v = parseFloat(m[1].replace(',', '.')); return m[2] === 'kg' ? v * 1000 : v; }
  function parseG(text) { var m = gtext(text).match(new RegExp(G)); return m ? gramsOf(m) : null; }
  function leadG(text) { var m = gtext(text).match(new RegExp('^ *' + G)); return m ? gramsOf(m) : null; }
  function countOf(t) { var m = t.match(/ ([0-9]{1,4}) ?(x|ks|pcs|pc|kus|kusy|kusu) /); return m ? parseInt(m[1], 10) : null; }
  function fmt0(x) { return r(x, 0).toFixed(1); }
  var MEAT = { chicken: 1, chicken_breaded: 1, beef: 1, beef_gravy: 1, pork: 1, duck: 1, salmon: 1, fish_fried: 1, shrimp: 1, tofu: 1, cheese: 1, cheese_fried: 1, teriyaki_chicken: 1 };
  function cp(m) { return m.map(function (x) { return [x[0], x[1]]; }); }
  function estimate(name, desc, weight, kind, T, price) {
    T = T || MPD.T; kind = kind || 'dish'; if (price === undefined) price = null;
    var n = norm(name), d = norm(desc), nd = n + d, i, typ = null, where = null, fallback = false;
    if (has(n, T.exclude_strong)) return { skip: 'not a main dish' };
    if (price !== null && price < (T.price_floor_any || 0)) return { skip: 'price placeholder (size or choice picked later)' };
    for (i = 0; i < T.types.length; i++) if (has(n, T.types[i].words)) { typ = T.types[i]; where = 'name'; break; }
    var protN = firstKey(n, T.protein_words);
    var words = n.trim().split(' ').filter(function (w) { return w && !/^\d+$/.test(w); });
    if (protN === null && words.length && firstKey(' ' + words[0] + ' ', T.side_words)) return { skip: 'a side dish' };
    if (typ === null) {
      if (has(n, T.exclude_weak)) return { skip: 'not a main dish' };
      if (protN !== null && protN !== 'cheese' && protN !== 'tofu') {
        for (i = 0; i < T.types.length; i++) if (has(d, T.types[i].words)) { typ = T.types[i]; where = 'description'; break; }
        if (typ === null) { fallback = true; where = 'protein word in the name'; }
      } else {
        var pd = firstKey(d, T.protein_words);
        if (pd !== null && pd !== 'cheese' && pd !== 'tofu' && firstKey(d, T.side_words) && !has(d, T.soup_words)) { fallback = true; where = 'meat and side in the description'; }
      }
      if (fallback) for (i = 0; i < T.types.length; i++) if (T.types[i].key === T.fallback_type) { typ = T.types[i]; break; }
    }
    if (typ === null) return { skip: 'dish type unknown' };
    var meatless = has(n, T.meatless_words);
    var prot = protN !== null ? protN : (meatless ? null : firstKey(d, T.protein_words));
    var mix = cp(typ.mix), k = typ.key;
    if (k === 'pizza') { if (has(nd, typ.meat_words)) mix[0][0] = typ.meat_variant; if (has(n, typ.slice_words)) mix[0][1] = typ.slice_g; }
    else if (k === 'burger') { if (meatless && typ.meatless_skip) return { skip: 'meat-free burger (no table value)' }; if (prot === 'chicken' || prot === 'chicken_breaded') mix[0][0] = typ.chicken_variant; if (has(n, ['menu', 'hranolk', 'fries'])) mix.push(['fries', typ.menu_fries_g]); }
    else if (k === 'kebab') { if (has(n, typ.box_words)) mix = cp(typ.box_mix); }
    else if (k === 'wrap') { if (prot === 'chicken_breaded' || has(nd, ['krupav', 'smazen', 'crispy', 'strips'])) mix[0][0] = typ.fried_variant; else if (prot === null || meatless) mix[0][0] = typ.veg_variant; }
    else if (k === 'schnitzel') { if (has(n, typ.cheese_words) && ['chicken', 'chicken_breaded', 'pork'].indexOf(prot) < 0) mix[0][0] = typ.cheese_variant; }
    else if (k === 'sushi') { if (has(nd, typ.tuna_words)) mix[0][0] = typ.tuna_variant; }
    else if (k === 'nuggets' || k === 'strips') { if (prot === 'cheese' && typ.cheese_variant) mix[0][0] = typ.cheese_variant; }
  else if (k === 'pasta') { if (!has(nd, typ.meat_words)) mix = cp(typ.plain_mix); }
    var sideNamed = firstKey(n, T.side_words) || firstKey(d, T.side_words);
    var out = [];
    mix.forEach(function (x) {
      var comp = x[0], g = x[1];
      if (comp === '@protein') {
        var p = prot;
        if (meatless && p !== 'tofu' && p !== 'cheese') p = 'none';
        if (p === null) p = typ.default_protein || 'none';
        if (p === 'none') return;
        comp = p;
      } else if (comp === '@side') comp = sideNamed || typ.default_side;
      out.push([comp, +g]);
    });
    var wDish = null, wMeat = null, cnt = null;
    if (kind === 'meat') wMeat = parseG(weight); else wDish = parseG(weight);
    if (wDish === null && wMeat === null) { wMeat = leadG(name); if (wMeat === null) wMeat = leadG(desc); }
    if (wMeat !== null && typ.lead_g === 'dish' && wMeat >= T.lead_dish_g_min) { wDish = wMeat; wMeat = null; }
    if (wDish === null && wMeat === null) { wDish = parseG(name); if (wDish === null) wDish = parseG(desc); }
    if (wDish !== null && T.meat_led_types.indexOf(k) >= 0 && wDish <= T.meat_led_g_max) { wMeat = wDish; wDish = null; }  // meat-led dish: a small weight is the meat
    var piece = null;
    if (wDish === null && wMeat === null && typ.piece_g) { cnt = countOf(n) || countOf(d); if (cnt && cnt > T.pieces_max) return { skip: 'sharing size (' + cnt + ' pieces)' }; if (cnt) { piece = (prot === 'cheese' && typ.cheese_piece_g) ? typ.cheese_piece_g : typ.piece_g; wDish = cnt * piece; } }
    if (k === 'salad' && !out.some(function (c) { return MEAT[c[0]]; }) && !has(n, T.main_salad_words)) return { skip: 'a side salad (no meat, fish, cheese or tofu named)' };
    if (fallback && wDish === null && wMeat === null && !sideNamed) return { skip: 'meat word only, no weight or side' };
    if (wDish === null && wMeat === null && price !== null && price < T.min_meal_price) return { skip: 'too cheap for a full portion (a side or sauce)' };
    var basis = 'type default portion';
    if (wDish !== null) {
      if (wDish > T.share_g_max) return { skip: 'sharing size (' + fmt0(wDish) + ' g)' };
      if (wDish < T.weight_g_min) return { skip: 'too small for a meal (' + fmt0(wDish) + ' g)' };
      var tot = 0; out.forEach(function (c) { tot += c[1]; });
      var f = wDish / tot; out.forEach(function (c) { c[1] = c[1] * f; });
      basis = cnt ? (cnt + ' pieces x ' + piece + ' g') : ('menu weight ' + fmt0(wDish) + ' g');
    } else if (wMeat !== null) {
      if (wMeat < T.meat_weight_min) return { skip: 'too small for a meal (' + fmt0(wMeat) + ' g meat)' };
      for (i = 0; i < out.length; i++) if (MEAT[out[i][0]]) { out[i][1] = wMeat; basis = 'meat weight ' + fmt0(wMeat) + ' g from the menu'; break; }
    }
    var kcal = 0, pg = 0, grams = 0;
    out.forEach(function (c) { var cv = T.components[c[0]]; kcal += cv.kcal * c[1] / 100; pg += cv.protein * c[1] / 100; grams += c[1]; });
    return { type: k, type_from: where, grams: r(grams, 0), kcal: r(kcal, 1), protein: r(pg, 1), mix: out.map(function (c) { return [c[0], r(c[1], 0)]; }), basis: basis, label: 'estimate' };
  }
  // shortlist of one venue: best protein per CZK (n) and best kcal per CZK (4), as tools/dine.py shortlist() does with its own numbers
  function shortlist(dishes, n) {
    var ok = dishes.filter(function (x) { return x.est && !x.est.skip && x.price > 0; });
    var a = ok.slice().sort(function (x, y) { return y.est.protein / y.price - x.est.protein / x.price || x.price - y.price; }).slice(0, n);
    var b = ok.slice().sort(function (x, y) { return y.est.kcal / y.price - x.est.kcal / x.price || x.price - y.price; }).slice(0, 4);
    var seen = {}, out = [];
    a.concat(b).forEach(function (x) { if (!seen[x.item]) { seen[x.item] = 1; out.push(x); } });
    return out;
  }
  // a venue's worth for ranking venues: mean protein per 100 CZK of its best `meals` dishes
  function venueScore(list, meals) {
    var a = list.slice().sort(function (x, y) { return y.est.protein / y.price - x.est.protein / x.price; }).slice(0, meals);
    if (!a.length) return 0;
    var s = 0; a.forEach(function (x) { s += x.est.protein / x.price * 100; }); return s / a.length;
  }
  return { fold: fold, gtext: gtext, norm: norm, r: r, parseG: parseG, estimate: estimate, shortlist: shortlist, venueScore: venueScore, T: null };
})();
if (typeof module !== 'undefined') module.exports = MPD; // node tests only
