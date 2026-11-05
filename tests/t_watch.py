#!/usr/bin/env python3
"""Price watch helper (tools/watch.py, session 5): targets and ingest on a temporary data folder built from fixtures.
Run from the MealPlanner folder: python3 tests/t_watch.py    (the real data/ is never touched)."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone

ROOT = os.path.abspath('.')
PY = sys.executable
tmp = tempfile.mkdtemp(prefix='mp-watch-')
DATA = os.path.join(tmp, 'data')
for d in ('foods', 'results', 'requests', 'updates', 'users/anna', 'users/ben'):
    os.makedirs(os.path.join(DATA, d))
json.dump({'version': 1, 'lang': 'en', 'last_user': 'anna', 'stale_days': 14, 'replan_pct': 10, 'watch_pct': 5}, open(os.path.join(DATA, 'app-settings.json'), 'w'))
PRG = timezone(timedelta(hours=2))
now = datetime.now(PRG)
TODAY = now.date().isoformat()


def iso(days_ago):
    return (now - timedelta(days=days_ago)).isoformat(timespec='seconds')


def food(pid, name, price, cat='tvaroh', protein=12, in_stock=True, seen=None):
    return {'id': 'rohlik-%s' % pid, 'shop': 'rohlik', 'shop_product_id': str(pid), 'name': name, 'price': price, 'currency': 'CZK', 'pack_g': 250, 'unit': 'g',
            'per100g': {'kcal': 70, 'protein': protein, 'fat': 0.5, 'carbs': 4, 'salt': 0.1}, 'nutrition_label': 'exact', 'nutrition_source': 'shop nutrition table',
            'price_label': 'online', 'seen': seen or iso(1), 'category': cat, 'in_stock': in_stock, 'url': 'https://www.rohlik.cz/%s' % pid,
            'first_seen': seen or iso(1), 'price_history': []}


foods = [food(100, 'Miil Tvaroh odtučněný', 17.91), food(101, 'Miil Skyr natur', 17.91, 'skyr'), food(102, 'Kitchin Rýže', 26.91, 'ryze', 7),
         food(103, 'Kitchin Čočka', 30.51, 'cocka', 24), food(104, 'Old plan oats', 27.9, 'ovesne-vlocky', 13), food(105, 'Frosta zelenina', 69.9, 'zelenina', 3, in_stock=False),
         food(106, 'Picked plan eggs', 59.9, 'vejce', 12), food(107, 'Unused tuna', 39.9, 'tunak', 25)]
json.dump({'version': 1, 'updated': None, 'items': foods}, open(os.path.join(DATA, 'foods', 'foods.json'), 'w'), ensure_ascii=False)


def result(rid, finished, options, mode='cook', status='done'):
    r = {'id': rid, 'request': {'id': rid, 'mode': mode, 'start_date': finished[:10], 'days': 3, 'user_id': 'anna'}, 'finished': finished, 'status': status, 'options': options}
    json.dump(r, open(os.path.join(DATA, 'results', rid + '.json'), 'w'), ensure_ascii=False)


# a fresh Cook result (3 days ago): rohlik items in O1, a Košík item, a mixed option
result('REQ-A', iso(3), [
    {'id': 'O1', 'shop': 'rohlik', 'items': [{'id': 'rohlik-100', 'shop': 'rohlik', 'product_id': '100', 'name': 'Miil Tvaroh odtučněný', 'packs': 4, 'cost': 71.64},
                                             {'id': 'rohlik-101', 'shop': 'rohlik', 'product_id': '101', 'packs': 2, 'cost': 35.82},
                                             {'id': 'rohlik-102', 'shop': 'rohlik', 'product_id': '102', 'packs': 1, 'cost': 26.91},
                                             {'id': 'rohlik-105', 'shop': 'rohlik', 'product_id': '105', 'packs': 1, 'cost': 69.9}]},
    {'id': 'O2', 'shop': 'kosik', 'items': [{'id': 'kosik-555', 'shop': 'kosik', 'product_id': '555', 'packs': 1, 'cost': 20}]},
    {'id': 'O3', 'shop': 'lidl+rohlik', 'items': [{'id': 'lidl-kupi-vejce', 'shop': 'lidl', 'packs': 1, 'cost': 50}, {'id': 'rohlik-103', 'shop': 'rohlik', 'product_id': '103', 'packs': 1, 'cost': 30.51}]}])
# an Order online result (yesterday): Rohlík ready meals with ":" ids, not in foods.json; a Wolt option
result('REQ-B', iso(1), [
    {'id': 'O1', 'shop': 'wolt', 'items': [{'id': 'wolt:abc', 'shop': 'wolt', 'product_id': 'abc', 'price': 105}]},
    {'id': 'O3', 'shop': 'rohlik', 'items': [{'id': 'rohlik:900', 'shop': 'rohlik', 'product_id': '900', 'name': 'Kuřecí paprikáš', 'price': 127.4, 'packs': 3}]}], mode='order')
# an old result (20 days ago): its oats must not be watched
result('REQ-OLD', iso(20), [{'id': 'O1', 'shop': 'rohlik', 'items': [{'id': 'rohlik-104', 'shop': 'rohlik', 'product_id': '104', 'packs': 1, 'cost': 27.9}]}])
# an error result: never watched
result('REQ-ERR', iso(1), [{'id': 'O1', 'shop': 'rohlik', 'items': [{'id': 'rohlik-107', 'shop': 'rohlik', 'product_id': '107', 'packs': 1, 'cost': 39.9}]}], status='error')
# a result 25 days old whose plan ben PICKED 10 days ago: watched through the picked plan
result('REQ-P', iso(25), [{'id': 'O2', 'shop': 'rohlik', 'items': [{'id': 'rohlik-106', 'shop': 'rohlik', 'product_id': '106', 'packs': 2, 'cost': 119.8}]},
                          {'id': 'O1', 'shop': 'rohlik', 'items': [{'id': 'rohlik-107', 'shop': 'rohlik', 'product_id': '107', 'packs': 1, 'cost': 39.9}]}])
json.dump({'version': 1, 'weighins': [], 'spend': [], 'plans': [{'id': 'P-0001', 'request_id': 'REQ-P', 'option_id': 'O2', 'picked_at': iso(10)}], 'notes': []},
          open(os.path.join(DATA, 'users', 'ben', 'history.json'), 'w'))
json.dump({'version': 1, 'weighins': [], 'spend': [], 'plans': [{'id': 'P-0001', 'request_id': 'REQ-P', 'option_id': 'O1', 'picked_at': iso(40)}], 'notes': []},
          open(os.path.join(DATA, 'users', 'anna', 'history.json'), 'w'))

passed, failed = 0, []


def ok(name, cond, extra=''):
    global passed
    if cond:
        passed += 1
    else:
        failed.append('%s :: %s' % (name, str(extra)[:400]))


def run(*args, expect_fail=False):
    pr = subprocess.run([PY, os.path.join(ROOT, 'tools', 'watch.py'), '--data', DATA] + list(args), capture_output=True, text=True, encoding='utf-8')
    if expect_fail:
        return pr
    if pr.returncode != 0:
        raise SystemExit('watch.py failed: %s\n%s\n%s' % (args, pr.stdout[-800:], pr.stderr[-800:]))
    return json.loads(pr.stdout) if pr.stdout.strip().startswith('{') else pr.stdout


# ---------- targets ----------
t = run('targets')
ids = t['rohlik_ids']
ok('targets: items of fresh results, in every option, rohlik only', all(x in ids for x in (100, 101, 102, 103, 105)) and 555 not in ids, ids)
ok('targets: Rohlík ready meals of an Order result (":" ids, not in foods.json) are watched too', 900 in ids and 'rohlik-900' in t['not_in_foods'], t['not_in_foods'])
ok('targets: a result older than 14 days is not watched; an error result never', 104 not in ids and 107 not in ids, ids)
ok('targets: a plan picked 10 days ago is watched although its result is 25 days old; one picked 40 days ago is not', 106 in ids and 107 not in ids, ids)
ok('targets: batches of 20, header and how-to printed', t['batches'] == [ids] and t['tsv_header'] == 'id\tprice\toriginal_price\tin_stock' and 'salePrice' in t['how'], t['batches'])
tj = json.load(open(os.path.join(DATA, 'runs', 'watch-' + TODAY, 'targets.json'), encoding='utf-8'))
ok('targets.json says why each product is watched and its result price', tj['why']['rohlik-106'][0].startswith('picked plan P-0001 of ben') and tj['result_price']['rohlik-900'] == 127.4 and tj['item_ids']['rohlik-900'] == ['rohlik:900'], tj['why'])
ok('targets: most recent plans first', ids.index(900) < ids.index(100), ids)

# cap
os.makedirs(os.path.join(tmp, 'steps'), exist_ok=True)
shutil.copytree(os.path.join(ROOT, 'tools'), os.path.join(tmp, 'tools'))
json.dump({'test_only': False, 'measure': True, 'watch': {'watch_max_ids': 3, 'watch_batch': 2}}, open(os.path.join(tmp, 'steps', 'run-settings.json'), 'w'))
pr = subprocess.run([PY, os.path.join(tmp, 'tools', 'watch.py'), '--data', DATA, 'targets'], capture_output=True, text=True, encoding='utf-8')
t3 = json.loads(pr.stdout)
ok('targets: watch_max_ids caps the list (newest first) and watch_batch splits it', t3['count'] == 3 and t3['dropped_over_max'] >= 4 and [len(b) for b in t3['batches']] == [2, 1], t3)
run('targets')  # back to the full list for ingest

# ---------- ingest ----------
tsv = os.path.join(tmp, 'rohlik.tsv')
rows = ['id\tprice\toriginal_price\tin_stock',
        '100\t18.79\t\ttrue',        # +4.9 %: small move, not reported
        '101\t18.81\t\ttrue',        # +5.0 %: reported
        '102\t26.91\t\tfalse',       # same price, sold out
        '103\t30.51\t\ttrue',        # unchanged
        '105\t69.9\t\ttrue',         # was out of stock, back
        '900\t139.9\t\ttrue',        # ready meal +9.8 % against the result price
        '106\t53.91\t59.9\ttrue',    # -10 % sale
        '777\t1.0\t\ttrue',          # not watched: ignored
        '102\t99\t\ttrue']           # a second row for the same id: ignored
open(tsv, 'w', encoding='utf-8').write('\n'.join(rows) + '\n')
s = run('ingest', '--tsv', tsv)
ok('ingest: counts', s['checked'] == 7 and s['changed'] == 5 and s['small_moves'] == 1 and s['sold_out'] == 1 and s['back_in_stock'] == 1, s)
ok('ingest: notify true with a plain message naming the biggest change', s['notify'] and 'biggest: Picked plan eggs 59.90 -> 53.91 CZK (-10.0 %)' in s['message'] and '3 prices moved 5 % or more' in s['message'], s['message'])
ok('ingest: ids not watched are listed, not counted', s['not_watched'] == ['rohlik-777'] and s['not_in_foods'] == [], s)
u = json.load(open(os.path.join(DATA, 'updates', TODAY + '.json'), encoding='utf-8'))
ch = {c['food_id']: c for c in u['changes']}
ok('update file: created, source, watch_pct, changes with pct, sold_out, back_in_stock, item_ids', u['source'] == 'rohlik' and u['watch_pct'] == 5 and ch['rohlik-101']['pct'] == 5.0 and ch['rohlik-101']['report'] is True
   and ch['rohlik-100']['pct'] == 4.9 and ch['rohlik-100']['report'] is False and ch['rohlik-102']['sold_out'] is True and ch['rohlik-105']['back_in_stock'] is True
   and ch['rohlik-900']['item_ids'] == ['rohlik:900'] and ch['rohlik-900']['baseline'] == 'result' and ch['rohlik-900']['pct'] == 9.8, ch)
ok('update file: unchanged product not listed', 'rohlik-103' not in ch, list(ch))
ok('update file: a product that is not watched (old oats 104) never appears', 'rohlik-104' not in ch and 'rohlik-106' in ch, list(ch))
f = {it['id']: it for it in json.load(open(os.path.join(DATA, 'foods', 'foods.json'), encoding='utf-8'))['items']}
ok('foods.json: new price, seen today, old price in price_history, sale note', f['rohlik-106']['price'] == 53.91 and f['rohlik-106']['seen'][:10] == TODAY and f['rohlik-106']['price_history'][0]['price'] == 59.9
   and f['rohlik-106']['notes'] == 'sale: was 59.90 CZK' and f['rohlik-101']['price'] == 18.81, f['rohlik-106'])
ok('foods.json: sold out keeps the price, sets in_stock false; back in stock sets true', f['rohlik-102']['in_stock'] is False and f['rohlik-102']['price'] == 26.91 and f['rohlik-105']['in_stock'] is True, (f['rohlik-102'], f['rohlik-105']))
ok('foods.json: small move still stored (18.79) with history', f['rohlik-100']['price'] == 18.79 and f['rohlik-100']['price_history'][0]['price'] == 17.91, f['rohlik-100'])
ok('foods.json: ready meal not added (no nutrition record), unused tuna untouched', 'rohlik-900' not in f and f['rohlik-107']['seen'] != f['rohlik-101']['seen'], list(f))

# second run the same day: nothing changed now -> notify false, file -2
s2 = run('ingest', '--tsv', tsv)
ok('second run: no change, notify false, message says so', s2['changed'] == 0 and s2['notify'] is False and s2['message'].startswith('Meal Planner price watch: no change (7 products checked'), s2)
ok('second run: never overwrites, writes <date>-2.json', os.path.exists(os.path.join(DATA, 'updates', TODAY + '-2.json')), os.listdir(os.path.join(DATA, 'updates')))

# a watched id with no row = sold out (the connector did not return it)
rows2 = ['id\tprice\toriginal_price\tin_stock', '100\t18.79\t\ttrue']
open(tsv, 'w', encoding='utf-8').write('\n'.join(rows2) + '\n')
s3 = run('ingest', '--tsv', tsv)
u3 = json.load(open(os.path.join(DATA, 'updates', TODAY + '-3.json'), encoding='utf-8'))
miss = {c['food_id']: c for c in u3['changes']}
ok('missing rows: every watched id without a row is reported sold out, with a note, also the ready meal; one already out of stock is not repeated', s3['sold_out'] == 5 and 'rohlik-102' not in miss and miss['rohlik-101']['sold_out'] and 'no row' in miss['rohlik-101']['note'] and miss['rohlik-900']['sold_out'] and s3['checked'] == 7, s3)
f3 = {it['id']: it for it in json.load(open(os.path.join(DATA, 'foods', 'foods.json'), encoding='utf-8'))['items']}
ok('missing rows: foods.json marks them out of stock, price kept', f3['rohlik-101']['in_stock'] is False and f3['rohlik-101']['price'] == 18.81, f3['rohlik-101'])
wl = json.load(open(os.path.join(DATA, 'runs', 'watch-last.json'), encoding='utf-8'))
ok('ready meal (no foods record): last seen price kept in runs/watch-last.json, so day 2 compares with day 1, not with the plan', wl['rohlik-900']['in_stock'] is False and wl['rohlik-900']['price'] == 139.9, wl)

# watch_pct from app-settings (8 %): a 5 % move is small
json.dump({'version': 1, 'lang': 'en', 'last_user': 'anna', 'stale_days': 14, 'replan_pct': 10, 'watch_pct': 8}, open(os.path.join(DATA, 'app-settings.json'), 'w'))
rows3 = ['id\tprice\toriginal_price\tin_stock'] + ['%s\t%s\t\ttrue' % (p, v) for p, v in (('100', '19.9'), ('101', '18.81'), ('102', '26.91'), ('103', '30.51'), ('105', '69.9'), ('900', '127.4'), ('106', '53.91'))]
open(tsv, 'w', encoding='utf-8').write('\n'.join(rows3) + '\n')
s4 = run('ingest', '--tsv', tsv)
ok('watch_pct 8 from app-settings: +5.9 % is a small move; the 6 products missing in the last run are back in stock', s4['small_moves'] == 1 and s4['changed'] == 6 and s4['back_in_stock'] == 6 and '8 % or more' in s4['message'] and '139.90 -> 127.40' in s4['message'], s4)

# audit fixes (session 5): blank stock cell, BOM, refused item, show on a broken file, targets missing, corrupt foods.json, naive times
json.dump({'version': 1, 'lang': 'en', 'last_user': 'anna', 'stale_days': 14, 'replan_pct': 10, 'watch_pct': 5}, open(os.path.join(DATA, 'app-settings.json'), 'w'))
f5 = json.load(open(os.path.join(DATA, 'foods', 'foods.json'), encoding='utf-8'))
for it in f5['items']:
    if it['id'] == 'rohlik-103':
        it['loyalty'] = [{'card': 'rohlik-xtra', 'price': 28.0}]   # a card price read earlier; tonight the normal price falls under it
json.dump(f5, open(os.path.join(DATA, 'foods', 'foods.json'), 'w', encoding='utf-8'), ensure_ascii=False)
rows5 = ['id\tprice\toriginal_price\tin_stock', '100\t19.9\t\t', '101\t18.81\t\ttrue', '102\t26.91\t\ttrue', '103\t25.0\t\ttrue', '105\t69.9\t\ttrue', '900\t127.4\t\ttrue', '106\t53.91\t\ttrue']
open(tsv, 'w', encoding='utf-8-sig').write('\r\n'.join(rows5) + '\r\n')
s5 = run('ingest', '--tsv', tsv)
ok('audit 6: a blank stock cell with a price keeps the old stock state and is listed, not reported sold out', s5['stock_unknown'] == ['rohlik-100'] and s5['sold_out'] == 0 and 'no stock state' in s5['message'], s5)
ok('audit 9: a BOM and Windows line endings are accepted', s5['checked'] == 7, s5)
f6 = {it['id']: it for it in json.load(open(os.path.join(DATA, 'foods', 'foods.json'), encoding='utf-8'))['items']}
ok('audit 5: a card price above the new normal price is dropped, the item is stored (not refused), moved counted', 'loyalty' not in f6['rohlik-103'] and f6['rohlik-103']['price'] == 25.0 and s5['refused_by_foods'] == [] and s5['moved'] >= 1, (f6['rohlik-103'], s5['foods']))
open(os.path.join(DATA, 'updates', 'broken.json'), 'w').write('not json')
ok('audit 10: show survives an unreadable update file', '(unreadable)' in run('show'))
os.remove(os.path.join(DATA, 'runs', 'watch-' + TODAY, 'targets.json'))
pr = run('ingest', '--tsv', tsv, expect_fail=True)
ok('audit 19: ingest without today\'s targets.json is refused with ERROR', pr.returncode != 0 and 'ERROR' in (pr.stdout + pr.stderr) and 'targets' in (pr.stdout + pr.stderr), pr.stderr[-200:])
run('targets')
# a result with a naive finished time is skipped and said
result('REQ-NAIVE', '2026-10-19T10:00:00', [{'id': 'O1', 'shop': 'rohlik', 'items': [{'id': 'rohlik-107', 'shop': 'rohlik', 'product_id': '107', 'packs': 1, 'cost': 39.9}]}])
t7 = run('targets')
ok('audit 14: a result whose finished time has no time zone is skipped and named', 107 not in t7['rohlik_ids'] and any('REQ-NAIVE' in x for x in t7['results_skipped']), t7['results_skipped'])
os.remove(os.path.join(DATA, 'results', 'REQ-NAIVE.json'))
# corrupt foods.json with a good foods.next.json: restored, no traceback
fp_ = os.path.join(DATA, 'foods', 'foods.json')
good = open(fp_, encoding='utf-8').read()
open(os.path.join(DATA, 'foods', 'foods.next.json'), 'w', encoding='utf-8').write(good)
open(fp_, 'w', encoding='utf-8').write(good[:40])
t8 = run('targets')
ok('audit 7: a broken foods.json is restored from foods.next.json by the watch too', t8['count'] >= 7 and json.load(open(fp_, encoding='utf-8'))['items'], t8.get('count'))
open(fp_, 'w', encoding='utf-8').write('{broken')
open(os.path.join(DATA, 'foods', 'foods.next.json'), 'w', encoding='utf-8').write('{broken too')
pr = subprocess.run([PY, os.path.join(ROOT, 'tools', 'watch.py'), '--data', DATA, 'targets'], capture_output=True, text=True, encoding='utf-8')
ok('audit 7: both copies broken = one ERROR line, no traceback', pr.returncode != 0 and 'ERROR: foods.json unreadable' in (pr.stdout + pr.stderr) and 'Traceback' not in pr.stderr, pr.stderr[-300:])
open(fp_, 'w', encoding='utf-8').write(good)
open(os.path.join(DATA, 'foods', 'foods.next.json'), 'w', encoding='utf-8').write(good)
run('targets')

# errors
open(tsv, 'w', encoding='utf-8').write('id\tprice\n100\t1\n')
pr = run('ingest', '--tsv', tsv, expect_fail=True)
ok('missing columns refused with the header named', pr.returncode != 0 and 'original_price' in (pr.stdout + pr.stderr), pr.stderr)
open(tsv, 'w', encoding='utf-8').write('')
pr = run('ingest', '--tsv', tsv, expect_fail=True)
ok('empty file refused', pr.returncode != 0, pr.stderr)
pr = run('ingest', expect_fail=True)
ok('ingest without --tsv refused', pr.returncode != 0, pr.stderr)
ok('show prints the file in words', 'SOLD OUT' in run('show', TODAY) and 'Picked plan eggs' in run('show'), run('show', TODAY)[:300])
ok('help printed', 'targets' in run('--help') and 'ingest' in run('--help'))

# nothing to watch
DATA2 = os.path.join(tmp, 'data2')
os.makedirs(os.path.join(DATA2, 'foods'))
json.dump({'version': 1, 'updated': None, 'items': []}, open(os.path.join(DATA2, 'foods', 'foods.json'), 'w'))
pr = subprocess.run([PY, os.path.join(ROOT, 'tools', 'watch.py'), '--data', DATA2, 'targets'], capture_output=True, text=True, encoding='utf-8')
ok('no results at all: none true, count 0', json.loads(pr.stdout)['none'] is True and json.loads(pr.stdout)['count'] == 0, pr.stdout[:200])

shutil.rmtree(tmp, ignore_errors=True)
if failed:
    print('\n'.join('FAIL ' + f for f in failed))
    print('%d passed, %d failed' % (passed, len(failed)))
    sys.exit(1)
print('PASS %d watch.py checks' % passed)
