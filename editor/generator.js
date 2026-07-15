/* ============================================================================
   Fauna Morocco — Générateur de fiches espèces (partagé navigateur + Node)
   Extrait de _admin-prototype/editeur.html. Produit le <body> d'une fiche avec
   les classes EXACTES du site (species-account.css / .js posent le reste).
   Usage :
     const G = require('./generator');            // Node
     const body = G.generateBody(state, 'fr');
     // navigateur : <script src="generator.js"></script> -> window.FaunaGenerator
   ==========================================================================*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FaunaGenerator = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---- Données de référence (communes) ---- */
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

  /* ---- Helpers purs ---- */
  function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  // Liste blanche des types de bloc (évite l'injection via une classe arbitraire)
  const BLOCK_OK = { "gallery-16-9": 1, "gallery-2-3": 1, "gallery-5-4": 1, "gallery-full-width": 1, "distribution-map": 1 };
  function iucnOf(c) { return IUCN.find(x => x.c === c) || IUCN[6]; }
  function trendOf(c) { return TREND.find(x => x.c === c) || TREND[0]; }
  function slugify(s) { return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
  function plainCap(s) { return esc((s || "").replace(/<[^>]+>/g, "").replace(/\*([^*\n]+)\*/g, "$1").replace(/\{\{[^}]+\}\}/g, "").trim()); }
  function guessIcon(title) {
    const t = (title || "").toLowerCase();
    if (/descript|وصف/.test(t)) return "fa-info-circle";
    if (/distrib|répart|repart|انتشار/.test(t)) return "fa-globe-africa";
    if (/habitat|موطن/.test(t)) return "fa-tree";
    if (/natural|naturelle|طبيعي/.test(t)) return "fa-leaf";
    if (/conserv|حفظ/.test(t)) return "fa-shield-alt";
    if (/référ|refer|مراجع/.test(t)) return "fa-book";
    return "fa-leaf";
  }
  function countImages(s) {
    let n = 0;
    const add = b => { if (b && b.images) n += b.images.filter(im => im.src).length; };
    (s.blocks || []).forEach(add);
    (s.subs || []).forEach(su => (su.blocks || []).forEach(add));
    (s.subspecies || []).forEach(add);
    return n;
  }

  /* ---- Générateur lié à un state (contient toutes les langues + refs + statut) ---- */
  function makeGen(state) {
    const refs = state.refs || [];
    const statusCode = state.statusCode || "LC";
    const trendCode = state.trendCode || "decreasing";

    const refNum = key => { const i = refs.findIndex(r => r.key === key); return i < 0 ? "?" : i + 1; };
    const genText = t => esc(t).replace(/\*([^*\n]+)\*/g, "<em>$1</em>").replace(/\{\{([^}]+)\}\}/g, (m, k) => `<ref>${refNum(k.trim())}</ref>`);
    const statusLabel = l => { const s = iucnOf(statusCode); return s[l] || s.en; };
    const trendLabel = l => { const t = trendOf(trendCode); return t[l] || t.en; };

    // Légendes EN + FR de la même image (par index) pour data-caption / data-caption-fr
    function capEnFr(si, bi, ii) {
      const pick = lng => { const b = ((((state.langs[lng] || {}).sections || [])[si] || {}).blocks || [])[bi]; return b && b.images && b.images[ii] ? b.images[ii].cap : ""; };
      return { en: pick("en"), fr: pick("fr") };
    }
    function capSubEnFr(si, ki, ii) {
      const pick = lng => { const su = ((((state.langs[lng] || {}).sections || [])[si] || {}).subspecies || [])[ki]; return su && su.images && su.images[ii] ? su.images[ii].cap : ""; };
      return { en: pick("en"), fr: pick("fr") };
    }

    function slideshow54(images, group, globalCap, capOf) {
      const nSlides = Math.max(1, Math.ceil((images.length || 0) / 2));
      let slides = "";
      for (let s = 0; s < nSlides; s++) {
        let items = "";
        for (let j = 0; j < 2; j++) {
          const ii = s * 2 + j, im = images[ii]; if (!im) continue;
          const c = capOf ? capOf(ii) : { en: im.cap, fr: im.cap };
          items += `                                            <div class="gallery-5-4-item">
                                                <img src="${esc(im.src)}" class="gallery-5-4-image" data-lightbox="${group}" data-caption="${plainCap(c.en)}" data-caption-fr="${plainCap(c.fr)}" alt="${esc(im.alt || "")}" loading="lazy">
                                            </div>\n`;
        }
        slides += `                                        <div class="gallery-5-4-slide"><div class="gallery-5-4-grid">\n${items}                                        </div></div>\n`;
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

    function genSub(su) {
      const icon = su.icon || "fa-cogs";
      const body = (su.text || "").split(/\n{2,}/).filter(p => p.trim()).map(p => `                                    <p><span>${genText(p.trim())}</span></p>\n`).join("");
      return `                            <div class="sub-section">
                                <button class="sub-section-header"><i class="fas fa-chevron-down sub-section-arrow"></i><div class="sub-section-header-content"><i class="fas ${esc(icon)}"></i><span>${esc(su.title)}</span></div><i class="fas fa-chevron-down sub-section-arrow"></i></button>
                                <div class="sub-section-content"><div class="sub-section-body">
${body}                                </div></div>
                            </div>\n`;
    }

    function genSubspecies(su, si, ki, first) {
      const enTitle = ((((state.langs.en || {}).sections || [])[si] || {}).subspecies || [])[ki];
      const group = (enTitle && slugify(enTitle.title)) || ("subspecies-" + (ki + 1));
      const act = first ? " active" : "";
      const show = (su.images && su.images.length) ? slideshow54(su.images, group, su.globalCap, ii => capSubEnFr(si, ki, ii)) : "";
      const paras = (su.text || "").split(/\n{2,}/).filter(p => p.trim()).map(p => `                                    <p>${genText(p.trim())}</p>\n`).join("");
      return `                        <div class="subspecies-accordion">
                            <button class="subspecies-header${act}"><i class="fas fa-chevron-down subspecies-arrow"></i><span>${genText(su.title || "")}</span></button>
                            <div class="subspecies-content${act}"><div class="subspecies-body">
${show}${paras}                            </div></div>
                        </div>\n`;
    }

    function genBlock(b, si, bi, lang) {
      const type = (b.type === "text" || !BLOCK_OK[b.type]) ? "text" : b.type;
      if (type === "text") return `                            <p><span>${genText(b.text)}</span></p>\n`;
      const cls = type, imgCls = cls + "-image", itemCls = cls + "-item", gridCls = cls + "-grid", capCls = cls + "-caption";
      const group = slugify((((state.langs.en || {}).sections || [])[si] || {}).title) || ("section-" + (si + 1));
      const lb = ii => { const c = capEnFr(si, bi, ii); return `data-lightbox="${group}" data-caption="${plainCap(c.en)}" data-caption-fr="${plainCap(c.fr)}"`; };
      if (cls === "distribution-map") {
        const im = (b.images && b.images[0]) || {};
        return `                            <div class="gallery-distribution-map"><div class="distribution-map-container">
                                <img src="${esc(im.src)}" class="distribution-map-image" ${lb(0)} alt="${esc(im.alt || "")}" loading="lazy">
                                <div class="distribution-map-caption"><strong><span>${genText(im.cap || "")}</span></strong></div>
                            </div></div>\n`;
      }
      if (cls === "gallery-full-width") {
        const im = (b.images && b.images[0]) || {};
        return `                            <div class="gallery-full-width"><div class="gallery-full-width-item">
                                <img src="${esc(im.src)}" class="gallery-full-width-image" ${lb(0)} alt="${esc(im.alt || "")}" loading="lazy">
                                <div class="gallery-full-width-caption"><span>${genText(im.cap || "")}</span></div>
                            </div></div>\n`;
      }
      if (cls === "gallery-5-4") {
        return slideshow54(b.images || [], group + "-" + (bi + 1), b.globalCap, ii => capEnFr(si, bi, ii));
      }
      const items = (b.images || []).map((im, ii) => `                                    <div class="${itemCls}">
                                        <img src="${esc(im.src)}" class="${imgCls}" ${lb(ii)} alt="${esc(im.alt || "")}" loading="lazy">
                                        <div class="${capCls}"><span>${genText(im.cap || "")}</span></div>
                                    </div>`).join("\n");
      return `                            <div class="${cls}"><div class="${gridCls}">\n${items}\n                            </div></div>\n`;
    }

    function generateBody(lang, opts) {
      opts = opts || {};
      const bc = opts.breadcrumb ? "\n" + opts.breadcrumb : "";
      const c = state.langs[lang];
      const acc = c.sections.map((s, idx) => {
        const icon = s.icon || guessIcon(s.title);
        const cnt = countImages(s);
        const badge = cnt > 0 ? `<div class="images-badge"><i class="fas fa-image"></i><span>${cnt}</span></div>` : "";
        const body = (s.blocks || []).map((b, bi) => genBlock(b, idx, bi, lang)).join("") + (s.subs || []).map(genSub).join("") + (s.subspecies || []).map((su, ki) => genSubspecies(su, idx, ki, ki === 0)).join("");
        const act = idx === 0 ? " active" : "";
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
