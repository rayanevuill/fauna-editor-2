/* ============================================================================
   Fauna Morocco — Générateur de fiches v2 (modèle à CONTENU ORDONNÉ)
   Chaque section a `items: [...]` dans l'ordre voulu. Types d'item :
     text | gallery-16-9 | gallery-2-3 | gallery-5-4 | gallery-full-width
     | distribution-map | heading | sub-section (items) | subspecies (items)
   Rendu identique au format du site (species-account.css/.js).
   Bilingue : les structures des langues sont PARALLÈLES (mêmes items, même
   ordre) ; seuls le texte et les légendes diffèrent. Les légendes EN+FR sont
   retrouvées par le même chemin d'index dans l'autre langue.
   ==========================================================================*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FaunaGenerator2 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const IUCN = [
    { c: "EX", en: "Extinct", fr: "Éteint", ar: "منقرض" },
    { c: "EW", en: "Extinct in the Wild", fr: "Éteint à l'état sauvage", ar: "منقرض في البرية" },
    { c: "CR", en: "Critically Endangered", fr: "En danger critique", ar: "مهدد بشكل حرج" },
    { c: "EN", en: "Endangered", fr: "En danger", ar: "مهدد بالانقراض" },
    { c: "VU", en: "Vulnerable", fr: "Vulnérable", ar: "معرّض للخطر" },
    { c: "NT", en: "Near Threatened", fr: "Quasi menacé", ar: "قريب من التهديد" },
    { c: "LC", en: "Least Concern", fr: "Préoccupation mineure", ar: "غير مهدد" },
    { c: "DD", en: "Data Deficient", fr: "Données insuffisantes", ar: "نقص البيانات" },
    { c: "NE", en: "Not Evaluated", fr: "Non évalué", ar: "غير مُقيَّم" }
  ];
  const TREND = [
    { c: "decreasing", en: "Decreasing", fr: "En déclin", ar: "في تراجع" },
    { c: "stable", en: "Stable", fr: "Stable", ar: "مستقر" },
    { c: "increasing", en: "Increasing", fr: "En augmentation", ar: "في ازدياد" },
    { c: "unknown", en: "Unknown", fr: "Inconnu", ar: "غير معروف" }
  ];
  const STATUS_LBL = { en: "Conservation status:", fr: "Statut de conservation :", ar: "حالة الحفظ:" };
  const TREND_LBL = { en: "Population trend:", fr: "Tendance de population :", ar: "اتجاه التعداد:" };
  function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  const BLOCK_OK = { "gallery-16-9": 1, "gallery-2-3": 1, "gallery-5-4": 1, "gallery-full-width": 1, "distribution-map": 1 };
  function iucnOf(c) { return IUCN.find(x => x.c === c) || IUCN[6]; }
  function trendOf(c) { return TREND.find(x => x.c === c) || TREND[0]; }
  function slugify(s) { return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
  function plainCap(s) { return esc((s || "").replace(/<[^>]+>/g, "").replace(/\*([^*\n]+)\*/g, "$1").replace(/\{\{[^}]+\}\}/g, "").trim()); }
  function capAttr(s) { return esc((s || "").replace(/\{\{[^}]+\}\}/g, "").trim()).replace(/\*([^*\n]+)\*/g, "<em>$1</em>"); }
  function guessIcon(t) { t = (t || "").toLowerCase(); if (/descript|وصف/.test(t)) return "fa-info-circle"; if (/distrib|répart|repart|انتشار/.test(t)) return "fa-globe-africa"; if (/habitat|موطن/.test(t)) return "fa-tree"; if (/natural|naturelle|طبيعي/.test(t)) return "fa-leaf"; if (/conserv|حفظ/.test(t)) return "fa-shield-alt"; if (/référ|refer|مراجع/.test(t)) return "fa-book"; return "fa-leaf"; }

  // compte récursif des images (pour le badge)
  function countImages(items) {
    let n = 0;
    (items || []).forEach(it => {
      if (it.images) n += it.images.filter(im => im && im.src).length;
      if (it.items) n += countImages(it.items);
    });
    return n;
  }

  function makeGen(state) {
    const refs = state.refs || [];
    const statusCode = state.statusCode || "LC";
    const trendCode = state.trendCode || "decreasing";
    const refNum = key => { const i = refs.findIndex(r => r.key === key); if (i >= 0) return i + 1; const m = /^r(\d+)$/.exec(key || ""); return m ? m[1] : "?"; };
    const genText = t => esc(t).replace(/\*([^*\n]+)\*/g, "<em>$1</em>").replace(/\{\{([^}]+)\}\}/g, (m, k) => `<ref>${refNum(k.trim())}</ref>`);
    const statusLabel = l => { const s = iucnOf(statusCode); return s[l] || s.en; };
    const trendLabel = l => { const t = trendOf(trendCode); return t[l] || t.en; };

    // récupère un item par chemin d'index dans une langue donnée
    function itemAt(lang, path) {
      let node = (state.langs[lang] || {}).sections || [];
      let cur = { items: node.map(s => s) }; // wrapper
      // path = [sectionIndex, itemIndex, itemIndex, ...]
      let items = node.map(s => ({ items: s.items }))[path[0]];
      if (!items) return null;
      let it = null; let arr = items.items;
      for (let d = 1; d < path.length; d++) { it = arr[path[d]]; if (!it) return null; arr = it.items || []; }
      return it;
    }
    // légende EN/FR de l'image (chemin + index image), en lisant la langue parallèle
    function capEnFr(path, ii) {
      const pick = lng => { const it = itemAt(lng, path); return it && it.images && it.images[ii] ? (it.images[ii].cap || "") : ""; };
      return { en: pick("en"), fr: pick("fr") };
    }

    function slideshow54(images, group, globalCap, path) {
      const nSlides = Math.max(1, Math.ceil((images.length || 0) / 2));
      let slides = "";
      for (let s = 0; s < nSlides; s++) {
        let itemsH = "";
        for (let j = 0; j < 2; j++) {
          const ii = s * 2 + j, im = images[ii]; if (!im) continue;
          const c = capEnFr(path, ii);
          itemsH += `                                            <div class="gallery-5-4-item">
                                                <img src="${esc(im.src)}" class="gallery-5-4-image" data-lightbox="${group}" data-caption="${capAttr(c.en)}" data-caption-fr="${capAttr(c.fr)}" alt="${esc(im.alt || "")}" loading="lazy">
                                            </div>\n`;
        }
        slides += `                                        <div class="gallery-5-4-slide"><div class="gallery-5-4-grid">\n${itemsH}                                        </div></div>\n`;
      }
      const dots = Array.from({ length: nSlides }, (_, i) => `<span class="gallery-5-4-dot${i === 0 ? " active" : ""}"></span>`).join("");
      const gc = globalCap ? `                                <div class="gallery-5-4-global-caption">${genText(globalCap)}</div>\n` : "";
      return `                            <div class="gallery-5-4-slideshow no-borders global-caption" data-slides="${nSlides}">
                                <div class="gallery-5-4-container">
                                    <div class="gallery-5-4-slides">
${slides}                                    </div>
                                    <button class="gallery-5-4-nav gallery-5-4-prev"><i class="fas fa-chevron-left"></i></button>
                                    <button class="gallery-5-4-nav gallery-5-4-next"><i class="fas fa-chevron-right"></i></button>
                                    <div class="gallery-5-4-dots">${dots}</div>
                                </div>
${gc}                            </div>\n`;
    }

    // rend un item (path = chemin d'index vers CET item), renvoie le HTML
    function renderItem(it, path, secTitleEN, first) {
      const type = it.kind;
      const group = slugify(secTitleEN) || ("section-" + ((path[0] | 0) + 1));
      if (type === "text") return `                            <p><span>${genText(it.text)}</span></p>\n`;
      if (type === "heading") { const lvl = it.level === "h5" ? "h5" : "h4"; return `                            <${lvl}>${genText(it.text)}</${lvl}>\n`; }
      const lb = ii => { const c = capEnFr(path, ii); return `data-lightbox="${group}" data-caption="${capAttr(c.en)}" data-caption-fr="${capAttr(c.fr)}"`; };
      if (type === "distribution-map") { const im = (it.images && it.images[0]) || {}; return `                            <div class="gallery-distribution-map"><div class="distribution-map-container">
                                <img src="${esc(im.src)}" class="distribution-map-image" ${lb(0)} alt="${esc(im.alt || "")}" loading="lazy">
                                <div class="distribution-map-caption"><strong><span>${genText(im.cap || "")}</span></strong></div>
                            </div></div>\n`; }
      if (type === "gallery-full-width") { const im = (it.images && it.images[0]) || {}; return `                            <div class="gallery-full-width"><div class="gallery-full-width-item">
                                <img src="${esc(im.src)}" class="gallery-full-width-image" ${lb(0)} alt="${esc(im.alt || "")}" loading="lazy">
                                <div class="gallery-full-width-caption"><span>${genText(im.cap || "")}</span></div>
                            </div></div>\n`; }
      if (type === "gallery-5-4") return slideshow54(it.images || [], group + "-" + ((path[path.length - 1] | 0) + 1), it.globalCap, path);
      if (type === "list") {
        const lis = (it.items || []).map(li => `                                    <li>
                                        <span>${genText(li.text)}</span>
                                    </li>`).join("\n");
        return `                            <ul>
${lis}
                            </ul>\n`;
      }
      if (type === "sub-section") {
        const icon = it.icon || "fa-cogs";
        const inner = (it.items || []).map((c, ci) => renderItem(c, path.concat(ci), secTitleEN, false)).join("");
        return `                            <div class="sub-section">
                                <button class="sub-section-header"><i class="fas fa-chevron-down sub-section-arrow"></i><div class="sub-section-header-content"><i class="fas ${esc(icon)}"></i><span>${esc(it.title)}</span></div><i class="fas fa-chevron-down sub-section-arrow"></i></button>
                                <div class="sub-section-content"><div class="sub-section-body">
${inner}                                </div></div>
                            </div>\n`;
      }
      if (type === "subspecies") {
        const act = first ? " active" : "";
        const inner = (it.items || []).map((c, ci) => renderItem(c, path.concat(ci), secTitleEN, false)).join("");
        return `                        <div class="subspecies-accordion">
                            <button class="subspecies-header${act}"><i class="fas fa-chevron-down subspecies-arrow"></i><span>${genText(it.title || "")}</span></button>
                            <div class="subspecies-content${act}"><div class="subspecies-body">
${inner}                            </div></div>
                        </div>\n`;
      }
      // galerie grille (16-9 / 2-3)
      if (BLOCK_OK[type]) {
        const cls = type, imgCls = cls + "-image", itemCls = cls + "-item", gridCls = cls + "-grid", capCls = cls + "-caption";
        const items = (it.images || []).map((im, ii) => `                                    <div class="${itemCls}">
                                        <img src="${esc(im.src)}" class="${imgCls}" ${lb(ii)} alt="${esc(im.alt || "")}" loading="lazy">
                                        <div class="${capCls}"><span>${genText(im.cap || "")}</span></div>
                                    </div>`).join("\n");
        return `                            <div class="${cls}"><div class="${gridCls}">\n${items}\n                            </div></div>\n`;
      }
      // inconnu -> texte de secours
      return it.text ? `                            <p><span>${genText(it.text)}</span></p>\n` : "";
    }

    function generateBody(lang, opts) {
      opts = opts || {};
      const bc = opts.breadcrumb ? "\n" + opts.breadcrumb : "";
      const c = state.langs[lang];
      let ssFirstSeen = false;
      const acc = (c.sections || []).map((s, si) => {
        const icon = s.icon || guessIcon(s.title);
        const cnt = countImages(s.items);
        const badge = cnt > 0 ? `<div class="images-badge"><i class="fas fa-image"></i><span>${cnt}</span></div>` : "";
        const body = (s.items || []).map((it, ii) => {
          const first = it.kind === "subspecies" && !ssFirstSeen ? (ssFirstSeen = true, true) : false;
          return renderItem(it, [si, ii], (((state.langs.en || {}).sections || [])[si] || {}).title || s.title, first);
        }).join("");
        const act = si === 0 ? " active" : "";
        return `                <div class="accordion-item">
                    <button class="accordion-header${act}"><div class="accordion-header-content"><i class="fas ${esc(icon)}"></i><span>${esc(s.title)}</span></div>${badge}<i class="fas fa-chevron-down accordion-arrow"></i></button>
                    <div class="accordion-content${act}"><div class="accordion-body">
${body}                    </div></div>
                </div>`;
      }).join("\n");
      const refsAcc = refs.length ? `                <div class="accordion-item">
                    <button class="accordion-header"><div class="accordion-header-content"><i class="fas fa-book"></i><span>${lang === "ar" ? "المراجع" : (lang === "fr" ? "Références" : "References")}</span></div><i class="fas fa-chevron-down accordion-arrow"></i></button>
                    <div class="accordion-content"><div class="accordion-body"><div class="references-section">
                        <ol class="references-list">${refs.map((r, i) => `<li id="ref-${i + 1}">${esc(r.text)}</li>`).join("")}</ol>
                    </div></div></div>
                </div>` : "";
      return `    <section class="species-section"><div class="container">
            <div class="species-title-header"><div class="species-names">
                <h1>${esc(c.name)}</h1><p class="scientific-name"><em>${esc(c.sci)}</em></p>
            </div></div>${bc}
            <div class="conservation-status-band">
                <div class="status-item"><span class="status-label">${STATUS_LBL[lang] || STATUS_LBL.en}</span><span class="status-value"><span>${esc(statusLabel(lang))}</span></span></div>
                <div class="status-item"><span class="status-label">${TREND_LBL[lang] || TREND_LBL.en}</span><span class="status-value"><span>${esc(trendLabel(lang))}</span></span></div>
            </div>
            <div class="intro-split"><div class="intro-text"><p><span>${genText(c.intro)}</span></p></div>
                <div class="intro-image-container"><div class="intro-image-wrapper">
                    ${c.introMap ? '<button class="image-toggle-btn"><i class="fas fa-globe-africa"></i></button>' : ""}
                    <img src="${esc(c.introImg)}" class="intro-image" id="species-image" alt="${esc(c.name)}" loading="lazy">
                    ${c.introMap ? `<img src="${esc(c.introMap)}" class="intro-image hidden" id="map-image" alt="" loading="lazy">` : ""}
                </div></div>
            </div>
            <div class="accordion-container">
${acc}
${refsAcc}
            </div>
    </div></section>`;
    }
    return { generateBody };
  }
  function generateBody(state, lang, opts) { return makeGen(state).generateBody(lang, opts); }
  return { generateBody, slugify, esc, IUCN, TREND };
});
