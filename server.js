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
    const langs = ["en", "fr", "ar"].filter(l => state.langs && state.langs[l] && (state.langs[l].name||"").trim());
    const written = [];
    for (const l of langs) {
      const { path: pth, html } = P.buildPage(meta, state, l);
      if (!SAFE_PAGE.test(pth)) return res.status(400).json({ error: "chemin non autorisé : " + pth });
      await putFile(GITHUB_BRANCH, pth, html, `publication: ${meta.slug} (${l})`);
      written.push(pth);
    }
    await deleteFile(DRAFTS_BRANCH, `_drafts/${meta.slug}.json`, `publié: ${meta.slug}`);
    res.json({ ok: true, published: written, note: "Déploiement Hostinger lancé automatiquement (~2-3 min)." });
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


/* ---- Upload d'image (compressée côté navigateur) ---- */
const fs = require("fs");
const IMG_OK = /^images\/encyclopedia\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/[\w.-]+\.(jpe?g|png|webp)$/i;
async function putBinary(branch, filepath, b64, message) {
  const existing = await getFile(branch, filepath).catch(() => null);
  const body = { message, content: b64, branch };
  if (existing) body.sha = existing.sha;
  return (await gh(`/repos/${GITHUB_REPO}/contents/${encodeURI(filepath)}`, { method: "PUT", body: JSON.stringify(body) })).json();
}
app.post("/api/upload", needEditor, async (req, res) => {
  try {
    const fp = (req.body && req.body.path) || "";
    if (!IMG_OK.test(fp)) return res.status(400).json({ error: "chemin d'image non autorisé" });
    const m = /^data:image\/[a-z+]+;base64,(.+)$/i.exec((req.body && req.body.data) || "");
    if (!m) return res.status(400).json({ error: "image invalide" });
    if (m[1].length > 9000000) return res.status(413).json({ error: "image trop lourde (max ~6 Mo)" });
    await putBinary(GITHUB_BRANCH, fp, m[1], `image: ${fp}`);
    res.json({ ok: true, path: fp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- Liste maîtresse des espèces ---- */
app.get("/api/species-list", needEditor, async (req, res) => {
  try {
    const f = await getFile(GITHUB_BRANCH, "editor/species-list.json").catch(() => null);
    if (f) return res.set("Content-Type", "application/json").send(f.content);
    res.set("Content-Type", "application/json").send(fs.readFileSync(path.join(__dirname, "species-list.json"), "utf8"));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/species-list", needEditor, async (req, res) => {
  try {
    const data = JSON.stringify(req.body, null, 2);
    if (data.length > 2000000) return res.status(413).json({ error: "liste trop lourde" });
    await putFile(GITHUB_BRANCH, "editor/species-list.json", data, "maj liste des especes");
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Fauna editor backend écoute sur :${PORT}`));
