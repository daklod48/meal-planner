# Tesco (card key: `tesco`)

_Card written 2026-10-19 (session 2)._

## 1. In one line
Stores plus a full online shop (nakup.itesco.cz) with prices, Clubcard prices and nutrition; also sold through Wolt and foodora.

## 2. Where it is near the saved places
- Blanice kolej: Tesco Expres Velenická 72/2 (S040), 20 min walk, 12 min tram/bus; Tesco Brandlova 1640 (S069), 49 min walk, 25 min tram/bus.
- Westfield Chodov: Tesco Brandlova (S069), 30 min walk, 15 min tram/bus; Tesco Expres Velenická (S040), 34 min walk, 19 min tram/bus.
- Delivered: Tesco Online (`D-tesco`), Tesco on Wolt and on foodora (see wolt.md, foodora.md).

## 3. Prices online
- **Search:** `https://nakup.itesco.cz/groceries/cs-CZ/search?query=<words>` (redirects to `/shop/cs-CZ/search`). Tile: price, CZK/kg.
- **Product page:** `https://nakup.itesco.cz/shop/cs-CZ/products/<id>`. Nutrition sits in the closed section "Složení": read the page text (`textContent`), not the visible text.
- The online price is the price of the online shop; a store shelf can differ. Label `online` for delivery plans; for a walk-in plan it is a `last_known` estimate for the store.

## 4. Loyalty price
Card key `tesco-clubcard`. Promoted items show a separate "Clubcard cena"; use it only if the person has Clubcard. Tesco Online Club (delivery subscription, not the card): 139 CZK a month on the 12-month plan (1,668 CZK), any day without delivery fees; 79 CZK a month (948 CZK a year) for Monday to Thursday deliveries (Tesco, n.d.-b).

## 5. Nutrition
Product page, section "Nutriční hodnoty", per 100 g: label `exact`.

## 6. Delivery
- Tesco Online: whether it delivers to these two addresses was NOT checked (the check needs the address in the account); fee and slot price are shown only after login (Tesco, n.d.-a). Session 3 reads them in the cart with his yes.
- Wolt and foodora: see their cards (minimum 250 to 349 CZK; foodora delivery fee 109 to 169 CZK on 19/10).

## 7. Cart
Chrome on his Tesco account (not tested yet).

## 8. Pitfalls
Online and shelf prices can differ; Clubcard price only with the card.

## 9. Test read
| Date (Prague) | Product | Pack | Price | Card price | Protein / kcal per 100 g | Label | URL |
|---|---|---|---|---|---|---|---|
| 19/10/2026 about 01:40 | Tesco Tvaroh odtučněný | 250 g | 17.90 CZK (71.60 CZK/kg) | – | 11 g / 63 kcal | exact | https://nakup.itesco.cz/shop/cs-CZ/products/130586076 |

## 10. Sources (APA 7)
- Tesco Stores ČR. (n.d.-a). *Kolik stojí převzetí objednávky* [What collecting an order costs]. Retrieved October 19, 2026, from https://www.itesco.cz/help/pages/tesco-online-nakupy/prevzeti-platba-a-vraceni-produktu/kolik-stoji-prevzeti-objednavky
- Tesco Stores ČR. (n.d.-b). *Tesco Online Club*. Retrieved October 19, 2026, from https://nakup.itesco.cz/online-club/cs-CZ/
- Tesco Stores ČR. (n.d.-c). *Tesco Tvaroh odtučněný 250 g*. Retrieved October 19, 2026, from https://nakup.itesco.cz/shop/cs-CZ/products/130586076
