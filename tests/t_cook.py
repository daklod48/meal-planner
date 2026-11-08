#!/usr/bin/env python3
"""Cook mode helper (tools/cook.py, session 3): every command on fixture rows taken from the real reads of 19/10/2026.
Run from the MealPlanner folder: python3 tests/t_cook.py    (works on a temporary copy; the real data/ is never touched)
Fixtures: tests/fixtures/cook/ (request.json = a 7-day Cook request at Blanice kolej, dislikes tuňák; one TSV per source)."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone

ROOT = os.path.abspath('.')
FX = os.path.join(ROOT, 'tests', 'fixtures', 'cook')
tmp = tempfile.mkdtemp(prefix='mp-cook-')
for d in ('tools', 'steps'):
    shutil.copytree(os.path.join(ROOT, d), os.path.join(tmp, d))
os.makedirs(os.path.join(tmp, 'data', 'shops'))
os.makedirs(os.path.join(tmp, 'data', 'foods'))
os.makedirs(os.path.join(tmp, 'data', 'requests'))
os.makedirs(os.path.join(tmp, 'app', 'js'))
shutil.copy(os.path.join(ROOT, 'app', 'js', 'planner.js'), os.path.join(tmp, 'app', 'js', 'planner.js'))
shutil.copy(os.path.join(ROOT, 'tests', 'fixtures', 'shops.json'), os.path.join(tmp, 'data', 'shops', 'shops.json'))  # the survey of 19/10 as a fixture: the test runs on a share copy without data/
json.dump({'version': 1, 'updated': None, 'items': []}, open(os.path.join(tmp, 'data', 'foods', 'foods.json'), 'w'))
req = json.load(open(os.path.join(FX, 'request.json'), encoding='utf-8'))
RID = req['id']
rp = os.path.join(tmp, 'data', 'requests', RID + '.json')
shutil.copy(os.path.join(FX, 'request.json'), rp)
# a cancelled and an older finished request must be ignored by pick
c = dict(req, id='REQ-20261018-090000-x', status='cancelled', created='2026-10-18T09:00:00+02:00')
json.dump(c, open(os.path.join(tmp, 'data', 'requests', c['id'] + '.json'), 'w'))
h_before = hashlib.sha256(open(rp, 'rb').read()).hexdigest()

passed, failed = 0, []


def ok(name, cond, extra=''):
    global passed
    if cond:
        passed += 1
    else:
        failed.append(name + (' :: ' + str(extra)[:300] if extra else ''))


def cook(*args, expect=0, now=None):
    # now: pin cook.py's clock (MP_NOW) so a check about "the last 48 hours" does not depend on the day the test runs (2026-11-05)
    env = dict(os.environ)
    env.pop('MP_NOW', None)
    if now:
        env['MP_NOW'] = now
    p = subprocess.run([sys.executable, os.path.join(tmp, 'tools', 'cook.py')] + list(args), capture_output=True, text=True, cwd=tmp, encoding='utf-8', env=env)
    if p.returncode != expect:
        failed.append('exit %s for %s: %s %s' % (p.returncode, args[:2], p.stdout[-300:], p.stderr[-300:]))
    return p.stdout


S = '2026-10-19T10:30:00+02:00'
pk = json.loads(cook('pick'))
ok('pick: the waiting request, not the cancelled one', pk.get('id') == RID and pk.get('waiting_total') == 1, pk)
ok('account: same name passes', json.loads(cook('account', RID, '--rohlik-name', 'Tomáš Dvořák'))['same'])
ok('account: spacing and decomposed letters still match', json.loads(cook('account', RID, '--rohlik-name', '  Tomáš   Dvořák '))['same'])
ok('account: other name refused (exit 3)', json.loads(cook('account', RID, '--rohlik-name', 'Jan Novák', expect=3))['same'] is False)
# profile with an e-mail: the e-mail decides (19/10: the person typed "Tomáš", the connector says "Tomáš Dvořák", same e-mail)
req_m = dict(req, id='REQ-20261019-100001-m', accounts=[{'id': 'A-0001', 'shop': 'rohlik', 'account_name': 'Tomáš', 'email': 'A@EXAMPLE.TEST'}])
json.dump(req_m, open(os.path.join(tmp, 'data', 'requests', req_m['id'] + '.json'), 'w'))
am = json.loads(cook('account', req_m['id'], '--rohlik-name', 'Tomáš Dvořák', '--rohlik-email', 'a@example.test'))
ok('account: same e-mail passes even when the names differ', am['same'] and am['compared_by'] == 'e-mail', am)
am2 = json.loads(cook('account', req_m['id'], '--rohlik-name', 'Tomáš', '--rohlik-email', 'other@example.test', expect=3))
ok('account: other e-mail refused even with the same name', am2['same'] is False, am2)
ok('account: the e-mail is never printed', 'a@example.test' not in json.dumps(am).lower())
os.remove(os.path.join(tmp, 'data', 'requests', req_m['id'] + '.json'))
t = json.loads(cook('terms', RID))
keys = [x['key'] for x in t['terms']]
ok('terms: disliked tuňák skipped, 13 left', 'tunak' not in keys and len(keys) == 13 and t['skipped'][0]['key'] == 'tunak', t['skipped'])
ok('terms: Tesco searches "vejce" (butter came back for "vejce M 10 ks")', '"vejce"' in t['tesco_js'] and 'vejce M 10 ks' in t['kosik_js'])
ok('terms: kupi only for chains with a store near the place', all(x in t['kupi_js'] for x in ('"lidl"', '"billa"', '"albert"')) and '"rohlik"' not in t['kupi_js'])
ok('terms: 4 Rohlík calls for 13 terms', t['rohlik_calls_needed'] == 4)
ok('S5 freshness: an empty foods.json means every source is read', all(v['state'] == 'read' for v in t['fresh'].values()) and t['skip_sources'] == [] and t['partial_sources'] == {}, t['fresh'])

res = {}
for src in ('rohlik', 'kosik', 'tesco', 'kupi'):
    res[src] = json.loads(cook('ingest', RID, '--source', src, '--tsv', os.path.join(FX, src + '.tsv'), '--seen', S if src != 'kupi' else 'now'))
why = lambda src: ' | '.join(x['why'] for x in res[src]['refused_by_cook']) + ' | ' + json.dumps(res[src]['foods_py']['refused'], ensure_ascii=False)
ok('ingest rohlik: 5 rows, all in', res['rohlik']['sent'] == 5 and not res['rohlik']['foods_py']['refused'], res['rohlik'])
ok('ingest kosik: crunchy peanuts refused by name', 'křup' in why('kosik'))
ok('ingest kosik: greek yogurt is not skyr', 'skyr' in why('kosik'))
ok('ingest tesco: bananas refused as vegetables (first real run, 19/10)', 'Banány' in json.dumps(res['tesco']['refused_by_cook'], ensure_ascii=False))
ok('ingest tesco: butter refused as eggs', 'Máslo' in json.dumps(res['tesco']['refused_by_cook'], ensure_ascii=False))
ok('ingest kupi: Globus members-only price skipped (no card key)', 'members-only' in why('kupi'))
foods = {f['id']: f for f in json.load(open(os.path.join(tmp, 'data', 'foods', 'foods.json'), encoding='utf-8'))['items']}
ok('tesco sold by weight: 27.48 CZK at 109.90 CZK/kg = 250 g', foods.get('tesco-205389945', {}).get('pack_g') == 250, foods.get('tesco-205389945'))
ok('tesco Clubcard promo becomes a card price', foods.get('tesco-100547235', {}).get('loyalty') == [{'card': 'tesco-clubcard', 'price': 24.9}], foods.get('tesco-100547235'))
cl = foods.get('tesco-kupi-cocka-lagris', {})
ok('kupi club price: regular from kupi, card price as loyalty', cl.get('price') == 45.7 and cl.get('loyalty') == [{'card': 'tesco-clubcard', 'price': 32.9}], cl)
eg = foods.get('rohlik-1394444', {})
ok('eggs: 10 M eggs = 480 g edible, label estimate', eg.get('pack_g') == 480 and eg.get('pieces') == 10 and eg.get('nutrition_label') == 'estimate', eg)
ok('kosik litre milk = 1000 ml', foods.get('kosik-797088', {}).get('pack_g') == 1000 and foods['kosik-797088']['unit'] == 'ml')
ok('kosik sale noted', 'sale: was 104.95' in foods.get('kosik-681032', {}).get('notes', ''))
ok('ingest --seen now stamps this minute in Prague time', foods.get('lidl-kupi-vejce-z-podestylky-m', {}).get('seen', '')[:10] == __import__('datetime').date.today().isoformat() and foods['lidl-kupi-vejce-z-podestylky-m']['seen'][19:] in ('+01:00', '+02:00'), foods.get('lidl-kupi-vejce-z-podestylky-m'))
ok('kupi leaflet keeps its end date', 'leaflet valid: zítra končí' in foods.get('albert-kupi-tvaroh-polotucny-jihocesky-madeta', {}).get('notes', ''))

b = json.loads(cook('borrow', RID))
foods = {f['id']: f for f in json.load(open(os.path.join(tmp, 'data', 'foods', 'foods.json'), encoding='utf-8'))['items']}
ok('borrow: every item of this run now has nutrition', b['still_without_nutrition'] == [] and b['borrowed'] >= 5, b)
ch = foods['rohlik-1354045']
ok('borrow: Rohlík chicken takes Košík chicken label, marked estimate with the source', ch['per100g']['protein'] == 23.2 and ch['nutrition_label'] == 'estimate' and 'Košík' not in ch['nutrition_source'] and 'kosik' in ch['nutrition_source'], ch)

# a food stored by an older run that today's name rules refuse (bananas as vegetables, 19/10) must not be planned with
fj = os.path.join(tmp, 'data', 'foods', 'foods.json')
fd = json.load(open(fj, encoding='utf-8'))
fd['items'].append({'id': 'tesco-212690126', 'shop': 'tesco', 'name': 'Banány', 'price': 4.6, 'currency': 'CZK', 'pack_g': 171, 'unit': 'g', 'category': 'zelenina',
                    'per100g': {'kcal': 95, 'protein': 1.1}, 'nutrition_label': 'exact', 'price_label': 'online', 'seen': S, 'first_seen': S, 'price_history': []})
json.dump(fd, open(fj, 'w', encoding='utf-8'), ensure_ascii=False)
ids_p = os.path.join(tmp, 'data', 'runs', RID, 'used-ids.json')
json.dump(json.load(open(ids_p)) + ['tesco-212690126'], open(ids_p, 'w'))
out = cook('options', RID)
doc = json.load(open(os.path.join(tmp, 'data', 'runs', RID, 'options.json'), encoding='utf-8'))
O = {o['id']: o for o in doc['options']}
ok('options: a stored food refused by today\'s name rules is dropped', 'tesco-212690126' in doc['foods_dropped_by_name_rules'] and not any(i['id'] == 'tesco-212690126' for o in doc['options'] for i in o['items']))
ok('options: need = 7 days x 120 g and 2,900 kcal', doc['need'] == {'protein_g': 840.0, 'kcal': 20300.0}, doc['need'])
ok('options: three delivered shops + Tesco store + mixed', [o['kind'] for o in doc['options']][:4] == ['cook-online'] * 3 + ['cook-shop'] and any(o['kind'] == 'cook-mixed' for o in doc['options']), [o['label'] for o in doc['options']])
ok('options: daily numbers are what he eats: never above the target, at least 95 % of it',
   all(0.95 * 120 <= o['protein_g_per_day'] <= 120 and 0.95 * 2900 <= o['kcal_per_day'] <= 2900 for o in doc['options']), [(o['id'], o['protein_g_per_day'], o['kcal_per_day']) for o in doc['options']])
ok('options: bought amounts kept, leftovers above 2 % named in the notes',
   all(o['bought_kcal'] >= o['kcal_per_day'] * 7 - 1 for o in doc['options']) and
   all(('left over' in o['notes']) == (o['bought_kcal'] > 1.02 * 20300 or o['bought_protein_g'] > 1.02 * 840) for o in doc['options']), [(o['id'], o['bought_kcal'], o['bought_protein_g']) for o in doc['options']])
kos = next(o for o in doc['options'] if o['shop'] == 'kosik')
veg = [i for i in kos['items'] if i['id'] == 'kosik-214844']
ok('options: vegetables first, 200 g a day (4 x 350 g for 7 days)', veg and veg[0]['packs'] == 4 and 'Vegetables: 200 g a day' in kos['notes'], kos['items'])
ok('options: Košík under its 749 CZK minimum is said', 'Below the 749 CZK minimum' in kos['notes'], kos['notes'])
mx = [o for o in doc['options'] if o['kind'] == 'cook-mixed']
ok('options: mixed = promo walk + rest at the Tesco store, both walks counted', mx and all('Tesco Expres' in o['label'] and 'Two walks' in o['notes'] for o in mx), [o['label'] for o in mx])
# 2026-11-08 (planner 1.3, energy top-up): the 40 % rule now reads "never above 40 % of the protein while protein is short;
# once protein is covered and energy is still short (energy_topup), an energy food may go up to 40 % of the energy instead".
# Before: every product <= 40 % of protein, always (that left the DRI demo at 1,445 of 3,545 kcal a day).
ok('options: one product never above 40 % of protein, or, after the energy top-up, never above 40 % of energy (except forced vegetables)',
   all(i['protein_g'] <= 0.4 * 840 + 70 or (o.get('energy_topup') and i['kcal'] <= 0.4 * 20300 + 1800) for o in doc['options'] for i in o['items'] if i.get('category') != 'zelenina'),
   [(o['id'], i['name'][:30], i['protein_g'], i['kcal'], o.get('energy_topup')) for o in doc['options'] for i in o['items'] if i['protein_g'] > 0.4 * 840 + 70])
ok('options: in-person options name their stores (for the closed check)', all(o.get('stores') and all(x.get('id') for x in o['stores']) for o in doc['options'] if o['kind'] != 'cook-online') and all(len(o['stores']) == 2 for o in mx))
ok('options: the run never needs to read a price: items carry product ids for the cart', all(i.get('product_id') for i in O['O1']['items']))

def cart_tsv(name, factor):
    p = os.path.join(tmp, name)
    with open(p, 'w', encoding='utf-8') as f:
        f.write('id\tqty\tline_price\n')
        for i in O['O1']['items']:
            f.write('%s\t%s\t%.2f\n' % (i['product_id'], i['packs'], i['cost'] * factor))
    return p
plan1 = sum(i['cost'] for i in O['O1']['items'])
c1 = json.loads(cook('cart', RID, '--option', 'O1', '--tsv', cart_tsv('cart1.tsv', 1.048)))
ok('cart: 4.8 % dearer is fine, cart prices become the cost', abs(c1['diff_pct'] - 4.8) <= 0.1 and not c1['replan_needed'] and abs(c1['cost_regular_now'] - plan1 * 1.048) < 0.05, c1)
c2 = json.loads(cook('cart', RID, '--option', 'O1', '--tsv', cart_tsv('cart2.tsv', 1.048 * 1.2)))
ok('cart: more than 10 % dearer asks for a re-plan', c2['replan_needed'] and c2['diff_pct'] > 10, c2)
c3 = os.path.join(tmp, 'cart3.tsv')
open(c3, 'w').write('id\tqty\tline_price\n')
c3r = json.loads(cook('cart', RID, '--option', 'O1', '--tsv', c3))
ok('cart: lines missing from the cart are named, cart not marked filled', len(c3r['problems']) == len(O['O1']['items']), c3r)
c4 = json.loads(cook('cart', RID, '--option', 'O1', '--tsv', cart_tsv('cart4.tsv', 1.0)))
ex = os.path.join(tmp, 'extras.json')
json.dump({'_recipes': [{'name': 'Bowl', 'minutes': 20, 'steps': 'Cook.', 'needs': []}, {'name': 'Lentil dal', 'minutes': 25, 'steps': 'Simmer.', 'needs': ['cocka']},
                         {'name': 'Never', 'minutes': 5, 'steps': 'x', 'needs': ['tunak']}], '_all': {'taste': 3, 'cook_min_per_day': 35}, 'O1': {'taste': 4}}, open(ex, 'w'))
r = json.loads(cook('result', RID, '--extras', ex))
R = json.load(open(os.path.join(tmp, 'data', 'results', RID + '.json'), encoding='utf-8'))
ok('result: done, every option has minutes, recipes, taste', R['status'] == 'done' and all(o['minutes_per_day'] >= 35 and o['recipes'] and o['taste'] in (3, 4) for o in R['options']))
ok('result: a recipe goes only to options that hold its foods', all(('Lentil dal' in [x['name'] for x in o['recipes']]) == any(i.get('category') == 'cocka' for i in o['items']) and 'Never' not in [x['name'] for x in o['recipes']] for o in R['options']))
ok('result: walking minutes added to cooking minutes', any(o['minutes_per_day'] > 35 for o in R['options'] if o['kind'] != 'cook-online'))
pre = json.dumps(R['scored'], sort_keys=True)
subprocess.run([sys.executable, os.path.join(tmp, 'tools', 'planner.py'), 'score-result', os.path.join(tmp, 'data', 'results', RID + '.json')], capture_output=True, cwd=tmp)
R2 = json.load(open(os.path.join(tmp, 'data', 'results', RID + '.json'), encoding='utf-8'))
ok('result: scores equal planner.py score-result', json.dumps(R2['scored'], sort_keys=True) == pre)
node = subprocess.run(['node', '-e', """
const fs=require('fs'); const P=require(process.argv[1]); const res=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); const r=res.request;
const sc=P.score(res.options,{targets:r.targets,weights:r.weights,cards:r.cards,budget_per_day:r.budget_per_day});
process.stdout.write(String(JSON.stringify(sc.ranked)===JSON.stringify(res.scored.ranked) && JSON.stringify(sc.picks)===JSON.stringify(res.scored.picks)));
""", os.path.join(tmp, 'app', 'js', 'planner.js'), os.path.join(tmp, 'data', 'results', RID + '.json')], capture_output=True, text=True)
ok('result: the app (planner.js) gives the same ranking and picks', node.stdout == 'true', node.stdout + node.stderr)
ok('pick: a request with a result is no longer waiting', json.loads(cook('pick')).get('none') is True)
ok('the request file was never changed', hashlib.sha256(open(rp, 'rb').read()).hexdigest() == h_before)
cook('error', 'REQ-20261018-090000-x', 'Rohlík account mismatch')
E = json.load(open(os.path.join(tmp, 'data', 'results', 'REQ-20261018-090000-x.json'), encoding='utf-8'))
ok('error: result with status error and the text', E['status'] == 'error' and E['error'] == 'Rohlík account mismatch')

# S5 freshness rule: which sources need no new read.
# "Now" for these checks = one hour after the newest Rohlík read in the fixture, computed from the file (never a hard-coded day).
# Before 2026-11-05 they used the real clock, so they passed until 21/10/2026 and failed after it.
_fx = json.load(open(os.path.join(tmp, 'data', 'foods', 'foods.json'), encoding='utf-8'))
_seen = [datetime.fromisoformat(it['seen']) for it in _fx['items'] if it.get('shop') == 'rohlik' and it.get('seen')]
NOW = (max(_seen) + timedelta(hours=1)).isoformat()
tf = json.loads(cook('terms', RID, now=NOW))
ok('S5 freshness: the small fixture reads cover only some staples, so every source is still "read" but says what it has', tf['fresh']['rohlik']['state'] == 'read' and tf['fresh']['rohlik']['staples_fresh'] >= 4 and tf['fresh']['rohlik']['newest_read'] is not None, tf['fresh']['rohlik'])
fp = json.load(open(os.path.join(tmp, 'data', 'foods', 'foods.json'), encoding='utf-8'))
base = [it for it in fp['items'] if it['shop'] == 'rohlik'][0]
have = set(it['category'] for it in fp['items'] if it['shop'] == 'rohlik')
for k in [x['key'] for x in tf['terms']]:
    if k not in have:
        it = dict(base, id='rohlik-fresh-' + k, category=k, name='fresh ' + k, price_history=[])
        fp['items'].append(it)
json.dump(fp, open(os.path.join(tmp, 'data', 'foods', 'foods.json'), 'w', encoding='utf-8'), ensure_ascii=False)
tf1 = json.loads(cook('terms', RID, now=NOW))
ok('S5 freshness: Rohlík read within 48 h with every staple present = skip', tf1['fresh']['rohlik']['state'] == 'skip' and 'rohlik' in tf1['skip_sources'] and tf1['fresh']['rohlik']['missing'] == [], tf1['fresh']['rohlik'])
fp['items'] = [it for it in fp['items'] if it['id'] not in ('rohlik-fresh-skyr', 'rohlik-fresh-chleb')]
json.dump(fp, open(os.path.join(tmp, 'data', 'foods', 'foods.json'), 'w', encoding='utf-8'), ensure_ascii=False)
tf2 = json.loads(cook('terms', RID, now=NOW))
ok('S5 freshness: two staples missing = partial, the Rohlík call lists only their terms', tf2['fresh']['rohlik']['state'] == 'partial' and sorted(tf2['fresh']['rohlik']['missing']) == ['chleb', 'skyr'] and len(tf2['partial_sources']['rohlik']) == 2 and 'rohlik' not in tf2['skip_sources'], tf2)
for it in fp['items']:
    if it['shop'] == 'rohlik':
        it['seen'] = '2026-01-01T10:00:00+01:00'
json.dump(fp, open(os.path.join(tmp, 'data', 'foods', 'foods.json'), 'w', encoding='utf-8'), ensure_ascii=False)
tf3 = json.loads(cook('terms', RID, now=NOW))
ok('S5 freshness: prices older than 48 h are read again', tf3['fresh']['rohlik']['state'] == 'read' and tf3['fresh']['rohlik']['newest_read'] is None, tf3['fresh']['rohlik'])
cook('closed', 'S016', '--place', 'Blanice kolej', '--seen', S)
sh = json.load(open(os.path.join(tmp, 'data', 'shops', 'shops.json'), encoding='utf-8'))
ok('closed: only that store at that place is marked', [x.get('closed_seen') for x in sh['locations']['Blanice kolej']['shops'] if x['id'] == 'S016'] == [S]
   and not any(x.get('closed_seen') for x in sh['locations']['Westfield Chodov']['shops'] if x['id'] == 'S016'))
cook('closed', 'S999', '--place', 'Blanice kolej', '--seen', S, expect=1)

# 2026-11-05: the clock (MP_NOW) and the Prague fallback zone
sys.path.insert(0, os.path.join(tmp, 'tools'))
import cook as _ck  # noqa: E402
os.environ['MP_NOW'] = '2026-10-25T01:10:00Z'
ok('clock: MP_NOW pins now_iso, shown in Prague winter time after the October switch', _ck.now_iso() == '2026-10-25T02:10:00+01:00', _ck.now_iso())
os.environ['MP_NOW'] = '2026-10-25T00:40:00Z'
ok('clock: 30 minutes earlier is still summer time', _ck.now_iso() == '2026-10-25T02:40:00+02:00', _ck.now_iso())
os.environ['MP_NOW'] = '2026-10-25T02:10:00'
try:
    _ck.clock()
    ok('clock: MP_NOW without a zone is refused', False)
except SystemExit:
    ok('clock: MP_NOW without a zone is refused', True)
del os.environ['MP_NOW']
from zoneinfo import ZoneInfo  # noqa: E402
_real, _rule, _bad = ZoneInfo('Europe/Prague'), _ck.PragueRule(), []
for _y in (2025, 2026, 2027):
    for _m in (3, 10):
        _sun = _ck.PragueRule._last_sunday(_y, _m)
        _u = datetime(_sun.year, _sun.month, _sun.day, tzinfo=timezone.utc) - timedelta(hours=6)
        for _ in range(25):  # every 30 minutes from 18:00 UTC on Saturday to 06:00 UTC on Sunday
            a, b = _u.astimezone(_real), _u.astimezone(_rule)
            if a.isoformat() != b.isoformat() or b.astimezone(timezone.utc) != _u:
                _bad.append((_u.isoformat(), a.isoformat(), b.isoformat()))
            _u += timedelta(minutes=30)
for _d in ('2026-01-15T12:00:00+00:00', '2026-07-15T12:00:00+00:00'):
    _u = datetime.fromisoformat(_d)
    if _u.astimezone(_real).isoformat() != _u.astimezone(_rule).isoformat():
        _bad.append((_d,))
ok('fallback zone = the real Europe/Prague table at 152 moments around every switch of 2025-2027, winter and summer (was a fixed +02:00)', not _bad, _bad[:3])

shutil.rmtree(tmp, ignore_errors=True)
if failed:
    print('\n'.join('FAIL ' + f for f in failed))
    print('FAIL %d of %d' % (len(failed), passed + len(failed)))
    sys.exit(1)
print('PASS %d cook.py checks' % passed)
