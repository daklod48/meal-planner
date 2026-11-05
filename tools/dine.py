#!/usr/bin/env python3
"""Meal Planner. Order online and Eat out helper for the run task (session 4, 2026-10-19).

Same idea as cook.py: the run (Claude) reads shops and menus in Chrome or the Rohlík connector and writes raw rows (TSV);
this tool checks them, estimates the nutrition of every dish (steps/dish-table.json), builds the options with the same
maths as the app (planner.py), checks the filled basket and writes the result file. The run never computes a basket.

Use (from the MealPlanner folder):
  python3 tools/dine.py terms <REQ-id>                        what to read for this request (mode order or eatout): Rohlík ready-meal
                                                               keywords, and writes data/runs/<REQ-id>/read.js = the ONE script to paste
                                                               into Chrome (dish rules + readers + the call for this place)
  python3 tools/dine.py ingest <REQ-id> --source rohlik|wolt|foodora|menicka --tsv <file>
                                                               rows -> checked dishes with estimated nutrition (prints kept/refused)
  python3 tools/dine.py options <REQ-id>                      one option per venue (order) or restaurant (eatout) -> options.json
  python3 tools/dine.py basket <REQ-id> --option O1 --tsv <basket.tsv>
                                                               the basket the run filled: compares it with the plan (10 % rule)
  python3 tools/dine.py result <REQ-id> [--extras <extras.json>]  writes data/results/<REQ-id>.json and scores it
  python3 tools/dine.py estimate "<dish name>" ["<description>"] ["<weight>"] [--meat] [--price <CZK>]   one dish, by hand
                                                               (give the menu price to get the same checks as ingest)
  python3 tools/dine.py survey "<place>" --tsv <raw.tsv> --walk-col walk_B --m-col m_B [--walk-limit 25]
                                                               writes the restaurants of a place into data/shops/restaurants.json
  (pick, account and error: use tools/cook.py, they are the same for every mode)

TSV formats (tab separated, first line = header, exactly these columns):
  rohlik:  term id name price original_price amount in_stock kcal protein   (batch_search_products with include_nutritions)
  wolt / foodora / menicka: as written by read.js (header MPV): kind venue venue_name lat lng eta_min eta_max fee min_order
           service_pct service_min open item dish price weight desc url rest (kind V = venue, D = dish, L = ledger;
           rest = the surveyed restaurant id a venue was matched to, eat out only)
  basket:  item qty line_price   (item = Wolt item id, foodora product code or Rohlík productId)
  survey:  name lat lng place_id walk_<X> m_<X> ... menicka note   (one walk and one metres column per place)
"""
import json
import os
import re
import sys
from itertools import combinations_with_replacement

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import planner  # noqa: E402
import cook  # noqa: E402
from cook import fold, load, write_new, numf, load_req, run_dir, now_iso, DATA, MP  # noqa: E402
from cook import tsv_rows as _tab_rows  # noqa: E402


BROWSER_HEAD = ['kind', 'venue', 'venue_name', 'lat', 'lng', 'eta_min', 'eta_max', 'fee', 'min_order', 'service_pct', 'service_min', 'open',
                'item', 'dish', 'price', 'weight', 'desc', 'url', 'rest']


def tsv_rows(path, need=None):
    """Rows of a table file: tab separated, or '|' separated (the browser tables since 19/10: get_page_text shows a run of
    empty tab cells as one space, so the readers write '|', which survives copying). Blank lines and any title lines before
    the header are skipped: the header is the first line that names the columns in `need` (or the first '|' line).
    A '|' row with more cells than the header is a broken copy: ERROR, nothing is guessed (19/10, review)."""
    with open(path, encoding='utf-8-sig') as f:
        lines = [ln.rstrip('\n').rstrip('\r') for ln in f if ln.strip()]
    hi = None
    for i, ln in enumerate(lines):
        cols = [c.strip() for c in (ln.split('|') if '|' in ln else ln.split('\t'))]
        if need and all(c in cols for c in need):
            hi = i
            break
        if not need and '|' in ln:
            hi = i
            break
    if hi is None:
        if need:
            raise SystemExit('ERROR: %s has no header line with the columns %s' % (path, ' '.join(need)))
        return _tab_rows(path)
    sep = '|' if '|' in lines[hi] else '\t'
    head = [h.strip() for h in lines[hi].split(sep)]
    out = []
    for n, ln in enumerate(lines[hi + 1:], start=hi + 2):
        cells = ln.split(sep)
        if sep == '|' and len(cells) > len(head):
            raise SystemExit('ERROR: %s row %d has %d cells, the header %d (a "|" inside a cell, or a broken copy): fix the copy' % (path, n, len(cells), len(head)))
        out.append({head[i]: (cells[i].strip() if i < len(cells) else '') for i in range(len(head))})
    return out

TABLE_PATH = os.path.join(MP, 'steps', 'dish-table.json')
REST_PATH = os.path.join(DATA, 'shops', 'restaurants.json')
MEAT_COMPS = {'chicken', 'chicken_breaded', 'beef', 'beef_gravy', 'pork', 'duck', 'salmon', 'fish_fried', 'shrimp', 'tofu', 'cheese',
              'cheese_fried', 'teriyaki_chicken'}
ORDER_MIN_PER_DAY = 5      # minutes to choose and order once a day (assumption, said in the notes)
HEAT_MIN_PER_MEAL = 3      # minutes to heat a ready meal or a dish kept for later (assumption)
READY_TERMS = ['hotová jídla', 'hotové jídlo kuřecí', 'hotové jídlo hovězí', 'hotové jídlo vepřové', 'Rohlík Bistro', 'Pappudia',
               'Libeřské lahůdky', 'hotové jídlo s rýží']
READY_G = (250, 750)       # a ready meal = one pack between these weights
SHORTLIST_VENUES = 20      # read.js keeps the 20 best venues (all are read and counted; the ledger says how many)
SHORTLIST_DISHES = 6


def table():
    return load(TABLE_PATH)


# ---------------------------------------------------------------- estimate (twin: tools/browser/dish-core.js)
def norm(s):
    """Folded text, every non-letter/digit a space, padded: ' kureci rizek s kasi '. Rule words must START a word."""
    return ' ' + ' '.join(re.sub(r'[^a-z0-9]+', ' ', fold(s)).split()) + ' '


def has(text, words):
    for w in words:
        if (' ' + w) in text:
            return True
    return False


def first_key(text, pairs):
    for key, words in pairs:
        if has(text, words):
            return key
    return None


# Weights: ASCII digits only, at most 5 before the decimal point, one ' ' between number and unit after gtext() turned every
# Unicode space (and the BOM) into ' '. The twin (dish-core.js) does exactly the same, so odd characters read the same in both.
G_RE = r'(?<![0-9])([0-9]{1,5}(?:[.,][0-9]+)?) *(kg|g)(?![a-z])'
SPACES_RE = re.compile(r'[\s\ufeff]+')


def gtext(s):
    return SPACES_RE.sub(' ', fold(s or ''))


def grams_of(m):
    v = float(m.group(1).replace(',', '.'))
    return v * 1000 if m.group(2) == 'kg' else v


def parse_g(text):
    m = re.search(G_RE, gtext(text))
    return grams_of(m) if m else None


def lead_g(text):
    m = re.match(r'^ *' + G_RE, gtext(text))
    return grams_of(m) if m else None


def count_of(t):
    m = re.search(r' ([0-9]{1,4}) ?(x|ks|pcs|pc|kus|kusy|kusu) ', t)
    return int(m.group(1)) if m else None


def estimate(name, desc='', weight='', kind='dish', T=None, price=None):
    """kind 'dish': the weight field is the whole dish (Wolt unit_info); 'meat': the weight field is the meat (daily menus).
    Rules in steps/dish-table.json (weight_rules). Returns the estimate or {'skip': reason}."""
    T = T or table()
    n, d = norm(name), norm(desc)
    nd = n + d
    if has(n, T['exclude_strong']):
        return {'skip': 'not a main dish'}
    if price is not None and price < T.get('price_floor_any', 0):
        return {'skip': 'price placeholder (size or choice picked later)'}
    typ, where = None, None
    for t in T['types']:
        if has(n, t['words']):
            typ, where = t, 'name'
            break
    prot_n = first_key(n, T['protein_words'])
    words = [w for w in n.split() if not w.isdigit()]
    if prot_n is None and words and first_key(' ' + words[0] + ' ', T['side_words']):
        return {'skip': 'a side dish'}
    fallback = False
    if typ is None:
        if has(n, T['exclude_weak']):
            return {'skip': 'not a main dish'}
        if prot_n is not None and prot_n not in ('cheese', 'tofu'):
            for t in T['types']:
                if has(d, t['words']):
                    typ, where = t, 'description'
                    break
            if typ is None:
                fallback, where = True, 'protein word in the name'
        elif first_key(d, T['protein_words']) not in (None, 'cheese', 'tofu') and first_key(d, T['side_words']) and not has(d, T['soup_words']):
            fallback, where = True, 'meat and side in the description'
        if fallback:
            typ = next(t for t in T['types'] if t['key'] == T['fallback_type'])
    if typ is None:
        return {'skip': 'dish type unknown'}
    meatless = has(n, T['meatless_words'])
    prot = prot_n or (None if meatless else first_key(d, T['protein_words']))
    mix = [list(x) for x in typ['mix']]
    k = typ['key']
    if k == 'pizza':
        if has(nd, typ['meat_words']):
            mix[0][0] = typ['meat_variant']
        if has(n, typ['slice_words']):
            mix[0][1] = typ['slice_g']
    elif k == 'burger':
        if meatless and typ.get('meatless_skip'):
            return {'skip': 'meat-free burger (no table value)'}
        if prot in ('chicken', 'chicken_breaded'):
            mix[0][0] = typ['chicken_variant']
        if has(n, ['menu', 'hranolk', 'fries']):
            mix.append(['fries', typ['menu_fries_g']])
    elif k == 'kebab':
        if has(n, typ['box_words']):
            mix = [list(x) for x in typ['box_mix']]
    elif k == 'wrap':
        if prot == 'chicken_breaded' or has(nd, ['krupav', 'smazen', 'crispy', 'strips']):
            mix[0][0] = typ['fried_variant']
        elif prot is None or meatless:
            mix[0][0] = typ['veg_variant']
    elif k == 'schnitzel':
        if has(n, typ['cheese_words']) and prot not in ('chicken', 'chicken_breaded', 'pork'):
            mix[0][0] = typ['cheese_variant']
    elif k == 'sushi':
        if has(nd, typ['tuna_words']):
            mix[0][0] = typ['tuna_variant']
    elif k in ('nuggets', 'strips'):
        if prot == 'cheese' and typ.get('cheese_variant'):
            mix[0][0] = typ['cheese_variant']
    elif k == 'pasta':
        if not has(nd, typ['meat_words']):
            mix = [list(x) for x in typ['plain_mix']]
    side_named = first_key(n, T['side_words']) or first_key(d, T['side_words'])
    out = []
    for comp, g in mix:
        if comp == '@protein':
            p = prot
            if meatless and p not in ('tofu', 'cheese'):
                p = 'none'
            if p is None:
                p = typ.get('default_protein', 'none')
            if p == 'none':
                continue
            comp = p
        elif comp == '@side':
            comp = side_named or typ['default_side']
        out.append([comp, float(g)])
    w_dish = w_meat = None
    if kind == 'meat':
        w_meat = parse_g(weight)
    else:
        w_dish = parse_g(weight)
    if w_dish is None and w_meat is None:
        w_meat = lead_g(name)
        if w_meat is None:
            w_meat = lead_g(desc)
    if w_meat is not None and typ.get('lead_g') == 'dish' and w_meat >= T['lead_dish_g_min']:
        w_dish, w_meat = w_meat, None
    if w_dish is None and w_meat is None:
        w_dish = parse_g(name)
        if w_dish is None:
            w_dish = parse_g(desc)
    # 19/10 (review): a meat-led dish (schnitzel, steak, grill, Czech sauce) with a small weight anywhere = the MEAT weight
    # ("Kuřecí řízek 150g", "Hovězí steak 200 g"): Czech menus state the meat weight of meat dishes; meat + side is rarely this light.
    if w_dish is not None and k in T['meat_led_types'] and w_dish <= T['meat_led_g_max']:
        w_dish, w_meat = None, w_dish
    cnt = piece = None
    if w_dish is None and w_meat is None and typ.get('piece_g'):
        cnt = count_of(n) or count_of(d)
        if cnt and cnt > T['pieces_max']:
            return {'skip': 'sharing size (%d pieces)' % cnt}
        if cnt:
            piece = typ['cheese_piece_g'] if (prot == 'cheese' and typ.get('cheese_piece_g')) else typ['piece_g']
            w_dish = cnt * piece
    if k == 'salad' and not any(c[0] in MEAT_COMPS for c in out) and not has(n, T['main_salad_words']):
        return {'skip': 'a side salad (no meat, fish, cheese or tofu named)'}
    if fallback and w_dish is None and w_meat is None and not side_named:
        return {'skip': 'meat word only, no weight or side'}
    if w_dish is None and w_meat is None and price is not None and price < T['min_meal_price']:
        return {'skip': 'too cheap for a full portion (a side or sauce)'}
    basis = 'type default portion'
    if w_dish is not None:
        if w_dish > T['share_g_max']:
            return {'skip': 'sharing size (%s g)' % planner.r(w_dish, 0)}
        if w_dish < T['weight_g_min']:
            return {'skip': 'too small for a meal (%s g)' % planner.r(w_dish, 0)}
        tot = 0.0
        for c in out:
            tot += c[1]
        f = w_dish / tot
        for c in out:
            c[1] = c[1] * f
        basis = ('%d pieces x %s g' % (cnt, piece)) if cnt else ('menu weight %s g' % planner.r(w_dish, 0))
    elif w_meat is not None:
        if w_meat < T['meat_weight_min']:
            return {'skip': 'too small for a meal (%s g meat)' % planner.r(w_meat, 0)}
        for c in out:
            if c[0] in MEAT_COMPS:
                c[1] = w_meat
                basis = 'meat weight %s g from the menu' % planner.r(w_meat, 0)
                break
    kcal = prot_g = grams = 0.0
    for comp, g in out:
        cv = T['components'][comp]
        kcal += cv['kcal'] * g / 100
        prot_g += cv['protein'] * g / 100
        grams += g
    return {'type': k, 'type_from': where, 'grams': planner.r(grams, 0), 'kcal': planner.r(kcal, 1), 'protein': planner.r(prot_g, 1),
            'mix': [[c, planner.r(g, 0)] for c, g in out], 'basis': basis, 'label': 'estimate'}


# ---------------------------------------------------------------- helpers
def rdir(rid):
    p = run_dir(rid)
    os.makedirs(p, exist_ok=True)
    return p


def dishes_path(rid):
    return os.path.join(rdir(rid), 'dishes.json')


def load_dishes(rid):
    p = dishes_path(rid)
    return load(p) if os.path.exists(p) else {'venues': {}, 'dishes': [], 'ledger': {}}


def place_of(r):
    loc = r.get('location') or {}
    d = load(os.path.join(DATA, 'shops', 'shops.json'))
    for name, L in d['locations'].items():
        if fold(name) == fold(loc.get('name')):
            return name, L
    return None, None


def restaurants_of(place):
    if not os.path.exists(REST_PATH):
        return None
    d = load(REST_PATH)
    for name, L in (d.get('locations') or {}).items():
        if fold(name) == fold(place):
            return L
    return None


def mode_of(r):
    m = r.get('mode')
    if m not in ('order', 'eatout'):
        raise SystemExit('ERROR: request mode is %s; dine.py does order and eatout (cook: tools/cook.py)' % m)
    return m


def words_of(r):
    return fold(' '.join(str(r.get(k) or '') for k in ('dislikes', 'allergies')))


def disliked(r, name, desc='', codes=(), T=None):
    """Dislikes/allergies typed by the person. (1) Every word of 4+ letters, cut to its stem (the word less its last 2 letters,
    at least 4: 'houby' -> 'houb' finds 'houbách'), anywhere in the dish name or description. (2) An allergy that names one of
    the 14 EU allergens (dish-table.json allergens, e.g. 'peanuts') refuses dishes with that allergen's dish words
    ('arašídy') or its number in the menu's allergen list (`codes`, menicka.cz). Returns the reason or None."""
    T = T or table()
    ws = [w for w in re.split(r'[^a-z0-9]+', words_of(r)) if len(w) >= 4]
    t = fold(name + ' ' + desc)
    nt = norm(name + ' ' + desc)
    for w in ws:
        stem = w[:max(4, len(w) - 2)]
        if stem in t:
            return 'dislike/allergy word "%s"' % w
    said = norm(str(r.get('allergies') or ''))
    for a in (T.get('allergens') or {}).get('list', []):
        if not has(said, a['input']):
            continue
        if a['code'] in codes:
            return 'allergen %s (%s) in the menu list' % (a['code'], a['name'])
        if has(nt, a['dish']):
            return 'allergen %s (%s) named in the dish' % (a['code'], a['name'])
    return None


ALLERGEN_RE = re.compile(r'^A:([0-9a-z,]+) ?')


def split_codes(desc):
    """menicka rows carry the menu's allergen numbers at the start of desc ('A:1,3,7 ...'): (codes, rest of desc)."""
    m = ALLERGEN_RE.match(desc or '')
    if not m:
        return (), desc or ''
    return tuple(re.sub(r'[a-z]', '', c) for c in m.group(1).split(',') if c), (desc or '')[m.end():]


# ---------------------------------------------------------------- terms: what the run reads, and read.js
def cmd_terms(rid):
    r = load_req(rid)
    mode = mode_of(r)
    place, L = place_of(r)
    out = {'id': rid, 'mode': mode, 'place': place or 'NOT SURVEYED', 'days': r.get('days'), 'meals_per_day': r.get('meals_per_day')}
    if not place:
        print(json.dumps(out, ensure_ascii=False, indent=1))
        return 0
    T = table()
    core = open(os.path.join(HERE, 'browser', 'dish-core.js'), encoding='utf-8').read()
    params = {'mode': mode, 'lat': L['lat'], 'lng': L['lng'], 'meals': r.get('meals_per_day') or 3, 'venues': SHORTLIST_VENUES, 'dishes': SHORTLIST_DISHES}
    if mode == 'order':
        params['max_min'] = (r.get('order') or {}).get('max_delivery_min') or 45
        out['rohlik_terms'] = READY_TERMS
        reader = open(os.path.join(HERE, 'browser', 'readers.js'), encoding='utf-8').read()
        out['sites'] = ['https://wolt.com/cs/cze/prague (source wolt)', 'https://www.foodora.cz/ (source foodora)']
    else:
        R = restaurants_of(place)
        if not R:
            out['restaurants'] = 'NOT SURVEYED'
            print(json.dumps(out, ensure_ascii=False, indent=1))
            return 0
        walk = (r.get('eatout') or {}).get('max_walk_min') or (r.get('location') or {}).get('walk_limit_min') or 15
        rs = [x for x in R['restaurants'] if isinstance(x.get('walk_min'), (int, float)) and x['walk_min'] <= walk and not x.get('closed_seen')]
        params['rests'] = [{'id': x['id'], 'name': x['name'], 'lat': x['lat'], 'lng': x['lng']} for x in rs]
        params['menicka'] = [{'rest': x['id'], 'url': x['menicka']} for x in rs if x.get('menicka')]
        out['restaurants_within_walk'] = len(rs)
        out['walk_limit_min'] = walk
        out['survey_walk_limit_min'] = R.get('surveyed_walk_min')
        out['with_daily_menu_page'] = len(params['menicka'])
        reader = open(os.path.join(HERE, 'browser', 'readers.js'), encoding='utf-8').read()
        out['sites'] = ['https://wolt.com/cs/cze/prague (source wolt: menus of the surveyed restaurants that are on Wolt)',
                        'https://www.foodora.cz/ (source foodora; skip it if a robot check shows)'] + (['https://www.menicka.cz/ (source menicka: daily lunch menus)'] if params['menicka'] else [])
    tab = json.dumps(browser_table(T), ensure_ascii=False, separators=(',', ':'))
    strip = lambda src: '\n'.join(ln.strip() for ln in src.split('\n') if ln.strip() and not ln.strip().startswith('//'))
    core, reader = strip(core), strip(reader)
    code = core + '\nMPD.T=' + tab + ';\n' + reader + '\n"read.js loaded"'
    p_json = json.dumps(params, ensure_ascii=False, separators=(',', ':'))
    p = os.path.join(rdir(rid), 'read.js')
    with open(p, 'w', encoding='utf-8') as f:
        f.write(code)
    # 19/10: storing the code in localStorage and eval-ing it later is blocked by Wolt's Content Security Policy (no 'unsafe-eval'),
    # so the run pastes the whole file with javascript_tool on every site (the tool itself is not bound by the page's policy).
    out['step_1_paste'] = 'data/runs/%s/read.js (%d characters): cat it and run its WHOLE text once with javascript_tool on each site (answer: "read.js loaded")' % (rid, len(code))
    out['step_2_start'] = 'MPR.params=%s;MPR.start("<source>")' % p_json
    out['step_3'] = 'MPR.status() every 10-20 s until "done", then MPR.write() and get_page_text'
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0


BROWSER_KEYS = ('components', 'exclude_strong', 'exclude_weak', 'share_g_max', 'weight_g_min', 'protein_words', 'meatless_words',
                'side_words', 'types', 'fallback_type', 'min_meal_price', 'meat_weight_min', 'lead_dish_g_min', 'price_floor_any', 'soup_words',
                'meat_led_types', 'meat_led_g_max', 'pieces_max', 'main_salad_words')


def browser_table(T):
    """The part of dish-table.json that read.js carries (components without names and FDC numbers, to keep the paste short)."""
    out = {k: T[k] for k in BROWSER_KEYS}
    out['components'] = {k: {'kcal': v['kcal'], 'protein': v['protein']} for k, v in T['components'].items()}
    return out


# ---------------------------------------------------------------- ingest
def cmd_ingest(rid, src, tsv):
    r = load_req(rid)
    T = table()
    doc = load_dishes(rid)
    seen = now_iso()
    rows = tsv_rows(tsv, ['term', 'id', 'name', 'price'] if src == 'rohlik' else ['kind', 'venue', 'item', 'dish', 'price'])
    kept = refused = 0
    why = {}
    doc['dishes'] = [x for x in doc['dishes'] if x['source'] != src]
    for k in [k for k, v in doc['venues'].items() if v['source'] == src]:
        del doc['venues'][k]

    def refuse(reason):
        nonlocal refused
        refused += 1
        why[reason] = why.get(reason, 0) + 1

    if src == 'rohlik':
        doc['venues']['rohlik'] = {'source': 'rohlik', 'name': 'Rohlík.cz ready meals', 'eta_min': None, 'eta_max': None, 'fee': None,
                                   'min_order': 749, 'service_pct': 0, 'service_min': 0, 'open': 'delivery slots', 'url': 'https://www.rohlik.cz/',
                                   'seen': seen}
        ids = set()
        for x in rows:
            pid = str(x.get('id') or '').strip()
            if not pid or pid in ids:
                continue
            ids.add(pid)
            price = numf(x.get('price'))
            g = parse_g(x.get('amount'))
            kc, pr = numf(x.get('kcal')), numf(x.get('protein'))
            if str(x.get('in_stock')).lower() != 'true':
                refuse('sold out')
                continue
            if not price or price <= 0:
                refuse('no price')
                continue
            if g is None or g < READY_G[0] or g > READY_G[1]:
                refuse('not one ready-meal pack (%s-%s g)' % READY_G)
                continue
            if kc is None or pr is None:
                refuse('no nutrition label')
                continue
            e = estimate(x.get('name') or '', '', '', 'dish', T)  # type check only: Rohlík gives the label
            if 'skip' in e:
                refuse('not a ready meal: ' + e['skip'])
                continue
            if disliked(r, x.get('name') or '', '', (), T):
                refuse('dislike or allergy')
                continue
            doc['dishes'].append({'source': 'rohlik', 'venue': 'rohlik', 'item': pid, 'name': x.get('name'), 'price': price,
                                  'regular_price': numf(x.get('original_price')) or price, 'grams': g,
                                  'kcal': planner.r(kc * g / 100, 1), 'protein': planner.r(pr * g / 100, 1), 'label': 'exact',
                                  'basis': 'Rohlík label %s kcal, %s g protein per 100 g, pack %s g' % (kc, pr, planner.r(g, 0)),
                                  'url': 'https://www.rohlik.cz/%s' % pid, 'seen': seen})
            kept += 1
    else:
        if not any(x.get('kind') == 'L' for x in rows):
            raise SystemExit('ERROR: %s has no L (ledger) row: the copy of the table is cut off; copy it again (nothing ingested)' % tsv)
        for x in rows:
            if x.get('kind') == 'V':
                key = '%s:%s' % (src, x.get('venue'))
                doc['venues'][key] = {'source': src, 'name': x.get('venue_name'), 'lat': numf(x.get('lat')), 'lng': numf(x.get('lng')),
                                      'eta_min': numf(x.get('eta_min')), 'eta_max': numf(x.get('eta_max')), 'fee': numf(x.get('fee')),
                                      'min_order': numf(x.get('min_order')), 'service_pct': numf(x.get('service_pct')) or 0,
                                      'service_min': numf(x.get('service_min')) or 0, 'open': x.get('open') or '', 'url': x.get('url') or '',
                                      'rest': x.get('rest') or None, 'seen': seen}
        for x in rows:
            if x.get('kind') != 'D':
                if x.get('kind') == 'L':
                    doc['ledger'][src] = x.get('desc')
                continue
            key = '%s:%s' % (src, x.get('venue'))
            if key not in doc['venues']:
                refuse('venue row missing')
                continue
            price = numf(x.get('price'))
            if not price or price <= 0:
                refuse('no price (menu with choices)')
                continue
            kind = 'meat' if src == 'menicka' else 'dish'
            codes, desc = split_codes(x.get('desc') or '')
            e = estimate(x.get('dish') or '', desc, x.get('weight') or '', kind, T, price)
            if 'skip' in e:
                refuse(e['skip'])
                continue
            if disliked(r, x.get('dish') or '', desc, codes, T):
                refuse('dislike or allergy')
                continue
            doc['dishes'].append({'source': src, 'venue': key, 'item': x.get('item'), 'name': x.get('dish'), 'price': price, 'regular_price': price,
                                  'grams': e['grams'], 'kcal': e['kcal'], 'protein': e['protein'], 'label': 'estimate',
                                  'basis': '%s, %s, USDA FNDDS mix %s' % (e['type'], e['basis'], ' + '.join('%s %s g' % (c, g) for c, g in e['mix'])),
                                  'url': item_url(src, doc['venues'][key], x), 'seen': seen, 'desc': desc[:160],
                                  'allergens': list(codes) if src == 'menicka' else None})
            kept += 1
    doc['ledger']['%s_rows' % src] = len(rows)
    write_new(dishes_path(rid), doc)
    print(json.dumps({'source': src, 'rows': len(rows), 'dishes_kept': kept, 'refused': refused, 'why': why,
                      'venues': len([1 for v in doc['venues'].values() if v['source'] == src])}, ensure_ascii=False))
    return 0


def item_url(src, v, x):
    base = v.get('url') or ''
    if src == 'wolt' and base and x.get('item'):
        return base + '/itemid-' + x['item']
    return base


# ---------------------------------------------------------------- options
def day_set(cands, m, tP, tK):
    """The cheapest set of m different dishes (a dish twice only when the venue has fewer than m) that reaches 90 % of protein and kcal a day; if none does, the set closest
    to the targets (mean cover), then the cheapest. Returns (dishes, protein, kcal, cost)."""
    best = None
    pool = cands[:]
    rep = 1 if len(pool) >= m else 2   # a dish once a day when the venue has enough dishes, else at most twice
    for combo in combinations_with_replacement(range(len(pool)), m):
        if any(combo.count(i) > rep for i in set(combo)):
            continue
        P = K = C = 0.0
        for i in combo:
            P += pool[i]['protein']
            K += pool[i]['kcal']
            C += pool[i]['price']
        ok = P >= 0.9 * tP - planner.EPS and K >= 0.9 * tK - planner.EPS
        cover = (min(1.0, P / tP) + min(1.0, K / tK)) / 2
        key = (0, C, 0) if ok else (1, -planner.r(cover, 4), C)
        if best is None or key < best[0]:
            best = (key, combo, P, K, C)
    if best is None:
        return None
    return [pool[i] for i in best[1]], best[2], best[3], best[4]


def shortlist(ds):
    """Dishes worth combining: best protein per CZK and best kcal per CZK (12 + 4), so the search stays small."""
    a = sorted(ds, key=lambda x: (-x['protein'] / x['price'], x['price'], str(x['item'])))[:12]
    b = sorted(ds, key=lambda x: (-x['kcal'] / x['price'], x['price'], str(x['item'])))[:4]
    out, seen = [], set()
    for x in a + b:
        k = (x['venue'], str(x['item']), x['name'])
        if k not in seen:
            seen.add(k)
            out.append(x)
    return out


def targets_used(r):
    """The day's targets shared out to the meals this request covers: 2 of his 4 meals a day = half the protein and kcal.
    His usual meals a day come from his profile (cooking.meals_per_day, read only)."""
    tP = planner.num((r.get('targets') or {}).get('protein_g')) or 1
    tK = planner.num((r.get('targets') or {}).get('kcal')) or 1
    m = int(r.get('meals_per_day') or 3)
    # his usual meals a day: the request's own copy (meals_usual, written by the app since 19/10), else his profile, else 3
    # (the app's own default for meals a day, app.js newRequest). 19/10 review: before, a missing profile meant share 1.
    usual, src = planner.num(r.get('meals_usual')), 'request'
    if not usual:
        p = os.path.join(DATA, 'users', str(r.get('user_id')), 'profile.json')
        if os.path.exists(p):
            usual, src = planner.num(((load(p).get('cooking') or {}).get('meals_per_day'))), 'profile'
    if not usual:
        usual, src = 3, 'default 3'
    usual = int(usual)
    share = min(1.0, m / usual)
    return {'protein_g': planner.r(tP * share, 1), 'kcal': planner.r(tK * share, 0), 'meals': m, 'meals_usual': usual,
            'meals_usual_from': src, 'share': planner.r(share, 4), 'day_protein_g': tP, 'day_kcal': tK}


def cmd_options(rid):
    r = load_req(rid)
    mode = mode_of(r)
    doc = load_dishes(rid)
    days = int(r.get('days') or 1)
    m = int(r.get('meals_per_day') or 3)
    tu = targets_used(r)
    tP, tK = tu['protein_g'], tu['kcal']
    place, L = place_of(r)
    max_min = int((r.get('order') or {}).get('max_delivery_min') or 45)
    too_few = []
    by_venue = {}
    for x in doc['dishes']:
        by_venue.setdefault(x['venue'], []).append(x)
    opts = []
    if mode == 'order':
        for key, v in doc['venues'].items():
            ds = by_venue.get(key) or []
            if not ds:
                continue
            got = day_set(shortlist(ds), m, tP, tK)
            if not got:
                too_few.append('%s (%d dishes)' % (v['name'], len(ds)))
                continue
            chosen, P, K, C = got
            notes = []
            if v['source'] == 'rohlik':
                per_plan = C * days
                fee = None
                kind_note = ('Rohlík ready meals: one delivery for the whole plan (chilled; check the use-by dates on arrival), %d minutes to heat '
                             'each meal. Delivery fee is shown in the cart (time slot), not counted here.' % HEAT_MIN_PER_MEAL)
                notes.append(kind_note)
                mo = v.get('min_order') or 0
                if per_plan < mo:
                    # 19/10 review: the minimum is now COUNTED, as for Wolt (he pays it, or tops the order up with other shopping)
                    notes.append('The plan\'s meals (%.2f CZK) are below Rohlík\'s %.2f CZK minimum to the door: counted as the minimum '
                                 '(the %.2f CZK difference can be other shopping; 500 CZK at a Rohlik Point).' % (per_plan, mo, mo - per_plan))
                    per_plan = mo
                cost_day = per_plan / days
                minutes = HEAT_MIN_PER_MEAL * m + ORDER_MIN_PER_DAY / days
                deliv = None
            else:
                fee = v['fee']
                svc = 0.0
                if v['service_pct']:
                    svc = max(v['service_min'] or 0, C * v['service_pct'] / 100)
                food = C
                if v['min_order'] and food < v['min_order']:
                    notes.append('The day\'s dishes (%.2f CZK) are below the minimum order %.2f CZK: counted as the minimum.' % (food, v['min_order']))
                    food = v['min_order']
                cost_day = food + (fee or 0) + svc
                if v['fee'] is None:
                    notes.append('Delivery fee not shown before the basket: counted as 0 CZK here (unknown, not free); the basket shows it.')
                else:
                    notes.append('Delivery fee %.2f CZK as shown on %s at %s (not logged in, can be a promotion; the basket decides).' % (fee, v['source'], v['seen'][11:16]))
                if svc:
                    notes.append('Service fee %.2f CZK (%s %%).' % (svc, planner.r(v['service_pct'], 1)))
                notes.append('One delivery a day with all %d dishes; dishes for later go in the fridge (%d minutes to order, %d to heat each later dish).'
                             % (m, ORDER_MIN_PER_DAY, HEAT_MIN_PER_MEAL))
                if v.get('open'):
                    notes.append('At read time: %s.' % v['open'])
                lo, hi = v['eta_min'], v['eta_max']
                if lo is None or hi is None or lo == hi:
                    one = hi if hi is not None else lo
                    deliv = int(one) if one is not None else None
                else:
                    deliv = '%d-%d' % (lo, hi)
                eta = hi if hi is not None else lo
                if eta is None:
                    # 19/10 review: no time shown used to count as 0 minutes (best speed score); now the request's own limit
                    eta = max_min
                    notes.append('No delivery time shown: counted as %d minutes (the most this request allows).' % max_min)
                minutes = ORDER_MIN_PER_DAY + eta + HEAT_MIN_PER_MEAL * (m - 1)
            label = 'estimate' if any(x['label'] == 'estimate' for x in chosen) else 'exact'
            o = make_option(v, chosen, P, K, cost_day, days, minutes, label, notes, deliv, fee, key, tP, tK, mode)
            o['service_pct'], o['service_min'] = v.get('service_pct') or 0, v.get('service_min') or 0
            opts.append(o)
    else:
        R = restaurants_of(place) or {'restaurants': []}
        walk = (r.get('eatout') or {}).get('max_walk_min') or (r.get('location') or {}).get('walk_limit_min') or 15
        for rest in R['restaurants']:
            if not isinstance(rest.get('walk_min'), (int, float)) or rest['walk_min'] > walk or rest.get('closed_seen'):
                continue
            keys = [k for k, v in doc['venues'].items() if v.get('rest') == rest['id']]
            ds = []
            for k in keys:
                ds += by_venue.get(k) or []
            minutes = m * 2 * rest['walk_min']
            v = {'source': 'eatout', 'name': rest['name'], 'url': rest.get('url') or rest.get('website') or ''}
            notes = []
            if not ds:
                notes.append('No menu online%s: price unknown, shown but not scored.' % (
                    (' (Google price band %s per person)' % rest['price_band']) if rest.get('price_band') else ''))
                o = make_option(v, [], 0, 0, None, days, minutes, 'estimate', notes, None, None, 'R:' + rest['id'], tP, tK, mode)
                o.update(eatout_fields(rest))
                opts.append(o)
                continue
            got = day_set(shortlist(ds), m, tP, tK)
            if not got:
                # 19/10 review: fewer kept dishes than half the meals a day used to crash here (a dish at most twice a day)
                too_few.append('%s (%d dishes)' % (rest['name'], len(ds)))
                notes.append('Only %d dish(es) online that pass the checks, too few for %d meals a day (a dish at most twice a day): shown but not scored.' % (len(ds), m))
                o = make_option(v, [], 0, 0, None, days, minutes, 'estimate', notes, None, None, 'R:' + rest['id'], tP, tK, mode)
                o.update(eatout_fields(rest))
                opts.append(o)
                continue
            chosen, P, K, C = got
            srcs = sorted({x['source'] for x in chosen})
            if 'menicka' in srcs:
                notes.append('Daily lunch menu of %s (menicka.cz): that day at lunch only; other days have other dishes at similar prices.' % chosen[0]['seen'][:10])
            if 'wolt' in srcs or 'foodora' in srcs:
                notes.append('Prices from the restaurant\'s %s delivery menu: at the table they can be lower.' % ' and '.join(s for s in srcs if s != 'menicka'))
            notes.append('Walk %s min each way, %d meal(s) a day there.' % (planner.r(rest['walk_min'], 0), m))
            o = make_option(v, chosen, P, K, C, days, minutes, 'estimate', notes, None, None, 'R:' + rest['id'], tP, tK, mode)
            o.update(eatout_fields(rest))
            opts.append(o)
    opts.sort(key=lambda o: (o['cost_regular'] is None, (o['cost_regular'] or 0), o['_key']))
    for i, o in enumerate(opts):
        o['id'] = 'O%d' % (i + 1)
    out = {'id': rid, 'mode': mode, 'place': place, 'targets_used': tu, 'need': {'protein_g': planner.r(tP * days, 1), 'kcal': planner.r(tK * days, 1)},
           'venues_read': len(doc['venues']), 'dishes_estimated': len(doc['dishes']), 'ledger': doc.get('ledger'),
           'too_few_dishes': too_few, 'options': opts}
    write_new(os.path.join(rdir(rid), 'options.json'), out)
    for o in opts:
        print('%-4s %-48s %10s CZK/day  P %6s g  kcal %6s  %s min  %s' % (o['id'], o['label'][:48], 'n/a' if o['cost_regular'] is None else planner.r(o['cost_regular'] / days, 2),
                                                                     o['protein_g_per_day'], o['kcal_per_day'], o['minutes_per_day'], o['nutrition_label']))
    print(json.dumps({'options': len(opts), 'venues_read': out['venues_read'], 'dishes_estimated': out['dishes_estimated'], 'too_few_dishes': too_few},
                     ensure_ascii=False))
    return 0


def eatout_fields(rest):
    return {'walk_min': rest.get('walk_min'), 'distance_m': rest.get('distance_m'), 'route_url': rest.get('route_url'),
            'stores': [{'id': rest['id'], 'name': rest['name'], 'address': rest.get('address')}], 'price_band': rest.get('price_band')}


def make_option(v, chosen, P, K, cost_day, days, minutes, label, notes, deliv, fee, key, tP, tK, mode):
    items = []
    agg = {}
    for x in chosen:
        k = (x['venue'], str(x['item']), x['name'])
        if k not in agg:
            agg[k] = dict(x, packs=0)
            items.append(agg[k])
        agg[k]['packs'] += 1
    its = [{'id': '%s:%s' % (x['source'], x['item']), 'name': x['name'], 'packs': x['packs'] * days, 'packs_per_day': x['packs'],
            'cost': planner.r(x['price'] * x['packs'] * days, 2), 'price': x['price'], 'shop': x['source'], 'product_id': x['item'],
            'protein_g': planner.r(x['protein'] * x['packs'], 1), 'kcal': planner.r(x['kcal'] * x['packs'], 1), 'grams': x['grams'],
            'nutrition_label': x['label'], 'basis': x['basis'], 'url': x.get('url'), 'price_label': x['source'] if mode == 'order' else ('daily_menu' if x['source'] == 'menicka' else 'delivery_menu')}
           for x in items]
    eatP, eatK = min(P, tP), min(K, tK)
    if chosen:
        notes.append('Nutrition: %s.' % ('Rohlík\'s own labels (exact)' if label == 'exact' else 'estimated from the dish name and weight with USDA food tables (estimate, can be 20-30 % off)'))
        if K > tK * 1.1:
            notes.append('The day\'s dishes hold %d kcal (target %d): eat to the target, the rest is extra.' % (K, tK))
    kind = 'order' if mode == 'order' else 'eatout'
    seen = max((x['seen'] for x in chosen), default=None)
    o = {'_key': key, 'label': v['name'], 'kind': kind, 'shop': v['source'], 'days': days,
         'cost_regular': None if cost_day is None else planner.r(cost_day * days, 2), 'card_savings': [],
         'protein_g_per_day': planner.r(eatP, 1), 'kcal_per_day': planner.r(eatK, 1), 'bought_protein_g': planner.r(P * days, 1),
         'bought_kcal': planner.r(K * days, 1), 'minutes_per_day': planner.r(minutes, 1), 'taste': 3, 'nutrition_label': label,
         'price_seen': seen, 'price_label': v['source'], 'delivery_min': deliv, 'delivery_fee': fee, 'min_order': v.get('min_order'),
         'items': its, 'recipes': [], 'cart': {'shop': v['source'], 'url': v.get('url') or '', 'filled': False}, 'notes': ' '.join(n for n in notes if n)}
    return o


# ---------------------------------------------------------------- basket
def cmd_basket(rid, oid, tsv):
    """The basket the run filled, against the plan. Lines with the same item id are added up (the same dish twice with
    different choices). Optional rows item=_delivery_fee / _service_fee (line_price = the fee the basket shows) replace the
    fees seen on the menu. The cost is then re-counted the same way the option was: dishes topped up to the minimum order,
    plus the fees (19/10, review: before, the minimum and the fees of the basket were ignored)."""
    p = os.path.join(rdir(rid), 'options.json')
    doc = load(p)
    o = next((x for x in doc['options'] if x['id'] == oid), None)
    if not o:
        raise SystemExit('ERROR: option %s not in options.json' % oid)
    rows, fees = {}, {}
    for x in tsv_rows(tsv, ['item', 'qty', 'line_price']):
        it = str(x['item']).strip()
        if it in ('_delivery_fee', '_service_fee'):
            fees[it] = numf(x.get('line_price'))
            continue
        q, lp = numf(x.get('qty')) or 0, numf(x.get('line_price'))
        g = rows.setdefault(it, {'qty': 0, 'line_price': 0.0, 'lines': 0, 'price_known': True})
        g['qty'] += q
        g['lines'] += 1
        if lp is None:
            g['price_known'] = False
        else:
            g['line_price'] += lp
    days = o['days'] or 1
    whole = o['shop'] == 'rohlik'
    total, problems = 0.0, []
    plan = 0.0
    planned_ids = set()
    for it in o['items']:
        want = it['packs'] if whole else it['packs_per_day']
        plan += it['price'] * want
        planned_ids.add(str(it['product_id']))
        x = rows.get(str(it['product_id']))
        if not x:
            problems.append('%s: not in the basket' % it['name'])
            continue
        q = x['qty']
        if q != want:
            problems.append('%s: basket has %g, plan %g' % (it['name'], q, want))
        if x['price_known']:
            total += x['line_price']
            if q:
                it['price'] = planner.r(x['line_price'] / q, 2)
                it['cost'] = planner.r(it['price'] * it['packs'], 2)
                it['price_label'] = 'basket'
    extra = [k for k in rows if k not in planned_ids]
    if extra:
        problems.append('in the basket but not in the plan: %s (not counted; his own lines from before?)' % ', '.join(extra))
    diff = (total - plan) / plan * 100 if plan else 0
    limit = planner.num(((load_req(rid).get('rules') or {}).get('replan_if_cart_off_pct'))) or 10
    replan = abs(diff) > limit
    if '_delivery_fee' in fees and fees['_delivery_fee'] is not None:
        o['delivery_fee'] = fees['_delivery_fee']
    mo = o.get('min_order') or 0
    if o['cost_regular'] is not None and plan:
        if whole:
            o['cost_regular'] = planner.r(max(total, mo), 2)
        else:
            food = max(total, mo)
            if '_service_fee' in fees and fees['_service_fee'] is not None:
                svc = fees['_service_fee']
            else:
                svc = max(o.get('service_min') or 0, total * (o.get('service_pct') or 0) / 100) if o.get('service_pct') else 0.0
            o['cost_regular'] = planner.r((food + (o.get('delivery_fee') or 0) + svc) * days, 2)
    o['cart'] = dict(o.get('cart') or {}, filled=not problems, cart_total_ours=planner.r(total, 2), plan_before_cart=planner.r(plan, 2),
                     diff_pct=planner.r(diff, 1), problems=problems, covers='the whole plan' if whole else 'day 1 (order again each day)',
                     fees_from_basket={k[1:]: v for k, v in fees.items()})
    o['notes'] += (' Basket checked: %.2f CZK vs %.2f planned (%.1f %%)%s.' % (total, plan, diff, '' if whole else ', day 1'))
    if mo and total < mo:
        o['notes'] += ' The basket is below the %.2f CZK minimum order: counted as the minimum.' % mo
    if replan:
        o['notes'] += ' More than %s %% off the plan: costs now use the basket prices; re-plan suggested.' % limit
    o['price_seen'] = now_iso()
    write_new(p, doc)
    print(json.dumps({'option': oid, 'basket_total_ours': planner.r(total, 2), 'planned': planner.r(plan, 2), 'diff_pct': planner.r(diff, 1),
                      'cost_regular': o['cost_regular'], 'replan_needed': replan, 'problems': problems}, ensure_ascii=False))
    return 0


# ---------------------------------------------------------------- result
def cmd_result(rid, extras_path):
    r = load_req(rid)
    doc = load(os.path.join(rdir(rid), 'options.json'))
    ex = load(extras_path) if extras_path else {}
    opts = []
    for o in doc['options']:
        e = dict(ex.get('_all') or {})
        e.update(ex.get(o['id']) or {})
        o = dict(o)
        o.pop('_key', None)
        if 'taste' in e:
            o['taste'] = e['taste']
        if e.get('notes'):
            o['notes'] = (o.get('notes') or '') + ' ' + e['notes']
        o['notes'] = (o.get('notes') or '').strip()
        opts.append(o)
    res = {'id': rid, 'request': r, 'finished': now_iso(), 'status': 'done', 'options': opts, 'targets_used': doc.get('targets_used'),
           'need': doc.get('need'), 'place': doc.get('place'),
           'venues_read': doc.get('venues_read'), 'dishes_estimated': doc.get('dishes_estimated'), 'ledger': doc.get('ledger')}
    tu = doc.get('targets_used')
    ctx = {'targets': {'protein_g': tu['protein_g'], 'kcal': tu['kcal']} if tu else r.get('targets'), 'weights': r.get('weights'), 'cards': r.get('cards'), 'budget_per_day': r.get('budget_per_day')}
    res['scored'] = planner._jsnum(planner.score(opts, ctx))
    write_new(os.path.join(DATA, 'results', rid + '.json'), res)
    print(json.dumps({'written': 'data/results/%s.json' % rid, 'options': len(opts), 'picks': res['scored']['picks'],
                      'top5': [(x['id'], x.get('total'), x.get('cost_per_day')) for x in res['scored']['ranked'][:5]]}, ensure_ascii=False))
    return 0


# ---------------------------------------------------------------- survey of restaurants (once per place, like shops)
NOT_FOOD_NOTE = 'Food places only: shops, cafes without meals, bars without food, sweets, hotels, clubs and playgrounds are left out by hand at survey time.'


def cmd_survey(place, tsv, walk_col, m_col, walk_limit):
    """Raw survey rows (Google Maps place + OpenStreetMap foot router walk) -> data/shops/restaurants.json for one place.
    TSV columns: name lat lng place_id <walk_col> <m_col> menicka note (walk in minutes, distance in metres; other places' columns ignored)."""
    d = load(os.path.join(DATA, 'shops', 'shops.json'))
    L = None
    for name, x in d['locations'].items():
        if fold(name) == fold(place):
            place, L = name, x
    if not L:
        raise SystemExit('ERROR: %s has no shop survey (shops.json); survey the place first' % place)
    rests = []
    for x in tsv_rows(tsv, ['name', 'lat', 'lng', walk_col]):
        wm = numf(x.get(walk_col))
        if wm is None or wm > walk_limit:
            continue
        lat, lng = numf(x.get('lat')), numf(x.get('lng'))
        pid = (x.get('place_id') or '').strip()
        rests.append({'name': x['name'].strip(), 'lat': lat, 'lng': lng, 'walk_min': planner.r(wm, 1), 'distance_m': numf(x.get(m_col)),
                      'maps_url': 'https://www.google.com/maps/search/?api=1&query=%s,%s&query_place_id=%s' % (lat, lng, pid) if pid else None,
                      'route_url': 'https://www.google.com/maps/dir/?api=1&origin=%s,%s&destination=%s,%s&travelmode=walking' % (L['lat'], L['lng'], lat, lng),
                      'menicka': (x.get('menicka') or '').strip() or None, 'note': (x.get('note') or '').strip() or None})
    rests.sort(key=lambda r: (r['walk_min'], r['name']))
    for i, r in enumerate(rests):
        r['id'] = 'R%03d' % (i + 1)
    doc = load(REST_PATH) if os.path.exists(REST_PATH) else {'version': 1, 'method': 'cards/google-maps.md, section Restaurants', 'locations': {}}
    doc['locations'][place] = {'name': place, 'lat': L['lat'], 'lng': L['lng'], 'surveyed': now_iso(), 'surveyed_walk_min': walk_limit,
                               'walk_source': 'OpenStreetMap foot router (routing.openstreetmap.de, OSRM), from the place to each restaurant',
                               'note': NOT_FOOD_NOTE, 'restaurants': rests}
    write_new(REST_PATH, doc)
    print(json.dumps({'place': place, 'restaurants': len(rests), 'within_10': len([r for r in rests if r['walk_min'] <= 10]),
                      'within_15': len([r for r in rests if r['walk_min'] <= 15]), 'with_daily_menu_page': len([r for r in rests if r['menicka']])},
                     ensure_ascii=False))
    return 0


def main(argv):
    if len(argv) < 2 or argv[1] in ('-h', '--help'):
        print(__doc__)
        return 0
    cmd, a = argv[1], argv[2:]
    o = cook.opt
    if cmd == 'terms':
        return cmd_terms(a[0])
    if cmd == 'ingest':
        return cmd_ingest(a[0], o(a, '--source'), o(a, '--tsv'))
    if cmd == 'options':
        return cmd_options(a[0])
    if cmd == 'basket':
        return cmd_basket(a[0], o(a, '--option'), o(a, '--tsv'))
    if cmd == 'result':
        return cmd_result(a[0], o(a, '--extras'))
    if cmd == 'estimate':
        pr = o(a, '--price')
        skip = {i for i, x in enumerate(a) if x == '--price' or (i and a[i - 1] == '--price')}
        pos = [x for i, x in enumerate(a) if not x.startswith('--') and i not in skip]
        print(json.dumps(estimate(pos[0], pos[1] if len(pos) > 1 else '', pos[2] if len(pos) > 2 else '', 'meat' if '--meat' in a else 'dish',
                                  None, numf(pr) if pr is not None else None), ensure_ascii=False))
        return 0
    if cmd == 'survey':
        return cmd_survey(a[0], o(a, '--tsv'), o(a, '--walk-col'), o(a, '--m-col'), numf(o(a, '--walk-limit', '25')))
    print('unknown command', cmd)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
