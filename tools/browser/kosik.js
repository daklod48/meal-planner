// Meal Planner: read Košík search results + nutrition through Košík's own web API (session 3, 2026-10-19).
// Use: open any https://www.kosik.cz page in Chrome, run this file's text with javascript_tool, then
//   await MPK(["tvaroh odtučněný", ...], 3)   and read the page once with get_page_text (one TSV table).
// Reads only; never touches the cart. Output columns are what tools/cook.py ingest --source kosik expects.
window.MPK = async function (terms, perTerm) {
  perTerm = perTerm || 3;
  const out = ['term\tid\tname\tprice\trecommended\tclub_price\tqty\tqty_unit\tin_stock_today\tkcal\tprotein\tfat\tcarbs\tsalt\tslug\tsale_until'];
  const clean = v => String(v == null ? '' : v).replace(/[\t\n\r]+/g, ' ');
  const today = new Date().toLocaleDateString('sv-SE'); // the browser's local date, YYYY-MM-DD
  // 2026-11-08: the last day of a sale, if the shop's own data has one: any date-valued field whose NAME ends in end / valid /
  // until / to (for example endDate, validTo), searched two levels deep. Field names not confirmed on a live page yet
  // (RUN-STEPS D8); empty when nothing is found, never a guess. cook.py turns it into sale_until (YYYY-MM-DD).
  const findEnd = (o, depth) => {
    if (!o || typeof o !== 'object' || (depth || 0) > 2) return '';
    for (const [k, v] of Object.entries(o)) {
      if (/(end|valid|until|to)(date|time|at)?$/i.test(k) && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    }
    for (const v of Object.values(o)) { const f = findEnd(v, (depth || 0) + 1); if (f) return f; }
    return '';
  };
  for (const t of terms) {
    let r;
    try { r = await fetch('/api/front/page/products/flexible?vendor=1&slug=vyhledavani&limit=30&platform=web&search_term=' + encodeURIComponent(t)).then(x => x.json()); }
    catch (e) { out.push(t + '\tERROR search ' + clean(e)); continue; }
    const items = (r.products && r.products.items) || [];
    if (!items.length) { out.push(t + '\tNONE'); continue; }
    for (const x of items.slice(0, perTerm)) {
      const n = {};
      try {
        const d = await fetch('/api/front/product/slug/' + x.url.replace(/^\//, '')).then(y => y.json());
        for (const v of (((d.product || {}).detail || {}).nutritionalValues || {}).values || []) {
          const k = (v.title || '').toLowerCase(), val = String(v.value).replace(',', '.');
          if (v.unit === 'kcal') n.kcal = val; else if (k.startsWith('bílkovin')) n.protein = val; else if (k === 'tuky') n.fat = val; else if (k === 'sacharidy') n.carbs = val; else if (k === 'sůl') n.salt = val;
        }
      } catch (e) { n.err = 1; }
      const av = (x.availability || [])[0] || {};
      out.push([t, x.id, x.name, x.price, x.recommendedPrice, x.loyaltyClubBenefitsPrice ?? '', (x.productQuantity || {}).value, (x.productQuantity || {}).unit,
        (av.date <= today && av.quantity > 0) ? 'yes' : 'no',
        n.kcal ?? '', n.protein ?? '', n.fat ?? '', n.carbs ?? '', n.salt ?? '', x.url.replace(/^\//, ''), Number(x.recommendedPrice) > Number(x.price) ? findEnd(x) : ''].map(clean).join('\t'));
    }
  }
  document.documentElement.setAttribute('translate', 'no');
  document.title = 'MPK done';
  document.body.innerHTML = '<pre translate="no" class="notranslate">' + out.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>';
  return 'rows ' + (out.length - 1);
};
'MPK ready';
