"""Writes tests/fixtures/formulas.json: hand cases + 300 seeded random cases for the JS/Python twin test.
Recipe: python tests/make_fixtures.py (seed 20261019, same file every time)."""
import json, random, os
rnd = random.Random(20261019)
cases = []
prof = {'body': {'sex': 'm', 'birth_date': '2003-05-14', 'height_cm': 178}, 'activity': {'pal': 1.76},
        'goal': {'type': 'gain', 'gain_kg': 3, 'weeks': 12, 'protein_g_per_kg': 1.8}}
cases.append({'fn': 'targets', 'args': [prof, 68.4, '2026-10-19']})
cases.append({'fn': 'targets', 'args': [dict(prof, goal={'type': 'gain', 'gain_kg': 6, 'weeks': 8}), 68.4, '2026-10-19']})
cases.append({'fn': 'targets', 'args': [dict(prof, goal={'type': 'typed', 'typed_protein_g': 140, 'typed_kcal': 2900}), 68.4, '2026-10-19']})
cases.append({'fn': 'targets', 'args': [dict(prof, goal={'type': 'maintain'}), 68.4, '2026-10-19']})
cases.append({'fn': 'targets', 'args': [{'body': {'sex': 'f', 'birth_date': '2000-10-20', 'height_cm': 165}, 'goal': {'type': 'gain', 'gain_kg': 1, 'weeks': 20}}, 55, '2026-10-19']})
cases.append({'fn': 'targets', 'args': [{'body': {}}, None, '2026-10-19']})
cases.append({'fn': 'ageYears', 'args': ['2000-10-19', '2026-10-19']})
cases.append({'fn': 'ageYears', 'args': ['2000-10-20', '2026-10-19']})
for amt, per in [(250, 'day'), (1750, 'week'), (7600, 'month'), (None, 'day')]:
    cases.append({'fn': 'perDay', 'args': [amt, per]})
tvaroh = {'id': 'rohlik-1469745', 'name': 'Miil tvaroh odtucneny 250 g', 'price': 17.91, 'pack_g': 250, 'per100g': {'protein': 12, 'kcal': 64}}
rizek = {'id': 'rohlik-rizek', 'name': 'Svetnickove kureci rizek 270 g', 'price': 70.17, 'pack_g': 270, 'per100g': {'protein': 23.1, 'kcal': 180}}
billa = {'id': 'billa-oats', 'name': 'Ovesne vlocky 500 g', 'price': 24.9, 'loyalty': [{'card': 'billa-club', 'price': 19.9}], 'pack_g': 500, 'per100g': {'protein': 13, 'kcal': 372}}
cases.append({'fn': 'foodMetrics', 'args': [tvaroh, []]})
cases.append({'fn': 'foodMetrics', 'args': [rizek, []]})
cases.append({'fn': 'foodMetrics', 'args': [billa, []]})
cases.append({'fn': 'foodMetrics', 'args': [billa, ['billa-club']]})
cases.append({'fn': 'effectivePrice', 'args': [billa, ['lidl-plus']]})
cases.append({'fn': 'basket', 'args': [[tvaroh, rizek, billa], {'protein_g': 900, 'kcal': 19600}, ['billa-club'], {'days': 7}]})
cases.append({'fn': 'goalLine', 'args': [{'gain_kg': 3, 'weeks': 12}, 68.4, '2026-10-19']})
cards = ['rohlik-xtra', 'billa-club', 'kaufland-card', 'lidl-plus', 'albert', 'penny', 'tesco-clubcard']
def rfood(i):
    f = {'id': 'f%03d' % rnd.randint(0, 999), 'name': 'food %d' % i, 'price': round(rnd.uniform(5, 300), 2),
         'pack_g': rnd.choice([100, 125, 150, 200, 250, 270, 400, 500, 1000]),
         'per100g': {'protein': round(rnd.uniform(0, 35), 1), 'kcal': round(rnd.uniform(20, 600), 0)}}
    if rnd.random() < 0.4:
        f['loyalty'] = [{'card': rnd.choice(cards), 'price': round(f['price'] * rnd.uniform(0.6, 0.98), 2)}]
    if rnd.random() < 0.05:
        f['per100g']['protein'] = None
    return f
for n in range(150):
    foods = [rfood(i) for i in range(rnd.randint(1, 12))]
    held = rnd.sample(cards, rnd.randint(0, 3))
    days = rnd.randint(1, 7)
    cases.append({'fn': 'basket', 'args': [foods, {'protein_g': round(rnd.uniform(80, 220) * days, 1), 'kcal': round(rnd.uniform(1800, 3600) * days, 0)}, held, {'days': days}]})
for n in range(150):
    opts = []
    for i in range(rnd.randint(1, 9)):
        days = rnd.randint(1, 7)
        o = {'id': 'O%02d' % rnd.randint(0, 40), 'days': days, 'cost_regular': round(rnd.uniform(80, 600) * days, 2),
             'protein_g_per_day': round(rnd.uniform(60, 220), 1), 'kcal_per_day': round(rnd.uniform(1500, 3800), 0),
             'minutes_per_day': rnd.choice([0, 5, 15, 30, 45, 60, 90]), 'taste': rnd.choice([None, 1, 2, 3, 4, 5, 3.5])}
        if rnd.random() < 0.5:
            o['card_savings'] = [{'card': rnd.choice(cards), 'saving': round(rnd.uniform(1, 60), 2)}]
        opts.append(o)
    ctx = {'targets': {'protein_g': round(rnd.uniform(90, 200), 1), 'kcal': round(rnd.uniform(2000, 3400), 0)},
           'weights': rnd.choice([{'price': 40, 'speed': 30, 'taste': 20, 'time': 10}, {'price': 0, 'speed': 0, 'taste': 0, 'time': 0}, {'price': 70, 'speed': 10, 'taste': 10, 'time': 10}]),
           'cards': rnd.sample(cards, rnd.randint(0, 3)), 'budget_per_day': rnd.choice([None, 150, 250, 400])}
    cases.append({'fn': 'score', 'args': [opts, ctx]})
# odd inputs found by the audit (19/10): missing cost/minutes/id, taste true, numbers as odd text, card price 0, food without id
odd = [{'id': 'A', 'days': 5, 'cost_regular': 900, 'protein_g_per_day': 130, 'kcal_per_day': 3300, 'minutes_per_day': 30, 'taste': 4},
       {'id': 'B', 'days': 5, 'protein_g_per_day': 200, 'kcal_per_day': 3500, 'taste': 5},
       {'id': 'C', 'days': 5, 'cost_regular': '800', 'protein_g_per_day': '120.5', 'kcal_per_day': 3000, 'minutes_per_day': ' 20 ', 'taste': True},
       {'days': 5, 'cost_regular': 500, 'minutes_per_day': 10},
       {'id': 'D', 'days': '0x10', 'cost_regular': '1_000', 'minutes_per_day': 10},
       {'id': 'E', 'days': 5, 'cost_regular': 100, 'card_savings': [{'card': 'billa-club', 'saving': 150}], 'minutes_per_day': 10}]
cases.append({'fn': 'score', 'args': [odd, {'targets': {'protein_g': 123, 'kcal': 3400}, 'cards': ['billa-club'], 'budget_per_day': 250}]})
cases.append({'fn': 'score', 'args': [[odd[1], odd[3]], {'targets': {'protein_g': 123, 'kcal': 3400}}]})
cases.append({'fn': 'effectivePrice', 'args': [dict(billa, loyalty=[{'card': 'billa-club', 'price': 0}]), ['billa-club']]})
cases.append({'fn': 'basket', 'args': [[tvaroh, {'name': 'no id', 'price': 10, 'pack_g': 100, 'per100g': {'protein': 30, 'kcal': 100}}], {'protein_g': 100, 'kcal': 500}, []]})
cases.append({'fn': 'targets', 'args': [dict(prof, goal={'type': 'gain', 'gain_kg': True, 'weeks': '12'}), '68.4', '2026-10-19']})
# 2026-11-05 (planner 1.2): DRI targets. Appended AFTER the seeded cases above, so the first 324 cases are unchanged.
# Every DRI age group, both sexes, the four activity categories and their edges, pregnancy, lactation, missing parts.
def body(sex, birth, cm, **kw):
    b = {'sex': sex, 'birth_date': birth, 'height_cm': cm}
    b.update(kw)
    return b
for sex in ('m', 'f'):
    for birth, cm, kg in (('2024-06-01', 88, 12.5), ('2021-01-10', 105, 17), ('2018-03-03', 122, 24), ('2014-09-09', 150, 41),
                          ('2010-02-02', 172, 60), ('1995-07-07', 180, 75), ('1950-01-01', 168, 70)):
        for pal in (None, 1.39, 1.4, 1.53, 1.6, 1.76, 1.9, 2.25):
            pr = {'body': body(sex, birth, cm), 'goal': {'type': 'maintain'}}
            if pal is not None:
                pr['activity'] = {'pal': pal}
            cases.append({'fn': 'targets', 'args': [pr, kg, '2026-11-05']})
for tri in (1, 2, 3, '2', 2.0, None, 4):
    cases.append({'fn': 'targets', 'args': [{'body': body('f', '1996-04-04', 165, life_stage='pregnant', trimester=tri), 'goal': {'type': 'maintain'}}, 62, '2026-11-05']})
for lp in ('0-6', '7-12', None, '13-18'):
    cases.append({'fn': 'targets', 'args': [{'body': body('f', '2009-04-04', 160, life_stage='lactating', lactation_period=lp), 'activity': {'pal': 1.76}, 'goal': {'type': 'maintain'}}, 55, '2026-11-05']})
cases.append({'fn': 'targets', 'args': [{'body': body('m', '1996-04-04', 180, life_stage='pregnant', trimester=2), 'goal': {'type': 'maintain'}}, 80, '2026-11-05']})
cases.append({'fn': 'targets', 'args': [{'body': body('f', '2026-03-01', 60), 'goal': {'type': 'maintain'}}, 6, '2026-11-05']})
cases.append({'fn': 'targets', 'args': [{'body': body('m', '1996-04-04', 180), 'goal': {'type': 'gain', 'gain_kg': 3, 'weeks': 12, 'protein_g_per_kg': 0.7}}, 80, '2026-11-05']})
cases.append({'fn': 'targets', 'args': [{'body': body('m', '1996-04-04', 180), 'goal': {'type': 'gain', 'gain_kg': 3, 'weeks': 12, 'protein_g_per_kg': 2.4}}, 80, '2026-11-05']})
cases.append({'fn': 'targets', 'args': [{'body': body('m', '2010-04-04', 170), 'goal': {'type': 'gain', 'gain_kg': 2, 'weeks': 10}}, 58, '2026-11-05']})
cases.append({'fn': 'targets', 'args': [{'body': body('f', '1996-04-04', 165, life_stage='lactating', lactation_period='0-6'), 'goal': {'type': 'typed', 'typed_protein_g': 60, 'typed_kcal': 2400}}, 62, '2026-11-05']})
cases.append({'fn': 'targets', 'args': [{'body': body('f', '1996-04-04', 165, life_stage='other'), 'goal': {'type': 'maintain'}}, 62, '2026-11-05']})
# 2026-11-08 (planner 1.3): the shopping list. Appended AFTER every earlier case, so the first 454 cases are unchanged.
# Hand case: four tvaroh products in one shop; the best value is sold out, so the plan uses the second and the third is the backup.
tv = [
    {'id': 'tesco-tv-a', 'name': 'Tvaroh A 250 g', 'price': 15.9, 'pack_g': 250, 'per100g': {'protein': 12, 'kcal': 64}, 'in_stock': False},
    {'id': 'tesco-tv-b', 'name': 'Tvaroh B 250 g', 'price': 17.9, 'pack_g': 250, 'per100g': {'protein': 11, 'kcal': 63}, 'in_stock': True,
     'regular_price': 29.9, 'sale_until': '2026-11-09'},
    {'id': 'tesco-tv-c', 'name': 'Tvaroh C 500 g', 'price': 49.9, 'pack_g': 500, 'per100g': {'protein': 13, 'kcal': 70}, 'in_stock': True},
    {'id': 'tesco-tv-d', 'name': 'Tvaroh D 250 g', 'price': 39.9, 'pack_g': 250, 'per100g': {'protein': 11, 'kcal': 63}},
]
need7 = {'protein_g': 412.2, 'kcal': 24812}
cases.append({'fn': 'rankProducts', 'args': [tv, need7, []]})
cases.append({'fn': 'alternatives', 'args': [tv, 'tesco-tv-b', need7, []]})
cases.append({'fn': 'alternatives', 'args': [tv, 'tesco-tv-d', need7, []]})
cases.append({'fn': 'alternatives', 'args': [tv[:1], 'tesco-tv-a', need7, []]})
cases.append({'fn': 'backupLine', 'args': [{'packs': 4, 'cost': 71.6, 'protein_g': 110, 'kcal': 630}, tv[2], []]})
cases.append({'fn': 'backupLine', 'args': [{'packs': 2, 'cost': 30, 'protein_g': 0, 'kcal': 900}, {'id': 'x-oil', 'price': 60, 'pack_g': 1000, 'per100g': {'protein': 0, 'kcal': 884}}, []]})
cases.append({'fn': 'backupLine', 'args': [{'packs': 1, 'cost': 10}, billa, ['billa-club']]})
for d in ('2026-11-08', '2026-11-09', '2026-11-10', None):
    cases.append({'fn': 'saleInfo', 'args': [tv[1], d]})
cases.append({'fn': 'saleInfo', 'args': [dict(tv[1], sale_until=None), '2026-11-08']})
cases.append({'fn': 'saleInfo', 'args': [dict(tv[1], sale_until='9. 11.'), '2026-11-08']})
cases.append({'fn': 'saleInfo', 'args': [tv[0], '2026-11-08']})
cases.append({'fn': 'saleInfo', 'args': [dict(tv[1], regular_price=17.9), '2026-11-08']})
cases.append({'fn': 'saleInfo', 'args': [dict(tv[1], regular_price='31.5', price='17.9'), '2026-11-08']})
# energy top-up: DRI protein next to a high energy need (the demo shape): oats and rice must reach the energy target
cases.append({'fn': 'basket', 'args': [[
    {'id': 'tesco-oats', 'name': 'Oats', 'price': 11.9, 'pack_g': 500, 'per100g': {'protein': 13, 'kcal': 371}},
    {'id': 'tesco-rice', 'name': 'Rice', 'price': 29.9, 'pack_g': 1000, 'per100g': {'protein': 7, 'kcal': 350}},
    {'id': 'tesco-lentils', 'name': 'Lentils', 'price': 29.9, 'pack_g': 500, 'per100g': {'protein': 24, 'kcal': 345}},
    {'id': 'tesco-tvaroh', 'name': 'Tvaroh', 'price': 17.9, 'pack_g': 250, 'per100g': {'protein': 11, 'kcal': 63}}], need7, [], {'max_share': 0.4}]})
rnd2 = random.Random(20261108)
for n in range(60):
    k = rnd2.randint(1, 6)
    group = []
    for i in range(k):
        f = {'id': 'shop-p%02d' % i, 'name': 'product %d' % i, 'price': round(rnd2.uniform(8, 160), 2), 'pack_g': rnd2.choice([100, 200, 250, 400, 500, 1000]),
             'per100g': {'protein': round(rnd2.uniform(0, 30), 1), 'kcal': round(rnd2.uniform(20, 500), 0)}}
        if rnd2.random() < 0.3:
            f['in_stock'] = False
        if rnd2.random() < 0.3:
            f['loyalty'] = [{'card': 'billa-club', 'price': round(f['price'] * rnd2.uniform(0.6, 0.95), 2)}]
        if rnd2.random() < 0.4:
            f['regular_price'] = round(f['price'] * rnd2.uniform(1.0, 2.2), 2)
            f['sale_until'] = rnd2.choice([None, '2026-11-0%d' % rnd2.randint(5, 9)])
        group.append(f)
    nd = {'protein_g': round(rnd2.uniform(50, 1200), 1), 'kcal': round(rnd2.uniform(1500, 30000), 0)}
    cards2 = rnd2.choice([[], ['billa-club']])
    cases.append({'fn': 'rankProducts', 'args': [group, nd, cards2]})
    cases.append({'fn': 'alternatives', 'args': [group, rnd2.choice(group)['id'], nd, cards2]})
    line = {'packs': rnd2.randint(1, 6), 'cost': round(rnd2.uniform(10, 400), 2), 'protein_g': round(rnd2.uniform(0, 300), 1), 'kcal': round(rnd2.uniform(0, 5000), 0)}
    cases.append({'fn': 'backupLine', 'args': [line, rnd2.choice(group), cards2]})
    cases.append({'fn': 'saleInfo', 'args': [rnd2.choice(group), rnd2.choice(['2026-11-06', '2026-11-08', None])]})
p = os.path.join(os.path.dirname(__file__), 'fixtures', 'formulas.json')
json.dump(cases, open(p, 'w'), ensure_ascii=False)
print(len(cases), 'cases ->', p)
