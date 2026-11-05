# Meal Planner

Plan meals to a goal and a budget. Daily protein and energy targets come from the Dietary Reference Intakes (DRI) for each person's age, sex, weight, pregnancy or breastfeeding; plans compare cooking at home, ordering online and eating out across the shops near a saved place, with and without loyalty cards. English and Czech, prices in CZK.

**Open it:** https://daklod48.github.io/meal-planner/ (live once `FIREBASE-SETUP.md` steps 1 to 7 are done). The link lands on a home page with **Try the demo account**, **Sign up** and **Sign in**; each account's profile, plans, weigh-ins and settings are saved in Firestore, so phone and laptop show the same data.

Not medical advice.

## Two ways to run the same app
| | Web app | Folder app (unchanged) |
|---|---|---|
| Open | `index.html` (the published link) | double-click `app/MealPlanner.html` in Chrome or Edge |
| Data | the signed-in account, in Firestore (or this browser only, in practice mode) | files in `MealPlanner/data/` on the laptop |
| Prices from shops | add the result file of a Claude run (Settings > Prices from Claude's runs) | Claude's scheduled task writes results into the folder |
| For | friends, phone and laptop | the owner's laptop with Claude's tasks |

Both use the same screens (`app/js/app.js`), maths (`app/js/planner.js`, twin of `tools/planner.py`) and file formats (`FORMATS.md`).

## Files
- `index.html` the web app page; `app/js/web.js` home page and accounts; `app/js/cloud/vfs.js` a virtual folder over the account's files; `app/js/cloud/backends.js` Firebase or practice backend; `app/js/firebase-config.js` the Firebase config (placeholder until step 6); `app/vendor/firebase/` the Firebase SDK 12.19.0 (no CDN needed).
- `firestore.rules` security rules; `firebase.json` emulator ports for the tests.
- `app/demo/seed.json` the demo account's sample data, made by `python3 tools/make_demo_seed.py` from a real `tools/cook.py` run on shop rows read on 19/10/2026.
- Everything else is the kit as before: `START-HERE.md`, `SETUP-FOR-CLAUDE.md`, `HOW-IT-WORKS.md` (section 8 is the web app), `FORMATS.md`, `steps/`, `cards/`, `tools/`, `tests/`.

## Run it on your computer
```
python3 -m http.server 8000
```
then open http://localhost:8000/. Without a Firebase config it runs in practice mode.

## Tests
`sh tests/run_all.sh` runs every suite (about 3 minutes). The Firebase suites need the emulators: see `tests/README.md`.

## Set up Firebase and GitHub Pages
`FIREBASE-SETUP.md`, click by click.

## Before every publish (public repository)
The repository is public and GitHub publishes its whole history. Run once per clone:
```
python3 tools/make-share-copy.py --install-hook
```
From then on every `git push` first runs `python3 tools/make-share-copy.py --check-publish` and is refused if any commit, old or new, holds a `_PAST-WORK` or `data/` file, a word from your local `data/share-forbid.txt` (names, account names, machine name; accents and case ignored), a scheduled-task id, a session id, a private key, or an e-mail address outside the test domains. `data/` and `_PAST-WORK/` are git-ignored and stay on your computer.

## Licence notes
App code: the owner's. `app/vendor/firebase/`: Apache License 2.0 (Google LLC).
