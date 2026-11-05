// Meal Planner: read Tesco online search results + nutrition (session 3, 2026-10-19).
// Use: open any https://nakup.itesco.cz page in Chrome, run this file's text with javascript_tool, then
//   await MPT(["tvaroh odtučněný", ...], 3)   and read the page once with get_page_text.
// It fetches the search and product pages as HTML and reads the data block inside them (the visible page may be machine-translated
// by Chrome, the fetched HTML is not). Reads only; never touches the basket.
window.MPT = async function (terms, perTerm) {
  perTerm = perTerm || 3;
  const P = new DOMParser();
  const out = ['term\tid\tname\tprice\tunit_price\tunit\tstatus\tpromo\tkcal\tprotein\tfat\tcarbs\tsalt'];
  const clean = v => String(v == null ? '' : v).replace(/[\t\n\r]+/g, ' ');
  const cacheOf = html => { const t = P.parseFromString(html, 'text/html').querySelector('script[type="application/discover+json"]'); return t ? t.textContent : ''; };
  const findObj = (o, key, dep) => { if (!o || typeof o !== 'object' || dep > 7) return null; if (o[key]) return o[key]; for (const k in o) { const r = findObj(o[k], key, dep + 1); if (r) return r; } return null; };
  const num = s => { const m = String(s || '').replace(',', '.').match(/[\d.]+/); return m ? m[0] : ''; };
  for (const t of terms) {
    let s;
    try { s = cacheOf(await fetch('/shop/cs-CZ/search?query=' + encodeURIComponent(t)).then(r => r.text())); }
    catch (e) { out.push(t + '\tERROR ' + clean(e)); continue; }
    const m = s.match(/"results":\[((?:\{"__typename":"CompositeResultType","node":\{"__ref":"ProductType:\d+"\}\},?)+)\]/);
    if (!m) { out.push(t + '\tNONE'); continue; }
    const ids = [...m[1].matchAll(/ProductType:(\d+)/g)].map(x => x[1]).slice(0, perTerm);
    const root = JSON.parse(s);
    for (const id of ids) {
      const p = findObj(root, 'ProductType:' + id, 0) || {};
      const n = {};
      try {
        const ps = cacheOf(await fetch('/shop/cs-CZ/products/' + id).then(r => r.text()));
        const nm = ps.match(/"nutrition":(\[[^\]]*\])/);
        if (nm) for (const v of JSON.parse(nm[1])) {
          const k = (v.name || '').toLowerCase(), v1 = v.value1 || '';
          if (k.startsWith('energ')) { const kc = v1.match(/([\d.,]+)\s*kcal/i); if (kc) n.kcal = kc[1].replace(',', '.'); }
          else if (k.startsWith('bílkovin')) n.protein = num(v1); else if (k === 'tuky') n.fat = num(v1); else if (k === 'sacharidy') n.carbs = num(v1); else if (k === 'sůl') n.salt = num(v1);
          if (!n.kcal) { const kc2 = v1.match(/([\d.,]+)\s*kcal/i); if (kc2) n.kcal = kc2[1].replace(',', '.'); } // kcal sometimes sits on its own row named "-"
        }
      } catch (e) { n.err = 1; }
      const promo = (p.promotions || []).map(x => (x.description || x.promotionType || '')).join(' / ');
      out.push([t, id, p.title, (p.price || {}).actual, (p.price || {}).unitPrice, (p.price || {}).unitOfMeasure, p.status, promo,
        n.kcal ?? '', n.protein ?? '', n.fat ?? '', n.carbs ?? '', n.salt ?? ''].map(clean).join('\t'));
    }
  }
  document.documentElement.setAttribute('translate', 'no');
  document.title = 'MPT done';
  document.body.innerHTML = '<pre translate="no" class="notranslate">' + out.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>';
  return 'rows ' + (out.length - 1);
};
'MPT ready';
