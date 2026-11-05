#!/usr/bin/env python3
"""Meal Planner. Price watch helper for the scheduled task "Meal Planner price watch" (session 5, 2026-10-19).

The watch re-reads, once a day, the Rohlík prices of the products that matter right now (the products in recent
plans and in plans the person picked), compares them with what the plans were built on, writes one update file the
app shows as "Prices changed, re-plan?" and tells the run whether the person should be notified. Rohlík only: the
connector answers one call for many product ids (get_product_details); no browser is needed at night. Prices of the
other shops are read again at the next plan run.

Use (from the MealPlanner folder):
  python3 tools/watch.py targets                 which products to check today -> JSON {"rohlik_ids": [...], "batches": [[...]], ...}
                                                 and writes data/runs/watch-<date>/targets.json (why each product is watched)
  python3 tools/watch.py ingest --tsv <file>     the prices the run read (TSV, header exactly: id price original_price in_stock)
                                                 -> data/updates/<date>.json, foods.json (through foods.py), prints the summary
                                                 {"checked", "changed", "sold_out", "back_in_stock", "notify", "message", ...}
  python3 tools/watch.py show [<date>]           prints an update file in words (for people)
  python3 tools/watch.py --data <folder> ...     another data folder (tests)

What counts as "matters right now" (steps/run-settings.json "watch", defaults):
  - every product of every option in a result finished in the last `watch_result_days` (14) days, and
  - every product of a plan the person picked (history.json "plans") in the last `watch_picked_days` (30) days;
  only products whose shop is rohlik and whose id is numeric; at most `watch_max_ids` (60) ids, the most recent plans first.
A change is reported when the price moved by at least app-settings `watch_pct` (5) % or the product went out of stock
(or came back). The run never types a price: it copies the connector's answer into the TSV; this tool compares.
"""
import json
import os
import sys
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cook  # noqa: E402
import foods as foods_mod  # noqa: E402
from cook import load, write_new, numf, now_iso, fold  # noqa: E402

DEFAULTS = {'watch_result_days': 14, 'watch_picked_days': 30, 'watch_max_ids': 60, 'watch_batch': 20}


def data_dir():
    return cook.DATA


def load_foods():
    """foods.json through foods.py's Store (restores a broken file from foods.next.json); any other failure = ERROR, never a traceback."""
    try:
        return foods_mod.Store(data_dir()).load()
    except Exception as e:
        raise SystemExit('ERROR: foods.json unreadable (%s: %s)' % (type(e).__name__, str(e)[:120]))


def settings():
    s = dict(DEFAULTS)
    p = os.path.join(cook.MP, 'steps', 'run-settings.json')
    if os.path.exists(p):
        w = (load(p) or {}).get('watch') or {}
        for k in DEFAULTS:
            if isinstance(w.get(k), (int, float)) and w[k] > 0:
                s[k] = int(w[k])
    a = os.path.join(data_dir(), 'app-settings.json')
    s['watch_pct'] = 5
    if os.path.exists(a):
        v = (load(a) or {}).get('watch_pct')
        if isinstance(v, (int, float)) and v > 0:
            s['watch_pct'] = float(v)
    return s


def parse_dt(s):
    try:
        return cook.planner_parse_time(s)
    except Exception:
        return None


def today_str():
    return now_iso()[:10]


def watch_dir(date=None):
    return os.path.join(data_dir(), 'runs', 'watch-' + (date or today_str()))


def list_json(folder):
    if not os.path.isdir(folder):
        return []
    out = []
    for n in sorted(os.listdir(folder)):
        if n.endswith('.json'):
            try:
                out.append((n, load(os.path.join(folder, n))))
            except Exception:
                continue
    return out


def rohlik_items_of(option):
    out = []
    for it in option.get('items') or []:
        iid = it.get('id') or ''
        shop = it.get('shop') or option.get('shop')
        pid = str(it.get('product_id') or '')
        if iid.startswith('rohlik-') and iid[7:].isdigit():
            out.append((iid, iid[7:], it.get('name'), it))
        elif shop == 'rohlik' and pid.isdigit():
            out.append((iid or ('rohlik-' + pid), pid, it.get('name'), it))
    return out


def cmd_targets():
    s = settings()
    now = datetime.fromisoformat(now_iso())
    reasons = {}      # food id (rohlik-<pid>) -> list of reasons
    order = []        # most recent first
    names = {}
    item_ids = {}     # food id -> every id spelling the results use for it ("rohlik-123", "rohlik:123")
    seen_price = {}   # food id -> (when, price per pack in the most recent result): the baseline when foods.json has no entry

    def add(iid, pid, name, item, why, when):
        fid = 'rohlik-' + pid
        if fid not in reasons:
            reasons[fid] = []
            order.append((when or '', fid, pid))
        reasons[fid].append(why)
        if name:
            names[fid] = name
        item_ids.setdefault(fid, [])
        if iid not in item_ids[fid]:
            item_ids[fid].append(iid)
        price = item.get('price')
        if price is None and item.get('packs') and item.get('cost') is not None:
            price = round(float(item['cost']) / float(item['packs']), 2)
        if isinstance(price, (int, float)) and price > 0 and (fid not in seen_price or (when or '') > seen_price[fid][0]):
            seen_price[fid] = (when or '', float(price))

    results = list_json(os.path.join(data_dir(), 'results'))
    res_by_id = {r.get('id'): r for _, r in results}
    lim_r = now - timedelta(days=s['watch_result_days'])
    results_skipped = []
    for _, r in results:
        if r.get('status') != 'done':
            continue
        fin = parse_dt(r.get('finished'))
        if not fin:
            results_skipped.append('%s: finished time missing or without a time zone' % r.get('id'))
            continue
        if fin < lim_r:
            continue
        for o in r.get('options') or []:
            for iid, pid, name, item in rohlik_items_of(o):
                add(iid, pid, name, item, 'result %s option %s (finished %s)' % (r.get('id'), o.get('id'), (r.get('finished') or '')[:10]), r.get('finished'))
    users = os.path.join(data_dir(), 'users')
    lim_p = now - timedelta(days=s['watch_picked_days'])
    if os.path.isdir(users):
        for u in sorted(os.listdir(users)):
            hp = os.path.join(users, u, 'history.json')
            if not os.path.exists(hp):
                continue
            try:
                h = load(hp)
            except Exception:
                continue
            for pl in h.get('plans') or []:
                d = parse_dt(pl.get('picked_at') or pl.get('picked') or '')
                if not d or d < lim_p:   # no readable date = treated as too old
                    continue
                r = res_by_id.get(pl.get('request_id'))
                if not r:
                    continue
                for o in r.get('options') or []:
                    if o.get('id') != pl.get('option_id'):
                        continue
                    for iid, pid, name, item in rohlik_items_of(o):
                        add(iid, pid, name, item, 'picked plan %s of %s (%s)' % (pl.get('id'), u, pl.get('request_id')), pl.get('picked_at') or pl.get('picked') or '9999')
    order.sort(key=lambda x: (x[0] or ''), reverse=True)
    ids = []
    for _, fid, pid in order:
        if pid not in ids:
            ids.append(pid)
        if len(ids) >= s['watch_max_ids']:
            break
    dropped = max(0, len(order) - len(ids))
    batches = [ids[i:i + s['watch_batch']] for i in range(0, len(ids), s['watch_batch'])]
    out = {'date': today_str(), 'rohlik_ids': [int(x) for x in ids], 'batches': [[int(x) for x in b] for b in batches],
           'count': len(ids), 'dropped_over_max': dropped, 'none': not ids,
           'results_used': sum(1 for _, r in results if r.get('status') == 'done' and parse_dt(r.get('finished')) and parse_dt(r.get('finished')) >= lim_r),
           'results_skipped': results_skipped,
           'settings': s, 'tsv': os.path.join('data', 'runs', 'watch-' + today_str(), 'rohlik.tsv'),
           'tsv_header': 'id\tprice\toriginal_price\tin_stock',
           'how': 'get_product_details with product_ids = one batch per call, include_description false. price = salePrice when it is a number, else originalPrice; '
                  'original_price = originalPrice when a sale price was used, else empty; in_stock = true when stock.availabilityStatus is AVAILABLE, else false. '
                  'A product the connector does not return: a row with price empty and in_stock false.'}
    in_foods = set(it['id'] for it in (load_foods().get('items') or []))
    out['not_in_foods'] = [('rohlik-' + p) for p in ids if ('rohlik-' + p) not in in_foods]
    write_new(os.path.join(watch_dir(), 'targets.json'), {'date': out['date'], 'ids': out['rohlik_ids'], 'why': {('rohlik-' + p): reasons.get('rohlik-' + p) for p in ids},
                                                           'names': {('rohlik-' + p): names.get('rohlik-' + p) for p in ids},
                                                           'item_ids': {('rohlik-' + p): item_ids.get('rohlik-' + p) for p in ids},
                                                           'result_price': {('rohlik-' + p): (seen_price.get('rohlik-' + p) or ('', None))[1] for p in ids}, 'settings': s})
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0


def next_update_path(date):
    folder = os.path.join(data_dir(), 'updates')
    p = os.path.join(folder, date + '.json')
    n = 2
    while os.path.exists(p):
        p = os.path.join(folder, '%s-%d.json' % (date, n))
        n += 1
    return p


def cmd_ingest(tsv):
    s = settings()
    rows = cook.tsv_rows(tsv)
    need = ['id', 'price', 'original_price', 'in_stock']
    if not rows:
        raise SystemExit('ERROR: no rows in %s (header must be: %s)' % (tsv, '\t'.join(need)))
    missing = [c for c in need if c not in rows[0]]
    if missing:
        raise SystemExit('ERROR: columns missing in %s: %s' % (tsv, ', '.join(missing)))
    tp = os.path.join(watch_dir(), 'targets.json')
    if not os.path.exists(tp):
        raise SystemExit('ERROR: %s missing: run "watch.py targets" first (today, Prague time), then ingest' % os.path.relpath(tp, os.path.dirname(data_dir())))
    targets = load(tp)
    last_path = os.path.join(data_dir(), 'runs', 'watch-last.json')   # last seen price of products that have no foods.json record
    last = load(last_path) if os.path.exists(last_path) else {}
    new_last = dict(last)
    wanted = set(str(x) for x in targets.get('ids') or [])
    foods = load_foods()
    by_id = {it['id']: it for it in foods.get('items') or []}
    seen = now_iso()
    changes, to_add, unknown, not_watched, unchanged, stock_unknown = [], [], [], [], 0, []
    done_ids = set()
    for row in rows:
        pid = str(row.get('id') or '').strip()
        if not pid.isdigit():
            unknown.append(row.get('id'))
            continue
        fid = 'rohlik-' + pid
        if wanted and pid not in wanted:
            if fid not in not_watched:
                not_watched.append(fid)
            continue
        if pid in done_ids:
            continue
        done_ids.add(pid)
        old = by_id.get(fid)
        if not old:
            # not in foods.json (a Rohlík ready meal of an Order online plan): the baseline is the price the result was built on
            base = (targets.get('result_price') or {}).get(fid)
            if fid in last:
                old = dict(last[fid], _no_foods=True)
            elif base is not None:
                old = {'id': fid, 'name': (targets.get('names') or {}).get(fid), 'price': base, 'in_stock': True, '_no_foods': True}
            else:
                unknown.append(fid)
                continue
        price = numf(row.get('price'))
        op = numf(row.get('original_price'))
        cell = fold(row.get('in_stock') or '')
        if price is None:
            in_stock = False
        elif cell == '':
            in_stock = old.get('in_stock') is not False   # blank cell with a price: stock unknown, keep what we knew
            stock_unknown.append(fid)
        else:
            in_stock = cell in ('true', 'yes', '1', 'ano', 'available')
        old_price = old.get('price')
        old_stock = old.get('in_stock')
        pct = None
        if price is not None and old_price:
            pct = round((price - old_price) / old_price * 100.0, 1)
        sold_out = (old_stock is not False) and not in_stock
        back = (old_stock is False) and in_stock
        moved = pct is not None and abs(pct) >= s['watch_pct']
        if moved or sold_out or back or (pct not in (None, 0.0)):
            changes.append({'food_id': fid, 'item_ids': (targets.get('item_ids') or {}).get(fid) or [fid], 'name': old.get('name'), 'old': old_price, 'new': price, 'pct': pct,
                            'sold_out': bool(sold_out), 'back_in_stock': bool(back), 'in_stock': in_stock,
                            'report': bool(moved or sold_out or back), 'why_watched': (targets.get('why') or {}).get(fid),
                            'baseline': 'result' if old.get('_no_foods') else 'foods.json'})
        else:
            unchanged += 1
        if old.get('_no_foods'):
            new_last[fid] = {'id': fid, 'name': old.get('name'), 'price': price if price is not None else old.get('price'), 'in_stock': in_stock, 'seen': seen}
            continue
        if price is not None:
            it = {k: v for k, v in old.items() if k not in ('price_history', 'first_seen')}
            it.update(price=price, seen=seen, in_stock=in_stock, price_label='online')
            if it.get('loyalty'):   # a card price read on another day may now be above the normal price: drop it (the next plan run reads cards again)
                it['loyalty'] = [l for l in it['loyalty'] if isinstance(l.get('price'), (int, float)) and l['price'] < price]
                if not it['loyalty']:
                    del it['loyalty']
            notes = [n for n in (old.get('notes') or '').split('; ') if n and not n.startswith('sale: was')]
            if op and op > price:
                notes.append('sale: was %.2f CZK' % op)
            if notes:
                it['notes'] = '; '.join(notes)
            elif 'notes' in it:
                del it['notes']
            to_add.append(it)
        else:
            it = {k: v for k, v in old.items() if k not in ('price_history', 'first_seen')}
            it.update(seen=seen, in_stock=False)
            to_add.append(it)
    missing_rows = sorted(wanted - done_ids, key=int) if wanted else []
    for pid in missing_rows:
        fid = 'rohlik-' + pid
        old = by_id.get(fid)
        if not old and fid in last:
            old = dict(last[fid])
        if not old and (targets.get('result_price') or {}).get(fid) is not None:
            old = {'name': (targets.get('names') or {}).get(fid), 'price': (targets.get('result_price') or {}).get(fid), 'in_stock': True}
        if old and old.get('in_stock') is not False:
            changes.append({'food_id': fid, 'item_ids': (targets.get('item_ids') or {}).get(fid) or [fid], 'name': old.get('name'), 'old': old.get('price'), 'new': None, 'pct': None,
                            'sold_out': True, 'back_in_stock': False, 'in_stock': False, 'report': True,
                            'why_watched': (targets.get('why') or {}).get(fid), 'note': 'no row in the TSV for this id (the connector did not return it)'})
        if fid in by_id:
            it = {k: v for k, v in by_id[fid].items() if k not in ('price_history', 'first_seen')}
            it.update(seen=seen, in_stock=False)
            to_add.append(it)
        elif old:
            new_last[fid] = {'id': fid, 'name': old.get('name'), 'price': old.get('price'), 'in_stock': False, 'seen': seen}
    foods_res = None
    if to_add:
        d = watch_dir()
        p = os.path.join(d, 'add-rohlik.json')
        write_new(p, to_add)
        import subprocess
        pr = subprocess.run([sys.executable, os.path.join(HERE, 'foods.py'), '--data', data_dir(), 'add', p], capture_output=True, text=True, encoding='utf-8')
        try:
            foods_res = json.loads(pr.stdout)
        except Exception:
            raise SystemExit('ERROR foods.py: %s %s' % (pr.stdout[-500:], pr.stderr[-500:]))
    if new_last != last:
        write_new(last_path, new_last)
    reported = [c for c in changes if c['report']]
    refused = (foods_res or {}).get('refused') or []
    checked = len(done_ids) - len(unknown) + len(missing_rows)
    upd = {'created': seen, 'source': 'rohlik', 'checked': checked, 'watch_pct': s['watch_pct'],
           'changes': changes, 'unchanged': unchanged, 'not_in_foods': unknown, 'not_watched': not_watched, 'stock_unknown': stock_unknown,
           'refused_by_foods': refused,
           'foods': {k: len(v) for k, v in (foods_res or {}).items()} if foods_res else None}
    out_path = next_update_path(seen[:10])
    write_new(out_path, upd)
    n_sold = sum(1 for c in reported if c['sold_out'])
    n_back = sum(1 for c in reported if c['back_in_stock'])
    n_moved = sum(1 for c in reported if c['pct'] is not None and abs(c['pct']) >= s['watch_pct'])
    big = None
    for c in reported:
        if c['pct'] is not None and abs(c['pct']) >= s['watch_pct'] and (big is None or abs(c['pct']) > abs(big['pct'])):
            big = c
    parts = []
    if n_moved:
        parts.append('%d price%s moved %s %% or more' % (n_moved, '' if n_moved == 1 else 's', ('%g' % s['watch_pct'])))
    if n_sold:
        parts.append('%d sold out' % n_sold)
    if n_back:
        parts.append('%d back in stock' % n_back)
    if big:
        parts.append('biggest: %s %.2f -> %.2f CZK (%+.1f %%)' % (big['name'] or big['food_id'], big['old'] or 0, big['new'] or 0, big['pct']))
    tail = []
    if unknown:
        tail.append('%d product%s without a price to compare with (not in foods.json)' % (len(unknown), '' if len(unknown) == 1 else 's'))
    if stock_unknown:
        tail.append('%d with no stock state in the answer' % len(stock_unknown))
    if refused:
        tail.append('%d refused by foods.py (%s)' % (len(refused), ', '.join(str(r.get('id')) for r in refused)))
    tail_s = (' ' + '; '.join(tail) + '.') if tail else ''
    msg = ('Meal Planner price watch: %s of %d products changed. %s Open the app: plans with these products show "Prices changed since this plan".%s'
           % (len(reported), checked, '; '.join(parts) + '.', tail_s)) if reported else \
          ('Meal Planner price watch: no change (%d products checked%s).%s' % (checked, ', %d small moves under %g %%' % (len(changes), s['watch_pct']) if changes else '', tail_s))
    summary = {'checked': checked, 'changed': len(reported), 'moved': n_moved, 'small_moves': len(changes) - len(reported), 'sold_out': n_sold, 'back_in_stock': n_back,
               'notify': bool(reported), 'message': msg, 'update_file': os.path.relpath(out_path, os.path.dirname(data_dir())), 'not_in_foods': unknown, 'not_watched': not_watched,
               'stock_unknown': stock_unknown, 'foods': upd['foods'], 'refused_by_foods': refused}
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return 0


def cmd_show(date):
    folder = os.path.join(data_dir(), 'updates')
    files = [n for n in sorted(os.listdir(folder)) if n.endswith('.json')] if os.path.isdir(folder) else []
    if date:
        files = [n for n in files if n.startswith(date)]
    if not files:
        print('(no update file%s)' % (' for ' + date if date else ''))
        return 0
    for n in files:
        try:
            u = load(os.path.join(folder, n))
        except Exception:
            print('%s  (unreadable)' % n)
            continue
        print('%s  created %s  checked %s  changes %d' % (n, u.get('created'), u.get('checked'), len(u.get('changes') or [])))
        for c in u.get('changes') or []:
            flag = 'SOLD OUT' if c.get('sold_out') else ('back in stock' if c.get('back_in_stock') else ('%+.1f %%' % c['pct'] if c.get('pct') is not None else ''))
            print('  %-20s %-45s %8s -> %-8s %s%s' % (c['food_id'], (c.get('name') or '')[:45], c.get('old'), c.get('new'), flag, '' if c.get('report') else ' (small)'))
    return 0


def main(argv):
    if '--data' in argv:
        i = argv.index('--data')
        cook.DATA = os.path.abspath(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]
    if not argv or argv[0] in ('-h', '--help'):
        print(__doc__)
        return 0
    cmd = argv[0]
    if cmd == 'targets':
        return cmd_targets()
    if cmd == 'ingest':
        tsv = cook.opt(argv, '--tsv')
        if not tsv:
            raise SystemExit('ERROR: ingest needs --tsv <file>')
        return cmd_ingest(tsv)
    if cmd == 'show':
        return cmd_show(argv[1] if len(argv) > 1 else None)
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
