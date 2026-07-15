# Fauna Morocco — Éditeur (backend autonome)

Dépôt **public** volontairement : il ne contient **aucune photo ni aucun mot de passe**
(juste le code serveur). Les mots de passe et le token vivent uniquement dans Render.
La publication des fiches écrit dans le dépôt privé du site via `GITHUB_TOKEN`.

## Déploiement Render (sans connexion GitHub)

1. Render → **New → Web Service** → onglet **« Public Git Repository »**.
2. Colle l'URL de CE dépôt (ex. `https://github.com/rayanevuill/fauna-editor`) → **Continue**.
3. Réglages :
   - **Root Directory** : *(laisser vide)*
   - **Build Command** : `npm install`
   - **Start Command** : `node server.js`
   - **Instance** : Free
4. **Environment → Add Environment Variable** :

   | Clé | Valeur |
   |---|---|
   | `EDITOR_PASSWORD` | mot de passe d'édition (équipe) |
   | `PUBLISH_PASSWORD` | mot de passe de publication (relecteur) |
   | `GITHUB_TOKEN` | token GitHub fine-grained, Contents: Read and write sur `Site-Fauna-Morocco` |

   Optionnel : `GITHUB_REPO` (défaut `rayanevuill/Site-Fauna-Morocco`).

5. **Create Web Service** → Render te donne une URL, ex. `https://fauna-editeur.onrender.com`.

## Utilisation

- Interface : `https://<ton-url-render>/app/editeur.html`
- Clique **🌐 Serveur** → colle la même URL Render → **🔑 Se connecter** (EDITOR_PASSWORD).
- Test de vie : `https://<ton-url-render>/api/health` doit renvoyer `{"ok":true}`.
