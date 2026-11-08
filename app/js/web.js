/* Meal Planner web app (2026-11-05): the home page, accounts, the demo account, live sync between devices, and the
   Settings section "Account and data". Loaded only by the top-level index.html (window.MP_WEB set there); the
   double-click file app/MealPlanner.html never loads it and works exactly as before.

   Pattern taken from HelloDorm (daklod48/hellodorm, HOW-IT-WORKS.md section 4): the link lands on a home page;
   Sign in, Sign up or Try the demo account; Firebase keeps the login on the device; each account's data lives in
   Firestore so phone and laptop show the same thing; the demo account is an anonymous account that gets its own
   copy of sample data. */
(function () {
  'use strict';
  var St = window.MPStore, App = null, B = null, space = null, user = null;
  var screen = 'loading', authMsg = '', authBusy = false, opening = false, remotePending = false;
  var SCRIPT = document.currentScript ? document.currentScript.src : location.href;

  function A() { return App || (App = window.MPApp); }
  function t(k, v) { return A().t(k, v); }
  function h(s) { return A().h(s); }
  function $(s) { return document.querySelector(s); }
  function main() { return $('#main'); }
  function errText(e) {
    var c = (e && e.code) || 'x';
    var k = 'err_' + c.replace(/[^a-z0-9]+/gi, '_');
    var s = t(k);
    return s === k ? t('err_x', { code: c }) : s;
  }

  // ---------------------------------------------------------------- start
  function start() {
    screen = 'loading'; draw();
    B = window.MPBackends.create();
    B.init().then(function () {
      B.onUser(onUser);
    }, function (e) {
      screen = 'home'; authMsg = t('web_backend_failed') + ' ' + errText(e); draw();
    });
    window.addEventListener('hashchange', function () { if (!user) { screen = hashScreen(); draw(); } });
  }
  function hashScreen() { var x = (location.hash || '').slice(1); return x === 'signin' || x === 'signup' ? x : 'home'; }

  function onUser(u) {
    var was = user && user.uid;
    user = u;
    if (!u) {
      if (space && space.close) space.close();
      space = null; St.leave(); screen = hashScreen(); authMsg = authMsg || ''; A().renderHeader(); draw();
      return;
    }
    if (was === u.uid && St.folderName()) { A().renderHeader(); return; }  // same account (e.g. demo kept as a real account)
    openData(u);
  }

  // ---------------------------------------------------------------- data space
  function openData(u) {
    if (opening) return;
    opening = true; screen = 'loading'; draw();
    B.openSpace(u).then(function (sp) {
      space = sp;
      var empty = !Object.keys(sp.files).some(function (k) { return k.indexOf('data/users/') === 0; });
      return (u.isAnonymous && empty ? seedDemo(sp) : Promise.resolve()).then(function () {
        sp.onRemote(onRemote);
        return St.useRoot(window.MPVfs.makeRoot(sp, u.isAnonymous ? 'demo' : 'account'));
      });
    }).then(function () {
      opening = false; screen = 'app';
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      A().useDrafts('mealplanner:drafts:' + u.uid);
      A().afterLoad();
    }, function (e) {
      opening = false; screen = 'home'; authMsg = t('web_open_failed') + ' ' + errText(e); draw();
    });
  }

  // Another device (or tab) changed a file of this account.
  function onRemote() {
    var a = document.activeElement, typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
    if (St.hasUnsaved() || typing || A().typedDrafts().length) {
      if (!remotePending) { remotePending = true; A().showToast(t('web_remote_waiting')); }
      return;
    }
    remotePending = false;
    St.reload().then(function () { A().render(); A().showToast(t('web_remote_done')); });
  }

  // The demo starts with the sample data in app/demo/seed.json (made by tools/make_demo_seed.py from a real Cook run
  // on the shop rows of 19/10/2026). Every date moves forward by whole days so the newest is from the last day.
  function seedDemo(sp) {
    return fetch(new URL('../demo/seed.json', SCRIPT).href).then(function (r) { if (!r.ok) throw Object.assign(new Error('seed'), { code: 'mp/seed-missing' }); return r.json(); })
      .then(function (seed) {
        var days = Math.floor((Date.now() - Date.parse(seed.anchor)) / 86400000);
        var paths = Object.keys(seed.files), chain = Promise.resolve();
        paths.forEach(function (p) {
          var text = seed.files[p];
          if (days > 0) text = JSON.stringify(shiftDates(JSON.parse(text), days), null, 1) + '\n';
          chain = chain.then(function () { return sp.put(p, text); });
        });
        return chain;
      });
  }
  function shiftDay(s, days) {
    var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) + days * 86400000);
    return d.toISOString().slice(0, 10) + s.slice(10);
  }
  function shiftDates(o, days, key) {
    if (typeof o === 'string') return key !== 'birth_date' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(o) ? shiftDay(o, days) : o;
    if (Array.isArray(o)) return o.map(function (x) { return shiftDates(x, days); });
    if (o && typeof o === 'object') { var out = {}; Object.keys(o).forEach(function (k) { out[k] = shiftDates(o[k], days, k); }); return out; }
    return o;
  }

  // ---------------------------------------------------------------- drawing (signed out)
  function draw() {
    if (screen === 'app') return;
    var m = main(); if (!m) return;
    $('#nav').innerHTML = '';
    if (screen === 'loading') { m.innerHTML = '<section class="card web-loading" aria-busy="true"><p>' + h(t('web_loading')) + '</p></section>'; return; }
    m.innerHTML = screen === 'signin' || screen === 'signup' || screen === 'keep' ? authHtml() : homeHtml();
    var f = m.querySelector('[autofocus]'); if (f && screen !== 'home') f.focus();
  }
  function redraw() { if (screen !== 'app') draw(); }

  function homeHtml() {
    var practice = B && B.mode === 'local';
    var ex = exampleTargets();
    return '<section class="hero">' +
      '<p class="eyebrow">' + h(t('web_eyebrow')) + '</p>' +
      '<h1>' + h(t('web_title')) + '</h1>' +
      '<p class="lede">' + h(t('web_lede')) + '</p>' +
      '<div class="cta">' +
      '<button type="button" class="primary big" data-act="web-demo">' + h(t('web_try_demo')) + '</button>' +
      '<button type="button" class="big" data-act="web-open" data-to="signup">' + h(t('web_sign_up')) + '</button>' +
      '<button type="button" class="ghost big" data-act="web-open" data-to="signin">' + h(t('web_sign_in')) + '</button>' +
      '</div>' +
      '<p class="muted small">' + h(t('web_demo_note')) + '</p>' +
      (authMsg ? '<p class="error" role="alert">' + h(authMsg) + '</p>' : '') +
      '</section>' +
      '<section class="features">' +
      feature('web_f1_title', 'web_f1_text', 'M4 12h16M12 4v16') +
      feature('web_f2_title', 'web_f2_text', 'M3 7h18l-2 11H5L3 7zm5 0V5a4 4 0 0 1 8 0v2') +
      feature('web_f3_title', 'web_f3_text', 'M7 3h10v18H7zM2 8h4M18 8h4') +
      '</section>' +
      '<section class="card how"><h2>' + h(t('web_how_title')) + '</h2>' +
      '<ol class="steps"><li>' + h(t('web_how_1')) + '</li><li>' + h(t('web_how_2')) + '</li><li>' + h(t('web_how_3')) + '</li></ol>' +
      '<div class="example"><p class="eyebrow">' + h(t('web_example_title')) + '</p><p>' + h(t('web_example', ex)) + '</p></div>' +
      '</section>' +
      (practice ? '<p class="note practice">' + h(t('web_practice')) + '</p>' : '') +
      '<p class="note">' + h(t('not_medical')) + '</p>';
  }
  function feature(tk, xk, d) {
    return '<article class="feature"><svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>' +
      '<h2>' + h(t(tk)) + '</h2><p>' + h(t(xk)) + '</p></article>';
  }
  // A worked example computed by the planner itself, so the home page can never disagree with the app.
  function exampleTargets() {
    var P = window.MPPlanner, f = A().fmt;
    var x = P.targets({ body: { sex: 'f', birth_date: '1996-03-01', height_cm: 168 }, goal: { type: 'maintain' } }, 62, '2026-11-05');
    return { kg: f(62), p: f(x.protein_g), k: f(x.kcal) };
  }

  function authHtml() {
    var up = screen === 'signup', keep = screen === 'keep', practice = B && B.mode === 'local';
    var title = keep ? t('web_keep_title') : up ? t('web_sign_up') : t('web_sign_in');
    return '<section class="card auth">' +
      '<p><button type="button" class="ghost small" data-act="web-open" data-to="' + (keep ? 'app' : 'home') + '">← ' + h(keep ? t('web_back_app') : t('web_back_home')) + '</button></p>' +
      '<h1>' + h(title) + '</h1>' +
      (keep ? '<p class="gist">' + h(t('web_keep_gist')) + '</p>' : '') +
      (!keep ? '<div class="tabs" role="tablist"><button type="button" role="tab" aria-selected="' + !up + '" class="' + (up ? '' : 'on') + '" data-act="web-open" data-to="signin">' + h(t('web_sign_in')) + '</button>' +
        '<button type="button" role="tab" aria-selected="' + up + '" class="' + (up ? 'on' : '') + '" data-act="web-open" data-to="signup">' + h(t('web_sign_up')) + '</button></div>' : '') +
      '<form id="web-auth" novalidate>' +
      (up || keep ? '<div class="field"><label for="web-name">' + h(t('web_your_name')) + '</label><input id="web-name" name="name" autocomplete="name"' + (up || keep ? ' autofocus' : '') + '></div>' : '') +
      '<div class="field"><label for="web-email">' + h(t('web_email')) + '</label><input id="web-email" name="email" type="email" inputmode="email" autocomplete="' + (up || keep ? 'email' : 'username') + '"' + (up || keep ? '' : ' autofocus') + ' required></div>' +
      '<div class="field"><label for="web-pw">' + h(t('web_password')) + '</label><div class="pwrow"><input id="web-pw" name="password" type="password" autocomplete="' + (up || keep ? 'new-password' : 'current-password') + '" minlength="6" required>' +
      '<button type="button" class="ghost small" data-act="web-pw-toggle" aria-controls="web-pw">' + h(t('web_show')) + '</button></div>' + (up || keep ? '<small>' + h(t('web_pw_rule')) + '</small>' : '') + '</div>' +
      '<div id="web-auth-msg" class="error" role="alert">' + h(authMsg) + '</div>' +
      '<button type="submit" class="primary big wide"' + (authBusy ? ' disabled' : '') + '>' + h(keep ? t('web_keep_btn') : up ? t('web_create') : t('web_sign_in')) + '</button>' +
      '</form>' +
      (!keep ? '<p class="or"><span>' + h(t('web_or')) + '</span></p>' +
        '<button type="button" class="big wide google" data-act="web-google"' + (practice ? ' aria-describedby="g-note"' : '') + '>' +
        '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.2-8.5 2.2-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg> ' +
        h(t('web_google')) + '</button>' + (practice ? '<p id="g-note" class="muted small">' + h(t('web_google_practice')) + '</p>' : '') +
        (!up ? '<p><button type="button" class="ghost small" data-act="web-forgot">' + h(t('web_forgot')) + '</button></p>' : '') +
        '<p class="muted small">' + h(t('web_or_demo')) + ' <button type="button" class="small" data-act="web-demo">' + h(t('web_try_demo')) + '</button></p>' : '') +
      (practice ? '<p class="note practice">' + h(t('web_practice')) + '</p>' : '') +
      '</section>';
  }

  // ---------------------------------------------------------------- header chip (signed in)
  // Phone shell (lab run 1): the section buttons get an icon and a short word; on a phone (web.css) they become a
  // bottom tab bar of five (Apple HIG, Tab bars: five or fewer, always visible, navigation only, a badge for news).
  // Foods and Shops stay on the laptop bar and sit under Settings > More on the phone.
  var ICONS = {
    plan: 'M12 5v14M5 12h14', requests: 'M4 6h16M4 12h16M4 18h10', history: 'M4 19V5M4 19h16M8 15l4-4 3 3 5-6',
    profiles: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
    foods: 'M3 7h18l-2 11H5L3 7zm5 0V5a4 4 0 0 1 8 0v2', shops: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'
  };
  function seenKey() { return 'mp-seen:' + (user ? user.uid : ''); }
  function shell() {
    var nav = $('#nav'); if (!nav || !user) return;
    var st = A().state(), seen = A().lsGet(seenKey()) || {}, res = St.S().results || {};
    if (st.view === 'request' && st.viewArg && !seen[st.viewArg]) { seen[st.viewArg] = 1; A().lsSet(seenKey(), seen); }
    var fresh = Object.keys(res).filter(function (id) { return !seen[id]; }).length;
    Array.prototype.forEach.call(nav.querySelectorAll('button[data-view]'), function (b) {
      var v = b.dataset.view, full = b.textContent;
      if (v === 'foods' || v === 'shops') b.classList.add('nav-more');
      b.innerHTML = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + (ICONS[v] || '') + '"/></svg>' +
        '<span class="full">' + h(full) + '</span><span class="short" aria-hidden="true">' + h(t('web_tab_' + v)) + '</span>' +
        (v === 'requests' && fresh ? '<span class="badge" aria-label="' + h(t('web_new_results', { n: fresh })) + '">' + fresh + '</span>' : '');
    });
  }
  function moreHtml() {
    return '<div class="more-row"><span class="muted">' + h(t('web_more')) + '</span>' +
      '<button type="button" data-view="foods">' + h(t('nav_foods')) + '</button><button type="button" data-view="shops">' + h(t('nav_shops')) + '</button>' +
      '<button type="button" data-act="web-signout" class="ghost">' + h(t('web_sign_out')) + '</button></div>';
  }
  function header() {
    var el = $('#acct'); if (!el) return;
    shell();
    if (!user) { el.innerHTML = ''; return; }
    el.innerHTML = '<span class="acct-name">' + (user.isAnonymous ? '<span class="tag">' + h(t('web_demo_badge')) + '</span>' : h(user.name || user.email || '')) + '</span>' +
      (user.isAnonymous ? '<button type="button" class="small primary" data-act="web-keep">' + h(t('web_keep_short')) + '</button>' : '') +
      '<button type="button" class="small ghost" data-act="web-signout">' + h(t('web_sign_out')) + '</button>';
  }

  // ---------------------------------------------------------------- Settings: account and data
  function settingsHtml() {
    var practice = B && B.mode === 'local';
    var reqs = St.S().requests || {}, res = St.S().results || {};
    var waiting = Object.keys(reqs).filter(function (id) { return reqs[id].status === 'waiting' && !res[id]; }).sort();
    return '<h3 id="account">' + h(t('web_acct_title')) + '</h3>' +
      '<p>' + h(user && user.isAnonymous ? t('web_acct_demo') : t('web_acct_as', { who: (user && (user.email || user.name)) || '' })) + '</p>' +
      '<p class="muted">' + h(practice ? t('web_acct_practice') : t('web_acct_cloud')) + '</p>' +
      '<p class="row">' + (user && user.isAnonymous ? '<button type="button" class="primary" data-act="web-keep">' + h(t('web_keep_title')) + '</button>' : '') +
      '<button type="button" data-act="web-export">' + h(t('web_export')) + '</button>' +
      '<button type="button" class="ghost" data-act="web-signout">' + h(t('web_sign_out')) + '</button></p>' +
      '<h3 id="claude-runs">' + h(t('web_runs_title')) + '</h3><p class="gist">' + h(t('web_runs_gist')) + '</p>' +
      (waiting.length ? '<ul class="list">' + waiting.map(function (id) {
        return '<li><span><code>' + h(id) + '</code></span><button type="button" class="small" data-act="web-req-download" data-id="' + h(id) + '">' + h(t('web_req_download')) + '</button></li>';
      }).join('') + '</ul>' : '<p class="muted">' + h(t('web_runs_none')) + '</p>') +
      '<div class="field"><label for="web-result-file">' + h(t('web_result_add')) + '</label><input id="web-result-file" type="file" accept=".json,application/json"><small>' + h(t('web_result_help')) + '</small></div>' +
      '<div id="web-result-msg" role="status"></div>';
  }
  function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  // A result file Claude's run wrote on the laptop (data/results/REQ-....json) is copied into this account unchanged,
  // after the same checks the app makes on any file another program writes: whole JSON, same id as a request here.
  function addResult(file) {
    var box = $('#web-result-msg');
    file.text().then(function (text) {
      var o; try { o = JSON.parse(text); } catch (e) { throw new Error(t('web_result_bad_json')); }
      if (!o || typeof o.id !== 'string' || !/^REQ-[0-9]{8}-[0-9]{6}-[a-z0-9-]+$/.test(o.id)) throw new Error(t('web_result_bad_id'));
      if (!St.S().requests[o.id]) throw new Error(t('web_result_no_request', { id: o.id }));
      if (!Array.isArray(o.options) && o.status !== 'error') throw new Error(t('web_result_no_options'));
      return space.put('data/results/' + o.id + '.json', text).then(function () { return St.refreshShared(); }).then(function () { return o.id; });
    }).then(function (id) {
      A().go('request', id);
      A().showToast(t('web_result_added', { id: id }));
    }, function (e) { if (box) { box.className = 'error'; box.textContent = e.message || errText(e); } });
  }

  // ---------------------------------------------------------------- instant plan (lab run 1, 2026-11-05)
  /* An estimate the browser can make at once, before any Claude run: for every shop with at least 4 products already
     in this account's foods.json, planner.js basket() (the same greedy shopping list Claude's runs use, capped at 40 %
     per product) buys the person's protein and energy for the chosen days; the cheapest shop that covers both wins.
     It writes nothing (display only) and says plainly what it skips: today's prices, the vegetables rule, recipes, the cart. */
  function fold(x) { return String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function instantPlan(u, v, tg) {
    var P = window.MPPlanner, f = A().fmt, S = St.S();
    var items = (S.foods && Array.isArray(S.foods.items)) ? S.foods.items : [];
    var head = '<section class="instant" aria-labelledby="ip-h"><p class="eyebrow">' + h(t('ip_eyebrow')) + '</p><h3 id="ip-h">' + h(t('ip_title')) + '</h3>';
    if (!tg || !tg.ok) return head + '<p class="muted">' + h(t('ip_need_targets')) + '</p></section>';
    var days = Number(v.days) > 0 && Number(v.days) <= 14 ? Math.round(Number(v.days)) : 7;
    var bad = fold(u.profile.dislikes).split(/[,;]+/).map(function (x) { return x.trim(); }).filter(function (x) { return x.length > 2; });
    var usable = items.filter(function (x) { return x && x.in_stock !== false && !bad.some(function (w) { return fold(x.name).indexOf(w) >= 0; }); });
    var byShop = {};
    usable.forEach(function (x) { (byShop[x.shop] = byShop[x.shop] || []).push(x); });
    var need = { protein_g: tg.protein_g * days, kcal: tg.kcal * days }, cards = (u.profile.cards || []);
    var tries = Object.keys(byShop).filter(function (k) { return byShop[k].length >= 4; }).map(function (shop) {
      var b = P.basket(byShop[shop], need, cards);
      return { shop: shop, b: b, n: byShop[shop].length, seen: byShop[shop].map(function (x) { return x.seen || ''; }).sort()[0] };
    });
    if (!tries.length) return head + '<p class="muted">' + h(t('ip_no_prices')) + '</p></section>';
    tries.sort(function (a, b) { return (a.b.met === b.b.met ? 0 : a.b.met ? -1 : 1) || a.b.cost - b.b.cost || (a.shop < b.shop ? -1 : 1); });
    var best = tries[0], b = best.b, perDay = b.cost / days;
    var budget = Number(String(v.budget_total || '').replace(',', '.')) || (P.perDay(u.profile.budget && u.profile.budget.amount, u.profile.budget && u.profile.budget.period) || 0) * days;
    var pc = Math.min(100, Math.round(100 * b.protein_g / need.protein_g)), kc = Math.min(100, Math.round(100 * b.kcal / need.kcal));
    var shopName = t('shop_' + best.shop) === 'shop_' + best.shop ? best.shop : t('shop_' + best.shop);
    var out = head + '<p class="ip-lede">' + h(t('ip_lede', { days: days, shop: shopName })) + '</p>' +
      '<div class="ip-figs">' +
      '<div class="fig"><span class="big">' + h(f(b.cost, 0)) + ' CZK</span><span>' + h(t('ip_total', { d: f(perDay, 0) })) + '</span></div>' +
      '<div class="fig"><span class="big">' + pc + ' %</span><span>' + h(t('ip_protein', { g: f(tg.protein_g) })) + '</span><span class="meter" aria-hidden="true"><i style="width:' + pc + '%"></i></span></div>' +
      '<div class="fig"><span class="big">' + kc + ' %</span><span>' + h(t('ip_energy', { k: f(tg.kcal) })) + '</span><span class="meter" aria-hidden="true"><i style="width:' + kc + '%"></i></span></div>' +
      '</div>' +
      (budget > 0 ? '<p class="' + (b.cost <= budget ? 'ok-line' : 'warn') + '">' + h(b.cost <= budget ? t('ip_under_budget', { b: f(budget, 0), x: f(budget - b.cost, 0) }) : t('ip_over_budget', { b: f(budget, 0), x: f(b.cost - budget, 0) })) + '</p>' : '') +
      '<details class="ip-list"><summary>' + h(t('ip_list', { n: b.items.length })) + '</summary><ul>' + b.items.map(function (x) {
        return '<li><span>' + h(x.packs + ' × ' + x.name) + '</span><span>' + h(f(x.cost, 2)) + ' CZK' + (x.card_used ? ' · ' + h(t('ip_card')) : '') + '</span></li>';
      }).join('') + '</ul></details>' +
      (tries.length > 1 ? '<p class="muted small">' + h(t('ip_others')) + ' ' + h(tries.slice(1).map(function (x) { var nm = t('shop_' + x.shop); return (nm === 'shop_' + x.shop ? x.shop : nm) + ' ' + f(x.b.cost, 0) + ' CZK' + (x.b.met ? '' : ' (' + t('ip_short') + ')'); }).join(', ')) + '</p>' : '') +
      '<p class="muted small">' + h(t('ip_honest', { n: usable.length, date: (best.seen || '').slice(0, 10).split('-').reverse().map(Number).join('. ') })) + '</p></section>';
    return out;
  }

  // ---------------------------------------------------------------- actions
  function act(name, el) {
    if (name.indexOf('web-') !== 0) return false;
    switch (name) {
      case 'web-demo':
        authMsg = ''; screen = 'loading'; draw();
        B.demo().catch(function (e) { screen = 'home'; authMsg = errText(e); draw(); });
        break;
      case 'web-open': {
        var to = el.dataset.to; authMsg = '';
        if (to === 'app') { screen = 'app'; A().afterLoad(); break; }
        screen = to; if (to !== 'home') history.replaceState(null, '', '#' + to); else history.replaceState(null, '', location.pathname + location.search);
        draw(); break;
      }
      case 'web-keep': authMsg = ''; screen = 'keep'; $('#nav').innerHTML = ''; draw(); break;
      case 'web-pw-toggle': {
        var pw = $('#web-pw'); if (!pw) break;
        var show = pw.type === 'password'; pw.type = show ? 'text' : 'password';
        el.textContent = show ? t('web_hide') : t('web_show'); break;
      }
      case 'web-google':
        authMsg = '';
        B.google().catch(function (e) { authMsg = errText(e); draw(); });
        break;
      case 'web-forgot': {
        var em = ($('#web-email') || {}).value || '';
        if (!em.trim()) { setMsg(t('web_forgot_need_email')); break; }
        B.resetPassword(em).then(function () { setMsg(t('web_forgot_sent', { email: em.trim() }), true); }, function (e) { setMsg(errText(e)); });
        break;
      }
      case 'web-signout': {
        if (St.hasUnsaved()) { A().showToast(t('web_wait_saving')); break; }
        if (user && user.isAnonymous && !window.confirm(t('web_demo_signout_confirm'))) break;
        authMsg = ''; B.signOut(); break;
      }
      case 'web-export': {
        var stamp = St.today();
        download('meal-planner-' + stamp + '.json', JSON.stringify({ exported: St.nowIso(), app: 'Meal Planner web', files: space ? space.files : {} }, null, 1));
        break;
      }
      case 'web-req-download': {
        var id = el.dataset.id, r = St.S().requests[id];
        if (r) download(id + '.json', JSON.stringify(r, null, 1) + '\n');
        break;
      }
      default: return false;
    }
    return true;
  }
  function setMsg(text, good) { var b = $('#web-auth-msg'); if (b) { b.textContent = text; b.className = good ? 'ok' : 'error'; } authMsg = good ? '' : text; }

  document.addEventListener('submit', function (e) {
    if (!e.target || e.target.id !== 'web-auth') return;
    e.preventDefault();
    if (authBusy) return;
    var f = e.target, email = f.email.value, pw = f.password.value, name = f.name ? f.name.value.trim() : '';
    if (!email.trim()) { setMsg(t('web_need_email')); f.email.focus(); return; }
    if (!pw) { setMsg(t('web_need_pw')); f.password.focus(); return; }
    authBusy = true; setMsg(t('web_working'), true);
    var p = screen === 'keep' ? B.keepDemo(email, pw, name) : screen === 'signup' ? B.signUp(email, pw, name) : B.signIn(email, pw);
    p.then(function (u) {
      authBusy = false; authMsg = '';
      // the new account is known before the redraw (2026-11-08: the header could still say "Demo account" for a moment)
      if (screen === 'keep' && u && u.uid) user = u;
      if (screen === 'keep') { screen = 'app'; A().afterLoad(); A().showToast(t('web_keep_done')); }
    }, function (err) { authBusy = false; setMsg(errText(err)); var b = f.querySelector('[type=submit]'); if (b) b.disabled = false; });
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'web-result-file' && e.target.files && e.target.files[0]) addResult(e.target.files[0]);
  });

  window.MPWeb = { start: start, redraw: redraw, header: header, settingsHtml: settingsHtml, act: act, instantPlan: instantPlan, moreHtml: moreHtml,
    _test: { shiftDates: shiftDates, backend: function () { return B; }, space: function () { return space; } } };
})();
