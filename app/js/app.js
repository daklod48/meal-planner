/* Meal Planner. Screens. Data changes only through MPStore.commit (one place). Typing never rebuilds the box being typed in:
   forms keep their values in drafts, a full redraw saves and restores the focused box and caret, and search boxes redraw
   only the list under them. */
(function () {
  'use strict';
  var St = window.MPStore, P = window.MPPlanner, D = window.MPI18N;
  var lang = 'en', view = 'profiles', viewArg = null, drafts = {}, backTo = null, toast = null, flash = null;
  var CARDS = [
    { key: 'rohlik-xtra', name: 'Rohlík Xtra' }, { key: 'billa-club', name: 'Billa Club' }, { key: 'kaufland-card', name: 'Kaufland Card' },
    { key: 'lidl-plus', name: 'Lidl Plus' }, { key: 'albert', name: 'Albert (app)' }, { key: 'penny', name: 'Penny (app)' },
    { key: 'tesco-clubcard', name: 'Tesco Clubcard' }
  ];
  var ONLINE_SHOPS = [{ key: 'rohlik', name: 'Rohlík.cz' }, { key: 'kosik', name: 'Košík.cz' }, { key: 'tesco', name: 'Tesco online' }, { key: 'billa', name: 'Billa online' }];
  var SHOP_KEYS = ['rohlik', 'kosik', 'tesco', 'billa', 'albert', 'kaufland', 'lidl', 'penny', 'wolt', 'foodora', 'other'];
  var VIEWS = ['profiles', 'plan', 'requests', 'history', 'foods', 'shops', 'settings'];

  // ---------- helpers ----------
  // Web app: a few words differ when the data lives in an account, not a folder (keys w_<key> in i18n.js).
  var WEB = !!window.MP_WEB;
  function t(k, v) {
    if (WEB && D.en['w_' + k]) k = 'w_' + k;
    var s = (D[lang] && D[lang][k]) || D.en[k];
    if (s === undefined) { console.warn('missing text', k); s = k; }
    if (v) Object.keys(v).forEach(function (n) { s = s.split('{' + n + '}').join(v[n]); });
    return s;
  }
  function has(k) { return !!((WEB && D.en['w_' + k]) || (D[lang] && D[lang][k]) || D.en[k]); }
  function h(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function num(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim().replace(/\s/g, '').replace(',', '.');
    if (s === '') return null;
    var n = Number(s); return isFinite(n) ? n : null;
  }
  function fmt(n, d) {
    if (n === null || n === undefined || isNaN(n)) return '–';
    var s = Number(n).toFixed(d === undefined ? 0 : d);
    var parts = s.split('.'), int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'cs' ? ' ' : ',');
    return parts[1] ? int + (lang === 'cs' ? ',' : '.') + parts[1] : int;
  }
  function czk(n) { return n === null || n === undefined || isNaN(n) ? '–' : fmt(n, 2) + ' CZK'; }
  function isoOk(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v); }
  // A full time stamp with its zone as milliseconds since 1970 (UTC), so stamps written in +02:00 and +01:00 compare as moments
  // (2026-11-05). Anything else (no zone, a bare date, junk) is null: never guessed.
  function isoMs(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
    var x = Date.parse(v); return isNaN(x) ? null : x;
  }
  // Plural forms: English one/other; Czech 1 = one, 2-4 = few, else many (decimals use many).
  function tp(key, n, v) {
    var x = Number(n), f;
    if (lang === 'cs') f = x === 1 ? 'one' : (x >= 2 && x <= 4 && Math.floor(x) === x ? 'few' : 'many');
    else f = x === 1 ? 'one' : 'other';
    var k = has(key + '_' + f) ? key + '_' + f : key + '_other';
    return t(k, Object.assign({ n: fmt(n, Math.floor(x) === x ? 0 : 1) }, v || {}));
  }
  function rng(a, b) { return '(' + fmt(a, Math.floor(a) === a ? 0 : 1) + '–' + fmt(b, Math.floor(b) === b ? 0 : 1) + ')'; }
  function tk(prefix, key, fallback) { return has(prefix + key) ? t(prefix + key) : t(prefix + fallback); }
  function safeUrl(u) { return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null; }
  function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase(); }
  function fmtDate(iso) { if (!isoOk(iso)) return '–'; var p = iso.slice(0, 10).split('-'); return Number(p[2]) + '. ' + Number(p[1]) + '. ' + p[0]; }
  function fmtTime(iso) { if (!isoOk(iso)) return '–'; return fmtDate(iso) + (iso.length >= 16 ? ' ' + iso.slice(11, 16) : ''); }
  function minutesSince(iso) { var x = isoOk(iso) ? new Date(iso).getTime() : NaN; return isNaN(x) ? 0 : Math.max(0, Math.floor((Date.now() - x) / 60000)); }
  function daysSince(iso) { var x = isoOk(iso) ? new Date(iso).getTime() : NaN; return isNaN(x) ? 0 : Math.floor((Date.now() - x) / 86400000); }
  function sinceText(iso) {
    var m = minutesSince(iso);
    if (m < 60) return t('ago_min', { n: m });
    if (m < 60 * 48) return t('ago_h', { n: Math.floor(m / 60) });
    return t('ago_d', { n: Math.floor(m / 1440) });
  }
  function S() { return St.S(); }
  function me() { var u = St.ME.userId; return u && S().users[u] ? S().users[u] : null; }
  function cardName(k) {
    var c = CARDS.filter(function (x) { return x.key === k; })[0]; if (c) return c.name;
    var u = me(), o = u && (u.profile.cards_other || []).filter(function (x) { return x.key === k; })[0];
    return o ? o.name : k;
  }
  function myCards(p) { return (p.cards || []).concat((p.cards_other || []).map(function (x) { return x.key; })); }
  function newestWeight(hist) {
    var best = null; (hist.weighins || []).forEach(function (w) { if (!best || w.date >= best.date) best = w; });
    return best ? best.kg : null;
  }
  function budgetPerDay(p) { return p.budget ? P.perDay(p.budget.amount, p.budget.period) : null; }
  function targetsOf(u) { return P.targets(u.profile, newestWeight(u.history), St.today()); }
  function setDeep(obj, path, val) {
    var ks = path.split('.'), cur = obj;
    for (var i = 0; i < ks.length - 1; i++) { if (cur[ks[i]] === undefined || cur[ks[i]] === null) cur[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; cur = cur[ks[i]]; }
    cur[ks[ks.length - 1]] = val;
  }
  function getDeep(obj, path) { var cur = obj; path.split('.').forEach(function (k) { cur = cur === null || cur === undefined ? undefined : cur[k]; }); return cur; }
  function str(v) { return v === null || v === undefined ? '' : String(v); }

  // ---------- drafts: half-typed forms survive clicks elsewhere and reloads ----------
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window */ } }
  var DRAFTS_KEY = 'mealplanner:drafts';  // web app: one key per account, so two accounts in one browser never mix drafts
  function saveDrafts() { lsSet(DRAFTS_KEY, drafts); }
  function draft(key, init, label, where, base) {
    var d = drafts[key], today = St.today();
    if (!d || !d.typed) d = drafts[key] = { values: init(), typed: false, label: label, where: where, day: today, base: base === undefined ? null : base };
    else if (d.day !== today) {
      // A form left open overnight: dates that were "today" become today again; a plan never starts in the past.
      ['w_date', 's_date', 'n_date'].forEach(function (k) { if (d.values[k] === d.day) d.values[k] = today; });
      if (d.values.start_date && d.values.start_date < today) d.values.start_date = today;
      d.day = today; saveDrafts();
    }
    return d;
  }
  function staleBase(d, base) { return d.typed && d.base !== null && base !== undefined && d.base !== base; }
  function dropDraft(key) { delete drafts[key]; saveDrafts(); }
  function typedDrafts() { return Object.keys(drafts).filter(function (k) { return drafts[k].typed; }); }

  // ---------- render with focus kept ----------
  function render() {
    var a = document.activeElement, keep = null;
    if (a && a.id && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) {
      keep = { id: a.id };
      try { keep.s = a.selectionStart; keep.e = a.selectionEnd; } catch (e) { /* not a text box */ }
    }
    renderHeader();
    renderMain();
    if (keep) {
      var b = document.getElementById(keep.id);
      if (b) { b.focus(); try { if (keep.s !== undefined && keep.s !== null) b.setSelectionRange(keep.s, keep.e); } catch (e) { /* ignore */ } }
    }
  }

  function renderHeader() {
    document.documentElement.lang = lang;
    var users = S().users || {}, ids = Object.keys(users).filter(function (id) { return !users[id].profile.hidden; }).sort();
    var u = me();
    $('#who').innerHTML = St.folderName() ? '<label for="userpick" class="sr">' + h(t('profile')) + '</label><select id="userpick">' +
      (u ? '' : '<option value="">' + h(t('choose_profile')) + '</option>') +
      ids.map(function (id) { return '<option value="' + h(id) + '"' + (u && u.profile.id === id ? ' selected' : '') + '>' + h(users[id].profile.name) + '</option>'; }).join('') +
      '</select>' : '';
    $('#langbtns').innerHTML = ['en', 'cs'].map(function (l) {
      return '<button type="button" data-lang="' + l + '" aria-pressed="' + (l === lang) + '" class="' + (l === lang ? 'on' : '') + '">' + (l === 'en' ? 'English' : 'Čeština') + '</button>';
    }).join('');
    $('#nav').innerHTML = St.folderName() ? VIEWS.map(function (v) {
      var dis = !u && v !== 'profiles' && v !== 'foods' && v !== 'shops' && v !== 'settings';
      return '<button type="button" data-view="' + v + '"' + (view === v || (view === 'profile-edit' && v === 'profiles') || (view === 'request' && v === 'requests') ? ' class="on" aria-current="page"' : '') + (dis ? ' disabled title="' + h(t('pick_profile_first')) + '"' : '') + '>' + h(t('nav_' + v)) + '</button>';
    }).join('') : '';
    renderStatus();
    if (WEB) window.MPWeb.header();
    document.title = t('app_name');
  }
  function renderStatus() {
    var s = St.status(), el = $('#savestate');
    if (!el) return;
    if (!St.folderName()) { el.textContent = ''; return; }
    el.className = 'savestate ' + s.state;
    if (s.state === 'saving') el.textContent = t('saving');
    else if (s.state === 'error') el.innerHTML = h(t(has('save_error_' + s.error) ? 'save_error_' + s.error : 'save_error_x', { path: s.path || '', code: s.error || '' })) + ' <button type="button" data-act="reload">' + h(St.hasUnsaved() ? t('reload_drops') : t('reload_folder')) + '</button>';
    else if (s.state === 'saved') el.textContent = t('saved_at', { time: s.at.slice(11, 16) });
    else el.textContent = t('all_saved');
  }

  function bars() {
    var out = '', keys = typedDrafts().filter(function (k) { return drafts[k].where !== view + ':' + (viewArg || ''); });
    keys.forEach(function (k) {
      var d = drafts[k];
      out += '<div class="bar typed" role="status"><span>' + h(t('being_typed', { what: t(d.label.k, d.label.v) })) + '</span>' +
        '<button type="button" data-act="draft-continue" data-key="' + h(k) + '">' + h(t('continue')) + '</button>' +
        '<button type="button" class="ghost" data-act="draft-discard" data-key="' + h(k) + '">' + h(t('discard')) + '</button></div>';
    });
    if (backTo) out += '<div class="bar back"><button type="button" data-act="back">← ' + h(t('back_to', { what: backTo.title })) + '</button></div>';
    if (flash) out += '<div class="bar flash" role="status">' + flash + '</div>';
    return out;
  }

  function renderMain() {
    var m = $('#main');
    if (!St.folderName()) return; // connect screen is drawn by showConnect
    var fn = { profiles: vProfiles, 'profile-edit': vProfileEdit, plan: vPlan, requests: vRequests, request: vRequest, history: vHistory, foods: vFoods, shops: vShops, settings: vSettings }[view] || vProfiles;
    m.innerHTML = bars() + fn();
    after();
  }
  var afterHooks = [];
  function after() { var x = afterHooks; afterHooks = []; x.forEach(function (f) { f(); }); }

  function go(v, arg, opts) {
    opts = opts || {};
    if (!opts.keepBack) backTo = opts.backTo || null;
    flash = opts.flash || null;
    view = v; viewArg = arg === undefined ? null : arg;
    render();
    if (opts.focus) { var el = document.getElementById(opts.focus); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('hl'); } }
    else window.scrollTo(0, opts.scroll || 0);
  }
  // extraHtml (2026-11-08): more buttons, already escaped, e.g. Copy shopping list after Pick this
  function showToast(text, undoInfo, extraHtml) {
    toast = { text: text, undo: undoInfo };
    var el = $('#toast');
    el.innerHTML = '<span>' + h(text) + '</span>' + (extraHtml || '') + (undoInfo ? ' <button type="button" data-act="undo" data-change="' + h(undoInfo) + '">' + h(t('undo')) + '</button>' : '') +
      ' <button type="button" class="ghost" data-act="toast-close" aria-label="' + h(t('close')) + '">' + h(t('close')) + '</button>';
    el.hidden = false;
    clearTimeout(showToast.tm); showToast.tm = setTimeout(function () { el.hidden = true; }, 9000);
  }

  // ---------- connect screen ----------
  function showConnect(state, error) {
    renderHeader();
    var m = $('#main');
    if (!St.hasFolderApi()) { m.innerHTML = '<section class="card"><h2>' + h(t('no_folder_api_title')) + '</h2><p>' + h(t('no_folder_api')) + '</p></section>'; return; }
    m.innerHTML = '<section class="card connect"><h2>' + h(t('connect_title')) + '</h2><p>' + h(t('connect_why')) + '</p>' +
      '<ol><li>' + h(t('connect_step1')) + '</li><li>' + h(t('connect_step2')) + '</li><li>' + h(t('connect_step3')) + '</li></ol>' +
      (state === 'prompt' ? '<p><button type="button" class="primary" data-act="allow-again">' + h(t('allow_again')) + '</button></p><p class="muted">' + h(t('allow_again_why')) + '</p>' : '') +
      '<p><button type="button" class="' + (state === 'prompt' ? '' : 'primary') + '" data-act="pick-folder">' + h(t('pick_folder')) + '</button></p>' +
      (error ? '<p class="error" role="alert">' + h(error) + '</p>' : '') + '</section>';
  }
  function connectError(e) {
    if (e && e.name === 'AbortError') return '';
    if (e && e.code === 'MP_PICKED_INNER') return t('picked_inner', { name: e.extra });
    if (e && e.code === 'MP_NOT_MEALPLANNER') return t('not_mealplanner', { name: e.extra });
    return t('folder_error') + ' ' + (e && (e.code || e.message) || '');
  }
  function afterLoad() {
    var s = S().settings;
    if (s.lang) lang = s.lang;
    if (s.last_user && S().users[s.last_user]) St.ME.userId = s.last_user;
    if (!WEB) { var d = lsGet(DRAFTS_KEY); if (d && typeof d === 'object') drafts = d; }
    go(me() ? 'plan' : 'profiles');
  }

  // =========================================================
  // PROFILES
  // =========================================================
  function vProfiles() {
    var users = S().users, ids = Object.keys(users).sort(), shown = ids.filter(function (id) { return !users[id].profile.hidden; }), hid = ids.filter(function (id) { return users[id].profile.hidden; });
    var out = '<section class="card"><h2>' + h(t('profiles_title')) + '</h2><p class="gist">' + h(t('profiles_gist')) + '</p>';
    if (!shown.length) out += '<p>' + h(t('no_profiles')) + '</p>';
    out += '<div class="grid">' + shown.map(function (id) {
      var u = users[id], tg = targetsOf(u), on = St.ME.userId === id;
      return '<article class="pcard' + (on ? ' on' : '') + '" id="pc-' + h(id) + '"><h3>' + h(u.profile.name) + (on ? ' <span class="tag">' + h(t('in_use')) + '</span>' : '') + '</h3>' +
        '<p class="gist">' + h(goalLine(u.profile, tg)) + '</p>' +
        '<p class="muted">' + h(tp('cards_count', myCards(u.profile).length)) + ' · ' + h(tp('locations_count', (u.profile.locations || []).length)) + '</p>' +
        '<div class="row">' + (on ? '' : '<button type="button" class="primary" data-act="use-user" data-id="' + h(id) + '">' + h(t('use_profile')) + '</button>') +
        '<button type="button" data-act="edit-user" data-id="' + h(id) + '">' + h(t('edit_profile')) + '</button></div></article>';
    }).join('') + '</div>';
    out += '<p><button type="button" class="primary" data-act="new-user">+ ' + h(t('new_profile')) + '</button></p>';
    if (hid.length) out += '<details><summary>' + h(t('hidden_profiles', { n: hid.length })) + '</summary>' + hid.map(function (id) {
      return '<p>' + h(users[id].profile.name) + ' <button type="button" data-act="unhide-user" data-id="' + h(id) + '">' + h(t('show_again')) + '</button></p>';
    }).join('') + '</details>';
    return out + '</section>';
  }
  function goalLine(p, tg) {
    var g = p.goal || {};
    var a = g.type === 'typed' ? t('goal_typed_line', { p: fmt(g.typed_protein_g), k: fmt(g.typed_kcal) })
      : g.type === 'maintain' ? t('goal_maintain_line') : t('goal_gain_line', { kg: fmt(g.gain_kg, 1), w: tp('n_weeks', g.weeks) });
    if (tg.ok) a += ' → ' + t('per_day_targets', { p: fmt(tg.protein_g), k: fmt(tg.kcal) });
    return a;
  }

  function profileInit(u) {
    var p = u ? St.clone(u.profile) : {};
    return {
      name: str(p.name), lang: p.lang || lang,
      body: { sex: (p.body || {}).sex || '', birth_date: str((p.body || {}).birth_date), height_cm: str((p.body || {}).height_cm),
        life_stage: (p.body || {}).life_stage || 'none', trimester: str((p.body || {}).trimester), lactation_period: str((p.body || {}).lactation_period) },
      weight: u ? '' : '',
      activity: (function () { var x = (p.activity || {}).pal; if (x === undefined || x === null) return { pal: u ? '' : '1.53', pal_custom: '' };
        return ['1.53', '1.76', '2.25'].indexOf(String(x)) >= 0 ? { pal: String(x), pal_custom: '' } : { pal: 'custom', pal_custom: String(x).replace('.', lang === 'cs' ? ',' : '.') }; })(),
      goal: { type: (p.goal || {}).type || 'gain', gain_kg: str((p.goal || {}).gain_kg), weeks: str((p.goal || {}).weeks), protein_g_per_kg: str((p.goal || {}).protein_g_per_kg),
        surplus_pct: str((p.goal || {}).surplus_pct), typed_protein_g: str((p.goal || {}).typed_protein_g), typed_kcal: str((p.goal || {}).typed_kcal) },
      budget: { amount: str((p.budget || {}).amount), period: (p.budget || {}).period || 'day' },
      cards: (p.cards || []).slice(), cards_other: (p.cards_other || []).map(function (x) { return { key: x.key, name: x.name }; }),
      locations: (p.locations || []).map(function (x) { return { id: x.id, name: x.name, address: x.address || '', walk_limit_min: str(x.walk_limit_min) }; }),
      accounts: (p.accounts || []).map(function (x) { return { id: x.id, shop: x.shop, account_name: x.account_name || '', email: x.email || '' }; }),
      basket_fill: (function () { var b = p.basket_fill || {}; return ['kosik', 'tesco'].filter(function (k) { return b[k] === true; }); })(),
      likes: str(p.likes), dislikes: str(p.dislikes), allergies: str(p.allergies),
      cooking: { max_cook_min: str((p.cooking || {}).max_cook_min || '30'), meals_per_day: str((p.cooking || {}).meals_per_day || '3') }
    };
  }
  function pfKey() { return 'profile:' + (viewArg || 'new'); }
  function vProfileEdit() {
    var u = viewArg ? S().users[viewArg] : null;
    var base = u ? JSON.stringify(u.profile) : undefined;
    var key = pfKey(), d = draft(key, function () { return profileInit(u); }, { k: u ? 'draft_profile_edit' : 'draft_profile_new', v: { name: u ? u.profile.name : '' } }, 'profile-edit:' + (viewArg || ''), base === undefined ? null : base);
    var v = d.values;
    function fid(n) { return 'pf-' + n.replace(/\./g, '-'); }
    function inp(name, label, opts) {
      opts = opts || {};
      return '<div class="field"><label for="' + fid(name) + '">' + h(label) + '</label>' +
        '<input id="' + fid(name) + '" name="' + name + '" type="' + (opts.type || 'text') + '"' + (opts.mode ? ' inputmode="' + opts.mode + '"' : '') +
        ' value="' + h(getDeep(v, name)) + '"' + (opts.ph ? ' placeholder="' + h(opts.ph) + '"' : '') + ' autocomplete="off">' + (opts.help ? '<small>' + h(opts.help) + '</small>' : '') + '</div>';
    }
    function sel(name, label, options, help) {
      var cur = getDeep(v, name);
      return '<div class="field"><label for="' + fid(name) + '">' + h(label) + '</label><select id="' + fid(name) + '" name="' + name + '">' +
        options.map(function (o) { return '<option value="' + h(o[0]) + '"' + (String(cur) === String(o[0]) ? ' selected' : '') + '>' + h(o[1]) + '</option>'; }).join('') + '</select>' + (help ? '<small>' + h(help) + '</small>' : '') + '</div>';
    }
    var g = v.goal, out = '<section class="card" data-form="' + h(key) + '"><h2>' + h(u ? t('edit_profile_of', { name: u.profile.name }) : t('new_profile')) + '</h2>' +
      '<p class="gist">' + h(t('profile_form_gist')) + '</p>' +
      (staleBase(d, base) ? '<div class="bar warnbar" role="status">' + h(t('form_base_changed')) + ' <button type="button" data-act="pf-cancel-reload">' + h(t('load_current')) + '</button></div>' : '');
    out += '<fieldset><legend>' + h(t('sec_person')) + '</legend>' + inp('name', t('f_name'), { ph: t('ph_name') }) +
      sel('lang', t('f_lang'), [['en', 'English'], ['cs', 'Čeština']]) +
      sel('body.sex', t('f_sex'), [['', t('choose')], ['m', t('sex_m')], ['f', t('sex_f')]], t('sex_help')) +
      '<div class="field"><label for="pf-body-birth_date">' + h(t('f_birth')) + '</label><input id="pf-body-birth_date" name="body.birth_date" type="date" value="' + h(v.body.birth_date) + '" max="' + St.today() + '"></div>' +
      inp('body.height_cm', t('f_height'), { mode: 'decimal', ph: '178' }) +
      (v.body.sex === 'f' ? sel('body.life_stage', t('f_life_stage'), [['none', t('stage_none')], ['pregnant', t('stage_pregnant')], ['lactating', t('stage_lactating')]], t('life_stage_help')) +
        (v.body.life_stage === 'pregnant' ? sel('body.trimester', t('f_trimester'), [['', t('choose')], ['1', t('trimester_1')], ['2', t('trimester_2')], ['3', t('trimester_3')]]) : '') +
        (v.body.life_stage === 'lactating' ? sel('body.lactation_period', t('f_lactation_period'), [['', t('choose')], ['0-6', t('lact_0_6')], ['7-12', t('lact_7_12')]]) : '') : '') +
      (u ? '<p class="muted">' + h(t('weight_in_history', { kg: fmt(newestWeight(u.history), 1) })) + '</p>' : inp('weight', t('f_weight_now'), { mode: 'decimal', ph: '68,4' })) +
      sel('activity.pal', t('f_activity'), [['', t('pal_unknown')], ['1.53', t('pal_light')], ['1.76', t('pal_active')], ['2.25', t('pal_vigorous')], ['custom', t('pal_custom')]], t('pal_help')) +
      (v.activity.pal === 'custom' ? inp('activity.pal_custom', t('f_pal_custom'), { mode: 'decimal', ph: '1,6', help: t('pal_custom_help') }) : '') + '</fieldset>';
    out += '<fieldset><legend>' + h(t('sec_goal')) + '</legend>' +
      sel('goal.type', t('f_goal_type'), [['gain', t('goal_gain')], ['typed', t('goal_typed')], ['maintain', t('goal_maintain')]]) +
      (g.type === 'gain' ? inp('goal.gain_kg', t('f_gain_kg'), { mode: 'decimal', ph: '3' }) + inp('goal.weeks', t('f_weeks'), { mode: 'numeric', ph: '12' }) +
        inp('goal.surplus_pct', t('f_surplus'), { mode: 'decimal', help: t('surplus_help') }) : '') +
      (g.type !== 'typed' ? inp('goal.protein_g_per_kg', t('f_gpk_own'), { mode: 'decimal', ph: t('ph_gpk_dri'), help: t('gpk_own_help') }) : '') +
      (g.type === 'typed' ? inp('goal.typed_protein_g', t('f_typed_p'), { mode: 'decimal', ph: '140' }) + inp('goal.typed_kcal', t('f_typed_k'), { mode: 'decimal', ph: '2900' }) : '') +
      '<div id="pf-preview" class="preview" aria-live="polite">' + previewHtml(v, u) + '</div></fieldset>';
    out += '<fieldset><legend>' + h(t('sec_budget')) + '</legend>' + inp('budget.amount', t('f_budget'), { mode: 'decimal', ph: '250' }) +
      sel('budget.period', t('f_budget_period'), [['day', t('per_day')], ['week', t('per_week')], ['month', t('per_month')]], t('budget_help')) + '</fieldset>';
    out += '<fieldset><legend>' + h(t('sec_cards')) + '</legend><p class="gist">' + h(t('cards_gist')) + '</p><div class="checks">' +
      CARDS.map(function (c) { var on = v.cards.indexOf(c.key) >= 0; return '<label class="check"><input type="checkbox" id="pf-card-' + c.key + '" name="cards" value="' + c.key + '"' + (on ? ' checked' : '') + '> ' + h(c.name) + '</label>'; }).join('') + '</div>' +
      v.cards_other.map(function (c, i) {
        return '<div class="row item"><div class="field"><label for="pf-cards_other-' + i + '-name">' + h(t('f_other_card')) + '</label><input id="pf-cards_other-' + i + '-name" name="cards_other.' + i + '.name" value="' + h(c.name) + '" autocomplete="off"></div>' +
          '<button type="button" class="ghost" data-act="pf-remove" data-list="cards_other" data-i="' + i + '">' + h(t('remove')) + '</button></div>';
      }).join('') + '<button type="button" data-act="pf-add" data-list="cards_other">+ ' + h(t('add_other_card')) + '</button></fieldset>';
    out += '<fieldset><legend>' + h(t('sec_locations')) + '</legend><p class="gist">' + h(t('locations_gist')) + '</p>' +
      v.locations.map(function (l, i) {
        return '<div class="item"><div class="row">' +
          '<div class="field"><label for="pf-locations-' + i + '-name">' + h(t('f_loc_name')) + '</label><input id="pf-locations-' + i + '-name" name="locations.' + i + '.name" value="' + h(l.name) + '" placeholder="' + h(t('ph_loc_name')) + '" autocomplete="off"></div>' +
          '<div class="field grow"><label for="pf-locations-' + i + '-address">' + h(t('f_loc_address')) + '</label><input id="pf-locations-' + i + '-address" name="locations.' + i + '.address" value="' + h(l.address) + '" placeholder="' + h(t('ph_loc_address')) + '" autocomplete="off"></div>' +
          '<div class="field small"><label for="pf-locations-' + i + '-walk_limit_min">' + h(t('f_walk_limit')) + '</label><input id="pf-locations-' + i + '-walk_limit_min" name="locations.' + i + '.walk_limit_min" inputmode="numeric" value="' + h(l.walk_limit_min) + '" placeholder="15"></div>' +
          '</div><button type="button" class="ghost" data-act="pf-remove" data-list="locations" data-i="' + i + '">' + h(t('remove')) + '</button></div>';
      }).join('') + '<button type="button" data-act="pf-add" data-list="locations">+ ' + h(t('add_location')) + '</button></fieldset>';
    out += '<fieldset><legend>' + h(t('sec_accounts')) + '</legend><p class="gist">' + h(t('accounts_gist')) + '</p>' +
      v.accounts.map(function (a, i) {
        return '<div class="item"><div class="row">' +
          '<div class="field"><label for="pf-accounts-' + i + '-shop">' + h(t('f_shop')) + '</label><select id="pf-accounts-' + i + '-shop" name="accounts.' + i + '.shop">' +
          SHOP_KEYS.map(function (k) { return '<option value="' + k + '"' + (a.shop === k ? ' selected' : '') + '>' + h(t('shop_' + k)) + '</option>'; }).join('') + '</select></div>' +
          '<div class="field grow"><label for="pf-accounts-' + i + '-account_name">' + h(t('f_account_name')) + '</label><input id="pf-accounts-' + i + '-account_name" name="accounts.' + i + '.account_name" value="' + h(a.account_name) + '" autocomplete="off"></div>' +
          '<div class="field grow"><label for="pf-accounts-' + i + '-email">' + h(t('f_account_email')) + '</label><input id="pf-accounts-' + i + '-email" name="accounts.' + i + '.email" type="email" value="' + h(a.email) + '" autocomplete="off"></div>' +
          '</div><button type="button" class="ghost" data-act="pf-remove" data-list="accounts" data-i="' + i + '">' + h(t('remove')) + '</button></div>';
      }).join('') + '<button type="button" data-act="pf-add" data-list="accounts">+ ' + h(t('add_account')) + '</button>' +
      // 2026-11-08: Claude may fill these baskets in Chrome when you are signed in there (RUN-STEPS F2); never pays
      '<p class="gist">' + h(t('basket_fill_gist')) + '</p><div class="checks">' + ['kosik', 'tesco'].map(function (k) {
        return '<label class="check"><input type="checkbox" id="pf-basket-' + k + '" name="basket_fill" value="' + k + '"' + (v.basket_fill.indexOf(k) >= 0 ? ' checked' : '') + '> ' + h(t('basket_fill_' + k)) + '</label>';
      }).join('') + '</div></fieldset>';
    out += '<fieldset><legend>' + h(t('sec_food')) + '</legend>' +
      '<div class="field"><label for="pf-likes">' + h(t('f_likes')) + '</label><textarea id="pf-likes" name="likes" rows="2" placeholder="' + h(t('ph_likes')) + '">' + h(v.likes) + '</textarea></div>' +
      '<div class="field"><label for="pf-dislikes">' + h(t('f_dislikes')) + '</label><textarea id="pf-dislikes" name="dislikes" rows="2">' + h(v.dislikes) + '</textarea></div>' +
      '<div class="field"><label for="pf-allergies">' + h(t('f_allergies')) + '</label><textarea id="pf-allergies" name="allergies" rows="2" placeholder="' + h(t('ph_allergies')) + '">' + h(v.allergies) + '</textarea><small>' + h(t('allergies_help')) + '</small></div>' +
      inp('cooking.max_cook_min', t('f_max_cook'), { mode: 'numeric' }) + inp('cooking.meals_per_day', t('f_meals'), { mode: 'numeric' }) + '</fieldset>';
    out += '<div id="pf-errors" role="alert" class="error"></div><div class="row sticky"><button type="button" class="primary" data-act="pf-save">' + h(u ? t('save_profile') : t('create_profile')) + '</button>' +
      '<button type="button" class="ghost" data-act="pf-cancel">' + h(t('discard')) + '</button></div>';
    if (u) out += '<details class="danger"><summary>' + h(t('hide_profile')) + '</summary><p>' + h(t('hide_profile_why')) + '</p><button type="button" data-act="hide-user" data-id="' + h(u.profile.id) + '">' + h(t('hide_profile_yes', { name: u.profile.name })) + '</button></details>';
    return out + '</section>';
  }
  function draftProfile(v, u) {
    var pal = v.activity.pal === 'custom' ? num(v.activity.pal_custom) : num(v.activity.pal);
    return {
      body: bodyOf(v),
      activity: { pal: pal },
      goal: { type: v.goal.type, gain_kg: num(v.goal.gain_kg), weeks: num(v.goal.weeks), protein_g_per_kg: num(v.goal.protein_g_per_kg), surplus_pct: num(v.goal.surplus_pct),
        typed_protein_g: num(v.goal.typed_protein_g), typed_kcal: num(v.goal.typed_kcal) }
    };
  }
  // Life stage is stored only for women; a field that does not apply is stored as null, so undo stays exact.
  function bodyOf(v) {
    var f = v.body.sex === 'f', st = f && (v.body.life_stage === 'pregnant' || v.body.life_stage === 'lactating') ? v.body.life_stage : 'none';
    return { sex: v.body.sex, birth_date: v.body.birth_date, height_cm: num(v.body.height_cm), life_stage: st,
      trimester: st === 'pregnant' && v.body.trimester ? Number(v.body.trimester) : null, lactation_period: st === 'lactating' && v.body.lactation_period ? v.body.lactation_period : null };
  }
  function previewHtml(v, u) {
    var w = u ? newestWeight(u.history) : num(v.weight);
    var tg = P.targets(draftProfile(v, u), w, St.today());
    if (!tg.ok) return '<p class="muted">' + h(t('preview_missing', { list: tg.missing.map(function (m) { return t('miss_' + m); }).join(', ') })) + '</p>';
    var out = '<p><strong>' + h(t('per_day_targets', { p: fmt(tg.protein_g), k: fmt(tg.kcal) })) + '</strong></p>' + targetsExplain(tg, w) +
      (tg.mode === 'gain' ? '<p class="muted">' + h(t('preview_gain', { r: fmt(tg.rate_kg_week, 2), pct: fmt(tg.rate_pct_week, 2), s: fmt(tg.surplus_pct, 1) })) + '</p>' : '');
    tg.warnings.forEach(function (x) { out += '<p class="warn">' + h(t('warn_' + x, warnVars(tg))) + '</p>'; });
    return out;
  }
  function warnVars(tg) { var d = tg.dri || {}; return { dri: fmt(d.protein_g_per_kg, 2), drig: fmt(d.protein_g) }; }
  /* "Where each target comes from": one line per target, with the rule, the numbers of this body and a source link.
     Used in the profile form, on the profile card and above the plan form. */
  function targetsExplain(tg, w) {
    var d = tg.dri; if (!d || d.missing.length) return '';
    var grp = t('grp_' + d.eer_group, { a: d.age_group }), act = t('pa_' + d.pa_level) + (d.activity_given ? '' : ' ' + t('pa_assumed'));
    var stage = d.life_stage === 'pregnant' ? t('stage_line_pregnant', { n: d.trimester, k: fmt(d.stage_add_kcal) })
      : d.life_stage === 'lactating' ? t('stage_line_lactating', { p: d.lactation_period, k: fmt(d.stage_add_kcal) }) : '';
    var prot = tg.mode === 'typed' ? t('src_protein_typed', { drig: fmt(d.protein_g), dri: fmt(d.protein_g_per_kg, 2) })
      : tg.protein_basis === 'own' ? t('src_protein_own', { gpk: fmt(tg.protein_g_per_kg, 2), kg: fmt(w, 1), p: fmt(tg.protein_g), dri: fmt(d.protein_g_per_kg, 2), drig: fmt(d.protein_g) })
      : t('src_protein_dri', { gpk: fmt(d.protein_g_per_kg, 2), kg: fmt(w, 1), p: fmt(d.protein_g), grp: d.life_stage === 'none' ? t('age_years', { a: d.age_group }) : t('stage_' + d.life_stage) });
    var en = tg.mode === 'typed' ? t('src_energy_typed', { m: fmt(d.eer_kcal) })
      : t('src_energy_eer', { m: fmt(d.eer_kcal), grp: grp, act: act, pa: d.pa_coef === null ? '–' : fmt(d.pa_coef, 2) }) + (stage ? ' ' + stage : '');
    return '<ul class="targets-src">' +
      '<li><b>' + h(t('tgt_protein')) + '</b> ' + h(prot) + ' <a href="' + DRI_LINKS.protein + '" target="_blank" rel="noopener">' + h(t('src_protein_link')) + '</a></li>' +
      '<li><b>' + h(t('tgt_energy')) + '</b> ' + h(en) + ' <a href="' + DRI_LINKS.report + '" target="_blank" rel="noopener">' + h(t('src_energy_link')) + '</a></li>' +
      '<li class="muted">' + h(t('src_unverified')) + '</li></ul>';
  }
  function onProfileInput(el) {
    var key = pfKey(), d = drafts[key]; if (!d) return;
    var v = d.values, name = el.name;
    if (name === 'basket_fill') {
      var bi = v.basket_fill.indexOf(el.value);
      if (el.checked && bi < 0) v.basket_fill.push(el.value);
      if (!el.checked && bi >= 0) v.basket_fill.splice(bi, 1);
    } else if (name === 'cards') {
      var i = v.cards.indexOf(el.value);
      if (el.checked && i < 0) v.cards.push(el.value);
      if (!el.checked && i >= 0) v.cards.splice(i, 1);
    } else setDeep(v, name, el.value);
    d.typed = true; saveDrafts();
    // Fields that change which boxes exist redraw the form (focus is kept); others only update the preview.
    if (name === 'goal.type' || name === 'activity.pal' || name === 'body.sex' || name === 'body.life_stage') { render(); return; }
    var pv = $('#pf-preview'); if (pv) pv.innerHTML = previewHtml(v, viewArg ? S().users[viewArg] : null);
  }
  function profileErrors(v, isNew) {
    var miss = [];
    if (!v.name.trim()) miss.push(t('f_name'));
    if (!v.body.sex) miss.push(t('f_sex'));
    if (!v.body.birth_date) miss.push(t('f_birth'));
    var hc = num(v.body.height_cm); if (hc === null || hc < 100 || hc > 250) miss.push(t('f_height') + ' ' + rng(100, 250));
    if (isNew) { var w = num(v.weight); if (w === null || w < 30 || w > 300) miss.push(t('f_weight_now') + ' ' + rng(30, 300)); }
    if (v.activity.pal === 'custom') { var pc = num(v.activity.pal_custom); if (pc === null || pc < 1.2 || pc > 2.5) miss.push(t('f_pal_custom') + ' ' + rng(1.2, 2.5)); }
    if (v.goal.type === 'gain') {
      var gk = num(v.goal.gain_kg); if (gk === null || gk <= 0 || gk > 40) miss.push(t('f_gain_kg') + ' ' + rng(0, 40));
      var wk = num(v.goal.weeks); if (wk === null || wk < 1 || wk > 104) miss.push(t('f_weeks') + ' ' + rng(1, 104));
      var sp = v.goal.surplus_pct.trim() === '' ? 0 : num(v.goal.surplus_pct); if (sp === null || sp < 0 || sp > 40) miss.push(t('f_surplus') + ' ' + rng(0, 40));
    }
    // Own protein per kg is optional (blank = the DRI for this body); no fixed minimum, only a sanity range.
    if (v.goal.type !== 'typed' && v.goal.protein_g_per_kg.trim() !== '') { var g = num(v.goal.protein_g_per_kg); if (g === null || g < 0.3 || g > 3.5) miss.push(t('f_gpk_own') + ' ' + rng(0.3, 3.5)); }
    if (v.body.sex === 'f' && v.body.life_stage === 'pregnant' && !v.body.trimester) miss.push(t('f_trimester'));
    if (v.body.sex === 'f' && v.body.life_stage === 'lactating' && !v.body.lactation_period) miss.push(t('f_lactation_period'));
    if (v.goal.type === 'typed') {
      var tp = num(v.goal.typed_protein_g); if (tp === null || tp < 20 || tp > 500) miss.push(t('f_typed_p') + ' ' + rng(20, 500));
      var tk = num(v.goal.typed_kcal); if (tk === null || tk < 800 || tk > 7000) miss.push(t('f_typed_k') + ' ' + rng(800, 7000));
    }
    var b = num(v.budget.amount); if (b === null || b <= 0) miss.push(t('f_budget'));
    v.locations.forEach(function (l, i) {
      if (!l.name.trim()) miss.push(t('f_loc_name') + ' #' + (i + 1));
      if (l.walk_limit_min.trim() && (num(l.walk_limit_min) === null || num(l.walk_limit_min) <= 0)) miss.push(t('f_walk_limit') + ' #' + (i + 1));
    });
    v.cards_other.forEach(function (c, i) { if (!c.name.trim()) miss.push(t('f_other_card') + ' #' + (i + 1)); });
    v.accounts.forEach(function (a, i) { if (!a.account_name.trim() && !a.email.trim()) miss.push(t('f_account_name') + ' #' + (i + 1)); });
    return miss;
  }
  function buildProfile(v, old) {
    var pal = v.activity.pal === 'custom' ? num(v.activity.pal_custom) : num(v.activity.pal);
    function codes(list, prefix, oldList) {
      var doc = { x: (oldList || []).slice(), _trash: [] };
      return list.map(function (it) {
        var o = St.clone(it);
        if (!o.id) { o.id = St.nextCode(doc, 'x', prefix); doc.x.push({ id: o.id }); }
        return o;
      });
    }
    var oldLocs = (old && old.locations || []).concat(old && old._locations_used || []);
    var locs = codes(v.locations, 'L', oldLocs).map(function (l) { return { id: l.id, name: l.name.trim(), address: l.address.trim(), walk_limit_min: num(l.walk_limit_min) }; });
    var accs = codes(v.accounts, 'A', (old && old.accounts || []).concat(old && old._accounts_used || [])).map(function (a) { return { id: a.id, shop: a.shop || 'rohlik', account_name: a.account_name.trim(), email: a.email.trim() }; });
    var goal = { type: v.goal.type };
    if (v.goal.type === 'gain') { goal.gain_kg = num(v.goal.gain_kg); goal.weeks = num(v.goal.weeks); goal.surplus_pct = num(v.goal.surplus_pct); }
    if (v.goal.type !== 'typed') goal.protein_g_per_kg = num(v.goal.protein_g_per_kg);
    if (v.goal.type === 'typed') { goal.typed_protein_g = num(v.goal.typed_protein_g); goal.typed_kcal = num(v.goal.typed_kcal); }
    return {
      name: v.name.trim(), lang: v.lang,
      body: bodyOf(v),
      activity: { pal: pal },
      goal: goal,
      budget: { amount: num(v.budget.amount), period: v.budget.period, currency: 'CZK' },
      cards: CARDS.map(function (c) { return c.key; }).filter(function (k) { return v.cards.indexOf(k) >= 0; }),
      cards_other: v.cards_other.map(function (c) { return { key: 'other-' + St.slug(c.name), name: c.name.trim() }; }),
      locations: locs, accounts: accs,
      basket_fill: { kosik: (v.basket_fill || []).indexOf('kosik') >= 0, tesco: (v.basket_fill || []).indexOf('tesco') >= 0 },
      likes: v.likes.trim(), dislikes: v.dislikes.trim(), allergies: v.allergies.trim(),
      cooking: { max_cook_min: num(v.cooking.max_cook_min), meals_per_day: num(v.cooking.meals_per_day) },
      weights: (old && old.weights) || St.clone(P.DEFAULT_WEIGHTS)
    };
  }
  var creating = false;
  function saveProfile() {
    var key = pfKey(), d = drafts[key], u = viewArg ? S().users[viewArg] : null;
    if (!d) return;
    var miss = profileErrors(d.values, !u), box = $('#pf-errors');
    if (miss.length) { box.textContent = t('missing_fields', { list: miss.join(', ') }); box.scrollIntoView({ block: 'center' }); return; }
    var np = buildProfile(d.values, u && u.profile);
    if (!u) {
      if (creating) return;
      creating = true;
      np.goal.start_date = St.today(); np.goal.start_kg = num(d.values.weight);
      St.createUser(np, num(d.values.weight)).then(function (id) {
        creating = false;
        St.ME.userId = id; lang = np.lang || lang; St.setSetting('lang', lang);
        dropDraft(key); showToast(t('profile_created', { name: np.name }));
        go('plan');
      }, function (e) { creating = false; box.textContent = t('folder_error') + ' ' + (e && (e.code || e.message) || ''); });
      return;
    }
    var old = u.profile, ops = [];
    // Leaf paths for objects, whole values for lists, so undo can be precise.
    ['name', 'lang', 'likes', 'dislikes', 'allergies', 'cards', 'cards_other', 'locations', 'accounts', 'basket_fill'].forEach(function (k) { ops.push({ file: 'profile', path: k, value: np[k] }); });
    ['body', 'activity', 'budget', 'cooking'].forEach(function (k) { Object.keys(np[k]).forEach(function (f) { ops.push({ file: 'profile', path: k + '.' + f, value: np[k][f] }); }); });
    var og = old.goal || {}, goalChanged = og.type !== np.goal.type || og.gain_kg !== np.goal.gain_kg || og.weeks !== np.goal.weeks;
    ['type', 'gain_kg', 'weeks', 'surplus_pct', 'protein_g_per_kg', 'typed_protein_g', 'typed_kcal'].forEach(function (f) { ops.push({ file: 'profile', path: 'goal.' + f, value: np.goal[f] === undefined ? null : np.goal[f] }); });
    if (goalChanged) { ops.push({ file: 'profile', path: 'goal.start_date', value: St.today() }); ops.push({ file: 'profile', path: 'goal.start_kg', value: newestWeight(u.history) }); }
    // Keep every code ever used, so a removed location's code is never given to a new one.
    var usedL = (old._locations_used || []).concat((old.locations || []).concat(np.locations).map(function (l) { return { id: l.id }; }));
    var usedA = (old._accounts_used || []).concat((old.accounts || []).concat(np.accounts).map(function (a) { return { id: a.id }; }));
    ops.push({ file: 'profile', path: '_locations_used', value: dedupe(usedL) });
    ops.push({ file: 'profile', path: '_accounts_used', value: dedupe(usedA) });
    var c = St.commit(u.profile.id, 'profile_saved', ops);
    if (np.lang && St.ME.userId === u.profile.id && np.lang !== lang) { lang = np.lang; St.setSetting('lang', lang); }
    dropDraft(key);
    showToast(c ? t('profile_saved', { name: np.name }) : t('nothing_changed'), c ? c.id + '|' + u.profile.id : null);
    go('profiles', null, { focus: 'pc-' + u.profile.id });
  }
  function dedupe(list) { var seen = {}; return list.filter(function (x) { if (seen[x.id]) return false; seen[x.id] = true; return true; }); }

  // =========================================================
  // NEW PLAN (request)
  // =========================================================
  function reqKey() { return 'request:' + St.ME.userId; }
  function reqInit(u) {
    var p = u.profile;
    return { mode: '', start_date: St.today(), days: '3', meals: str((p.cooking || {}).meals_per_day || 3), budget_total: '', location_id: (p.locations && p.locations[0] && p.locations[0].id) || '',
      wishes: '', cart_shop: 'auto', max_cook_min: str((p.cooking || {}).max_cook_min || 30), max_delivery_min: '45', max_walk_min: '' };
  }
  function vPlan() {
    var u = me(); if (!u) return vProfiles();
    var key = reqKey(), d = draft(key, function () { return reqInit(u); }, { k: 'draft_request', v: { name: u.profile.name } }, 'plan:'), v = d.values;
    var tg = targetsOf(u), bpd = budgetPerDay(u.profile);
    var out = '<section class="card" data-form="' + h(key) + '"><h2>' + h(t('plan_title', { name: u.profile.name })) + '</h2><p class="gist">' + h(t('plan_gist')) + '</p>';
    out += '<div class="targets">' + (tg.ok ? '<span>' + h(t('per_day_targets', { p: fmt(tg.protein_g), k: fmt(tg.kcal) })) + '</span>' : '<span class="warn">' + h(t('targets_missing')) + ' ' + h(tg.missing.map(function (m) { return t('miss_' + m); }).join(', ')) + '</span>') +
      '<span>' + h(t('budget_per_day_is', { b: czk(bpd) })) + '</span><span>' + h(t('cards_line', { list: myCards(u.profile).map(cardName).join(', ') || t('none') })) + '</span></div>';
    if (tg.ok && tg.dri) out += '<details class="why-targets"><summary>' + h(t('why_targets')) + '</summary>' + targetsExplain(tg, newestWeight(u.history)) + '</details>';
    out += '<h3>' + h(t('q_mode')) + '</h3><div class="modes" role="radiogroup" aria-label="' + h(t('q_mode')) + '">' + ['cook', 'order', 'eatout'].map(function (m) {
      return '<button type="button" role="radio" id="mode-' + m + '" aria-checked="' + (v.mode === m) + '" class="mode' + (v.mode === m ? ' on' : '') + '" data-act="mode" data-mode="' + m + '"><strong>' + h(t('mode_' + m)) + '</strong><span>' + h(t('mode_' + m + '_gist')) + '</span></button>';
    }).join('') + '</div>';
    if (v.mode) {
      var locs = u.profile.locations || [];
      function inp(name, label, o) {
        o = o || {};
        return '<div class="field' + (o.cls ? ' ' + o.cls : '') + '"><label for="rq-' + name + '">' + h(label) + '</label><input id="rq-' + name + '" name="' + name + '" type="' + (o.type || 'text') + '"' + (o.mode ? ' inputmode="' + o.mode + '"' : '') +
          ' value="' + h(v[name]) + '"' + (o.ph ? ' placeholder="' + h(o.ph) + '"' : '') + (o.min ? ' min="' + o.min + '"' : '') + ' autocomplete="off">' + (o.help ? '<small>' + h(o.help) + '</small>' : '') + '</div>';
      }
      if (WEB && v.mode === 'cook') out += window.MPWeb.instantPlan(u, v, tg);  // web app: an estimate at once from prices already in the account
      var days = num(v.days) || 0;
      out += '<h3>' + h(t('q_boxes')) + '</h3><div class="formgrid">' +
        '<div class="field"><label for="rq-start_date">' + h(t('f_start')) + '</label><input id="rq-start_date" name="start_date" type="date" value="' + h(v.start_date) + '" min="' + St.today() + '"></div>' +
        inp('days', t('f_days'), { mode: 'numeric', help: '1–14' }) + inp('meals', t('f_meals'), { mode: 'numeric', help: '1–6' }) +
        inp('budget_total', t('f_budget_this'), { mode: 'decimal', ph: bpd && days ? fmt(bpd * days, 0) : '', help: t('budget_this_help', { b: czk(bpd) }) }) +
        '<div class="field"><label for="rq-location_id">' + h(t('f_location')) + '</label><select id="rq-location_id" name="location_id"><option value="">' + h(t('choose')) + '</option>' +
        locs.map(function (l) { return '<option value="' + h(l.id) + '"' + (v.location_id === l.id ? ' selected' : '') + '>' + h(l.name) + '</option>'; }).join('') + '</select>' +
        (locs.length ? '' : '<small class="warn">' + h(t('no_locations')) + '</small>') + '</div>';
      if (v.mode === 'cook') {
        out += inp('max_cook_min', t('f_max_cook'), { mode: 'numeric' }) +
          '<div class="field"><label for="rq-cart_shop">' + h(t('f_cart_shop')) + '</label><select id="rq-cart_shop" name="cart_shop"><option value="auto">' + h(t('cart_auto')) + '</option>' +
          ONLINE_SHOPS.map(function (s) { return '<option value="' + s.key + '"' + (v.cart_shop === s.key ? ' selected' : '') + '>' + h(s.name) + '</option>'; }).join('') + '</select><small>' + h(t('cart_help')) + '</small></div>';
      }
      if (v.mode === 'order') out += inp('max_delivery_min', t('f_max_delivery'), { mode: 'numeric' });
      if (v.mode === 'eatout') {
        var loc = locs.filter(function (l) { return l.id === v.location_id; })[0];
        out += inp('max_walk_min', t('f_max_walk'), { mode: 'numeric', ph: loc && loc.walk_limit_min ? String(loc.walk_limit_min) : '15', help: t('walk_help') });
      }
      out += '</div><div class="field"><label for="rq-wishes">' + h(t('f_wishes')) + '</label><textarea id="rq-wishes" name="wishes" rows="3" placeholder="' + h(t('ph_wishes_' + v.mode)) + '">' + h(v.wishes) + '</textarea></div>' +
        '<div id="rq-errors" class="error" role="alert"></div><div class="row"><button type="button" class="primary" data-act="send">' + h(t('send_to_claude')) + '</button>' +
        '<button type="button" class="ghost" data-act="rq-clear">' + h(t('discard')) + '</button></div><p class="muted">' + h(t('send_what_happens')) + '</p>';
    }
    return out + '</section>';
  }
  function sendRequest() {
    var u = me(), key = reqKey(), d = drafts[key]; if (!u || !d) return;
    var v = d.values, miss = [], tg = targetsOf(u), days = num(v.days), meals = num(v.meals);
    if (!v.mode) miss.push(t('q_mode'));
    if (!v.start_date) miss.push(t('f_start'));
    if (days === null || days < 1 || days > 14 || Math.floor(days) !== days) miss.push(t('f_days') + ' ' + rng(1, 14));
    if (meals === null || meals < 1 || meals > 6 || Math.floor(meals) !== meals) miss.push(t('f_meals') + ' ' + rng(1, 6));
    if (!v.location_id) miss.push(t('f_location'));
    if (!tg.ok) miss.push(t('targets_missing') + ' ' + tg.missing.map(function (m) { return t('miss_' + m); }).join(', '));
    if (v.start_date && v.start_date < St.today()) miss.push(t('f_start') + ' (' + t('not_past') + ')');
    var bpd = budgetPerDay(u.profile), bt = v.budget_total.trim() === '' ? (bpd !== null && days ? P.r(bpd * days, 2) : null) : num(v.budget_total);
    if (bt === null || bt <= 0) miss.push(t('f_budget_this'));
    if (v.mode === 'cook' && (num(v.max_cook_min) === null || num(v.max_cook_min) < 0)) miss.push(t('f_max_cook'));
    if (v.mode === 'order' && (num(v.max_delivery_min) === null || num(v.max_delivery_min) <= 0)) miss.push(t('f_max_delivery'));
    if (v.mode === 'eatout' && v.max_walk_min.trim() !== '' && (num(v.max_walk_min) === null || num(v.max_walk_min) <= 0)) miss.push(t('f_max_walk'));
    if (miss.length) { $('#rq-errors').textContent = t('missing_fields', { list: miss.join(', ') }); return; }
    var p = u.profile, loc = St.clone((p.locations || []).filter(function (l) { return l.id === v.location_id; })[0]);
    var at = St.nowIso(), stamp = at.slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2');
    var id = 'REQ-' + stamp + '-' + p.id, n = 2;
    while (S().requests[id] || S().results[id]) { id = 'REQ-' + stamp + '-' + p.id + '-' + n; n++; }
    var req = {
      id: id, version: 1, created: at, status: 'waiting', user_id: p.id, user_name: p.name, lang: p.lang || lang,
      mode: v.mode, start_date: v.start_date, days: days, meals_per_day: meals, meals_usual: num((p.cooking || {}).meals_per_day) || 3,
      budget_total: bt, budget_per_day: P.r(bt / days, 2), location: loc, wishes: v.wishes.trim(),
      cook: v.mode === 'cook' ? { cart_shop: v.cart_shop, max_cook_min_per_day: num(v.max_cook_min) } : null,
      order: v.mode === 'order' ? { max_delivery_min: num(v.max_delivery_min) } : null,
      eatout: v.mode === 'eatout' ? { max_walk_min: num(v.max_walk_min) || (loc && loc.walk_limit_min) || 15 } : null,
      targets: { protein_g: tg.protein_g, kcal: tg.kcal, mode: tg.mode, protein_g_per_kg: tg.protein_g_per_kg, weight_kg: newestWeight(u.history) },
      weights: St.clone(p.weights || P.DEFAULT_WEIGHTS), cards: myCards(p), cards_named: myCards(p).map(function (k) { return { key: k, name: cardName(k) }; }),
      accounts: St.clone(p.accounts || []), basket_fill: St.clone(p.basket_fill || { kosik: false, tesco: false }), likes: p.likes || '', dislikes: p.dislikes || '', allergies: p.allergies || '',
      rules: { cart_only_never_pay: true, replan_if_cart_off_pct: S().settings.replan_pct, stale_days: S().settings.stale_days, planner_version: P.VERSION }
    };
    St.writeRequest(req);
    dropDraft(key);
    go('request', id, { flash: '<strong>' + h(t('sent_title')) + '</strong> ' + h(t('sent_next')) });
  }

  // =========================================================
  // REQUESTS and RESULTS
  // =========================================================
  function myRequests() {
    var u = me(); if (!u) return [];
    return Object.keys(S().requests).map(function (k) { return S().requests[k]; }).filter(function (r) { return r.user_id === u.profile.id; })
      .sort(function (a, b) { return (isoMs(b.created) || 0) - (isoMs(a.created) || 0) || (a.id < b.id ? 1 : -1); });
  }
  function reqState(r) {
    var res = S().results[r.id];
    if (r.status === 'cancelled') return { k: 'cancelled', text: t('st_cancelled') };
    if (res && res.status === 'error') return { k: 'error', text: t('st_error', { time: fmtTime(res.finished) }) };
    if (res) return { k: 'done', text: t('st_done', { time: fmtTime(res.finished) }) };
    return { k: 'waiting', text: t('st_waiting', { since: sinceText(r.created) }) };
  }
  function reqTitle(r) {
    return t('mode_' + r.mode) + ' · ' + tp('n_days', r.days) + ' · ' + (r.location ? r.location.name : '–') + ' · ' + fmtDate(r.start_date);
  }
  function vRequests() {
    var rs = myRequests();
    var out = '<section class="card"><h2>' + h(t('requests_title')) + '</h2><p class="gist">' + h(t('requests_gist')) + '</p>';
    if (!rs.length) out += '<p>' + h(t('no_requests')) + ' <button type="button" data-view="plan">' + h(t('nav_plan')) + '</button></p>';
    out += '<ul class="list">' + rs.map(function (r) {
      var s = reqState(r);
      return '<li id="rq-' + h(r.id) + '"><button type="button" class="linkrow" data-act="open-request" data-id="' + h(r.id) + '"><strong>' + h(reqTitle(r)) + '</strong>' +
        '<span class="st ' + s.k + '" data-since="' + h(r.created) + '" data-req="' + h(r.id) + '">' + h(s.text) + '</span></button></li>';
    }).join('') + '</ul></section>';
    return out;
  }
  function vRequest() {
    var r = S().requests[viewArg];
    if (!r) return '<section class="card"><p class="error">' + h(t('request_missing')) + '</p></section>';
    var s = reqState(r), res = S().results[r.id];
    var out = '<section class="card"><h2>' + h(reqTitle(r)) + '</h2><p class="gist"><span class="st ' + s.k + '" data-since="' + h(r.created) + '" data-req="' + h(r.id) + '">' + h(s.text) + '</span></p>' +
      '<dl class="facts"><dt>' + h(t('targets')) + '</dt><dd>' + h(t('per_day_targets', { p: fmt(r.targets.protein_g), k: fmt(r.targets.kcal) })) + '</dd>' +
      '<dt>' + h(t('f_budget_this')) + '</dt><dd>' + h(czk(r.budget_total)) + ' (' + h(t('budget_per_day_is', { b: czk(r.budget_per_day) })) + ')</dd>' +
      '<dt>' + h(t('f_meals')) + '</dt><dd>' + h(r.meals_per_day) + '</dd>' +
      (r.wishes ? '<dt>' + h(t('f_wishes')) + '</dt><dd>' + h(r.wishes) + '</dd>' : '') +
      '<dt>' + h(t('request_file')) + '</dt><dd><code>MealPlanner\\data\\requests\\' + h(r.id) + '.json</code></dd></dl>';
    if (s.k === 'waiting') out += '<div class="next"><h3>' + h(t('next_title')) + '</h3><ol><li>' + h(t('next_1')) + '</li><li>' + h(t('next_2')) + '</li><li>' + h(t('next_3')) + '</li></ol>' +
      '<button type="button" class="ghost" data-act="cancel-request" data-id="' + h(r.id) + '">' + h(t('cancel_request')) + '</button></div>';
    if (res) out += resultHtml(r, res);
    return out + '</section>';
  }
  function resultHtml(r, res) {
    try { return resultHtmlInner(r, res); } catch (e) { console.warn('result file', e); return '<p class="error" role="alert">' + h(t('result_unreadable', { id: r.id })) + '</p>'; }
  }
  function resultHtmlInner(r, res) {
    if (res.status === 'error') return '<div class="error" role="alert"><strong>' + h(t('run_error')) + '</strong> ' + h(res.error || '') + '</div>';
    var opts = (Array.isArray(res.options) ? res.options : []).filter(function (o) { return o && typeof o === 'object'; });
    if (!opts.length) return '<p>' + h(t('no_options')) + '</p>';
    var ctx = { targets: resultTargets(r, res), weights: r.weights, cards: r.cards, budget_per_day: r.budget_per_day };
    var sc = P.score(opts, ctx), byId = {};
    sc.ranked.forEach(function (x) { byId[x.id] = x; });
    var agree = res.scored ? JSON.stringify(res.scored.ranked) === JSON.stringify(sc.ranked) && JSON.stringify(res.scored.picks) === JSON.stringify(sc.picks) : null;
    var optById = {}; opts.forEach(function (o) { optById[o.id] = o; });
    var stale = S().settings.stale_days, out = '';
    out += updatesBanner(r, res);
    var tu = res.targets_used; // session 4: Order online and Eat out plan only the meals asked for (2 of 4 meals = half the day's targets)
    if (tu && typeof tu.share === 'number' && tu.share < 1) out += '<p class="muted">' + h(t('targets_meals', { p: fmt(tu.protein_g), k: fmt(tu.kcal), m: tu.meals, u: tu.meals_usual })) + '</p>';
    out += '<p class="muted">' + (agree === true ? h(t('maths_agree')) : agree === false ? '<span class="warn">' + h(t('maths_differ')) + '</span>' : h(t('maths_app_only'))) + '</p>';
    // 2026-11-08: one option that wins two picks (cheapest AND best balance) is shown once, with both labels
    var pickOrder = [], pickLabels = {};
    ['cheapest', 'fastest', 'balance'].forEach(function (k) {
      var id = sc.picks[k]; if (!optById[id]) return;
      if (!pickLabels[id]) { pickLabels[id] = []; pickOrder.push({ id: id, k: k }); }
      pickLabels[id].push(t('pick_' + k));
    });
    out += '<h3>' + h(t('three_options')) + '</h3><div class="grid picks">' + pickOrder.map(function (p) {
      var o = optById[p.id], x = byId[p.id];
      return '<article class="pick" id="pick-' + p.k + '-' + h(p.id) + '"><h4>' + pickLabels[p.id].map(function (l) { return '<span class="picklabel">' + h(l) + '</span>'; }).join(' ') + '</h4>' + optionCard(o, x, r, stale) + '</article>';
    }).join('') + opts.filter(function (o) { // session 3: the option whose cart Claude filled is always shown, even when it is not one of the three picks
      return o.cart && o.cart.filled === true && byId[o.id] && byId[o.id].rank && [sc.picks.cheapest, sc.picks.fastest, sc.picks.balance].indexOf(o.id) < 0;
    }).map(function (o) {
      return '<article class="pick" id="pick-cart-' + h(o.id) + '"><h4>' + h(t('pick_cart')) + '</h4>' + optionCard(o, byId[o.id], r, stale) + '</article>';
    }).join('') + '</div>';
    out += '<h3>' + h(t('all_options', { n: opts.length })) + '</h3><div class="tablewrap"><table><thead><tr><th>#</th><th>' + h(t('col_option')) + '</th><th>' + h(t('col_score')) + '</th><th>' + h(t('col_cost_day')) + '</th><th>' + h(t('col_without_card')) + '</th><th>' + h(t('col_protein')) + '</th><th>' + h(t('col_kcal')) + '</th><th>' + h(t('col_p100')) + '</th><th>' + h(t('col_minutes')) + '</th><th>' + h(t('col_distance')) + '</th><th>' + h(t('col_label')) + '</th></tr></thead><tbody>' +
      sc.ranked.map(function (x) {
        var o = optById[x.id], old = o.price_seen && daysSince(o.price_seen) > stale;
        return '<tr' + (old ? ' class="stale"' : '') + '><td>' + (x.rank || '') + '</td><td>' + h(o.label) + '<br><small>' + h(tk('kind_', o.kind, 'other')) + (o.shop ? ' · ' + h(o.shop) : '') + '</small></td><td><strong>' + fmt(x.total, 0) + '</strong><br><small>' + h(t('score_parts', { a: fmt(x.s_price), b: fmt(x.s_speed), c: fmt(x.s_taste), d: fmt(x.s_time) })) + '</small></td>' +
          '<td>' + czkK(x.cost_per_day) + flagsHtml(x.flags) + '</td><td>' + czkK(x.cost_regular === null || x.cost_regular === undefined ? null : x.cost_regular / (o.days || 1)) + '</td><td>' + fmtK(o.protein_g_per_day, 0, ' g') + '</td><td>' + fmtK(o.kcal_per_day) + '</td><td>' + fmtK(x.protein_per_100czk, 1, ' g') + '</td>' +
          '<td>' + fmtK(o.minutes_per_day) + '</td><td>' + (distHtml(o) || h(t('not_known'))) + '</td><td>' + h(tk('label_', o.nutrition_label, 'estimate')) + (o.price_seen ? '<br><small>' + h(t('price_seen', { d: fmtDate(o.price_seen) })) + '</small>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    out += '<p class="muted">' + h(t('score_how', { a: sc.weights_used.price, b: sc.weights_used.speed, c: sc.weights_used.taste, d: sc.weights_used.time })) + '</p>';
    // 2026-11-08: every other option as a card too (its shopping list, Pick, Copy), folded under its name and price a day
    var shown = {}; pickOrder.forEach(function (p) { shown[p.id] = true; });
    opts.forEach(function (o) { if (o.cart && o.cart.filled === true && byId[o.id] && byId[o.id].rank) shown[o.id] = true; });
    var others = sc.ranked.filter(function (x) { return !shown[x.id] && optById[x.id] && x.rank; });
    if (others.length) out += '<h3>' + h(t('other_options', { n: others.length })) + '</h3><div class="others">' + others.map(function (x) {
      var o = optById[x.id];
      return '<details class="pick other" id="other-' + h(o.id) + '"><summary><strong>' + h(o.label) + '</strong> · ' + czkK(x.cost_per_day) + ' ' + h(t('per_day_short')) + '</summary>' + optionCard(o, x, r, stale) + '</details>';
    }).join('') + '</div>';
    return out;
  }
  function resultTargets(r, res) {
    var tu = res && res.targets_used;
    return tu && typeof tu.protein_g === 'number' && typeof tu.kcal === 'number' ? { protein_g: tu.protein_g, kcal: tu.kcal } : r.targets;
  }
  function flagsHtml(f) { return (f || []).map(function (x) { return '<br><small class="warn">' + h(tk('flag_', x, 'other')) + '</small>'; }).join(''); }
  function distHtml(o) {
    var a = [];
    if (o.distance_m !== undefined && o.distance_m !== null) a.push(fmt(o.distance_m / 1000, 1) + ' km');
    if (o.walk_min) a.push(t('walk_n', { n: o.walk_min }));
    if (o.transit_min) a.push(t('transit_n', { n: o.transit_min }));
    if (o.delivery_min) a.push(t('delivery_n', { n: o.delivery_min }));
    return h(a.join(' · '));  // empty when nothing is known (2026-11-08: no dangling dash after "35 min a day")
  }
  // Result screens (2026-11-08): an unknown number says so in words, never a dash
  function czkK(n) { return n === null || n === undefined || isNaN(n) ? h(t('not_known')) : czk(n); }
  function fmtK(n, d, unit) { return n === null || n === undefined || isNaN(n) ? h(t('not_known')) : fmt(n, d) + (unit || ''); }
  function packText(it) {
    if (it.unit === 'pcs' && it.pieces) return t('pack_pcs', { n: it.pieces });
    if (typeof it.pack_g === 'number') return fmt(it.pack_g >= 1000 && it.pack_g % 100 === 0 ? it.pack_g / 1000 : it.pack_g, it.pack_g >= 1000 && it.pack_g % 100 === 0 ? (it.pack_g % 1000 ? 1 : 0) : 0) + ' ' + (it.pack_g >= 1000 && it.pack_g % 100 === 0 ? (it.unit === 'ml' ? 'l' : 'kg') : (it.unit === 'ml' ? 'ml' : 'g'));
    return '';
  }
  function signed(n, d, unit, same) { if (Math.abs(n) < Math.pow(10, -d) / 2) return t(same); var v = fmt(Math.abs(n), d) + unit; return n < 0 ? t('diff_less', { v: v }) : '+' + v; }
  function saleText(it) {
    if (typeof it.sale_pct !== 'number' || !(it.sale_pct > 0)) return '';
    var head = typeof it.regular_price === 'number' ? t('sale_line', { pct: fmt(it.sale_pct), reg: czk(it.regular_price) }) : t('sale_line_short', { pct: fmt(it.sale_pct) });
    return head + ' ' + (it.sale_until ? t('sale_until', { d: fmtDate(it.sale_until) }) : t('sale_until_unknown'));
  }
  /* The shopping list of one option (2026-11-08): open, one row per product, with what to search in that shop, pack, packs,
     price, the sale as the shop gave it, a link, and the backup for the same food. Old results without these fields show
     what they have. Plain text for "Copy shopping list" comes from listText(). */
  function shoppingList(o) {
    var items = (o.items || []).filter(function (it) { return it && typeof it === 'object'; });
    if (!items.length) return '';
    var dish = o.kind === 'order' || o.kind === 'eatout';
    var rows = items.map(function (it) {
      var url = safeUrl(it.url), name = h(it.search || it.name);
      var mixed = it.shop && o.shop && String(o.shop).indexOf('+') >= 0;
      var head = '<span class="sl-qty">' + h(it.packs ? it.packs + ' ×' : '') + '</span> <span class="sl-name">' + (url ? '<a href="' + h(url) + '" target="_blank" rel="noopener">' + name + '</a>' : name) + '</span>' + (mixed ? ' · ' + h(it.shop) : '');
      var facts = [];
      var pk = packText(it); if (pk) facts.push(pk);
      if (typeof it.price === 'number') facts.push(t('per_pack', { p: czk(it.price) }));
      if (typeof it.cost === 'number') facts.push(t('line_total', { c: czk(it.cost) }) + (typeof it.cost_with_card === 'number' && it.card ? ' (' + t('with_card', { c: czk(it.cost_with_card), card: cardName(it.card) }) + ')' : ''));
      var nut = dish && typeof it.protein_g === 'number' && typeof it.kcal === 'number' && it.packs_per_day ?
        h(t('dish_nutrition', { p: fmt(it.protein_g / it.packs_per_day, 1), k: fmt(it.kcal / it.packs_per_day), l: tk('label_', it.nutrition_label, 'estimate') })) : '';
      var sale = saleText(it), out = '<li class="sl-row"' + (it.basis ? ' title="' + h(it.basis) + '"' : '') + '><div>' + head + '</div>' +
        (facts.length ? '<div class="sl-facts">' + h(facts.join(' · ')) + '</div>' : '') + (nut ? '<div class="sl-facts">' + nut + '</div>' : '') +
        (sale ? '<div class="sl-sale">' + h(sale) + '</div>' : '');
      (Array.isArray(it.sold_out_instead) ? it.sold_out_instead : []).forEach(function (x) { if (x && x.name) out += '<div class="sl-note">' + h(t('sold_out_first', { name: x.name })) + '</div>'; });
      var b = it.backup;
      if (b && typeof b === 'object' && b.name) {
        var bu = safeUrl(b.url), bn = h(b.search || b.name), bits = [];
        if (b.packs) bits.push(b.packs + ' × ' + (packText(b) || ''));
        if (typeof b.cost_diff === 'number') bits.push(signed(b.cost_diff, 2, ' CZK', 'same_price'));
        if (typeof b.protein_diff_g === 'number') bits.push(signed(b.protein_diff_g, 1, ' g ' + t('protein_word'), 'same_protein'));
        var bs = saleText(b);
        out += '<div class="sl-backup"><strong>' + h(t('backup_if_out')) + '</strong> ' + (bu ? '<a href="' + h(bu) + '" target="_blank" rel="noopener">' + bn + '</a>' : bn) +
          (bits.length ? ' · ' + h(bits.join(' · ')) : '') + (bs ? ' · ' + h(bs) : '') + '</div>';
      } else if (b === null && !dish) out += '<div class="sl-note">' + h(t('backup_none')) + '</div>';
      return out + '</li>';
    }).join('');
    var tot = items.reduce(function (a, it) { return a + (typeof it.cost === 'number' ? it.cost : 0); }, 0);
    return '<section class="slist" id="list-' + h(o.id) + '" aria-label="' + h(t('shopping_list')) + '"><h5>' + h(t(dish ? 'dish_list' : 'shopping_list')) + ' · ' + h(tp('n_items', items.length)) + ' · ' + czk(tot) + '</h5><ul>' + rows + '</ul></section>';
  }
  function listText(o, r) {
    var L = [t('shopping_list') + ': ' + o.label + ' (' + tp('n_days', o.days || r.days || 1) + ')'];
    (o.items || []).forEach(function (it) {
      var line = '- ' + (it.packs ? it.packs + ' × ' : '') + (it.search || it.name);
      var pk = packText(it); if (pk) line += ' (' + pk + ')';
      if (typeof it.cost === 'number') line += ', ' + czk(it.cost);
      var sale = saleText(it); if (sale) line += '. ' + sale;
      if (safeUrl(it.url)) line += '\n  ' + safeUrl(it.url);
      var b = it.backup;
      if (b && b.name) line += '\n  ' + t('backup_if_out') + ' ' + (b.search || b.name) + (b.packs ? ', ' + b.packs + ' × ' + (packText(b) || '') : '') +
        (typeof b.cost_diff === 'number' ? ', ' + signed(b.cost_diff, 2, ' CZK', 'same_price') : '') + (typeof b.protein_diff_g === 'number' ? ', ' + signed(b.protein_diff_g, 1, ' g ' + t('protein_word'), 'same_protein') : '') +
        (safeUrl(b.url) ? '\n  ' + safeUrl(b.url) : '');
      L.push(line);
    });
    var tot = (o.items || []).reduce(function (a, it) { return a + (typeof it.cost === 'number' ? it.cost : 0); }, 0);
    L.push(t('list_total', { c: czk(tot) }));
    if (o.cart && o.cart.filled === true) L.push(t('cart_filled_line'));
    return L.join('\n');
  }
  function copyText(text) {
    var done = function () { showToast(t('list_copied')); };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    fallbackCopy(text); done();
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { /* the text stays selectable */ } ta.remove();
  }
  function optionCard(o, x, r, stale) {
    var old = o.price_seen && daysSince(o.price_seen) > stale, days = o.days || 1;
    var saved = r.cards.length && x.cost_mine < x.cost_regular;
    var out = '<p class="gist"><strong>' + h(o.label) + '</strong></p><p class="big">' + czk(x.cost_per_day) + ' <small>' + h(t('per_day_short')) + '</small></p>' +
      '<p class="muted">' + h(t('cost_lines', { mine: czk(x.cost_mine), reg: czk(x.cost_regular), all: czk(x.cost_all_cards), d: tp('n_days', days) })) + (saved ? ' ' + h(t('card_saves', { s: czk(x.cost_regular - x.cost_mine) })) : '') + '</p>' +
      '<ul class="facts-s"><li>' + h(t('protein_kcal_day', { p: fmt(o.protein_g_per_day), k: fmt(o.kcal_per_day) })) + ' (' + h(tk('label_', o.nutrition_label, 'estimate')) + ')</li>' +
      '<li>' + h(t('minutes_day', { n: fmtK(o.minutes_per_day) })) + (distHtml(o) ? ' · ' + distHtml(o) : '') + '</li>' +
      (o.delivery_fee !== undefined && o.delivery_fee !== null ? '<li>' + h(t('delivery_fee_min', { f: czk(o.delivery_fee), m: o.min_order ? czk(o.min_order) : t('not_known') })) + '</li>' : '') +
      '<li' + (old ? ' class="stale"' : '') + '>' + h(o.price_seen ? t('price_seen', { d: fmtDate(o.price_seen) }) : t('price_seen_unknown')) + (old ? ' · ' + h(t('stale_note', { n: stale })) : '') + '</li>' +
      (o.cart && o.cart.filled === true && typeof o.cart.cart_total_ours === 'number' ? '<li><strong>' + h(t('cart_filled_sum', { t: czk(o.cart.cart_total_ours) })) + '</strong> ' + h(t('cart_filled_line')) + '</li>' : '') + '</ul>' + flagsHtml(x.flags) +
      shoppingList(o) +
      (typeof o.notes === 'string' && o.notes.trim() ? '<p class="muted"><small>' + h(t('opt_notes')) + ': ' + h(o.notes) + '</small></p>' : '') +
      ((o.recipes && o.recipes.length) ? '<details><summary>' + h(t('recipes_n', { n: o.recipes.length })) + '</summary>' +
        (o.recipes || []).map(function (rc) { return '<p><strong>' + h(rc.name) + '</strong>' + (rc.minutes ? ' · ' + h(t('minutes_n', { n: rc.minutes })) : '') + (rc.steps ? '<br>' + h(rc.steps) : '') + '</p>'; }).join('') + '</details>' : '') +
      '<div class="row"><button type="button" class="primary" data-act="pick" data-req="' + h(r.id) + '" data-opt="' + h(o.id) + '">' + h(t('pick_this')) + '</button>' +
      ((o.items || []).length ? '<button type="button" data-act="copy-list" data-req="' + h(r.id) + '" data-opt="' + h(o.id) + '">' + h(t('copy_list')) + '</button>' : '') +
      (o.cart && safeUrl(o.cart.url) ? '<a class="btn' + (o.cart.filled ? ' cartbtn' : '') + '" href="' + h(safeUrl(o.cart.url)) + '" target="_blank" rel="noopener">' + h(t(o.cart.filled ? 'open_cart_pay' : 'open_shop')) + '</a>' : '') +
      (safeUrl(o.route_url) ? '<a class="btn" href="' + h(safeUrl(o.route_url)) + '" target="_blank" rel="noopener">' + h(t('open_route')) + '</a>' : '') + '</div>';
    return out;
  }
  function updatesBanner(r, res) {
    var ids = {}; (res.options || []).forEach(function (o) { (o.items || []).forEach(function (it) { if (it.id) ids[it.id] = true; }); });
    // the same line as the watch's phone message: watch_pct (5 %) or sold out; the newest change per product counts (files are read oldest first)
    var lim = Number(S().settings.watch_pct) > 0 ? Number(S().settings.watch_pct) : 5, byFood = {};
    // by moment, not by text: "02:10+01:00" is later than "02:40+02:00" (25/10/2026), and by time, not file name (-2 files)
    var fin = isoMs(res.finished);
    var ups = (S().updates || []).slice().sort(function (a, b) { return (isoMs(a.created) || 0) - (isoMs(b.created) || 0) || (String(a._file) < String(b._file) ? -1 : 1); });
    ups.forEach(function (u) {
      var cr = isoMs(u.created);
      if (fin !== null && (cr === null || cr <= fin)) return;  // not provably newer than the result: ignore
      (u.changes || []).forEach(function (c) {
        var mine = !!ids[c.food_id]; (Array.isArray(c.item_ids) ? c.item_ids : []).forEach(function (x) { if (ids[x]) mine = true; });
        if (mine) byFood[c.food_id || JSON.stringify(c.item_ids)] = c;
      });
    });
    var hits = Object.keys(byFood).map(function (k) { return byFood[k]; }).filter(function (c) { return Math.abs(Number(c.pct) || 0) >= lim || c.sold_out === true; });
    if (!hits.length) return '';
    var big = null; hits.forEach(function (c) { var p = Number(c.pct); if (isFinite(p) && Math.abs(p) >= lim && (big === null || Math.abs(p) > Math.abs(big))) big = p; });
    var txt = big === null ? t('prices_sold_out', { n: tp('n_items', hits.length) }) : t('prices_changed', { n: tp('n_items', hits.length), pct: fmt(big, 1) });
    return '<div class="bar warnbar" role="status">' + h(txt) + ' <button type="button" data-act="replan" data-id="' + h(r.id) + '">' + h(t('replan')) + '</button></div>';
  }
  function pickOption(reqId, optId) {
    var u = me(), r = S().requests[reqId], res = S().results[reqId]; if (!u || !r || !res) return;
    var o = (res.options || []).filter(function (x) { return x.id === optId; })[0]; if (!o) return;
    var sc = P.score(res.options, { targets: resultTargets(r, res), weights: r.weights, cards: r.cards, budget_per_day: r.budget_per_day });
    var x = sc.ranked.filter(function (y) { return y.id === optId; })[0];
    var pid = St.nextCode(u.history, 'plans', 'P');
    var c = St.commit(u.profile.id, 'plan_picked', [{ file: 'history', path: 'plans#' + pid, value: { id: pid, request_id: reqId, option_id: optId, label: o.label, kind: o.kind || null,
      shop: o.shop || null, days: o.days || r.days, start_date: r.start_date, cost_per_day: x.cost_per_day, cost_total: x.cost_mine, picked_at: St.nowIso() } }]);
    var cartUrl = o.cart && o.cart.filled === true ? safeUrl(o.cart.url) : null;
    var btns = ' <button type="button" data-act="copy-list" data-req="' + h(reqId) + '" data-opt="' + h(optId) + '">' + h(t('copy_list')) + '</button>' +
      (cartUrl ? ' <a class="btn cartbtn" href="' + h(cartUrl) + '" target="_blank" rel="noopener">' + h(t('open_cart_pay')) + '</a>' : '');
    var fl = h(t('picked_list', { label: o.label })) + btns;
    go('request', reqId, { flash: fl, keepBack: true, focus: 'list-' + optId });
    var od = document.getElementById('other-' + optId); if (od) { od.open = true; var li = document.getElementById('list-' + optId); if (li) li.scrollIntoView({ block: 'center' }); }
    showToast(t('picked_list', { label: o.label }), c ? c.id + '|' + u.profile.id : null, btns);
  }
  function copyList(reqId, optId) {
    var r = S().requests[reqId], res = S().results[reqId];
    var o = res && (res.options || []).filter(function (x) { return x.id === optId; })[0];
    if (r && o) copyText(listText(o, r));
  }

  // =========================================================
  // HISTORY and CHARTS
  // =========================================================
  function vHistory() {
    var u = me(); if (!u) return vProfiles();
    var hi = u.history, key = 'history:' + u.profile.id;
    var d = draft(key, function () { return { w_date: St.today(), w_kg: '', s_date: St.today(), s_czk: '', s_shop: '', s_note: '', n_date: St.today(), n_text: '' }; }, { k: 'draft_history', v: { name: u.profile.name } }, 'history:'), v = d.values;
    var out = '<section class="card" data-form="' + h(key) + '"><h2>' + h(t('history_title', { name: u.profile.name })) + '</h2><p class="gist">' + h(t('history_gist')) + '</p>';
    out += '<h3>' + h(t('weight_chart')) + '</h3>' + weightChart(u) + '<h3>' + h(t('spend_chart')) + '</h3>' + spendChart(u);
    out += '<div class="grid three">';
    out += '<div><h3>' + h(t('add_weighin')) + '</h3><div class="field"><label for="hi-w_date">' + h(t('f_date')) + '</label><input id="hi-w_date" name="w_date" type="date" value="' + h(v.w_date) + '" max="' + St.today() + '"></div>' +
      '<div class="field"><label for="hi-w_kg">' + h(t('f_kg')) + '</label><input id="hi-w_kg" name="w_kg" inputmode="decimal" value="' + h(v.w_kg) + '" placeholder="68,4" autocomplete="off"></div>' +
      '<div id="hi-w-err" class="error" role="alert"></div><button type="button" class="primary" data-act="add-weighin">' + h(t('add')) + '</button></div>';
    out += '<div><h3>' + h(t('add_spend')) + '</h3><div class="field"><label for="hi-s_date">' + h(t('f_date')) + '</label><input id="hi-s_date" name="s_date" type="date" value="' + h(v.s_date) + '" max="' + St.today() + '"></div>' +
      '<div class="field"><label for="hi-s_czk">' + h(t('f_czk')) + '</label><input id="hi-s_czk" name="s_czk" inputmode="decimal" value="' + h(v.s_czk) + '" autocomplete="off"></div>' +
      '<div class="field"><label for="hi-s_shop">' + h(t('f_where')) + '</label><input id="hi-s_shop" name="s_shop" value="' + h(v.s_shop) + '" placeholder="Rohlík, Lidl…" autocomplete="off"></div>' +
      '<div class="field"><label for="hi-s_note">' + h(t('f_note')) + '</label><input id="hi-s_note" name="s_note" value="' + h(v.s_note) + '" autocomplete="off"></div>' +
      '<div id="hi-s-err" class="error" role="alert"></div><button type="button" class="primary" data-act="add-spend">' + h(t('add')) + '</button></div>';
    out += '<div><h3>' + h(t('add_note')) + '</h3><div class="field"><label for="hi-n_date">' + h(t('f_date')) + '</label><input id="hi-n_date" name="n_date" type="date" value="' + h(v.n_date) + '" max="' + St.today() + '"></div>' +
      '<div class="field"><label for="hi-n_text">' + h(t('f_note')) + '</label><textarea id="hi-n_text" name="n_text" rows="3">' + h(v.n_text) + '</textarea></div>' +
      '<div id="hi-n-err" class="error" role="alert"></div><button type="button" class="primary" data-act="add-note">' + h(t('add')) + '</button></div></div>';
    function rows(listName, cols) {
      var L = (hi[listName] || []).slice().sort(function (a, b) { return (b.date || b.picked_at || '') < (a.date || a.picked_at || '') ? -1 : 1; });
      if (!L.length) return '<p class="muted">' + h(t('nothing_yet')) + '</p>';
      return '<ul class="list">' + L.map(function (x) {
        return '<li id="hi-' + h(x.id) + '"><span>' + cols(x) + '</span> <button type="button" class="ghost small" data-act="hist-remove" data-list="' + listName + '" data-id="' + h(x.id) + '">' + h(t('remove')) + '</button></li>';
      }).join('') + '</ul>';
    }
    out += '<div class="grid two"><div><h3>' + h(t('weighins')) + '</h3>' + rows('weighins', function (x) { return h(fmtDate(x.date)) + ' · <strong>' + fmt(x.kg, 1) + ' kg</strong>'; }) + '</div>' +
      '<div><h3>' + h(t('spend')) + '</h3>' + rows('spend', function (x) { return h(fmtDate(x.date)) + ' · <strong>' + czk(x.czk) + '</strong> ' + h(x.shop || '') + (x.note ? ' · ' + h(x.note) : ''); }) + '</div>' +
      '<div><h3>' + h(t('plans_chosen')) + '</h3>' + rows('plans', function (x) { return h(fmtDate(x.picked_at)) + ' · ' + h(x.label) + ' · ' + czk(x.cost_per_day) + ' ' + h(t('per_day_short')); }) + '</div>' +
      '<div><h3>' + h(t('notes')) + '</h3>' + rows('notes', function (x) { return h(fmtDate(x.date)) + ' · ' + h(x.text); }) + '</div></div>';
    return out + '</section>';
  }
  function addHist(listName, prefix, item, errId, label) {
    var u = me(); if (!u) return;
    var id = St.nextCode(u.history, listName, prefix); item.id = id;
    var c = St.commit(u.profile.id, label, [{ file: 'history', path: listName + '#' + id, value: item }]);
    var key = 'history:' + u.profile.id, d = drafts[key];
    if (d) {
      if (listName === 'weighins') d.values.w_kg = '';
      if (listName === 'spend') { d.values.s_czk = ''; d.values.s_shop = ''; d.values.s_note = ''; }
      if (listName === 'notes') d.values.n_text = '';
      d.typed = ['w_kg', 's_czk', 's_shop', 's_note', 'n_text'].some(function (k) { return d.values[k]; });
      saveDrafts();
    }
    render();
    showToast(t('added_' + listName), c ? c.id + '|' + u.profile.id : null);
  }
  function svgWrap(w, hgt, body, title) { return '<figure class="chart"><svg viewBox="0 0 ' + w + ' ' + hgt + '" role="img" aria-label="' + h(title) + '">' + body + '</svg></figure>'; }
  function dnum(iso) { var p = iso.slice(0, 10).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000; }
  function weightChart(u) {
    var ws = (u.history.weighins || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var g = u.profile.goal || {}, gl = g.type === 'gain' ? P.goalLine(g, g.start_kg, g.start_date) : null;
    if (!ws.length) return '<p class="muted">' + h(t('no_weighins')) + '</p>';
    var xs = ws.map(function (w) { return dnum(w.date); }), ys = ws.map(function (w) { return w.kg; });
    if (gl) { xs.push(dnum(gl.from.date), dnum(gl.to.date)); ys.push(gl.from.kg, gl.to.kg); }
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.floor(Math.min.apply(null, ys) - 1), y1 = Math.ceil(Math.max.apply(null, ys) + 1);
    if (x1 === x0) x1 = x0 + 1;
    var W = 640, H = 220, L = 48, R = 12, T = 12, B = 30;
    function X(d) { return L + (d - x0) / (x1 - x0) * (W - L - R); }
    function Y(k) { return T + (y1 - k) / (y1 - y0) * (H - T - B); }
    var b = '<line class="ax" x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '"/><line class="ax" x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '"/>' +
      '<text class="lbl" x="' + (L - 6) + '" y="' + (Y(y1) + 4) + '" text-anchor="end">' + y1 + '</text><text class="lbl" x="' + (L - 6) + '" y="' + (Y(y0) + 4) + '" text-anchor="end">' + y0 + ' kg</text>' +
      '<text class="lbl" x="' + L + '" y="' + (H - 8) + '">' + h(fmtDate(new Date(x0 * 86400000).toISOString())) + '</text><text class="lbl" x="' + (W - R) + '" y="' + (H - 8) + '" text-anchor="end">' + h(fmtDate(new Date(x1 * 86400000).toISOString())) + '</text>';
    if (gl) b += '<line class="goal" x1="' + X(dnum(gl.from.date)) + '" y1="' + Y(gl.from.kg) + '" x2="' + X(dnum(gl.to.date)) + '" y2="' + Y(gl.to.kg) + '"/><rect class="goalend" x="' + (X(dnum(gl.to.date)) - 4) + '" y="' + (Y(gl.to.kg) - 4) + '" width="8" height="8"/>';
    b += '<polyline class="line" points="' + ws.map(function (w) { return X(dnum(w.date)) + ',' + Y(w.kg); }).join(' ') + '"/>' + ws.map(function (w) { return '<circle class="dot" cx="' + X(dnum(w.date)) + '" cy="' + Y(w.kg) + '" r="4"><title>' + h(fmtDate(w.date) + ': ' + fmt(w.kg, 1) + ' kg') + '</title></circle>'; }).join('');
    var legend = '<p class="legend"><span class="k line"></span> ' + h(t('legend_weight')) + (gl ? ' <span class="k goal"></span> ' + h(t('legend_goal', { kg: fmt(gl.to.kg, 1), d: fmtDate(gl.to.date) })) : '') + '</p>';
    var last = ws[ws.length - 1], first = ws[0], wk = (dnum(last.date) - dnum(first.date)) / 7;
    var rate = wk > 0 ? (last.kg - first.kg) / wk : null;
    return svgWrap(W, H, b, t('weight_chart')) + legend + (rate !== null ? '<p class="muted">' + h(t('rate_so_far', { r: fmt(rate, 2), pct: fmt(rate / first.kg * 100, 2) })) + (rate / first.kg * 100 > 0.5 ? ' <span class="warn">' + h(t('warn_rate_above_0_5')) + '</span>' : '') + '</p>' : '');
  }
  function monday(iso) { var d = dnum(iso), wd = (new Date(d * 86400000).getUTCDay() + 6) % 7; return new Date((d - wd) * 86400000).toISOString().slice(0, 10); }
  function spendChart(u) {
    var sp = u.history.spend || []; if (!sp.length) return '<p class="muted">' + h(t('no_spend')) + '</p>';
    var weeks = {}; sp.forEach(function (s) { var m = monday(s.date); weeks[m] = (weeks[m] || 0) + (s.czk || 0); });
    var lastWeek = Object.keys(weeks).sort().pop(), thisWeek = monday(St.today()), endW = lastWeek > thisWeek ? lastWeek : thisWeek, ks = [], wi;
    for (wi = 11; wi >= 0; wi--) { var wkd = P.addDays(endW, -7 * wi); ks.push(wkd); if (weeks[wkd] === undefined) weeks[wkd] = 0; }
    var bud = budgetPerDay(u.profile), wb = bud !== null ? bud * 7 : null;
    var mx = Math.max.apply(null, ks.map(function (k) { return weeks[k]; }).concat(wb || 0)) * 1.1 || 1;
    var W = 640, H = 220, L = 56, R = 12, T = 12, B = 30, bw = (W - L - R) / ks.length;
    function Y(v) { return T + (1 - v / mx) * (H - T - B); }
    var b = '<line class="ax" x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '"/><text class="lbl" x="' + (L - 6) + '" y="' + (T + 8) + '" text-anchor="end">' + fmt(mx, 0) + '</text><text class="lbl" x="' + (L - 6) + '" y="' + (H - B) + '" text-anchor="end">0</text>';
    ks.forEach(function (k, i) {
      var v = weeks[k], over = wb !== null && v > wb;
      var bwid = Math.max(2, Math.min(56, bw - 8));
      b += '<rect class="bar' + (over ? ' over' : '') + '" x="' + (L + i * bw + (bw - bwid) / 2) + '" y="' + Y(v) + '" width="' + bwid + '" height="' + (H - B - Y(v)) + '"><title>' + h(t('week_of', { d: fmtDate(k) }) + ': ' + czk(v)) + '</title></rect>' +
        '<text class="lbl" x="' + (L + i * bw + bw / 2) + '" y="' + (H - 10) + '" text-anchor="middle">' + h(k.slice(8, 10) + '.' + k.slice(5, 7) + '.') + '</text>';
    });
    if (wb !== null) b += '<line class="goal" x1="' + L + '" y1="' + Y(wb) + '" x2="' + (W - R) + '" y2="' + Y(wb) + '"/>';
    return svgWrap(W, H, b, t('spend_chart')) + '<p class="legend"><span class="k bar"></span> ' + h(t('legend_spend')) + (wb !== null ? ' <span class="k goal"></span> ' + h(t('legend_budget', { b: czk(wb) })) : '') + ' <span class="k over"></span> ' + h(t('legend_over')) + '</p>';
  }

  // =========================================================
  // FOODS and SHOPS (filled by Claude through tools/foods.py; read-only here)
  // =========================================================
  var foodQuery = { q: '', shop: '' };
  function vFoods() {
    var f = S().foods, items = (f && f.items) || [];
    var shops = {}; items.forEach(function (x) { shops[x.shop] = true; });
    var out = '<section class="card"><h2>' + h(t('foods_title')) + '</h2><p class="gist">' + h(t('foods_gist')) + '</p>';
    if (f && f.error) out += '<p class="error">' + h(t('foods_broken')) + '</p>';
    if (!items.length) return out + '<p class="muted">' + h(t('foods_empty')) + '</p></section>';
    out += '<div class="row"><div class="field grow"><label for="food-q">' + h(t('search')) + '</label><input id="food-q" type="search" value="' + h(foodQuery.q) + '" placeholder="' + h(t('ph_food_search')) + '" autocomplete="off"></div>' +
      '<div class="field"><label for="food-shop">' + h(t('f_shop')) + '</label><select id="food-shop"><option value="">' + h(t('all_shops')) + '</option>' +
      Object.keys(shops).sort().map(function (s) { return '<option value="' + h(s) + '"' + (foodQuery.shop === s ? ' selected' : '') + '>' + h(s) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="tablewrap"><table><thead><tr><th>' + h(t('col_product')) + '</th><th>' + h(t('col_price')) + '</th><th>' + h(t('col_card_price')) + '</th><th>' + h(t('col_pack')) + '</th><th>' + h(t('col_p100g')) + '</th><th>' + h(t('col_k100g')) + '</th><th>' + h(t('col_p100')) + '</th><th>' + h(t('col_label')) + '</th></tr></thead><tbody id="food-rows">' + foodRows() + '</tbody></table></div>';
    return out + '</section>';
  }
  function foodRows() {
    var items = (S().foods && S().foods.items) || [], u = me(), cards = u ? myCards(u.profile) : [], q = fold(foodQuery.q).trim(), stale = S().settings.stale_days;
    var words = q ? q.split(/\s+/) : [];
    var L = items.filter(function (x) {
      if (foodQuery.shop && x.shop !== foodQuery.shop) return false;
      var hay = fold(x.name + ' ' + (x.category || '') + ' ' + x.shop + ' ' + x.id);
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    if (!L.length) return '<tr><td colspan="8">' + h(t('no_match')) + '</td></tr>';
    return L.map(function (x) {
      var m = P.foodMetrics(x, cards), n = x.per100g || {}, old = x.seen && daysSince(x.seen) > stale;
      var lp = (x.loyalty || []).map(function (l) { return czk(l.price) + ' (' + h(cardName(l.card)) + (cards.indexOf(l.card) >= 0 ? ', ' + h(t('yours')) : '') + ')'; }).join('<br>');
      return '<tr' + (old ? ' class="stale"' : '') + '><td>' + (safeUrl(x.url) ? '<a href="' + h(safeUrl(x.url)) + '" target="_blank" rel="noopener">' + h(x.name) + '</a>' : h(x.name)) + '<br><small>' + h(x.shop) + ' · ' + h(t('price_seen', { d: fmtDate(x.seen) })) + (old ? ' · ' + h(t('stale_note', { n: stale })) : '') + '</small></td>' +
        '<td>' + czk(x.price) + '<br><small>' + h(tk('plabel_', x.price_label, 'online')) + '</small></td><td>' + (lp || '–') + '</td><td>' + fmt(x.pack_g) + ' ' + h(x.unit === 'ml' ? 'ml' : 'g') + '</td>' +
        '<td>' + fmt(n.protein, 1) + '</td><td>' + fmt(n.kcal) + '</td><td>' + (m ? fmt(m.protein_per_100czk, 1) + ' g' : '–') + '</td><td>' + h(tk('label_', x.nutrition_label, 'none')) + '</td></tr>';
    }).join('');
  }
  // Walking-time bands (his rule, 19/10/2026): 10 min or less = near (green), 11-20 = mid, 21-30 = far,
  // over 30 or not measured = tram/bus. Colour, a symbol AND a word, so it reads without colour too.
  var BANDS = [{ k: 'near', sym: '●', max: 10 }, { k: 'mid', sym: '◐', max: 20 }, { k: 'far', sym: '○', max: 30 }, { k: 'transit', sym: '⇄', max: Infinity }];
  function bandOf(w) { if (typeof w !== 'number' || !isFinite(w) || w < 0) return BANDS[3]; for (var i = 0; i < BANDS.length; i++) if (w <= BANDS[i].max) return BANDS[i]; return BANDS[3]; }
  function bandBadge(s) {
    var b = bandOf(s.walk_min), w = typeof s.walk_min === 'number' && isFinite(s.walk_min) && s.walk_min >= 0;
    var txt = w ? t('minutes_n', { n: fmt(s.walk_min) }) + (typeof s.distance_m === 'number' && s.distance_m >= 0 ? ', ' + (s.distance_m < 100 ? '< ' + fmt(0.1, 1) : fmt(s.distance_m / 1000, 1)) + ' km' : '') : t('walk_not_measured');
    return '<span class="band band-' + b.k + '" title="' + h(t('band_' + b.k)) + '"><span aria-hidden="true">' + b.sym + '</span> ' + h(txt) + '</span><br><small>' + h(t('band_' + b.k)) + '</small>';
  }
  function bandLegend(place) {
    return '<p class="legend bands">' + h(t('band_legend', { p: place })) + ' ' + BANDS.map(function (b) {
      return '<span class="band band-' + b.k + '"><span aria-hidden="true">' + b.sym + '</span> ' + h(t('band_' + b.k)) + '</span>';
    }).join(' ') + '</p>';
  }
  function numOk(x) { return typeof x === 'number' && isFinite(x) && x >= 0; }
  function deliveryTime(s) {
    var d = s.delivery_min;
    if (Array.isArray(d) && d.length === 2 && numOk(d[0]) && numOk(d[1])) return t('range_min', { a: fmt(d[0]), b: fmt(d[1]) });
    if (numOk(d)) return t('minutes_n', { n: fmt(d) });
    return s.closed_at_check === true ? t('delivery_time_unknown') : t('delivery_slot');
  }
  // Opening hours are stored in English short form ("Mo–Fr 07:00–20:00, Sa–Su closed"); Czech screen translates the words.
  var DAYS_CS = { Mo: 'Po', Tu: 'Út', We: 'St', Th: 'Čt', Fr: 'Pá', Sa: 'So', Su: 'Ne' };
  function hoursText(x) {
    if (typeof x !== 'string' || !x) return '–';
    if (lang !== 'cs') return x;
    return x.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, function (m) { return DAYS_CS[m]; }).replace(/\bclosed\b/g, 'zavřeno').replace(/\band\b/g, 'a');
  }
  function shopName(s) {
    var u = safeUrl(s.website), n = h(s.name || s.chain || '');
    return '<strong>' + (u ? '<a href="' + h(u) + '" target="_blank" rel="noopener">' + n + '</a>' : n) + '</strong>' + (s.address ? '<br><small>' + h(s.address) + '</small>' : '') +
      (s.note ? '<br><small class="muted">' + h(s.note) + '</small>' : '');
  }
  function cardCell(s) { return s.card ? h(cardName(s.card)) : '–'; }
  function vShops() {
    var sh = S().shops, out = '<section class="card"><h2>' + h(t('shops_title')) + '</h2><p class="gist">' + h(t('shops_gist')) + '</p>';
    if (sh && sh.error) return out + '<p class="error">' + h(t('shops_broken')) + '</p></section>';
    var locs = (sh && sh.locations) || {}, names = Object.keys(locs);
    if (!names.length) return out + '<p class="muted">' + h(t('shops_empty')) + '</p></section>';
    names.forEach(function (ln) {
      var L = locs[ln] || {}, all = Array.isArray(L.shops) ? L.shops.filter(function (s) { return s && typeof s === 'object'; }) : [], place = L.name || ln;
      var rank = { near: 0, mid: 1, far: 2, transit: 3 };
      var key = function (s) { var b = bandOf(s.walk_min).k, m = b === 'transit' ? s.transit_min : s.walk_min; return [rank[b], numOk(m) ? m : 999]; };
      var inPerson = all.filter(function (s) { return s.kind !== 'delivery'; }).sort(function (a, b) {
        var x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1];
      });
      var delivered = all.filter(function (s) { return s.kind === 'delivery'; });
      out += '<h3>' + h(place) + '</h3><p class="muted">' + h(t('surveyed', { d: fmtDate(L.surveyed) })) + (L.address ? ' · ' + h(L.address) : '') + '</p>';
      out += '<h4 class="shops-h">' + h(t('shops_inperson', { n: inPerson.length })) + '</h4>' + bandLegend(place) +
        '<div class="tablewrap"><table class="shops"><thead><tr><th>' + h(t('col_shop')) + '</th><th>' + h(t('col_walk')) + '</th><th>' + h(t('col_transit')) + '</th><th>' + h(t('col_hours')) + '</th><th>' + h(t('col_prices_online')) + '</th><th>' + h(t('col_card')) + '</th></tr></thead><tbody>' +
        (inPerson.length ? inPerson.map(function (s) {
          var r = safeUrl(s.route_url);
          var closed = isoOk(s.closed_seen);
          return '<tr class="row-' + bandOf(s.walk_min).k + (closed ? ' stale' : '') + '"><td>' + shopName(s) + (closed ? '<br><small class="warn">' + h(t('closed_seen', { d: fmtDate(s.closed_seen) })) + '</small>' : '') + '</td><td>' + bandBadge(s) + (r ? '<br><a href="' + h(r) + '" target="_blank" rel="noopener">' + h(t('route_link')) + '</a>' : '') + '</td><td>' +
            (numOk(s.transit_min) ? h(t('minutes_n', { n: fmt(s.transit_min) })) : '–') + '</td><td>' + h(hoursText(s.hours)) + '</td><td>' + h(tk('prices_online_', s.prices_online, 'unknown')) + '</td><td>' + cardCell(s) + '</td></tr>';
        }).join('') : '<tr><td colspan="6">' + h(t('no_match')) + '</td></tr>') + '</tbody></table></div><p class="muted"><small>' + h(t('transit_when')) + '</small></p>';
      out += '<h4 class="shops-h">' + h(t('shops_delivered', { p: place, n: delivered.length })) + '</h4>' +
        '<div class="tablewrap"><table class="shops"><thead><tr><th>' + h(t('col_service')) + '</th><th>' + h(t('col_delivery_time')) + '</th><th>' + h(t('col_fee')) + '</th><th>' + h(t('col_min_order')) + '</th><th>' + h(t('col_prices_online')) + '</th><th>' + h(t('col_card')) + '</th></tr></thead><tbody>' +
        (delivered.length ? delivered.map(function (s) {
          var fee = numOk(s.delivery_fee) ? czk(s.delivery_fee) : numOk(s.fee_seen) ? t('fee_seen', { f: czk(s.fee_seen), d: fmtDate(s.seen) }) : t('fee_in_cart');
          if (numOk(s.service_fee_pct)) fee += ' ' + t('service_fee', { p: fmt(s.service_fee_pct), m: numOk(s.service_fee_min) ? czk(s.service_fee_min) : '–' });
          return '<tr><td>' + shopName(s) + (s.via ? '<br><small>' + h(t('via', { v: s.via })) + '</small>' : '') + '</td><td>' + h(deliveryTime(s)) + '</td><td>' + h(fee) + '</td><td>' + (numOk(s.min_order) ? czk(s.min_order) : h(t(s.min_checked === false ? 'not_checked' : 'fee_in_cart'))) + '</td><td>' +
            h(tk('prices_online_', s.prices_online, 'unknown')) + '</td><td>' + cardCell(s) + '</td></tr>';
        }).join('') : '<tr><td colspan="6">' + h(t('no_match')) + '</td></tr>') + '</tbody></table></div>';
    });
    return out + '</section>';
  }

  // =========================================================
  // SETTINGS
  // =========================================================
  function vSettings() {
    var u = me(), out = '<section class="card"><h2>' + h(t('settings_title')) + '</h2>' + (WEB ? window.MPWeb.moreHtml() : '');
    out += '<h3>' + h(t('language')) + '</h3><p>' + h(t('language_help')) + '</p>';
    if (u) {
      var key = 'weights:' + u.profile.id, w = u.profile.weights || P.DEFAULT_WEIGHTS;
      var wbase = JSON.stringify(w);
      var d = draft(key, function () { return { price: str(w.price), speed: str(w.speed), taste: str(w.taste), time: str(w.time) }; }, { k: 'draft_weights', v: { name: u.profile.name } }, 'settings:', wbase), v = d.values;
      if (staleBase(d, wbase)) out += '<div class="bar warnbar" role="status">' + h(t('form_base_changed')) + ' <button type="button" data-act="draft-discard" data-key="' + h(key) + '">' + h(t('load_current')) + '</button></div>';
      var sum = ['price', 'speed', 'taste', 'time'].reduce(function (a, k) { return a + (num(v[k]) || 0); }, 0);
      out += '<div data-form="' + h(key) + '"><h3>' + h(t('weights_title', { name: u.profile.name })) + '</h3><p class="gist">' + h(t('weights_gist')) + '</p><div class="formgrid">' +
        ['price', 'speed', 'taste', 'time'].map(function (k) {
          return '<div class="field"><label for="wt-' + k + '">' + h(t('w_' + k)) + '</label><input id="wt-' + k + '" name="' + k + '" inputmode="numeric" value="' + h(v[k]) + '" autocomplete="off"><small>' + h(t('w_' + k + '_help')) + '</small></div>';
        }).join('') + '</div><p id="wt-sum" class="' + (sum === 100 ? 'muted' : 'warn') + '">' + h(t('weights_sum', { n: fmt(sum) })) + '</p>' +
        '<div id="wt-err" class="error" role="alert"></div><div class="row"><button type="button" class="primary" data-act="save-weights">' + h(t('save')) + '</button><button type="button" class="ghost" data-act="weights-default">' + h(t('weights_default')) + '</button></div></div>';
    }
    var s = S().settings;
    out += '<h3>' + h(t('rules_title')) + '</h3><ul><li>' + h(t('rule_stale', { n: s.stale_days })) + '</li><li>' + h(t('rule_replan', { n: s.replan_pct })) + '</li><li>' + h(t('rule_watch', { n: s.watch_pct })) + '</li><li>' + h(t('rule_cart')) + '</li><li>' + h(t('rule_card')) + '</li></ul>';
    if (WEB) out += window.MPWeb.settingsHtml(); else out += '<h3>' + h(t('folder_title')) + '</h3><p>' + h(t('folder_now', { name: St.folderName() })) + '</p><p><button type="button" data-act="pick-folder">' + h(t('pick_folder_again')) + '</button> <button type="button" data-act="reload">' + h(t('reload_folder')) + '</button></p>';
    if (u) {
      var L = u.changes.list.slice().reverse().slice(0, 60);
      out += '<h3 id="changes">' + h(t('changes_title', { name: u.profile.name })) + '</h3><p class="gist">' + h(t('changes_gist')) + '</p><ul class="list changes">' + L.map(function (c) {
        var lab = t('ch_' + c.label) + (c.undo_of ? ' (' + t('undo_of', { id: c.undo_of }) + ')' : '');
        return '<li id="ch-' + h(c.id) + '"><span><strong>' + h(lab) + '</strong> · ' + h(fmtTime(c.at)) + ' · ' + h(c.who) + ' · <code>' + h(c.id) + '</code>' +
          (c.ops.length ? '<br><small>' + h(c.ops.map(function (o) { return o.path; }).filter(function (p) { return p && p.charAt(0) !== '_'; }).slice(0, 6).join(', ')) + '</small>' : '') +
          (c.undone_by ? '<br><small>' + h(t('undone_by', { id: c.undone_by })) + '</small>' : '') + '</span>' +
          (!c.undone_by && !c.no_undo ? '<button type="button" class="small" data-act="undo" data-change="' + h(c.id + '|' + u.profile.id) + '">' + h(t('undo')) + '</button>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    out += '<h3>' + h(t('sources_title')) + '</h3><p class="gist">' + h(t('sources_gist')) + '</p><ul class="refs">' + SOURCES.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>' +
      '<p class="note">' + h(t('not_medical')) + '</p></section>';
    return out;
  }
  var DRI_LINKS = { protein: 'https://www.ncbi.nlm.nih.gov/books/NBK56068/table/summarytables.t4/', report: 'https://doi.org/10.17226/10490' };
  var SOURCES = [
    'Institute of Medicine. (2005). <i>Dietary Reference Intakes for energy, carbohydrate, fiber, fat, fatty acids, cholesterol, protein, and amino acids</i>. The National Academies Press. <a href="https://doi.org/10.17226/10490" target="_blank" rel="noopener">https://doi.org/10.17226/10490</a> (protein RDA in g per kg by life stage; Estimated Energy Requirement equations; pregnancy and lactation additions. Used for every protein and energy target since 5 Nov 2026.)',
    'Institute of Medicine. (2011). Dietary Reference Intakes: Recommended Dietary Allowances and Adequate Intakes, total water and macronutrients [Summary table]. In <i>Dietary Reference Intakes for calcium and vitamin D</i>. The National Academies Press. <a href="https://www.ncbi.nlm.nih.gov/books/NBK56068/table/summarytables.t4/" target="_blank" rel="noopener">https://www.ncbi.nlm.nih.gov/books/NBK56068/table/summarytables.t4/</a>',
    'Food and Agriculture Organization of the United Nations. (2004). <i>Human energy requirements: Report of a Joint FAO/WHO/UNU Expert Consultation</i> (Food and Nutrition Technical Report Series No. 1), Chapter 5, Tables 5.1 and 5.3. <a href="https://www.fao.org/4/y5686e/y5686e07.htm" target="_blank" rel="noopener">https://www.fao.org/4/y5686e/y5686e07.htm</a> <small>(activity levels 1.53, 1.76, 2.25)</small>',
    'Iraki, J., Fitschen, P., Espinar, S., &amp; Helms, E. (2019). Nutrition recommendations for bodybuilders in the off-season: A narrative review. <i>Sports, 7</i>(7), 154. <a href="https://doi.org/10.3390/sports7070154" target="_blank" rel="noopener">https://doi.org/10.3390/sports7070154</a> <small>(protein 1.6–2.2 g/kg, surplus 10–20 %, gain 0.25–0.5 % of body weight a week)</small>',
    'Jäger, R., Kerksick, C. M., Campbell, B. I., Cribb, P. J., Wells, S. D., Skwiat, T. M., Purpura, M., Ziegenfuss, T. N., Ferrando, A. A., Arent, S. M., Smith-Ryan, A. E., Stout, J. R., Arciero, P. J., Ormsbee, M. J., Taylor, L. W., Wilborn, C. D., Kalman, D. S., Kreider, R. B., Willoughby, D. S., . . . Antonio, J. (2017). International Society of Sports Nutrition position stand: Protein and exercise. <i>Journal of the International Society of Sports Nutrition, 14</i>, 20. <a href="https://doi.org/10.1186/s12970-017-0177-8" target="_blank" rel="noopener">https://doi.org/10.1186/s12970-017-0177-8</a> <small>(1.4–2.0 g/kg)</small>',
    'Mifflin, M. D., St Jeor, S. T., Hill, L. A., Scott, B. J., Daugherty, S. A., &amp; Koh, Y. O. (1990). A new predictive equation for resting energy expenditure in healthy individuals. <i>The American Journal of Clinical Nutrition, 51</i>(2), 241–247. <a href="https://doi.org/10.1093/ajcn/51.2.241" target="_blank" rel="noopener">https://doi.org/10.1093/ajcn/51.2.241</a> <small>(resting energy)</small>',
    'Morton, R. W., Murphy, K. T., McKellar, S. R., Schoenfeld, B. J., Henselmans, M., Helms, E., Aragon, A. A., Devries, M. C., Banfield, L., Krieger, J. W., &amp; Phillips, S. M. (2018). A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. <i>British Journal of Sports Medicine, 52</i>(6), 376–384. <a href="https://doi.org/10.1136/bjsports-2017-097608" target="_blank" rel="noopener">https://doi.org/10.1136/bjsports-2017-097608</a> <small>(no extra muscle above 1.62 g/kg)</small>'
  ];

  // =========================================================
  // EVENTS
  // =========================================================
  function act(name, el) {
    if (WEB && window.MPWeb.act(name, el)) return;
    var u = me();
    switch (name) {
      case 'pick-folder':
        St.pick().then(afterLoad, function (e) { var m = connectError(e); if (St.folderName()) { if (m) showToast(m); } else showConnect('none', m); });
        break;
      case 'allow-again':
        St.askAgain().then(function (s) { if (s === 'granted') afterLoad(); else showConnect('prompt', t('allow_denied')); }, function (e) { showConnect('prompt', connectError(e)); });
        break;
      case 'reload':
        St.reload().then(function () { showToast(t('reloaded')); render(); });
        break;
      case 'new-user': go('profile-edit', null); break;
      case 'edit-user': go('profile-edit', el.dataset.id); break;
      case 'use-user': useUser(el.dataset.id); break;
      case 'unhide-user': {
        var c0 = St.commit(el.dataset.id, 'profile_shown', [{ file: 'profile', path: 'hidden', value: false }]);
        showToast(t('profile_shown'), c0 ? c0.id + '|' + el.dataset.id : null); render(); break;
      }
      case 'hide-user': {
        var id = el.dataset.id, c1 = St.commit(id, 'profile_hidden', [{ file: 'profile', path: 'hidden', value: true }]);
        if (St.ME.userId === id) { St.ME.userId = null; St.setSetting('last_user', null); }
        dropDraft('profile:' + id);
        showToast(t('profile_hidden'), c1 ? c1.id + '|' + id : null); go('profiles'); break;
      }
      case 'pf-add': {
        var d = drafts[pfKey()]; if (!d) break;
        var ln = el.dataset.list, L = d.values[ln];
        if (ln === 'locations') L.push({ id: null, name: '', address: '', walk_limit_min: '15' });
        if (ln === 'accounts') L.push({ id: null, shop: 'rohlik', account_name: '', email: '' });
        if (ln === 'cards_other') L.push({ name: '' });
        d.typed = true; saveDrafts(); render();
        var first = document.getElementById('pf-' + ln + '-' + (L.length - 1) + '-' + (ln === 'accounts' ? 'shop' : 'name'));
        if (first) first.focus();
        break;
      }
      case 'pf-remove': {
        var d2 = drafts[pfKey()]; if (!d2) break;
        d2.values[el.dataset.list].splice(Number(el.dataset.i), 1); d2.typed = true; saveDrafts(); render(); break;
      }
      case 'pf-save': saveProfile(); break;
      case 'pf-cancel': dropDraft(pfKey()); go('profiles'); break;
      case 'pf-cancel-reload': dropDraft(pfKey()); render(); break;
      case 'mode': {
        var d3 = drafts[reqKey()]; if (!d3) break;
        d3.values.mode = el.dataset.mode; d3.typed = true; saveDrafts(); render();
        var mb = document.getElementById('mode-' + el.dataset.mode); if (mb) mb.focus();
        break;
      }
      case 'send': sendRequest(); break;
      case 'rq-clear': dropDraft(reqKey()); render(); break;
      case 'open-request': go('request', el.dataset.id, { backTo: { view: 'requests', title: t('requests_title'), focus: 'rq-' + el.dataset.id, scroll: window.scrollY } }); break;
      case 'cancel-request': {
        var r = S().requests[el.dataset.id]; if (!r) break;
        St.cancelRequest(r.id); render(); break;
      }
      case 'replan': {
        var r2 = S().requests[el.dataset.id]; if (!r2 || !u) break;
        drafts[reqKey()] = { values: { mode: r2.mode, start_date: St.today() > r2.start_date ? St.today() : r2.start_date, days: String(r2.days), meals: String(r2.meals_per_day), budget_total: String(r2.budget_total),
          location_id: r2.location ? r2.location.id : '', wishes: r2.wishes, cart_shop: r2.cook ? r2.cook.cart_shop : 'auto', max_cook_min: r2.cook ? String(r2.cook.max_cook_min_per_day) : '30',
          max_delivery_min: r2.order ? String(r2.order.max_delivery_min) : '45', max_walk_min: r2.eatout ? String(r2.eatout.max_walk_min) : '' }, typed: true, label: { k: 'draft_request', v: { name: u.profile.name } }, where: 'plan:' };
        saveDrafts(); go('plan'); break;
      }
      case 'pick': pickOption(el.dataset.req, el.dataset.opt); break;
      case 'copy-list': copyList(el.dataset.req, el.dataset.opt); break;
      case 'add-weighin': {
        var hv = drafts['history:' + u.profile.id].values, kg = num(hv.w_kg);
        var we = []; if (!hv.w_date || hv.w_date > St.today()) we.push(t('f_date')); if (kg === null || kg < 30 || kg > 300) we.push(t('f_kg') + ' ' + rng(30, 300));
        if (we.length) { $('#hi-w-err').textContent = t('missing_fields', { list: we.join(', ') }); break; }
        addHist('weighins', 'W', { date: hv.w_date, kg: kg, note: '' }, 'hi-w-err', 'weighin_added'); break;
      }
      case 'add-spend': {
        var sv = drafts['history:' + u.profile.id].values, cz = num(sv.s_czk);
        var se = []; if (!sv.s_date || sv.s_date > St.today()) se.push(t('f_date')); if (cz === null || cz <= 0) se.push(t('f_czk'));
        if (se.length) { $('#hi-s-err').textContent = t('missing_fields', { list: se.join(', ') }); break; }
        addHist('spend', 'S', { date: sv.s_date, czk: cz, shop: sv.s_shop.trim(), note: sv.s_note.trim() }, 'hi-s-err', 'spend_added'); break;
      }
      case 'add-note': {
        var nv = drafts['history:' + u.profile.id].values;
        if (!nv.n_date || !nv.n_text.trim()) { $('#hi-n-err').textContent = t('missing_fields', { list: t('f_date') + ', ' + t('f_note') }); break; }
        addHist('notes', 'N', { date: nv.n_date, text: nv.n_text.trim() }, 'hi-n-err', 'note_added'); break;
      }
      case 'hist-remove': {
        var c2 = St.commit(u.profile.id, 'removed_' + el.dataset.list, [{ file: 'history', path: el.dataset.list + '#' + el.dataset.id, value: null }]);
        render(); showToast(t('removed'), c2 ? c2.id + '|' + u.profile.id : null); break;
      }
      case 'save-weights': {
        var wk = 'weights:' + u.profile.id, wv = drafts[wk].values, nw = {}, bad = [];
        ['price', 'speed', 'taste', 'time'].forEach(function (k) { var x = num(wv[k]); if (x === null || x < 0 || x > 100) bad.push(t('w_' + k) + ' (0–100)'); nw[k] = x; });
        if (!bad.length && nw.price + nw.speed + nw.taste + nw.time <= 0) bad.push(t('weights_zero'));
        if (bad.length) { $('#wt-err').textContent = t('missing_fields', { list: bad.join(', ') }); break; }
        var c3 = St.commit(u.profile.id, 'weights_saved', ['price', 'speed', 'taste', 'time'].map(function (k) { return { file: 'profile', path: 'weights.' + k, value: nw[k] }; }));
        dropDraft(wk); render(); showToast(c3 ? t('weights_saved') : t('nothing_changed'), c3 ? c3.id + '|' + u.profile.id : null); break;
      }
      case 'weights-default': {
        var wk2 = 'weights:' + u.profile.id;
        drafts[wk2].values = { price: '40', speed: '30', taste: '20', time: '10' }; drafts[wk2].typed = true; saveDrafts(); render(); break;
      }
      case 'undo': {
        var parts = el.dataset.change.split('|'), res = St.undo(parts[1], parts[0]);
        if (!res.ok) {
          var msg = res.why === 'MP_LATER_CHANGE' ? t('undo_blocked', { label: t('ch_' + res.blocker.label), time: fmtTime(res.blocker.at), id: res.blocker.id }) : t('undo_' + res.why);
          showToast(msg);
        } else { showToast(t('undone')); render(); }
        break;
      }
      case 'toast-close': $('#toast').hidden = true; break;
      case 'draft-continue': {
        var dk = el.dataset.key, w = drafts[dk].where.split(':'), pre = dk.split(':')[0], uid = dk.split(':')[1];
        if (/^(request|history|weights)$/.test(pre) && uid !== St.ME.userId && S().users[uid]) { St.ME.userId = uid; St.setSetting('last_user', uid); }
        go(w[0], w[1] || null); break;
      }
      case 'draft-discard': dropDraft(el.dataset.key); render(); break;
      case 'back': {
        var b = backTo; backTo = null; go(b.view, b.arg || null, { focus: b.focus, scroll: b.scroll }); break;
      }
    }
  }
  function useUser(id) {
    St.ME.userId = id; St.setSetting('last_user', id);
    var p = S().users[id].profile;
    if (p.lang && p.lang !== lang) { lang = p.lang; St.setSetting('lang', lang); lsSet('mealplanner:lang', lang); }
    go('plan');
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button, a');
    if (!b || b.disabled) return;
    if (b.dataset.lang) { lang = b.dataset.lang; lsSet('mealplanner:lang', lang); if (St.folderName()) { St.setSetting('lang', lang); render(); } else if (WEB) { renderHeader(); window.MPWeb.redraw(); } else { renderHeader(); showConnectAgain(); } return; }
    if (b.dataset.view) { go(b.dataset.view); return; }
    if (b.dataset.act) { e.preventDefault(); act(b.dataset.act, b); }
  });
  var connectState = 'none';
  function showConnectAgain() { showConnect(connectState); }
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'userpick') { if (el.value) useUser(el.value); return; }
    if (el.id === 'food-shop') { foodQuery.shop = el.value; var rows = $('#food-rows'); if (rows) rows.innerHTML = foodRows(); return; }
    formInput(el, true);
  });
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.id === 'food-q') { foodQuery.q = el.value; var rows = $('#food-rows'); if (rows) rows.innerHTML = foodRows(); return; }
    if (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date') return; // handled on change
    formInput(el, false);
  });
  function formInput(el, isChange) {
    var f = el.closest('[data-form]'); if (!f || !el.name) return;
    var key = f.dataset.form;
    if (key.indexOf('profile:') === 0) { onProfileInput(el); return; }
    var d = drafts[key]; if (!d) return;
    var before = d.values[el.name];
    d.values[el.name] = el.value; d.typed = true; saveDrafts();
    if (key.indexOf('request:') === 0 && isChange && (el.name === 'location_id' || el.name === 'days') && before !== el.value) render();
    if (key.indexOf('weights:') === 0) {
      var sum = ['price', 'speed', 'taste', 'time'].reduce(function (a, k) { return a + (num(d.values[k]) || 0); }, 0), s = $('#wt-sum');
      if (s) { s.textContent = t('weights_sum', { n: fmt(sum) }); s.className = sum === 100 ? 'muted' : 'warn'; }
    }
  }
  // Esc never throws typing away (there are no pop-up windows; this stops browser defaults on forms too).
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && e.target.closest && e.target.closest('[data-form]')) e.preventDefault(); });
  window.addEventListener('beforeunload', function (e) {
    if (St.hasUnsaved() || typedDrafts().length) { e.preventDefault(); e.returnValue = ''; return ''; }
  });

  St.on(function (ev) {
    if (ev === 'status') renderStatus();
  });

  // Every 30 s: read what Claude wrote (results, updates, foods) and update only the small status texts,
  // never the box being typed in.
  setInterval(function () {
    if (!St.folderName()) return;
    $$('.st[data-since]').forEach(function (el) { var r = S().requests[el.dataset.req]; if (r) { var s = reqState(r); el.textContent = s.text; el.className = 'st ' + s.k; } });
    var before = JSON.stringify(Object.keys(S().results).sort()) + (S().foods && S().foods.updated) + S().updates.length;
    St.refreshShared().then(function () {
      var now = JSON.stringify(Object.keys(S().results).sort()) + (S().foods && S().foods.updated) + S().updates.length;
      if (now === before) return;
      var a = document.activeElement, typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
      if (!typing && /^(requests|request|foods|shops)$/.test(view)) render();
      else showToast(t('new_from_claude'));
    });
  }, 30000);

  // ---------- start ----------
  function boot() {
    lang = lsGet('mealplanner:lang') || ((navigator.language || '').indexOf('cs') === 0 ? 'cs' : 'en');
    if (WEB) { renderHeader(); window.MPWeb.start(); return; }  // web app: home page and account first (app/js/web.js)
    renderHeader();
    if (!St.hasFolderApi()) { showConnect('none'); return; }
    St.reconnect().then(function (s) { connectState = s; if (s === 'granted') afterLoad(); else showConnect(s); }, function (e) { showConnect('none', connectError(e)); });
  }
  window.MPApp = { t: t, go: go, state: function () { return { view: view, viewArg: viewArg, lang: lang, drafts: drafts }; },
    // hooks for the web app (app/js/web.js)
    h: h, fmt: fmt, render: render, renderHeader: renderHeader, afterLoad: afterLoad, showToast: showToast, me: me, lsGet: lsGet, lsSet: lsSet,
    setLang: function (l) { lang = l; }, getLang: function () { return lang; },
    useDrafts: function (key) { DRAFTS_KEY = key; var d = lsGet(key); drafts = d && typeof d === 'object' ? d : {}; },
    typedDrafts: typedDrafts, targetsExplain: targetsExplain, targetsOf: targetsOf, newestWeight: newestWeight };
  boot();
})();
