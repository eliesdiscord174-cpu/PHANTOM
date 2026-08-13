# PHANTOM — Connexion Discord (OAuth2) + Supabase

Site avec authentification obligatoire via Discord. Toutes les données
(téléchargements, avis, membres, articles, boutique, réglages) sont
stockées dans **Supabase** (une base Postgres partagée), donc **tout le
monde voit exactement les mêmes données**, peu importe qui héberge le
serveur ou combien de fois il redémarre.

Seul le panneau `/admin` (ajout/suppression de contenus, changement des
réglages) reste réservé aux Discord ID listés dans `ADMIN_DISCORD_IDS`.

## 1. Créer le projet Supabase

1. Va sur https://supabase.com → crée un compte / projet (gratuit).
2. Dans l'onglet **SQL Editor**, colle tout le contenu du fichier
   `supabase-schema.sql` (à la racine du projet) et exécute-le. Ça crée
   toutes les tables et insère les données de départ.
3. Va dans **Project Settings → API** et récupère :
   - `Project URL` → deviendra `SUPABASE_URL`
   - `service_role` key (⚠️ pas la clé `anon`) → deviendra
     `SUPABASE_SERVICE_ROLE_KEY`

La clé `service_role` a tous les droits sur la base : elle ne doit **jamais**
être exposée au navigateur. Ici elle n'est utilisée que côté serveur
(`lib/supabase.js`), donc c'est sûr — le frontend ne parle qu'à ton API
Express (`/api/...`), jamais directement à Supabase.

## 2. Installation

```bash
npm install
cp .env.example .env
```

Puis remplis `.env` avec :
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_REDIRECT_URI`
  (portail développeur Discord)
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (étape 1)
- `ADMIN_DISCORD_IDS=1534876283421462549` (déjà pré-rempli dans
  `.env.example` — c'est ton ID)

Sous Windows, tu peux aussi lancer `setup-env.bat` qui te pose les
questions et génère `.env` pour toi.

## 3. Lancer le serveur

```bash
npm start
```

Ouvre http://localhost:3000

## Comment ça marche

- `GET /auth/discord` → redirige vers Discord pour autorisation
- `GET /auth/discord/callback` → Discord revient ici avec un `code`, le
  serveur l'échange contre un token, récupère le profil (`identify`,
  `email`), puis crée une session
- `GET /api/me` → renvoie l'utilisateur connecté (utilisé par le frontend)
- `POST /auth/logout` → déconnecte
- `GET /downloads` → page protégée : redirige vers `/auth/discord` si
  personne n'est connecté
- Toutes les autres données (`/api/downloads`, `/api/products`,
  `/api/articles`, `/api/settings`, `/api/stats`, avis, historique...) sont
  lues et écrites dans Supabase via `lib/supabase.js`

## Admin

Seuls les Discord ID listés dans `ADMIN_DISCORD_IDS` (dans `.env`) peuvent :
- accéder à `/admin`
- ajouter/supprimer des téléchargements, produits, articles
- changer le statut de détection
- modifier les textes du hero d'accueil (`/api/settings`)

## Déploiement (Render / Railway)

1. Pousse ce projet sur GitHub (le `.gitignore` fourni exclut déjà `.env` et
   `node_modules/`, donc tes clés secrètes ne partent jamais sur GitHub).
2. Sur Render : **New → Web Service**, connecte le dépôt. Build command :
   `npm install`, Start command : `npm start`.
3. Dans l'onglet **Environment**, ajoute toutes les variables de ton `.env`
   local (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_DISCORD_IDS`, `SESSION_SECRET`) et
   ajoute en plus **`NODE_ENV=production`** (active les cookies sécurisés en
   HTTPS). Ne mets pas `PORT`, Render le gère lui-même.
4. Une fois déployé, Render te donne une URL du type
   `https://ton-site.onrender.com`. Mets à jour `DISCORD_REDIRECT_URI` sur
   Render avec `https://ton-site.onrender.com/auth/discord/callback`, et
   ajoute cette même URL dans le portail développeur Discord (ton app →
   OAuth2 → Redirects).

## Avant la mise en production

- Ajoute ton domaine réel comme Redirect URI dans le portail Discord
- Change `SESSION_SECRET` par une chaîne aléatoire longue
- Active `cookie.secure = true` dans `server.js` une fois en HTTPS
- Ne commit jamais le fichier `.env` (ajoute-le à `.gitignore`)
- Ne partage jamais ta clé Supabase `service_role`
