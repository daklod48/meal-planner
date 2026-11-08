#!/usr/bin/env python3
"""The shopping list made by the run (2026-11-08, planner 1.3): tools/cook.py compares every product of one food in one shop,
keeps the best and a backup, records sale data the source gives (unknown stays null), and checks a Košík or Tesco basket.
Works on a temporary copy, on the shop rows read on 19/10/2026 (tests/fixtures/cook/) plus two planted Rohlík tvaroh rows:
one cheaper but SOLD OUT, one in stock on sale until 9/11. Run from the repository root: python3 tests/t_list.py
Every check fails on the code before 2026-11-08 (no list fields, no --shop, no sale fields)."""
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath('.')
FX = os.path.join(ROOT, 'tests', 'fixtures', 'cook')
passed, failed = 0, []


def ok(name, cond, extra=''):
    global passed
    if cond:
        passed += 1
    else:
        failed.append(name + (' :: ' + str(extra)[:400] if extra else ''))


tmp = tempfile.mkdtemp(prefix='mp-list-')
for d in ('tools', 'steps'):
    shutil.copytree(os.path.join(ROOT, d), os.path.join(tmp, d))
for d in ('shops', 'foods', 'requests'):
    os.makedirs(os.path.join(tmp, 'data', d))
os.makedirs(os.path.join(tmp, 'app', 'js'))
shutil.copy(os.path.join(ROOT, 'app', 'js', 'planner.js'), os.path.join(tmp, 'app', 'js', 'planner.js'))
shutil.copy(os.path.join(ROOT, 'tests', 'fixtures', 'shops.json'), os.path.join(tmp, 'data', 'shops', 'shops.json'))
json.dump({'version': 1, 'updated': None, 'items': []}, open(os.path.join(tmp, 'data', 'foods', 'foods.json'), 'w'))
req = json.load(open(os.path.join(FX, 'request.json'), encoding='utf-8'))
RID = req['id']
shutil.copy(os.path.join(FX, 'request.json'), os.path.join(tmp, 'data', 'requests', RID + '.json'))
S = '2026-10-19T10:30:00+02:00'

# Rohlík rows of 19/10 plus two planted tvaroh rows and a sale_until column (the connector's sale end, when it gives one)
rows = open(os.path.join(FX, 'rohlik.tsv'), encoding='utf-8').read().splitlines()
hdr = rows[0] + '\tsale_until'
body = [r + '\t' for r in rows[1:]]
body.append('tvaroh odtučněný\t999001\tTestovací Tvaroh levný\t9.9\t19.9\t250 g\tfalse\t66\t12\t0.5\t4\t0.1\t')
body.append('tvaroh odtučněný\t999002\tTestovací Tvaroh výběrový\t24.9\t29.9\t500 g\ttrue\t70\t13\t0.5\t4\t0.1\t2026-11-09')
rtsv = os.path.join(tmp, 'rohlik.tsv')
open(rtsv, 'w', encoding='utf-8').write('\n'.join([hdr] + body) + '\n')


def cook(*args, expect=0):
    p = subprocess.run([sys.executable, os.path.join(tmp, 'tools', 'cook.py')] + list(args), capture_output=True, text=True, cwd=tmp, encoding='utf-8')
    if p.returncode != expect:
        failed.append('exit %s for %s: %s %s' % (p.returncode, args[:2], p.stdout[-300:], p.stderr[-300:]))
    return p.stdout


cook('ingest', RID, '--source', 'rohlik', '--tsv', rtsv, '--seen', S)
for src in ('kosik', 'tesco', 'kupi'):
    cook('ingest', RID, '--source', src, '--tsv', os.path.join(FX, src + '.tsv'), '--seen', S)
cook('borrow', RID)  # nutrition for leaflet rows, as a real run does
foods = {f['id']: f for f in json.load(open(os.path.join(tmp, 'data', 'foods', 'foods.json'), encoding='utf-8'))['items']}

# ---- sale data as the source gives it ----
miil = foods.get('rohlik-1469745', {})
ok('Rohlík sale: regular price from originalPrice (17.90 -> 16.11), end not given = null', miil.get('regular_price') == 17.9 and miil.get('sale_until') is None and 'Rohlík' in (miil.get('sale_source') or ''), miil)
ok('Rohlík sale end from the connector column is kept (9/11)', foods.get('rohlik-999002', {}).get('sale_until') == '2026-11-09', foods.get('rohlik-999002'))
kup = [f for f in foods.values() if '-kupi-' in f['id'] and 'madeta' in f['id']]
ok('kupi.cz "zítra končí" read on 19/10 = sale until 20/10, regular price kept', kup and kup[0].get('sale_until') == '2026-10-20' and kup[0].get('regular_price') == 29.36, kup[:1])
ok('kupi.cz: the product name to search is stored without the leaflet suffix', kup and kup[0].get('search_name') == 'Tvaroh polotučný Jihočeský Madeta 250 g', kup[:1])
ok('a product without a sale has no sale fields (never invented)', all(f.get('regular_price') is None and f.get('sale_until') is None for f in foods.values() if f['shop'] == 'tesco' and 'promo' not in (f.get('notes') or '')))

# ---- the options: every line is a shopping-list row with a backup ----
out = cook('options', RID)
doc = json.load(open(os.path.join(tmp, 'data', 'runs', RID, 'options.json'), encoding='utf-8'))
O = {o['id']: o for o in doc['options']}
ro = next((o for o in doc['options'] if o['shop'] == 'rohlik'), None)
tv = next((i for i in (ro or {}).get('items', []) if i.get('category') == 'tvaroh'), None)
ok('every line has the search name, pack, price and a backup field', all(all(k in i for k in ('search', 'pack_g', 'unit', 'price', 'backup', 'sale_pct', 'sale_until', 'sold_out_instead')) for o in doc['options'] for i in o['items']),
   [sorted(i) for o in doc['options'] for i in o['items']][:1])
ok('seeded case: the best tvaroh (9.90 CZK) is sold out, so the plan uses the next and names the sold-out one', tv is not None and tv['id'] != 'rohlik-999001' and [x['id'] for x in tv['sold_out_instead']] == ['rohlik-999001'], tv)
ok('the backup is the next product in stock, never the sold-out one', tv is not None and tv['backup'] and tv['backup']['id'] not in ('rohlik-999001', tv['id']), tv and tv['backup'])
if tv and tv['backup']:
    b = tv['backup']
    pb = foods[b['id']]
    exp_packs = max(1, -(-tv['protein_g'] // (pb['pack_g'] * pb['per100g']['protein'] / 100)))
    ok('backup line: packs to give at least the same protein, CZK and protein difference from planner.backup_line', b['packs'] == exp_packs and isinstance(b['cost_diff'], float) and isinstance(b['protein_diff_g'], float) and b['url'], b)
ok('one product per food: the best tvaroh in stock (500 g at 24.90) is the line, 17 % off until 9/11 as the connector said', tv is not None and tv['id'] == 'rohlik-999002' and tv['sale_pct'] == 17.0 and tv['sale_until'] == '2026-11-09' and tv['regular_price'] == 29.9, tv)
ok('its backup is Miil (in stock); a sale without an end date stays "not known" (null) on the backup', tv is not None and tv['backup'] and tv['backup']['id'] == 'rohlik-1469745' and tv['backup']['sale_pct'] == 10.0 and tv['backup']['sale_until'] is None, tv and tv['backup'])
ok('never two products of the same food from the same shop in one option', all(len({(i['shop'], i['category'], i.get('price_label') == 'leaflet') for i in o['items']}) == len(o['items']) for o in doc['options']), [[(i['shop'], i['category']) for i in o['items']] for o in doc['options']][:2])
nob = [i for o in doc['options'] for i in o['items'] if i['backup'] is None]
ok('an online order never holds a leaflet (store) price', all(i.get('price_label') != 'leaflet' for o in doc['options'] if o['kind'] == 'cook-online' for i in o['items']),
   [(o['id'], i['name'][:40]) for o in doc['options'] if o['kind'] == 'cook-online' for i in o['items'] if i.get('price_label') == 'leaflet'])
dropped = set(doc.get('foods_dropped_by_name_rules') or [])
leaf = lambda f: f.get('price_label') == 'leaflet'
same = lambda i: [f for f in foods.values() if f['shop'] == i['shop'] and f.get('category') == i['category'] and f.get('in_stock') is not False
                  and f['id'] not in dropped and f.get('per100g') and leaf(f) == leaf(foods[i['id']])]
ok('a leaflet price never backs up an online product, nor the reverse', all(leaf(foods[i['backup']['id']]) == leaf(foods[i['id']]) for o in doc['options'] for i in o['items'] if i['backup']))
ok('a food with only one usable product in that shop has backup null (nothing invented)', all(len(same(i)) <= 1 for i in nob), [(i['shop'], i['category'], len(same(i))) for i in nob if len(same(i)) > 1][:5])
ok('a food with two usable products in that shop always gets a backup', all(i['backup'] for o in doc['options'] for i in o['items'] if len(same(i)) > 1))
import re
raw = re.compile(r'\d+(\.\d+)? of \d+(\.\d+)? g|kcal \d+(\.\d+)? of \d')
ok('notes in plain words: no raw sums like "protein 786.0 of 412.2 g"', not any(raw.search(o['notes']) for o in doc['options']) and not any('per product rule' in o['notes'] for o in doc['options']), [o['notes'][:160] for o in doc['options']][:2])

# ---- Košík basket filled by Claude in Chrome: checked line by line (section C9b) ----
ko = next((o for o in doc['options'] if o['shop'] == 'kosik'), None)
ct = os.path.join(tmp, 'kosik-cart.tsv')
open(ct, 'w', encoding='utf-8').write('id\tqty\tline_price\n' + ''.join('%s\t%s\t%.2f\n' % (i['product_id'], i['packs'], i['cost']) for i in ko['items']))
cr = json.loads(cook('cart', RID, '--option', ko['id'], '--tsv', ct, '--shop', 'kosik'))
doc2 = json.load(open(os.path.join(tmp, 'data', 'runs', RID, 'options.json'), encoding='utf-8'))
ko2 = next(o for o in doc2['options'] if o['id'] == ko['id'])
ok('Košík basket: every line found, cart marked filled for kosik', cr['problems'] == [] and ko2['cart']['filled'] is True and ko2['cart']['shop'] == 'kosik', (cr, ko2['cart']))
open(ct, 'w', encoding='utf-8').write('id\tqty\tline_price\n')
cr2 = json.loads(cook('cart', RID, '--option', ko['id'], '--tsv', ct, '--shop', 'kosik'))
ok('Košík basket with missing lines: not marked filled, every missing line named', len(cr2['problems']) == len(ko['items']), cr2)

# ---- foods.py: sale fields are checked ----
bad = os.path.join(tmp, 'bad.json')
base = dict(miil)
base.pop('price_history', None)
base.pop('first_seen', None)
json.dump([dict(base, id='rohlik-777', sale_until='9. 11.')], open(bad, 'w'))
p = subprocess.run([sys.executable, os.path.join(tmp, 'tools', 'foods.py'), 'add', bad], capture_output=True, text=True, cwd=tmp, encoding='utf-8')
ok('foods.py refuses a sale end that is not a date', 'rohlik-777' in p.stdout and 'sale_until must be YYYY-MM-DD' in p.stdout, p.stdout[-300:])
json.dump([dict(base, id='rohlik-778', regular_price=10.0)], open(bad, 'w'))
p = subprocess.run([sys.executable, os.path.join(tmp, 'tools', 'foods.py'), 'add', bad], capture_output=True, text=True, cwd=tmp, encoding='utf-8')
st = {f['id']: f for f in json.load(open(os.path.join(tmp, 'data', 'foods', 'foods.json'), encoding='utf-8'))['items']}
ok('foods.py: a "regular" price below the price is no sale (dropped, warned)', st.get('rohlik-778', {}).get('regular_price') is None and 'not a sale' in p.stdout, p.stdout[-300:])

shutil.rmtree(tmp, ignore_errors=True)
if failed:
    print('FAIL %d of %d\n  ' % (len(failed), passed + len(failed)) + '\n  '.join(failed))
    sys.exit(1)
print('PASS %d shopping-list checks' % passed)
