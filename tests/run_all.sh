#!/bin/sh
# Runs every check from the repository root and prints one line per suite. Exit code 0 only if all pass.
# The Firebase checks (t_rules, t_web on the emulators) need MP_FBTOOLS: see tests/README.md.
export LC_ALL=C.UTF-8
fails=0
run() { label=$1; shift; out=$("$@" 2>&1); code=$?; echo "$out" | grep -E "^(PASS|FAIL|SKIP)|checks, [0-9]+ failed" | tail -1 | sed "s#^#$label: #"; [ $code -eq 0 ] || [ $code -eq 2 ] || fails=$((fails+1)); }
run t_formulas.mjs node tests/t_formulas.mjs
run t_words.mjs node tests/t_words.mjs
run t_contrast.mjs node tests/t_contrast.mjs
run t_foods.py python3 tests/t_foods.py
run t_cook.py python3 tests/t_cook.py
run t_dine.py python3 tests/t_dine.py
run t_watch.py python3 tests/t_watch.py
run t_app.mjs node tests/t_app.mjs
run t_shops.mjs node tests/t_shops.mjs
run t_web.mjs node tests/t_web.mjs
if [ -n "$MP_FBTOOLS" ]; then
  FB="$MP_FBTOOLS/node_modules/.bin/firebase emulators:exec --project demo-meal-planner"
  run t_rules.mjs sh -c "$FB --only firestore 'node tests/t_rules.mjs'"
  run t_web.mjs-firebase sh -c "MP_BACKEND=firebase $FB --only auth,firestore 'node tests/t_web.mjs'"
else
  echo "t_rules / t_web on Firebase: SKIP (set MP_FBTOOLS)"
fi
[ $fails -eq 0 ] && echo "ALL PASS" || echo "$fails suite(s) FAILED"
exit $fails
