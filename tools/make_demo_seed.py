#!/usr/bin/env python3
"""Builds app/demo/seed.json: the sample data a new demo account starts with (web app, 2026-11-05).

Nothing in it is invented by hand where a tool can make it: the Cook result is made by the real pipeline
(tools/cook.py pick / ingest / borrow / options / result, then planner.py score-result) on the shop rows read on
19/10/2026 that tests/t_cook.py already uses (tests/fixtures/cook/). The person is the kit's test person
"Tomáš Dvořák" (never a real user). The request's targets come from planner.py for the demo profile, so the
demo shows the same numbers the app computes.

Run from the repository root:  python3 tools/make_demo_seed.py
The app shifts every date in the seed by whole days when a demo account is created, so the newest moment
(`anchor`) lands one hour before "now" and prices do not look 3 weeks old.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
FX = os.path.join(ROOT, 'tests', 'fixtures', 'cook')
OUT = os.path.join(ROOT, 'app', 'demo', 'seed.json')
SEEN = '2026-10-19T10:30:00+02:00'
# 2026-11-08: Rohlík re-read through the connector (batch_search_products + get_product_details, read only): 4 products each of
# tvaroh, oats and rice, with the connector's sale end (prices.saleValidTill) -> tests/fixtures/cook/rohlik-2026-11-08.tsv.
# They give the demo real backups and real sale end dates. Košík, Tesco and the leaflets stay as read on 19/10.
SEEN2 = '2026-11-08T15:46:00+01:00'
FINISHED = '2026-11-08T15:50:00+01:00'
USER = 'tomas-dvorak'

sys.path.insert(0, os.path.join(ROOT, 'tools'))
import planner  # noqa: E402

profile = {
    'id': USER, 'name': 'Tomáš Dvořák', 'lang': 'en', 'created': '2026-09-07T18:00:00+02:00', 'version': 1,
    'body': {'sex': 'm', 'birth_date': '2003-05-14', 'height_cm': 180, 'life_stage': 'none', 'trimester': None, 'lactation_period': None},
    'activity': {'pal': 1.76},
    'goal': {'type': 'gain', 'gain_kg': 3, 'weeks': 12, 'surplus_pct': None, 'protein_g_per_kg': None,
             'start_date': '2026-09-07', 'start_kg': 72.4},
    'budget': {'amount': 1400, 'period': 'week', 'currency': 'CZK'},
    'cards': ['lidl-plus', 'tesco-clubcard'], 'cards_other': [],
    'locations': [{'id': 'L-0001', 'name': 'Blanice kolej', 'address': 'Chemická 955, Praha 4', 'walk_limit_min': 30}],
    'accounts': [{'id': 'A-0001', 'shop': 'rohlik', 'account_name': 'Tomáš Dvořák', 'email': ''}],
    'likes': 'kuře, rýže, tvaroh', 'dislikes': 'tuňák', 'allergies': '',
    'cooking': {'max_cook_min': 40, 'meals_per_day': 3},
    'weights': dict(planner.DEFAULT_WEIGHTS),
}
weighins = [('2026-09-07', 72.4), ('2026-09-14', 72.6), ('2026-09-21', 72.5), ('2026-09-28', 72.9), ('2026-10-05', 73.1), ('2026-10-12', 73.4), ('2026-10-19', 73.6),
            ('2026-10-26', 73.7), ('2026-11-02', 73.8), ('2026-11-08', 73.9)]
history = {
    'version': 1,
    'weighins': [{'id': 'W-%04d' % (i + 1), 'date': d, 'kg': kg, 'note': ''} for i, (d, kg) in enumerate(weighins)],
    'spend': [{'id': 'S-0001', 'date': '2026-10-06', 'czk': 412.5, 'shop': 'lidl', 'note': 'week shop'},
              {'id': 'S-0002', 'date': '2026-10-13', 'czk': 388.9, 'shop': 'lidl', 'note': ''},
              {'id': 'S-0003', 'date': '2026-10-15', 'czk': 229.0, 'shop': 'wolt', 'note': 'curry'}],
    'plans': [], 'notes': [{'id': 'N-0001', 'date': '2026-10-12', 'text': 'Gym 3x a week from now on.'}],
}
changes = {'list': [{'id': 'C-0001', 'at': profile['created'], 'who': profile['name'], 'label': 'profile_created',
                     'ops': [{'file': 'profile', 'path': '', 'old': None, 'new': profile}], 'no_undo': True}]}

tg = planner.targets(profile, weighins[-1][1], '2026-11-08')
assert tg['ok'], tg

tmp = tempfile.mkdtemp(prefix='mp-demo-')
try:
    for d in ('tools', 'steps'):
        shutil.copytree(os.path.join(ROOT, d), os.path.join(tmp, d))
    for d in ('shops', 'foods', 'requests'):
        os.makedirs(os.path.join(tmp, 'data', d))
    shutil.copy(os.path.join(ROOT, 'tests', 'fixtures', 'shops.json'), os.path.join(tmp, 'data', 'shops', 'shops.json'))
    json.dump({'version': 1, 'updated': None, 'items': []}, open(os.path.join(tmp, 'data', 'foods', 'foods.json'), 'w'))
    req = json.load(open(os.path.join(FX, 'request.json'), encoding='utf-8'))
    req['targets'] = {'protein_g': tg['protein_g'], 'kcal': tg['kcal'], 'mode': tg['mode'], 'protein_g_per_kg': tg['protein_g_per_kg'], 'weight_kg': weighins[-1][1]}
    req['budget_total'] = 1400
    req['budget_per_day'] = 200
    req['location'] = profile['locations'][0]
    req['meals_usual'] = 3
    req['rules'] = {'cart_only_never_pay': True, 'replan_if_cart_off_pct': 10, 'stale_days': 14, 'planner_version': planner.VERSION}
    # the demo request is the 08/11 re-plan (its result uses the Rohlík prices read then); starts the next day
    req['id'] = 'REQ-20261108-154000-tomas-dvorak'
    req['created'] = '2026-11-08T15:40:00+01:00'
    req['start_date'] = '2026-11-09'
    rid = req['id']
    json.dump(req, open(os.path.join(tmp, 'data', 'requests', rid + '.json'), 'w', encoding='utf-8'), ensure_ascii=False)

    def cook(*args):
        p = subprocess.run([sys.executable, os.path.join(tmp, 'tools', 'cook.py')] + list(args), capture_output=True, text=True, cwd=tmp, encoding='utf-8')
        if p.returncode != 0:
            raise SystemExit('cook.py %s failed: %s %s' % (args[:2], p.stdout[-400:], p.stderr[-400:]))
        return p.stdout

    # the 19/10 Rohlík fixture holds two test placeholders (ids 1111 and 2222, not real products): never in the demo,
    # where every product is a link (the real oats and rice read on 08/11 replace them)
    rtsv = os.path.join(tmp, 'rohlik-1019.tsv')
    lines = open(os.path.join(FX, 'rohlik.tsv'), encoding='utf-8').read().splitlines()
    open(rtsv, 'w', encoding='utf-8').write('\n'.join(l for l in lines if l.split('\t')[1:2] not in (['1111'], ['2222'])) + '\n')
    for src in ('rohlik', 'kosik', 'tesco', 'kupi'):
        cook('ingest', rid, '--source', src, '--tsv', rtsv if src == 'rohlik' else os.path.join(FX, src + '.tsv'), '--seen', SEEN)
    cook('ingest', rid, '--source', 'rohlik', '--tsv', os.path.join(FX, 'rohlik-2026-11-08.tsv'), '--seen', SEEN2)
    cook('borrow', rid)
    cook('options', rid)
    ex = os.path.join(tmp, 'extras.json')
    json.dump({'_recipes': [
        {'name': 'Chicken, rice and vegetables', 'minutes': 25, 'steps': 'Cook the rice. Fry the chicken in strips, add the vegetables for the last 5 minutes.', 'needs': ['kureci-prsa', 'ryze']},
        {'name': 'Oats with tvaroh and milk', 'minutes': 8, 'steps': 'Cook the oats in milk, stir in the tvaroh off the heat.', 'needs': ['ovesne-vlocky']},
        {'name': 'Lentil dal', 'minutes': 25, 'steps': 'Simmer the lentils with onion and spices until soft.', 'needs': ['cocka']},
        {'name': 'Eggs on bread', 'minutes': 10, 'steps': 'Scramble the eggs, serve on bread with vegetables.', 'needs': ['vejce']}],
        '_all': {'taste': 3, 'cook_min_per_day': 35}}, open(ex, 'w'))
    cook('result', rid, '--extras', ex)
    files = {}

    def take(rel, dst=None):
        files[dst or rel] = open(os.path.join(tmp, 'data', rel), encoding='utf-8').read()

    take('foods/foods.json')
    take('shops/shops.json')
    take('requests/%s.json' % rid)
    take('results/%s.json' % rid)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

fd = json.loads(files['foods/foods.json'])
fd['updated'] = SEEN2  # foods.py stamps the build time; the newest prices were read at SEEN2
files['foods/foods.json'] = json.dumps(fd, ensure_ascii=False, indent=1) + '\n'
res = json.loads(files['results/%s.json' % rid])
# cook.py stamps "finished" with the real clock of the build day; the demo moves every date forward again when it
# starts, so a build-day stamp would land in the future (lab run 0 saw "Done 21. 11. 2026" on 5. 11.). The run's own
# time is the truth here: the prices were read at SEEN, the result finished 15 minutes later.
res['finished'] = FINISHED
files['results/%s.json' % rid] = json.dumps(res, ensure_ascii=False, indent=1) + '\n'
best = res['scored']['picks'].get('balance') or res['scored']['ranked'][0]['id']
row = next(x for x in res['scored']['ranked'] if x['id'] == best)
opt = next(o for o in res['options'] if o['id'] == best)
history['plans'].append({'id': 'P-0001', 'request_id': rid, 'option_id': best, 'label': opt['label'], 'kind': opt.get('kind'), 'shop': opt.get('shop'),
                         'days': opt.get('days') or req['days'], 'start_date': req['start_date'], 'cost_per_day': row.get('cost_per_day'),
                         'cost_total': row.get('cost_mine'), 'picked_at': '2026-11-08T15:55:00+01:00'})
changes['list'].append({'id': 'C-0002', 'at': '2026-11-08T15:55:00+01:00', 'who': profile['name'], 'label': 'plan_picked',
                        'ops': [{'file': 'history', 'path': 'plans#P-0001', 'old': None, 'new': history['plans'][0]}]})


def j(o):
    return json.dumps(o, ensure_ascii=False, indent=1) + '\n'


files['app-settings.json'] = j({'version': 1, 'lang': None, 'last_user': USER, 'stale_days': 14, 'replan_pct': 10, 'watch_pct': 5})
files['users/%s/profile.json' % USER] = j(profile)
files['users/%s/history.json' % USER] = j(history)
files['users/%s/changes.json' % USER] = j(changes)
seed = {'version': 1, 'made': 'tools/make_demo_seed.py', 'anchor': '2026-11-08T15:55:00+01:00', 'user': USER,
        'note': 'Demo data for the web app. Test person only. Cook result made by tools/cook.py on the shop rows read on 19/10/2026.',
        'files': {'data/' + k: v for k, v in sorted(files.items())}}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(seed, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('seed:', OUT, '%d files, %d bytes; %d options, picked %s (%s), targets %s g / %s kcal' % (
    len(seed['files']), os.path.getsize(OUT), len(res['options']), best, opt['label'], tg['protein_g'], tg['kcal']))
