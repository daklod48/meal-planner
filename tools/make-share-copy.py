#!/usr/bin/env python3
"""Meal Planner. Makes the copy you send to a friend: MealPlanner-share-<date>.zip WITHOUT your data.

What goes in: app/, cards/, steps/, tools/, tests/, START-HERE.md, SETUP-FOR-CLAUDE.md, FORMATS.md.
What never goes in: data/ (your profiles, weigh-ins, requests, results, prices read for your plans, run logs),
tests/out/, __pycache__/, .pyc files, older share zips, and anything whose name starts with "." .
Option --with-shops: also data/shops/shops.json and data/shops/restaurants.json (the shop and restaurant survey of
YOUR places, with their names and addresses: send it only to someone who lives near the same places; it saves them
the survey). Nothing else from data/ can be included, whatever the option.

Use (from the MealPlanner folder, or anywhere with the path):
  python3 tools/make-share-copy.py                 -> MealPlanner-share-YYYY-MM-DD.zip next to the MealPlanner folder
  python3 tools/make-share-copy.py --with-shops    -> the same plus data/shops/*.json
  python3 tools/make-share-copy.py --out <folder>  -> write the zip there
  python3 tools/make-share-copy.py --check <zip>   -> lists what a zip holds and FAILS if anything under data/ other than
                                                      the two shop survey files is inside (run it before sending)
  python3 tools/make-share-copy.py --check-publish -> the PUBLIC GitHub repository check (2026-11-05): every file git
                                                      tracks now AND every file in every older commit (a public repo
                                                      publishes its whole history), plus commit authors and messages.
                                                      FAILS on: a _PAST-WORK or data/ path, a word of data/share-forbid.txt
                                                      (accents and case ignored, so "Tomas" also matches "Tomáš"), a
                                                      scheduled-task id (trig_...), a Claude session id, a private key,
                                                      an e-mail address outside the reserved test domains.
  python3 tools/make-share-copy.py --install-hook  -> makes git run --check-publish before every "git push" and refuse
                                                      the push when it fails (GitHub Pages publishes what is pushed)
The script itself checks the zip it made and refuses to finish if a data file slipped in. It never deletes anything;
a zip that already exists gets -2, -3 added to its name.
Your own words: put one word or phrase per line into data/share-forbid.txt (your name, your Windows user name, your
street, your e-mail; the file is in data/, so it is never sent). The check then also searches every text file in the
zip for those words (case-insensitive) and for e-mail addresses, and FAILS when one is found. Without that file only
e-mail addresses are searched, and the OK line says so.
"""
import re
import hashlib
import subprocess
import unicodedata
import os
import sys
import zipfile
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
MP = os.path.dirname(HERE)
SEND_DIRS = ['app', 'cards', 'steps', 'tools', 'tests']
SEND_FILES = ['START-HERE.md', 'SETUP-FOR-CLAUDE.md', 'FORMATS.md']
SHOPS_OK = {'data/shops/shops.json', 'data/shops/restaurants.json'}
SKIP_DIR_NAMES = {'__pycache__', 'out', 'node_modules'}


def wanted(rel):
    """rel = path inside the zip, with / . True when the file may be sent."""
    parts = rel.split('/')
    if any(p.startswith('.') for p in parts):
        return False
    if any(p in SKIP_DIR_NAMES for p in parts[:-1]):
        return False
    if rel.endswith('.pyc') or rel.endswith('.zip'):
        return False
    if parts[0] == 'data':
        return rel in SHOPS_OK
    return parts[0] in SEND_DIRS or (len(parts) == 1 and rel in SEND_FILES)


def collect(with_shops):
    out = []
    for d in SEND_DIRS:
        root = os.path.join(MP, d)
        if not os.path.isdir(root):
            continue
        for folder, dirs, files in os.walk(root):
            dirs[:] = sorted(x for x in dirs if x not in SKIP_DIR_NAMES and not x.startswith('.'))
            for f in sorted(files):
                p = os.path.join(folder, f)
                rel = os.path.relpath(p, MP).replace(os.sep, '/')
                if wanted(rel):
                    out.append((p, rel))
    for f in SEND_FILES:
        p = os.path.join(MP, f)
        if os.path.exists(p):
            out.append((p, f))
    if with_shops:
        for rel in sorted(SHOPS_OK):
            p = os.path.join(MP, rel.replace('/', os.sep))
            if os.path.exists(p):
                out.append((p, rel))
    return out


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()


EMAIL_RE = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')


def email_ok(m):
    """Addresses that can never reach a person: the domains reserved for examples and tests (RFC 2606, RFC 6761),
    Anthropic's no-reply sender and GitHub's no-reply addresses (commit authors)."""
    d = m.lower().rsplit('@', 1)[-1]
    return (d in ('example.com', 'example.org', 'example.net') or d.endswith(('.test', '.example', '.invalid', '.localhost'))
            or m.lower() == 'noreply@anthropic.com' or d == 'users.noreply.github.com')
TEXT_EXT = ('.md', '.py', '.js', '.json', '.txt', '.html', '.css', '.tsv', '.mjs', '.csv', '.pipe')


def forbid_words():
    p = os.path.join(MP, 'data', 'share-forbid.txt')
    if not os.path.exists(p):
        return []
    with open(p, encoding='utf-8') as f:
        return [ln.strip() for ln in f if ln.strip() and not ln.startswith('#')]


def check_zip(path, verbose=True):
    bad, names, words_hit, tops = [], [], [], set()
    words = forbid_words()
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            parts = n.split('/')
            tops.add(parts[0])
            rel = '/'.join(parts[1:]) if len(parts) > 1 else n   # inside MealPlanner/
            names.append(rel)
            low = n.lower()
            segs = low.split('/')
            # any "data" folder anywhere in the path, with or without the MealPlanner/ prefix, in any letter case
            if 'data' in segs[:-1] and rel not in SHOPS_OK:
                bad.append(n)
            if '__pycache__' in low or '/tests/out/' in '/' + low or low.endswith('.pyc'):
                bad.append(n)
            if n.endswith(TEXT_EXT) and not n.endswith('SHA256SUMS.txt'):
                try:
                    text = z.read(n).decode('utf-8', 'replace')
                except Exception:
                    continue
                for w in words:
                    if w.lower() in text.lower():
                        words_hit.append('%s: contains "%s"' % (n, w))
                for m in EMAIL_RE.findall(text):
                    if not email_ok(m):
                        words_hit.append('%s: e-mail address %s' % (n, m))
        if len(tops) != 1 or 'MealPlanner' not in tops:
            bad.append('top folder is not exactly MealPlanner/: %s' % sorted(tops))
        sums = z.read('MealPlanner/SHA256SUMS.txt').decode('utf-8').splitlines() if 'MealPlanner/SHA256SUMS.txt' in z.namelist() else []
        listed = {}
        for ln in sums:
            if '  ' in ln:
                hsh, rel = ln.split('  ', 1)
                listed[rel] = hsh
        if sums:
            for rel, hsh in listed.items():
                nm = 'MealPlanner/' + rel
                if nm not in z.namelist():
                    bad.append('SHA256SUMS lists a file that is not in the zip: ' + rel)
                elif hashlib.sha256(z.read(nm)).hexdigest() != hsh:
                    bad.append('SHA256SUMS hash differs: ' + rel)
            for rel in names:
                if rel not in listed and rel != 'SHA256SUMS.txt':
                    bad.append('file not listed in SHA256SUMS.txt: ' + rel)
        else:
            bad.append('SHA256SUMS.txt missing')
    if verbose:
        print('%s: %d files' % (os.path.basename(path), len(names)))
        top = {}
        for rel in names:
            top[rel.split('/')[0]] = top.get(rel.split('/')[0], 0) + 1
        for k in sorted(top):
            print('  %-20s %d' % (k, top[k]))
        shops = [n for n in names if n in SHOPS_OK]
        print('  shop survey included: %s' % (', '.join(shops) if shops else 'no'))
    if bad or words_hit:
        print('FAIL: these must not be sent:\n  ' + '\n  '.join(bad + words_hit))
        return False
    missing = [f for f in ('START-HERE.md', 'SETUP-FOR-CLAUDE.md', 'app/MealPlanner.html', 'steps/RUN-STEPS.md', 'steps/PRICE-WATCH-STEPS.md', 'tools/planner.py') if f not in names]
    if missing:
        print('FAIL: missing from the zip: ' + ', '.join(missing))
        return False
    print('OK: no data/ files and no e-mail address inside; SHA256SUMS.txt verified (%d files). %s' % (
        len(names), 'None of the %d words in data/share-forbid.txt found.' % len(words) if words else 'NOTE: no data/share-forbid.txt, so your own name and street were not searched for.'))
    return True


def fold(text):
    """Lower case without accents: "Tomáš" -> "tomas", so a word is found however it was typed."""
    return ''.join(c for c in unicodedata.normalize('NFD', text) if unicodedata.category(c) != 'Mn').lower()


PUBLISH_PATTERNS = [
    (re.compile(r'trig_[A-Za-z0-9]{10,}'), 'a scheduled-task id'),
    (re.compile(r'session_[A-Za-z0-9]{12,}'), 'a Claude session id'),
    (re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"\s*:'), 'a private key'),
]
BAD_PATH_PARTS = ('_PAST-WORK', 'data')


def git(*args, binary=False):
    r = subprocess.run(['git', '-C', MP] + list(args), capture_output=True)
    if r.returncode != 0:
        raise SystemExit('git %s failed: %s' % (' '.join(args), r.stderr.decode('utf-8', 'replace')))
    return r.stdout if binary else r.stdout.decode('utf-8', 'replace')


def scan_text(where, text, words, hits):
    f = fold(text)
    for w in words:
        if fold(w) in f:
            hits.append('%s: contains a word of data/share-forbid.txt ("%s")' % (where, w))
    for rx, what in PUBLISH_PATTERNS:
        m = rx.search(text)
        if m:
            hits.append('%s: %s (%s...)' % (where, what, m.group(0)[:9]))
    for m in EMAIL_RE.findall(text):
        if not email_ok(m):
            hits.append('%s: e-mail address %s' % (where, m))


def check_publish(verbose=True):
    """The check for the PUBLIC repository: what git would push, including every older commit."""
    words = forbid_words()
    hits = []
    commits = [c for c in git('rev-list', '--all').split() if c]
    blobs = {}  # blob id -> first path seen
    for c in commits:
        for ln in git('ls-tree', '-r', c).splitlines():
            meta, path = ln.split('\t', 1)
            parts = path.split('/')
            if any(p in BAD_PATH_PARTS for p in parts[:-1]) or parts[0] in BAD_PATH_PARTS:
                hits.append('commit %s: path %s must stay local' % (c[:7], path))
            bid = meta.split()[2]
            blobs.setdefault(bid, (c, path))
    for bid, (c, path) in blobs.items():
        raw = git('cat-file', 'blob', bid, binary=True)
        if b'\0' in raw[:8000]:
            continue  # pictures and other binary files
        scan_text('%s (commit %s)' % (path, c[:7]), raw.decode('utf-8', 'replace'), words, hits)
    for c in commits:
        meta = git('show', '-s', '--format=%an <%ae> | %cn <%ce> | %B', c)
        scan_text('commit %s author / message' % c[:7], meta, words, hits)
    for t in [x for x in git('tag', '-l').split() if x]:
        scan_text('tag ' + t, git('cat-file', '-p', 'refs/tags/' + t), words, hits)
    seen, out = set(), []
    for h in hits:
        if h not in seen:
            seen.add(h)
            out.append(h)
    if out:
        print('FAIL publish check: %d problem(s). Do not push.\n  ' % len(out) + '\n  '.join(out[:60]))
        return False
    if verbose:
        print('OK publish check: %d commits, %d files scanned (now and in history); no _PAST-WORK or data/ path, no scheduled-task or session id, no private key, no e-mail outside test domains. %s' % (
            len(commits), len(blobs), ('None of the %d words in data/share-forbid.txt found.' % len(words)) if words else 'NOTE: no data/share-forbid.txt, so names and account words were not searched for.'))
    return True


HOOK = """#!/bin/sh
# Installed by tools/make-share-copy.py --install-hook: refuse a push that would publish private data.
exec python3 "$(git rev-parse --show-toplevel)/tools/make-share-copy.py" --check-publish
"""


def main(argv):
    if '-h' in argv or '--help' in argv:
        print(__doc__)
        return 0
    if '--check-publish' in argv:
        return 0 if check_publish() else 1
    if '--install-hook' in argv:
        hook = os.path.join(git('rev-parse', '--git-path', 'hooks').strip(), 'pre-push')
        hook = hook if os.path.isabs(hook) else os.path.join(MP, hook)
        with open(hook, 'w') as f:
            f.write(HOOK)
        os.chmod(hook, 0o755)
        print('installed: %s (every git push runs --check-publish first)' % hook)
        return 0
    if '--check' in argv:
        return 0 if check_zip(argv[argv.index('--check') + 1]) else 1
    with_shops = '--with-shops' in argv
    out_dir = argv[argv.index('--out') + 1] if '--out' in argv else os.path.dirname(MP)
    os.makedirs(out_dir, exist_ok=True)
    base = os.path.join(out_dir, 'MealPlanner-share-%s' % date.today().isoformat())
    path, n = base + '.zip', 2
    while os.path.exists(path):
        path = '%s-%d.zip' % (base, n)
        n += 1
    files = collect(with_shops)
    manifest = []
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for p, rel in files:
            z.write(p, 'MealPlanner/' + rel)
            manifest.append('%s  %s' % (sha(p), rel))
        z.writestr('MealPlanner/SHA256SUMS.txt', '\n'.join(manifest) + '\n')
    print('written: %s (%d files, %.0f kB)' % (path, len(files) + 1, os.path.getsize(path) / 1024.0))
    if not check_zip(path):
        print('The zip above FAILED the check. Do not send it.')
        return 1
    print('Send this one file. The friend unzips it, opens a Cowork chat with the MealPlanner folder attached and types: read SETUP-FOR-CLAUDE.md and set me up')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
