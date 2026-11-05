# Rohlík.cz (card key: `rohlik`)

_Card written 2026-10-19 (session 2). Facts dated; re-check anything older than 30 days before a plan uses it._

## 1. In one line
Online-only supermarket with a Claude connector: full prices, nutrition per 100 g, stock, and a cart Claude can fill. First choice for the Cook mode cart.

## 2. Where it is near the saved places
No shop to walk to. Delivers to both places: `search_address` said `is_delivered_to: true` for "Chemická 955, Praha" and "Roztylská 2321/19, Praha" (connector, 19/10/2026). Row `D-rohlik` in both places of `data/shops/shops.json`.

## 3. Prices online
- **What:** the whole assortment.
- **How (connector first):** `batch_search_products` with `include_nutritions: true`, up to 4 queries per call, at most 5 results per query, sponsored results first. Use precise Czech words ("tvaroh odtučněný 250 g", "kuřecí prsní řízky") and check every hit against the item's `expect` block (protein floor, category); a plain search once returned ice cream for "tvaroh" (18/10).
- **Fields:** `price` (what this account pays now), `originalPrice` and `discountPercentage` when discounted, `pricePerUnit.full` (CZK per kg or l), `inStock`, `productId`.
- **Chrome second:** rohlik.cz product page, if the connector is down twice (stop rule in PLAN.md).
- **Label:** `online`; after the cart is filled, the cart price wins (`cart`), and the plan is redone if it moved more than 10 %.

## 4. Loyalty price
- Card key `rohlik-xtra`. Rohlík Xtra costs 166 CZK a month after 30 free days: free delivery always, 10 % off Rohlík's own brands and BIO products, 4 small orders a month without the minimum (Rohlík, n.d.-b).
- 2026-10-19 (session 3): `get_user_info` says Xtra is NOT active on his account (free trial offered); the cart marks the 10 % lines on Kitchin and Miil as `saleType: premium, welcomePrice: true`. So 16.11 CZK for Miil tvaroh is a welcome/premium sale for this account, not an Xtra card price.
- The connector shows the price for the signed-in account. On 19/10 Miil tvaroh came back at 16.11 CZK with `originalPrice` 17.90 and 10 % off; Miil is a Rohlík own brand, so this matches the Xtra 10 %, but whether this account has Xtra was not checked. Session 3 checks the account (`get_user_info`) before treating 16.11 as a card price.

## 5. Nutrition
In the search result (`include_nutritions`): kcal, protein, fat, carbs, sugars, salt, fibre per 100 g, label `exact`. 5 of 20 products had none on 18/10 (fresh meat, farm eggs): then use a food-table value, label `table`.

## 6. Delivery
- Minimum order 749 CZK to the door, 500 CZK to a Rohlik Point box (Rohlík, n.d.-a).
- Delivery fee "depends on the size of the purchase, the place and the time slot" (Rohlík, n.d.-a): read it in the cart. Paper bags 15 CZK per order.
- Express delivery within 90 minutes: Xtra members only, Prague, Brno, Ostrava.

## 7. Cart
Connector: `add_items_to_cart`, `get_cart`, `remove_cart_item`. Tested add and remove on 18/10 (cart left empty). Before adding, compare `get_user_info` name with the profile's Rohlík account name; stop if different. Never `get_checkout_link` for paying unless he asks; never pay.

## 8. Pitfalls
Sponsored items first; flavoured oat sachets for "ovesné vločky"; weight-priced meat may vary up to 30 % (Rohlík, n.d.-a); price changes within the hour (17.91 vs 16.11 on 18/10).

## 9. Test read
| Date (Prague) | Product | Pack | Price | Card price | Protein / kcal per 100 g | Label | Where |
|---|---|---|---|---|---|---|---|
| 19/10/2026 about 01:00 | Miil Tvaroh odtučněný (id 1469745) | 250 g | 16.11 CZK (original 17.90) | Xtra not confirmed | 12 g / 66 kcal | exact | Rohlík connector `batch_search_products` |

## R. Ready meals (Order online, session 4, read 19/10/2026 11:50 with the connector)
- `batch_search_products` with `include_nutritions: true` for 8 words (`tools/dine.py terms` lists them: "hotová jídla", "hotové jídlo kuřecí", ...): 33 products, 14 kept as one ready-meal pack of 250-750 g with a label (broth, bread, juice, sweet buns, 1.2 kg turkey legs refused).
- Example: Rohlik.cz Kuřecí paprikáš s těstovinami, 530 g, 127.40 CZK (was 149.90), 159 kcal and 8.7 g protein per 100 g = 842.7 kcal and 46.1 g protein a pack (label `exact`). Ready meals hold 4-11 g protein per 100 g, so 2 meals rarely reach the protein of 2 of his 3 meals.
- Plan: one delivery for the whole plan (chilled, use-by dates), 749 CZK minimum to the door (500 CZK Rohlik Point).
- Cart: NOT filled by the run in Order online mode (his Rohlík cart holds the Cook plan of 19/10, 7 lines 292.08 CZK); the list is in the option.

## 10. Sources (APA 7)
- Rohlik.cz. (n.d.-a). *Časté dotazy* [Frequently asked questions]. Retrieved October 19, 2026, from https://www.rohlik.cz/stranka/caste-dotazy
- Rohlik.cz. (n.d.-b). *Xtra*. Retrieved October 19, 2026, from https://www.rohlik.cz/xtra
- Rohlik.cz. (n.d.-c). *MCP server documentation*. Retrieved October 18, 2026, from https://www.rohlik.cz/mcp-docs
