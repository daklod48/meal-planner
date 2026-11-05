# SETUP-FOR-CLAUDE.md. How to set the Meal Planner up on a new computer

_For the Claude that reads this in a Cowork chat (Claude desktop app) with the `MealPlanner` folder attached, after the person typed "read SETUP-FOR-CLAUDE.md and set me up". Version 1.0, 2026-10-19 (plan 0010, session 5). Written for Windows; on a Mac the paths differ, the steps do not._

You are setting up a kit someone else built. Read ONLY this file and `START-HERE.md` first; open `steps/RUN-STEPS.md`, `steps/PRICE-WATCH-STEPS.md`, `FORMATS.md` and `cards/*.md` only when a step below sends you there. Never read or copy anything under `data/` (that is the person's private data). Answer in the language the person writes in (English or Czech); the trigger sentence is English, so if START-HERE's Czech part sent them, they may add "česky": then Czech. Tell them what you are doing in one line per step; ask only when a step truly cannot be decided from the files.

## 0. What the kit is (so you can explain it)
An HTML app (`app/MealPlanner.html`) the person opens in Chrome or Edge, two scheduled tasks you create, and helper scripts (`tools/*.py`). The app writes requests into `data/requests/`; the task "Meal Planner run" reads the shops (Rohlík connector, Claude in Chrome), computes options with `tools/planner.py` (the same maths as the app), fills a cart, never pays, and writes `data/results/`. The task "Meal Planner price watch" re-reads Rohlík prices every night and writes `data/updates/`. The whole thing is described for the person in `START-HERE.md`.

## 1. Find the folder (two spellings of one path)
1. `device_list_dir` on the connected folder. The connected folder is either `MealPlanner` itself or a folder that holds it. Find the folder that contains `app/MealPlanner.html`, `steps/`, `tools/`. Call its Windows path **FOLDER_WIN** (for example `C:\Users\Jana\Documents\MealPlanner`).
2. In `device_bash` the connected folder is mounted under `$HOME/mnt/<name of the connected folder>`. Run `ls "$HOME/mnt/"` and `ls "$HOME/mnt/<name>"` until you can `cd` into the MealPlanner folder; call that path **FOLDER_BASH** (for example `$HOME/mnt/MealPlanner`). Check: `cd "<FOLDER_BASH>" && ls app steps tools cards` lists the files.
3. Every `device_bash` call is a fresh shell: start each one with `cd "<FOLDER_BASH>"`.
4. Check the zip arrived whole: `cd "<FOLDER_BASH>" && sha256sum -c SHA256SUMS.txt | grep -v ': OK' ; echo checked` (prints only `checked` when every file matches; a `FAILED` line = tell the person to unzip again).
No `device_bash` but an ordinary shell (Claude Code, a Mac terminal, a cloud session with the folder copied in): the same steps with that shell; FOLDER_BASH is simply the folder's path, and FOLDER_WIN is that same path in the computer's own spelling (on a Mac there is no backslash path: use the POSIX path in both places of the task prompts). No shell at all, or the folder not connected: say so, tell the person to open this chat in the Claude desktop app with the `MealPlanner` folder attached ("Add folder"), and stop.

## 2. Check what is connected (read only, nothing changed)
| Check | How | If it fails |
|---|---|---|
| Python on the computer | `cd "<FOLDER_BASH>" && python3 --version && python3 tools/planner.py --help \| head -3` | Say that the scripts need Python 3.10 or newer in Claude's shell; the app alone still works, the tasks do not. |
| Node (tests only) | `node --version` | Not needed to run; only the `tests/*.mjs` checks need it (t_formulas, t_words, t_contrast). Skip them without Node. |
| Rohlík connector | the tool `mcp__rohlik__get_user_info` exists; call it once (do not write the answer anywhere: it holds the name, e-mail and address). During setup this is the ONLY Rohlík tool you call: never load or call cart, order, shopping-list, scheduled-task or credit tools of that connector. Do not open the Rohlík docs page yourself. | Tell the person: Claude app > Settings > Connectors > Add custom connector, name "Rohlík", URL `https://mcp.rohlik.cz/mcp`, sign in (https://www.rohlik.cz/mcp-docs). Without it: Cook plans use Košík, Tesco and leaflets; no cart; the price watch has nothing to read. |
| Claude in Chrome | the tools `mcp__claude-in-chrome__*` exist; `tabs_context_mcp` answers | Tell the person: install the "Claude in Chrome" extension and sign in to it; the run task reads Košík, Tesco, kupi.cz, Wolt, foodora and Google Maps in Chrome. Without it: only Rohlík prices. |
| Scheduling | the tool `mcp__claude-code-remote__create_trigger` (or another create-scheduled-task tool) exists, and `list_triggers` | Say the tasks cannot be created from this chat; the person can still run plans by typing "meal planner, run" in a chat (section 7). |
| Time zone | `TZ=Europe/Prague date -Iseconds` | Only to show the person the clock the logs use. |
Write down which checks passed; the final report (section 8) repeats them.

## 3. Create the data folders
```
cd "<FOLDER_BASH>" && mkdir -p data/users data/requests data/results data/updates data/foods data/shops data/runs && ls data
```
`data/foods/foods.json` must exist before the first run: `[ -f data/foods/foods.json ] || printf '{"version": 1, "updated": null, "items": []}\n' > data/foods/foods.json`. The app creates `data/app-settings.json` and `data/users/<id>/` itself when the person makes a profile. Never create a profile for the person.
If `data/shops/shops.json` already exists, the sender included their shop survey (places named inside it: `python3 -c "import json;print(list(json.load(open('data/shops/shops.json'))['locations']))"`); tell the person which places are ready. If it does not exist, every place the person saves needs a survey first (section 6).

## 4. Prove the scripts work here (3 minutes)
```
cd "<FOLDER_BASH>" && python3 tests/t_foods.py && python3 tests/t_cook.py && python3 tests/t_dine.py && python3 tests/t_watch.py
```
Each ends with one line saying it passed: `PASS 21 foods.py checks`, `PASS 55 cook.py checks`, `321 checks, 0 failed`, `PASS 38 watch.py checks` (counts of 19/10/2026; more is fine, a FAIL line is not). With Node: `node tests/t_formulas.mjs` (324 cases, proves the app's maths equals the Python maths). The browser tests (`tests/t_app.mjs`, `t_shops.mjs`) need Playwright and are NOT run here. A FAIL = stop, show the person the failing line, do not create the tasks.
The tests work on temporary copies made from `tests/fixtures/` (they do not need `data/shops/shops.json` and never read or write `data/`). Running them leaves `tools/__pycache__/` behind (Python's compiled cache: harmless, never sent).

## 5. Create the two scheduled tasks
First `list_triggers` (limit 20, no large limit: every task's whole prompt comes back). If `Meal Planner run` or `Meal Planner price watch` already exists, keep it, report its id, and create only the missing one. Then `create_trigger`. Replace `<FOLDER_WIN>` and `<FOLDER_BASH>` in the prompts with the real paths from section 1, nothing else. Both tasks: `requires_local_device: true` (they need this computer's browser and connector), push notifications on (`notifications: {"push": true}`), `initiation: human_request`, no `permission_mode` (the server chooses; say in the report which mode the result's `derived_state.permission_mode` shows: `auto` = runs go ahead alone, which these tasks need, since nobody is there at 22:10). The tool result ends with a line saying whether the task is bound to this computer; when that line is missing, tell the person to switch **"Require this computer"** on for each task in the Claude desktop app (Scheduled > the task > settings), otherwise the task runs in the cloud without the folder and does nothing useful. You cannot see that switch from here: ask the person to confirm it.

**Task 1, name exactly `Meal Planner run`, NO schedule (no cron, no run-once: it is started by "Run now" in the Claude app or fired from a chat), prompt:**
```
You are the Meal Planner run (plan 0010). Read the file <FOLDER_WIN>\steps\RUN-STEPS.md (in device_bash: "<FOLDER_BASH>/steps/RUN-STEPS.md"; if no folder is connected, request access to <FOLDER_WIN> once) and follow it exactly. FOLDER = <FOLDER_WIN>, mounted in device_bash as <FOLDER_BASH>. One request per run, the oldest waiting. Fill a cart, never pay, never check out, never sign in, never ask the person anything (the one allowed request is the folder access above). Your final message is the phone notification: at most 4 lines as section K of that file says.
```
**Task 2, name exactly `Meal Planner price watch`, cron `CRON_TZ=Europe/Prague 10 22 * * *` (every day 22:10 Prague), prompt:**
```
You are the Meal Planner price watch (plan 0010). Read the file <FOLDER_WIN>\steps\PRICE-WATCH-STEPS.md (in device_bash: "<FOLDER_BASH>/steps/PRICE-WATCH-STEPS.md"; if no folder is connected, request access to <FOLDER_WIN> once) and follow it exactly. FOLDER = <FOLDER_WIN>, mounted in device_bash as <FOLDER_BASH>. Rohlík connector only (get_user_info, get_product_details), read only, no browser, no cart, no question to anyone. Your final message is the phone notification: at most 3 lines, line 1 word for word the "message" field printed by tools/watch.py ingest.
```
Keep the two task ids the tool returns and write them into the final report. Never create a third task, never give a task a schedule other than the one above, never put the person's name, e-mail or address into a prompt. If a task of that name already exists (the person set up before), do not create a second one: say so.

## 6. Places and the shop survey (what costs time)
The run plans only for a place that is in `data/shops/shops.json` (Cook) or `data/shops/restaurants.json` (Eat out). A survey is made ONCE per place and kept (shops, walking minutes, opening hours; prices are never stored there). When the person says **"meal planner, survey <place>"** in a chat: follow `cards/google-maps.md` (Google Maps in Claude in Chrome, every food shop within 30 minutes on foot, the nearest store of every chain, delivery services: about 30 to 60 minutes of browser reads for one place), write the raw rows, then build the file with a copy of `tools/build_shops.py` changed for that place (the file explains itself), and finish with `python3 -c "import json;json.load(open('data/shops/shops.json'))"` (the browser test `tests/t_shops.mjs` runs only where Playwright is installed, normally not on the person's computer). For **"meal planner, survey restaurants for <place>"**: section Restaurants of the same card, then `python3 tools/dine.py survey "<place>" --tsv <raw.tsv> --walk-col walk_X --m-col m_X` (X = the letter you gave the place in the raw table's column names, for example `walk_B` and `m_B`; `dine.py --help` shows the columns). The place name must be spelled exactly as the person saved it in the app (Profile > Places). Tell the person the cost before starting, and that it is done once.

## 7. First plan, and plans without the task
When the person has made a profile and pressed "Send to Claude" in the app, the request waits in `data/requests/`. Two ways to run it:
- Claude desktop app > Scheduled > "Meal Planner run" > **Run now** (the normal way).
- Or the person types **"meal planner, run"** in a chat with the folder attached: then YOU follow `steps/RUN-STEPS.md` in this chat, step by step, with the same tools and the same hard limits (fill a cart, never pay). Do not try to fire the task from the chat (`fire_trigger`): on 19/10/2026 the permission check refused it; following the steps in the chat works.
Likewise **"meal planner, price watch now"** = follow `steps/PRICE-WATCH-STEPS.md` here. **"meal planner, make share copy"** = `python3 tools/make-share-copy.py` (add `--with-shops` only if the person says the receiver lives near the same places) and hand over the zip path it prints.

## 8. Final report to the person (plain words, their language)
1. What is ready: folder path, Python ok, which connectors and the extension are connected, tests passed (numbers), the two tasks with their ids and whether "Require this computer" is on.
2. What is missing and the exact click path to fix it (from the table in section 2).
3. Which places are surveyed (or that none is, and the survey command with its cost).
4. Next steps for the person, copied from START-HERE.md "Setup in 5 steps" (Czech: "Nastavení v 5 krocích"), points 4 and 5, in their language.
5. One line: nothing was paid, ordered or signed in; `data/` was not read.
