/* Meal Planner web app (2026-11-05). Accounts and the per-account data space, in two interchangeable versions:

   - "firebase": Firebase Authentication (email and password, Google, anonymous for the demo) and Cloud Firestore.
     Used when app/js/firebase-config.js holds a real config. Each account's files are documents in
     spaces/{uid}/files/{file path, encoded}; firestore.rules lets an account read and write only its own space.
   - "local" (practice mode): the same calls, kept in this browser's localStorage. Used while the config is still the
     placeholder, and by the tests. Nothing leaves the device; another tab of the same browser sees changes at once
     (that is how the tests prove phone/laptop sync without a server).

   Both give: init(), onUser(fn), signUp(email, pw, name), signIn(email, pw), google(), demo(), keepDemo(email, pw, name),
   signOut(), resetPassword(email), openSpace(user) -> space (see vfs.js), mode, user().
   Errors are thrown with .code = a Firebase-style code (auth/wrong-password ...), shown through i18n keys err_<code>. */
(function (root) {
  'use strict';
  var SCRIPT = document.currentScript ? document.currentScript.src : location.href;
  var MAX_TEXT = 900000;  // Firestore allows about 1 MB per document; leave room for the other fields
  function fail(code) { var e = new Error(code); e.code = code; return e; }
  function deviceId() {
    try { var d = localStorage.getItem('mp-device'); if (!d) { d = Math.random().toString(36).slice(2, 10); localStorage.setItem('mp-device', d); } return d; } catch (e) { return 'x'; }
  }
  function sha(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  function emailOk(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e || ''); }

  // =====================================================================================================
  // LOCAL practice backend
  // =====================================================================================================
  function localBackend() {
    var K_ACC = 'mp-local:accounts', K_SES = 'mp-local:session', K_SPACE = 'mp-local:space:';
    var listeners = [], current = null;
    function get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
    function set(k, v) {
      try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); }
      catch (e) { throw fail('mp/quota'); }
    }
    function emit() { listeners.forEach(function (f) { setTimeout(function () { f(current); }, 0); }); }
    function rid() { return 'L' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8); }
    function signInAs(u) { current = u; set(K_SES, u); emit(); return u; }
    var api = {
      mode: 'local',
      init: function () { current = get(K_SES); return Promise.resolve(); },
      user: function () { return current; },
      onUser: function (f) { listeners.push(f); setTimeout(function () { f(current); }, 0); },
      signUp: function (email, pw, name) {
        email = String(email || '').trim().toLowerCase();
        if (!emailOk(email)) return Promise.reject(fail('auth/invalid-email'));
        if (String(pw || '').length < 6) return Promise.reject(fail('auth/weak-password'));
        var acc = get(K_ACC) || {};
        if (acc[email]) return Promise.reject(fail('auth/email-already-in-use'));
        var salt = rid();
        return sha(salt + pw).then(function (hash) {
          var u = { uid: rid(), email: email, name: name || '', isAnonymous: false, provider: 'password' };
          acc[email] = { uid: u.uid, salt: salt, hash: hash, name: u.name };
          set(K_ACC, acc);
          return signInAs(u);
        });
      },
      signIn: function (email, pw) {
        email = String(email || '').trim().toLowerCase();
        var a = (get(K_ACC) || {})[email];
        if (!a) return Promise.reject(fail('auth/invalid-credential'));
        return sha(a.salt + pw).then(function (hash) {
          if (hash !== a.hash) throw fail('auth/invalid-credential');
          return signInAs({ uid: a.uid, email: email, name: a.name || '', isAnonymous: false, provider: 'password' });
        });
      },
      google: function () { return Promise.reject(fail('mp/google-needs-firebase')); },
      demo: function () { return Promise.resolve(signInAs({ uid: rid(), email: null, name: '', isAnonymous: true, provider: 'anonymous' })); },
      // Turn the demo account into a real one, keeping its data (Firebase: linkWithCredential).
      keepDemo: function (email, pw, name) {
        if (!current || !current.isAnonymous) return Promise.reject(fail('mp/not-demo'));
        email = String(email || '').trim().toLowerCase();
        if (!emailOk(email)) return Promise.reject(fail('auth/invalid-email'));
        if (String(pw || '').length < 6) return Promise.reject(fail('auth/weak-password'));
        var acc = get(K_ACC) || {};
        if (acc[email]) return Promise.reject(fail('auth/email-already-in-use'));
        var salt = rid(), uid = current.uid;
        return sha(salt + pw).then(function (hash) {
          acc[email] = { uid: uid, salt: salt, hash: hash, name: name || '' };
          set(K_ACC, acc);
          return signInAs({ uid: uid, email: email, name: name || '', isAnonymous: false, provider: 'password' });
        });
      },
      signOut: function () { current = null; set(K_SES, null); emit(); return Promise.resolve(); },
      resetPassword: function () { return Promise.reject(fail('mp/reset-needs-firebase')); },
      openSpace: function (user) {
        var key = K_SPACE + user.uid, remote = [];
        var space = {
          files: get(key) || {},
          put: function (path, text) {
            if (text.length > MAX_TEXT) return Promise.reject(fail('MP_TOO_BIG'));
            var all = get(key) || {};
            all[path] = text;
            try { set(key, all); } catch (e) { return Promise.reject(e); }
            space.files[path] = text;
            return new Promise(function (r) { setTimeout(r, 30); });  // a little like a network round trip
          },
          onRemote: function (f) { remote.push(f); },
          close: function () { root.removeEventListener('storage', onStorage); }
        };
        // Another tab (in the tests: "the phone") wrote to the same space.
        function onStorage(e) {
          if (e.key !== key) return;
          var now = get(key) || {}, changed = [];
          Object.keys(now).forEach(function (p) { if (now[p] !== space.files[p]) { space.files[p] = now[p]; changed.push(p); } });
          Object.keys(space.files).forEach(function (p) { if (!(p in now)) { delete space.files[p]; changed.push(p); } });
          if (changed.length) remote.forEach(function (f) { f(changed); });
        }
        root.addEventListener('storage', onStorage);
        return Promise.resolve(space);
      }
    };
    return api;
  }

  // =====================================================================================================
  // FIREBASE backend (modules copied from the firebase npm package 12.19.0 into app/vendor/firebase/)
  // =====================================================================================================
  function firebaseBackend(config) {
    var base = new URL('../../vendor/firebase/', SCRIPT).href;
    var A, F, auth, db, listeners = [], current = null;
    function toUser(u) { return u ? { uid: u.uid, email: u.email, name: u.displayName || '', isAnonymous: u.isAnonymous, provider: (u.providerData[0] || {}).providerId || (u.isAnonymous ? 'anonymous' : '') } : null; }
    var api = {
      mode: 'firebase',
      init: function () {
        return Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]).then(function (m) {
          var app = m[0].initializeApp(config);
          A = m[1]; F = m[2];
          auth = A.getAuth(app);  // default persistence: stays signed in on this device until Sign out
          var emu = root.__MP_TEST__ && root.__MP_TEST__.emulators;  // tests only: the Firebase emulators on this machine
          try { db = F.initializeFirestore(app, emu ? {} : { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
          catch (e) { db = F.getFirestore(app); }
          if (emu) { A.connectAuthEmulator(auth, 'http://127.0.0.1:' + emu.auth, { disableWarnings: true }); F.connectFirestoreEmulator(db, '127.0.0.1', emu.firestore); }
          return new Promise(function (res) {
            var first = true;
            A.onAuthStateChanged(auth, function (u) {
              current = toUser(u);
              if (first) { first = false; res(); }
              listeners.forEach(function (f) { f(current); });
            });
          });
        });
      },
      user: function () { return current; },
      onUser: function (f) { listeners.push(f); setTimeout(function () { f(current); }, 0); },
      signUp: function (email, pw, name) {
        return A.createUserWithEmailAndPassword(auth, String(email || '').trim(), pw).then(function (c) {
          // The account exists before its name is set: tell the app again once the name is there.
          return name ? A.updateProfile(c.user, { displayName: name }).then(function () { current = toUser(c.user); listeners.forEach(function (f) { f(current); }); return current; }) : toUser(c.user);
        });
      },
      signIn: function (email, pw) { return A.signInWithEmailAndPassword(auth, String(email || '').trim(), pw).then(function (c) { return toUser(c.user); }); },
      google: function () {
        var p = new A.GoogleAuthProvider();
        return A.signInWithPopup(auth, p).then(function (c) { return toUser(c.user); }, function (e) {
          // Phones and strict browsers block pop-ups: fall back to a full-page redirect (comes back signed in).
          if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) return A.signInWithRedirect(auth, p);
          throw e;
        });
      },
      demo: function () { return A.signInAnonymously(auth).then(function (c) { return toUser(c.user); }); },
      keepDemo: function (email, pw, name) {
        if (!auth.currentUser || !auth.currentUser.isAnonymous) return Promise.reject(fail('mp/not-demo'));
        var cred = A.EmailAuthProvider.credential(String(email || '').trim(), pw);
        return A.linkWithCredential(auth.currentUser, cred).then(function (c) {
          return (name ? A.updateProfile(c.user, { displayName: name }) : Promise.resolve()).then(function () { current = toUser(c.user); listeners.forEach(function (f) { f(current); }); return current; });
        });
      },
      signOut: function () { return A.signOut(auth); },
      resetPassword: function (email) { return A.sendPasswordResetEmail(auth, String(email || '').trim()); },
      openSpace: function (user) {
        var col = F.collection(db, 'spaces', user.uid, 'files'), me = deviceId(), remote = [], unsub = null;
        var space = {
          files: {},
          put: function (path, text) {
            if (text.length > MAX_TEXT) return Promise.reject(fail('MP_TOO_BIG'));
            space.files[path] = text;
            // Resolves when Firestore's server has the write (offline: when the device is back online).
            return F.setDoc(F.doc(col, encodeURIComponent(path)), { path: path, text: text, updated: F.serverTimestamp(), device: me });
          },
          onRemote: function (f) { remote.push(f); },
          close: function () { if (unsub) unsub(); }
        };
        return new Promise(function (res, rej) {
          // The first answer can come from this device's cache (empty on a new phone): wait for the server's answer,
          // or 5 s when offline, before saying "loaded".
          var first = true, timer = setTimeout(function () { if (first) { first = false; res(space); } }, 5000);
          unsub = F.onSnapshot(col, { includeMetadataChanges: true }, function (snap) {
            var changed = [];
            snap.docChanges().forEach(function (ch) {
              if (ch.doc.metadata.hasPendingWrites) return;  // our own write coming back
              var d = ch.doc.data(), p = d.path;
              if (typeof p !== 'string' || typeof d.text !== 'string') return;
              if (ch.type === 'removed') { if (p in space.files) { delete space.files[p]; changed.push(p); } return; }
              if (space.files[p] !== d.text) { space.files[p] = d.text; changed.push(p); }
            });
            if (first) { if (snap.metadata.fromCache && navigator.onLine !== false) return; first = false; clearTimeout(timer); res(space); return; }
            if (changed.length) remote.forEach(function (f) { f(changed); });
          }, function (e) { if (first) { first = false; rej(e); } });
        });
      }
    };
    return api;
  }

  function configReady(c) { return !!(c && c.apiKey && c.projectId && String(c.apiKey).indexOf('PASTE') < 0); }
  root.MPBackends = {
    create: function () {
      var c = root.MP_FIREBASE_CONFIG;
      if (root.__MP_TEST__ && root.__MP_TEST__.forceLocal) return localBackend();
      return configReady(c) ? firebaseBackend(c) : localBackend();
    },
    configReady: configReady, localBackend: localBackend
  };
})(window);
