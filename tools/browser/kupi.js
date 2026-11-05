// Meal Planner: read current leaflet prices of every chain from kupi.cz (session 3, 2026-10-19). Secondary source (cards/kupi.md).
// Use: open https://www.kupi.cz/ in Chrome, run this file's text with javascript_tool, then
//   await MPL(["tvaroh", ...], 3, ["albert", "lidl", ...])   (3 products per word; only the chains named, by the start of their kupi name)
//   and read the page once with get_page_text. club = yes means the row says the price is for card/club members only.
// It fetches the search page as HTML (not the visible, possibly machine-translated page). Reads only.
window.MPL = async function (terms, perTerm, chains) {
  perTerm = perTerm || 3;
  const P = new DOMParser();
  const T = e => e ? e.textContent.replace(/\s+/g, ' ').trim() : '';
  const clean = v => String(v == null ? '' : v).replace(/[\t\n\r]+/g, ' ');
  const fold = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const keep = (chains || []).map(fold);
  const out = ['term\tproduct\tregular\tchain\tprice\tamount\tvalid\tclub\tslug'];
  for (const t of terms) {
    let doc;
    try { doc = P.parseFromString(await fetch('/hledej?f=' + encodeURIComponent(t)).then(r => r.text()), 'text/html'); }
    catch (e) { out.push(t + '\tERROR ' + clean(e)); continue; }
    const groups = [...doc.querySelectorAll('.group_discounts')].slice(0, perTerm);
    if (!groups.length) { out.push(t + '\tNONE'); continue; }
    for (const g of groups) {
      const a = g.querySelector('.product--wrap a[href^="/sleva/"]');
      const wrap = T(g.querySelector('.product--wrap'));
      const name = T(g.querySelector('.product--wrap h2, .product--wrap h3, .product--wrap strong')) || (a && a.getAttribute('title')) || '';
      const reg = (wrap.match(/Běžná cena:\s*([\d ,]+)/) || [])[1] || '';
      const pds = g.querySelectorAll('.promo_discounts');
      const box = pds[pds.length - 1];
      if (!box) continue;
      for (const r of box.querySelectorAll('.discount_row')) {
        const shop = T(r.querySelector('.discounts_shop_name')) || ((r.querySelector('.discounts_shop_image img') || {}).alt || '');
        if (keep.length && !keep.some(k => fold(shop).startsWith(k))) continue; // only chains with a store near the place
        const all = fold(T(r));
        const club = /plati pro cleny klubu|lidl plus|kaufland card|clubcard|billa club|moje penny|s kartou|v aplikaci/.test(all) ? 'yes' : '';
        out.push([t, name, reg, shop, T(r.querySelector('.discount_price_value')), T(r.querySelector('.amount_percentage')),
          T(r.querySelector('.discounts_validity')), club, a ? a.getAttribute('href').replace('/sleva/', '') : ''].map(clean).join('\t'));
      }
    }
  }
  document.documentElement.setAttribute('translate', 'no');
  document.title = 'MPL done';
  document.body.innerHTML = '<pre translate="no" class="notranslate">' + out.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>';
  return 'rows ' + (out.length - 1);
};
'MPL ready';
