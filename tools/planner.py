#!/usr/bin/env python3
"""Meal Planner. The maths, Python twin of app/js/planner.js (same formulas, same order of operations).

Equal results are proved by tests/t_formulas.mjs. Rules that keep the twins equal:
loops instead of sum() (Python 3.12+ sum() of floats uses a compensated algorithm, JS does not),
one rounding function r() (half away from zero, not Python's round()), ties broken by id.

Use (from the MealPlanner folder):
  python tools/planner.py targets data/users/<id>/profile.json [--weight 70.5] [--as-of 2026-10-19]
  python tools/planner.py basket foods.json --protein 840 --kcal 19600 [--cards billa-club,lidl-plus] [--max-share 0.4] [--max-packs 6]
  python tools/planner.py score-result data/results/<REQ-id>.json      (adds "scored" from the request snapshot)
  python tools/planner.py fixtures tests/fixtures/formulas.json        (prints every case, for the twin test)
"""
import functools
import hashlib
import json
import math
import os
import re
import sys
from datetime import date, timedelta

VERSION = '1.1'
EPS = 1e-12
PAL = {'light': 1.53, 'active': 1.76, 'vigorous': 2.25}  # FAO/WHO/UNU (2004) Table 5.1 means
DEFAULT_PROTEIN_G_PER_KG = 1.6  # Iraki et al. (2019) 1.6-2.2; Morton et al. (2018) plateau 1.62
DEFAULT_WEIGHTS = {'price': 40, 'speed': 30, 'taste': 20, 'time': 10}


def r(x, d=2):
    if x is None:
        return None
    if isinstance(x, float) and math.isnan(x):
        return None
    m = 10 ** d
    s = -1 if x < 0 else 1
    return s * math.floor(abs(x) * m + 0.5) / m


NUM_RE = re.compile(r'^\s*-?[0-9]+(\.[0-9]+)?\s*$')


def num(v):
    """A number, or a plain decimal written as text. Anything else (True, '0x10', '1_000', [], ' ') is None. JS twin: num()."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if math.isfinite(v) else None
    if isinstance(v, str) and NUM_RE.match(v):
        return float(v)
    return None


def clamp(x, lo, hi):
    return lo if x < lo else (hi if x > hi else x)


def age_years(birth, as_of):
    if not birth or not as_of:
        return None
    b = [int(p) for p in birth.split('-')]
    a = [int(p) for p in as_of.split('-')]
    y = a[0] - b[0]
    if a[1] < b[1] or (a[1] == b[1] and a[2] < b[2]):
        y -= 1
    return y


def bmr(sex, kg, cm, age):
    return 10 * kg + 6.25 * cm - 5 * age + (-161 if sex == 'f' else 5)


def targets(profile, weight_kg, as_of):
    profile = profile or {}
    body = profile.get('body') or {}
    goal = profile.get('goal') or {}
    act = profile.get('activity') or {}
    out = {'ok': True, 'missing': [], 'warnings': [], 'mode': goal.get('type') or 'gain'}
    w = num(weight_kg)
    h = num(body.get('height_cm'))
    age = age_years(body.get('birth_date'), as_of)
    sex = body.get('sex')
    if w is None or w <= 0:
        out['missing'].append('weight')
    if h is None or h <= 0:
        out['missing'].append('height')
    if age is None or age < 0:
        out['missing'].append('birth_date')
    if sex not in ('m', 'f'):
        out['missing'].append('sex')
    pal = num(act.get('pal'))
    if pal is None:
        pal = PAL['light']
    out['pal'] = pal
    out['age'] = age
    maint = None
    if not out['missing']:
        b = bmr(sex, w, h, age)
        maint = b * pal
        out['bmr'] = r(b, 2)
        out['maintenance_kcal'] = r(maint, 2)
    if out['mode'] == 'typed':
        tp = num(goal.get('typed_protein_g'))
        tk = num(goal.get('typed_kcal'))
        out['missing'] = []
        if tp is None or tp <= 0:
            out['missing'].append('typed_protein_g')
        if tk is None or tk <= 0:
            out['missing'].append('typed_kcal')
        out['protein_g'] = r(tp, 2)
        out['kcal'] = r(tk, 2)
        if w is not None and w > 0 and tp is not None:
            out['protein_g_per_kg'] = r(tp / w, 2)
        out['ok'] = not out['missing']
        return out
    gpk = num(goal.get('protein_g_per_kg'))
    if gpk is None:
        gpk = DEFAULT_PROTEIN_G_PER_KG
    out['protein_g_per_kg'] = gpk
    if gpk < 1.6:
        out['warnings'].append('protein_below_1_6')
    if gpk > 2.2:
        out['warnings'].append('protein_above_2_2')
    if out['mode'] == 'gain':
        gk = num(goal.get('gain_kg'))
        wk = num(goal.get('weeks'))
        if gk is None or gk <= 0:
            out['missing'].append('gain_kg')
        if wk is None or wk <= 0:
            out['missing'].append('weeks')
        if out['missing']:
            out['ok'] = False
            return out
        rate = gk / wk
        rate_pct = rate / w * 100
        auto = clamp(10 + (rate_pct - 0.25) * 40, 10, 20)
        sp = num(goal.get('surplus_pct'))
        surplus = auto if sp is None else sp
        out['rate_kg_week'] = r(rate, 3)
        out['rate_pct_week'] = r(rate_pct, 3)
        out['surplus_auto_pct'] = r(auto, 2)
        out['surplus_pct'] = r(surplus, 2)
        if rate_pct > 0.5:
            out['warnings'].append('rate_above_0_5')
        if surplus > 20:
            out['warnings'].append('surplus_above_20')
        out['kcal'] = r(maint * (1 + surplus / 100), 2)
    else:
        if out['missing']:
            out['ok'] = False
            return out
        out['kcal'] = r(maint, 2)
    out['protein_g'] = r(w * gpk, 2)
    out['ok'] = not out['missing']
    return out


def per_day(amount, period):
    a = num(amount)
    if a is None:
        return None
    if period == 'week':
        return r(a / 7, 2)
    if period == 'month':
        return r(a * 12 / 365, 2)
    return r(a, 2)


def effective_price(food, cards):
    held = set(cards or [])
    best = num(food.get('price'))
    used = None
    for lp in food.get('loyalty') or []:
        p = num(lp.get('price'))
        if p is not None and p > 0 and best is not None and lp.get('card') in held and p < best - EPS:
            best = p
            used = lp.get('card')
    return {'price': best, 'regular': num(food.get('price')), 'card_used': used}


def food_metrics(food, cards):
    ep = effective_price(food, cards)
    g = num(food.get('pack_g'))
    n = food.get('per100g') or {}
    if ep['price'] is None or ep['price'] <= 0 or g is None or g <= 0 or num(n.get('protein')) is None or num(n.get('kcal')) is None:
        return None
    pp = g * num(n.get('protein')) / 100
    pk = g * num(n.get('kcal')) / 100
    return {
        'price': ep['price'], 'regular': ep['regular'], 'card_used': ep['card_used'],
        'pack_protein': r(pp, 2), 'pack_kcal': r(pk, 2),
        'protein_per_100czk': r(pp / ep['price'] * 100, 2), 'kcal_per_100czk': r(pk / ep['price'] * 100, 2),
        'price_per_kg': r(ep['price'] / g * 1000, 2),
    }


def _usable(f):
    if not isinstance(f, dict) or not isinstance(f.get('id'), str) or f.get('id') == '':
        return False
    n = f.get('per100g')
    p = num(f.get('price'))
    g = num(f.get('pack_g'))
    return p is not None and p > 0 and g is not None and g > 0 and bool(n) and num(n.get('protein')) is not None and num(n.get('kcal')) is not None


def basket(foods, need, cards, opts=None):
    opts = opts or {}
    hard = num(opts.get('max_packs'))
    share = num(opts.get('max_share'))
    if share is None:
        share = 0.4
    lst = sorted([f for f in foods if _usable(f)], key=lambda f: f['id'])
    nP = num(need.get('protein_g')) or 0
    nK = num(need.get('kcal')) or 0
    remP, remK = nP, nK
    counts, info = {}, {}
    for f in lst:
        ep = effective_price(f, cards)
        g = num(f['pack_g'])
        n = f['per100g']
        info[f['id']] = {'price': ep['price'], 'regular': ep['regular'], 'card': ep['card_used'],
                         'p': g * num(n['protein']) / 100, 'k': g * num(n['kcal']) / 100, 'name': f.get('name')}
        counts[f['id']] = 0
        xi = info[f['id']]
        c = None
        if xi['p'] > 0 and nP > 0:
            c = math.floor(share * nP / xi['p'])
        if xi['k'] > 0 and nK > 0:
            ck = math.floor(share * nK / xi['k'])
            if c is None or ck < c:
                c = ck
        if c is None or c < 1:
            c = 1
        if hard is not None and hard < c:
            c = hard
        xi['cap'] = c
    for _ in range(2000):
        if remP <= 0 and remK <= 0:
            break
        best, best_val = None, 0
        for f in lst:
            fid = f['id']
            x = info[fid]
            if counts[fid] >= x['cap']:
                continue
            gp = min(x['p'], remP) if remP > 0 else 0
            gk = min(x['k'], remK) if remK > 0 else 0
            overK = max(0, x['k'] - remK) if remK > 0 else x['k']  # v1.1 (19/10): kcal beyond the target counts against a pack
            v = ((gp / nP if nP > 0 else 0) + (gk / nK if nK > 0 else 0) - (overK / nK if nK > 0 else 0)) / x['price']
            if v > best_val + EPS:
                best, best_val = fid, v
        if best is None:
            break
        counts[best] += 1
        remP -= info[best]['p']
        remK -= info[best]['k']
    items = []
    cost = cost_reg = P = K = 0
    for f in lst:
        fid = f['id']
        c = counts[fid]
        if not c:
            continue
        y = info[fid]
        items.append({'id': fid, 'name': y['name'], 'packs': c, 'cap': y['cap'], 'cost': r(c * y['price'], 2), 'cost_regular': r(c * y['regular'], 2),
                      'card_used': y['card'], 'protein_g': r(c * y['p'], 2), 'kcal': r(c * y['k'], 2)})
        cost += c * y['price']
        cost_reg += c * y['regular']
        P += c * y['p']
        K += c * y['k']
    return {'items': items, 'cost': r(cost, 2), 'cost_regular': r(cost_reg, 2), 'protein_g': r(P, 2), 'kcal': r(K, 2),
            'met': remP <= 0 and remK <= 0}


def option_cost(opt, cards):
    held = set(cards or [])
    reg = num(opt.get('cost_regular'))
    mine = allc = reg
    for s in opt.get('card_savings') or []:
        v = num(s.get('saving')) or 0
        allc -= v
        if s.get('card') in held:
            mine -= v
    return {'mine': mine, 'regular': reg, 'all_cards': allc}


def score(options, ctx):
    t = ctx.get('targets') or {}
    wts = ctx.get('weights') or DEFAULT_WEIGHTS
    cards = ctx.get('cards') or []
    wP = num(wts.get('price')) or 0
    wS = num(wts.get('speed')) or 0
    wT = num(wts.get('taste')) or 0
    wM = num(wts.get('time')) or 0
    wSum = wP + wS + wT + wM
    if wSum <= 0:
        wP, wS, wT, wM, wSum = 40, 30, 20, 10, 100
    tP = num(t.get('protein_g'))
    tK = num(t.get('kcal'))
    bud = num(ctx.get('budget_per_day'))
    rows = []
    min_cost = min_min = None
    for o in options:
        o = o if isinstance(o, dict) else {}
        oid = o.get('id') if isinstance(o.get('id'), str) else ''
        days = num(o.get('days'))
        if days is None or days <= 0:
            days = 1
        c = option_cost(o, cards)
        m0 = num(o.get('minutes_per_day'))
        inc = oid == '' or c['regular'] is None or c['regular'] <= 0 or c['mine'] is None or c['mine'] <= 0 or m0 is None or m0 < 0
        cpd = None if inc else c['mine'] / days
        mins = None if inc else max(1, m0)
        rows.append({'o': o, 'id': oid, 'inc': inc, 'cpd': cpd, 'cost': c, 'mins': mins})
        if not inc:
            if min_cost is None or cpd < min_cost:
                min_cost = cpd
            if min_min is None or mins < min_min:
                min_min = mins
    out, done, bad = [], [], []
    for x in rows:
        if x['inc']:
            e = {'id': x['id'], 'incomplete': True, 'cost_per_day': None, 'cost_mine': None, 'cost_regular': r(x['cost']['regular'], 2), 'cost_all_cards': None,
                 'protein_per_100czk': None, 's_price': None, 's_speed': None, 's_taste': None, 's_time': None, 'total': None, 'flags': ['incomplete']}
            out.append(e)
            bad.append(e)
            continue
        o = x['o']
        p = num(o.get('protein_g_per_day')) or 0
        k = num(o.get('kcal_per_day')) or 0
        covP = min(1, p / tP) if tP else 1
        covK = min(1, k / tK) if tK else 1
        sPrice = 100 * min_cost / x['cpd']
        sSpeed = 100 * (covP + covK) / 2
        taste = num(o.get('taste'))
        if taste is None:
            taste = 3
        sTaste = (clamp(taste, 1, 5) - 1) / 4 * 100
        sTime = 100 * min_min / x['mins']
        total = (wP * sPrice + wS * sSpeed + wT * sTaste + wM * sTime) / wSum
        flags = []
        if bud is not None and x['cpd'] > bud + EPS:
            flags.append('over_budget')
        if tP and p < 0.9 * tP:
            flags.append('protein_short')
        if tK and k > 1.1 * tK:
            flags.append('kcal_over')
        if tK and k < 0.9 * tK:
            flags.append('kcal_short')
        y = {
            'id': x['id'], 'cost_per_day': r(x['cpd'], 2), 'cost_mine': r(x['cost']['mine'], 2),
            'cost_regular': r(x['cost']['regular'], 2), 'cost_all_cards': r(x['cost']['all_cards'], 2),
            'protein_per_100czk': r(p / x['cpd'] * 100, 2),
            's_price': r(sPrice, 2), 's_speed': r(sSpeed, 2), 's_taste': r(sTaste, 2), 's_time': r(sTime, 2),
            'total': r(total, 2), 'flags': flags, '_t': total, '_c': x['cpd'], '_s': sSpeed,
        }
        out.append(y)
        done.append(y)

    def cmp(a, b):
        if abs(a['_t'] - b['_t']) > EPS:
            return -1 if b['_t'] - a['_t'] < 0 else 1
        if abs(a['_c'] - b['_c']) > EPS:
            return -1 if a['_c'] - b['_c'] < 0 else 1
        return -1 if a['id'] < b['id'] else (1 if a['id'] > b['id'] else 0)

    ranked = sorted(done, key=functools.cmp_to_key(cmp))
    for i, x in enumerate(ranked):
        x['rank'] = i + 1
    bad.sort(key=lambda x: x['id'])
    for x in bad:
        x['rank'] = None

    def by_cost_then_id(a, b):
        return a['_c'] < b['_c'] - EPS or (abs(a['_c'] - b['_c']) <= EPS and a['id'] < b['id'])

    def pick(lst, better):
        b = None
        for x in lst:
            if b is None or better(x, b):
                b = x
        return b['id'] if b else None

    enough = [x for x in done if x['_s'] >= 90 - EPS]
    picks = {
        'cheapest': pick(enough if enough else done, by_cost_then_id),
        'fastest': pick(done, lambda a, b: a['_s'] > b['_s'] + EPS or (abs(a['_s'] - b['_s']) <= EPS and by_cost_then_id(a, b))),
        'balance': ranked[0]['id'] if ranked else None,
    }
    for x in ranked:
        del x['_t'], x['_c'], x['_s']
    return {'version': VERSION, 'ranked': ranked + bad, 'picks': picks, 'weights_used': {'price': wP, 'speed': wS, 'taste': wT, 'time': wM}}


def add_days(iso, n):
    y, m, d = (int(p) for p in iso.split('-'))
    return (date(y, m, d) + timedelta(days=n)).isoformat()


def goal_line(goal, start_kg, start_date):
    goal = goal or {}
    gk = num(goal.get('gain_kg'))
    wk = num(goal.get('weeks'))
    s = num(start_kg)
    if gk is None or wk is None or s is None or not start_date:
        return None
    return {'from': {'date': start_date, 'kg': r(s, 2)}, 'to': {'date': add_days(start_date, _js_round(wk * 7)), 'kg': r(s + gk, 2)}}


def _js_round(x):
    """JS Math.round: half up toward +infinity."""
    return math.floor(x + 0.5)


# ---------- files ----------

def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save_atomic(path, obj):
    """Write without rename or delete (the laptop folder refuses both): full text, flush, read back, compare the hash."""
    text = json.dumps(obj, ensure_ascii=False, indent=2) + '\n'
    json.loads(text)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    with open(path, encoding='utf-8') as f:
        back = f.read()
    if hashlib.sha256(back.encode()).hexdigest() != hashlib.sha256(text.encode()).hexdigest():
        raise IOError('read-back of %s differs from what was written' % path)


def newest_weight(history):
    best = None
    for w in (history or {}).get('weighins') or []:
        if best is None or (w.get('date') or '') >= (best.get('date') or ''):
            best = w
    return num(best.get('kg')) if best else None


def _jsnum(x):
    """Print whole floats as ints, like JSON.stringify does, so the twin outputs compare as text."""
    if isinstance(x, float) and x.is_integer() and abs(x) < 1e15:
        return int(x)
    if isinstance(x, dict):
        return {k: _jsnum(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_jsnum(v) for v in x]
    return x


def run_case(c):
    k = c['fn']
    a = c['args']
    if k == 'targets':
        return targets(a[0], a[1], a[2])
    if k == 'perDay':
        return per_day(a[0], a[1])
    if k == 'effectivePrice':
        return effective_price(a[0], a[1])
    if k == 'foodMetrics':
        return food_metrics(a[0], a[1])
    if k == 'basket':
        return basket(a[0], a[1], a[2], a[3] if len(a) > 3 else None)
    if k == 'optionCost':
        return option_cost(a[0], a[1])
    if k == 'score':
        return score(a[0], a[1])
    if k == 'goalLine':
        return goal_line(a[0], a[1], a[2])
    if k == 'ageYears':
        return age_years(a[0], a[1])
    raise ValueError('unknown fn ' + k)


def main(argv):
    if len(argv) < 2 or argv[1] in ('-h', '--help'):
        print(__doc__)
        return 0
    cmd = argv[1]
    args = argv[2:]

    def opt(name, default=None):
        if name in args:
            i = args.index(name)
            return args[i + 1]
        return default

    if cmd == 'targets':
        prof = load(args[0])
        hist_path = os.path.join(os.path.dirname(args[0]), 'history.json')
        w = opt('--weight')
        if w is None and os.path.exists(hist_path):
            w = newest_weight(load(hist_path))
        if w is None:
            w = (prof.get('body') or {}).get('weight_kg')
        as_of = opt('--as-of', date.today().isoformat())
        print(json.dumps(_jsnum(targets(prof, w, as_of)), ensure_ascii=False, indent=2))
    elif cmd == 'basket':
        foods = load(args[0])
        if isinstance(foods, dict):
            foods = foods.get('items') or []
        cards = [c for c in (opt('--cards', '') or '').split(',') if c]
        res = basket(foods, {'protein_g': opt('--protein'), 'kcal': opt('--kcal')}, cards, {'max_share': opt('--max-share'), 'max_packs': opt('--max-packs')})
        print(json.dumps(_jsnum(res), ensure_ascii=False, indent=2))
    elif cmd == 'score-result':
        res = load(args[0])
        req = res.get('request') or {}
        tu = res.get('targets_used')  # session 4: Order online / Eat out plan only the meals asked for (same rule as app.js targetsOf)
        tg = {'protein_g': tu['protein_g'], 'kcal': tu['kcal']} if isinstance(tu, dict) and isinstance(tu.get('protein_g'), (int, float)) and isinstance(tu.get('kcal'), (int, float)) else req.get('targets')
        ctx = {'targets': tg, 'weights': req.get('weights'), 'cards': req.get('cards'), 'budget_per_day': req.get('budget_per_day')}
        res['scored'] = _jsnum(score(res.get('options') or [], ctx))
        save_atomic(args[0], res)
        print('ok scored', len(res.get('options') or []), 'options; picks', json.dumps(res['scored']['picks']))
    elif cmd == 'fixtures':
        cases = load(args[0])
        print(json.dumps([_jsnum(run_case(c)) for c in cases], ensure_ascii=False))
    else:
        print('unknown command', cmd)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
