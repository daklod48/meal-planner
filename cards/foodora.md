# foodora (card key: `foodora`), grocery part

_Card written 2026-10-19 (session 2, groceries); restaurants added in session 4, same day, section R._

## 1. In one line
Delivery app with chain shops (Billa, Penny, Tesco) and its own foodora MARKET; shows delivery fee, minimum order and a 5 % service fee openly, without login.

## 2. Shops that deliver to the saved places (19/10/2026 08:00-08:42)
| Shop (path) | Blanice kolej | Westfield Chodov | Minimum order |
|---|---|---|---|
| foodora MARKET Chodovská (`darkstore/l1hl/foodora-market-chodovska`) | 35 min, 89 CZK | 25 min, 69 CZK | 399 CZK |
| BILLA Rozvoj (`shop/icwu/billa-praha-rozvoj`) | 35 min, 49 CZK | 25 min, 59 CZK | 249 CZK |
| Penny Háje I (`shop/uh0e/penny-market-praha-haje-i`) | 30 min, 59 CZK | 25 min, 59 CZK | 299 CZK |
| Tesco Expres Nuselská (`shop/t6lt/tesco-expres-nuselska`) | 45 min, 109 CZK | 45 min, 109 CZK | 349 CZK |
| Tesco Hypermarket Nový Smíchov (`shop/kpcv/tesco-hypermarket-novy-smichov`) | 55 min, 169 CZK | 60 min, 129 CZK | 349 CZK |
Every order adds a 5 % service fee, at least 7 CZK (shop header). Minimum orders were read with the Blanice address. Chodov also listed Sunny Market Kačerov and Akmarket (small shops, not read). No Albert, Kaufland or Lidl on foodora for these places.

## 3. Prices online
- Set the place by URL: `https://www.foodora.cz/?lat=<lat>&lng=<lng>&expedition=delivery&vertical=shop` (Blanice 50.0195, 14.49761; Chodov 50.031371, 14.49096), or type the address once.
- Shop page: categories and a "Search products" box. Tiles: price, old price, discount, name, pack.
- Label `online`, shop key `foodora-<chain>`.

## 4. Loyalty price
Store cards do not apply. foodora offers "50 % discount from 399 CZK" type promotions on the list (19/10); not used in plans unless he has them.

## 5. Nutrition
Not on tiles.

## 6. Delivery
Above. Cookies: save settings with only necessary ones.

## 7. Cart
His foodora account, session 4.

## 8. Pitfalls
Delivery fee differs per address (Billa: 49 CZK Blanice, 59 CZK Chodov).

## 9. Test read
| Date (Prague) | Shop | Product | Pack | Price | Label | URL |
|---|---|---|---|---|---|---|
| 19/10/2026 about 08:35 | foodora MARKET Chodovská | JIM JERKY hovězí | 23 g | 59.89 CZK (was 69.90) | online | https://www.foodora.cz/darkstore/l1hl/foodora-market-chodovska |

## R. Restaurants (session 4, 19/10/2026)
- **Robot check**: at 11:47 foodora.cz showed "Before we continue... Please confirm you are a human (and not a bot)" with a reCAPTCHA box in his Chrome. Claude never ticks it. A run that sees it skips foodora and says "foodora skipped: robot check"; if he ticks it himself in Chrome, later runs can read foodora again.
- **List** (read before the check appeared): the listing service foodora.cz uses (`disco.deliveryhero.io/listing/api/v1/pandora/vendors?latitude=..&longitude=..&vertical=restaurants`) gave 450 restaurants for Blanice kolej, each with delivery minutes, fee (Tom's Burger Chodov: 60 min, 49 CZK, minimum 69 CZK) and service fee.
- **Menu**: `cz.fd-api.com/api/v5/vendors/<code>?include=menus` (reader written, not yet read successfully: the robot check came first).
- Reader `tools/browser/readers.js`, source `foodora`. No basket (robot check; list only).

## 10. Sources (APA 7)
- foodora. (n.d.-a). *foodora MARKET – Chodovská*. Retrieved October 19, 2026, from https://www.foodora.cz/darkstore/l1hl/foodora-market-chodovska
- foodora. (n.d.-b). *BILLA – Praha Rozvoj*. Retrieved October 19, 2026, from https://www.foodora.cz/shop/icwu/billa-praha-rozvoj
- foodora. (n.d.-c). *Penny Market – Praha Háje I*. Retrieved October 19, 2026, from https://www.foodora.cz/shop/uh0e/penny-market-praha-haje-i
- foodora. (n.d.-d). *Tesco Expres Nuselská*. Retrieved October 19, 2026, from https://www.foodora.cz/shop/t6lt/tesco-expres-nuselska
- foodora. (n.d.-e). *Tesco Hypermarket Nový Smíchov*. Retrieved October 19, 2026, from https://www.foodora.cz/shop/kpcv/tesco-hypermarket-novy-smichov
- foodora. (n.d.-f). *foodora: jídlo a nákupy s doručením*. Retrieved October 19, 2026, from https://www.foodora.cz/
