"""foods.py tests. Run from MealPlanner/: python tests/t_foods.py"""
import json, os, subprocess, sys, tempfile
d = tempfile.mkdtemp(prefix='mp-foods-')
def run(*a, stdin=None):
    p = subprocess.run([sys.executable, 'tools/foods.py', '--data', d] + list(a), input=stdin, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr
ok = 0; bad = 0
def t(name, cond):
    global ok, bad
    if cond: ok += 1
    else: bad += 1; print('FAIL', name)
tv = {'id': 'rohlik-1469745', 'shop': 'rohlik', 'name': 'Miil Tvaroh odtučněný 250 g', 'category': 'tvaroh', 'price': 17.91, 'pack_g': 250, 'unit': 'g',
      'per100g': {'kcal': 64, 'protein': 12, 'fat': 0.5, 'carbs': 4}, 'nutrition_label': 'exact', 'price_label': 'online',
      'seen': '2026-10-18T20:00:00+02:00', 'url': 'https://www.rohlik.cz/1469745', 'expect': {'category': 'tvaroh', 'min_protein': 8, 'name_has': ['tvaroh']}}
ice = dict(tv, id='rohlik-999', name='Zmrzlina tvarohová 50 ml', category='zmrzlina', per100g={'kcal': 210, 'protein': 3.5, 'fat': 11, 'carbs': 24})
rc, out, err = run('add', '-', stdin=json.dumps([tv, ice]))
r = json.loads(out)
t('valid added', r['added'] == ['rohlik-1469745'])
t('ice cream refused', len(r['refused']) == 1 and any('floor' in x for x in r['refused'][0]['reasons']))
t('exit 1 when refused', rc == 1)
data = json.load(open(os.path.join(d, 'foods', 'foods.json'), encoding='utf-8'))
t('expect not stored', 'expect' not in data['items'][0])
t('czech letters kept', data['items'][0]['name'] == 'Miil Tvaroh odtučněný 250 g')
tv2 = dict(tv, price=16.11, price_label='cart', seen='2026-10-18T21:00:00+02:00')
rc, out, err = run('add', '-', stdin=json.dumps(tv2))
r = json.loads(out)
t('price change recorded', r['price_changed'] == [{'id': 'rohlik-1469745', 'old': 17.91, 'new': 16.11}])
data = json.load(open(os.path.join(d, 'foods', 'foods.json'), encoding='utf-8'))
t('history has old price', data['items'][0]['price_history'][0]['price'] == 17.91 and data['items'][0]['first_seen'] == '2026-10-18T20:00:00+02:00')
t('daily backup made', len(os.listdir(os.path.join(d, 'foods', 'daily-copies'))) == 1)
# 2026-11-05: stock is not price. Unknown -> known stock at the same price: updated, no price change, no history row
nh = len(data['items'][0]['price_history'])
rc, out, err = run('add', '-', stdin=json.dumps(dict(tv2, in_stock=True, seen='2026-10-18T22:00:00+02:00')))
r = json.loads(out)
data = json.load(open(os.path.join(d, 'foods', 'foods.json'), encoding='utf-8'))
t('stock unknown -> in stock at the same price is not a price change', r['price_changed'] == [] and r['stock_changed'] == [] and r['updated'] == ['rohlik-1469745'] and len(data['items'][0]['price_history']) == nh)
# known -> known (sold out) at the same price: stock_changed and one history row, still no price change
rc, out, err = run('add', '-', stdin=json.dumps(dict(tv2, in_stock=False, seen='2026-10-18T23:00:00+02:00')))
r = json.loads(out)
data = json.load(open(os.path.join(d, 'foods', 'foods.json'), encoding='utf-8'))
t('sold out at the same price = stock_changed with a history row, never price_changed', r['price_changed'] == [] and r['stock_changed'] == [{'id': 'rohlik-1469745', 'old': True, 'new': False}]
  and len(data['items'][0]['price_history']) == nh + 1 and data['items'][0]['price_history'][-1]['in_stock'] is True)
for badit, word in [(dict(tv, loyalty=[{'card': 'rohlik-xtra', 'price': 20}]), 'higher'), (dict(tv, seen='2026-10-18'), 'time zone'),
                    (dict(tv, nutrition_label='table'), 'nutrition_source'), (dict(tv, id='billa-1'), 'start with'), (dict(tv, per100g={'kcal': 64, 'protein': 120}), 'range'),
                    (dict(tv, price='17,91'), 'price'), (dict(tv, unit='pcs'), 'pieces')]:
    rc, out, err = run('add', '-', stdin=json.dumps(badit))
    r = json.loads(out)
    t('refuse ' + word, rc == 1 and any(word in x for x in r['refused'][0]['reasons']))
rc, out, err = run('validate'); t('validate ok', rc == 0 and '0 problems' in out)
rc, out, err = run('list', '--search', 'tvaroh odtucneny'); t('search without accents', 'rohlik-1469745' in out)
# lock: a fresh busy lock refuses
from datetime import datetime, timezone
open(os.path.join(d, 'foods', 'foods.lock'), 'w').write('busy %s pid 1\n' % datetime.now(timezone.utc).isoformat(timespec='seconds'))
rc, out, err = run('add', '-', stdin=json.dumps(tv)); t('busy lock refuses', rc != 0 and 'being written' in (out + err))
open(os.path.join(d, 'foods', 'foods.lock'), 'w').write('busy 2026-01-01T00:00:00+00:00 pid 1\n')
rc, out, err = run('add', '-', stdin=json.dumps(tv)); t('stale lock passes', rc == 0)
t('lock freed', open(os.path.join(d, 'foods', 'foods.lock')).read().startswith('free'))
# broken main file restored from next
open(os.path.join(d, 'foods', 'foods.json'), 'w').write('{"items": [')
rc, out, err = run('list'); t('restored from next', rc == 0 and 'rohlik-1469745' in out and 'restored' in err)
print(('FAIL %d' % bad) if bad else 'PASS %d foods.py checks' % ok)
sys.exit(1 if bad else 0)
