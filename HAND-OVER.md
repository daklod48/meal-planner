# HAND-OVER: Meal Planner web app (T3b), 2026-11-06

## Where the work lives
- Local git repository: `/home/user/meal-planner` (Claude cloud session), branch `main`, tags `lab-run-00`, `lab-run-01`. No remote yet; nothing pushed.
- Delivered zip (repo with history, without `data/`): `/tmp/claude-0/-home-user/1d15edc8-110b-5bbb-ae47-6f287537ea8f/scratchpad/deliver/meal-planner-web-2026-11-05.zip` (15.7 MB, made 2026-11-05 at commit 7e46543, so without this file).
- Local only, never committed: `data/share-forbid.txt` (private words for the publish check), `/home/user/_PAST-WORK-meal-planner/` (owner's notes), `LAB/captures/run-NN/*.png` (screenshots; `metrics.json` per run is committed).
- Target: public repo `daklod48/meal-planner`, GitHub Pages at https://daklod48.github.io/meal-planner/.

## Steps done this session
- 2026-11-05 Imported the kit as received; baseline 1,401 of 1,401 checks pass (t_formulas 324, t_words 444, t_contrast 40, t_foods 23, t_cook 59, t_dine 321, t_watch 38, t_app 111, t_shops 41).
- 2026-11-05 Planner 1.2: daily targets from the Dietary Reference Intakes (DRI); protein RDA 1.05 / 0.95 / 0.95 / 0.85 / 0.8 g per kg by age, pregnancy 1.1, lactation 1.3; energy by the EER equations with pregnancy +0/340/452 and lactation +330/400 kcal. Twins JS = Python on 454 cases (324 old byte-identical + 130 new), 5 hand sums (e.g. man 23 y, 178 cm, 68.4 kg, active: 3,003.73 kcal).
- 2026-11-05 Profile: pregnancy or breastfeeding fields, own protein per kg optional, every target shown with rule, numbers and source link.
- 2026-11-05 Web app `index.html`: home page, sign up / sign in / Google / demo (anonymous) account, "Keep my data", per-account files in Firestore via a virtual folder under `store.js`, live sync between devices, practice backend until the config is pasted, result-file bridge for Claude's runs.
- 2026-11-05 `firestore.rules`: own space only, fixed record shape; 23 checks on the Firestore emulator; loosened rules fail 10.
- 2026-11-05 Demo seed from a real `cook.py` run on the 19/10 shop rows: 8 options, targets 58.9 g / 3,545 kcal.
- 2026-11-05 Tests t_web: 41 practice / 43 emulators at first, later 49 / 51; Firebase SDK 12.19.0 vendored (no CDN).
- 2026-11-05 Docs: FIREBASE-SETUP.md (click by click), README.md, HOW-IT-WORKS 8.1 to 8.5, tests/README.md, FORMATS.md, START-HERE.md.
- 2026-11-05 Lab run 0: 46 / 80 (independent scorer). Lab run 1: 54 / 80, kept: phone content starts at 67 px (was 338), phone controls under 44 px on profile edit 7 (was 49), instant estimate (demo: Košík.cz 703 CZK for 3 days), demo dates fixed; code +7.2 %.
- 2026-11-05 Privacy: neutral test values (`demo-user`, `@example.test`), git history rewritten with the same replacements, capture PNGs taken out of git (repo .git 35 MB -> under 1 MB); `make-share-copy.py --check-publish` and `--install-hook`; t_publish 22 checks (accent folding removed: 2 fail). Publish check OK: 13 commits, 149 files.
- 2026-11-06 STATUS.md and this file.

## Decisions taken
- Owner: no fixed protein minimum; DRI targets from the profile; HelloDorm pattern (home page, sign in / up / demo, Firestore); no secrets in code; public repo, `_PAST-WORK` local only, neutral test values, an automatic check before every publish; do not push until told the repo exists.
- Session: DRI 2005 report for energy as well as protein (same source; the 2023 energy update not used, not verifiable here); unset activity counts as low active (same as the old 1.53 default); own g/kg allowed above or below the DRI with a warning below.
- Session: a virtual folder instead of rewriting `store.js`, so save rules and FORMATS.md stay unchanged; one Firestore record per file.
- Session: demo = Firebase anonymous account, needs the Anonymous provider.
- Session: Claude's runs stay on the laptop; web accounts get results through a download / upload bridge (a direct link would need a service-account key, a real secret).
- Session: Firebase SDK copied from npm into `app/vendor/firebase/` (gstatic blocked; no CDN dependency).
- Session: no artifact or link published (owner rule: nothing published without a yes); previews given as files.

## Where it stopped
All work committed locally on `main`; working tree clean; waiting for the owner to create `daklod48/meal-planner`. Lab stopped after run 1 as asked.

## Next
1. When told the repo exists: `git remote add origin` the repo, `python3 tools/make-share-copy.py --check-publish` (must be OK), push `main` and the tags; the pre-push hook repeats the check.
2. Owner pastes the Firebase config (or gives it to Claude), Claude commits and pushes it; check the live link (FIREBASE-SETUP.md step 8).
3. Re-check the DRI numbers against the NCBI table and the IOM 2005 report once a network that reaches them is available.
4. Lab run a (recommended): the demo result's picks are more than 10 % short on calories and its notes show a raw file path.

## Owner steps
- GitHub: https://github.com/new > Owner `daklod48`, Repository name `meal-planner`, Public, no README, no .gitignore, no licence > Create repository. Then tell Claude.
- Firebase: FIREBASE-SETUP.md steps 1 to 6: project `meal-planner`; web app `meal-planner-web`; Authentication > Sign-in method: Email/Password, Google, Anonymous on; Authentication > Settings > Authorized domains: `daklod48.github.io`; Firestore: production mode, location `eur3`; Rules: paste `firestore.rules`, Publish; config into `app/js/firebase-config.js`.
- GitHub Pages: repo Settings > Pages > Deploy from a branch > `main` / `(root)` > Save.
- Local file `data/share-forbid.txt` (next to the repo on the laptop, never sent): add your e-mail address and Windows user name, one per line.
- Decide: keep the public place name "Blanice kolej" in fixtures, cards and the demo, or replace it with a neutral place.

## Lessons
- 2026-11-05 Network blocked NCBI, NAP, FAO, Firebase and GitHub docs and every design gallery -> the environment allows only GitHub, npm, PyPI, Apple HIG, Google storage -> entered DRI values from knowledge, marked "not re-checked" in app and docs, proved by paper sums; Firebase SDK from npm; emulators from Google storage.
- 2026-11-05 Demo result showed "Done 21. 11. 2026" on 5. 11. -> `cook.py result` and `foods.py` stamp the real clock, then the demo moved dates forward again -> the seed pins both to the run's own time.
- 2026-11-05 Firestore's first snapshot can come from an empty device cache -> a new phone would look empty for a moment -> wait for the server answer (5 s offline).
- 2026-11-05 Name in the header missing after sign up on Firebase only -> the account exists before its name is set -> tell the app again after the name is saved.
- 2026-11-05 `git filter-branch` deleted the ignored screenshots from disk -> files tracked in the old head and absent in the new one are removed on checkout -> back up untracked outputs before any history rewrite (they were restored from the backup).
- 2026-11-05 The publish check caught its own code twice (a docstring example with the friend's name, test strings with fake leaks) -> any text in the repo is published -> examples use the test person; planted test leaks are built from pieces.
- 2026-11-05 A test that "already passed" can hide order effects -> the badge check failed because an earlier step had opened the result -> reset the seen record inside the test.

## New terms explained
- DRI (Dietary Reference Intakes): official tables of how much of each nutrient healthy people need, by age, sex, pregnancy and breastfeeding.
- RDA (Recommended Dietary Allowance): the daily amount that covers 97 to 98 of 100 healthy people; adults 0.8 g protein per kg.
- EER (Estimated Energy Requirement): an equation from age, height, weight and activity giving the kcal that keep weight stable.
- Firestore: Google's online database; here one record per file of each account.
- Security rules: the database's gatekeeper; the public code cannot override them.
- Anonymous account: a real Firebase account without e-mail or password, used for the demo.
- Emulator: Google's database and login programs running on one computer for tests; nothing reaches Google.
- Virtual folder: an object that behaves like a folder for the app's save code but keeps the files in the account.
- Pre-push hook: a script git runs before every push; here it refuses a push that fails the publish check.
- Git history rewrite: changing old commits so text never published can no longer appear in them.

## Files changed
New: `index.html`, `app/js/web.js`, `app/js/cloud/vfs.js`, `app/js/cloud/backends.js`, `app/js/firebase-config.js`, `app/css/web.css`, `app/vendor/firebase/*`, `app/demo/seed.json`, `tools/make_demo_seed.py`, `firestore.rules`, `firebase.json`, `.nojekyll`, `.gitignore`, `README.md`, `FIREBASE-SETUP.md`, `tests/t_web.mjs`, `tests/t_rules.mjs`, `tests/t_publish.py`, `tests/pw.mjs`, `tests/run_all.sh`, `LAB/*` (RUBRIC, RUNS, runs.json, capture.mjs, make_tracker.py, tracker.html, captures/*/metrics.json), `STATUS.md`, `HAND-OVER.md`.
Changed: `app/js/planner.js`, `tools/planner.py`, `app/js/app.js`, `app/js/store.js`, `app/js/i18n.js` (608 keys), `app/css/app.css`, `tools/make-share-copy.py`, `tests/make_fixtures.py`, `tests/fixtures/formulas.json`, `tests/t_formulas.mjs`, `tests/t_app.mjs`, `tests/t_shops.mjs`, `tests/shots.mjs`, `tests/t_dine.py`, `tests/t_cook.py`, `tests/fixtures/dine/request-order.json`, `tests/README.md`, `HOW-IT-WORKS.md`, `FORMATS.md`, `START-HERE.md`.

## Privacy check
- Names (friend, Rohlík display name), machine name, account e-mails: NONE in any file or commit (publish check OK, 13 commits, 149 files; grep of the delivered zip: 0 hits).
- Scheduled-task ids, session ids: NONE.
- Secrets (passwords, private keys, service-account keys): NONE. The Firebase config is a placeholder (`null`); once filled it holds only public web values.
- Kept on purpose, flagged for the owner: the public place names "Blanice kolej" and "Westfield Chodov" in fixtures, cards and the demo.
