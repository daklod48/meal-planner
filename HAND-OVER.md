# HAND-OVER: Meal Planner web app, 2026-11-05 to 2026-11-08

## Where the work lives
- Public repo `daklod48/meal-planner`, branch `main` (4fcd8ab = PR #1 merged, live). This file and STATUS.md: branch `hand-over-2026-11-08`.
- Live: https://daklod48.github.io/meal-planner/ (GitHub Pages from main; Firebase project meal-planner-d5713, rules published 07/11).
- Docs in the repo: HOW-IT-WORKS.md (sections 8 web app and DRI, 9 shopping list), FORMATS.md, FIREBASE-SETUP.md, steps/RUN-STEPS.md 1.5, tests/README.md, LAB/ (rubric, runs, tracker.html).
- Local only, never in git: `data/share-forbid.txt` (private words for the publish check), the owner's `_PAST-WORK/` notes, LAB screenshots. Tags lab-run-00 / lab-run-01 exist only in the cloud session (the proxy refused tag pushes, HTTP 403).

## Steps done this session
- 05/11 Imported the kit; baseline 1,401 of 1,401 checks.
- 05/11 Planner 1.2: targets from the Dietary Reference Intakes; protein RDA 0.8 g/kg adults (children, pregnancy 1.1, lactation 1.3), energy by EER; JS = Python on 454 cases; every target shown with its source.
- 05/11 Web app (index.html): home page, sign up / in / Google / demo (anonymous), "Keep my data", per-account files in Firestore through a virtual folder under store.js, live sync, practice backend, result-file bridge; firestore.rules (23 checks on the emulator).
- 05/11 Lab run 0 46/80, run 1 54/80 (phone tab bar, 44 px controls, instant estimate). Content on the phone starts at 67 px (was 338).
- 05/11 Privacy: neutral test values, history rewritten, publish check + pre-push hook (t_publish 22).
- 07/11 Pushed to main; owner added the Firebase config (f9b6af6) and switched Pages on.
- 08/11 Shopping list round (PR #1, merged): list open on every option with search name, pack, packs, price, sale (% off, until <date> or "not known"), link and a backup (+CZK, +g protein); Copy shopping list; picks shown once with all labels; planner 1.3 (rankProducts, alternatives, backupLine, saleInfo, energy top-up); one product per food per shop; 5 products per search term; sale fields per source; online orders without leaflet prices; minimum order counted; RUN-STEPS F2 Košík/Tesco basket; demo calorie gap closed (1,445 -> 3,504 to 3,550 kcal a day); 12 real Rohlík products read 08/11 in the demo. Tests: 711 twin cases, t_list 21, t_web 60 / 62.

## Decisions taken
- Owner: DRI targets, no fixed protein minimum; HelloDorm pattern; public repo, nothing private in git, publish check before every push; the shopping list is the result; the run compares products and keeps a backup; baskets filled, never paid; commits carry only the Co-Authored-By line.
- Session: DRI 2005 report for energy too (2023 update not reachable); a virtual folder so save rules and FORMATS stay unchanged; Firebase SDK vendored (no CDN); merge, not rebase, onto the repo's Initial commit; publish check skips commits already on the remote.
- Session (08/11): energy top-up only once protein is covered; t_cook's 40 % check reworded to that rule (stated in PR #1); backups only within the same way of buying; demo keeps honest read dates (19/10 rows flagged old).

## Where it stopped
PR #1 merged and live; no open branch work. Hand-over written on request.

## Next
1. Demo accounts made before a seed change keep their old data (the seed is written once, at first demo sign-in). Add a seed version to app/demo/seed.json and to the account; when it differs and the account is still a demo, reseed (ask first if the person changed anything).
2. Shopping list total shows the sum without cards (630.06 CZK) while the card says you pay 579.46: the list total should use cost_with_card where a card applies, or show both.
3. A raw file path shows on the result page (owner and Lab scorer saw it): find the string (likely a note or the "maths check" line) and say it in plain words.
4. Tesco and Košík demo rows (read 19/10) have no backups or sale dates: re-read them in a laptop run (5 per term) and rebuild the seed, or say so on those cards.
5. Confirm on the first live laptop run: RUN-STEPS D8 (Košík/Tesco sale field names in kosik.js / tesco.js) and F2 (basket button names); fix what differs.
6. Lab: run a (one of the above), b or c, as the owner chooses.
7. DRI numbers were never re-checked against the NCBI table (site blocked here): check once.

## Owner steps
- None open. Done on 08/11: the 3 @example.test test accounts deleted from Firebase. One anonymous demo account from 08/11 may stay (harmless).
- First laptop run after this: watch the run log for D8 / F2 notes.

## Lessons
- 08/11 Tests ran against the LIVE Firebase project -> the committed config switched index.html to it and the tests did not force the practice backend -> t_web and LAB/capture.mjs force practice mode and refuse every request to Google; t_web fails if one is tried.
- 08/11 Calorie gap in every plan -> the 40 % cap took the smaller of protein and energy share, harmless with 1.6 g/kg, fatal with DRI protein -> second pass for energy foods once protein is covered; when a target formula changes, rerun a real plan, not only the twins.
- 08/11 An open list showed old defects a folded box hid (leaflet price in an online order, placeholder ids 1111/2222 as links, "+0.00 CZK") -> showing data is a review -> look at every row of the new screen with real data before the PR.
- 08/11 A test flaked 1 in 6 on old code too -> a file written to private browser storage was not finished before the reload -> helpers read the file back before going on.
- 07/11 The emulator wrote firestore-debug.log into the repo and it was committed -> generated files need a .gitignore line before the first run -> ignored now; check `git status` for new files before every commit.
- 05/11 A history rewrite deleted ignored screenshots from disk -> checkout removes files tracked before and not after -> back up first.
- 05/11 Network blocked NCBI, NAP, Firebase docs and design galleries -> say so, mark values unverified, use what answers (npm, the Rohlík connector, Apple HIG).

## New terms explained
- DRI / RDA / EER: official intake tables; the protein amount covering 97 to 98 of 100 healthy people; the equation for the kcal that keep weight stable.
- Energy top-up: the planner's second pass that lets oats, rice or lentils fill the calories once protein is covered.
- Backup product: the next-best product of the same food in the same shop, in stock, bought the same way, with its price and protein difference.
- Sale end (sale_until): the last day of a sale as the shop gave it; empty when the shop does not say.
- Practice backend: the app's stand-in for Firebase that keeps everything in one browser; used by tests.
- Pre-push hook: a script git runs before every push; here it runs the publish check.

## Files changed
New: index.html, app/js/web.js, app/js/cloud/vfs.js, app/js/cloud/backends.js, app/js/firebase-config.js, app/css/web.css, app/vendor/firebase/*, app/demo/seed.json, tools/make_demo_seed.py, firestore.rules, firebase.json, README.md, FIREBASE-SETUP.md, tests/t_web.mjs, t_rules.mjs, t_publish.py, t_list.py, pw.mjs, run_all.sh, tests/fixtures/cook/rohlik-2026-11-08.tsv, LAB/*, STATUS.md, HAND-OVER.md.
Changed: app/js/planner.js, tools/planner.py, app/js/app.js, store.js, i18n.js, app/css/app.css, tools/cook.py, foods.py, make-share-copy.py, tools/browser/kosik.js, tesco.js, steps/RUN-STEPS.md, FORMATS.md, HOW-IT-WORKS.md, START-HERE.md, tests (t_formulas, make_fixtures, formulas.json, t_app, t_shops, t_cook, t_dine, fixtures).

## Privacy check
- Names (the friend, the Rohlík display name), machine name, account e-mails: NONE in any file or commit (publish check OK on every push).
- Scheduled-task ids, session ids: NONE.
- Secrets: NONE. The Firebase web config in app/js/firebase-config.js is public by design; the rules protect the data.
- Kept on purpose: public place names "Blanice kolej" and "Westfield Chodov" in fixtures, cards and the demo; the 08/11 Rohlík fixture shows the reading account's "-10 % pro vás" price (no name, no account data).
