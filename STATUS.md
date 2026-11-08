# STATUS (2026-11-08)
- State: shopping list round done on branch `shopping-list`, pull request open against main (see below); main itself unchanged since 98e201d.
- Live link: https://daklod48.github.io/meal-planner/ (Pages and Firebase live since 07/11; this round goes live when the PR is merged).
- Lab score: run 0 46/80, run 1 54/80 (kept). This round was owner feedback, not a Lab run.
- Tests: all pass on the branch: 1,401 original checks (one t_cook check reworded to the new 40 % rule), t_list 21 (new), t_web 60 / 62 emulators, t_rules 23, t_publish 22; publish check OK.
- Owner step 1: review and merge the PR (laptop chat), then look at the live demo: Requests and results > the result > the Rohlík card under "The other options".
- Owner step 2 (cleanup, 2 min): a test run on 08/11 reached the LIVE Firebase project before a guard existed. Firebase console > Authentication > Users: delete the 3 users whose e-mail ends in @example.test (created 8 Nov 2026), then Firestore Database > Data > spaces: delete the documents named by their User UIDs. One anonymous demo account from that afternoon is mine too; it looks like any visitor's demo, so leaving it is fine (it costs nothing). Nothing personal; guard now in place.
- Owner step 3: on the first real laptop run, check RUN-STEPS D8 and F2 (Košík/Tesco sale field names and basket button names were written without access to those sites).
- Next: lab run a, b or c as the owner chooses.
