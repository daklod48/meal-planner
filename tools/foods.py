#!/usr/bin/env python3
"""Meal Planner. The ONLY writer of data/foods/foods.json. Unattended runs never hand-edit that file.

Every product read once from a shop goes in through `add`, which checks it first and refuses what looks wrong
(the 18/10 test matched ice cream for "tvaroh": give each item an "expect" block to catch that).

Use (from the MealPlanner folder):
  python tools/foods.py add new-items.json          (a list of items, or one item; "-" reads stdin)
  python tools/foods.py list [--shop rohlik] [--search tvaroh] [--older-than 14]
  python tools/foods.py get rohlik-1469745
  python tools/foods.py validate                    (checks the whole file, changes nothing)
  python tools/foods.py --data <other data folder> ...   (tests)

Item (fields after # are optional):
  {"id": "rohlik-1469745", "shop": "rohlik", "name": "Miil Tvaroh odtučněný 250 g",
   "price": 17.91, "currency": "CZK", "pack_g": 250, "unit": "g",
   "per100g": {"kcal": 64, "protein": 12, "fat": 0.5, "carbs": 4, "salt": 0.1},
   "nutrition_label": "exact" | "table" | "estimate" | "none", "nutrition_source": "shop nutrition table",
   "price_label": "online" | "cart" | "leaflet" | "last_known", "seen": "2026-10-19T00:20:00+02:00",
   # "shop_product_id": "1469745", "url": "https://...", "category": "tvaroh", "in_stock": true,
   # "loyalty": [{"card": "rohlik-xtra", "price": 16.11}], "pieces": 10,
   # "expect": {"category": "tvaroh", "min_protein": 8, "max_kcal": 150, "name_has": ["tvaroh"]}}

Writing without deleting: the laptop folder refuses deletes and renames over files, so the tool writes the full new
file to foods.next.json first, checks it, then writes foods.json in place and compares the hash. If foods.json is ever
broken, the tool restores it from foods.next.json. The first write of each day copies the old file into
daily-copies/foods-YYYY-MM-DD.json.
"""
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from datetime import datetime, timedelta, timezone

ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,80}$')
KEY_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,40}$')
NUTRITION_LABELS = ('exact', 'table', 'estimate', 'none')
PRICE_LABELS = ('online', 'cart', 'leaflet', 'last_known')
UNITS = ('g', 'ml', 'pcs')
LIMITS = {'kcal': (0, 900), 'protein': (0, 100), 'fat': (0, 100), 'carbs': (0, 100), 'salt': (0, 100), 'sugar': (0, 100), 'fiber': (0, 100)}
LOCK_STALE_MIN = 30


def fold(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    return ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn').lower()


def isnum(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def parse_time(s):
    try:
        t = datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except ValueError:
        return None
    if t.tzinfo is None:
        return None
    return t


def check(item):
    """Returns (clean_item, reasons, warnings). reasons non-empty = refused."""
    bad, warn = [], []
    if not isinstance(item, dict):
        return None, ['not an object'], []
    it = dict(item)
    expect = it.pop('expect', None)
    if not ID_RE.match(str(it.get('id') or '')):
        bad.append('id: lowercase letters, digits and - only, e.g. rohlik-1469745')
    if not KEY_RE.match(str(it.get('shop') or '')):
        bad.append('shop: chain key like rohlik, billa, kaufland')
    elif it.get('id') and not str(it['id']).startswith(it['shop'] + '-'):
        bad.append('id must start with the shop key and "-"')
    if not str(it.get('name') or '').strip():
        bad.append('name missing')
    if it.get('currency', 'CZK') != 'CZK':
        bad.append('currency must be CZK')
    it['currency'] = 'CZK'
    p = it.get('price')
    if not isnum(p) or p <= 0 or p >= 100000:
        bad.append('price must be a number above 0 (CZK)')
    for lp in it.get('loyalty') or []:
        if not isinstance(lp, dict) or not KEY_RE.match(str(lp.get('card') or '')):
            bad.append('loyalty: each entry needs a card key')
        elif not isnum(lp.get('price')) or lp['price'] <= 0:
            bad.append('loyalty price for %s must be above 0' % lp.get('card'))
        elif isnum(p) and lp['price'] > p:
            bad.append('loyalty price for %s is higher than the normal price' % lp.get('card'))
    g = it.get('pack_g')
    if not isnum(g) or g <= 0 or g > 100000:
        bad.append('pack_g must be the edible grams (or ml) in one pack')
    if it.get('unit') not in UNITS:
        bad.append('unit must be g, ml or pcs')
    if it.get('unit') == 'pcs' and (not isnum(it.get('pieces')) or it['pieces'] <= 0):
        bad.append('unit pcs needs pieces (how many in the pack)')
    lab = it.get('nutrition_label')
    if lab not in NUTRITION_LABELS:
        bad.append('nutrition_label must be exact, table, estimate or none')
    n = it.get('per100g')
    if lab == 'none':
        if n:
            bad.append('nutrition_label none but per100g given')
        it['per100g'] = None
    else:
        if not isinstance(n, dict) or not isnum(n.get('protein')) or not isnum(n.get('kcal')):
            bad.append('per100g needs at least protein and kcal (or nutrition_label none)')
        else:
            for k, v in n.items():
                if v is None:
                    continue
                if k in LIMITS and (not isnum(v) or v < LIMITS[k][0] or v > LIMITS[k][1]):
                    bad.append('per100g.%s out of range %s-%s' % (k, LIMITS[k][0], LIMITS[k][1]))
            mac = 0
            for k in ('protein', 'fat', 'carbs'):
                if isnum(n.get(k)):
                    mac += n[k]
            if mac > 100.5:
                bad.append('protein + fat + carbs above 100 g per 100 g')
            if all(isnum(n.get(k)) for k in ('protein', 'fat', 'carbs')):
                est = 4 * n['protein'] + 4 * n['carbs'] + 9 * n['fat']
                if abs(est - n['kcal']) > max(40, 0.25 * n['kcal']):
                    warn.append('kcal %s far from 4p+4c+9f = %.0f: check the label' % (n['kcal'], est))
        if lab == 'table' and not str(it.get('nutrition_source') or '').strip():
            bad.append('nutrition_label table needs nutrition_source (which food table)')
    if it.get('price_label') not in PRICE_LABELS:
        bad.append('price_label must be online, cart, leaflet or last_known')
    if parse_time(it.get('seen')) is None:
        bad.append('seen must be a date-time with time zone, e.g. 2026-10-19T00:20:00+02:00')
    # 2026-11-08: sale facts as the shop gave them. Unknown stays null; a "regular" price that is not above the price is no sale.
    if it.get('regular_price') is not None:
        if not isnum(it['regular_price']) or it['regular_price'] <= 0:
            bad.append('regular_price must be a number above 0 or null')
        elif isnum(p) and it['regular_price'] <= p:
            warn.append('regular_price %s is not above the price %s: not a sale, dropped' % (it['regular_price'], p))
            it['regular_price'] = None
    if it.get('sale_until') is not None and not re.match(r'^\d{4}-\d{2}-\d{2}$', str(it['sale_until'])):
        bad.append('sale_until must be YYYY-MM-DD or null (unknown is null, never a guess)')
    if it.get('regular_price') is None and it.get('sale_until') is not None and not it.get('loyalty'):
        it['sale_until'] = None
    if it.get('url') is not None and not re.match(r'^https?://', str(it['url'])):
        bad.append('url must start with http')
    if expect:
        if expect.get('category') and fold(expect['category']) != fold(it.get('category')):
            bad.append('expected category %s, item says %s' % (expect['category'], it.get('category')))
        if isnum(expect.get('min_protein')) and isinstance(n, dict) and isnum(n.get('protein')) and n['protein'] < expect['min_protein']:
            bad.append('protein %s g/100 g is below the floor %s: probably the wrong product' % (n['protein'], expect['min_protein']))
        if isnum(expect.get('max_kcal')) and isinstance(n, dict) and isnum(n.get('kcal')) and n['kcal'] > expect['max_kcal']:
            bad.append('kcal %s above the ceiling %s: probably the wrong product' % (n['kcal'], expect['max_kcal']))
        for word in expect.get('name_has') or []:
            if fold(word) not in fold(it.get('name')):
                bad.append('name does not contain "%s"' % word)
    return it, bad, warn


class Store:
    def __init__(self, data_dir):
        self.dir = os.path.join(data_dir, 'foods')
        self.path = os.path.join(self.dir, 'foods.json')
        self.next = os.path.join(self.dir, 'foods.next.json')
        self.lock = os.path.join(self.dir, 'foods.lock')
        self.backups = os.path.join(self.dir, 'daily-copies')

    def _read(self, p):
        with open(p, encoding='utf-8') as f:
            return json.load(f)

    def load(self):
        os.makedirs(self.dir, exist_ok=True)
        if not os.path.exists(self.path):
            return {'version': 1, 'updated': None, 'items': []}
        try:
            return self._read(self.path)
        except (ValueError, OSError):
            if os.path.exists(self.next):
                data = self._read(self.next)  # raises if this one is broken too
                self._write_in_place(self.path, self._text(data))
                print('NOTE: foods.json was broken; restored from foods.next.json', file=sys.stderr)
                return data
            raise

    def _text(self, data):
        return json.dumps(data, ensure_ascii=False, indent=1) + '\n'

    def _write_in_place(self, p, text):
        with open(p, 'w', encoding='utf-8') as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        with open(p, encoding='utf-8') as f:
            back = f.read()
        if hashlib.sha256(back.encode()).hexdigest() != hashlib.sha256(text.encode()).hexdigest():
            raise IOError('read-back of %s differs from what was written' % p)

    def acquire(self):
        os.makedirs(self.dir, exist_ok=True)
        now = datetime.now(timezone.utc)
        if os.path.exists(self.lock):
            with open(self.lock, encoding='utf-8') as f:
                txt = f.read().strip()
            if txt.startswith('busy'):
                t = parse_time(txt.split(' ', 2)[1]) if len(txt.split(' ')) > 1 else None
                if t and now - t < timedelta(minutes=LOCK_STALE_MIN):
                    raise SystemExit('foods.json is being written by another run (%s). Try again in a minute.' % txt)
        mine = 'busy %s pid %d\n' % (now.isoformat(timespec='seconds'), os.getpid())
        with open(self.lock, 'w', encoding='utf-8') as f:
            f.write(mine)
        time.sleep(0.3)  # two runs started together: the later write wins, the other one sees a different pid and stops
        with open(self.lock, encoding='utf-8') as f:
            if f.read() != mine:
                raise SystemExit('foods.json is being written by another run. Try again in a minute.')

    def release(self):
        with open(self.lock, 'w', encoding='utf-8') as f:
            f.write('free %s\n' % datetime.now(timezone.utc).isoformat(timespec='seconds'))

    def save(self, data):
        text = self._text(data)
        json.loads(text)
        if os.path.exists(self.path):
            os.makedirs(self.backups, exist_ok=True)
            day = datetime.now().strftime('%Y-%m-%d')
            b = os.path.join(self.backups, 'foods-%s.json' % day)
            if not os.path.exists(b):
                with open(self.path, encoding='utf-8') as src:
                    old = src.read()
                with open(b, 'w', encoding='utf-8') as dst:
                    dst.write(old)
        self._write_in_place(self.next, text)
        self._write_in_place(self.path, text)


def same_price(a, b):
    """Price and card prices only (2026-11-05: stock used to be part of this test, so adding in_stock to a product read
    without it was reported as "price changed 17.91 -> 17.91")."""
    return a.get('price') == b.get('price') and (a.get('loyalty') or []) == (b.get('loyalty') or [])


def stock_moved(a, b):
    """True only between two KNOWN states (in stock <-> sold out). Unknown -> known is new information, not a change."""
    return a.get('in_stock') in (True, False) and b.get('in_stock') in (True, False) and a.get('in_stock') != b.get('in_stock')


def cmd_add(store, src):
    raw = json.load(sys.stdin) if src == '-' else json.load(open(src, encoding='utf-8'))
    items = raw if isinstance(raw, list) else [raw]
    store.acquire()
    try:
        data = store.load()
        by_id = {it['id']: i for i, it in enumerate(data['items'])}
        res = {'added': [], 'updated': [], 'price_changed': [], 'stock_changed': [], 'unchanged': [], 'refused': [], 'warnings': []}
        for raw_it in items:
            it, bad, warn = check(raw_it)
            iid = (raw_it or {}).get('id') if isinstance(raw_it, dict) else None
            if bad:
                res['refused'].append({'id': iid, 'name': (raw_it or {}).get('name') if isinstance(raw_it, dict) else None, 'reasons': bad})
                continue
            for w in warn:
                res['warnings'].append({'id': iid, 'warning': w})
            if iid in by_id:
                old = data['items'][by_id[iid]]
                hist = list(old.get('price_history') or [])
                price_moved, stock_now = not same_price(old, it), stock_moved(old, it)
                if price_moved or stock_now:
                    # one history row per change of price or of a known stock state (a sell-out is worth remembering)
                    hist.append({'price': old.get('price'), 'loyalty': old.get('loyalty') or [], 'in_stock': old.get('in_stock'),
                                 'seen': old.get('seen'), 'price_label': old.get('price_label')})
                    if price_moved:
                        res['price_changed'].append({'id': iid, 'old': old.get('price'), 'new': it.get('price')})
                    if stock_now:
                        res['stock_changed'].append({'id': iid, 'old': old.get('in_stock'), 'new': it.get('in_stock')})
                    res['updated'].append(iid)
                elif {k: v for k, v in old.items() if k not in ('price_history', 'seen', 'first_seen')} != {k: v for k, v in it.items() if k not in ('seen',)}:
                    res['updated'].append(iid)
                else:
                    res['unchanged'].append(iid)
                it['first_seen'] = old.get('first_seen') or old.get('seen')
                it['price_history'] = hist
                data['items'][by_id[iid]] = it
            else:
                it['first_seen'] = it['seen']
                it['price_history'] = []
                data['items'].append(it)
                by_id[iid] = len(data['items']) - 1
                res['added'].append(iid)
        if res['added'] or res['updated'] or res['unchanged']:
            data['updated'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
            data['items'].sort(key=lambda x: x['id'])
            store.save(data)
    finally:
        store.release()
    print(json.dumps(res, ensure_ascii=False, indent=1))
    return 1 if res['refused'] else 0


def cmd_list(store, args):
    data = store.load()
    shop = opt(args, '--shop')
    q = fold(opt(args, '--search') or '')
    older = opt(args, '--older-than')
    now = datetime.now(timezone.utc)
    rows = []
    for it in data['items']:
        if shop and it['shop'] != shop:
            continue
        if q and q not in fold(it['name']) and q not in fold(it.get('category')) and q not in it['id']:
            continue
        age = (now - parse_time(it['seen'])).days
        if older is not None and age <= int(older):
            continue
        n = it.get('per100g') or {}
        rows.append('%-28s %8.2f CZK %6s g  P %5s  kcal %5s  [%s] %3d d  %s' % (
            it['id'], it['price'], it['pack_g'], n.get('protein', '-'), n.get('kcal', '-'), it['nutrition_label'], age, it['name']))
    print('\n'.join(rows) if rows else '(none)')
    return 0


def cmd_validate(store):
    data = store.load()
    problems = 0
    seen = set()
    for it in data['items']:
        _, bad, _ = check({k: v for k, v in it.items() if k not in ('price_history', 'first_seen')})
        if it['id'] in seen:
            bad.append('duplicate id')
        seen.add(it['id'])
        for b in bad:
            problems += 1
            print('%s: %s' % (it['id'], b))
    print('ok %d items, %d problems' % (len(data['items']), problems))
    return 1 if problems else 0


def opt(args, name):
    if name in args:
        return args[args.index(name) + 1]
    return None


def main(argv):
    args = argv[1:]
    data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
    if '--data' in args:
        i = args.index('--data')
        data_dir = args[i + 1]
        del args[i:i + 2]
    if not args or args[0] in ('-h', '--help'):
        print(__doc__)
        return 0
    store = Store(data_dir)
    if args[0] == 'add':
        return cmd_add(store, args[1])
    if args[0] == 'list':
        return cmd_list(store, args[1:])
    if args[0] == 'get':
        for it in store.load()['items']:
            if it['id'] == args[1]:
                print(json.dumps(it, ensure_ascii=False, indent=1))
                return 0
        print('not found')
        return 1
    if args[0] == 'validate':
        return cmd_validate(store)
    print('unknown command', args[0])
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
