/* ============================================================================
   Fauna Morocco — Gabarit de page complète (navigateur + Node)
   Enveloppe le corps (generator.js) dans une page identique aux fiches du site :
   head SEO + hreflang + JSON-LD, nav, fil d'Ariane, footer, scripts.
   Chemins relatifs calculés selon la profondeur (racine / fr / ar).
   ==========================================================================*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./generator.js"), require("./generator2.js"));
  else root.FaunaPage = factory(root.FaunaGenerator, root.FaunaGenerator2);
})(typeof self !== "undefined" ? self : this, function (G, G2) {
  "use strict";
  const SITE = "https://fauna-morocco.org";
  const esc = G.esc;
  // JSON-LD sûr : sérialisation + neutralisation de "</script>" (pas d'interpolation brute)
  const jsonld = o => JSON.stringify(o, null, 2).replace(/</g, "\\u003c");
  // Chemin d'image d'intro validé (sinon image sociale par défaut) — empêche l'injection via introImg
  const safeImg = s => (/^images\/[\w./-]+\.(jpe?g|png|webp|avif)$/i.test(s || "")) ? s : "images/social/fauna-morocco-social-share.jpg";

  const NAV = {
    en: { enc: "Encyclopedia", exp: "Expeditions", abt: "About", par: "Partners", con: "Contact", don: "Donate", other: "FR" },
    fr: { enc: "Encyclopédie", exp: "Expéditions", abt: "À propos", par: "Partenaires", con: "Contact", don: "Faire un don", other: "EN" },
    ar: { enc: "الموسوعة", exp: "الرحلات", abt: "من نحن", par: "شركاء", con: "اتصل", don: "تبرّع", other: "EN" }
  };
  const CRUMB_ROOT = { en: "Reptiles & Amphibians of Morocco", fr: "Reptiles et Amphibiens du Maroc", ar: "الزواحف والبرمائيات في المغرب" };
  const REF_COPY = "© Fauna Morocco - Rayane Vuillemin. Tous droits réservés.";
  const FOOTER = { en: "Fauna Morocco | All rights reserved", fr: "Fauna Morocco | Tous droits réservés", ar: "Fauna Morocco | جميع الحقوق محفوظة" };

  const LANG_PREFIX = { en: "", fr: "fr/", ar: "ar/" };

  // Chemin relatif de la fiche pour une langue, ex: "encyclopedia/sauria/varanidae/x.html"
  function pagePath(meta, lang) {
    return LANG_PREFIX[lang] + "encyclopedia/" + meta.order.slug + "/" + meta.family.slug + "/" + meta.slug + ".html";
  }
  // Préfixe "../" pour remonter à la racine du site depuis cette page
  function rootPrefix(path) {
    const depth = path.split("/").length - 1;
    return "../".repeat(depth);
  }
  function pick(o, lang) { return (o && (o[lang] || o.en)) || ""; }

  function breadcrumb(meta, lang, root) {
    const o = meta.order, f = meta.family;
    return `            <!-- Breadcrumb -->
            <nav class="breadcrumb">
                <a href="${root}encyclopedia.html">${esc(CRUMB_ROOT[lang] || CRUMB_ROOT.en)}</a>
                <span class="breadcrumb-separator">/</span>
                <a href="${root}encyclopedia/${o.slug}.html">${esc(pick(o, lang))}</a>
                <span class="breadcrumb-separator">/</span>
                <a href="${root}encyclopedia/${o.slug}/${f.slug}.html">${esc(pick(f, lang))}</a>
                <span class="breadcrumb-separator">/</span>
                <span class="breadcrumb-current">${esc(pick(meta.common, lang))}</span>
            </nav>`;
  }

  function nav(meta, lang, root) {
    const n = NAV[lang] || NAV.en;
    // Sélecteur de langue : liens EN/FR de la fiche courante
    const enHref = root + pagePath(meta, "en");
    const frHref = root + pagePath(meta, "fr");
    const cur = lang.toUpperCase();
    const enOn = lang === "en" ? ' class="on"' : "";
    const frOn = lang === "fr" ? ' class="on"' : "";
    const GLOBE = '<svg class="glb" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18"/></svg>';
    const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';
    const ARIA = { en: "Change language", fr: "Changer de langue", ar: "تغيير اللغة" }[lang] || "Change language";
    return `    <nav><a href="${root}index.html" class="logo">FAUNA <b>MOROCCO</b></a><input class="mtog" type="checkbox" id="mnav"><details class="langm"><summary aria-label="${ARIA}">${GLOBE}<span class="cur">${cur}</span>${CHEV}</summary><div class="menu"><a href="${enHref}"${enOn} hreflang="en">EN</a><a href="${frHref}"${frOn} hreflang="fr">FR</a></div></details><label class="burger" for="mnav" aria-label="Menu"><span></span><span></span><span></span></label><div class="nl"><a href="${root}${LANG_PREFIX[lang]}encyclopedia.html" class="active">${n.enc}</a><a href="${root}${LANG_PREFIX[lang]}about.html">${n.abt}</a><a href="${root}${LANG_PREFIX[lang]}contact.html">${n.con}</a><span class="langsw">${GLOBE}<a href="${enHref}"${enOn} hreflang="en">EN</a><span class="sep">·</span><a href="${frHref}"${frOn} hreflang="fr">FR</a></span><a href="${root}${LANG_PREFIX[lang]}donate.html" class="db">${n.don}</a></div></nav>`;
  }

  function head(meta, lang, root, path) {
    const enPath = pagePath(meta, "en"), frPath = pagePath(meta, "fr");
    const title = pick(meta.title, lang), desc = pick(meta.description, lang);
    const dir = lang === "ar" ? ' dir="rtl"' : "";
    const introUrl = SITE + "/" + safeImg(meta.introImg);
    return `<!DOCTYPE html>
<html lang="${lang}"${dir}>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)} | Fauna Morocco</title>
    <meta name="description" content="${esc(desc)}">
    <meta name="copyright" content="${esc(REF_COPY)}">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="${SITE}/${path}">
    <link rel="alternate" hreflang="en" href="${SITE}/${enPath}">
    <link rel="alternate" hreflang="fr" href="${SITE}/${frPath}">
    <link rel="alternate" hreflang="x-default" href="${SITE}/${enPath}">

    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">

    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-EZ9624NH1R"></script>
    <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-EZ9624NH1R');
    </script>

    <!-- Open Graph -->
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(desc)}">
    <meta property="og:image" content="${SITE}/images/social/fauna-morocco-social-share.jpg">
    <meta property="og:url" content="${SITE}/${path}">
    <meta property="og:locale" content="${lang === "fr" ? "fr_FR" : lang === "ar" ? "ar_MA" : "en_US"}">
    <meta property="og:type" content="website">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(desc)}">
    <meta name="twitter:image" content="${SITE}/images/social/fauna-morocco-social-share.jpg">

    <!-- JSON-LD espèce -->
    <script type="application/ld+json">
    ${jsonld({
      "@context": "https://schema.org",
      "inLanguage": lang,
      "@type": "Article",
      "headline": meta.scientific + " - " + pick(meta.common, lang),
      "url": SITE + "/" + path,
      "author": { "@type": "Organization", "name": "Fauna Morocco" },
      "mainEntity": {
        "@type": "Taxon",
        "name": meta.scientific,
        "taxonRank": "species",
        "conservationStatus": meta.statusEN || "",
        "nativeCountry": "Morocco"
      }
    })}
    </script>

    <!-- Favicons -->
    <link rel="icon" type="image/svg+xml" href="${root}images/favicons/favicon.svg" />
    <link rel="shortcut icon" href="${root}images/favicons/favicon.ico" />
    <link rel="apple-touch-icon" sizes="180x180" href="${root}images/favicons/apple-touch-icon.png" />
    <link rel="manifest" href="${root}images/favicons/site.webmanifest" />
    <meta name="theme-color" content="#C06A2C">

    <link rel="preconnect" href="https://cdnjs.cloudflare.com">
    <!-- Stylesheets -->
    <link rel="stylesheet" href="${root}css/general.css?v=1.1">
    <link rel="stylesheet" href="${root}encyclopedia/species-account.css?v=2.4">
    <link rel="preload" as="style" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"></noscript>
    <link rel="stylesheet" href="${root}css/reskin.css?v=1.0">
    <!-- JSON-LD image -->
    <script type="application/ld+json">
    ${jsonld({
      "@context": "https://schema.org",
      "@type": "ImageObject",
      "contentUrl": introUrl,
      "representativeOfPage": true,
      "creator": { "@type": "Person", "name": "Rayane Vuillemin" },
      "copyrightHolder": { "@type": "Organization", "name": "Fauna Morocco" },
      "copyrightNotice": REF_COPY,
      "creditText": "Rayane Vuillemin / Fauna Morocco",
      "license": SITE + "/contact.html"
    })}
    </script>
</head>`;
  }

  function footerScripts(lang, root) {
    return `    <!-- Footer -->
    <footer class="footer">
        <div class="container">
            <p>&copy; 2025 <span>${FOOTER[lang] || FOOTER.en}</span></p>
        </div>
    </footer>

    <!-- Scripts -->
    <script src="${root}js/general.js?v=1.1"></script>
    <script src="${root}encyclopedia/species-account.js?v=1.1"></script>
    <script src="${root}encyclopedia/references.js"></script>
    <script src="${root}js/image-protection.js"></script>
</body>
</html>`;
  }

  // Construit la page complète pour une langue. Retourne { path, html }.
  function buildPage(meta, state, lang, opts) {
    opts = opts || {};
    const path = pagePath(meta, lang);
    const root = opts.absoluteRoot ? SITE + "/" : rootPrefix(path);
    const bc = breadcrumb(meta, lang, root);
    // Détecte le modèle : v2 = sections à `items` ordonnés -> générateur v2.
    const anyLang = (state.langs && (state.langs.en || state.langs.fr || state.langs.ar)) || {};
    const isV2 = ((anyLang.sections) || []).some(function (s) { return s && s.items; });
    const body = (isV2 && G2 ? G2 : G).generateBody(state, lang, { breadcrumb: bc });
    const html = head(meta, lang, root, path) + "\n<body>\n" + nav(meta, lang, root) + "\n\n" + body + "\n\n" + footerScripts(lang, root) + "\n";
    return { path: path, html: html };
  }

  return { buildPage: buildPage, pagePath: pagePath };
});
