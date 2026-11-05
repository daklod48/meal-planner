# Meal Planner. How it works (for someone handed the code)

_Written 2026-11-05 from the code as it stands after the five build sessions of 19/10/2026 (planner version 1.1). Read this before changing anything; `FORMATS.md` is the exact file contract, `_PAST-WORK/LESSONS.md` says why many rules exist. Section 7 lists what changed on 2026-11-05._

## 1. The one-sentence picture

The app is a calculator with a filing cabinet; Claude is the clerk who fetches prices and drops result sheets into the cabinet.

Anchor: you know an Excel salary workbook where people type inputs into one sheet and formulas compute the pay. Meal Planner splits that same workbook into two parties that never talk directly:

- **The app** (`app/MealPlanner.html` plus four scripts) is the workbook. A person types a profile and a request; the app saves them as JSON files (JSON = plain text that stores named values, like `{"kg": 68.4}`) and shows results with its own maths.
- **Claude** (the scheduled task "Meal Planner run" and "Meal Planner price watch") is the clerk. It reads a waiting request, collects prices from shops, hands the raw rows to Python helpers in `tools/`, and those helpers write a result file.

They only meet through files in `MealPlanner/data/`. Nothing goes over the internet from the app; the folder is the whole "server".

```
  person ──types──> APP (browser) ──writes──> data/requests/REQ-....json
                                                    │
                     Claude run task <──reads───────┘
                     reads shops (Rohlík connector, Chrome)
                     writes raw rows data/runs/REQ-.../*.tsv
                     tools/cook.py | dine.py  ──writes──> data/results/REQ-....json
                                                    │
  person <──shows── APP <──reads (every 30 s)───────┘
                    re-scores with planner.js, compares with planner.py ("Maths check")

  nightly 22:10: price watch -> tools/watch.py -> data/updates/<date>.json -> app banner "Prices changed ... Re-plan?"
```

## 2. The four browser scripts and how they fit

They load in this order in `MealPlanner.html`, and each later one uses the earlier ones:

| File | Role | Anchor |
|---|---|---|
| `js/planner.js` (275 lines) | The maths only: daily targets, budget per day, card prices, the shopping basket, scores and the three picks. No screen, no files. | The formula cells of the workbook |
| `js/i18n.js` (259 lines) | Every word on screen, in English (`en`) and Czech (`cs`). | A translation sheet with one row per label |
| `js/store.js` (390 lines) | Folder access, data in memory, the ONE function that changes data (`commit`), undo, saving. | The workbook's file and its undo history |
| `js/app.js` (1,126 lines) | The screens: draws each view, reads form boxes, calls the other three. | The sheets a person clicks through |

### 2.1 planner.js: the maths, with a Python twin

- `targets(profile, weightKg, asOf)` turns a profile into grams of protein and kcal a day. Resting energy uses the Mifflin formula, multiplied by the activity level (PAL), plus a surplus for weight gain. Worked example already in your notes: a 68.4 kg man, resting 1,686.5 kcal x 1.76 = 2,968 kcal to keep his weight.
- `basket(foods, need, cards)` is the greedy shopping list (greedy = at each step buy the single pack that covers the most missing protein and kcal per CZK, never looking ahead). Each product is capped at 40 % of the need, which is why it no longer buys 14 bags of oats.
- `score(options, ctx)` gives each option four part-scores from 0 to 100 and a weighted total (default price 40, speed 30, taste 20, time 10). Example: the cheapest option costs 200 CZK a day, another costs 250; its price part-score is 100 x 200 / 250 = 80. It then names three picks: cheapest (among options whose speed part-score, the average of protein cover and kcal cover, is at least 90), fastest to the goal, best balance (highest total). An option missing its cost or minutes is "incomplete": shown, never picked.

**Twin** means the same formulas exist a second time in `tools/planner.py`, so Claude's result files and the app's screen can be checked against each other. The result screen prints "Maths check: same" when the ranking from `planner.py score-result` and from `planner.js` are byte-identical. To keep them identical, both use loops instead of Python's `sum()`, one shared rounding function `r()` (half away from zero), and ties broken by id. `tests/t_formulas.mjs` proves it on 324 generated cases.

### 2.2 i18n.js: the words

`i18n` is short for "internationalisation" (18 letters between the i and the n). The file is one object, `MPI18N = {en: {...}, cs: {...}}`, 444 keys in each. Screens never contain a sentence; they call `t('key', {name: value})`:

```js
t('saved_at', {time: '14:05'})   // en: "Saved 14:05"   cs: "Uloženo 14:05"
```

`t()` looks in the chosen language, falls back to English, and replaces `{time}` with the value. Czech plurals need three forms (1 den, 2 dny, 5 dní), so `tp(key, n)` picks `_one`, `_few` or `_many`. `tests/t_words.mjs` fails if a key exists in one language but not the other.

### 2.3 store.js: the only door to the data

Every screen action that changes a person's data goes through `commit(userId, label, ops)`. An op is `{file: 'profile' | 'history', path, value}`; a path like `locations#L-0002.name` means "in the list `locations`, the item with id L-0002, its field `name`". `commit`:

1. records the old and new value of each field in `changes.json` (who, when, old, new),
2. marks the file dirty (dirty = changed in memory, not yet on disk),
3. schedules a save 0.4 s later, so ten quick edits become one save.

**Undo** is a new change that writes the old values back, never an erase. It is refused when a field no longer holds the value the change gave it, and the refusal names the later change that moved it. Codes such as `W-0007` are never reused, because `nextCode` also counts removed rows kept in `_trash`.

**Saving** (`saveNow` and `writeText`) follows four rules, in this order: (a) before writing, read the file and compare its hash (a fingerprint of the content) with the hash this window last saw; if they differ, someone else changed it, so refuse with "changed outside" instead of overwriting; (b) write through the browser's `createWritable`, which only replaces the file on `close()`, so a crash leaves the old file whole; (c) read the file back and compare hashes before saying "Saved"; (d) write each person's `changes.json` last, so the log never lists a change the data files do not contain.

The folder itself comes from the **File System Access API** (the browser feature that lets a page save into a folder you allow once). The folder handle is remembered in IndexedDB (a small database inside the browser), so after a restart the person only clicks "Allow" again.

`refreshShared()` re-reads the files Claude writes (`requests/`, `results/`, `updates/`, `foods/foods.json`, `shops/shops.json`) every 30 seconds; the app never writes those, except a request it created.

### 2.4 app.js: the screens

- `render()` redraws the header and the current view from scratch. Before redrawing it remembers which box had the cursor and where, and puts the cursor back afterwards (the clinic-app bug of 04/10 taught this).
- Each view is a function returning HTML text: `vProfiles`, `vProfileEdit`, `vPlan`, `vRequests`, `vRequest`, `vHistory`, `vFoods`, `vShops`, `vSettings`.
- **Drafts**: a half-typed form lives in `drafts` (kept in the browser's localStorage), keyed by person, for example `request:tomas-dvorak`. Clicking away shows a "Being typed" bar with Continue / Discard.
- `sendRequest()` checks the form, builds the request object (a frozen copy of targets, weights, cards, place) and hands it to `store.writeRequest`. From that moment the request file is never edited again except `status: cancelled`.
- `resultHtml()` reads a result file, scores the options again with `planner.js`, shows the three picks, a table of all options, the "Maths check" line, and `updatesBanner()` when the nightly watch saw a price move on one of the plan's items.

## 3. The Python side (`tools/`)

Claude never edits data files by hand (lesson: an unattended run must use a helper with checks). It writes raw shop rows as TSV (tab-separated text, one row per product) and calls:

| Tool | Commands | Writes |
|---|---|---|
| `cook.py` | pick, account, terms, ingest, borrow, options, cart, result, error, closed | `runs/<REQ>/`, `results/<REQ>.json`, via foods.py `foods/foods.json` |
| `dine.py` | terms, ingest, options, basket, result, survey, estimate | Order online and Eat out results, `shops/restaurants.json` |
| `foods.py` | add, list, validate | `foods/foods.json` only (checks every product, keeps `price_history`, lock + read-back) |
| `watch.py` | targets, ingest, show | `updates/<date>.json` (nightly price watch) |
| `planner.py` | targets, basket, score-result, fixtures | the `scored` block of a result |
| `build_shops.py` | | `shops/shops.json` from a survey |
| `make-share-copy.py` | `--check` | the share zip without `data/` |

`tools/browser/*.js` are page scripts Claude pastes into Chrome to read a shop's own data in one call (Košík, Tesco, kupi.cz, Wolt, foodora, menicka.cz). `dish-core.js` is the browser twin of dine.py's dish estimate.

## 4. The data contract in short (full version: `FORMATS.md`)

The contract is the promise "who writes which file, and what fields it has". It is what lets two programs that never talk work together.

| File in `data/` | Written by | Read by |
|---|---|---|
| `app-settings.json` | app | app |
| `users/<id>/profile.json`, `history.json`, `changes.json` | app only, through `commit` | app, Claude (read only) |
| `requests/REQ-YYYYMMDD-HHMMSS-<user>.json` | app, once | Claude |
| `results/<same REQ id>.json` | Claude through cook.py or dine.py | app |
| `foods/foods.json` | foods.py only | app, Claude, planner.py |
| `shops/shops.json`, `shops/restaurants.json` | Claude (survey once per place) | app, Claude |
| `updates/<date>.json` | watch.py only | app |
| `runs/...`, `runlog.md` | the run task (evidence, never sent) | people |

Four rules hold the contract together:

1. **One writer per file.** Two writers on one file is how data gets lost; here no file has two.
2. **A request is done when a result with the same id exists.** No status flag to keep in step.
3. **A request snapshots everything it needs** (targets, weights, cards, place). Editing the profile later does not change a plan already asked for.
4. **"Unknown" is never 0.** A missing cost, delivery fee or time is stored as `null`; the app shows "–" and never scores such an option.

## 5. One request, end to end (Cook mode, real numbers from 19/10)

1. He fills New plan: 3 days, cook, budget 480 CZK. The app writes `requests/REQ-20261019-100250-<user>.json` with targets 150 g protein, 2,500 kcal a day.
2. He opens Claude desktop > Scheduled > "Meal Planner run" > Run now. The task follows `steps/RUN-STEPS.md`.
3. `cook.py pick` returns that request. `cook.py account` checks the Rohlík account e-mail matches the profile.
4. `cook.py terms` prints the search words and which shops can be skipped (prices read within 48 hours). Claude reads Rohlík through its connector and Košík, Tesco, kupi.cz through Chrome, writing TSV files.
5. `cook.py ingest` checks each product (name rules, protein floor) and stores it through `foods.py`. `cook.py options` builds the baskets with planner 1.1. `cook.py cart` compares the Rohlík cart Claude filled (7 lines, 292.08 CZK) with the plan; more than 10 % off asks for a re-plan.
6. `cook.py result` writes `results/REQ-...json`, then `planner.py score-result` adds `scored`.
7. Within 30 seconds the app shows the result, the three picks and "Maths check: same". He presses "Pick this" and `commit` adds a `P-0001` plan to his history.
8. At 22:10 the price watch asks Rohlík for today's price of every product in recent plans, `watch.py ingest` writes `updates/<date>.json`, and the app shows the banner if a product moved by 5 % or more or sold out.

## 6. Tests (see `tests/README.md`)

Fast ones, about 15 s together: `node tests/t_formulas.mjs`, `node tests/t_words.mjs`, `node tests/t_contrast.mjs`, `python3 tests/t_foods.py`, `python3 tests/t_cook.py`, `python3 tests/t_dine.py`, `python3 tests/t_watch.py`. The browser test `LC_ALL=C.UTF-8 node tests/t_app.mjs` takes about 60 s and needs Playwright, so it runs in Claude's workspace, not on the laptop shell.

## 7. Changes on 2026-11-05

Three fixes, each with a test that fails on the old code and passes on the new one.

### 7.1 Tests no longer depend on today's date (`tools/cook.py`, `tests/t_cook.py`, `tests/t_app.mjs`)

What went wrong: on 05/11 the unchanged kit failed 5 checks. `t_cook.py` failed 3 of 55: they test the 48-hour freshness rule ("prices read less than 48 hours ago are reused") with fixture prices read on 19/10, and `cook.py` measured "48 hours ago" from the real clock, so on 21/10 the fixtures silently turned "old". `t_app.mjs` failed 2 of 109 ("old price row grey"): the app greys a price older than 14 days, the fixture had exactly one price from 20/09 and the rest from 18-19/10, and since 2/11 every price is older than 14 days, so all rows turned grey. In both cases the program was right and the test had a calendar date built in.

Anchor: your LESSONS already hold this rule for the clinic's `verify.py`: "a check must compute what it expects from the source files, never hard-code one day's numbers". The same mistake, one level down: the hard-coded thing was the date.

Fix: `cook.py` reads the time through one function, `clock()`. Normally it is the real time. If the environment variable `MP_NOW` is set (an environment variable = a named setting given to a program when it starts, invisible to anyone else), `clock()` returns that instead. `t_cook.py` now sets `MP_NOW` to one hour after the newest price in its own fixture, so it computes "now" from the source files, as the lesson says. A real run never sets `MP_NOW`, so behaviour is unchanged. `watch.py` and `dine.py` take their time from the same function, so one switch covers all three tools.

In the browser test the opposite direction was simpler: instead of moving "now" back, `t_app.mjs` moves the fixture's nine price-read dates forward by one amount, so the newest sits one hour before the real clock and the 20/09 price stays 29 days older than the rest. The app code is untouched for this part.

Proof it bites: with the old `cook.py` the new `t_cook.py` fails the same 3 freshness checks; after the fix 59 of 59 pass (55 old + 4 new).

### 7.2 Times are compared as moments, not as text (`app/js/app.js`, `tools/cook.py`)

What went wrong: the "Prices changed since this plan" banner decides "is this price update newer than the result?" by comparing two time stamps as text. Text comparison works only while both stamps carry the same UTC offset (the "+02:00" at the end). Prague switches from +02:00 to +01:00 on the last Sunday of October at 01:00 GMT (Directive 2000/84/EC, Articles 2 and 3), which this year was 25/10. Real example: a result finished at `2026-10-25T02:40:00+02:00` (00:40 UTC); a watch at `2026-10-25T02:10:00+01:00` (01:10 UTC) is 30 minutes LATER, but as text "02:10" sorts before "02:40", so the app treated it as older and hid the banner. The same text sort ordered the update files.

Second, smaller defect in the same family: when Python cannot find the Prague time-zone table (possible on Windows without the `tzdata` package), `cook.py` fell back to a fixed +02:00, which is one hour wrong from late October to late March.

Fix: the app turns each stamp into a moment (milliseconds since 1970) before comparing; a stamp it cannot read counts as "not newer" instead of being guessed. The Python fallback now applies the EU rule itself (summer time from the last Sunday of March 01:00 UTC to the last Sunday of October 01:00 UTC). The request list is sorted the same way (display order only).

Tests: two new t_app checks on the exact 25/10 night, one in each direction (a watch that is textually earlier but really later must show the banner; one textually later but really earlier must not). The old `app.js` fails both: it hid a real banner and showed a false one. A t_cook check compares the fallback zone with the real Prague table at 152 moments (every 30 minutes around each switch of 2025 to 2027, plus mid-winter and mid-summer); putting the fixed +02:00 back makes it fail.

### 7.3 A stock-only change is no longer reported as a price change (`tools/foods.py`)

What went wrong (already listed in your memory as a known gap, S3): `foods.py` treated "price, card prices and in-stock" as one block. When a product was first stored without stock information (`in_stock` missing) and the next read added `in_stock: true` at the same price, it was listed under `price_changed` with old 17.91 and new 17.91, and a `price_history` row was added with an unchanged price. A run log saying "price changed: 17.91 -> 17.91" is noise that hides real moves.

Fix: two separate questions. Did the price or a card price move? Then `price_changed` and a history row, as before. Did only the stock state change between two KNOWN states (in stock / sold out)? Then a new list `stock_changed` and a history row (a sell-out is worth remembering). Unknown -> known stock is just `updated`, with no history row. `price_changed` keeps its exact old format, so `cook.py ingest` and the run log read it as before; `watch.py` simply gains a `stock_changed` count in its `foods` block. Two new t_foods checks (23 of 23); the old `foods.py` fails both.

### 7.4 Test totals after these changes

t_formulas 324 cases, t_words 444 keys, t_contrast 40 pairs, t_foods 23, t_cook 59, t_dine 321, t_watch 38, t_app 111, t_shops 41 (t_shops reads the real `data/shops/shops.json`; checked here with the 19/10 survey fixture in a scratch copy, since `data/` is never in the zip). All pass.

This file is not in the share copy (`tools/make-share-copy.py` sends a fixed list of root files). Since 5 Nov 2026 it no longer quotes a real request id, so it can sit in the public GitHub repository.

## 8. The web app and DRI targets (second session of 2026-11-05)

### 8.1 Daily targets from the Dietary Reference Intakes (planner 1.2)

Anchor: before, every person without a typed number got 1.6 g protein per kg (a sports-nutrition figure, Morton et al., 2018) and energy = Mifflin resting energy x activity. Now the default is the **Dietary Reference Intakes** (DRI = the US and Canadian National Academies' tables of how much of each nutrient healthy people need, by age, sex and life stage), and a person's own g/kg is optional.

- **Protein** = the **Recommended Dietary Allowance** (RDA = the amount that covers 97 to 98 of 100 healthy people) in g per kg of body weight: age 1 to 3: 1.05; 4 to 8: 0.95; 9 to 13: 0.95; 14 to 18: 0.85; 19 and over: 0.8; pregnancy 1.1; breastfeeding 1.3. Example: a 30-year-old woman of 62 kg gets 0.8 x 62 = 49.6 g; pregnant, 1.1 x 62 = 68.2 g.
- **Energy to keep the weight** = the **Estimated Energy Requirement** (EER) equation of the same report, with height in metres and a physical activity factor (PA) for four levels (sedentary, low active, active, very active; the profile's PAL 1.53 / 1.76 / 2.25 map to low active / active / very active; "Not sure" counts as low active). Example: man, 23, 178 cm, 68.4 kg, active (PA 1.25): 662 - 9.53 x 23 + 1.25 x (15.91 x 68.4 + 539.6 x 1.78) = 3,003.73 kcal. Pregnancy adds 0 / 340 / 452 kcal by trimester; breastfeeding adds 330 (baby 0 to 6 months) or 400 (7 to 12 months). Children use the child equations (ages 1 to 2: 89 x kg - 100 + 20).
- The gain goal still adds the 10 to 20 % surplus of Iraki et al. (2019) on top, and warns that a gain goal is meant for adults.
- Where: `DRI`, `dri()` and `targets()` in `app/js/planner.js`, the identical twin in `tools/planner.py`. Every target is shown with its rule, this body's numbers and a source link (profile form, "Where these targets come from" above the plan form, Settings > Sources).
- Sources: Institute of Medicine (2005), https://doi.org/10.17226/10490, and the summary table https://www.ncbi.nlm.nih.gov/books/NBK56068/table/summarytables.t4/. **Not re-checked against the pages on 5 Nov 2026**: the build machine's network refused both sites (and FAO, Wikipedia). The numbers were entered from the report as known to the builder, the app says so under each target, and `tests/t_formulas.mjs` holds five sums worked on paper. Check them against the table once before telling people to rely on them.
- Tests: 130 new twin cases (every age group, both sexes, the activity edges 1.39 / 1.4 / 1.6 / 1.9, pregnancy, breastfeeding, missing trimester, age under 1); the first 324 cases are byte-identical. The two t_app checks that hard-coded 2,958 and 3,402 kcal (Mifflin) now compute the expected number from `planner.js`.

### 8.2 The web app (`index.html`)

Anchor: HelloDorm (`daklod48/hellodorm`, HOW-IT-WORKS section 4). Same pattern: the link lands on a home page; **Sign in**, **Sign up**, or **Try the demo account**; Firebase keeps the login; each account's data is in Firestore; the demo is an anonymous account with its own copy of sample data.

The one idea that kept the old code intact: **a virtual folder.** `store.js` saves through a folder handle (the File System Access API). `app/js/cloud/vfs.js` is an object with the same methods (`getDirectoryHandle`, `getFileHandle`, `getFile().text()`, `createWritable().write/close`, `entries`) whose files live in the signed-in account. So `commit`, undo, the hash check before a write, the read-back before "Saved", the change log written last, the codes never reused, and the whole file contract of `FORMATS.md` work unchanged; only the place the files sit is new.

```
 phone / laptop browser                                   Firebase (Google)
 index.html                                               Authentication: e-mail+password, Google, anonymous (demo)
   app.js (screens) -> store.js (commit, undo, save)      Firestore:
       -> vfs.js (virtual folder)                           spaces/<account id>/files/<data/users/x/profile.json, encoded>
           -> backends.js  --setDoc / onSnapshot-->           { path, text, updated: server time, device }
 another device signed in to the same account <--onSnapshot-- (a change arrives in about a second)
```

- **Backends** (`app/js/cloud/backends.js`): `firebase` when `app/js/firebase-config.js` holds a config; otherwise **practice** (the same calls kept in this browser's localStorage, labelled on screen). The tests run both.
- **Live sync:** the Firestore listener reports files changed by another device; if nothing is being typed and nothing is unsaved, the app reloads its data and redraws the same screen ("Updated from your other device"); otherwise it waits and says so. A save that would overwrite a newer version from another device is refused by the existing "changed outside" rule (now worded "changed on another device").
- **Demo:** `app/demo/seed.json` = the test person Tomáš Dvořák, 7 weigh-ins, a picked plan and a real Cook result made by `tools/make_demo_seed.py` (it runs `cook.py` ingest / borrow / options / result and `planner.py score-result` on the 19/10 shop rows in `tests/fixtures/cook/`). When a demo starts, every date moves forward by whole days so the newest is from the last day (birth date excepted). **Keep my data** links an e-mail and password to the demo account (Firebase `linkWithCredential`), so nothing is lost.
- **Prices from Claude's runs:** Claude's run task reads files on the owner's laptop, not Firestore. Settings > "Prices from Claude's runs" downloads a waiting request file; the owner drops it into `MealPlanner/data/requests`, runs the task, and adds the result file back. The result is checked (whole JSON, a REQ id that exists in this account, options present) and stored unchanged as `data/results/<id>.json`. A direct connection (Claude reading Firestore) would need a service-account key, which is a real secret; deliberately not built.
- **Security rules** (`firestore.rules`): an account reads and writes only `spaces/<its id>/files/*`; a record must be exactly path / text (under 900 kB) / server time / device; everything else is closed. 23 checks in `tests/t_rules.mjs` on Google's emulator; loosening the rules makes 10 of them fail.
- **Firebase SDK** 12.19.0 is copied from the npm package into `app/vendor/firebase/` (the CDN www.gstatic.com was blocked on the build machine, and a local copy also means the app never depends on it). Only change: the absolute import of `firebase-app.js` points at the local file.
- **No personal data:** the friend's first name was removed from a fixture and from this file; the demo uses the kit's test person. Still in the repository: the place "Blanice kolej" (a public student dorm) and "Westfield Chodov" in fixtures, cards and the demo, as before (owner decision pending since 19/10).

### 8.3 Test totals after this session
The 1,401 checks of 7.4 all pass, inside these totals: t_formulas 454 cases (324 old + 130 new), t_words 584 keys (444 old + 140 new), t_contrast 40, t_foods 23, t_cook 59, t_dine 321, t_watch 38, t_app 111, t_shops 41 (now runs from the repo with the 19/10 fixture when `data/` is absent). New: t_web 41 (practice backend) and 43 (real Firebase SDK on the emulators, two more checks that the files are in Firestore and not in the browser), t_rules 23. `sh tests/run_all.sh` runs them all.

### 8.4 Improvement Lab run 1 (kept, 54 of 80 from 46)
`LAB/` holds the frozen rubric, the captures of every run (`LAB/capture.mjs`), `RUNS.md`, `runs.json` and `tracker.html` (open by double-click). Run 1 changed the web app only (`web.js`, `web.css`, two hooks in `app.js`):
- **Phone shell** (screens 700 px wide or less): a one-row header (profile, the other language, the demo badge) and a bottom tab bar of five (Plan, Results, History, Profile, Settings) with icons, short words and a red badge counting results not opened yet on this device (`mp-seen:<account>` in localStorage). Foods, Shops and Sign out are under Settings > More on the phone. Content now starts 67 px from the top (was 338). Every phone control is at least 44 px (Apple's guideline for a hit region).
- **Instant estimate** (Cook mode, under the mode buttons): `planner.js basket()` runs for every shop with at least 4 products already in the account and shows the cheapest single shop that covers the targets for the chosen days: total and per day, protein and energy cover, budget check, the shopping list, and plainly what it skips (today's prices, the vegetables rule, recipes, the cart). It writes nothing. Example from the demo: 3 days at Košík.cz, 703 CZK (234 CZK a day), 100 % of 59 g protein and 3,545 kcal, 103 CZK over a 600 CZK budget.
- **Demo dates**: `cook.py result` and `foods.py` stamp the build-day time; `make_demo_seed.py` now pins both to the run's own time, so the demo no longer says "Done 21. 11. 2026" on 5. 11.
- Tests: t_web now has 49 checks (practice) and 51 (Firebase emulators), including the estimate equals `basket()` recomputed in Node, the five tabs at the bottom at 44 px or more, content within the top 120 px, the badge clearing once a result is opened.
