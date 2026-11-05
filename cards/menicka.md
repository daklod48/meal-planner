# Meníčka.cz (card key: `menicka`), daily lunch menus

_Card written 2026-10-19 (session 4). Every fact has its date and source._

## 1. In one line
Czech website where restaurants post their lunch menu of the day with prices; dish names often start with the MEAT weight ("150g Kuřecí nudličky na kari, rýže"). No nutrition. Used by Eat out only.

## 2. Where it is near the saved places (19/10/2026)
`praha-4.html?cast=<part>` lists the restaurants of one city part: Chodov `cast=124` (12 restaurants), Šeberov `279` (1), Háje `284` (1), Libuš `121` (2), Kunratice `123` and `129` (0). Seven of the surveyed restaurants have a page (`menicka` field in `data/shops/restaurants.json`): Restaurace u Krčáku 8784, Restaurace Maják 2226, Bread & Water 7906, Na Rychtě 2174 (all 10-13 min walk from Westfield Chodov), XL Restaurant 4557 (18 min), Columna 2172 (23 min), Di Carlo Šeberov 4441 (21 min from Blanice kolej). Blanice kolej has none within 15 min.

## 3. Prices online
- Restaurant page `https://www.menicka.cz/<id>-<slug>.html`: one block per day (`.menicka`, header "Pondělí 19.10.2026"), dishes `li.jidlo` with the name in `.polozka` and the price in `.cena`. Usually only TODAY is filled (19/10: Tuesday to Friday empty).
- Reader: `tools/browser/readers.js`, source `menicka` (today's block only; drops the "1." numbering, "Polévka +" in front of a lunch combo, and the allergen numbers at the end).
- Price label `daily_menu`; the plan says "that day at lunch only; other days have other dishes at similar prices".

## 4. Loyalty price
None.

## 5. Nutrition
Not published: estimate with `steps/dish-table.json` (the leading grams = meat weight, except for one-pot dishes of 200 g or more).

## 6. Delivery
Not used (some restaurants deliver; Order online uses Wolt and foodora).

## 7. Cart
None: he pays at the table.

## 8. Pitfalls
Chrome's machine translation renames places on the page ("Háje" became "Pebble", "Krč" "Cramp"): read the fetched HTML, never the visible text. Output with "=" or "?" in it is blocked by the extension: the reader prints plain text.

## 9. Test read
| Date (Prague) | Restaurant | Dish | Price | URL |
|---|---|---|---|---|
| 19/10/2026 about 12:00 | Restaurace u Krčáku | 150g kuřecí čína na orestované čerstvé zelenině, vařená jasmínová rýže | 172 CZK | https://www.menicka.cz/8784-restaurace-u-krcaku.html |
| 19/10/2026 about 12:00 | Restaurace Maják | 150g Kuřecí nudličky na zeleném curry, dušená rýže | 169 CZK | https://www.menicka.cz/2226-restaurace-majak.html |

## 10. Sources (APA 7)
- Meníčka.cz. (n.d.-a). *Restaurace u Krčáku: denní menu*. Retrieved October 19, 2026, from https://www.menicka.cz/8784-restaurace-u-krcaku.html
- Meníčka.cz. (n.d.-b). *Restaurace Maják: denní menu*. Retrieved October 19, 2026, from https://www.menicka.cz/2226-restaurace-majak.html
- Meníčka.cz. (n.d.-c). *Praha 4: obědy a denní menu*. Retrieved October 19, 2026, from https://www.menicka.cz/praha-4.html
