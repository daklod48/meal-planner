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
The script itself checks the zip it made and refuses to finish if a data file slipped in. It never deletes anything;
a zip that already exists gets -2, -3 added to its name.
Your own words: put one word or phrase per line into data/share-forbid.txt (your name, your Windows user name, your
street, your e-mail; the file is in data/, so it is never sent). The check then also searches every text file in the
zip for those words (case-insensitive) and for e-mail addresses, and FAILS when one is found. Without that file only
e-mail addresses are searched, and the OK line says so.
"""
import re
import hashlib
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
                    if not m.lower().endswith(('@b.cz', '@example.com')):
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


def main(argv):
    if '-h' in argv or '--help' in argv:
        print(__doc__)
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
