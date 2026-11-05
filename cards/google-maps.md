# Google Maps: how a place is surveyed (method card)

_Written 2026-10-19 (session 2). The first survey (Blanice kolej, Westfield Chodov) took about 2 hours, most of it page loads._

## When to survey (his rule, 19/10/2026)
- ONCE per saved place. The result lives in `data/shops/shops.json` and every later run only READS it.
- Again only when he asks: "meal planner, refresh shops for <place>".
- A place in a request that is not in `shops.json` yet: survey it first, then plan. Do not re-survey because of age; the app shows "Checked <date>".

## Keeping it fresh without a new survey (his question, 19/10/2026)
- Shop list, walk and tram/bus minutes: kept; they change a few times a year.
- Before a plan uses a shop in person, open THAT shop's Google page only: if it says "Permanently closed" or "Temporarily closed", drop it from the plan and set `closed_seen` with the date in shops.json; if the hours differ, update `hours`. Seconds per shop.
- Prices are never stored here: each run reads the prices of the foods it plans with (foods.json); the daily price watch re-reads active-plan and favourite foods.
- Delivery fee and minimum order: shown with their date as a guide; the cart decides.

## Steps (Chrome, Google Maps)
1. Find the place: `https://www.google.com/maps/search/<name>`; read the address and the plus code; decode the plus code to latitude and longitude (Prague prefix `9F2P`).
2. Collect candidates: `https://www.google.com/maps/search/<query>/@<lat>,<lng>,15z` for: supermarket, potraviny, grocery store, večerka, řeznictví, bio potraviny, asijské potraviny, farmářský trh, and each chain name (Albert, Billa, Lidl, Penny, Tesco, Kaufland, Globus, Norma, Žabka) at zoom 14 or 13. Scroll the result list to the end; skip "Sponsored". Keep name, category, coordinates (`!3d<lat>!4d<lng>` in each result link). Store them in the page's `localStorage` so a reload does not lose them.
3. Keep places within 2 km in a straight line, drop non-food categories (restaurant, café, bar, petrol station, office, park).
4. For each kept place open its Google page: name, category, address, website, weekly hours (the hours table).
5. Walking time from the place: `https://www.google.com/maps/dir/<lat,lng of place>/<lat,lng of shop>/data=!4m2!4m1!3e2`, first result "N min / X km".
6. Tram/bus time for chain stores more than 15 min away and for the nearest store of every chain: same URL with `/data=!4m6!4m5!2m3!6e0!7e2!8j<seconds>!3e3`, where `<seconds>` is a weekday 10:00 local time written as if it were UTC (Tuesday 20/10/2026 10:00 = 1792490400). Without it Google gives the night buses of the current hour.
7. Keep: every food shop within 30 min on foot; chain stores further away with their tram/bus time; the nearest store of every chain, including small chains (Žabka, Zeman). Bands: 10 min or less, 11-20, 21-30, over 30 (tram/bus).
8. Delivery services for the place: Rohlík connector `search_address`; Košík address check; Wolt and foodora shop lists for the address (cards wolt.md, foodora.md). Typing the address needs his yes once.
9. Write with `tools/build_shops.py` (the session 2 builder: copy it, change the places, survey files and delivery tables) or by hand to the format in FORMATS.md.
10. Also read the mall's or district's own shop list when one exists: Google missed two food shops inside Westfield Chodov that westfield.com lists (GURMETUM, MEZINÁRODNÍ POTRAVINY).

## Speed tips
Batch 7 to 9 page loads per browser call; read only the text needed; do not take screenshots except for leaflets that are pictures.

## Restaurants (Eat out, session 4, 19/10/2026)
Once per place, like shops ("meal planner, survey restaurants for <place>"); a run never surveys.
1. Google Maps searches around the place (`https://www.google.com/maps/search/<word>/@<lat>,<lng>,16z?hl=cs`, wait 4 s for the list): restaurace, jídelna, bistro, pizzerie, fast food, asian, lunch, kebab, jídlo, "restaurace Westfield Chodov". `tools/browser/gsurvey.js` `MPG.collect()` scrolls the list and keeps every place (name, coordinates, Google place id) in the page's localStorage; 212 places on 19/10.
2. Walking minutes and metres from the place to each of them in ONE request to the OpenStreetMap foot router (`routing.openstreetmap.de/routed-foot/table/v1/foot/...`, OSRM table service; Google gives no walking times in bulk). It walks a little faster than Google: Blanice kolej to Westfield Chodov 20.1 min (Google 23-25 min, survey of 19/10).
3. Food places only (shops, cafés without meals, bars without food, sweets, hotels, clubs, playgrounds left out by hand), up to 25 min: raw rows in `products/0004_2026-10-19_s4-order-eatout/raw_restaurants.tsv` (also `tests/fixtures/dine/raw_restaurants.tsv`); `python3 tools/dine.py survey "<place>" --tsv <raw> --walk-col walk_<X> --m-col m_<X>` writes `data/shops/restaurants.json` with a Google Maps link and a walking-route link per restaurant. Result 19/10: Blanice kolej 53 restaurants (10 within 15 min), Westfield Chodov 65 (44 within 15 min).
4. Daily-menu pages: the `menicka` column (see `cards/menicka.md`).

## Sources (APA 7)
- Google. (n.d.). *Google Maps*. Retrieved October 19, 2026, from https://www.google.com/maps
- routing.openstreetmap.de. (n.d.). *Open Source Routing Machine demo (car, bike, foot)*. Retrieved October 19, 2026, from https://routing.openstreetmap.de/
- Google. (n.d.). *Get started with Maps URLs*. Retrieved October 19, 2026, from https://developers.google.com/maps/documentation/urls/get-started
