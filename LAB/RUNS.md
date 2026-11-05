# Improvement Lab runs: Meal Planner web app

Rubric: `LAB/RUBRIC.md` (frozen 2026-11-05). Captures: `LAB/captures/run-NN/` (made by `LAB/capture.mjs`). Data: `LAB/runs.json`. Tracker: open `LAB/tracker.html` by double-click.

## Run 0, 2026-11-05: baseline, 46 / 80
Beauty 6, clarity 5, flow 5, trust 7, mobile 4, speed 9, accessibility 4, delight 6. Scored by an independent subagent that saw only the captures, metrics.json and the rubric.
Measured: home usable in 123 ms, demo open in 359 ms, 456 kB on the phone, 0 console errors, no sideways scroll; on the phone the content starts 338 px down on every signed-in screen; controls under 44 px: 49 on profile edit, 34 on History, 22 on Result.
Top flaws: (1) phone header plus a 3-row tab bar take 40 % of the screen, small targets; (2) phone Result table squeezed and cut off, picks buried under notes; (3) a plan dead-ends in Settings (file bridge); the demo result says "Done 21. 11. 2026", after today (a real defect: `cook.py result` stamps the real time, and the demo then moves it forward again).

## Run 1, 2026-11-05: phone shell, 44 px, instant estimate, 54 / 80 (KEEP, +8)
Beauty 6 (=), clarity 6 (+1), flow 5 (=), trust 8 (+1), mobile 6 (+2), speed 9 (=), accessibility 7 (+3), delight 7 (+1). Independent subagent, saw only the run-01 captures, metrics.json and the rubric.
Changed: one-row phone header; bottom tab bar of five (icons, short words, badge for results not opened); Foods, Shops and Sign out under Settings > More on the phone; phone controls at least 44 px; wide tables scroll in their card; demo dates pinned to the run's own time (fixes "Done 21. 11. 2026").
Innovation: the instant estimate in Cook mode (planner.js basket() per shop on prices already in the account; cheapest shop covering the targets, per day, cover, budget, list; labelled estimate; writes nothing).
References: Apple HIG Tab bars and Buttons (https://developer.apple.com/design/human-interface-guidelines/tab-bars, .../buttons), HelloDorm v2. Gallery sites blocked by the network.
Measured: content starts at 67 px on the phone (was 338); controls under 44 px on phone profile edit 7 (was 49); home 122 ms, demo 349 ms, 0 console errors. Code +7.2 %.
Tests: all pass (1,401 original; t_web 49 practice, 51 Firebase emulators; t_rules 23).
Top flaws now: (1) Result: all three picks short on calories, notes show a raw path; (2) real prices still need the file bridge; (3) "Being typed" bar and header still take space on some phone screens, profile name cut.
