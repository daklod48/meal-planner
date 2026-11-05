# Wolt (card key: `wolt`), grocery part

_Card written 2026-10-19 (session 2, groceries); restaurants (Order online and Eat out) added in session 4, same day, section R._

## 1. In one line
Delivery app that carries many chain stores as "venues" (Billa, Albert, Penny, Kaufland, Tesco, Delmart) plus its own Wolt Market; prices as text, delivery time, minimum order and fee per venue and address.

## 2. Venues that deliver to the saved places (19/10/2026 08:00-08:42, not logged in)
| Venue (slug) | Blanice kolej | Westfield Chodov | Minimum order | Fee shown |
|---|---|---|---|---|
| BILLA Křejpského (`billa-krejpskeho`) | 30-40 min | 30-40 min | 349 CZK | 0.00 CZK |
| Wolt Market Michle (`wolt-market-michle`) | 30-40 min | 25-35 min | 349 CZK | 0.00 CZK |
| Kaufland Praha-Michle (`kaufland-praha-michle`) | 75-85 min | 70-80 min | 349 CZK | 0.00 CZK |
| DELMART OC Chodov (`delmart-supermarket-oc-chodov`) | 30-40 min | 20-30 min | 500 CZK | 0.00 CZK |
| PENNY Zahradní Město (`penny-praha-zahradni-mesto`) | 55-65 min | 45-55 min | 299 CZK | 0.00 CZK |
| Albert Krejnická (`albert-krejnicka`) | Wolt said "closed, opens at 9:00" at 08:40 | not listed | 349 CZK | 0.00 CZK |
| Tesco Brandlova / Hypermarket Novodvorská / Expres Kunratice | Wolt said "closed, opens at 9:00" for each at 08:40 (Wolt's ordering hours; the stores themselves open at 07:00 on Google) | not listed | 349 / 349 / 250 CZK | 0.00 CZK |
| Tesco Hypermarket Eden (`tesco-hypermarket-praha-eden`) | not listed | 55-65 min | 349 CZK | 0.00 CZK |
Also listed but not read: Žabka, ZEMAN maso-uzeniny (Kunratice and Chodov), Náš Kraj Metro Háje, small markets.

The 0.00 CZK fee was shown while not logged in, next to a "Delivery fee 0 CZK" offer on the Billa page: treat it as a promotion; the cart decides.

## 3. Prices online
- Venue page: `https://wolt.com/cs/cze/prague/venue/<slug>`; category pages `/items/<category-slug>` (for example Billa's tvaroh category `tvaroh-pomazanky-26`). Tiles: price, old price, pack, CZK per kg, "N left".
- The venue search box and some clicks open a LOGIN pop-up and once jumped to a Google sign-in page: close the pop-up (X), never sign in, browse categories instead.
- Long category lists are virtual: read the text before scrolling far, or open a smaller sub-category.
- Label `online`, shop key `wolt-<chain>` (for example `wolt-billa`): Wolt prices can differ from the shelf.

## 4. Loyalty price
Store loyalty cards do not apply on Wolt. Wolt+ (subscription) exists; not checked.

## 5. Nutrition
Not on tiles. Use the product's label from an online shop (`exact`, source named) or a food table.

## 6. Delivery
Per venue above; "Open until" on the venue header (for example Wolt Market until 24:00, Kaufland until 19:30 on 19/10).

## 7. Cart
His Wolt account, session 4; account check by the name in the profile menu.

## 8. Pitfalls
The address must be set first (top-left place button); it is stored by Wolt in his Chrome. Closed venues show no delivery time.

## 9. Test reads
| Date (Prague) | Venue | Product | Pack | Price | Label | URL |
|---|---|---|---|---|---|---|
| 19/10/2026 about 08:30 | BILLA Křejpského | Bohemilk Opočno Olešnický tvaroh měkký | 300 g | 41.90 CZK (was 64.90) | online | https://wolt.com/cs/cze/prague/venue/billa-krejpskeho/items/tvaroh-pomazanky-26 |
| 19/10/2026 about 08:40 | Wolt Market Michle | Vilgain ovesný nápoj BIO | 1 l | 54.90 CZK | online | https://wolt.com/cs/cze/prague/venue/wolt-market-michle |

## R. Restaurants (session 4, read 19/10/2026 11:40-11:45, not logged in)
- **List**: the site's own data `consumer-api.wolt.com/v1/pages/restaurants?lat=<lat>&lon=<lng>` (used by wolt.com): 231 venues for Blanice kolej, each with name, slug, location, `estimate_range` ("15-25") and `online` (false = closed now).
- **Menu**: `consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/<slug>/assortment?language=cs`: every item with name, price in hellers (2900 = 29.00 CZK), `unit_info` (weight, often empty) and description. 181 menus read in 99 s (2 at a time; Wolt answers "too many requests" if faster), 9,371 items, 3,349 of them estimated as a main dish.
- **Fee, minimum, time, hours**: `consumer-api.wolt.com/order-xp/web/v1/venue/slug/<slug>/dynamic/?lat=..&lon=..&selected_delivery_method=homedelivery`: `DELIVERY_FEE` (0.00 CZK at every venue while not logged in: a promotion or the Wolt+ offer, the basket decides), `ORDER_MINIMUM` (140 CZK at most restaurants, 149 Burger King), delivery estimate (McDonald's Chodov 20-30 min), "Open until 21:45".
- **Reader**: `tools/browser/readers.js`, source `wolt` (order mode: venues with delivery up to the request's limit, open now, best 20 by protein per CZK; eat-out mode: only the surveyed restaurants within the walk limit that are on Wolt, matched by place within 150 m and a shared name word).
- **Basket** (Order online, best balance pick only): open the dish (`/restaurant/<slug>/itemid-<id>`), the dish window has "-  1  +" and "Přidat do objednávky / Add to order <price>". Adding needs no login; ordering does (he signs in and orders himself). The basket uses the address set in Wolt (on 19/10 it was "Roztylská 2321/19" = Westfield Chodov): he checks it before ordering.
- **Pitfalls**: drinks, sauces (Kari 15 CZK), a 10 CZK soy-sauce bowl, plain noodles 50-60 CZK, kids' menus and plant-based burgers looked like meals to the first rules; refused since 19/10 (price floor 80 CZK without a weight, word lists). A venue showing "Opens tomorrow" is skipped in order mode.

## 10. Sources (APA 7)
- Wolt. (n.d.-a). *BILLA Křejpského (809)*. Retrieved October 19, 2026, from https://wolt.com/cs/cze/prague/venue/billa-krejpskeho
- Wolt. (n.d.-b). *Wolt Market Michle*. Retrieved October 19, 2026, from https://wolt.com/cs/cze/prague/venue/wolt-market-michle
- Wolt. (n.d.-c). *BILLA – Praha*. Retrieved October 19, 2026, from https://wolt.com/cs/cze/prague/brand/billa
- Wolt. (n.d.-d). *Kaufland Praha-Michle*. Retrieved October 19, 2026, from https://wolt.com/cs/cze/prague/venue/kaufland-praha-michle
- Wolt. (n.d.-e). *DELMART supermarket OC Chodov*. Retrieved October 19, 2026, from https://wolt.com/cs/cze/prague/venue/delmart-supermarket-oc-chodov
- Wolt. (n.d.-f). *PENNY Praha – Zahradní Město*. Retrieved October 19, 2026, from https://wolt.com/cs/cze/prague/venue/penny-praha-zahradni-mesto
- Wolt. (n.d.-g). *Albert Krejnická*. Retrieved October 19, 2026, from https://wolt.com/cs/cze/prague/venue/albert-krejnicka
- Wolt. (n.d.-h). *Tesco Supermarket Brandlova*. Retrieved October 19, 2026, from https://wolt.com/cs/cze/prague/venue/tesco-supermarket-brandlova
- Wolt. (n.d.-i). *Tesco Hypermarket Novodvorská*. Retrieved October 19, 2026, from https://wolt.com/cs/cze/prague/venue/tesco-hypermarket-novodvorska
- Wolt. (n.d.-j). *Tesco Expres Kunratice*. Retrieved October 19, 2026, from https://wolt.com/cs/cze/prague/venue/tesco-expres-kunratice
- Wolt. (n.d.-l). *Restaurace KOBRA*. Retrieved October 19, 2026, from https://wolt.com/cs/cze/prague/restaurant/restaurace-kobra
- Wolt. (n.d.-m). *McDonald's Chodov*. Retrieved October 19, 2026, from https://wolt.com/cs/cze/prague/restaurant/mcdonalds-chodov
- Wolt. (n.d.-k). *Tesco Hypermarket Praha Eden*. Retrieved October 19, 2026, from https://wolt.com/cs/cze/prague/venue/tesco-hypermarket-praha-eden
