# Improvement Lab runs: Meal Planner web app

Rubric: `LAB/RUBRIC.md` (frozen 2026-11-05). Captures: `LAB/captures/run-NN/` (made by `LAB/capture.mjs`). Data: `LAB/runs.json`. Tracker: open `LAB/tracker.html` by double-click.

## Run 0, 2026-11-05: baseline, 46 / 80
Beauty 6, clarity 5, flow 5, trust 7, mobile 4, speed 9, accessibility 4, delight 6. Scored by an independent subagent that saw only the captures, metrics.json and the rubric.
Measured: home usable in 123 ms, demo open in 359 ms, 456 kB on the phone, 0 console errors, no sideways scroll; on the phone the content starts 338 px down on every signed-in screen; controls under 44 px: 49 on profile edit, 34 on History, 22 on Result.
Top flaws: (1) phone header plus a 3-row tab bar take 40 % of the screen, small targets; (2) phone Result table squeezed and cut off, picks buried under notes; (3) a plan dead-ends in Settings (file bridge); the demo result says "Done 21. 11. 2026", after today (a real defect: `cook.py result` stamps the real time, and the demo then moves it forward again).
