/* Meal Planner. The maths. Same formulas as tools/planner.py (tests/t_formulas.mjs proves they give equal results).
   Works in the browser (window.MPPlanner) and in node (module.exports).
   Rules that keep JS and Python equal: loops instead of sum(), one rounding function (r), ties broken by id, sort by plain string order. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MPPlanner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = '1.1';
  var EPS = 1e-12;

  // Round half away from zero to d decimals. Python twin: r(x, d).
  function r(x, d) {
    if (x === null || x === undefined || isNaN(x)) return null;
    var m = Math.pow(10, d === undefined ? 2 : d);
    var s = x < 0 ? -1 : 1;
    return s * Math.floor(Math.abs(x) * m + 0.5) / m;
  }
  // A number, or a plain decimal written as text ("12", "-3.5"). Anything else (true, "0x10", "1_000", [], " ") is null. Python twin: num().
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string' && /^\s*-?[0-9]+(\.[0-9]+)?\s*$/.test(v)) return Number(v);
    return null;
  }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  // Whole years between two ISO dates (YYYY-MM-DD).
  function ageYears(birth, asOf) {
    if (!birth || !asOf) return null;
    var b = birth.split('-'), a = asOf.split('-');
    var y = Number(a[0]) - Number(b[0]);
    if (Number(a[1]) < Number(b[1]) || (Number(a[1]) === Number(b[1]) && Number(a[2]) < Number(b[2]))) y -= 1;
    return y;
  }

  // Resting energy, Mifflin et al. (1990): men 10W + 6.25H - 5A + 5, women ... - 161.
  function bmr(sex, kg, cm, age) {
    return 10 * kg + 6.25 * cm - 5 * age + (sex === 'f' ? -161 : 5);
  }

  // Activity levels: mean PAL of FAO/WHO/UNU (2004) Table 5.1.
  var PAL = { light: 1.53, active: 1.76, vigorous: 2.25 };
  var DEFAULT_PROTEIN_G_PER_KG = 1.6;  // Iraki et al. (2019) 1.6-2.2; Morton et al. (2018) no extra gain above 1.62
  var DEFAULT_WEIGHTS = { price: 40, speed: 30, taste: 20, time: 10 };

  /* Daily targets for one person.
     profile: {body:{sex, birth_date, height_cm}, activity:{pal}, goal:{type:'gain'|'maintain'|'typed', gain_kg, weeks,
               protein_g_per_kg, surplus_pct, typed_protein_g, typed_kcal}}
     weightKg: the newest weigh-in. asOf: date of the calculation. */
  function targets(profile, weightKg, asOf) {
    var body = (profile && profile.body) || {}, goal = (profile && profile.goal) || {}, act = (profile && profile.activity) || {};
    var out = { ok: true, missing: [], warnings: [], mode: goal.type || 'gain' };
    var w = num(weightKg), h = num(body.height_cm), age = ageYears(body.birth_date, asOf), sex = body.sex;
    if (w === null || w <= 0) out.missing.push('weight');
    if (h === null || h <= 0) out.missing.push('height');
    if (age === null || age < 0) out.missing.push('birth_date');
    if (sex !== 'm' && sex !== 'f') out.missing.push('sex');
    var pal = num(act.pal); if (pal === null) pal = PAL.light;
    out.pal = pal; out.age = age;
    var maint = null;
    if (out.missing.length === 0) {
      var b = bmr(sex, w, h, age);
      maint = b * pal;
      out.bmr = r(b, 2); out.maintenance_kcal = r(maint, 2);
    }
    if (out.mode === 'typed') {
      var tp = num(goal.typed_protein_g), tk = num(goal.typed_kcal);
      out.missing = [];
      if (tp === null || tp <= 0) out.missing.push('typed_protein_g');
      if (tk === null || tk <= 0) out.missing.push('typed_kcal');
      out.protein_g = r(tp, 2); out.kcal = r(tk, 2);
      if (w !== null && w > 0 && tp !== null) out.protein_g_per_kg = r(tp / w, 2);
      out.ok = out.missing.length === 0;
      return out;
    }
    var gpk = num(goal.protein_g_per_kg); if (gpk === null) gpk = DEFAULT_PROTEIN_G_PER_KG;
    out.protein_g_per_kg = gpk;
    if (gpk < 1.6) out.warnings.push('protein_below_1_6');
    if (gpk > 2.2) out.warnings.push('protein_above_2_2');
    if (out.mode === 'gain') {
      var gk = num(goal.gain_kg), wk = num(goal.weeks);
      if (gk === null || gk <= 0) out.missing.push('gain_kg');
      if (wk === null || wk <= 0) out.missing.push('weeks');
      if (out.missing.length) { out.ok = false; return out; }
      var rate = gk / wk, ratePct = rate / w * 100;
      var auto = clamp(10 + (ratePct - 0.25) * 40, 10, 20);  // 0.25 %/week -> 10 %, 0.5 %/week -> 20 % (Iraki et al., 2019)
      var sp = num(goal.surplus_pct); var surplus = sp === null ? auto : sp;
      out.rate_kg_week = r(rate, 3); out.rate_pct_week = r(ratePct, 3);
      out.surplus_auto_pct = r(auto, 2); out.surplus_pct = r(surplus, 2);
      if (ratePct > 0.5) out.warnings.push('rate_above_0_5');
      if (surplus > 20) out.warnings.push('surplus_above_20');
      out.kcal = r(maint * (1 + surplus / 100), 2);
    } else {
      if (out.missing.length) { out.ok = false; return out; }
      out.kcal = r(maint, 2);
    }
    out.protein_g = r(w * gpk, 2);
    out.ok = out.missing.length === 0;
    return out;
  }

  // Budget per day from an amount and a period. A month = 365/12 days.
  function perDay(amount, period) {
    var a = num(amount); if (a === null) return null;
    if (period === 'week') return r(a / 7, 2);
    if (period === 'month') return r(a * 12 / 365, 2);
    return r(a, 2);
  }

  // Lowest price this person can pay: a loyalty price counts only if the card is in his list.
  function effectivePrice(food, cards) {
    var held = {}; (cards || []).forEach(function (c) { held[c] = true; });
    var best = num(food.price), used = null, i, lp = food.loyalty || [];
    for (i = 0; i < lp.length; i++) {
      var p = num(lp[i].price);
      if (p !== null && p > 0 && best !== null && held[lp[i].card] && p < best - EPS) { best = p; used = lp[i].card; }
    }
    return { price: best, regular: num(food.price), card_used: used };
  }

  // Per pack and per 100 CZK numbers for one product.
  function foodMetrics(food, cards) {
    var ep = effectivePrice(food, cards), g = num(food.pack_g), n = food.per100g || {};
    if (ep.price === null || ep.price <= 0 || g === null || g <= 0 || num(n.protein) === null || num(n.kcal) === null) return null;
    var pp = g * num(n.protein) / 100, pk = g * num(n.kcal) / 100;
    return {
      price: ep.price, regular: ep.regular, card_used: ep.card_used,
      pack_protein: r(pp, 2), pack_kcal: r(pk, 2),
      protein_per_100czk: r(pp / ep.price * 100, 2), kcal_per_100czk: r(pk / ep.price * 100, 2),
      price_per_kg: r(ep.price / g * 1000, 2)
    };
  }

  /* Cheapest-first shopping list that covers protein and kcal for the whole period.
     Greedy: each step buys the pack that covers the most of what is still missing per CZK.
     need: {protein_g, kcal} for the whole period.
     Variety cap: one product may cover at most opts.max_share (default 0.4 = 40 %) of the protein or of the kcal need
     (at least 1 pack); opts.max_packs, if given, is a hard cap on top. */
  function basket(foods, need, cards, opts) {
    opts = opts || {};
    var hard = num(opts.max_packs), share = num(opts.max_share); if (share === null) share = 0.4;
    var list = foods.slice().filter(function (f) { return f && typeof f.id === 'string' && f.id !== '' && num(f.price) > 0 && num(f.pack_g) > 0 && f.per100g && num(f.per100g.protein) !== null && num(f.per100g.kcal) !== null; });
    list.sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
    var nP = num(need.protein_g) || 0, nK = num(need.kcal) || 0, remP = nP, remK = nK;
    var counts = {}, info = {}, i, step;
    for (i = 0; i < list.length; i++) {
      var f = list[i], ep = effectivePrice(f, cards), g = num(f.pack_g), n = f.per100g;
      info[f.id] = { price: ep.price, regular: ep.regular, card: ep.card_used, p: g * num(n.protein) / 100, k: g * num(n.kcal) / 100, name: f.name };
      counts[f.id] = 0;
      var c = null, xi = info[f.id];
      if (xi.p > 0 && nP > 0) c = Math.floor(share * nP / xi.p);
      if (xi.k > 0 && nK > 0) { var ck = Math.floor(share * nK / xi.k); if (c === null || ck < c) c = ck; }
      if (c === null || c < 1) c = 1;
      if (hard !== null && hard < c) c = hard;
      xi.cap = c;
    }
    for (step = 0; step < 2000; step++) {
      if (remP <= 0 && remK <= 0) break;
      var best = null, bestVal = 0;
      for (i = 0; i < list.length; i++) {
        var id = list[i].id, x = info[id];
        if (counts[id] >= x.cap) continue;
        var gp = remP > 0 ? Math.min(x.p, remP) : 0, gk = remK > 0 ? Math.min(x.k, remK) : 0;
        var overK = remK > 0 ? Math.max(0, x.k - remK) : x.k; // v1.1 (19/10): kcal beyond the target counts against a pack
        var v = ((nP > 0 ? gp / nP : 0) + (nK > 0 ? gk / nK : 0) - (nK > 0 ? overK / nK : 0)) / x.price;
        if (v > bestVal + EPS) { best = id; bestVal = v; }
      }
      if (best === null) break;
      counts[best] += 1; remP -= info[best].p; remK -= info[best].k;
    }
    var items = [], cost = 0, costReg = 0, P = 0, K = 0;
    for (i = 0; i < list.length; i++) {
      var fid = list[i].id, c = counts[fid];
      if (!c) continue;
      var y = info[fid];
      items.push({ id: fid, name: y.name, packs: c, cap: y.cap, cost: r(c * y.price, 2), cost_regular: r(c * y.regular, 2), card_used: y.card, protein_g: r(c * y.p, 2), kcal: r(c * y.k, 2) });
      cost += c * y.price; costReg += c * y.regular; P += c * y.p; K += c * y.k;
    }
    return { items: items, cost: r(cost, 2), cost_regular: r(costReg, 2), protein_g: r(P, 2), kcal: r(K, 2), met: remP <= 0 && remK <= 0 };
  }

  // Cost of a whole option for this person: regular minus the savings of the cards he holds.
  function optionCost(opt, cards) {
    var held = {}; (cards || []).forEach(function (c) { held[c] = true; });
    var reg = num(opt.cost_regular), mine = reg, all = reg, i, s = opt.card_savings || [];
    for (i = 0; i < s.length; i++) {
      var v = num(s[i].saving) || 0;
      all -= v; if (held[s[i].card]) mine -= v;
    }
    return { mine: mine, regular: reg, all_cards: all };
  }

  /* Score 0-100 on price, speed to goal, taste, time; weighted total; three picks.
     options: [{id, label, kind, days, cost_regular, card_savings:[{card,saving}], protein_g_per_day, kcal_per_day, minutes_per_day, taste(1-5)}]
     ctx: {targets:{protein_g,kcal}, weights:{price,speed,taste,time}, cards:[...], budget_per_day} */
  function score(options, ctx) {
    var t = ctx.targets || {}, wts = ctx.weights || DEFAULT_WEIGHTS, cards = ctx.cards || [];
    var wP = num(wts.price) || 0, wS = num(wts.speed) || 0, wT = num(wts.taste) || 0, wM = num(wts.time) || 0;
    var wSum = wP + wS + wT + wM; if (wSum <= 0) { wP = 40; wS = 30; wT = 20; wM = 10; wSum = 100; }
    var tP = num(t.protein_g), tK = num(t.kcal), bud = num(ctx.budget_per_day);
    var rows = [], i, minCost = null, minMin = null;
    // An option without an id, a cost above 0 or its minutes is "incomplete": shown, never scored, never picked.
    for (i = 0; i < options.length; i++) {
      var o = options[i] || {}, id = typeof o.id === 'string' ? o.id : '', days = num(o.days); if (days === null || days <= 0) days = 1;
      var c = optionCost(o, cards), m0 = num(o.minutes_per_day);
      var inc = id === '' || c.regular === null || c.regular <= 0 || c.mine === null || c.mine <= 0 || m0 === null || m0 < 0;
      var cpd = inc ? null : c.mine / days, mins = inc ? null : Math.max(1, m0);
      rows.push({ o: o, id: id, inc: inc, cpd: cpd, cost: c, mins: mins });
      if (!inc) {
        if (minCost === null || cpd < minCost) minCost = cpd;
        if (minMin === null || mins < minMin) minMin = mins;
      }
    }
    var out = [], done = [], bad = [];
    for (i = 0; i < rows.length; i++) {
      var x = rows[i];
      if (x.inc) { var e = { id: x.id, incomplete: true, cost_per_day: null, cost_mine: null, cost_regular: r(x.cost.regular, 2), cost_all_cards: null, protein_per_100czk: null,
        s_price: null, s_speed: null, s_taste: null, s_time: null, total: null, flags: ['incomplete'] }; out.push(e); bad.push(e); continue; }
      var p = num(x.o.protein_g_per_day) || 0, k = num(x.o.kcal_per_day) || 0;
      var covP = tP ? Math.min(1, p / tP) : 1, covK = tK ? Math.min(1, k / tK) : 1;
      var sPrice = 100 * minCost / x.cpd;
      var sSpeed = 100 * (covP + covK) / 2;
      var taste = num(x.o.taste); if (taste === null) taste = 3;
      var sTaste = (clamp(taste, 1, 5) - 1) / 4 * 100;
      var sTime = 100 * minMin / x.mins;
      var total = (wP * sPrice + wS * sSpeed + wT * sTaste + wM * sTime) / wSum;
      var flags = [];
      if (bud !== null && x.cpd > bud + EPS) flags.push('over_budget');
      if (tP && p < 0.9 * tP) flags.push('protein_short');
      if (tK && k > 1.1 * tK) flags.push('kcal_over');
      if (tK && k < 0.9 * tK) flags.push('kcal_short');
      var y = {
        id: x.id, cost_per_day: r(x.cpd, 2), cost_mine: r(x.cost.mine, 2), cost_regular: r(x.cost.regular, 2), cost_all_cards: r(x.cost.all_cards, 2),
        protein_per_100czk: r(p / x.cpd * 100, 2),
        s_price: r(sPrice, 2), s_speed: r(sSpeed, 2), s_taste: r(sTaste, 2), s_time: r(sTime, 2), total: r(total, 2), flags: flags,
        _t: total, _c: x.cpd, _s: sSpeed
      };
      out.push(y); done.push(y);
    }
    var ranked = done.slice().sort(function (a, b) {
      if (Math.abs(a._t - b._t) > EPS) return b._t - a._t;
      if (Math.abs(a._c - b._c) > EPS) return a._c - b._c;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    for (i = 0; i < ranked.length; i++) ranked[i].rank = i + 1;
    bad.sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
    for (i = 0; i < bad.length; i++) bad[i].rank = null;
    function pick(list, better) { var b = null, j; for (j = 0; j < list.length; j++) if (b === null || better(list[j], b)) b = list[j]; return b ? b.id : null; }
    var byCostThenId = function (a, b) { return a._c < b._c - EPS || (Math.abs(a._c - b._c) <= EPS && a.id < b.id); };
    var enough = done.filter(function (x) { return x._s >= 90 - EPS; });
    var picks = {
      cheapest: pick(enough.length ? enough : done, byCostThenId),
      fastest: pick(done, function (a, b) { return a._s > b._s + EPS || (Math.abs(a._s - b._s) <= EPS && byCostThenId(a, b)); }),
      balance: ranked.length ? ranked[0].id : null
    };
    ranked.forEach(function (x) { delete x._t; delete x._c; delete x._s; });
    return { version: VERSION, ranked: ranked.concat(bad), picks: picks, weights_used: { price: wP, speed: wS, taste: wT, time: wM } };
  }

  // Projected weight on a date, for the goal line: straight line from start to start + gain over the weeks.
  function goalLine(goal, startKg, startDate) {
    var gk = num(goal && goal.gain_kg), wk = num(goal && goal.weeks), s = num(startKg);
    if (gk === null || wk === null || s === null || !startDate) return null;
    return { from: { date: startDate, kg: r(s, 2) }, to: { date: addDays(startDate, Math.round(wk * 7)), kg: r(s + gk, 2) } };
  }
  function addDays(iso, n) {
    var p = iso.split('-'), d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  return { VERSION: VERSION, r: r, ageYears: ageYears, bmr: bmr, PAL: PAL, DEFAULT_PROTEIN_G_PER_KG: DEFAULT_PROTEIN_G_PER_KG,
    DEFAULT_WEIGHTS: DEFAULT_WEIGHTS, targets: targets, perDay: perDay, effectivePrice: effectivePrice, foodMetrics: foodMetrics,
    basket: basket, optionCost: optionCost, score: score, goalLine: goalLine, addDays: addDays };
});
