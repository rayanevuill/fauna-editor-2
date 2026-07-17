/* ============================================================================
   Fauna Morocco — Générateur des pages-menus de l'encyclopédie (navigateur + Node)
   À partir de species-list.json, produit :
     - pages de famille  (espèces, ou genres si groupByGenus)
     - pages de genre     (espèces du genre)
     - la GRILLE des familles pour patcher les pages d'ordre existantes
   Les pages de famille déjà présentes sur le site (existing[]) ne sont PAS régénérées.
   ==========================================================================*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FaunaMenus = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const SITE = "https://fauna-morocco.org";
  const GA = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-EZ9624NH1R"></script>\n    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag(\'js\',new Date());gtag(\'config\',\'G-EZ9624NH1R\');</script>';
  const ORDER_NAME = { sauria: "Sauria", serpentes: "Serpentes", testudines: "Testudines", anura: "Anura", caudata: "Caudata" };
  const NAVT = { en: ["Encyclopedia", "About", "Contact", "Donate"], fr: ["Encyclopédie", "À propos", "Contact", "Faire un don"] };
  // N.B. on n'échappe PAS l'apostrophe (les pages faites main utilisent l'apostrophe littérale ; invisible mais évite un faux diff).
  const esc = s => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  const rel = d => "../".repeat(d);
  const comm = (o, l) => ((o && o.common && o.common[l]) || "");
  const spName = (s, l) => comm(s, l) || s.scientific;
  // nom vernaculaire d'un genre (stocké sur la famille : f.genusCommon[Genre] = {en, fr})
  const genComm = (f, gen, l) => (((f.genusCommon || {})[gen] || {})[l] || "");

  function head(lang, depth, pathEN, title, desc) {
    const root = rel(depth);
    const canon = SITE + "/" + (lang === "fr" ? "fr/" + pathEN : pathEN);
    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}">
    <meta name="copyright" content="© Fauna Morocco - Rayane Vuillemin. Tous droits réservés.">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="${canon}">
    <link rel="alternate" hreflang="en" href="${SITE}/${pathEN}">
    <link rel="alternate" hreflang="fr" href="${SITE}/fr/${pathEN}">
    <link rel="alternate" hreflang="x-default" href="${SITE}/${pathEN}">
    ${GA}
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(desc)}">
    <meta property="og:image" content="${SITE}/images/social/fauna-morocco-social-share.jpg">
    <meta property="og:url" content="${canon}">
    <meta property="og:type" content="website">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" type="image/svg+xml" href="${root}images/favicons/favicon.svg"/>
    <link rel="shortcut icon" href="${root}images/favicons/favicon.ico"/>
    <link rel="preconnect" href="https://cdnjs.cloudflare.com">
    <link rel="stylesheet" href="${root}css/general.css?v=1.2">
    <link rel="stylesheet" href="${root}encyclopedia/encyclopedia-menu.css?v=2.6">
    <link rel="preload" as="style" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"></noscript>
    <link rel="stylesheet" href="${root}css/reskin.css?v=1.0">
</head>
<body>`;
  }
  function nav(lang, depth, selfEN) {
    const root = rel(depth), n = NAVT[lang], p = lang === "fr" ? "fr/" : "";
    return `<nav><a href="${root}index.html" class="logo">FAUNA <b>MOROCCO</b></a><input class="mtog" type="checkbox" id="mnav"><details class="langm"><summary aria-label="Changer de langue"><span class="cur">${lang.toUpperCase()}</span></summary><div class="menu"><a href="${root}${selfEN}" hreflang="en">EN</a><a href="${root}fr/${selfEN}" hreflang="fr">FR</a></div></details><label class="burger" for="mnav" aria-label="Menu"><span></span><span></span><span></span></label><div class="nl"><a href="${root}${p}encyclopedia.html" class="active">${n[0]}</a><a href="${root}${p}about.html">${n[1]}</a><a href="${root}${p}contact.html">${n[2]}</a><a href="${root}${p}donate.html" class="db">${n[3]}</a></div></nav>`;
  }
  function foot(lang, depth) {
    const root = rel(depth);
    const ln = lang === "en" ? ["Legal notice", "Privacy policy"] : ["Mentions légales", "Politique de confidentialité"];
    const na = lang === "en" ? "Non-profit association" : "Association à but non lucratif";
    return `<footer class="footer"><div class="container"><span>© 2026 Fauna Morocco</span><span>${na}</span><a href="${root}legal-notice.html">${ln[0]}</a><a href="${root}privacy-policy.html">${ln[1]}</a></div></footer>
    <script src="${root}js/general.js?v=1.1"></script>
    <script src="${root}encyclopedia/encyclopedia-menu.js"></script>
    <script src="${root}js/image-protection.js"></script>
</body></html>`;
  }
  function crumb(lang, depth, items) {
    const root = rel(depth), rl = lang === "en" ? "Reptiles & Amphibians of Morocco" : "Reptiles et Amphibiens du Maroc";
    let p = [`<a href="${root}${lang === "fr" ? "fr/" : ""}encyclopedia.html">${rl}</a>`];
    for (let i = 0; i < items.length - 1; i++) { p.push('<span class="breadcrumb-separator">/</span>'); p.push(`<a href="${items[i][1]}">${esc(items[i][0])}</a>`); }
    p.push('<span class="breadcrumb-separator">/</span>'); p.push(`<span>${esc(items[items.length - 1][0])}</span>`);
    return '<nav class="breadcrumb">' + p.join("") + '</nav>';
  }
  function page(lang, depth, selfEN, title, desc, crumbItems, pageTitle, grid) {
    return head(lang, depth, selfEN, title, desc) + `\n    ${nav(lang, depth, selfEN)}\n    <main>\n        <section class="species-section" style="padding-top:6rem;">\n            <div class="container">\n                <h1 class="page-title">${esc(pageTitle)}</h1>\n                ${crumb(lang, depth, crumbItems)}\n                <div class="species-grid">\n${grid}\n                </div>\n            </div>\n        </section>\n    </main>\n    ${foot(lang, depth)}`;
  }
  function itemSpecies(s, lang, order, fam, depth) {
    const img = rel(depth) + `images/encyclopedia/${order}/${fam}/${s.slug}.jpg`;
    const name = esc(spName(s, lang)), sci = esc(s.scientific);
    const soon = lang === "en" ? "Coming Soon" : "Bientôt disponible";
    const pill = s.iucn ? `<div class="conservation-status status-${s.iucn.toLowerCase()}">${esc(s.iucn)}</div>` : "";
    const inner = `<div class="species-image"><img src="${img}" alt="${sci}" loading="lazy"></div><h3>${name}</h3><p class="scientific-name">${sci}</p>`;
    if (s.status === "published")
      return `<div class="species-item-wrapper"><a href="${fam}/${s.slug}.html" class="species-item">${inner}</a>${pill}</div>`;
    return `<div class="species-item-wrapper coming-soon"><div class="species-item coming-soon">${inner}<span class="coming-soon-badge">${soon}</span></div>${pill}</div>`;
  }
  function genusList(f) { const seen = []; (f.species || []).forEach(s => { const g = s.scientific.split(" ")[0]; if (!seen.includes(g)) seen.push(g); }); return seen; }

  // Retourne [{path, html}] pour toutes les pages famille + genre à (re)générer,
  // en sautant les familles présentes dans existingSet (pages faites à la main).
  function generatePages(list, existingSet) {
    existingSet = existingSet || new Set();
    const menus = list.menus || {};
    const out = [];
    (list.groups || []).forEach(g => (g.families || []).forEach(f => {
      const order = f.order, fam = f.slug;
      // Ordres en mode "espèce" (Tortues, Urodèles) : la page d'ordre pointe direct sur les fiches,
      // pas de page-famille intermédiaire -> on n'en génère pas.
      if ((menus[order] || {}).mode === "species") return;
      // Familles inactives (coming-soon) : non cliquables depuis la page d'ordre -> pas de page à générer.
      if (f.active === false) return;
      const relPath = `encyclopedia/${order}/${fam}.html`;
      if (existingSet.has(relPath)) return;
      const byGenus = !!f.groupByGenus;
      ["en", "fr"].forEach(lang => {
        const depth = lang === "en" ? 2 : 3;
        const fname = comm(f, lang) || cap(fam);
        const ordHref = rel(depth) + (lang === "fr" ? "fr/" : "") + `encyclopedia/${order}.html`;
        const cr = [[ORDER_NAME[order] || cap(order), ordHref], [cap(fam), ""]];
        let grid, title, desc, pt;
        if (byGenus) {
          grid = genusList(f).map(gen => {
            const img = rel(depth) + `images/encyclopedia/${order}/${fam}/${gen.toLowerCase()}.jpg`;
            const vn = genComm(f, gen, lang);
            const h3 = esc(vn || gen);
            const sub = vn ? `<p class="scientific-name">${esc(gen)}</p>` : "";
            const n = (f.species || []).filter(s => s.scientific.split(" ")[0] === gen).length;
            const cnt = `<p class="species-count">${n} <span>${lang === "en" ? "species" : (n === 1 ? "espèce" : "espèces")}</span></p>`;
            return `<div class="species-item-wrapper"><a href="${fam}/${gen.toLowerCase()}.html" class="species-item"><div class="species-image"><img src="${img}" alt="${esc(gen)}" loading="lazy"></div><h3>${h3}</h3>${sub}${cnt}</a></div>`;
          }).join("\n");
          title = lang === "en" ? `${fname} of Morocco | ${cap(fam)} genera | Fauna Morocco` : `${fname} du Maroc | Genres de ${cap(fam)} | Fauna Morocco`;
          desc = lang === "en" ? `The genera of ${cap(fam)} in Morocco.` : `Les genres de ${cap(fam)} au Maroc.`;
        } else {
          grid = (f.species || []).map(s => itemSpecies(s, lang, order, fam, depth)).join("\n");
          const scis = (f.species || []).slice(0, 8).map(s => s.scientific).join(", ");
          title = lang === "en" ? `${fname} of Morocco | ${cap(fam)} Species Guide | Fauna Morocco` : `${fname} du Maroc | Guide des espèces de ${cap(fam)} | Fauna Morocco`;
          desc = lang === "en" ? `Morocco's ${cap(fam)} species: ${scis}.` : `Les espèces de ${cap(fam)} du Maroc : ${scis}.`;
        }
        pt = lang === "en" ? `${fname} of Morocco` : `${fname} du Maroc`;
        out.push({ path: (lang === "fr" ? "fr/" : "") + relPath, html: page(lang, depth, relPath, title, desc, cr, pt, grid) });
      });
      if (byGenus) genusList(f).forEach(gen => {
        const sps = (f.species || []).filter(s => s.scientific.split(" ")[0] === gen);
        ["en", "fr"].forEach(lang => {
          const depth = lang === "en" ? 3 : 4;
          const selfEN = `encyclopedia/${order}/${fam}/${gen.toLowerCase()}.html`;
          const ordHref = rel(depth) + (lang === "fr" ? "fr/" : "") + `encyclopedia/${order}.html`;
          const famHref = rel(depth) + (lang === "fr" ? "fr/" : "") + `encyclopedia/${order}/${fam}.html`;
          const cr = [[ORDER_NAME[order] || cap(order), ordHref], [cap(fam), famHref], [gen, ""]];
          const grid = sps.map(s => {
            const img = rel(depth) + `images/encyclopedia/${order}/${fam}/${s.slug}.jpg`;
            const name = esc(spName(s, lang)), sci = esc(s.scientific), soon = lang === "en" ? "Coming Soon" : "Bientôt disponible";
            const inner = `<div class="species-image"><img src="${img}" alt="${sci}" loading="lazy"></div><h3>${name}</h3><p class="scientific-name">${sci}</p>`;
            return s.status === "published"
              ? `<div class="species-item-wrapper"><a href="${s.slug}.html" class="species-item">${inner}</a></div>`
              : `<div class="species-item-wrapper coming-soon"><div class="species-item coming-soon">${inner}<span class="coming-soon-badge">${soon}</span></div></div>`;
          }).join("\n");
          const title = lang === "en" ? `${gen} of Morocco | ${cap(fam)} | Fauna Morocco` : `${gen} du Maroc | ${cap(fam)} | Fauna Morocco`;
          const desc = `${gen}: ` + sps.map(s => s.scientific).join(", ") + ".";
          const pt = lang === "en" ? `${gen} of Morocco` : `${gen} du Maroc`;
          out.push({ path: (lang === "fr" ? "fr/" : "") + selfEN, html: page(lang, depth, selfEN, title, desc, cr, pt, grid) });
        });
      });
    }));
    return out;
  }

  // Grille d'une page d'ordre, reproduite FIDÈLEMENT depuis list.menus[order].
  // menu = { mode:"family"|"species", cells:[{slug,active,sci,count,iucn,common:{en,fr},alt:{en,fr},img,hrefEN}] }
  function orderGrid(order, menu, lang) {
    menu = menu || { cells: [] };
    const SP = n => lang === "en" ? "species" : (n === 1 ? "espèce" : "espèces");
    const soon = lang === "en" ? "Coming Soon" : "Bientôt disponible";
    const imgFix = src => lang === "fr" ? (src || "").replace("../images", "../../images") : (src || "");
    const I = "                "; // indentation d'une case (16 espaces)
    const cellHTML = c => {
      const common = esc((c.common && (c.common[lang] || c.common.en)) || c.sci || "");
      const alt = esc((c.alt && (c.alt[lang] || c.alt.en)) || common);
      const sci = esc(c.sci || "");
      const img = imgFix(c.img);
      // Règle Rayane : la pastille de conservation n'apparaît QUE pour une espèce EN LIGNE (active).
      const pill = (c.active && c.iucn) ? `\n                    <div class="conservation-status status-${c.iucn.toLowerCase()}">${esc(c.iucn)}</div>` : "";
      const cnt = (c.count != null) ? `\n                        <p class="species-count">${c.count} <span>${SP(c.count)}</span></p>` : "";
      const body =
`<div class="species-image">
                            <img src="${img}" alt="${alt}" loading="lazy">
                        </div>
                        <h3>${common}</h3>
                        <p class="scientific-name">${sci}</p>`;
      if (c.active) {
        const href = c.hrefEN || `${order}/${c.slug}.html`;
        return `${I}<div class="species-item-wrapper">
                    <a href="${href}" class="species-item">
                        ${body}${cnt}
                    </a>${pill}
                </div>`;
      }
      return `${I}<div class="species-item-wrapper coming-soon">
                    <div class="species-item coming-soon">
                        ${body}${cnt}
                        <span class="coming-soon-badge">${soon}</span>
                    </div>${pill}
                </div>`;
    };
    const cells = (menu.cells || []).map(cellHTML).join("\n");
    return '<div class="species-grid">\n' + cells + '\n                </div>';
  }

  // Carte d'une espèce pour une grille de page-famille (utilisée aussi pour l'injection
  // chirurgicale dans les pages faites main, sans les régénérer). depth: EN=2, FR=3.
  function speciesCard(s, lang, order, fam, depth) { return itemSpecies(s, lang, order, fam, depth); }
  function speciesName(s, lang) { return spName(s, lang); }

  return { generatePages, orderGrid, speciesCard, speciesName };
});
