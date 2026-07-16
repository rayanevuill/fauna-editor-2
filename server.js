/* ============================================================================
   Fauna Morocco — Éditeur de fiches : back-end
   Flux : rédacteur (mdp A) -> brouillon (branche `drafts`) -> aperçu partageable
          -> relecteur (mdp B) -> publication (commit sur `main` -> déploiement auto)
   Secrets attendus (variables d'environnement Render) :
     EDITOR_PASSWORD, PUBLISH_PASSWORD, GITHUB_TOKEN
   Optionnels : GITHUB_REPO, GITHUB_BRANCH, DRAFTS_BRANCH, ALLOWED_ORIGIN, PORT
   ==========================================================================*/
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const P = require("./editor/page.js");

const {
  EDITOR_PASSWORD, PUBLISH_PASSWORD, GITHUB_TOKEN,
  GITHUB_REPO = "rayanevuill/Site-Fauna-Morocco",
  GITHUB_BRANCH = "main",
  DRAFTS_BRANCH = "drafts",
  ALLOWED_ORIGIN,
  // ---- Formulaire de contact (SMTP) ----
  SMTP_HOST, SMTP_PORT = 587, SMTP_USER, SMTP_PASS,
  CONTACT_TO = "contact@fauna-morocco.org",
  CONTACT_FROM,
  CONTACT_ORIGIN = "https://fauna-morocco.org",
  PORT = 3000
} = process.env;

// Secrets obligatoires : refuser de démarrer sans (évite jetons prévisibles / accès ouvert)
if (!EDITOR_PASSWORD || !PUBLISH_PASSWORD) {
  console.error("ERREUR : EDITOR_PASSWORD et PUBLISH_PASSWORD sont obligatoires.");
  process.exit(1);
}
if (!GITHUB_TOKEN) console.warn("Avertissement : GITHUB_TOKEN manquant — brouillons/publication indisponibles.");

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

/* CORS — n'ouvre RIEN par défaut (l'éditeur est servi en same-origin par ce back-end).
   Ne pose l'en-tête que si ALLOWED_ORIGIN est explicitement défini. */
app.use((req, res, next) => {
  if (ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-fauna-key, x-fauna-publish");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use("/api/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 20 })); // anti brute-force
app.use("/api", limiter);
app.use("/preview", limiter);

/* Front éditeur (generator.js / page.js / editeur.html servis au navigateur) */
app.use("/editor", express.static(path.join(__dirname, "editor")));
app.use("/app", express.static(path.join(__dirname, "admin")));

/* ---- Auth (mots de passe partagés, comparaison timing-safe) ---- */
function eq(a, b) {
  a = Buffer.from(String(a || "")); b = Buffer.from(String(b || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
const needEditor = (req, res, next) =>
  (EDITOR_PASSWORD && eq(req.get("x-fauna-key"), EDITOR_PASSWORD)) ? next()
    : res.status(401).json({ error: "Mot de passe d'édition invalide" });
const needPublish = (req, res, next) =>
  (PUBLISH_PASSWORD && eq(req.get("x-fauna-publish"), PUBLISH_PASSWORD)) ? next()
    : res.status(401).json({ error: "Mot de passe de publication invalide" });

/* ---- Validation ---- */
const SLUG = /^[a-z0-9-]{2,60}$/;
function validMeta(m) {
  if (!m || typeof m !== "object") return "meta manquant";
  if (!SLUG.test(m.slug || "")) return "slug invalide (a-z 0-9 -)";
  if (!m.order || !SLUG.test(m.order.slug || "")) return "ordre invalide";
  if (!m.family || !SLUG.test(m.family.slug || "")) return "famille invalide";
  return null;
}
const SAFE_PAGE = /^(fr\/|ar\/)?encyclopedia\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\.html$/;

/* ---- GitHub API ---- */
const GH = "https://api.github.com";
async function gh(p, opts = {}) {
  const r = await fetch(GH + p, {
    ...opts,
    headers: {
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "fauna-editor",
      ...(opts.headers || {})
    }
  });
  if (!r.ok && r.status !== 404) { console.error(`GitHub ${r.status}:`, (await r.text()).slice(0, 300)); throw new Error("Erreur lors de l'accès au dépôt GitHub"); }
  return r;
}
async function getFile(branch, filepath) {
  const r = await gh(`/repos/${GITHUB_REPO}/contents/${encodeURI(filepath)}?ref=${branch}`);
  if (r.status === 404) return null;
  const j = await r.json();
  return { sha: j.sha, content: Buffer.from(j.content, "base64").toString("utf8") };
}
async function putFile(branch, filepath, content, message) {
  const existing = await getFile(branch, filepath).catch(() => null);
  const body = { message, content: Buffer.from(content, "utf8").toString("base64"), branch };
  if (existing) body.sha = existing.sha;
  return (await gh(`/repos/${GITHUB_REPO}/contents/${encodeURI(filepath)}`, { method: "PUT", body: JSON.stringify(body) })).json();
}
async function deleteFile(branch, filepath, message) {
  const existing = await getFile(branch, filepath).catch(() => null);
  if (!existing) return;
  await gh(`/repos/${GITHUB_REPO}/contents/${encodeURI(filepath)}`, { method: "DELETE", body: JSON.stringify({ message, sha: existing.sha, branch }) });
}
async function ensureBranch(branch) {
  const r = await gh(`/repos/${GITHUB_REPO}/git/ref/heads/${branch}`);
  if (r.status !== 404) return;
  const main = await (await gh(`/repos/${GITHUB_REPO}/git/ref/heads/${GITHUB_BRANCH}`)).json();
  await gh(`/repos/${GITHUB_REPO}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: main.object.sha }) });
}
async function listDrafts() {
  const r = await gh(`/repos/${GITHUB_REPO}/contents/_drafts?ref=${DRAFTS_BRANCH}`);
  if (r.status === 404) return [];
  return (await r.json()).filter(f => f.name.endsWith(".json")).map(f => f.name.replace(/\.json$/, ""));
}

/* Jeton d'aperçu : HMAC(slug) — non devinable, partageable en lecture seule */
const previewToken = slug => crypto.createHmac("sha256", PUBLISH_PASSWORD || "fauna").update(slug).digest("hex").slice(0, 16);

/* ---- Routes ---- */
app.get("/api/health", (req, res) => res.json({ ok: true, service: "fauna-editor" }));

app.post("/api/login", (req, res) => {
  const p = req.body && req.body.password;
  if (PUBLISH_PASSWORD && eq(p, PUBLISH_PASSWORD)) return res.json({ ok: true, role: "publish" });
  if (EDITOR_PASSWORD && eq(p, EDITOR_PASSWORD)) return res.json({ ok: true, role: "editor" });
  res.status(401).json({ error: "Mot de passe invalide" });
});

app.get("/api/drafts", needEditor, async (req, res) => {
  try { res.json({ drafts: await listDrafts() }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/drafts/:slug", needEditor, async (req, res) => {
  try {
    if (!SLUG.test(req.params.slug)) return res.status(400).json({ error: "slug invalide" });
    const f = await getFile(DRAFTS_BRANCH, `_drafts/${req.params.slug}.json`);
    if (!f) return res.status(404).json({ error: "Brouillon introuvable" });
    res.json({ draft: JSON.parse(f.content), token: previewToken(req.params.slug) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/drafts/:slug", needEditor, async (req, res) => {
  try {
    const { meta, state } = req.body || {};
    const err = validMeta(meta); if (err) return res.status(400).json({ error: err });
    if (meta.slug !== req.params.slug) return res.status(400).json({ error: "slug incohérent" });
    if (!state || !state.langs) return res.status(400).json({ error: "state manquant" });
    await ensureBranch(DRAFTS_BRANCH);
    await putFile(DRAFTS_BRANCH, `_drafts/${meta.slug}.json`, JSON.stringify({ meta, state }, null, 2), `brouillon: ${meta.slug}`);
    const t = previewToken(meta.slug);
    res.json({ ok: true, token: t, previewUrl: `/preview/${meta.slug}?t=${t}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Aperçu partageable (lecture seule, jeton requis) — CSS/JS chargés depuis le site live */
app.get("/preview/:slug", async (req, res) => {
  try {
    if (!SLUG.test(req.params.slug)) return res.status(400).send("slug invalide");
    if (!eq(req.query.t, previewToken(req.params.slug))) return res.status(403).send("Lien d'aperçu invalide");
    const f = await getFile(DRAFTS_BRANCH, `_drafts/${req.params.slug}.json`);
    if (!f) return res.status(404).send("Brouillon introuvable");
    const { meta, state } = JSON.parse(f.content);
    const lang = (req.query.lang === "fr" || req.query.lang === "ar") ? req.query.lang : "en";
    if (!state.langs[lang]) return res.status(404).send("Langue non disponible dans ce brouillon");
    const { html } = P.buildPage(meta, state, lang, { absoluteRoot: true });
    res.set("Content-Type", "text/html; charset=utf-8").send(html);
  } catch (e) { res.status(500).send(e.message); }
});

/* Publication (mdp B) : génère EN + FR, commit sur main, supprime le brouillon */
app.post("/api/publish/:slug", needPublish, async (req, res) => {
  try {
    if (!SLUG.test(req.params.slug)) return res.status(400).json({ error: "slug invalide" });
    const f = await getFile(DRAFTS_BRANCH, `_drafts/${req.params.slug}.json`);
    if (!f) return res.status(404).json({ error: "Brouillon introuvable" });
    const { meta, state } = JSON.parse(f.content);
    const err = validMeta(meta); if (err) return res.status(400).json({ error: err });
    const slug = meta.slug, order = meta.order.slug, family = (meta.family && meta.family.slug) || "";
    const iucn = (state.statusCode || "").toUpperCase();
    const files = [];   // {path, html} -> UN SEUL commit atomique

    // 1) La ou les fiche(s) EN/FR/AR (SEULEMENT cette espèce)
    // On génère la fiche pour toute langue ayant un nom, un nom scientifique OU du contenu
    // (avant : nom obligatoire → fiche non créée si seul le nom scientifique était rempli).
    const langs = ["en", "fr", "ar"].filter(l => {
      const c = state.langs && state.langs[l]; if (!c) return false;
      return (c.name||"").trim() || (c.sci||"").trim() || ((c.sections||[]).length > 0);
    });
    if (!langs.length) return res.status(400).json({ error: "fiche vide : renseigne au moins le nom scientifique." });
    for (const l of langs) {
      const { path: pth, html } = P.buildPage(meta, state, l);
      if (!SAFE_PAGE.test(pth)) return res.status(400).json({ error: "chemin non autorisé : " + pth });
      files.push({ path: pth, html });
    }
    // chemin de la fiche EN relatif à la page d'ordre (pour le lien du menu)
    const hrefRel = P.pagePath(meta, "en").replace(/^encyclopedia\//, "").replace(/\/{2,}/g, "/");

    // 2) Liste maîtresse : marquer l'espèce EN LIGNE (statut binaire) + pastille UICN
    const lf = await getFile(GITHUB_BRANCH, "editor/species-list.json").catch(() => null);
    const list = lf ? JSON.parse(lf.content) : JSON.parse(fs.readFileSync(path.join(__dirname, "species-list.json"), "utf8"));
    list.menus = list.menus || {};
    let famObj = null;
    (list.groups || []).forEach(g => (g.families || []).forEach(F => {
      if (F.slug === family && F.order === order) famObj = F;
      (F.species || []).forEach(s => { if (s.slug === slug) { s.status = "published"; s.iucn = iucn; } });
    }));

    // 3) Mettre à jour UNIQUEMENT la page de menu concernée (isolé)
    const menu = list.menus[order];
    const touchedOrders = [];
    if (menu) {
      const commonEnFr = { en: (state.langs.en || {}).name || "", fr: (state.langs.fr || {}).name || "" };
      const sci = (state.langs.en || {}).sci || (state.langs.fr || {}).sci || "";
      if (menu.mode === "species") {
        let cell = (menu.cells || []).find(c => c.slug === slug);
        if (!cell) { cell = { slug, img: `../images/encyclopedia/${order}/${slug}.jpg`, alt: { en: sci, fr: sci } }; menu.cells = menu.cells || []; menu.cells.push(cell); }
        cell.active = true; cell.iucn = iucn; cell.sci = sci; cell.common = commonEnFr; cell.hrefEN = hrefRel;
      } else { // mode famille : activer la case famille
        let cell = (menu.cells || []).find(c => c.slug === family);
        if (cell) cell.active = true;
        if (famObj) { famObj.active = true; famObj.status = "live"; }
      }
      touchedOrders.push(order);
    }

    // 4) Régénérer SEULEMENT la page d'ordre touchée (EN+FR), avec vérif structurelle
    const gridRe = /<div class="species-grid">[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/;
    for (const o of touchedOrders) {
      for (const pre of ["", "fr/"]) {
        const op = pre + `encyclopedia/${o}.html`;
        const ex = await getFile(GITHUB_BRANCH, op).catch(() => null); if (!ex) continue;
        if (!gridRe.test(ex.content)) continue;
        const grid = MENUS.orderGrid(o, list.menus[o], pre ? "fr" : "en");
        const patched = ex.content.replace(gridRe, grid + "\n            </div>\n        </section>");
        const okStruct = (patched.match(/<section/g) || []).length === (patched.match(/<\/section>/g) || []).length
          && (patched.match(/class="species-grid"/g) || []).length === 1 && patched.includes("</footer>");
        if (okStruct) files.push({ path: op, html: patched });
      }
    }
    // page famille (mode famille non hand-made) : (re)générer pour y montrer l'espèce cliquable
    if (menu && menu.mode === "family" && famObj && !PRESERVE.has(`encyclopedia/${order}/${family}.html`)) {
      const fam2 = JSON.parse(JSON.stringify(famObj)); fam2.active = true;
      MENUS.generatePages({ groups: [{ families: [fam2] }], menus: list.menus }, new Set()).forEach(pg => files.push({ path: pg.path, html: pg.html }));
    }

    // 5) liste maj
    files.push({ path: "editor/species-list.json", html: JSON.stringify(list, null, 1) });

    // 6) UN commit atomique (fiche + menu concerné + liste — rien d'autre)
    await commitFiles(files, `publication: ${slug} (en ligne)`);

    // On CONSERVE l'état publié pour rééditer à l'identique, et on nettoie le brouillon.
    await putFile(DRAFTS_BRANCH, `_states/${meta.slug}.json`, JSON.stringify({ meta, state }, null, 2), `état publié: ${meta.slug}`);
    await deleteFile(DRAFTS_BRANCH, `_drafts/${meta.slug}.json`, `publié: ${meta.slug}`);
    res.json({ ok: true, published: files.filter(x => /\.html$/.test(x.path)).map(x => x.path), note: "Fiche + menu concerné mis à jour (rien d'autre). Déploiement Hostinger (~2-3 min)." });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// État d'une fiche déjà publiée (pour la rééditer). Renvoie { meta, state }.
app.get("/api/state/:slug", needEditor, async (req, res) => {
  try {
    if (!SLUG.test(req.params.slug)) return res.status(400).json({ error: "slug invalide" });
    const f = await getFile(DRAFTS_BRANCH, `_states/${req.params.slug}.json`).catch(() => null);
    if (!f) return res.status(404).json({ error: "aucun état enregistré" });
    res.json(JSON.parse(f.content));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ============================================================================
   Formulaire de contact — POST /api/contact
   Le site statique (fauna-morocco.org) envoie le message ici en JSON ; on relaie
   par e-mail via SMTP. Protégé par : CORS restreint à CONTACT_ORIGIN, rate-limit,
   honeypot anti-bot, et bornes de longueur. Variables d'env requises pour l'envoi :
     SMTP_HOST, SMTP_USER, SMTP_PASS   (SMTP_PORT optionnel, défaut 587)
   Optionnelles : CONTACT_TO, CONTACT_FROM, CONTACT_ORIGIN
   ==========================================================================*/
let _mailer = null;
function mailer() {
  if (_mailer) return _mailer;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null; // non configuré -> route renvoie 503
  _mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return _mailer;
}

// CORS spécifique au formulaire public (autorise uniquement le site)
app.use("/api/contact", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", CONTACT_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
// Anti-abus : 5 envois / 15 min / IP
app.use("/api/contact", rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false }));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (v, n) => String(v || "").trim().slice(0, n);

app.post("/api/contact", async (req, res) => {
  try {
    const b = req.body || {};
    // Honeypot : champ caché "company" — rempli = bot. On répond OK sans rien envoyer.
    if (clip(b.company, 100)) return res.json({ ok: true });

    const name = clip(b.name, 120);
    const email = clip(b.email, 160);
    const message = clip(b.message, 5000);
    if (!name || !email || !message) return res.status(400).json({ error: "Champs requis manquants." });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Adresse e-mail invalide." });
    if (message.length < 10) return res.status(400).json({ error: "Message trop court." });

    const tx = mailer();
    if (!tx) return res.status(503).json({ error: "Service e-mail non configuré." });

    await tx.sendMail({
      from: CONTACT_FROM || `"Fauna Morocco" <${SMTP_USER}>`,
      to: CONTACT_TO,
      replyTo: `"${name}" <${email}>`,
      subject: `Contact site — ${name}`,
      text: `Nom : ${name}\nE-mail : ${email}\n\n${message}\n`,
      html: `<p><strong>Nom :</strong> ${name}<br><strong>E-mail :</strong> ${email}</p>`
          + `<p style="white-space:pre-wrap">${message.replace(/</g, "&lt;")}</p>`
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("Contact:", e.message);
    res.status(500).json({ error: "Envoi impossible pour le moment." });
  }
});


const fs = require("fs");
const MENUS = require("./editor/menu-generator.js");
const IMG_OK = /^images\/encyclopedia\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/[\w.-]+\.(jpe?g|png|webp)$/i;
async function putBinary(branch, filepath, b64, message) {
  const existing = await getFile(branch, filepath).catch(() => null);
  const body = { message, content: b64, branch }; if (existing) body.sha = existing.sha;
  return (await gh(`/repos/${GITHUB_REPO}/contents/${encodeURI(filepath)}`, { method: "PUT", body: JSON.stringify(body) })).json();
}
async function commitFiles(files, message) {
  const b = GITHUB_BRANCH;
  const ref = await (await gh(`/repos/${GITHUB_REPO}/git/ref/heads/${b}`)).json();
  const baseSha = ref.object.sha;
  const baseCommit = await (await gh(`/repos/${GITHUB_REPO}/git/commits/${baseSha}`)).json();
  const tree = files.map(f => ({ path: f.path, mode: "100644", type: "blob", content: f.html }));
  const treeR = await (await gh(`/repos/${GITHUB_REPO}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }) })).json();
  const commitR = await (await gh(`/repos/${GITHUB_REPO}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: treeR.sha, parents: [baseSha] }) })).json();
  await gh(`/repos/${GITHUB_REPO}/git/refs/heads/${b}`, { method: "PATCH", body: JSON.stringify({ sha: commitR.sha }) });
}
const PRESERVE = new Set(["encyclopedia/serpentes/viperidae.html","encyclopedia/serpentes/elapidae.html","encyclopedia/sauria/varanidae.html","encyclopedia/sauria/chamaeleonidae.html"]);
app.post("/api/upload", needEditor, async (req, res) => {
  try {
    const fp = (req.body && req.body.path) || "";
    if (!IMG_OK.test(fp)) return res.status(400).json({ error: "chemin d'image non autorisé" });
    const m = /^data:image\/[a-z+]+;base64,(.+)$/i.exec((req.body && req.body.data) || "");
    if (!m) return res.status(400).json({ error: "image invalide" });
    if (m[1].length > 9000000) return res.status(413).json({ error: "image trop lourde" });
    await putBinary(GITHUB_BRANCH, fp, m[1], `image: ${fp}`);
    res.json({ ok: true, path: fp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/species-list", needEditor, async (req, res) => {
  try {
    const f = await getFile(GITHUB_BRANCH, "editor/species-list.json").catch(() => null);
    if (f) return res.set("Content-Type", "application/json").send(f.content);
    res.set("Content-Type", "application/json").send(fs.readFileSync(path.join(__dirname, "species-list.json"), "utf8"));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/species-list", needEditor, async (req, res) => {
  try {
    const incoming = req.body || {};
    // PROTECTION : ne jamais écraser le bloc `menus` (source de vérité des pages d'ordre).
    // Si le client n'envoie pas de menus, on conserve celui déjà en dépôt.
    if (!incoming.menus) {
      const cur = await getFile(GITHUB_BRANCH, "editor/species-list.json").catch(() => null);
      if (cur) { try { const j = JSON.parse(cur.content); if (j.menus) incoming.menus = j.menus; } catch (e) {} }
    }
    const data = JSON.stringify(incoming, null, 1);
    if (data.length > 2000000) return res.status(413).json({ error: "liste trop lourde" });
    await putFile(GITHUB_BRANCH, "editor/species-list.json", data, "maj liste des especes");
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/publish-menus", needPublish, async (req, res) => {
  try {
    let list = (req.body && req.body.groups) ? req.body : null;
    if (!list) { const f = await getFile(GITHUB_BRANCH, "editor/species-list.json").catch(() => null); list = f ? JSON.parse(f.content) : JSON.parse(fs.readFileSync(path.join(__dirname, "species-list.json"), "utf8")); }
    const files = MENUS.generatePages(list, PRESERVE);
    const menus = list.menus || {};
    for (const order of Object.keys(menus)) {
      for (const pre of ["", "fr/"]) {
        const op = pre + `encyclopedia/${order}.html`;
        const ex = await getFile(GITHUB_BRANCH, op).catch(() => null);
        if (!ex) continue;
        const grid = MENUS.orderGrid(order, menus[order], pre ? "fr" : "en");
        // Remplace TOUTE la grille (jusqu'a la fermeture grille + conteneur + section),
        // ancre sur </section> qui est unique -> ne peut plus tronquer ni dedoubler.
        const gridRe = /<div class="species-grid">[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/;
        if (!gridRe.test(ex.content)) { console.warn("grille introuvable, page ignoree:", op); continue; }
        const patched = ex.content.replace(gridRe, grid + "\n            </div>\n        </section>");
        // Garde-fou structurel : la page doit rester equilibree et n'avoir qu'une grille.
        const okStruct = (patched.match(/<section/g)||[]).length === (patched.match(/<\/section>/g)||[]).length
          && (patched.match(/class="species-grid"/g)||[]).length === 1
          && patched.includes("</footer>");
        if (!okStruct) { console.warn("structure invalide apres patch, page ignoree:", op); continue; }
        files.push({ path: op, html: patched });
      }
    }
    if (!files.length) return res.status(400).json({ error: "rien a generer" });
    await commitFiles(files, "maj menus encyclopedie (tableau de bord)");
    res.json({ ok: true, count: files.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================================
// Bascule d'un ORDRE en ligne / coming-soon sur la PAGE D'ACCUEIL de l'encyclopédie.
// ISOLÉ : ne touche QUE encyclopedia.html (EN) + fr/encyclopedia.html. Un seul commit.
// ============================================================================
function toggleLandingCard(html, order, online, href) {
  const imgE = ("images/encyclopedia/" + order + ".jpg").replace(/[.\/]/g, "\\$&");
  if (online) {
    const re = new RegExp('<div class="species-item coming-soon">((?:(?!species-item)[\\s\\S])*?' + imgE + '(?:(?!species-item)[\\s\\S])*?)\\s*<span class="coming-soon-badge">[^<]*</span>\\s*</div>');
    if (!re.test(html)) return { html: html, changed: false };
    return { html: html.replace(re, '<a href="' + href + '" class="species-item">$1</a>'), changed: true };
  }
  const re = new RegExp('<a href="[^"]*' + order + '\\.html" class="species-item">((?:(?!species-item)[\\s\\S])*?' + imgE + '(?:(?!species-item)[\\s\\S])*?)</a>');
  if (!re.test(html)) return { html: html, changed: false };
  return { html: html.replace(re, '<div class="species-item coming-soon">$1    <span class="coming-soon-badge">Coming Soon</span>\n    </div>'), changed: true };
}
app.post("/api/landing-toggle/:order", needPublish, async (req, res) => {
  try {
    const order = req.params.order;
    if (!/^[a-z]+$/.test(order)) return res.status(400).json({ error: "ordre invalide" });
    // Le serveur DÉTECTE l'état actuel et l'INVERSE (afficher <-> masquer). Toujours isolé (accueil EN+FR).
    const ref = await getFile(GITHUB_BRANCH, "encyclopedia.html").catch(() => null);
    if (!ref) return res.status(500).json({ error: "accueil introuvable" });
    const currentlyOnline = new RegExp('<a href="[^"]*' + order + '\\.html" class="species-item">[\\s\\S]*?images/encyclopedia/' + order + '\\.jpg').test(ref.content);
    // état explicite si fourni (afficher/masquer au choix), sinon on inverse l'état actuel
    const online = (req.body && typeof req.body.online === "boolean") ? req.body.online : !currentlyOnline;
    if (online === currentlyOnline) return res.json({ ok: true, online: online, note: `« ${order} » était déjà ${online ? "en ligne" : "masqué"} sur l'accueil.` });
    const files = [];
    for (const p of ["encyclopedia.html", "fr/encyclopedia.html"]) {
      const ex = await getFile(GITHUB_BRANCH, p).catch(() => null); if (!ex) continue;
      const r = toggleLandingCard(ex.content, order, online, "encyclopedia/" + order + ".html");
      const same = (r.html.match(/species-image/g) || []).length === (ex.content.match(/species-image/g) || []).length;
      if (r.changed && same) files.push({ path: p, html: r.html });
    }
    if (!files.length) return res.status(404).json({ error: "carte introuvable" });
    await commitFiles(files, `accueil: ${order} ${online ? "en ligne" : "masqué"}`);
    res.json({ ok: true, online: online, note: `« ${order} » est maintenant ${online ? "EN LIGNE" : "MASQUÉ (coming soon)"} sur l'accueil. Déploiement ~2-3 min.` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bascule d'une CASE (famille ou espèce) cliquable/coming-soon sur SA page d'ordre. Isolé.
app.post("/api/menu-toggle/:order/:slug", needPublish, async (req, res) => {
  try {
    const order = req.params.order, slug = req.params.slug;
    if (!/^[a-z]+$/.test(order) || !/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: "paramètre invalide" });
    const lf = await getFile(GITHUB_BRANCH, "editor/species-list.json").catch(() => null);
    const list = lf ? JSON.parse(lf.content) : JSON.parse(fs.readFileSync(path.join(__dirname, "species-list.json"), "utf8"));
    const menu = (list.menus || {})[order];
    if (!menu) return res.status(404).json({ error: "page d'ordre inconnue" });
    const cell = (menu.cells || []).find(c => c.slug === slug);
    if (!cell) return res.status(404).json({ error: "case introuvable dans ce menu" });
    // état explicite si fourni, sinon on inverse
    const newState = (req.body && typeof req.body.active === "boolean") ? req.body.active : !cell.active;
    if (newState === cell.active) return res.json({ ok: true, active: newState, note: `« ${slug} » était déjà ${newState ? "cliquable" : "coming soon"}.` });
    cell.active = newState;
    const files = [];
    const gridRe = /<div class="species-grid">[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/;
    for (const pre of ["", "fr/"]) {
      const op = pre + `encyclopedia/${order}.html`;
      const ex = await getFile(GITHUB_BRANCH, op).catch(() => null); if (!ex) continue;
      if (!gridRe.test(ex.content)) continue;
      const grid = MENUS.orderGrid(order, menu, pre ? "fr" : "en");
      const patched = ex.content.replace(gridRe, grid + "\n            </div>\n        </section>");
      const okStruct = (patched.match(/<section/g) || []).length === (patched.match(/<\/section>/g) || []).length
        && (patched.match(/class="species-grid"/g) || []).length === 1 && patched.includes("</footer>");
      if (okStruct) files.push({ path: op, html: patched });
    }
    // mode famille : si la famille devient active et n'est pas faite main, (re)générer sa page-famille
    if (menu.mode === "family" && newState && !PRESERVE.has(`encyclopedia/${order}/${slug}.html`)) {
      let famObj = null;
      (list.groups || []).forEach(g => (g.families || []).forEach(F => { if (F.slug === slug && F.order === order) famObj = F; }));
      if (famObj) { const fam2 = JSON.parse(JSON.stringify(famObj)); fam2.active = true; MENUS.generatePages({ groups: [{ families: [fam2] }], menus: list.menus }, new Set()).forEach(pg => files.push({ path: pg.path, html: pg.html })); }
    }
    files.push({ path: "editor/species-list.json", html: JSON.stringify(list, null, 1) });
    if (files.length < 2) return res.status(500).json({ error: "aucune page d'ordre à mettre à jour" });
    await commitFiles(files, `menu ${order}: ${slug} ${newState ? "cliquable" : "coming soon"}`);
    res.json({ ok: true, active: newState, note: `« ${slug} » est maintenant ${newState ? "CLIQUABLE" : "COMING SOON"} sur la page ${order}. Déploiement ~2-3 min.` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DÉPUBLIER une espèce : la retire du menu (coming-soon), remet son statut à "todo".
// La fiche HTML reste (non liée) — réversible. Isolé : ne touche que sa page d'ordre (+ page-famille).
app.post("/api/unpublish/:slug", needPublish, async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: "slug invalide" });
    const lf = await getFile(GITHUB_BRANCH, "editor/species-list.json").catch(() => null);
    const list = lf ? JSON.parse(lf.content) : JSON.parse(fs.readFileSync(path.join(__dirname, "species-list.json"), "utf8"));
    let sp = null, famObj = null, order = null;
    (list.groups || []).forEach(g => (g.families || []).forEach(F => (F.species || []).forEach(s => { if (s.slug === slug) { sp = s; famObj = F; order = F.order; } })));
    if (!sp) return res.status(404).json({ error: "espèce introuvable dans la liste" });
    sp.status = "todo"; delete sp.iucn;
    const menu = (list.menus || {})[order];
    const files = [];
    const gridRe = /<div class="species-grid">[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/;
    if (menu) {
      if (menu.mode === "species") {
        const cell = (menu.cells || []).find(c => c.slug === slug);
        if (cell) { cell.active = false; delete cell.iucn; }
      } else {
        const stillPub = (famObj.species || []).some(s => s.status === "published");
        const cell = (menu.cells || []).find(c => c.slug === famObj.slug);
        if (cell && !stillPub) cell.active = false;
        if (!PRESERVE.has(`encyclopedia/${order}/${famObj.slug}.html`)) {
          const fam2 = JSON.parse(JSON.stringify(famObj)); fam2.active = true;
          MENUS.generatePages({ groups: [{ families: [fam2] }], menus: list.menus }, new Set()).forEach(pg => files.push({ path: pg.path, html: pg.html }));
        }
      }
      for (const pre of ["", "fr/"]) {
        const op = pre + `encyclopedia/${order}.html`;
        const ex = await getFile(GITHUB_BRANCH, op).catch(() => null); if (!ex || !gridRe.test(ex.content)) continue;
        const grid = MENUS.orderGrid(order, menu, pre ? "fr" : "en");
        const patched = ex.content.replace(gridRe, grid + "\n            </div>\n        </section>");
        const ok = (patched.match(/<section/g) || []).length === (patched.match(/<\/section>/g) || []).length && (patched.match(/class="species-grid"/g) || []).length === 1 && patched.includes("</footer>");
        if (ok) files.push({ path: op, html: patched });
      }
    }
    files.push({ path: "editor/species-list.json", html: JSON.stringify(list, null, 1) });
    await commitFiles(files, `dépublication: ${slug}`);
    res.json({ ok: true, note: `« ${slug} » retiré de la publication (coming soon). La fiche reste mais n'est plus liée. Déploiement ~2-3 min.` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ÉTAT du site (pour que le dashboard affiche ce qui est en ligne / masqué à chaque niveau).
app.get("/api/site-state", needEditor, async (req, res) => {
  try {
    const lf = await getFile(GITHUB_BRANCH, "editor/species-list.json").catch(() => null);
    const list = lf ? JSON.parse(lf.content) : JSON.parse(fs.readFileSync(path.join(__dirname, "species-list.json"), "utf8"));
    const land = await getFile(GITHUB_BRANCH, "encyclopedia.html").catch(() => null);
    const lh = land ? land.content : "";
    const landing = {};
    ["caudata", "sauria", "serpentes", "anura", "testudines", "amphisbaenia"].forEach(o => {
      landing[o] = new RegExp('<a href="[^"]*' + o + '\\.html" class="species-item">[\\s\\S]*?images/encyclopedia/' + o + '\\.jpg').test(lh);
    });
    const menus = {};
    Object.keys(list.menus || {}).forEach(o => { menus[o] = { mode: list.menus[o].mode, cells: {} }; (list.menus[o].cells || []).forEach(c => menus[o].cells[c.slug] = !!c.active); });
    const published = [];
    (list.groups || []).forEach(g => (g.families || []).forEach(F => (F.species || []).forEach(s => { if (s.status === "published") published.push(s.slug); })));
    res.json({ landing: landing, menus: menus, published: published });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Fauna editor backend écoute sur :${PORT}`));
