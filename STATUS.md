# STATUS (2026-11-07)
- State: code pushed to the public repo https://github.com/daklod48/meal-planner (branch main); app runs in practice mode until the Firebase config is pasted.
- Last commit: this one, "STATUS: pushed, Pages pending" (before it: merge d6fe5e4 with the repo's Initial commit; 11818bb included).
- Live link: https://daklod48.github.io/meal-planner/ NOT live yet: GitHub Pages is not switched on (the session's proxy refuses the Pages API); not checkable from here (github.io blocked).
- Lab score: run 0 46/80, run 1 54/80 (kept). Tags lab-run-00 / lab-run-01 exist locally only (the proxy refuses tag pushes, HTTP 403).
- Tests: all pass (1,401 original + t_web 49 / 51, t_rules 23, t_publish 22); publish check OK before the push (16 commits).
- Owner steps: (1) repo Settings > Pages > Source: Deploy from a branch > Branch: main, folder / (root) > Save; (2) FIREBASE-SETUP.md steps 1 to 6; (3) add your e-mail and Windows user name to the local data/share-forbid.txt.
- Next: after (1), open the link on phone and laptop (FIREBASE-SETUP.md step 8); after (2), paste the config and push; then lab run a, b or c.
