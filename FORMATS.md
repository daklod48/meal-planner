# Meal Planner. Data file formats (the contract between the app and Claude)

_Written in build session 1 (2026-10-19); session 3, 4 and 5 additions marked below. The app writes `users/` and `requests/` and `app-settings.json`; Claude writes `results/`, `updates/`, `runlog.md`, and (only through `tools/foods.py`) `foods/foods.json`; `shops/shops.json` is written in session 2. Everything lives in `MealPlanner/data/`, which is never sent to anyone._

## Who writes what
| File | Written by | Read by |
|---|---|---|
| `app-settings.json` | app | app |
| `users/<id>/profile.json`, `history.json`, `changes.json` | app only (every change through `commit`, logged in `changes.json`) | app, Claude (read only) |
| `requests/<REQ-id>.json` | app, once (plus `status: cancelled`) | Claude |
| `results/<REQ-id>.json` | Claude | app |
| `foods/foods.json` | `tools/foods.py` only | app, Claude, `tools/planner.py` |
| `shops/shops.json` | Claude (survey once per place; small fixes when a run sees a shop closed) | app, Claude |
| `updates/<YYYY-MM-DD>.json` | price watch task, through `tools/watch.py` only (session 5) | app |
| `runs/<REQ-id>/` (raw shop rows *.tsv, extras.json, options.json, add-*.json, used-ids.json) | the run task, through `tools/cook.py` (session 3) | Claude (evidence of a run; never sent) |
| `runs/watch-<date>/`, `runs/watch-last.json` | the price watch task, through `tools/watch.py` (session 5) | Claude (evidence of a watch; never sent) |
| `runlog.md` | the run task, one block per run (append only) | people |

`<id>` of a user = name without accents, lowercase, `-` for spaces (`Tomáš Dvořák` -> `tomas-dvorak`; a second one gets `-2`).

## profile.json
```
{ "id", "name", "lang": "en"|"cs", "created", "hidden": bool,
  "body": {"sex": "m"|"f", "birth_date": "YYYY-MM-DD", "height_cm",
           "life_stage": "none"|"pregnant"|"lactating", "trimester": 1|2|3|null, "lactation_period": "0-6"|"7-12"|null},  (life stage since 2026-11-05; missing = none)
  "activity": {"pal": 1.53|1.76|2.25|own number|null},  (null = not given, counted as low active since 2026-11-05)
  "goal": {"type": "gain"|"typed"|"maintain", "gain_kg", "weeks", "surplus_pct" (null = automatic),
           "protein_g_per_kg" (null = the DRI for this body, since 2026-11-05), "typed_protein_g", "typed_kcal", "start_date", "start_kg"},
  "budget": {"amount", "period": "day"|"week"|"month", "currency": "CZK"},
  "cards": ["rohlik-xtra","billa-club","kaufland-card","lidl-plus","albert","penny","tesco-clubcard"],
  "cards_other": [{"key": "other-<slug>", "name"}],
  "locations": [{"id": "L-0001", "name", "address", "walk_limit_min"}],
  "accounts": [{"id": "A-0001", "shop": "rohlik"|..., "account_name", "email"}],
  "likes", "dislikes", "allergies" (free text),
  "cooking": {"max_cook_min", "meals_per_day"},
  "weights": {"price": 40, "speed": 30, "taste": 20, "time": 10} }
```
Weight is NOT in the profile: the newest entry of `history.json` `weighins` is the weight.

## history.json
`{ "weighins": [{"id": "W-0001", "date", "kg"}], "spend": [{"id": "S-0001", "date", "czk", "shop", "note"}], "plans": [{"id": "P-0001", "request_id", "option_id", "label", "cost_per_day", ...}], "notes": [{"id": "N-0001", "date", "text"}], "_trash": [...] }`. Removed rows go to `_trash`; codes are never reused.

## requests/REQ-YYYYMMDD-HHMMSS-<user>.json
```
{ "id", "created", "status": "waiting"|"cancelled", "user_id", "user_name", "lang",
  "mode": "cook"|"order"|"eatout", "start_date", "days", "meals_per_day", "meals_usual" (his profile meals a day when sent, since 19/10),
  "budget_total", "budget_per_day", "location": {copy of the profile place},
  "wishes", "cook": {"cart_shop": "auto"|"rohlik"|"kosik"|"tesco"|"billa", "max_cook_min_per_day"},
  "order": {"max_delivery_min"}, "eatout": {"max_walk_min"},
  "targets": {"protein_g", "kcal", "mode", "protein_g_per_kg", "weight_kg"},
  "weights", "cards": [keys the person holds], "cards_named", "accounts", "likes", "dislikes", "allergies",
  "rules": {"cart_only_never_pay": true, "replan_if_cart_off_pct": 10, "stale_days": 14, "planner_version"} }
```
A request is DONE when `results/<same id>.json` exists. Claude never edits a request file.

## results/<REQ-id>.json (written by the run task, session 3 and 4)
```
{ "id": same as the request, "request": {copy of the request}, "finished": "<ISO time with zone>",
  "status": "done"|"error", "error": "text when status is error",
  "options": [ { "id": "O1", "label", "kind": "cook-online"|"cook-shop"|"cook-mixed"|"order"|"eatout", "shop",
     "days", "cost_regular": whole plan without cards (CZK), "card_savings": [{"card", "saving"}],
     "protein_g_per_day", "kcal_per_day", "minutes_per_day", "taste": 1-5,
     "nutrition_label": "exact"|"table"|"estimate", "price_seen": "<ISO>", "price_label",
     "distance_m", "walk_min", "transit_min", "delivery_min", "delivery_fee", "min_order",
     "items": [{"id": food id, "name", "packs", "cost"}], "recipes": [{"name", "minutes", "steps"}],
     "cart": {"shop", "url", "filled": bool, "account_checked": "name seen"}, "route_url", "notes" } ],
  "scored": output of `python tools/planner.py score-result <file>` }
```
The app scores the options again with `app/js/planner.js` and shows "Maths check" (same or different).

Session 3 (2026-10-19) additions, all written by `tools/cook.py result` (Cook mode):
- result top level: `need` (protein g and kcal for the whole plan), `place` (survey name), `foods_used`, `shops_with_foods`.
- option: `protein_g_per_day` / `kcal_per_day` = what the plan feeds him (never above the target); `bought_protein_g` / `bought_kcal` = everything in the whole packs for the whole plan (leftovers named in `notes`).
- option: `notes` (plain text from the run, shown under "Notes from the run"), `stores` ([{id, name, address}] of shops he walks to),
  `price_label` (`online`, `leaflet`, `cart` or `mixed`), `cart` adds `cart_total_ours` (CZK of this plan's lines, read in the cart),
  `plan_before_cart`, `diff_pct`, `problems`; the app shows "Cart filled with these items: <total>" when `filled` is true.
- item: `shop`, `category` (staple key of steps/cook-staples.json), `product_id`, `url`, `cost` (regular), `cost_with_card`, `card`,
  `protein_g`, `kcal`, `price_label`, `nutrition_label`. The app names the shop of each item in a mixed option.
- recipes: `{name, minutes, steps}`; the run's `needs` list is used to give each option only recipes it has the foods for, then dropped.

## foods/foods.json
`{ "version": 1, "updated", "items": [ item ] }`, item format in `tools/foods.py --help`. Prices in CZK; nutrition per 100 g; `nutrition_label` exact/table/estimate/none; `price_history` keeps every older price.

## shops/shops.json (written in session 2, 19/10/2026)
```
{ "version": 1, "method": "how the survey was done", "bands": {...}, "excluded": {"S002": "why"},
  "locations": { "<place name, as saved in profiles>": {
      "name", "address", "lat", "lng", "plus_code", "surveyed": "<ISO>", "walk_surveyed": "when the walking times were read",
      "shops": [ shop ] } } }
```
shop, `kind: "store"` (you walk or ride there):
`{ "id": "S016", "kind": "store", "chain": "billa"|"albert"|...|"independent"|"market", "name", "address", "category" (Google), "lat", "lng",
   "distance_m" (walking route, metres), "walk_min", "walk_band": "near"|"mid"|"far"|"transit", "transit_min" (Google, Tuesday 10:00),
   "hours" ("Mo–Fr 07:00–20:00, Sa–Su closed"; the Czech screen translates the day names), "online": false,
   "prices_online": "yes"|"online_other" (an online shop's price, the shelf can differ)|"leaflet"|"no",
   "card": loyalty card key or null, "card_file": "cards/<chain>.md", "website", "route_url", "note",
   "closed_seen": "<ISO>" (a run saw "closed" on Google: the row is greyed and says so) }`
shop, `kind: "delivery"` (comes to the place):
`{ "id": "D-...", "kind": "delivery", "chain", "via": "wolt"|"foodora" (absent for Rohlík, Košík, Tesco), "name", "online": true,
   "delivery_min": [from, to] | number | null (null = you pick a time slot), "closed_at_check": true (the shop was closed when read, so no time),
   "delivery_fee": CZK | null (= shown in the cart), "fee_seen": CZK seen while not logged in (not a promise), "seen": "<ISO>",
   "min_order": CZK | null, "min_checked": false (minimum not checked yet),
   "service_fee_pct", "service_fee_min" (foodora), "prices_online", "card", "card_file", "website", "note" }`
Bands (his rule, 19/10/2026): walk 10 min or less `near` (green), 11-20 `mid`, 21-30 `far`, over 30 or not measured `transit`.
The app recomputes the band from `walk_min`; `walk_band` is for Claude and tools.
Kept: every food shop within 30 min on foot, chain stores further away with tram/bus time, the nearest store of every chain (incl. Žabka, Zeman).
Built by `tools/build_shops.py` from the survey files (session 2).
Freshness: the survey is done ONCE per place (see cards/google-maps.md); a run checks only the shops its plan uses (closed? hours?);
prices are never stored here (foods.json).

## updates/<YYYY-MM-DD>.json (session 5, written by `tools/watch.py ingest` only)
```
{ "created": "<ISO>", "source": "rohlik", "checked": n, "watch_pct": 5, "unchanged": n, "not_in_foods": [], "not_watched": [], "foods": {counts from foods.py},
  "changes": [ { "food_id": "rohlik-<id>", "item_ids": ["rohlik-<id>" or "rohlik:<id>" as the results spell it], "name", "old", "new" (null = not returned),
                 "pct" (new vs old, 1 decimal; null when no new price), "sold_out": bool, "back_in_stock": bool, "in_stock": bool,
                 "report": bool (true = moved at least watch_pct %, sold out or back in stock; false = a small move, stored but not notified),
                 "baseline": "foods.json" | "result" (a product with no foods record, such as a Rohlík ready meal: compared with the result's price, then with yesterday's watch),
                 "why_watched": ["result <REQ> option <O> (finished <date>)", "picked plan <P> of <user> (<REQ>)"] } ] }
```
A second run the same day writes `<date>-2.json`; files are never overwritten. The app shows "Prices changed since this plan: N items, biggest change X %. Re-plan?" (or "Sold out since this plan: N. Re-plan?") on a result when the newest change per product created after the result's `finished` time touches one of its items (`food_id` or any `item_ids` entry) by at least `watch_pct` (5 %, the same line as the phone message) or is sold out; `replan_pct` (10 %) is the cart-versus-plan rule, not this one. Also `stock_unknown` (ids whose stock cell was blank: the old state was kept) and `refused_by_foods` (items foods.py would not store; they keep the old price). `data/share-forbid.txt` (optional, never sent): one word per line that `tools/make-share-copy.py` must not find in a share zip (your name, Windows user name, street, e-mail). Which products are watched: Rohlík products of every result finished in the last 14 days and of every plan picked in the last 30 days (`steps/run-settings.json` `watch`: `watch_result_days`, `watch_picked_days`, `watch_max_ids` 60, `watch_batch` 20); `watch_pct` comes from `app-settings.json`. Evidence of each watch: `runs/watch-<date>/` (targets.json = why each product, rohlik.tsv = the connector's answer, add-rohlik.json = what went into foods.py); `runs/watch-last.json` = last seen price of products without a foods record.

Session 4 (2026-10-19) additions, written by `tools/dine.py` (Order online and Eat out):
- `shops/restaurants.json` (new, `dine.py survey` only, once per place): `{version, method, locations: {<place>: {name, lat, lng, surveyed, surveyed_walk_min, walk_source, note, restaurants: [{id "R001", name, lat, lng, walk_min, distance_m, maps_url, route_url, menicka (page URL or null), note}]}}}`. Ids follow walking minutes; they change only when the place is surveyed again.
- `runs/<REQ-id>/`: `rohlik.tsv`, `wolt.tsv`, `foodora.tsv`, `menicka.tsv` (raw rows, header in `dine.py --help`), `read.js` (the browser script for this request), `dishes.json` (checked dishes with estimates), `options.json`, `basket.tsv`, `extras.json`.
- result top level: `targets_used` = `{protein_g, kcal, meals, meals_usual, meals_usual_from, share, day_protein_g, day_kcal}`: the request plans `meals_per_day` of his usual meals a day (the request's `meals_usual`, else profile `cooking.meals_per_day`, else 3; `meals_usual_from` says which), so the targets are shared out (2 of 3 meals = two thirds). The app (`resultTargets`) and `planner.py score-result` score with these when present. Also `venues_read`, `dishes_estimated`, `ledger` (the readers' counts: listed, too slow, closed now, read, failed, dishes, estimated, kept, blocked) and `too_few_dishes` (venues with fewer dishes than a day's set needs).
- option kind `order` (shop `wolt`, `foodora` or `rohlik`) or `eatout` (shop `eatout`): `delivery_min` ("40-50", a number, or null when not shown: then the request's `max_delivery_min` is counted), `delivery_fee` (null = not shown, counted as 0 and said in the notes), `min_order` (Wolt and Rohlík: the dishes are counted as at least the minimum), `service_pct`, `service_min`; eat out: `walk_min`, `distance_m`, `route_url`, `stores` [{id R.., name}], `price_band`. Minutes a day: order = 5 to choose and order + delivery time + 3 to heat each later dish; eat out = walk there and back for each meal. Restaurants with no menu online, or too few dishes for a day, have `cost_regular: null` (shown, never picked).
- item (order/eatout): `id` "<source>:<item>", `product_id` (Wolt item id, foodora code, Rohlík productId, menicka "<restaurant>-<n>"), `packs` (whole plan), `packs_per_day`, `price`, `protein_g` / `kcal` (per day for this dish), `grams`, `nutrition_label` (`exact` Rohlík label, `estimate` dish table), `basis` (how it was estimated), `url`, `price_label` (`wolt`, `foodora`, `rohlik`, `daily_menu`, `delivery_menu`, `basket`).
- `cart` (order, Wolt only): `filled`, `cart_total_ours`, `plan_before_cart`, `diff_pct`, `problems` (also basket lines not in the plan), `covers` ("day 1 (order again each day)" or "the whole plan"), `fees_from_basket`. `basket.tsv`: `item qty line_price`; lines of the same item are added up; optional rows `_delivery_fee` and `_service_fee` carry the fees the basket shows, and the cost is re-counted with them and the minimum order.
- menicka rows: `desc` = `A:<allergen numbers>` (EU 1-14, as the menu prints them); dishes keep them in `allergens`.
- `steps/dish-table.json`: how a dish without a label is estimated (types, components with USDA FNDDS values and FDC numbers, word lists, price floor, weight rules, `meat_led_types`, `pieces_max`, `main_salad_words`, `allergens` (the 14 EU allergens: words he may type, dish words, menu numbers), `changes`).

## Web app (2026-11-05)
The same files, in the signed-in account instead of a folder: Firestore `spaces/<account id>/files/<path encoded with encodeURIComponent>`, one record per file `{ "path": "data/users/x/profile.json", "text": "<the file exactly as on disk>", "updated": <server time>, "device": "<8 letters>" }`. Who writes which file is unchanged; a result file added in Settings is copied in unchanged after the checks in HOW-IT-WORKS 8.2.
