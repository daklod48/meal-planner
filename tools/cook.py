#!/usr/bin/env python3
"""Meal Planner. Cook mode helper for the run task (session 3, 2026-10-19).

The run (Claude) collects raw rows from the shops; this tool turns them into checked foods, builds the options with the
same maths as the app (planner.py), and writes the result file. The run never computes a basket or edits a JSON by hand.
Work files of one request live in data/runs/<REQ-id>/ (kept; the laptop folder cannot delete).

Use (from the MealPlanner folder):
  python3 tools/cook.py pick                                   oldest waiting request without a result (JSON; {"none": true} if none)
  python3 tools/cook.py account <REQ-id> --rohlik-name "<name>" --rohlik-email "<email>"   (both from get_user_info)
                                                               exit 0 = same account as the profile's Rohlík entry (by e-mail when the
                                                               profile has one, else by name), 3 = different or missing
  python3 tools/cook.py terms <REQ-id> [--skip key,key]        the staple terms for this request (dislikes/allergies removed)
  python3 tools/cook.py ingest <REQ-id> --source rohlik|kosik|tesco|kupi --tsv <file> [--seen <ISO time>|now]
                                                               (run it right after each read: "now" = this minute, the default)
                                                               rows -> checked foods -> tools/foods.py add (prints added/refused)
  python3 tools/cook.py borrow <REQ-id>                        foods of this run without nutrition get the nutrition of the same kind
                                                               of food read at another shop (label estimate, source named)
  python3 tools/cook.py options <REQ-id> [--fresh-hours 48]    builds every option -> data/runs/<REQ-id>/options.json (prints a table)
  python3 tools/cook.py cart <REQ-id> --option O1 --tsv <cart.tsv>
                                                               cart prices are the truth: rewrites that option's cost from the cart
  python3 tools/cook.py result <REQ-id> [--extras <extras.json>]
                                                               writes data/results/<REQ-id>.json and scores it (same as planner.py score-result)
  python3 tools/cook.py error <REQ-id> "<what went wrong>"     writes a result with status error (the app shows it)
  python3 tools/cook.py closed <shop id> --place "<place>" --seen <ISO>   Google Maps shows that store closed: sets closed_seen

TSV formats (tab separated, first line = header, exactly these columns):
  rohlik: term id name price original_price amount in_stock kcal protein fat carbs salt
          (from batch_search_products with include_nutritions; amount = textualAmount; empty cell = not given)
  kosik:  as written by tools/browser/kosik.js (MPK)   tesco: tools/browser/tesco.js (MPT)   kupi: tools/browser/kupi.js (MPL)
          (copy the table from get_page_text exactly: same header, tab between cells)
  cart:   id qty line_price   (id = Rohlík productId; line_price = price of that line in get_cart, CZK)

extras.json (written by the run): {"_recipes": [{"name": "...", "minutes": 20, "steps": "one paragraph", "needs": ["ryze", "kureci-prsa"]}],
  "_all": {"taste": 3, "cook_min_per_day": 35}, "O1": {"taste": 4, "notes": "..."}}
  _recipes: each option gets the recipes whose "needs" (staple keys) are all in its basket; "recipes" in an option replaces that.
  _all: defaults for every option; "O<n>": that option only.
"""
import json
import math
import os
import re
import subprocess
import sys
import unicodedata
from datetime import date, datetime, time, timedelta, timezone, tzinfo

HERE = os.path.dirname(os.path.abspath(__file__))
MP = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import planner  # noqa: E402

DATA = os.path.join(MP, 'data')
FRESH_HOURS = 48   # stored prices younger than this are reused (options --fresh-hours default; terms prints which sources can be skipped)
class PragueRule(tzinfo):
    """Europe/Prague without the time-zone table (Python on Windows without the tzdata package has none).
    CET +01:00; summer time +02:00 from the last Sunday of March 01:00 UTC to the last Sunday of October 01:00 UTC
    (Directive 2000/84/EC, Articles 2 and 3). Until 2026-11-05 the fallback was a fixed +02:00: one hour wrong all winter.
    tests/t_cook.py compares it with the real table every 30 minutes around each switch of 2025-2027."""

    @staticmethod
    def _last_sunday(y, m):
        d = date(y, m, 31)  # March and October both have 31 days
        return d - timedelta(days=(d.weekday() - 6) % 7)

    def _summer(self, utc_naive):
        y = utc_naive.year
        return datetime.combine(self._last_sunday(y, 3), time(1)) <= utc_naive < datetime.combine(self._last_sunday(y, 10), time(1))

    def utcoffset(self, dt):
        if dt is None:
            return timedelta(hours=1)
        loc = dt.replace(tzinfo=None)
        as_summer = self._summer(loc - timedelta(hours=2))   # this wall time is a real summer moment
        as_winter = not self._summer(loc - timedelta(hours=1))  # this wall time is a real winter moment
        if as_summer and as_winter:  # the repeated hour of October: fold 0 = first pass (summer), fold 1 = second (winter)
            return timedelta(hours=1 if dt.fold else 2)
        return timedelta(hours=2 if as_summer else 1)

    def dst(self, dt):
        return self.utcoffset(dt) - timedelta(hours=1)

    def tzname(self, dt):
        return 'CEST' if self.dst(dt) else 'CET'

    def fromutc(self, dt):
        u = dt.replace(tzinfo=None)
        summer = self._summer(u)
        loc = u + timedelta(hours=2 if summer else 1)
        repeated = not summer and self._summer(loc - timedelta(hours=2))  # second pass through the repeated hour
        return loc.replace(tzinfo=self, fold=1 if repeated else 0)


PRAGUE = None
try:
    from zoneinfo import ZoneInfo
    PRAGUE = ZoneInfo('Europe/Prague')
except Exception:  # pragma: no cover
    PRAGUE = PragueRule()

ONLINE = {  # shops whose whole range is online, with the delivery row id in shops.json
    'rohlik': {'name': 'Rohlík.cz', 'delivery_id': 'D-rohlik', 'cart_tool': True, 'shop_url': 'https://www.rohlik.cz/'},
    'kosik': {'name': 'Košík.cz', 'delivery_id': 'D-kosik', 'cart_tool': False, 'shop_url': 'https://www.kosik.cz/'},
    'tesco': {'name': 'Tesco online', 'delivery_id': 'D-tesco', 'cart_tool': False, 'shop_url': 'https://nakup.itesco.cz/groceries/cs-CZ/'},
}
KUPI_CHAINS = [  # kupi.cz shop name (folded, startswith) -> chain key in shops.json, card key when the row is a card price
    ('albert', 'albert', 'albert'), ('billa', 'billa', 'billa-club'), ('lidl', 'lidl', 'lidl-plus'), ('penny', 'penny', 'penny'),
    ('kaufland', 'kaufland', 'kaufland-card'), ('norma', 'norma', None), ('globus', 'globus', None), ('tesco', 'tesco', 'tesco-clubcard'),
]
KUPI_KEYS = {k for _, k, _ in KUPI_CHAINS}
VEG_G_PER_DAY = 200  # half of WHO's "at least 400 grams of fruits and vegetables per day" (WHO, 2026, Healthy diet fact sheet)
LABEL_RANK = {'exact': 0, 'table': 1, 'estimate': 2, 'none': 3}


def fold(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    return ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn').lower()


def clock():
    """The current moment, in UTC. Every 'now' of cook.py, dine.py and watch.py comes from here.
    Tests pin it with the environment variable MP_NOW=<ISO time with zone> (2026-11-05: t_cook.py's 48-hour checks
    had used the real clock against fixtures read on 19/10 and began failing on 21/10). A real run never sets MP_NOW."""
    v = os.environ.get('MP_NOW')
    if v:
        t = datetime.fromisoformat(v.replace('Z', '+00:00'))
        if t.tzinfo is None:
            raise SystemExit('MP_NOW needs a time zone, for example 2026-10-19T11:30:00+02:00')
        return t.astimezone(timezone.utc)
    return datetime.now(timezone.utc)


def now_iso():
    return clock().astimezone(PRAGUE).isoformat(timespec='seconds')


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def write_new(p, obj):
    """Writes in place (the laptop folder refuses rename and delete), reads back, compares."""
    os.makedirs(os.path.dirname(p), exist_ok=True)
    text = json.dumps(obj, ensure_ascii=False, indent=1)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(text)
    with open(p, encoding='utf-8') as f:
        if f.read() != text:
            raise SystemExit('ERROR: read-back of %s differs' % p)


def numf(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = str(s).strip().replace(' ', ' ').replace(' ', '').replace(',', '.')
    m = re.search(r'-?\d+(\.\d+)?', s)
    return float(m.group(0)) if m else None


def req_path(rid):
    return os.path.join(DATA, 'requests', rid + '.json')


def run_dir(rid):
    return os.path.join(DATA, 'runs', rid)


def load_req(rid):
    p = req_path(rid)
    if not os.path.exists(p):
        raise SystemExit('ERROR: no request file %s' % p)
    return load(p)


def staples():
    return load(os.path.join(MP, 'steps', 'cook-staples.json'))


def tsv_rows(path):
    with open(path, encoding='utf-8-sig') as f:   # utf-8-sig: a byte-order mark at the start is dropped (session 5 audit)
        lines = [ln.rstrip('\n').rstrip('\r') for ln in f if ln.strip()]
    if not lines:
        return []
    head = lines[0].split('\t')
    out = []
    for ln in lines[1:]:
        cells = ln.split('\t')
        out.append({head[i]: (cells[i].strip() if i < len(cells) else '') for i in range(len(head))})
    return out


# ---------- pack size ----------
PACK_RE = re.compile(r'(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|ks)\b', re.I)
MULTI_RE = re.compile(r'(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b', re.I)


def parse_pack(text):
    """'cca 500 g' -> (500, 'g', None); '10 ks' -> (None, 'pcs', 10); '4 x 125 g' -> (500, 'g', None)."""
    t = fold(text)
    m = MULTI_RE.search(t)
    if m:
        n, v, u = int(m.group(1)), numf(m.group(2)), m.group(3).lower()
        g = n * v * (1000 if u in ('kg', 'l') else 1)
        return g, ('ml' if u in ('ml', 'l') else 'g'), None
    found = PACK_RE.findall(t)
    if not found:
        return None, None, None
    v, u = numf(found[-1][0]), found[-1][1].lower()
    if u == 'ks':
        return None, 'pcs', int(v)
    if u in ('kg', 'l'):
        v *= 1000
    return v, ('ml' if u in ('ml', 'l') else 'g'), None


def egg_size(name):
    t = ' ' + fold(name).replace('–', '-').replace('/', ' ') + ' '
    for size in ('xl', 'l', 'm', 's'):
        if re.search(r'[\s(,-]%s[\s),-]' % size, t) or re.search(r'velikost\s*%s\b' % size, t):
            return size.upper()
    return 'M'


# ---------- commands ----------
def cmd_pick():
    rq = os.path.join(DATA, 'requests')
    rs = os.path.join(DATA, 'results')
    waiting = []
    for fn in sorted(os.listdir(rq)) if os.path.isdir(rq) else []:
        if not fn.endswith('.json'):
            continue
        try:
            r = load(os.path.join(rq, fn))
        except Exception as e:
            print(json.dumps({'warning': 'unreadable request %s: %s' % (fn, e)}))
            continue
        if r.get('status') != 'waiting' or os.path.exists(os.path.join(rs, fn)):
            continue
        waiting.append((r.get('created') or fn, fn, r))
    if not waiting:
        print(json.dumps({'none': True}))
        return 0
    waiting.sort()
    _, fn, r = waiting[0]
    print(json.dumps({'id': r.get('id'), 'file': 'data/requests/' + fn, 'waiting_total': len(waiting), 'mode': r.get('mode'),
                      'user_id': r.get('user_id'), 'user_name': r.get('user_name'), 'lang': r.get('lang'), 'created': r.get('created'),
                      'location': r.get('location'), 'days': r.get('days'), 'meals_per_day': r.get('meals_per_day'),
                      'budget_total': r.get('budget_total'), 'budget_per_day': r.get('budget_per_day'), 'cook': r.get('cook'),
                      'targets': r.get('targets'), 'cards': r.get('cards'), 'likes': r.get('likes'), 'dislikes': r.get('dislikes'),
                      'allergies': r.get('allergies'), 'wishes': r.get('wishes')}, ensure_ascii=False, indent=1))
    return 0


def cmd_account(rid, name, email=None):
    """Same account = the profile's Rohlík e-mail equals the connector's e-mail, or (no e-mail in the profile) the names are equal.
    The e-mail is compared only; it is never printed or written."""
    r = load_req(rid)
    acc = None
    for a in r.get('accounts') or []:
        if a.get('shop') == 'rohlik':
            acc = a
    if not acc:
        prof = os.path.join(DATA, 'users', str(r.get('user_id')), 'profile.json')
        if os.path.exists(prof):
            for a in load(prof).get('accounts') or []:
                if a.get('shop') == 'rohlik':
                    acc = a
    norm = lambda s: ' '.join(unicodedata.normalize('NFC', str(s or '')).split()).casefold()
    want = (acc or {}).get('account_name')
    pmail = norm((acc or {}).get('email'))
    by_mail = bool(pmail) and bool(email) and pmail == norm(email)
    by_name = bool(want) and norm(want) == norm(name)
    if pmail and email:
        ok, how = by_mail, 'e-mail'
    else:
        ok, how = by_name, 'name'
    print(json.dumps({'profile_rohlik_account': want, 'connector_account': name, 'compared_by': how,
                      'email_in_profile': bool(pmail), 'same': ok}, ensure_ascii=False))
    return 0 if ok else 3


def request_staples(r, skip):
    st = staples()['staples']
    words = [w for w in re.split(r'[,;\n]+', fold((r.get('dislikes') or '') + ',' + (r.get('allergies') or ''))) if w.strip()]
    out, skipped = [], []
    for s in st:
        why = None
        if s['key'] in skip:
            why = 'skipped by the run'
        for w in words:
            w = w.strip()
            if len(w) >= 3 and (w in fold(s['term']) or w in fold(s['kupi']) or w in fold(s['key'])):
                why = 'dislike/allergy "%s"' % w
        if why:
            skipped.append({'key': s['key'], 'why': why})
        else:
            out.append(s)
    return out, skipped


def cmd_terms(rid, skip):
    r = load_req(rid)
    out, skipped = request_staples(r, skip)
    lname, loc = location_shops(r)
    chains = []
    if loc:
        limit = planner.num((r.get('location') or {}).get('walk_limit_min')) or 30
        for sh in loc['shops']:
            if sh['kind'] == 'store' and sh['chain'] in KUPI_KEYS and sh['chain'] not in chains and \
                    ((sh.get('walk_min') is not None and sh['walk_min'] <= limit) or sh.get('transit_min')):
                chains.append(sh['chain'])
    tesco_terms = [(s.get('terms_by_shop') or {}).get('tesco', s['term']) for s in out]
    # Freshness (session 5): a source whose prices for every staple of this request were read within fresh_hours is not read again
    # this run (options reuses stored prices younger than fresh_hours anyway; the nightly watch keeps Rohlík prices of planned items fresh).
    fresh_hours = float(FRESH_HOURS)
    cutoff = clock() - timedelta(hours=fresh_hours)
    keys = [s['key'] for s in out]
    fresh = {}
    newest = {}
    for f in foods_all():
        if f.get('category') not in keys or not f.get('per100g') or f.get('in_stock') is False:
            continue
        src = 'kupi' if '-kupi-' in f['id'] else f['shop']
        if src not in ('rohlik', 'kosik', 'tesco', 'kupi'):
            continue
        ts = planner_parse_time(f.get('seen'))
        if not ts or ts < cutoff:
            continue
        fresh.setdefault(src, set()).add(f['category'])
        if src not in newest or ts > newest[src]:
            newest[src] = ts
    fresh_out, partial_js = {}, {}
    by_key_out = {s['key']: s for s in out}
    for src in ('rohlik', 'kosik', 'tesco', 'kupi'):
        have = fresh.get(src, set())
        missing = [k for k in keys if k not in have]
        recent = src in newest
        # skip: read within fresh_hours and every staple present; partial: read within fresh_hours, at most 3 staples missing
        # (a shop may simply not sell them, or the last request disliked them): read only those
        state = 'skip' if recent and not missing else ('partial' if recent and len(missing) <= 3 else 'read')
        fresh_out[src] = {'staples_fresh': len(have), 'of': len(keys), 'missing': missing, 'state': state, 'skip': state == 'skip',
                          'newest_read': newest[src].astimezone(PRAGUE).isoformat(timespec='minutes') if recent else None}
        if state == 'partial':
            ms = [by_key_out[k] for k in missing]
            if src == 'rohlik':
                partial_js[src] = [m['term'] for m in ms]
            elif src == 'kosik':
                partial_js[src] = 'await MPK(%s, 3)' % json.dumps([m['term'] for m in ms], ensure_ascii=False)
            elif src == 'tesco':
                partial_js[src] = 'await MPT(%s, 3)' % json.dumps([(m.get('terms_by_shop') or {}).get('tesco', m['term']) for m in ms], ensure_ascii=False)
            else:
                partial_js[src] = 'await MPL(%s, 3, %s)' % (json.dumps([m['kupi'] for m in ms], ensure_ascii=False), json.dumps(chains))
    print(json.dumps({'place': lname or 'NOT SURVEYED', 'terms': [{'key': s['key'], 'term': s['term'], 'kupi': s['kupi']} for s in out], 'skipped': skipped,
                      'fresh_hours': fresh_hours, 'fresh': fresh_out,
                      'skip_sources': [k for k, v in fresh_out.items() if v['state'] == 'skip'],
                      'partial_sources': {k: partial_js[k] for k in partial_js},
                      'rohlik_terms': [s['term'] for s in out], 'rohlik_calls_needed': math.ceil(len(out) / 4),
                      'kosik_js': 'await MPK(%s, 3)' % json.dumps([s['term'] for s in out], ensure_ascii=False),
                      'tesco_js': 'await MPT(%s, 3)' % json.dumps(tesco_terms, ensure_ascii=False),
                      'kupi_js': 'await MPL(%s, 3, %s)' % (json.dumps([s['kupi'] for s in out], ensure_ascii=False), json.dumps(chains))}, ensure_ascii=False, indent=1))
    return 0


def staple_by_term(sts):
    m = {}
    for s in sts:
        m[fold(s['term'])] = s
        m[fold(s['kupi'])] = s
        for v in (s.get('terms_by_shop') or {}).values():
            m[fold(v)] = s
        m[s['key']] = s
    return m


def name_refusal(s, name):
    n = fold(name)
    for w in s.get('has') or []:
        if fold(w) not in n:
            return 'name lacks "%s" (not %s)' % (w, s['key'])
    if s.get('has_any') and not any(fold(w) in n for w in s['has_any']):
        return 'name has none of the words that make it %s' % s['key']
    for w in s.get('not') or []:
        if fold(w) in n:
            return 'name contains "%s" (wrong kind of product for %s)' % (w, s['key'])
    return None


def nutr(row):
    n = {}
    for k in ('kcal', 'protein', 'fat', 'carbs', 'salt'):
        v = numf(row.get(k))
        if v is not None:
            n[k] = v
    return n if ('kcal' in n and 'protein' in n) else None


def slug(s):
    s = re.sub(r'[^a-z0-9]+', '-', fold(s)).strip('-')
    return s[:60]


def make_item(src, row, s, seen, egg_g):
    """Returns (item, refusal)."""
    name = row.get('name') or row.get('product') or ''
    ref = name_refusal(s, name)
    if ref:
        return None, ref
    it = {'category': s['key'], 'seen': seen, 'currency': 'CZK', 'price_label': 'online',
          'expect': {'category': s['key'], 'min_protein': s.get('min_protein'), 'max_kcal': s.get('max_kcal'), 'name_has': s.get('has') or []}}
    n = nutr(row)
    notes = []
    if src == 'rohlik':
        it.update(id='rohlik-%s' % row['id'], shop='rohlik', shop_product_id=str(row['id']), name=name,
                  price=numf(row.get('price')), url='https://www.rohlik.cz/%s' % row['id'])
        if row.get('in_stock'):
            it['in_stock'] = fold(row['in_stock']) in ('true', 'yes', '1', 'ano')
        g, unit, pcs = parse_pack(row.get('amount') or name)
        op = numf(row.get('original_price'))
        if op and it['price'] and op > it['price']:
            notes.append('sale: was %.2f CZK' % op)
    elif src == 'kosik':
        it.update(id='kosik-%s' % row['id'], shop='kosik', shop_product_id=str(row['id']), name=name,
                  price=numf(row.get('price')), url=('https://www.kosik.cz/' + row['slug']) if row.get('slug') else None)
        it['in_stock'] = fold(row.get('in_stock_today')) == 'yes'
        qty, qu = numf(row.get('qty')), fold(row.get('qty_unit'))
        g, unit, pcs = parse_pack('%s %s' % (row.get('qty'), row.get('qty_unit'))) if qty else parse_pack(name)
        club = numf(row.get('club_price'))
        if club and it['price'] and club < it['price']:
            it['loyalty'] = [{'card': 'kosik-club', 'price': club}]
        rec = numf(row.get('recommended'))
        if rec and it['price'] and rec > it['price']:
            notes.append('sale: was %.2f CZK' % rec)
    elif src == 'tesco':
        it.update(id='tesco-%s' % row['id'], shop='tesco', shop_product_id=str(row['id']), name=name,
                  price=numf(row.get('price')), url='https://nakup.itesco.cz/shop/cs-CZ/products/%s' % row['id'])
        it['in_stock'] = row.get('status') == 'AvailableForSale'
        g, unit, pcs = parse_pack(name)
        up = numf(row.get('unit_price'))
        if g is None and pcs is None and up and it['price'] and fold(row.get('unit')) in ('kg', 'l'):
            g, unit = round(it['price'] / up * 1000), ('ml' if fold(row.get('unit')) == 'l' else 'g')
            notes.append('sold by weight: %.0f g at %.2f CZK/kg' % (g, up))
        promo = row.get('promo') or ''
        if 'clubcard' in fold(promo):
            m = re.search(r'(\d+[.,]\d+)\s*kc', fold(promo))
            if m and numf(m.group(1)) < (it['price'] or 0):
                it['loyalty'] = [{'card': 'tesco-clubcard', 'price': numf(m.group(1))}]
        if promo:
            notes.append('promo: %s' % promo[:80])
    elif src == 'kupi':
        shop_name = fold(row.get('chain'))
        chain = card = None
        for pre, key, ck in KUPI_CHAINS:
            if shop_name.startswith(pre):
                chain, card = key, ck
        if not chain:
            return None, 'chain "%s" is not one of the surveyed chains' % row.get('chain')
        price = numf(row.get('price'))
        reg = numf(row.get('regular')) or None
        g, unit, pcs = parse_pack(row.get('amount') or '')
        if g is None and pcs is None:
            g, unit, pcs = parse_pack(name)
        is_card = fold(row.get('club')) == 'yes'
        if is_card and not card:
            return None, 'members-only price at %s, no card key for it in the app: skipped' % row.get('chain')
        kslug = slug(row.get('slug') or name)
        it.update(id='%s-kupi-%s' % (chain, kslug), shop=chain, name='%s (%s leaflet via kupi.cz)' % (name, row.get('chain')),
                  price_label='leaflet', url=('https://www.kupi.cz/sleva/' + row['slug']) if row.get('slug') else None)
        if is_card:
            if not reg or reg <= price:
                return None, 'card-only price %.2f with no regular price: skipped (premortem 8)' % price
            it['price'] = reg
            it['loyalty'] = [{'card': card, 'price': price}]
            notes.append('card price %.2f with %s; regular = kupi "Běžná cena"' % (price, card))
        else:
            it['price'] = price
        notes.append('leaflet valid: %s' % (row.get('valid') or '?'))
    else:
        raise SystemExit('unknown source %s' % src)
    if s.get('eggs'):
        if pcs is None:
            return None, 'eggs without a piece count'
        size = egg_size(name)
        per = egg_g[size]
        g, unit = pcs * per, 'pcs'
        it['pieces'] = pcs
        notes.append('%d eggs size %s, %d g edible each (estimate, see cook-staples.json)' % (pcs, size, per))
    elif unit == 'pcs':
        return None, 'sold per piece without grams'
    if g is None:
        return None, 'pack size not found in "%s"' % name
    it['pack_g'] = round(g, 1)
    it['unit'] = unit
    if n:
        it['per100g'] = n
        it['nutrition_label'] = 'estimate' if s.get('eggs') else 'exact'
        it['nutrition_source'] = ('shop label per 100 g; grams estimated' if s.get('eggs') else 'shop nutrition table (%s)' % src)
    else:
        it['per100g'] = None
        it['nutrition_label'] = 'none'
    if notes:
        it['notes'] = '; '.join(notes)
    return it, None


def foods_add(items, label):
    d = run_dir(label[0])
    p = os.path.join(d, 'add-%s.json' % label[1])
    write_new(p, items)
    pr = subprocess.run([sys.executable, os.path.join(HERE, 'foods.py'), 'add', p], capture_output=True, text=True, encoding='utf-8')
    try:
        res = json.loads(pr.stdout)
    except Exception:
        raise SystemExit('ERROR foods.py: %s %s' % (pr.stdout[-500:], pr.stderr[-500:]))
    return res


def cmd_ingest(rid, src, tsv, seen):
    if seen in (None, '', 'now'):
        seen = now_iso()
    if planner_parse_time(seen) is None:
        raise SystemExit('ERROR: --seen must be an ISO time with zone')
    r = load_req(rid)
    sts, _ = request_staples(r, set())
    st_all = staples()
    m = staple_by_term(sts)
    rows = tsv_rows(tsv)
    items, refused, errors = [], [], []
    for row in rows:
        term = row.get('term', '')
        if any(v.startswith('ERROR') for v in row.values() if isinstance(v, str)) or row.get('id') == 'NONE' or row.get('product') == 'NONE':
            errors.append(' | '.join(v for v in row.values() if v))
            continue
        s = m.get(fold(term))
        if not s:
            refused.append({'name': row.get('name') or row.get('product'), 'why': 'term "%s" is not a staple of this request' % term})
            continue
        it, why = make_item(src, row, s, seen, st_all['eggs_edible_g'])
        if why:
            refused.append({'name': row.get('name') or row.get('product'), 'why': why})
            continue
        items.append(it)
    # one row per id (kupi lists the same product for several stores of one chain: keep the cheapest)
    best = {}
    for it in items:
        if it['id'] not in best or it['price'] < best[it['id']]['price']:
            best[it['id']] = it
    items = list(best.values())
    res = foods_add(items, (rid, src)) if items else {'added': [], 'updated': [], 'price_changed': [], 'unchanged': [], 'refused': [], 'warnings': []}
    log = {'source': src, 'rows': len(rows), 'sent': len(items), 'refused_by_cook': refused, 'shop_errors': errors,
           'foods_py': {k: (len(v) if k in ('added', 'updated', 'unchanged') else v) for k, v in res.items()}}
    used = os.path.join(run_dir(rid), 'used-ids.json')
    ids = load(used) if os.path.exists(used) else []
    for it in items:
        if it['id'] not in ids and not any((x.get('id') == it['id']) for x in res.get('refused', [])):
            ids.append(it['id'])
    write_new(used, ids)
    print(json.dumps(log, ensure_ascii=False, indent=1))
    return 0


def planner_parse_time(s):
    try:
        t = datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except ValueError:
        return None
    return t if t.tzinfo else None


def foods_all():
    return load(os.path.join(DATA, 'foods', 'foods.json')).get('items') or []


def cmd_borrow(rid):
    used = os.path.join(run_dir(rid), 'used-ids.json')
    ids = set(load(used)) if os.path.exists(used) else set()
    allf = foods_all()
    donors = {}
    for f in allf:
        if f.get('per100g') and f.get('category') and f.get('nutrition_label') in ('exact', 'estimate') and \
                not str(f.get('nutrition_source') or '').startswith('borrowed'):
            donors.setdefault(f['category'], []).append(f)
    out, none_left = [], []
    for f in allf:
        if f['id'] not in ids or f.get('per100g'):
            continue
        ds = donors.get(f.get('category')) or []
        if not ds:
            none_left.append(f['id'])
            continue
        words = set(re.findall(r'[a-z0-9]{4,}', fold(f['name'])))
        ds = sorted(ds, key=lambda d: (-len(words & set(re.findall(r'[a-z0-9]{4,}', fold(d['name'])))), d['per100g']['protein'], d['id']))
        d = ds[0]
        g = dict(f)
        for k in ('first_seen', 'price_history'):
            g.pop(k, None)
        g['per100g'] = dict(d['per100g'])
        g['nutrition_label'] = 'estimate'
        g['nutrition_source'] = 'borrowed from the same kind of food: %s at %s (%s); this pack\'s own label was not readable' % (d['name'], d['shop'], d.get('url') or d['id'])
        g['expect'] = {'category': f.get('category')}
        out.append(g)
    res = foods_add(out, (rid, 'borrow')) if out else {}
    print(json.dumps({'borrowed': len(out), 'still_without_nutrition': none_left, 'foods_py_refused': res.get('refused', [])}, ensure_ascii=False, indent=1))
    return 0


def location_shops(r):
    shops = load(os.path.join(DATA, 'shops', 'shops.json'))
    want = fold((r.get('location') or {}).get('name'))
    for name, loc in shops['locations'].items():
        if fold(name) == want or (want and (want in fold(name) or fold(name) in want)):
            return name, loc
    return None, None


def worst_label(labels):
    return max(labels or ['none'], key=lambda x: LABEL_RANK.get(x, 3))


def forced_veg(fl, cards, days):
    """Vegetables first: VEG_G_PER_DAY grams a day of the cheapest vegetable pack (per gram) in this pool."""
    veg = [f for f in fl if f.get('category') == 'zelenina' and planner._usable(f)]
    if not veg:
        return None
    best = min(veg, key=lambda f: (planner.effective_price(f, cards)['price'] / planner.num(f['pack_g']), f['id']))
    packs = max(1, math.ceil(VEG_G_PER_DAY * days / planner.num(best['pack_g'])))
    ep = planner.effective_price(best, cards)
    g = planner.num(best['pack_g'])
    n = best['per100g']
    return {'id': best['id'], 'name': best.get('name'), 'packs': packs, 'cap': packs, 'cost': planner.r(packs * ep['price'], 2),
            'cost_regular': planner.r(packs * ep['regular'], 2), 'card_used': ep['card_used'],
            'protein_g': planner.r(packs * g * planner.num(n['protein']) / 100, 2), 'kcal': planner.r(packs * g * planner.num(n['kcal']) / 100, 2)}


def build_option(oid, label, kind, shopname, fl, need, cards, days, extra):
    fv = forced_veg(fl, cards, days)
    rest = dict(need)
    if fv:
        rest = {'protein_g': max(0, need['protein_g'] - fv['protein_g']), 'kcal': max(0, need['kcal'] - fv['kcal'])}
    b = planner.basket([f for f in fl if f.get('category') != 'zelenina'], rest, cards, {'max_share': 0.4})
    if fv:
        b['items'].append(fv)
        for k in ('cost', 'cost_regular', 'protein_g', 'kcal'):
            b[k] = planner.r(b[k] + fv[k], 2)
    if not b['items']:
        return None
    byid = {f['id']: f for f in fl}
    sav = {}
    items = []
    labels, seens = [], []
    for x in b['items']:
        f = byid[x['id']]
        labels.append(f.get('nutrition_label') or 'none')
        seens.append(f.get('seen'))
        if x.get('card_used'):
            sav[x['card_used']] = sav.get(x['card_used'], 0) + (x['cost_regular'] - x['cost'])
        items.append({'id': x['id'], 'shop': f['shop'], 'category': f.get('category'), 'name': f['name'], 'packs': x['packs'], 'cost': x['cost_regular'],
                      'cost_with_card': x['cost'] if x.get('card_used') else None, 'card': x.get('card_used'),
                      'protein_g': x['protein_g'], 'kcal': x['kcal'], 'url': f.get('url'), 'product_id': f.get('shop_product_id'),
                      'price_label': f.get('price_label'), 'nutrition_label': f.get('nutrition_label')})
    o = {'id': oid, 'label': label, 'kind': kind, 'shop': shopname, 'days': days,
         'cost_regular': b['cost_regular'], 'card_savings': [{'card': k, 'saving': planner.r(v, 2)} for k, v in sorted(sav.items()) if v > 0],
         # eaten = what the plan feeds him (never more than the target); bought = whole packs; the rest stays as leftovers
         'protein_g_per_day': planner.r(min(b['protein_g'], need['protein_g']) / days, 1), 'kcal_per_day': planner.r(min(b['kcal'], need['kcal']) / days, 0),
         'bought_protein_g': planner.r(b['protein_g'], 1), 'bought_kcal': planner.r(b['kcal'], 0),
         'nutrition_label': worst_label(labels), 'price_seen': min(s for s in seens if s), 'price_label': 'mixed' if len(set(i['price_label'] for i in items)) > 1 else items[0]['price_label'],
         'items': items, 'recipes': [], 'taste': 3, 'met': b['met'], 'notes': ''}
    o.update(extra)
    if fv:
        o['notes'] += 'Vegetables: %d g a day included first (half of the WHO 400 g fruit and vegetables a day; fruit is not planned). ' % VEG_G_PER_DAY
    else:
        o['notes'] += 'No vegetables found at this shop in this run. '
    if b['protein_g'] < 0.98 * need['protein_g'] or b['kcal'] < 0.98 * need['kcal']:
        o['notes'] += 'These foods could not cover the whole target within the 40 %% per product rule (protein %s of %s g, kcal %s of %s). ' % (
            planner.r(b['protein_g'], 0), need['protein_g'], planner.r(b['kcal'], 0), need['kcal'])
    lk, lp = b['kcal'] - need['kcal'], b['protein_g'] - need['protein_g']
    if lk > 0.02 * need['kcal'] or lp > 0.02 * need['protein_g']:
        o['notes'] += 'Whole packs: after %d days about %s kcal and %s g protein are left over for later meals (counted in the price, not in the daily numbers). ' % (
            days, max(0, int(planner.r(lk, 0))), max(0, int(planner.r(lp, 0))))
    return o


def cmd_options(rid, fresh_hours):
    r = load_req(rid)
    days = int(r.get('days') or 1)
    t = r.get('targets') or {}
    need = {'protein_g': planner.r((planner.num(t.get('protein_g')) or 0) * days, 1), 'kcal': planner.r((planner.num(t.get('kcal')) or 0) * days, 0)}
    cards = r.get('cards') or []
    walk_limit = planner.num((r.get('location') or {}).get('walk_limit_min')) or 30
    lname, loc = location_shops(r)
    if not loc:
        raise SystemExit('ERROR: the place "%s" is not in data/shops/shops.json (survey it first: "meal planner, survey <place>")' % (r.get('location') or {}).get('name'))
    used = os.path.join(run_dir(rid), 'used-ids.json')
    ids = set(load(used)) if os.path.exists(used) else set()
    cutoff = clock() - timedelta(hours=fresh_hours)
    sts, _ = request_staples(r, set())
    by_key = {s['key']: s for s in sts}
    fl, dropped = [], []
    for f in foods_all():
        if f.get('category') not in by_key or not f.get('per100g') or f.get('in_stock') is False:
            continue
        why = name_refusal(by_key[f['category']], f['name'])  # today's name rules also apply to foods stored by older runs
        if why:
            dropped.append(f['id'])
            continue
        ts = planner_parse_time(f.get('seen'))
        if f['id'] not in ids and (ts is None or ts < cutoff):
            continue
        fl.append(f)
    by_shop = {}
    for f in fl:
        by_shop.setdefault(f['shop'], []).append(f)
    deliv = {s['id']: s for s in loc['shops'] if s['kind'] == 'delivery'}
    stores = {}
    for s in loc['shops']:
        if s['kind'] != 'store':
            continue
        k = s['chain']
        cur = stores.get(k)
        rank = lambda x: (x.get('walk_min') if x.get('walk_min') is not None else 999, x.get('transit_min') or 999)
        if cur is None or rank(s) < rank(cur):
            stores[k] = s
    opts, n = [], 0
    online = []
    for key, meta in ONLINE.items():
        if not by_shop.get(key):
            continue
        d = deliv.get(meta['delivery_id']) or {}
        n += 1
        extra = {'delivery_fee': d.get('delivery_fee'), 'min_order': d.get('min_order'), 'distance_m': None,
                 'delivery_min': None, 'walk_min': None, 'transit_min': None, 'shop_min_per_day': 0}
        o = build_option('O%d' % n, '%s delivered (cook at home)' % meta['name'], 'cook-online', key, by_shop[key], need, cards, days, extra)
        if not o:
            n -= 1
            continue
        if d.get('min_order') and o['cost_regular'] < d['min_order']:
            o['notes'] += 'Below the %s CZK minimum order by %.2f CZK%s. ' % (
                int(d['min_order']), d['min_order'] - o['cost_regular'], ' (a Rohlik Point box needs 500 CZK)' if key == 'rohlik' else '')
        if d.get('delivery_fee') is None:
            o['notes'] += 'Delivery fee: shown in the cart (not counted in the price). '
        o['cart'] = {'shop': key, 'url': meta['shop_url'], 'filled': False}
        opts.append(o)
        online.append(o)
    # in person: Tesco store (online price list) and mixed = cheapest online order + one walk to a leaflet chain
    t_store = stores.get('tesco')
    if by_shop.get('tesco') and t_store:
        travel = t_store.get('walk_min') if (t_store.get('walk_min') or 999) <= walk_limit else t_store.get('transit_min')
        if travel:
            n += 1
            extra = {'distance_m': t_store.get('distance_m'), 'walk_min': t_store.get('walk_min'), 'transit_min': t_store.get('transit_min'),
                     'delivery_fee': None, 'min_order': None, 'delivery_min': None, 'route_url': t_store.get('route_url'),
                     'shop_min_per_day': planner.r(2 * travel / days, 1),
                     'stores': [{'id': t_store['id'], 'name': t_store['name'], 'address': t_store.get('address')}]}
            o = build_option('O%d' % n, 'Shop at %s (%s) and cook' % (t_store['name'], t_store.get('address', '')), 'cook-shop', 'tesco', by_shop['tesco'], need, cards, days, extra)
            if o:
                o['notes'] += 'Prices are Tesco online prices; the shelf price can differ. '
                opts.append(o)
            else:
                n -= 1
    # mixed: a promo walk to one leaflet chain + the rest from a full-range source: the Tesco store in person when it is within reach
    # (no minimum order), else the cheapest online shop (its minimum order applies)
    t_ok = bool(by_shop.get('tesco') and t_store and ((t_store.get('walk_min') or 999) <= walk_limit or t_store.get('transit_min')))
    base = {'shop': 'tesco', 'in_person': True} if t_ok else (dict(min(online, key=lambda o: o['cost_regular']), in_person=False) if online else None)
    mixed = []
    for chain, store in stores.items():
        if chain in ONLINE or chain == 'tesco' or not by_shop.get(chain):
            continue
        travel = store.get('walk_min') if (store.get('walk_min') or 999) <= walk_limit else store.get('transit_min')
        if not travel:
            continue
        pool = by_shop[chain] + (by_shop[base['shop']] if base else [])
        trips = travel
        if base and base['in_person']:
            trips += t_store.get('walk_min') if (t_store.get('walk_min') or 999) <= walk_limit else t_store.get('transit_min')
        extra = {'distance_m': store.get('distance_m'), 'walk_min': store.get('walk_min'), 'transit_min': store.get('transit_min'),
                 'delivery_fee': None, 'min_order': None, 'delivery_min': None, 'route_url': store.get('route_url'),
                 'shop_min_per_day': planner.r(2 * trips / days, 1),
                 'stores': [{'id': store['id'], 'name': store['name'], 'address': store.get('address')}] +
                           ([{'id': t_store['id'], 'name': t_store['name'], 'address': t_store.get('address')}] if base and base['in_person'] else [])}
        if not base:
            rest = ''
        elif base['in_person']:
            rest = ' + the rest at %s' % t_store['name']
        else:
            rest = ' + %s order' % ONLINE[base['shop']]['name']
        lab = '%s promotions at %s%s' % (chain.capitalize(), store['name'], rest)
        o = build_option('M', lab, 'cook-mixed' if base else 'cook-shop', chain + ('+' + base['shop'] if base else ''), pool, need, cards, days, extra)
        if not o or not any(i['shop'] == chain for i in o['items']):
            continue
        part = sum(i['cost'] for i in o['items'] if base and i['shop'] == base['shop'])
        dmin = (deliv.get(ONLINE[base['shop']]['delivery_id']) or {}).get('min_order') if (base and not base['in_person']) else None
        if base and part and dmin and part < dmin:
            o['notes'] += 'The %s part is %.2f CZK, below its %s CZK minimum. ' % (ONLINE[base['shop']]['name'], part, int(dmin))
        o['notes'] += 'Leaflet prices: promotions with an end date; check the date before you go. '
        if base and base['in_person']:
            o['notes'] += 'Two walks: %s (%s min) and %s (%s min), there and back. Tesco items use Tesco online prices. ' % (
                store['name'], store.get('walk_min') or store.get('transit_min'), t_store['name'], t_store.get('walk_min') or t_store.get('transit_min'))
        mixed.append(o)
    mixed.sort(key=lambda o: (o['cost_regular'], o['shop']))
    for o in mixed[:4]:
        n += 1
        o['id'] = 'O%d' % n
        opts.append(o)
    out = {'request': rid, 'place': lname, 'need': need, 'days': days, 'cards': cards, 'built': now_iso(), 'fresh_hours': fresh_hours,
           'foods_used': len(fl), 'foods_dropped_by_name_rules': dropped, 'shops_with_foods': {k: len(v) for k, v in sorted(by_shop.items())}, 'options': opts}
    write_new(os.path.join(run_dir(rid), 'options.json'), out)
    print('need for %d days: protein %s g, kcal %s; foods %d %s' % (days, need['protein_g'], need['kcal'], len(fl), out['shops_with_foods']))
    for o in opts:
        print('%s | %-60s | %8.2f CZK | P %6.1f g/d | %6.0f kcal/d | %s | met %s | %s' % (
            o['id'], o['label'][:60], o['cost_regular'], o['protein_g_per_day'], o['kcal_per_day'], o['nutrition_label'], o['met'], o['notes'][:120]))
    return 0


def cmd_cart(rid, oid, tsv):
    p = os.path.join(run_dir(rid), 'options.json')
    doc = load(p)
    o = next((x for x in doc['options'] if x['id'] == oid), None)
    if not o:
        raise SystemExit('ERROR: option %s not in options.json' % oid)
    rows = {str(x['id']): x for x in tsv_rows(tsv)}
    planned = o['cost_regular']
    total, missing, lines = 0.0, [], []
    for it in o['items']:
        if it['shop'] != 'rohlik':
            continue
        x = rows.get(str(it.get('product_id')))
        if not x:
            missing.append(it['name'])
            continue
        lp = numf(x.get('line_price'))
        q = numf(x.get('qty'))
        if q != it['packs']:
            missing.append('%s: cart has %s, plan %s' % (it['name'], x.get('qty'), it['packs']))
        lines.append((it, lp))
        total += lp or 0
    plan_part = sum(it['cost'] for it in o['items'] if it['shop'] == 'rohlik')
    diff = (total - plan_part) / plan_part * 100 if plan_part else 0
    limit = planner.num(((load_req(rid).get('rules') or {}).get('replan_if_cart_off_pct'))) or 10
    replan = abs(diff) > limit
    for it, lp in lines:
        if lp is not None:
            it['cost'] = lp
            it['price_label'] = 'cart'
    o['cost_regular'] = planner.r(sum(it['cost'] for it in o['items']), 2)
    o['price_seen'] = now_iso()
    o['cart'] = dict(o.get('cart') or {}, filled=not missing, cart_total_ours=planner.r(total, 2), plan_before_cart=planner.r(plan_part, 2),
                     diff_pct=planner.r(diff, 1), problems=missing)
    if replan:
        o['notes'] += 'Cart total differs from the plan by %.1f %% (more than %s %%): costs now use the cart prices; re-plan suggested. ' % (diff, limit)
    else:
        o['notes'] += 'Cart checked: %.2f CZK vs %.2f planned (%.1f %%). ' % (total, plan_part, diff)
    write_new(p, doc)
    print(json.dumps({'option': oid, 'cart_total_ours': planner.r(total, 2), 'planned': planner.r(plan_part, 2), 'diff_pct': planner.r(diff, 1),
                      'replan_needed': replan, 'problems': missing, 'cost_regular_now': o['cost_regular']}, ensure_ascii=False))
    return 0


def cmd_result(rid, extras_path):
    r = load_req(rid)
    doc = load(os.path.join(run_dir(rid), 'options.json'))
    ex = load(extras_path) if extras_path else {}
    opts = []
    for o in doc['options']:
        e = dict(ex.get('_all') or {})
        e.update(ex.get(o['id']) or {})
        o = dict(o)
        if 'taste' in e:
            o['taste'] = e['taste']
        if e.get('recipes'):
            o['recipes'] = e['recipes']
        elif ex.get('_recipes'):
            have = {i.get('category') for i in o['items']}
            o['recipes'] = [{k: v for k, v in rc.items() if k != 'needs'} for rc in ex['_recipes'] if set(rc.get('needs') or []) <= have]
        cook_min = planner.num(e.get('cook_min_per_day'))
        if cook_min is None:
            cook_min = planner.num((r.get('cook') or {}).get('max_cook_min_per_day')) or 30
        o['minutes_per_day'] = planner.r(cook_min + (o.pop('shop_min_per_day', 0) or 0), 1)
        if e.get('notes'):
            o['notes'] = (o.get('notes') or '') + e['notes']
        o['notes'] = (o.get('notes') or '').strip()
        o.pop('met', None)
        opts.append(o)
    res = {'id': rid, 'request': r, 'finished': now_iso(), 'status': 'done', 'options': opts,
           'need': doc.get('need'), 'place': doc.get('place'), 'foods_used': doc.get('foods_used'), 'shops_with_foods': doc.get('shops_with_foods')}
    ctx = {'targets': r.get('targets'), 'weights': r.get('weights'), 'cards': r.get('cards'), 'budget_per_day': r.get('budget_per_day')}
    res['scored'] = planner._jsnum(planner.score(opts, ctx))
    p = os.path.join(DATA, 'results', rid + '.json')
    write_new(p, res)
    print(json.dumps({'written': 'data/results/%s.json' % rid, 'options': len(opts), 'picks': res['scored']['picks'],
                      'ranked': [(x['id'], x.get('total'), x.get('cost_per_day')) for x in res['scored']['ranked']]}, ensure_ascii=False))
    return 0


def cmd_closed(shop_id, place, seen):
    """A run saw a store closed on Google Maps: mark it in shops.json (closed_seen), nothing else changes."""
    p = os.path.join(DATA, 'shops', 'shops.json')
    d = load(p)
    hit = 0
    for name, loc in d['locations'].items():
        if place and fold(name) != fold(place):
            continue
        for sh in loc['shops']:
            if sh.get('id') == shop_id:
                sh['closed_seen'] = seen
                hit += 1
    if not hit:
        raise SystemExit('ERROR: shop %s not found' % shop_id)
    write_new(p, d)
    print('marked closed_seen on %d row(s) of %s' % (hit, shop_id))
    return 0


def cmd_error(rid, text):
    r = load_req(rid)
    res = {'id': rid, 'request': r, 'finished': now_iso(), 'status': 'error', 'error': text, 'options': []}
    write_new(os.path.join(DATA, 'results', rid + '.json'), res)
    print('written error result for', rid)
    return 0


def opt(args, name, default=None):
    if name in args:
        i = args.index(name)
        return args[i + 1] if i + 1 < len(args) else default
    return default


def main(argv):
    if len(argv) < 2 or argv[1] in ('-h', '--help'):
        print(__doc__)
        return 0
    cmd, a = argv[1], argv[2:]
    if cmd == 'pick':
        return cmd_pick()
    if cmd == 'account':
        return cmd_account(a[0], opt(a, '--rohlik-name', ''), opt(a, '--rohlik-email'))
    if cmd == 'terms':
        return cmd_terms(a[0], set((opt(a, '--skip', '') or '').split(',')) - {''})
    if cmd == 'ingest':
        return cmd_ingest(a[0], opt(a, '--source'), opt(a, '--tsv'), opt(a, '--seen'))
    if cmd == 'borrow':
        return cmd_borrow(a[0])
    if cmd == 'options':
        return cmd_options(a[0], float(opt(a, '--fresh-hours', FRESH_HOURS)))
    if cmd == 'cart':
        return cmd_cart(a[0], opt(a, '--option'), opt(a, '--tsv'))
    if cmd == 'result':
        return cmd_result(a[0], opt(a, '--extras'))
    if cmd == 'closed':
        return cmd_closed(a[0], opt(a, '--place'), opt(a, '--seen'))
    if cmd == 'error':
        return cmd_error(a[0], ' '.join(a[1:]))
    print('unknown command', cmd)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
