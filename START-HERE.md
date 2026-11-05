# Meal Planner. Start here / Začněte tady

_English first, Czech below (česky níže). Version 1.0, 2026-10-19._

## What this is
You set a goal (for example "gain 3 kg in 12 weeks", or a protein and calorie target you type) and a budget. Claude then finds what you could eat that fits the goal and the budget, from every shop and restaurant within reach of a place you saved, and shows you the options side by side: price with and without a loyalty card, protein and calories a day, minutes of cooking or walking or delivery, distance. You pick. Claude fills the shopping cart (Rohlík) or the Wolt basket for you; it never pays. You press Order yourself, only if you want the food.

Three kinds of plan, you choose each time:
- **Cook at home**: a shopping list and recipes; prices from Rohlík, Košík, Tesco online and the weekly leaflets of the chains near you (Albert, Billa, Lidl, Penny, Kaufland, Norma, Globus).
- **Order online**: dishes from Wolt, foodora and Rohlík ready meals, with delivery fee and delivery time.
- **Eat out**: restaurants within your walking limit, with today's lunch menu where it is published, and the walking time.

Every day at 22:10 Claude re-checks the Rohlík prices of the products in your recent plans; if a price moved by 5 % or more, or a product sold out, your phone gets a note and the plan says "Prices changed since this plan ... Re-plan?".

## What it is not
- Not medical advice. The targets come from published research (see "Where the numbers come from"); a doctor or dietitian knows you, this app does not.
- Not a shop. Nothing is ever paid or ordered by Claude.
- Not a cloud service. Everything about you stays in the `data/` folder on your own computer.

## What you need
1. A Windows or Mac computer with the **Claude desktop app** (a paid Claude plan: the scheduled tasks and the Chrome extension are part of it).
2. **Google Chrome** with the **Claude in Chrome** extension (Claude reads the shop websites in your own browser).
3. A **Rohlík account** (rohlik.cz). The Rohlík connector lets Claude read prices and fill your cart: in the Claude app, Settings > Connectors > Add custom connector, name "Rohlík", URL `https://mcp.rohlik.cz/mcp`, then sign in (Rohlík's own page: https://www.rohlik.cz/mcp-docs). Without it, the Cook plans still work from Košík, Tesco and the leaflets, but no cart is filled.
4. Optional: a Wolt account signed in in Chrome (then Claude can fill the Wolt basket; it never orders).

## Setup in 5 steps
1. Unzip `MealPlanner-share-<date>.zip` somewhere you keep files (for example `Documents\MealPlanner`). Do not rename the inside folder `MealPlanner`.
2. Open the Claude desktop app, start a new chat, attach the `MealPlanner` folder (the paper-clip / "Add folder" button), and type: **read SETUP-FOR-CLAUDE.md and set me up**. Claude checks what is connected, creates the two scheduled tasks ("Meal Planner run" and "Meal Planner price watch") and the `data/` folders, and tells you what is missing.
3. In the Claude app, open Scheduled (tasks) and make sure both tasks show **"Require this computer"** switched on (Claude tells you if it is already on). They run on your computer, with your browser and your Rohlík connector.
4. Double-click `app\MealPlanner.html` (opens in Chrome or Edge). Click "Pick the MealPlanner folder", pick it, allow. Make your profile: body, goal, budget, the loyalty cards you hold, your places (home, school, work) with how far you are willing to walk, your shop accounts (the Rohlík account name and e-mail: Claude checks it is YOUR cart before touching it).
5. First plan: in the app choose Cook / Order online / Eat out, fill the boxes, press "Send to Claude". Then in the Claude app, Scheduled > "Meal Planner run" > **Run now**. Five to ten minutes later the options are in the app under "Requests and results".

The shop list of a place (which shops are within walking reach, how far, opening hours) is made once per place. The copy you received may include the survey of the places of the person who sent it (`data/shops/`); for your own place say in a Cowork chat: **meal planner, survey <place name>** (it reads Google Maps once, about 30 to 60 minutes of Claude's time) and then **meal planner, survey restaurants for <place name>** for the Eat out plans.

## Every day
1. App: pick a plan kind, fill the boxes, "Send to Claude".
2. Claude app: Scheduled > "Meal Planner run" > Run now (or type "meal planner, run" in a chat with the folder attached).
3. App: compare the three picks (Cheapest, Fastest to your goal, Best balance) and the full table; press "Pick this".
4. Order on the shop site yourself (the cart is already filled). Weigh yourself now and then and type it under History: the app computes the targets from your latest weight.

## Where the numbers come from
- Protein 1.6 to 2.2 g per kg of body weight a day, calorie surplus 10 to 20 %, gain 0.25 to 0.5 % of body weight a week: Iraki, J., Fitschen, P., Espinar, S., & Helms, E. (2019). Nutrition recommendations for bodybuilders in the off-season: A narrative review. *Sports, 7*(7), 154. https://doi.org/10.3390/sports7070154
- Protein 1.4 to 2.0 g/kg/day: Jäger, R., et al. (2017). International Society of Sports Nutrition position stand: Protein and exercise. *Journal of the International Society of Sports Nutrition, 14*, 20. https://doi.org/10.1186/s12970-017-0177-8
- No extra muscle gain above 1.62 g/kg/day: Morton, R. W., et al. (2018). A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength. *British Journal of Sports Medicine, 52*(6), 376-384. https://doi.org/10.1136/bjsports-2017-097608
- Resting energy: Mifflin, M. D., et al. (1990). A new predictive equation for resting energy expenditure in healthy individuals. *The American Journal of Clinical Nutrition, 51*(2), 241-247. https://doi.org/10.1093/ajcn/51.2.241; activity factors 1.53 / 1.76 / 2.25: FAO/WHO/UNU (2004). *Human energy requirements*, chapter 5. https://www.fao.org/4/y5686e/y5686e07.htm
- Nutrition of restaurant dishes without a label: estimated from USDA FoodData Central (FNDDS 2021-2023), labelled "estimate" and said to be 20 to 30 % off in either direction. Shop products: the shop's own nutrition table ("exact").

## Privacy and safety, in plain words
- Your profile, weigh-ins, plans, prices and logs are files in `MealPlanner\data\` on your computer. Nothing is uploaded by the app. When you send the folder to someone else, run `python tools\make-share-copy.py` (or ask Claude: "meal planner, make share copy"): the zip it makes has no `data\`.
- Claude reads the shop sites in your Chrome and uses your Rohlík sign-in through the connector. It fills carts and baskets; the rules (`steps\RUN-STEPS.md`, "Hard limits") forbid paying, ordering, booking a delivery slot, changing an address or a payment method, and signing in anywhere.
- Claude checks the Rohlík account name or e-mail against your profile before it touches a cart; a different account = no cart.
- You can stop everything by switching the two scheduled tasks off in the Claude app, or by removing the folder.

---

# Česky

## Co to je
Zadáte cíl (například "přibrat 3 kg za 12 týdnů", nebo bílkoviny a kalorie, které napíšete sami) a rozpočet. Claude pak najde, co byste mohli jíst, aby to sedělo k cíli i k rozpočtu, ze všech obchodů a restaurací v dosahu místa, které jste si uložili, a ukáže vám možnosti vedle sebe: cenu s věrnostní kartou i bez ní, bílkoviny a kalorie na den, minuty vaření, chůze nebo doručení, vzdálenost. Vy si vyberete. Claude vám naplní nákupní košík (Rohlík) nebo košík na Woltu; nikdy neplatí. Objednat stisknete sami, jen pokud jídlo chcete.

Tři druhy plánu, pokaždé si vyberete:
- **Vařit doma**: nákupní seznam a recepty; ceny z Rohlíku, Košíku, Tesca online a z týdenních letáků řetězců ve vašem okolí (Albert, Billa, Lidl, Penny, Kaufland, Norma, Globus).
- **Objednat online**: jídla z Woltu, foodory a hotová jídla z Rohlíku, s cenou doručení a dobou doručení.
- **Jíst venku**: restaurace v dosahu vaší chůze, s dnešním poledním menu tam, kde je zveřejněné, a s dobou chůze.

Každý den ve 22:10 Claude znovu zkontroluje ceny produktů z vašich nedávných plánů na Rohlíku; když se cena pohne o 5 % a víc, nebo produkt vyprodají, přijde vám oznámení do telefonu a u plánu se objeví "Od tohoto plánu se změnily ceny ... Naplánovat znovu?".

## Co to není
- Není to lékařská rada. Cílové hodnoty vycházejí z publikovaného výzkumu (viz "Odkud jsou čísla" níže); lékař nebo nutriční terapeut vás zná, tato aplikace ne.
- Není to obchod. Claude nikdy nic neplatí ani neobjednává.
- Není to cloudová služba. Všechno o vás zůstává ve složce `data/` na vašem počítači.

## Co potřebujete
1. Počítač s Windows nebo Mac s **aplikací Claude** (placený tarif Claude: naplánované úlohy a rozšíření pro Chrome jsou jeho součástí).
2. **Google Chrome** s rozšířením **Claude in Chrome** (Claude čte stránky obchodů ve vašem vlastním prohlížeči).
3. **Účet na Rohlíku** (rohlik.cz). Konektor Rohlík umožní Claudovi číst ceny a plnit váš košík: v aplikaci Claude Settings > Connectors > Add custom connector, název "Rohlík", URL `https://mcp.rohlik.cz/mcp`, pak se přihlaste (stránka Rohlíku: https://www.rohlik.cz/mcp-docs). Bez něj plány "Vařit doma" fungují z Košíku, Tesca a letáků, ale košík se nenaplní.
4. Volitelně: účet na Woltu přihlášený v Chromu (pak Claude umí naplnit košík na Woltu; nikdy neobjedná).

## Nastavení v 5 krocích
1. Rozbalte `MealPlanner-share-<datum>.zip` někam, kde si necháváte soubory (třeba `Dokumenty\MealPlanner`). Vnitřní složku `MealPlanner` nepřejmenovávejte.
2. Otevřete aplikaci Claude, založte nový chat, připojte složku `MealPlanner` (sponka / "Add folder") a napište: **read SETUP-FOR-CLAUDE.md and set me up, česky** (poslední slovo říká Claudovi, aby odpovídal česky). Claude zkontroluje, co je připojené, vytvoří dvě naplánované úlohy ("Meal Planner run" a "Meal Planner price watch") a složky `data/`, a řekne vám, co chybí.
3. V aplikaci Claude otevřete Scheduled (úlohy) a ověřte, že obě úlohy mají zapnuté **"Require this computer"** (Claude vám řekne, pokud už zapnuté je). Běží na vašem počítači, s vaším prohlížečem a vaším konektorem Rohlík.
4. Poklepejte na `app\MealPlanner.html` (otevře se v Chromu nebo Edgi). Klikněte na "Vybrat složku MealPlanner", vyberte ji, povolte. Založte si profil: tělo, cíl, rozpočet, věrnostní karty, které máte, svá místa (domov, škola, práce) s tím, jak daleko jste ochotni jít pěšky, účty v obchodech (jméno a e-mail účtu na Rohlíku: Claude před prací s košíkem ověří, že je VÁŠ).
5. První plán: v aplikaci zvolte Vařit / Objednat online / Jíst venku, vyplňte políčka, stiskněte "Poslat Claudovi". Pak v aplikaci Claude: Scheduled > "Meal Planner run" > **Run now**. Za pět až deset minut jsou možnosti v aplikaci pod "Požadavky a výsledky".

Seznam obchodů pro jedno místo (které obchody jsou v dosahu pěšky, jak daleko, otevírací doba) se dělá jednou pro každé místo. Kopie, kterou jste dostali, může obsahovat průzkum míst člověka, který vám ji poslal (`data/shops/`); pro své vlastní místo napište v chatu Cowork: **meal planner, survey <název místa>** (přečte jednou Google Mapy, zhruba 30 až 60 minut Claudova času) a potom **meal planner, survey restaurants for <název místa>** pro plány "Jíst venku".

## Každý den
1. Aplikace: zvolte druh plánu, vyplňte políčka, "Poslat Claudovi".
2. Aplikace Claude: Scheduled > "Meal Planner run" > Run now (nebo napište "meal planner, run" do chatu s připojenou složkou).
3. Aplikace: porovnejte tři výběry (Nejlevnější, Nejrychleji k cíli, Nejlepší poměr) a celou tabulku; stiskněte "Vybrat".
4. Objednejte na stránce obchodu sami (košík je už naplněný). Občas se zvažte a zapište to v Historii: aplikace počítá cíle z vaší poslední váhy.

## Odkud jsou čísla
Stejné zdroje jako v anglické části výše (Iraki et al., 2019; Jäger et al., 2017; Morton et al., 2018; Mifflin et al., 1990; FAO/WHO/UNU, 2004; USDA FoodData Central pro odhady jídel v restauracích).

## Soukromí a bezpečnost, prostě řečeno
- Váš profil, vážení, plány, ceny a záznamy jsou soubory v `MealPlanner\data\` na vašem počítači. Aplikace nic nikam nenahrává. Když složku posíláte dál, spusťte `python tools\make-share-copy.py` (nebo řekněte Claudovi: "meal planner, make share copy"): vzniklý zip nemá žádné `data\`.
- Claude čte stránky obchodů ve vašem Chromu a používá vaše přihlášení k Rohlíku přes konektor. Plní košíky; pravidla (`steps\RUN-STEPS.md`, "Hard limits") zakazují platit, objednávat, rezervovat doručení, měnit adresu nebo platební metodu a kamkoli se přihlašovat.
- Claude před prací s košíkem porovná jméno nebo e-mail účtu na Rohlíku s vaším profilem; jiný účet = žádný košík.
- Všechno zastavíte vypnutím obou naplánovaných úloh v aplikaci Claude, nebo odebráním složky.
