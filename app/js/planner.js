/* Meal Planner. The maths. Same formulas as tools/planner.py (tests/t_formulas.mjs proves they give equal results).
   Works in the browser (window.MPPlanner) and in node (module.exports).
   Rules that keep JS and Python equal: loops instead of sum(), one rounding function (r), ties broken by id, sort by plain string order. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MPPlanner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = '1.2';  // 1.2 (2026-11-05): targets from the DRI (protein RDA, energy EER) instead of fixed 1.6 g/kg and Mifflin x PAL
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

  // Activity levels: mean PAL of FAO/WHO/UNU (2004) Table 5.1 (the three choices of the profile form).
  var PAL = { light: 1.53, active: 1.76, vigorous: 2.25 };
  var DEFAULT_WEIGHTS = { price: 40, speed: 30, taste: 20, time: 10 };

  /* Dietary Reference Intakes (DRI). Institute of Medicine (2005), Dietary Reference Intakes for Energy, Carbohydrate,
     Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids, https://doi.org/10.17226/10490; protein row of the
     DRI summary table https://www.ncbi.nlm.nih.gov/books/NBK56068/table/summarytables.t4/ . Python twin: DRI in planner.py.
     Protein = Recommended Dietary Allowance (RDA) in g per kg body weight a day, by life stage.
     Energy = Estimated Energy Requirement (EER) equations, height in metres; PA = physical activity coefficient. */
  var DRI = {
    version: '2005',
    protein_g_per_kg: [[1, 3, 1.05], [4, 8, 0.95], [9, 13, 0.95], [14, 18, 0.85], [19, 200, 0.8]],
    protein_pregnancy: 1.1, protein_lactation: 1.3,
    // physical activity level (PAL) limits of the four DRI categories: sedentary < 1.4 <= low active < 1.6 <= active < 1.9 <= very active
    pa_limits: [1.4, 1.6, 1.9],
    pa_coef: { boy: [1.00, 1.13, 1.26, 1.42], girl: [1.00, 1.16, 1.31, 1.56], man: [1.00, 1.11, 1.25, 1.48], woman: [1.00, 1.12, 1.27, 1.45] },
    pregnancy_add_kcal: { '1': 0, '2': 340, '3': 452 },
    lactation_add_kcal: { '0-6': 330, '7-12': 400 }
  };
  var PA_LEVELS = ['sedentary', 'low', 'active', 'very'];
  function paLevel(pal) {
    var i; for (i = 0; i < DRI.pa_limits.length; i++) if (pal < DRI.pa_limits[i] - EPS) return i;
    return 3;
  }
  function ageGroup(age) {
    var i, g = DRI.protein_g_per_kg;
    for (i = 0; i < g.length; i++) if (age >= g[i][0] && age <= g[i][1]) return g[i];
    return null;
  }
  // EER without the pregnancy or lactation addition. hm = height in metres.
  function eerBase(sex, age, w, hm, lvl) {
    if (age <= 2) return { kcal: 89 * w - 100 + 20, coef: null, who: 'toddler' };
    var who = age <= 18 ? (sex === 'f' ? 'girl' : 'boy') : (sex === 'f' ? 'woman' : 'man');
    var pa = DRI.pa_coef[who][lvl], k;
    if (who === 'boy') k = 88.5 - 61.9 * age + pa * (26.7 * w + 903 * hm) + (age <= 8 ? 20 : 25);
    else if (who === 'girl') k = 135.3 - 30.8 * age + pa * (10.0 * w + 934 * hm) + (age <= 8 ? 20 : 25);
    else if (who === 'man') k = 662 - 9.53 * age + pa * (15.91 * w + 539.6 * hm);
    else k = 354 - 6.91 * age + pa * (9.36 * w + 726 * hm);
    return { kcal: k, coef: pa, who: who };
  }
  /* The DRI block of a profile: protein and energy a day for this body, with the life stage and activity used. */
  function dri(body, w, h, age, sex, palGiven) {
    var stage = body.life_stage === 'pregnant' || body.life_stage === 'lactating' ? body.life_stage : 'none';
    if (sex !== 'f') stage = 'none';
    var out = { version: DRI.version, life_stage: stage, missing: [] };
    var g = ageGroup(age);
    if (!g) { out.missing.push(age !== null && age < 1 ? 'age_under_1' : 'birth_date'); return out; }
    out.age_group = g[1] >= 200 ? g[0] + '+' : g[0] + '-' + g[1];
    var lvl = paLevel(palGiven === null ? PAL.light : palGiven);
    out.pa_level = PA_LEVELS[lvl]; out.activity_given = palGiven !== null;
    var gpk = g[2], add = 0;
    if (stage === 'pregnant') {
      gpk = DRI.protein_pregnancy;
      var tri = String(body.trimester === undefined || body.trimester === null ? '' : body.trimester);
      if (DRI.pregnancy_add_kcal[tri] === undefined) out.missing.push('trimester'); else { add = DRI.pregnancy_add_kcal[tri]; out.trimester = Number(tri); }
    } else if (stage === 'lactating') {
      gpk = DRI.protein_lactation;
      var lp = String(body.lactation_period || '');
      if (DRI.lactation_add_kcal[lp] === undefined) out.missing.push('lactation_period'); else { add = DRI.lactation_add_kcal[lp]; out.lactation_period = lp; }
    }
    out.protein_g_per_kg = gpk;
    out.protein_g = r(w * gpk, 2);
    var e = eerBase(sex, age, w, h / 100, lvl);
    out.eer_group = e.who; out.pa_coef = e.coef; out.stage_add_kcal = add;
    out.eer_kcal = r(e.kcal + add, 2);
    return out;
  }

  /* Daily targets for one person.
     profile: {body:{sex, birth_date, height_cm, life_stage:'none'|'pregnant'|'lactating', trimester:1|2|3, lactation_period:'0-6'|'7-12'},
               activity:{pal} (optional), goal:{type:'gain'|'maintain'|'typed', gain_kg, weeks, protein_g_per_kg (optional: own choice),
               surplus_pct, typed_protein_g, typed_kcal}}
     weightKg: the newest weigh-in. asOf: date of the calculation.
     Protein: the DRI for this body unless the person typed their own g/kg (no fixed minimum).
     Energy to keep the weight (maintenance_kcal): the DRI EER for this body; bmr (Mifflin et al., 1990) is kept as an extra line. */
  function targets(profile, weightKg, asOf) {
    var body = (profile && profile.body) || {}, goal = (profile && profile.goal) || {}, act = (profile && profile.activity) || {};
    var out = { ok: true, missing: [], warnings: [], mode: goal.type || 'gain' };
    var w = num(weightKg), h = num(body.height_cm), age = ageYears(body.birth_date, asOf), sex = body.sex;
    if (w === null || w <= 0) out.missing.push('weight');
    if (h === null || h <= 0) out.missing.push('height');
    if (age === null || age < 0) out.missing.push('birth_date');
    if (sex !== 'm' && sex !== 'f') out.missing.push('sex');
    var palGiven = num(act.pal), pal = palGiven === null ? PAL.light : palGiven;
    out.pal = pal; out.age = age;
    var maint = null, d = null;
    if (out.missing.length === 0) {
      out.bmr = r(bmr(sex, w, h, age), 2);
      d = dri(body, w, h, age, sex, palGiven);
      out.dri = d;
      d.missing.forEach(function (m) { out.missing.push(m); });
      if (!d.missing.length) { maint = d.eer_kcal; out.maintenance_kcal = d.eer_kcal; }
    }
    if (out.mode === 'typed') {
      var tp = num(goal.typed_protein_g), tk = num(goal.typed_kcal);
      out.missing = [];
      if (tp === null || tp <= 0) out.missing.push('typed_protein_g');
      if (tk === null || tk <= 0) out.missing.push('typed_kcal');
      out.protein_g = r(tp, 2); out.kcal = r(tk, 2);
      if (w !== null && w > 0 && tp !== null) out.protein_g_per_kg = r(tp / w, 2);
      if (d && d.protein_g !== undefined && tp !== null && tp < d.protein_g - EPS) out.warnings.push('protein_below_dri');
      out.ok = out.missing.length === 0;
      return out;
    }
    var own = num(goal.protein_g_per_kg), gpk = own;
    out.protein_basis = own === null ? 'dri' : 'own';
    if (own === null && d && d.protein_g_per_kg !== undefined) gpk = d.protein_g_per_kg;
    if (gpk !== null) out.protein_g_per_kg = gpk;
    if (own !== null && d && d.protein_g_per_kg !== undefined && own < d.protein_g_per_kg - EPS) out.warnings.push('protein_below_dri');
    if (gpk !== null && gpk > 2.2) out.warnings.push('protein_above_2_2');
    if (out.mode === 'gain') {
      var gk = num(goal.gain_kg), wk = num(goal.weeks);
      if (gk === null || gk <= 0) out.missing.push('gain_kg');
      if (wk === null || wk <= 0) out.missing.push('weeks');
      if (out.missing.length) { out.ok = false; return out; }
      if (age < 19 || d.life_stage !== 'none') out.warnings.push('gain_life_stage');
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

  return { VERSION: VERSION, r: r, ageYears: ageYears, bmr: bmr, PAL: PAL, DRI: DRI, dri: dri,
    DEFAULT_WEIGHTS: DEFAULT_WEIGHTS, targets: targets, perDay: perDay, effectivePrice: effectivePrice, foodMetrics: foodMetrics,
    basket: basket, optionCost: optionCost, score: score, goalLine: goalLine, addDays: addDays };
});
