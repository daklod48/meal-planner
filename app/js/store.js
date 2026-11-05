/* Meal Planner. Folder access, the data in memory, the ONE place that changes data (commit), undo, saving.
   Rules (TO-BUILD-AN-APP.md section 2): commit logs who/when/old/new and is undoable; undo is a new change and refuses
   when a later change built on the same field; codes are never reused (trash kept); save = one at a time, read back and
   compare the hash before saying "saved", refuse to overwrite a file changed by someone else. */
(function (root) {
  'use strict';
  var test = root.__MP_TEST__ || {};
  var rootDir = null, dataDir = null;
  var known = {};      // path -> sha256 of the text last read or written by this window
  var dirty = {};      // path -> true
  var saving = false, saveTimer = null, listeners = [];
  var status = { state: 'idle', at: null, error: null, pending: 0 };
  var S = { settings: null, users: {}, requests: {}, results: {}, updates: [], foods: null, shops: null };
  var ME = { userId: null };

  function emit(ev, x) { listeners.forEach(function (f) { try { f(ev, x); } catch (e) { console.error(e); } }); }
  function on(f) { listeners.push(f); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function err(code, extra) { var e = new Error(code); e.code = code; if (extra) e.extra = extra; return e; }

  // ---------- time ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function nowIso() {
    var d = test.now ? new Date(test.now) : new Date(), off = -d.getTimezoneOffset(), s = off >= 0 ? '+' : '-';
    off = Math.abs(off);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + s + pad(Math.floor(off / 60)) + ':' + pad(off % 60);
  }
  function today() { return nowIso().slice(0, 10); }

  // ---------- hashing ----------
  function sha(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }

  // ---------- IndexedDB: remember the folder between visits ----------
  function idb(mode, fn) {
    return new Promise(function (res, rej) {
      var o = indexedDB.open('mealplanner', 1);
      o.onupgradeneeded = function () { o.result.createObjectStore('kv'); };
      o.onerror = function () { rej(o.error); };
      o.onsuccess = function () {
        var tx = o.result.transaction('kv', mode), st = tx.objectStore('kv'), rq = fn(st);
        tx.oncomplete = function () { res(rq && rq.result); o.result.close(); };
        tx.onerror = function () { rej(tx.error); };
      };
    });
  }
  function rememberFolder(h) { return idb('readwrite', function (st) { return st.put(h, 'root'); }).catch(function () {}); }
  function savedFolder() { return idb('readonly', function (st) { return st.get('root'); }).catch(function () { return null; }); }

  // ---------- folder ----------
  function hasFolderApi() { return !!(root.showDirectoryPicker || test.dir || test.dirPromise); }
  function checkRoot(h) {
    return h.getDirectoryHandle('app').then(function () { return h; }, function () {
      if (h.name === 'app' || h.name === 'data') throw err('MP_PICKED_INNER', h.name);
      throw err('MP_NOT_MEALPLANNER', h.name);
    });
  }
  function use(h) {
    rootDir = h;
    return h.getDirectoryHandle('data', { create: true }).then(function (d) { dataDir = d; return loadAll(); });
  }
  function pick() {
    var p = test.dir ? Promise.resolve(test.dir) : root.showDirectoryPicker({ id: 'mealplanner', mode: 'readwrite' });
    return p.then(checkRoot).then(function (h) { if (!test.dir) rememberFolder(h); return use(h); });
  }
  // 'granted' (loaded), 'prompt' (needs a click), 'none' (never picked)
  function reconnect() {
    if (test.dirPromise && !test.dir) return test.dirPromise.then(function (d) { test.dir = d; return reconnect(); });
    if (test.dir) return use(test.dir).then(function () { return 'granted'; });
    return savedFolder().then(function (h) {
      if (!h) return 'none';
      return h.queryPermission({ mode: 'readwrite' }).then(function (p) {
        if (p === 'granted') return use(h).then(function () { return 'granted'; });
        return 'prompt';
      });
    });
  }
  function askAgain() {
    return savedFolder().then(function (h) {
      if (!h) return 'none';
      return h.requestPermission({ mode: 'readwrite' }).then(function (p) {
        if (p !== 'granted') return 'denied';
        return use(h).then(function () { return 'granted'; });
      });
    });
  }
  function folderName() { return rootDir ? rootDir.name : null; }

  // ---------- files (paths are relative to data/, with /) ----------
  function dirOf(parts, create) {
    var p = Promise.resolve(dataDir);
    parts.forEach(function (name) { p = p.then(function (d) { return d.getDirectoryHandle(name, { create: !!create }); }); });
    return p;
  }
  function split(path) { var a = path.split('/'); return { dirs: a.slice(0, -1), name: a[a.length - 1] }; }
  function readText(path) {
    var s = split(path);
    return dirOf(s.dirs, false).then(function (d) { return d.getFileHandle(s.name); })
      .then(function (fh) { return fh.getFile(); })
      .then(function (f) { return f.text(); })
      .catch(function (e) { if (e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return null; throw e; });
  }
  function readJSON(path, remember) {
    return readText(path).then(function (t) {
      if (t === null) return null;
      var obj;
      try { obj = JSON.parse(t); } catch (e) { throw err('MP_BAD_JSON', path); }
      if (!remember) return obj;
      return sha(t).then(function (h) { known[path] = h; return obj; });
    });
  }
  function list(dirParts) {
    return dirOf(dirParts, false).then(function (d) {
      var out = [], it = d.entries();
      function next() { return it.next().then(function (r) { if (r.done) return out; out.push({ name: r.value[0], kind: r.value[1].kind }); return next(); }); }
      return next();
    }).catch(function (e) { if (e && e.name === 'NotFoundError') return []; throw e; });
  }
  function writeText(path, text) {
    var s = split(path);
    return readText(path).then(function (cur) {
      if (cur === null) { if (known[path]) throw err('MP_FILE_GONE', path); return null; }
      return sha(cur).then(function (h) { if (known[path] !== h) throw err('MP_CHANGED_OUTSIDE', path); });
    }).then(function () { return dirOf(s.dirs, true); })
      .then(function (d) { return d.getFileHandle(s.name, { create: true }); })
      .then(function (fh) {
        return fh.createWritable().then(function (w) {
          return w.write(text).then(function () { return test.slowSave ? new Promise(function (r) { setTimeout(r, test.slowSave); }) : null; }).then(function () { return w.close(); });
        })
          .then(function () { return fh.getFile(); }).then(function (f) { return f.text(); });
      })
      .then(function (back) { return Promise.all([sha(back), sha(text)]); })
      .then(function (h) { if (h[0] !== h[1]) throw err('MP_READBACK', path); known[path] = h[1]; });
  }
  function json(obj) { return JSON.stringify(obj, null, 1) + '\n'; }

  // ---------- load ----------
  var DEFAULT_SETTINGS = { version: 1, lang: null, last_user: null, stale_days: 14, replan_pct: 10, watch_pct: 5 };
  function loadAll() {
    S = { settings: null, users: {}, requests: {}, results: {}, updates: [], foods: null, shops: null };
    known = {};
    return readJSON('app-settings.json', true).then(function (s) {
      S.settings = Object.assign({}, DEFAULT_SETTINGS, s || {});
      return list(['users']);
    }).then(function (entries) {
      return Promise.all(entries.filter(function (e) { return e.kind === 'directory'; }).map(function (e) {
        var id = e.name, base = 'users/' + id + '/';
        return Promise.all([readJSON(base + 'profile.json', true), readJSON(base + 'history.json', true), readJSON(base + 'changes.json', true)])
          .then(function (r) { if (r[0]) S.users[id] = { profile: r[0], history: r[1] || emptyHistory(), changes: r[2] || { list: [] } }; });
      }));
    }).then(function () { return refreshShared(); })
      .then(function () { emit('loaded'); });
  }
  // Files Claude writes: re-read them any time (never written by the app, except requests it created).
  function refreshShared() {
    return Promise.all([
      list(['requests']).then(function (es) {
        return Promise.all(es.filter(function (e) { return /\.json$/.test(e.name); }).map(function (e) {
          if (dirty['requests/' + e.name]) return null;  // this window has an unsaved change to it
          return readJSON('requests/' + e.name, true).then(function (o) { if (o && o.id) S.requests[o.id] = o; }).catch(function () {});
        }));
      }),
      list(['results']).then(function (es) {
        return Promise.all(es.filter(function (e) { return /\.json$/.test(e.name); }).map(function (e) {
          return readJSON('results/' + e.name).then(function (o) { if (o && o.id) S.results[o.id] = o; }).catch(function () {});
        }));
      }),
      list(['updates']).then(function (es) {
        var out = [];
        return Promise.all(es.filter(function (e) { return /\.json$/.test(e.name); }).map(function (e) {
          return readJSON('updates/' + e.name).then(function (o) { if (o) { o._file = e.name; out.push(o); } }).catch(function () {});
        })).then(function () { out.sort(function (a, b) { return a._file < b._file ? -1 : 1; }); S.updates = out; });
      }),
      readJSON('foods/foods.json').then(function (o) { S.foods = o; }).catch(function () { S.foods = { items: [], error: 'MP_BAD_JSON' }; }),
      readJSON('shops/shops.json').then(function (o) { S.shops = o; }).catch(function () { S.shops = { error: 'MP_BAD_JSON' }; })
    ]);
  }
  function emptyHistory() { return { version: 1, weighins: [], spend: [], plans: [], notes: [] }; }

  // ---------- paths inside a document ----------
  // "body.height_cm", "locations#L-0002", "locations#L-0002.name". A "#" step looks up an item of a list by id.
  function steps(path) { return path === '' ? [] : path.split('.').map(function (s) { var i = s.indexOf('#'); return i < 0 ? { k: s } : { k: s.slice(0, i), id: s.slice(i + 1) }; }); }
  function getPath(doc, path) {
    var cur = doc, st = steps(path), i;
    for (i = 0; i < st.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[st[i].k];
      if (st[i].id !== undefined) cur = (cur || []).filter(function (x) { return x && x.id === st[i].id; })[0];
    }
    return cur;
  }
  function setPath(doc, path, value) {
    var st = steps(path), cur = doc, i;
    for (i = 0; i < st.length; i++) {
      var s = st[i], last = i === st.length - 1;
      if (s.id === undefined) {
        if (last) { if (value === undefined) delete cur[s.k]; else cur[s.k] = value; return; }
        if (cur[s.k] === null || typeof cur[s.k] !== 'object') cur[s.k] = {};
        cur = cur[s.k];
      } else {
        if (!Array.isArray(cur[s.k])) cur[s.k] = [];
        var arr = cur[s.k], idx = -1, j;
        for (j = 0; j < arr.length; j++) if (arr[j] && arr[j].id === s.id) { idx = j; break; }
        if (last) {
          if (value === null || value === undefined) {
            if (idx >= 0) { doc._trash = doc._trash || []; doc._trash.push({ from: s.k, item: arr[idx], at: nowIso() }); arr.splice(idx, 1); }
          } else if (idx >= 0) arr[idx] = value;
          else arr.push(value);
          return;
        }
        if (idx < 0) throw err('MP_NO_ITEM', path);
        cur = arr[idx];
      }
    }
  }
  function overlaps(a, b) { return a === b || a === '' || b === '' || a.indexOf(b + '.') === 0 || b.indexOf(a + '.') === 0; }

  // Next code for a list, counting the trash too, so a code is never given twice.
  function nextCode(doc, listName, prefix) {
    var max = 0;
    function see(x) { if (x && typeof x.id === 'string' && x.id.indexOf(prefix + '-') === 0) { var n = parseInt(x.id.slice(prefix.length + 1), 10); if (n > max) max = n; } }
    (doc[listName] || []).forEach(see);
    (doc._trash || []).forEach(function (t) { if (t.from === listName) see(t.item); });
    var s = String(max + 1); while (s.length < 4) s = '0' + s;
    return prefix + '-' + s;
  }

  // ---------- users ----------
  function slug(name) {
    var s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    return s || 'user';
  }
  function createUser(profile, firstWeight) {
    var base = slug(profile.name), id = base, n = 2;
    while (S.users[id]) { id = base + '-' + n; n++; }
    return list(['users']).then(function (es) {
      var taken = {}; es.forEach(function (e) { taken[e.name] = true; });
      while (taken[id] || S.users[id]) { id = base + '-' + n; n++; }
      var at = nowIso();
      profile.id = id; profile.created = at; profile.version = 1;
      var h = emptyHistory();
      if (firstWeight) h.weighins.push({ id: 'W-0001', date: today(), kg: firstWeight, note: '' });
      var ch = { list: [{ id: 'C-0001', at: at, who: profile.name, label: 'profile_created', ops: [{ file: 'profile', path: '', old: null, new: clone(profile) }], no_undo: true }] };
      S.users[id] = { profile: profile, history: h, changes: ch };
      ['profile', 'history', 'changes'].forEach(function (f) { dirty['users/' + id + '/' + f + '.json'] = true; });
      setSetting('last_user', id);
      schedule(0);
      emit('changed', { user: id });
      return id;
    });
  }
  function setSetting(k, v) {
    if (!S.settings) return;
    S.settings[k] = v; dirty['app-settings.json'] = true; schedule();
  }

  // ---------- commit and undo ----------
  // ops: [{file: 'profile'|'history', path, value}]
  function commit(userId, label, ops, extra) {
    var u = S.users[userId]; if (!u) throw err('MP_NO_USER', userId);
    var done = [];
    ops.forEach(function (op) {
      var doc = u[op.file], old = clone(getPath(doc, op.path));
      var val = clone(op.value);
      if (JSON.stringify(old) === JSON.stringify(val)) return;
      setPath(doc, op.path, val);
      done.push({ file: op.file, path: op.path, old: old === undefined ? null : old, new: val === undefined ? null : val });
      dirty['users/' + userId + '/' + op.file + '.json'] = true;
    });
    if (!done.length) return null;
    var who = ME.userId && S.users[ME.userId] ? S.users[ME.userId].profile.name : u.profile.name;
    var c = Object.assign({ id: nextCode(u.changes, 'list', 'C'), at: nowIso(), who: who, label: label, ops: done }, extra || {});
    u.changes.list.push(c);
    dirty['users/' + userId + '/changes.json'] = true;
    schedule();
    emit('changed', { user: userId, change: c });
    return c;
  }
  // Undo is allowed when every field still holds the value this change gave it (so an undo + redo pair counts as
  // what it really did). Otherwise it names the newest later change that touched the same field.
  // Bookkeeping fields starting with "_" (codes already used) are never undone and never block.
  function realOps(c) { return c.ops.filter(function (o) { return o.path.charAt(0) !== '_'; }); }
  function undoCheck(userId, changeId) {
    var u = S.users[userId], L = u.changes.list, ci = -1, i;
    for (i = 0; i < L.length; i++) if (L[i].id === changeId) ci = i;
    if (ci < 0) return { ok: false, why: 'MP_NO_CHANGE' };
    var c = L[ci];
    if (c.no_undo) return { ok: false, why: 'MP_NO_UNDO' };
    if (c.undone_by) return { ok: false, why: 'MP_ALREADY_UNDONE', by: c.undone_by };
    var ops = realOps(c), moved = ops.filter(function (b) {
      var cur = getPath(u[b.file], b.path);
      return JSON.stringify(cur === undefined ? null : cur) !== JSON.stringify(b.new === undefined ? null : b.new);
    });
    if (!moved.length) return { ok: true, change: c };
    for (i = L.length - 1; i > ci; i--) {
      var x = L[i];
      var hit = realOps(x).some(function (a) { return moved.some(function (b) { return a.file === b.file && overlaps(a.path, b.path); }); });
      if (hit) return { ok: false, why: 'MP_LATER_CHANGE', blocker: x };
    }
    return { ok: false, why: 'MP_LATER_CHANGE', blocker: { id: '?', label: 'unknown', at: '' } };
  }
  function undo(userId, changeId) {
    var chk = undoCheck(userId, changeId);
    if (!chk.ok) return chk;
    var c = chk.change, ops = realOps(c).slice().reverse().map(function (o) { return { file: o.file, path: o.path, value: o.old }; });
    var n = commit(userId, c.label, ops, { undo_of: c.id });
    if (n) { c.undone_by = n.id; dirty['users/' + userId + '/changes.json'] = true; schedule(); }
    return { ok: true, change: n };
  }
  // A logged event that does not change the user's own files (cancelling a request); cannot be undone.
  function logOnly(userId, label, ops) {
    var u = S.users[userId]; if (!u) return null;
    var who = ME.userId && S.users[ME.userId] ? S.users[ME.userId].profile.name : u.profile.name;
    var c = { id: nextCode(u.changes, 'list', 'C'), at: nowIso(), who: who, label: label, ops: ops, no_undo: true };
    u.changes.list.push(c); dirty['users/' + userId + '/changes.json'] = true; schedule();
    return c;
  }
  function cancelRequest(id) {
    var r = S.requests[id]; if (!r || r.status !== 'waiting') return null;
    r.status = 'cancelled'; r.cancelled = nowIso();
    writeRequest(r);
    return logOnly(r.user_id, 'request_cancelled', [{ file: 'request', path: id + '.status', old: 'waiting', new: 'cancelled' }]);
  }

  // ---------- requests (the app writes each once; Claude writes results/, never requests/) ----------
  function writeRequest(req) {
    S.requests[req.id] = req;
    dirty['requests/' + req.id + '.json'] = true;
    schedule(0);
    emit('changed', { request: req.id });
  }

  // ---------- saving ----------
  function schedule(ms) {
    status.pending = Object.keys(dirty).length;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, ms === undefined ? 400 : ms);
    emit('status', status);
  }
  function contentOf(path) {
    if (path === 'app-settings.json') return S.settings;
    var m = /^users\/([^/]+)\/(profile|history|changes)\.json$/.exec(path);
    if (m) return S.users[m[1]][m[2]];
    m = /^requests\/(.+)\.json$/.exec(path);
    if (m) return S.requests[m[1]];
    throw err('MP_UNKNOWN_FILE', path);
  }
  function saveNow() {
    saveTimer = null;
    if (saving) { schedule(); return Promise.resolve(); }
    // Data files first, each user's change log last; a log is not written if that user's data file failed,
    // so the log never lists a change the files do not have.
    var paths = Object.keys(dirty).sort(function (a, b) { var x = /changes\.json$/.test(a), y = /changes\.json$/.test(b); return x === y ? (a < b ? -1 : 1) : (x ? 1 : -1); });
    if (!paths.length || !dataDir) return Promise.resolve();
    var failedUsers = {};
    saving = true; status.state = 'saving'; emit('status', status);
    var texts = {}; paths.forEach(function (p) { texts[p] = json(contentOf(p)); delete dirty[p]; });
    var chain = Promise.resolve(), failed = null;
    paths.forEach(function (p) {
      var m = /^users\/([^/]+)\/(profile|history|changes)\.json$/.exec(p);
      chain = chain.then(function () {
        if (m && m[2] === 'changes' && failedUsers[m[1]]) { dirty[p] = 'waiting'; return null; }
        return writeText(p, texts[p]);
      }).catch(function (e) { if (!failed) failed = e; if (m) failedUsers[m[1]] = true; dirty[p] = dirty[p] || 'retry'; });
    });
    return chain.then(function () {
      saving = false;
      status.pending = Object.keys(dirty).length;
      if (failed) { status.state = 'error'; status.error = failed.code || String(failed); status.path = failed.extra || failed.message; }
      else { status.state = 'saved'; status.at = nowIso(); status.error = null; }
      emit('status', status);
      if (!failed && Object.keys(dirty).length) schedule(0);
    });
  }
  function hasUnsaved() { return saving || Object.keys(dirty).length > 0; }
  // After "changed outside": forget what this window had and read the files again.
  function reload() { dirty = {}; status = { state: 'idle', at: null, error: null, pending: 0 }; emit('status', status); return loadAll(); }

  root.MPStore = {
    on: on, S: function () { return S; }, ME: ME, nowIso: nowIso, today: today, hasFolderApi: hasFolderApi,
    pick: pick, reconnect: reconnect, askAgain: askAgain, folderName: folderName, refreshShared: refreshShared, reload: reload,
    createUser: createUser, commit: commit, undo: undo, cancelRequest: cancelRequest, unsavedList: function () { return Object.keys(dirty); }, undoCheck: undoCheck, nextCode: nextCode, getPath: getPath,
    setSetting: setSetting, writeRequest: writeRequest, saveNow: saveNow, hasUnsaved: hasUnsaved, status: function () { return status; },
    slug: slug, clone: clone, _test: { readText: readText, list: list, known: function () { return known; }, writeText: writeText }
  };
})(typeof window !== 'undefined' ? window : this);
