#!/usr/bin/env python3
"""Meal Planner session 4. Checks tools/dine.py: the dish estimate (Python) equals its browser twin tools/browser/dish-core.js on
every fixture dish, every fixture dish lands in the expected type (or is refused), and the options/basket/result steps on fixture rows.
Run from the MealPlanner folder: python3 tests/t_dine.py"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MP = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(MP, 'tools'))
import dine  # noqa: E402
import cook  # noqa: E402

FAIL = []
N = [0]


def check(ok, what):
    N[0] += 1
    if not ok:
        FAIL.append(what)


def fixture_dishes():
    return cook.tsv_rows(os.path.join(HERE, 'fixtures', 'dine', 'dishes.tsv'))


def js_estimates(rows):
    T = dine.browser_table(dine.table())   # exactly what read.js carries
    src = open(os.path.join(MP, 'tools', 'browser', 'dish-core.js'), encoding='utf-8').read()
    prog = src + '\nMPD.T=' + json.dumps(T, ensure_ascii=False) + ';\nvar rows=' + json.dumps(rows, ensure_ascii=False) + ';\n' + \
        'console.log(JSON.stringify(rows.map(function(x){var p=x.price===""?null:parseFloat(x.price);return MPD.estimate(x.name,x.desc,x.weight,x.kind,null,p);})));'
    out = subprocess.run(['node', '-e', prog], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def t_twin():
    rows = fixture_dishes()
    js = js_estimates(rows)
    for x, j in zip(rows, js):
        p = dine.estimate(x['name'], x['desc'], x['weight'], x['kind'], None, float(x['price']) if x['price'] else None)
        check(p == j, 'twin differs for %s: py %s js %s' % (x['name'], p, j))
        exp = x.get('expect')
        if exp:
            got = 'skip' if 'skip' in p else p['type']
            check(got == exp.lower(), 'type of %s: expected %s got %s (%s)' % (x['name'], exp, got, p))


def run(tmp, *args, expect=0):
    p = subprocess.run([sys.executable, os.path.join(tmp, 'tools', 'dine.py')] + list(args), capture_output=True, text=True, cwd=tmp, encoding='utf-8')
    check(p.returncode == expect, 'exit %s for %s: %s %s' % (p.returncode, args[:2], p.stdout[-300:], p.stderr[-300:]))
    return p.stdout


def js_score(tmp, rid):
    prog = """const fs=require('fs'); const P=require(process.argv[1]); const res=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); const r=res.request;
const tu=res.targets_used; const tg=tu&&typeof tu.protein_g==='number'&&typeof tu.kcal==='number'?{protein_g:tu.protein_g,kcal:tu.kcal}:r.targets;
const sc=P.score(res.options,{targets:tg,weights:r.weights,cards:r.cards,budget_per_day:r.budget_per_day});
process.stdout.write(String(JSON.stringify(sc.ranked)===JSON.stringify(res.scored.ranked) && JSON.stringify(sc.picks)===JSON.stringify(res.scored.picks)));"""
    return subprocess.run(['node', '-e', prog, os.path.join(tmp, 'app', 'js', 'planner.js'), os.path.join(tmp, 'data', 'results', rid + '.json')],
                          capture_output=True, text=True).stdout


def t_flow():
    import hashlib
    import shutil
    import tempfile
    FX = os.path.join(HERE, 'fixtures', 'dine')
    tmp = tempfile.mkdtemp(prefix='mp-dine-')
    for d in ('tools', 'steps'):
        shutil.copytree(os.path.join(MP, d), os.path.join(tmp, d))
    for d in ('shops', 'requests', 'users/tomas-dvorak'):
        os.makedirs(os.path.join(tmp, 'data', d))
    os.makedirs(os.path.join(tmp, 'app', 'js'))
    shutil.copy(os.path.join(MP, 'app', 'js', 'planner.js'), os.path.join(tmp, 'app', 'js'))
    shutil.copy(os.path.join(MP, 'tests', 'fixtures', 'shops.json'), os.path.join(tmp, 'data', 'shops'))
    json.dump({'id': 'tomas-dvorak', 'cooking': {'meals_per_day': 3}}, open(os.path.join(tmp, 'data', 'users', 'tomas-dvorak', 'profile.json'), 'w'))
    base = json.load(open(os.path.join(FX, 'request-order.json'), encoding='utf-8'))
    rid = base['id']
    rp = os.path.join(tmp, 'data', 'requests', rid + '.json')
    json.dump(base, open(rp, 'w'), ensure_ascii=False)
    h0 = hashlib.sha256(open(rp, 'rb').read()).hexdigest()
    t = json.loads(run(tmp, 'terms', rid))
    check(t['place'] == 'Blanice kolej' and len(t['rohlik_terms']) == 8 and t['step_2_start'].startswith('MPR.params={"mode":"order"'), 'terms order: %s' % str(t)[:200])
    js = open(os.path.join(tmp, 'data', 'runs', rid, 'read.js'), encoding='utf-8').read()
    check(js.startswith('var MPD') and js.endswith('"read.js loaded"') and '"min_meal_price":80' in js and 'eval(' not in js, 'read.js = plain code with the price floor, no eval (blocked on wolt.com)')
    k = json.loads(run(tmp, 'ingest', rid, '--source', 'rohlik', '--tsv', os.path.join(FX, 'rohlik.tsv')))
    check(k['dishes_kept'] == 14 and k['refused'] == 18, 'rohlik ready meals kept/refused: %s' % k)
    d = json.load(open(os.path.join(tmp, 'data', 'runs', rid, 'dishes.json'), encoding='utf-8'))
    names = [x['name'] for x in d['dishes']]
    check(not any('vývar' in n or 'Bageta' in n or 'džus' in n or 'Buchtičky' in n for n in names), 'no broth, bread, juice or sweet buns as ready meals: %s' % names)
    sv = next(x for x in d['dishes'] if x['item'] == '1374831')
    check(sv['kcal'] == 672.0 and sv['protein'] == 37.3 and sv['label'] == 'exact', 'Rohlík svíčková 525 g x 128 kcal, 7.1 g /100 g: %s' % sv)
    k = json.loads(run(tmp, 'ingest', rid, '--source', 'wolt', '--tsv', os.path.join(FX, 'wolt.tsv')))
    check(k['dishes_kept'] == 16 and k['venues'] == 4, 'wolt fixture ingest: %s' % k)
    d = json.load(open(os.path.join(tmp, 'data', 'runs', rid, 'dishes.json'), encoding='utf-8'))
    tg = next(x for x in d['dishes'] if x['item'] == 'ac434136c8a806982f74b268')
    check(tg['grams'] == 250.0 and 'menu weight 250' in tg['basis'], '250g Tagliatelle = whole dish, not 250 g chicken: %s' % tg['basis'])
    run(tmp, 'options', rid)
    O = json.load(open(os.path.join(tmp, 'data', 'runs', rid, 'options.json'), encoding='utf-8'))
    check(O['targets_used']['share'] == round(2 / 3, 4) and O['targets_used']['protein_g'] == 100.0 and O['targets_used']['kcal'] == 1667,
          '2 of 3 meals = two thirds of 150 g / 2,500 kcal: %s' % O['targets_used'])
    ro = next(o for o in O['options'] if o['shop'] == 'rohlik')
    check(ro['nutrition_label'] == 'exact' and ro['cost_regular'] >= 749 and 'heat' in ro['notes'], 'Rohlík option exact, whole plan, heat note: %s' % ro['notes'][:120])
    for o in O['options']:
        per_day = {}
        for it in o['items']:
            per_day[it['product_id']] = it['packs_per_day']
        check(sum(per_day.values()) == 2 and all(v == 1 for v in per_day.values()), '%s: two different dishes a day %s' % (o['label'], per_day))
        check(o['protein_g_per_day'] <= 100.0 and o['kcal_per_day'] <= 1667, '%s: daily numbers never above the meal targets' % o['label'])
    ko = next(o for o in O['options'] if o['label'] == 'Restaurace KOBRA')
    check(ko['delivery_min'] == '40-50' and ko['delivery_fee'] == 0.0 and 'not logged in' in ko['notes'], 'Wolt fee and time: %s %s' % (ko['delivery_min'], ko['delivery_fee']))
    ex = os.path.join(tmp, 'ex.json')
    json.dump({'_all': {'notes': 'Taste is an estimate.'}, ko['id']: {'taste': 4}}, open(ex, 'w'))
    run(tmp, 'result', rid, '--extras', ex)
    R = json.load(open(os.path.join(tmp, 'data', 'results', rid + '.json'), encoding='utf-8'))
    check(R['status'] == 'done' and R['targets_used']['share'] < 1 and next(o for o in R['options'] if o['id'] == ko['id'])['taste'] == 4, 'result written with taste and targets_used')
    check(js_score(tmp, rid) == 'true', 'the app (planner.js) gives the same ranking and picks with the meal targets')
    pre = json.dumps(R['scored'], sort_keys=True)
    subprocess.run([sys.executable, os.path.join(tmp, 'tools', 'planner.py'), 'score-result', os.path.join(tmp, 'data', 'results', rid + '.json')], capture_output=True, cwd=tmp)
    R2 = json.load(open(os.path.join(tmp, 'data', 'results', rid + '.json'), encoding='utf-8'))
    check(json.dumps(R2['scored'], sort_keys=True) == pre, 'planner.py score-result uses the same meal targets')
    # basket: day 1 of the KOBRA option, one line 10 % dearer than read -> re-plan
    its = ko['items']
    bt = os.path.join(tmp, 'basket.tsv')
    with open(bt, 'w', encoding='utf-8') as f:
        f.write('item\tqty\tline_price\n')
        for i, it in enumerate(its):
            f.write('%s\t%s\t%.2f\n' % (it['product_id'], it['packs_per_day'], it['price'] * it['packs_per_day'] * (1.25 if i == 0 else 1)))
    b = json.loads(run(tmp, 'basket', rid, '--option', ko['id'], '--tsv', bt))
    check(b['replan_needed'] is True and not b['problems'], 'basket 12.5 %% dearer: re-plan asked, no problems: %s' % b)
    with open(bt, 'w', encoding='utf-8') as f:
        f.write('item\tqty\tline_price\n%s\t%s\t%.2f\n' % (its[0]['product_id'], its[0]['packs_per_day'], its[0]['price']))
    b = json.loads(run(tmp, 'basket', rid, '--option', ko['id'], '--tsv', bt))
    check(len(b['problems']) == 1 and 'not in the basket' in b['problems'][0], 'a missing dish is a problem: %s' % b)
    # eat out at Chodov: menicka fixture + survey
    run(tmp, 'survey', 'Westfield Chodov', '--tsv', os.path.join(FX, 'raw_restaurants.tsv'), '--walk-col', 'walk_C', '--m-col', 'm_C')
    RS = json.load(open(os.path.join(tmp, 'data', 'shops', 'restaurants.json'), encoding='utf-8'))['locations']['Westfield Chodov']['restaurants']
    check(len(RS) == 65 and RS[0]['walk_min'] <= RS[-1]['walk_min'] and all(r['walk_min'] <= 25 for r in RS), 'survey: 65 restaurants within 25 min, sorted')
    check(all(r['route_url'].startswith('https://www.google.com/maps/dir/?api=1&origin=50.0304375,14.4906875') for r in RS), 'survey: walking route links from the place')
    eo = dict(base, id='REQ-20261019-121000-eat', mode='eatout', order=None, eatout={'max_walk_min': 15},
              location={'id': 'L-0002', 'name': 'Westfield Chodov', 'address': '', 'walk_limit_min': 15})
    json.dump(eo, open(os.path.join(tmp, 'data', 'requests', eo['id'] + '.json'), 'w'), ensure_ascii=False)
    t = json.loads(run(tmp, 'terms', eo['id']))
    check(t['restaurants_within_walk'] == 44 and t['with_daily_menu_page'] == 4, 'eat-out terms within 15 min: %s' % {k: t.get(k) for k in ('restaurants_within_walk', 'with_daily_menu_page')})
    run(tmp, 'ingest', eo['id'], '--source', 'menicka', '--tsv', os.path.join(FX, 'menicka.tsv'))
    run(tmp, 'options', eo['id'])
    O = json.load(open(os.path.join(tmp, 'data', 'runs', eo['id'], 'options.json'), encoding='utf-8'))
    priced = [o for o in O['options'] if o['cost_regular'] is not None]
    check(len(O['options']) == 44 and len(priced) == 2, 'one option per restaurant in reach, 2 with a menu: %d / %d' % (len(O['options']), len(priced)))
    mj = next((o for o in priced if o['label'] == 'Restaurace Maják'), {'notes': '', 'walk_min': None, 'minutes_per_day': None, 'route_url': None})
    check(mj['walk_min'] == 12.2 and mj['minutes_per_day'] == 48.8 and 'lunch only' in mj['notes'] and mj['route_url'], 'Maják walk 12.2 min x 2 ways x 2 meals: %s' % mj['minutes_per_day'])
    run(tmp, 'result', eo['id'])
    R = json.load(open(os.path.join(tmp, 'data', 'results', eo['id'] + '.json'), encoding='utf-8'))
    check(all(R['scored']['picks'][k] in [o['id'] for o in priced] for k in ('cheapest', 'fastest', 'balance')), 'no-menu restaurants never picked')
    check(js_score(tmp, eo['id']) == 'true', 'eat out: the app gives the same ranking and picks')
    check(hashlib.sha256(open(rp, 'rb').read()).hexdigest() == h0, 'the request file was never changed')
    shutil.rmtree(tmp)


def kit():
    """A throw-away copy of the kit with the fixture request (no real data touched)."""
    import shutil
    import tempfile
    tmp = tempfile.mkdtemp(prefix='mp-dine-rv-')
    for d in ('tools', 'steps'):
        shutil.copytree(os.path.join(MP, d), os.path.join(tmp, d))
    for d in ('shops', 'requests', 'users'):
        os.makedirs(os.path.join(tmp, 'data', d))
    shutil.copy(os.path.join(MP, 'tests', 'fixtures', 'shops.json'), os.path.join(tmp, 'data', 'shops'))
    return tmp


def put_req(tmp, r):
    json.dump(r, open(os.path.join(tmp, 'data', 'requests', r['id'] + '.json'), 'w'), ensure_ascii=False)


WHEAD = '|'.join(dine.BROWSER_HEAD)


def wtable(path, rows, ledger=True):
    with open(path, 'w', encoding='utf-8') as f:
        f.write('Wolt\n\n' + WHEAD + '\n')   # a title line and a blank line before the header, as a careless copy has them
        for r in rows:
            f.write('|'.join(str(r.get(k, '')) for k in dine.BROWSER_HEAD) + '\n')
        if ledger:
            f.write('L|' + '|' * 15 + 'wolt: test|\n')


def t_review():
    """The defects found by the independent review of 19/10/2026, one check each (SESSION-4.md section 9)."""
    import shutil
    E = dine.estimate
    # 4. a meat weight is the meat, not the whole dish
    e = E('Kuřecí řízek', '', '150g')
    check(e.get('protein', 0) >= 40 and 'meat weight 150' in e['basis'], 'review 4: "Kuřecí řízek" 150g = 150 g meat: %s' % e)
    e = E('Hovězí steak', '', '200 g')
    check(e['mix'][0] == ['beef', 200.0], 'review 4: "Hovězí steak" 200 g = 200 g beef: %s' % e['mix'])
    e = E('Hovězí steak', '', '350 g')
    check('menu weight 350' in e['basis'], 'review 4: above 300 g the weight is the whole dish: %s' % e['basis'])
    # 17. the hand tool takes the price, so it can reproduce ingest
    out = subprocess.run([sys.executable, os.path.join(MP, 'tools', 'dine.py'), 'estimate', 'Česneková omáčka k pizze', '--price', '25'],
                         capture_output=True, text=True, encoding='utf-8').stdout
    check('skip' in json.loads(out), 'review 17: estimate --price 25 refuses a sauce: %s' % out)
    # 13. allergies and dislikes
    r = {'allergies': 'peanuts', 'dislikes': 'houby'}
    T = dine.table()
    check(bool(dine.disliked(r, 'Kuře kung pao s arašídy', '', (), T)), 'review 13: peanuts refuses "s arašídy"')
    check(bool(dine.disliked(r, 'Hovězí na houbách', '', (), T)), 'review 13: dislike "houby" refuses "na houbách"')
    check(bool(dine.disliked({'allergies': 'mléko'}, 'Vepřová pečeně', '', ('1', '7'), T)), 'review 13: milk refuses a menu dish listing allergen 7')
    check(dine.disliked({'allergies': 'mléko'}, 'Vepřová pečeně', '', ('1', '3'), T) is None, 'review 13: allergen 7 absent = kept')
    check(dine.split_codes('A:1,3,7') == (('1', '3', '7'), ''), 'review 13: menicka allergen numbers read from desc')
    # 3, 15. the browser rows keep 160 characters of description, and the reader stops on a block
    rd = open(os.path.join(MP, 'tools', 'browser', 'readers.js'), encoding='utf-8').read()
    check("desc: String(x.desc || '').slice(0, 160)" in rd and "desc: String(x.desc || '').slice(0, 60)" not in rd, 'review 3: D rows carry the 160 characters the estimate saw')
    check("block('HTTP 403" in rd and 'not JSON' in rd and '!S.blocked' in rd, 'review 15: the reader stops after a 403 or a robot-check page')
    # 12. table reading
    tmp = kit()
    bad = os.path.join(tmp, 'bad.tsv')
    with open(bad, 'w', encoding='utf-8') as f:
        f.write(WHEAD + '\nD|v1|||||||||||i1|Kuřecí řízek|189|150g|a|b|c||extra\n')
    try:
        dine.tsv_rows(bad, ['kind', 'venue'])
        ok = False
    except SystemExit as x:
        ok = 'cells' in str(x)
    check(ok, 'review 12: a row with a stray "|" is an error, not a silent shift')
    # order request, 1 day: Rohlík minimum, unknown fee, no delivery time, basket rules; no profile = usual 3 meals
    base = json.load(open(os.path.join(HERE, 'fixtures', 'dine', 'request-order.json'), encoding='utf-8'))
    r1 = dict(base, id='REQ-20261019-230000-rv', days=1)
    r1.pop('meals_usual', None)
    put_req(tmp, r1)
    rid = r1['id']
    run(tmp, 'ingest', rid, '--source', 'rohlik', '--tsv', os.path.join(HERE, 'fixtures', 'dine', 'rohlik.tsv'))
    wt = os.path.join(tmp, 'w.tsv')
    V = dict(kind='V', lat='50.02', lng='14.49', min_order='400', service_pct='0', service_min='0', open='Open', url='https://wolt.com/cs/cze/prague/restaurant/a')
    rows = [dict(V, venue='a', venue_name='Fee unknown', eta_min='30', eta_max='40', fee=''),
            dict(kind='D', venue='a', item='a1', dish='Kuřecí řízek, bramborová kaše', price='174', weight='150g'),
            dict(kind='D', venue='a', item='a2', dish='Vepřový řízek, hranolky', price='174', weight='150g'),
            dict(V, venue='b', venue_name='No time', eta_min='', eta_max='', fee='29', url='https://wolt.com/cs/cze/prague/restaurant/b'),
            dict(kind='D', venue='b', item='b1', dish='Kuřecí řízek, bramborová kaše', price='190', weight='150g'),
            dict(kind='D', venue='b', item='b2', dish='Vepřový řízek, hranolky', price='190', weight='150g')]
    wtable(wt, rows, ledger=False)
    run(tmp, 'ingest', rid, '--source', 'wolt', '--tsv', wt, expect=1)
    check(not os.path.exists(os.path.join(tmp, 'data', 'runs', rid, 'dishes.json')) or
          not [x for x in json.load(open(os.path.join(tmp, 'data', 'runs', rid, 'dishes.json')))['dishes'] if x['source'] == 'wolt'],
          'review 12: a table without its L row (cut-off copy) is refused, nothing ingested')
    wtable(wt, rows)
    k = json.loads(run(tmp, 'ingest', rid, '--source', 'wolt', '--tsv', wt))
    check(k['dishes_kept'] == 4 and k['venues'] == 2, 'review 12: title and blank lines before the header are skipped: %s' % k)
    run(tmp, 'options', rid)
    O = json.load(open(os.path.join(tmp, 'data', 'runs', rid, 'options.json'), encoding='utf-8'))
    tu = O['targets_used']
    check(tu['meals_usual'] == 3 and tu['meals_usual_from'] == 'default 3' and tu['share'] == round(2 / 3, 4), 'review 10: no profile = usual 3 meals: %s' % tu)
    ro = next(o for o in O['options'] if o['shop'] == 'rohlik')
    check(ro['cost_regular'] == 749.0 and 'minimum' in ro['notes'], 'review 2: Rohlík below its 749 CZK minimum is counted as 749: %s' % ro['cost_regular'])
    fa = next(o for o in O['options'] if o['label'] == 'Fee unknown')
    check(fa['delivery_fee'] is None and 'unknown, not free' in fa['notes'] and fa['cost_regular'] == 400.0, 'review 6: unknown fee stays unknown (null): %s %s' % (fa['delivery_fee'], fa['cost_regular']))
    nb = next(o for o in O['options'] if o['label'] == 'No time')
    check(nb['delivery_min'] is None and nb['minutes_per_day'] == 5 + 45 + 3 and 'No delivery time shown' in nb['notes'], 'review 7: no time = the request limit 45 min: %s' % nb['minutes_per_day'])
    # 8, 9: basket lines added up, extra lines flagged, minimum order and basket fees applied
    bt = os.path.join(tmp, 'b.tsv')
    with open(bt, 'w', encoding='utf-8') as f:
        f.write('item\tqty\tline_price\na1\t1\t174\na2\t1\t174\n_delivery_fee\t1\t39\n')
    b = json.loads(run(tmp, 'basket', rid, '--option', fa['id'], '--tsv', bt))
    check(b['cost_regular'] == 400 + 39 and not b['problems'], 'review 8: basket 348 under the 400 minimum + basket fee 39 = 439: %s' % b)
    with open(bt, 'w', encoding='utf-8') as f:
        f.write('item\tqty\tline_price\na1\t1\t174\na1\t1\t174\na2\t1\t174\nzz\t1\t99\n')
    b = json.loads(run(tmp, 'basket', rid, '--option', fa['id'], '--tsv', bt))
    check(any('basket has 2, plan 1' in x for x in b['problems']) and any('not in the plan' in x for x in b['problems']),
          'review 9 and 11: the same dish twice is added up; a line not in the plan is a problem: %s' % b['problems'])
    # 1. eat out: a restaurant with one dish and 3 meals a day does not crash
    run(tmp, 'survey', 'Westfield Chodov', '--tsv', os.path.join(HERE, 'fixtures', 'dine', 'raw_restaurants.tsv'), '--walk-col', 'walk_C', '--m-col', 'm_C')
    eo = dict(base, id='REQ-20261019-230001-rv', mode='eatout', meals_per_day=3, order=None, eatout={'max_walk_min': 15},
              location={'id': 'L-0002', 'name': 'Westfield Chodov', 'address': '', 'walk_limit_min': 15})
    put_req(tmp, eo)
    mt = os.path.join(tmp, 'm.tsv')
    with open(os.path.join(HERE, 'fixtures', 'dine', 'menicka.tsv'), encoding='utf-8') as f:
        lines = f.read().splitlines()
    one = [ln for ln in lines if ln.startswith('V\t8784') or ln.startswith('D\t8784\t')][:2] + [ln for ln in lines if ln.startswith('L')]
    with open(mt, 'w', encoding='utf-8') as f:
        f.write('\n'.join([lines[0]] + one) + '\n')
    run(tmp, 'ingest', eo['id'], '--source', 'menicka', '--tsv', mt)
    out = json.loads(run(tmp, 'options', eo['id']).strip().split('\n')[-1])
    check(len(out['too_few_dishes']) == 1, 'review 1: one dish for 3 meals = listed as too few, no crash: %s' % out)
    shutil.rmtree(tmp)


def main():
    t_twin()
    t_flow()
    t_review()
    for f in FAIL:
        print('FAIL', f)
    print('%d checks, %d failed' % (N[0], len(FAIL)))
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
