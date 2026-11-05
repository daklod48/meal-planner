"""Meal Planner. Builds data/shops/shops.json for the places surveyed in build session 2 (19/10/2026).

It is a RECORD of how the first survey was turned into data, and a pattern for the next place:
copy it, change LOC, the survey files and the delivery tables, run it. Survey method: cards/google-maps.md.

Run (from the MealPlanner folder):
  python3 tools/build_shops.py <raw_survey.tsv> [<extra.tsv> ...] --out data/shops/shops.json
Survey TSV columns (tab separated, no header): id, name, Google category, address, lat, lng, hours
("Mo-Fr 07-20, Sa-Su closed" or "?"), walk from B "min/km" or "-", walk from C, tram/bus min from B or "-",
tram/bus from C, website.
"""
import csv, json, re, sys
from collections import Counter

LOC = {
    'B': {'name': 'Blanice kolej', 'address': 'Chemická 955, 148 00 Praha-Kunratice (Kolej Blanice VŠE)',
          'lat': 50.0199375, 'lng': 14.4978125, 'plus_code': '2F9X+X4 Praha'},
    'C': {'name': 'Westfield Chodov', 'address': 'Roztylská 2321/19, 148 00 Praha 11-Chodov',
          'lat': 50.0304375, 'lng': 14.4906875, 'plus_code': '2FJR+57 Praha'},
}
SURVEYED = '2026-10-19T08:42:00+02:00'        # last reading of this survey (delivery lookups 08:00-08:42)
WALK_SURVEYED = '2026-10-19, 00:00-02:00 (Prague)'
TRANSIT_WHEN = 'Tuesday 20/10/2026 10:00'
SEEN = '2026-10-19T08:40:00+02:00'            # delivery fees and times read 08:00-08:42

EXCLUDE = {
    'S002': 'bistro (eat-out, session 4)', 'S005': 'restaurant (eat-out, session 4)',
    'S026': 'Isostar distributor office, not a shop',
    'S029': 'MOL petrol station shop (snacks); kept out, while Billa stop & shop S081 at a petrol station stays because it is a Billa',
    'S037': 'same shop as S036 (Benkova 850/26), listed twice on Google',
    'S041': 'same Google place as S040', 'S064': 'Google showed it closed every day (19/10)',
    'S080': 'café', 'S082': 'Roztylské náměstí, a square; its Saturday farmers market is S078 (36 min walk from Chodov, outside 30 min)',
    'S060': 'coffee roaster only', 'S028': 'same address as S027 (Hornomlýnská 1240), listed twice',
}
NOTES = {
    'S027': 'Google lists this address twice: "Supermarket" 08:00-21:00 and "Večerka" 08:00-20:30.',
    'S030': 'Google hours look wrong (open only on Thursday, 24 h); check before going.',
    'S023': 'Fish shop (Pražské rybářství). Google gives no opening hours.',
    'S052': 'Strawberry farm stand, seasonal. Google gives no opening hours.',
    'S053': 'Google gives no opening hours.',
    'S066': 'Market days only; see trhynatylaku.cz. Google gives no opening hours.',
    'S014': 'Truffle delicatessen and e-shop (tartuf.cz); not a staple-food shop.',
    'S043': 'BioDay has an e-shop with prices, but this Opatov shop is not on bioday.cz\'s store list (19/10): prices here unknown.',
    'S081': 'Billa stop & shop at a petrol station on Jižní spojka, open 24 h. The Billa leaflet does not apply to Stop & Shop stores.',
    'S021': 'Billa stop & shop: the Billa leaflet does not apply to Stop & Shop stores (billa.cz).',
    'S001': 'Delmart range is sold online through Košík (kosik.cz/c5929-delmart) and Wolt; those prices can differ from the shelf here.',
    'S040': 'Prices online are Tesco Online prices; the shelf here can differ.',
    'S069': 'Prices online are Tesco Online prices; the shelf here can differ.',
    'F02': 'Nearest Globus; hours from globus.cz (hypermarket Mon-Sun 07:30-21:00). Full price list for this store on globus.cz.',
    'F04': 'Second Lidl; Lidl Vojtíškova (S019) is closer to both places.',
    'S010': 'Albert hypermarket inside Westfield Chodov.',
    'S007': 'MUUU butcher; sells online only through Rohlík and Košík (muuupisek.cz).',
    'S008': 'Moje Kredenc deli; no online prices (mojekredenc.cz).',
    'S003': 'Rodinná farma; website being redesigned, no prices online (19/10).',
    'S009': 'Westfield lists M&S under food shops; M&S stopped selling chilled food in Czechia in 2021 (frozen and dry food only, cc.cz). Google calls it a clothing store.',
    'S077': 'ZEMAN butcher chain (prodejnyzeman.cz: weekly promotions online); also on Wolt.',
    'S072': 'ZEMAN butcher chain (prodejnyzeman.cz: weekly promotions online); also on Wolt.',
    'Z01': 'Nearest Žabka (convenience chain) from Blanice; hours from Google.',
    'Z02': 'Nearest Žabka (convenience chain) from Chodov; hours from Google.',
    'W01': 'Listed by westfield.com among the mall\'s food shops (not found in the Google search). Walking time copied from DELMART in the same mall. Hours: westfield.com.',
    'W02': 'Listed by westfield.com among the mall\'s food shops (not found in the Google search). Walking time copied from DELMART in the same mall. Hours: westfield.com.',
}
HOURS_FIX = {'F02': 'Mo-Su 07:30-21:00'}
TRANSIT_ADD = {('S077', 'B'): 19, ('S072', 'C'): 18}    # read 19/10 morning, Tuesday 10:00

MAJOR = ['albert', 'billa', 'lidl', 'penny', 'tesco', 'kaufland', 'globus', 'norma', 'delmart']
NEAREST_ONLY = ['zabka', 'zeman']                         # small chains: their nearest store is kept with tram/bus time
CARD = {'albert': 'albert', 'billa': 'billa-club', 'lidl': 'lidl-plus', 'penny': 'penny', 'tesco': 'tesco-clubcard',
        'kaufland': 'kaufland-card', 'rohlik': 'rohlik-xtra'}
PRICES = {'albert': 'leaflet', 'billa': 'leaflet', 'lidl': 'leaflet', 'penny': 'leaflet', 'kaufland': 'leaflet',
          'norma': 'leaflet', 'tesco': 'online_other', 'globus': 'yes', 'delmart': 'online_other', 'zeman': 'leaflet',
          'tartuf': 'yes'}
PRICES_FIX = {'S021': 'no', 'S081': 'no'}
CARD_FILE = dict({c: 'cards/%s.md' % c for c in MAJOR})


def chain_of(name, cat):
    n = name.lower()
    for key, words in [('albert', ['albert']), ('billa', ['billa']), ('lidl', ['lidl']), ('penny', ['penny']),
                       ('tesco', ['tesco']), ('kaufland', ['kaufland']), ('globus', ['globus']), ('norma', ['norma']),
                       ('delmart', ['delmart']), ('zeman', ['zeman']), ('zabka', ['žabka', 'zabka']), ('muuu', ['muúú', 'muuu']),
                       ('moje-kredenc', ['moje kredenc']), ('rodinna-farma', ['rodinná farma']), ('bioday', ['bioday']),
                       ('tartuf', ['tartuf']), ('food-story', ['food story']), ('marks-spencer', ['marks & spencer'])]:
        if any(w in n for w in words):
            return key
    if 'trhy' in n or 'market' in cat.lower() and 'farm' in cat.lower():
        return 'market'
    return 'independent'


def hours_fmt(h):
    if not h or h == '?':
        return None
    h = re.sub(r'(?<![:\d])(\d\d)(?![:\d])', r'\1:00', h)
    return h.replace('-', '–').replace('00:00–24:00', '0–24 h')


def walk(cell):
    if cell in ('-', '', '?'):
        return None, None
    m, k = cell.split('/')
    return int(m), (round(float(k) * 1000) if k else None)


BAND_RANK = {'near': 0, 'mid': 1, 'far': 2, 'transit': 3}


def band(w):
    if w is None or w > 30:
        return 'transit'
    return 'near' if w <= 10 else 'mid' if w <= 20 else 'far'


def sort_key(s):
    b = s['walk_band']
    m = s['transit_min'] if b == 'transit' else s['walk_min']
    return (BAND_RANK[b], m if m is not None else 999, s['id'])


def route(L, lat, lng, mode):
    return 'https://www.google.com/maps/dir/?api=1&origin=%s,%s&destination=%s,%s&travelmode=%s' % (L['lat'], L['lng'], lat, lng, mode)


def stores(rows):
    out = {'B': [], 'C': []}
    nearest = {}
    for r in rows:
        sid, name, cat, addr, lat, lng, hrs, wB, wC, tB, tC, web = r
        if sid in EXCLUDE:
            continue
        ch = chain_of(name, cat)
        for k in ('B', 'C'):
            L = LOC[k]
            wm, dm = walk(wB if k == 'B' else wC)
            tm = (tB if k == 'B' else tC)
            tm = int(tm) if tm not in ('-', '') else TRANSIT_ADD.get((sid, k))
            keep = (wm is not None and wm <= 30) or (ch in MAJOR and tm is not None)
            entry = None
            if keep or (ch in NEAREST_ONLY and tm is not None):
                b = band(wm)
                entry = {
                    'id': sid, 'kind': 'store', 'chain': ch, 'name': name, 'address': addr, 'category': cat,
                    'lat': float(lat), 'lng': float(lng),
                    'distance_m': dm, 'walk_min': wm, 'walk_band': b, 'transit_min': tm,
                    'hours': hours_fmt(HOURS_FIX.get(sid, hrs)), 'online': False,
                    'delivery_fee': None, 'min_order': None,
                    'prices_online': PRICES_FIX.get(sid, PRICES.get(ch, 'no')), 'card': CARD.get(ch),
                    'card_file': CARD_FILE.get(ch, 'cards/independents.md'),
                    'website': web or None,
                    'route_url': route(L, lat, lng, 'walking' if b != 'transit' else 'transit'),
                    'note': NOTES.get(sid),
                }
            if entry is None:
                continue
            if ch in NEAREST_ONLY and not keep:
                cur = nearest.get((ch, k))
                if cur is None or (tm or 999) < (cur['transit_min'] or 999):
                    nearest[(ch, k)] = entry
                continue
            out[k].append(entry)
    for (ch, k), e in nearest.items():
        if not any(s['chain'] == ch for s in out[k]):
            out[k].append(e)
    return out


WOLT = {  # venue slug: (name, chain, {place: (min_from, min_to) or 'closed'}, minimum order CZK)
    'billa-krejpskeho': ('BILLA Křejpského (on Wolt)', 'billa', {'B': (30, 40), 'C': (30, 40)}, 349),
    'wolt-market-michle': ('Wolt Market Michle', 'wolt-market', {'B': (30, 40), 'C': (25, 35)}, 349),
    'kaufland-praha-michle': ('Kaufland Praha-Michle (on Wolt)', 'kaufland', {'B': (75, 85), 'C': (70, 80)}, 349),
    'delmart-supermarket-oc-chodov': ('DELMART OC Chodov (on Wolt)', 'delmart', {'B': (30, 40), 'C': (20, 30)}, 500),
    'penny-praha-zahradni-mesto': ('PENNY Zahradní Město (on Wolt)', 'penny', {'B': (55, 65), 'C': (45, 55)}, 299),
    'albert-krejnicka': ('Albert Krejnická (on Wolt)', 'albert', {'B': 'closed'}, 349),
    'tesco-supermarket-brandlova': ('Tesco Brandlova (on Wolt)', 'tesco', {'B': 'closed'}, 349),
    'tesco-hypermarket-novodvorska': ('Tesco Hypermarket Novodvorská (on Wolt)', 'tesco', {'B': 'closed'}, 349),
    'tesco-expres-kunratice': ('Tesco Expres Kunratice (on Wolt)', 'tesco', {'B': 'closed'}, 250),
    'tesco-hypermarket-praha-eden': ('Tesco Hypermarket Eden (on Wolt)', 'tesco', {'C': (55, 65)}, 349),
}
FOODORA = {  # path: (name, chain, {place: (minutes, fee CZK)}, minimum order CZK)
    'darkstore/l1hl/foodora-market-chodovska': ('foodora MARKET Chodovská', 'foodora-market', {'B': (35, 89), 'C': (25, 69)}, 399),
    'shop/icwu/billa-praha-rozvoj': ('BILLA Rozvoj (on foodora)', 'billa', {'B': (35, 49), 'C': (25, 59)}, 249),
    'shop/uh0e/penny-market-praha-haje-i': ('Penny Háje I (on foodora)', 'penny', {'B': (30, 59), 'C': (25, 59)}, 299),
    'shop/t6lt/tesco-expres-nuselska': ('Tesco Expres Nuselská (on foodora)', 'tesco', {'B': (45, 109), 'C': (45, 109)}, 349),
    'shop/kpcv/tesco-hypermarket-novy-smichov': ('Tesco Hypermarket Nový Smíchov (on foodora)', 'tesco', {'B': (55, 169), 'C': (60, 129)}, 349),
}


def delivery():
    out = {'B': [], 'C': []}
    for k in ('B', 'C'):
        out[k].append({
            'id': 'D-rohlik', 'kind': 'delivery', 'chain': 'rohlik', 'name': 'Rohlík.cz', 'address': 'online, delivered to the door',
            'online': True, 'delivery_min': None, 'delivery_fee': None, 'min_order': 749, 'seen': SEEN,
            'prices_online': 'yes', 'card': 'rohlik-xtra', 'card_file': 'cards/rohlik.md', 'website': 'https://www.rohlik.cz/',
            'note': 'Address inside the delivery zone (Rohlík connector, 19/10). You pick a time slot; the fee depends on basket, area and slot and is shown in the cart. 500 CZK minimum to a Rohlik Point. Xtra (166 CZK a month): free delivery.',
        })
        out[k].append({
            'id': 'D-kosik', 'kind': 'delivery', 'chain': 'kosik', 'name': 'Košík.cz', 'address': 'online, delivered to the door',
            'online': True, 'delivery_min': None, 'delivery_fee': None, 'min_order': 749, 'seen': SEEN,
            'prices_online': 'yes', 'card': None, 'card_file': 'cards/kosik.md', 'website': 'https://www.kosik.cz/',
            'note': 'Košík delivers to this address (kosik.cz delivery check, 19/10). Free delivery above 1,199 CZK; below that the fee of the chosen slot is shown at checkout.',
        })
        out[k].append({
            'id': 'D-tesco', 'kind': 'delivery', 'chain': 'tesco', 'name': 'Tesco Online Nákupy', 'address': 'online, delivered to the door',
            'online': True, 'delivery_min': None, 'delivery_fee': None, 'min_order': None, 'min_checked': False, 'seen': SEEN,
            'prices_online': 'yes', 'card': 'tesco-clubcard', 'card_file': 'cards/tesco.md', 'website': 'https://nakup.itesco.cz/',
            'note': 'NOT CHECKED: whether Tesco Online delivers to this address, its fee and minimum show only after login (session 3). Tesco Online Club 139 CZK a month (12-month plan): no delivery fees.',
        })
        for slug, (name, ch, locs, mo) in WOLT.items():
            if k not in locs:
                continue
            t = locs[k]
            out[k].append({
                'id': 'D-wolt-' + slug, 'kind': 'delivery', 'chain': ch, 'via': 'Wolt', 'name': name, 'address': 'Wolt delivery',
                'online': True, 'delivery_min': list(t) if t != 'closed' else None, 'closed_at_check': t == 'closed',
                'delivery_fee': None, 'fee_seen': 0, 'min_order': mo, 'seen': SEEN,
                'prices_online': 'yes', 'card': None, 'card_file': 'cards/wolt.md',
                'website': 'https://wolt.com/cs/cze/prague/venue/' + slug,
                'note': 'Wolt showed a delivery fee of 0.00 CZK while not logged in (19/10 08:00-08:42); it may be a promotion, the cart decides.' + (' On Wolt this shop was closed at the check ("opens at 9:00"), so no delivery time was shown.' if t == 'closed' else ''),
            })
        for path, (name, ch, locs, mo) in FOODORA.items():
            if k not in locs:
                continue
            mins, fee = locs[k]
            out[k].append({
                'id': 'D-foodora-' + path.split('/')[-1], 'kind': 'delivery', 'chain': ch, 'via': 'foodora', 'name': name, 'address': 'foodora delivery',
                'online': True, 'delivery_min': mins, 'delivery_fee': fee, 'min_order': mo, 'seen': SEEN,
                'service_fee_pct': 5, 'service_fee_min': 7,
                'prices_online': 'yes', 'card': None, 'card_file': 'cards/foodora.md',
                'website': 'https://www.foodora.cz/' + path,
                'note': 'Plus a 5 % service fee, at least 7 CZK.' + (' Minimum order read at the Blanice address.' if k == 'C' else ''),
            })
    return out


def main():
    args = sys.argv[1:]
    if '--out' not in args or args.index('--out') == len(args) - 1:
        print(__doc__)
        sys.exit(2)
    out_path = args[args.index('--out') + 1]
    files = [a for a in args if a != '--out' and a != out_path]
    rows = []
    for f in files:
        rows += [r for r in csv.reader(open(f, encoding='utf-8'), delimiter='\t') if r]
    assert all(len(r) == 12 for r in rows), 'every survey row needs 12 columns'
    ids = [r[0] for r in rows]
    assert len(ids) == len(set(ids)), 'duplicate survey id'
    st, dl = stores(rows), delivery()
    doc = {'version': 1, 'surveyed_by': 'Meal Planner build session 2 (plan 0010)',
           'method': 'Google Maps in Chrome: 20 searches (supermarket, potraviny, grocery, every chain name, večerka, řeznictví, bio, asijské potraviny, farmářský trh) around both places; walking time from Google directions; tram/bus time for ' + TRANSIT_WHEN + ' (measured for chain stores only). Kept: every food shop within 30 min on foot, chain stores further away with their tram/bus time, the nearest store of every chain (incl. Žabka, Zeman). Westfield\'s own list of food shops added. Delivery services: address typed into Wolt, foodora and Košík (lookup only), Rohlík through its connector. Freshness: cards/google-maps.md.',
           'bands': {'near': 'walk 10 min or less', 'mid': 'walk 11-20 min', 'far': 'walk 21-30 min', 'transit': 'walk over 30 min or not measured: tram or bus'},
           'excluded': EXCLUDE, 'locations': {}}
    for k, L in LOC.items():
        shops = sorted(st[k], key=sort_key) + dl[k]
        doc['locations'][L['name']] = dict(L, surveyed=SURVEYED, walk_surveyed=WALK_SURVEYED, shops=shops)
    json.dump(doc, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for k, L in LOC.items():
        s = doc['locations'][L['name']]['shops']
        print(L['name'], len(s), 'entries;', dict(Counter(x['kind'] for x in s)), dict(Counter(x.get('walk_band') for x in s if x['kind'] == 'store')))


if __name__ == '__main__':
    main()
