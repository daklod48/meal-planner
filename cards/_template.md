# <Chain name> (card key: `<chain>`)

_Card written <YYYY-MM-DD> (session N). Every fact has its date and source; a fact older than 30 days is checked again before it is used in a plan._

## 1. In one line
What the chain is, and the one thing a planner must know about it (for example "leaflet prices only, no nutrition online").

## 2. Where it is near the saved places
Rows in `data/shops/shops.json` (ids), with walking band and tram/bus minutes. Do not repeat the whole table; name the nearest store for each place.

## 3. Prices online
- **What is published:** full shop / weekly leaflet / nothing.
- **Where:** exact URL pattern (search page, product page, leaflet page).
- **How to read one price, step by step:** what to open, what to type, which text holds the price, the per-kg price, the validity dates.
- **Price label to write into foods.json:** `online` (shop website), `leaflet` (weekly offer), `cart` (seen in a cart), `last_known`.

## 4. Loyalty price
- Card key in the profile (`rohlik-xtra`, `billa-club`, `kaufland-card`, `lidl-plus`, `albert`, `penny`, `tesco-clubcard`, or `other-...`).
- How the card price is shown and when it applies. A card price is used only when the person ticked that card.
- Cost of the card (free app, paid subscription).

## 5. Nutrition
Where the nutrition table is (tab name, section), or "not published": then use a food table value and label it `table`.

## 6. Delivery or pickup
Service, fee, minimum order, delivery minutes for each saved place, date seen. "Read in the cart" when the site shows it only there.

## 7. Cart (session 3)
Can Claude fill a cart here (connector, Chrome, none)? Account check: the account name on the page must equal the profile's account name; stop if not. Never pay.

## 8. Pitfalls
Wrong products the search returns, weight-priced items, prices that differ between the web and the shelf, leaflet validity.

## 9. Test read
| Date and time (Prague) | Product | Pack | Price | Card price | Protein / kcal per 100 g | Label | URL |
|---|---|---|---|---|---|---|---|

## 10. Sources (APA 7)
Author. (Year). *Title*. Site. Retrieved Month DD, YYYY, from URL
