/* Meal Planner web app (2026-11-05). A virtual folder: the same handle methods the File System Access API gives
   (getDirectoryHandle, getFileHandle, getFile().text(), createWritable().write/close, entries, queryPermission),
   kept in memory and backed by one "space" (Firestore or the local practice store, see backends.js).

   Why: store.js already saves through those handles with its rules (one save at a time, hash check against what this
   window last saw, read back before "Saved", change log last). Giving it a folder that lives in the cloud keeps every
   one of those rules and the whole data contract (FORMATS.md) unchanged; only the place the files sit changes.

   space = { files: {path: text}  (the cache, already loaded),
             put(path, text) -> Promise (resolves when the backend has it; rejects with .code),
             onRemote(fn(path, text|null))  (another device changed a file) }
   Paths are "data/users/x/profile.json". Folders exist when a file is inside them or they were created. */
(function (root) {
  'use strict';
  function notFound(what) { var e = new Error('Not found: ' + what); e.name = 'NotFoundError'; return e; }

  function makeRoot(space, name) {
    var dirs = {};  // folders created while empty
    function isDir(p) {
      if (p === '' || dirs[p]) return true;
      var pre = p + '/';
      return Object.keys(space.files).some(function (k) { return k.indexOf(pre) === 0; });
    }
    function fileHandle(path, nm) {
      return {
        kind: 'file', name: nm,
        getFile: function () {
          return Promise.resolve().then(function () {
            if (!Object.prototype.hasOwnProperty.call(space.files, path)) throw notFound(path);
            var text = space.files[path];
            return { name: nm, size: text.length, text: function () { return Promise.resolve(text); } };
          });
        },
        // Like Chrome's createWritable: nothing is replaced until close(); close() resolves when the backend has the file.
        createWritable: function () {
          var buf = '';
          return Promise.resolve({
            write: function (t) { buf += typeof t === 'string' ? t : String(t); return Promise.resolve(); },
            close: function () { return space.put(path, buf); },
            abort: function () { buf = ''; return Promise.resolve(); }
          });
        }
      };
    }
    function dirHandle(p, nm) {
      var pre = p === '' ? '' : p + '/';
      return {
        kind: 'directory', name: nm,
        queryPermission: function () { return Promise.resolve('granted'); },
        requestPermission: function () { return Promise.resolve('granted'); },
        getDirectoryHandle: function (child, o) {
          var cp = pre + child;
          return Promise.resolve().then(function () {
            if (Object.prototype.hasOwnProperty.call(space.files, cp)) { var e = new Error('A file, not a folder: ' + cp); e.name = 'TypeMismatchError'; throw e; }
            if (!isDir(cp)) { if (!(o && o.create)) throw notFound(cp); dirs[cp] = true; }
            return dirHandle(cp, child);
          });
        },
        getFileHandle: function (child, o) {
          var cp = pre + child;
          return Promise.resolve().then(function () {
            if (isDir(cp)) { var e = new Error('A folder, not a file: ' + cp); e.name = 'TypeMismatchError'; throw e; }
            if (!Object.prototype.hasOwnProperty.call(space.files, cp) && !(o && o.create)) throw notFound(cp);
            return fileHandle(cp, child);
          });
        },
        entries: function () {
          var seen = {}, list = [];
          Object.keys(space.files).concat(Object.keys(dirs)).sort().forEach(function (k) {
            if (k.indexOf(pre) !== 0) return;
            var rest = k.slice(pre.length), i = rest.indexOf('/'), n = i < 0 ? rest : rest.slice(0, i);
            if (!n || seen[n]) return;
            seen[n] = true;
            var full = pre + n;
            list.push([n, Object.prototype.hasOwnProperty.call(space.files, full) && i < 0 ? fileHandle(full, n) : dirHandle(full, n)]);
          });
          var idx = 0;
          return { next: function () { return Promise.resolve(idx < list.length ? { done: false, value: list[idx++] } : { done: true, value: undefined }); } };
        }
      };
    }
    return dirHandle('', name || 'MealPlanner');
  }

  root.MPVfs = { makeRoot: makeRoot };
})(typeof window !== 'undefined' ? window : this);
