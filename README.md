# NEXORA — version Vercel (plan Hobby, gratuit, sans carte bancaire)

Plateforme NEXORA (ex-SnikoLabs, v29) adaptée pour **Vercel** : le client
React est servi en fichiers statiques, et la RPC `POST /actions` tourne
dans une fonction serverless Node.js (`api/actions.ts`). Aucun serveur
persistant, aucune carte bancaire : le plan Hobby de Vercel est gratuit.

La vitrine Netlify (https://nexora-activate94190.netlify.app) reste en
ligne telle quelle : ce dépôt, c'est la **plateforme** (comptes, offres,
connexion Discord), pas la vitrine.

## Ce qui est dedans

- `client/` — l'application React (5 langues, thème noir et blanc).
  Construite par Bun pendant le build Vercel (`bun ./client/build.mjs`),
  servie ensuite en fichiers statiques depuis `client/dist`.
- `api/actions.ts` — la fonction serverless Vercel : `POST /actions`,
  le même handler RPC que le serveur local (`server/src/rpc.ts`).
- `api/healthz.ts` — `GET /healthz`, répond `{ ok: true }`.
- `server/src/` — les actions (comptes, codes 6 chiffres, Discord OAuth,
  offres, `getDiscordRoles`, Patron, support), la base Drizzle/Postgres,
  l'envoi SMTP Gmail. **Aucune API Bun** : ce code tourne sous Node.js.
- `drizzle/` — les migrations SQL Postgres 0001 à 0007 (idempotentes).
- `vercel.json` — build (installe Bun, construit le client), rewrites
  (`/actions` → fonction, repli SPA vers `index.html`).

Fonctionnalités conservées : inscription en 2 étapes avec vrai code à
6 chiffres par e-mail, connexion e-mail + Discord OAuth2 (application
« sniko », Client ID `1571508442114560112`, scope `identify`, échange du
code côté serveur), offres par utilisateur + badges (free par défaut,
premium, premium+, annuelle ; durées 24 h / 30 j / 150 j / 365 j),
`getDiscordRoles` pour le bot (clé `NEXORA_API_KEY`), Patron réservé à
l'e-mail `isaac.201294dz@gmail.com`, easter egg « voleur » si le pseudo
est « sniko », support et demandes de serveur par e-mail, 5 langues.

## 1. Mettre le code sur GitHub

Le dépôt `nexora-activate/nexora` existe déjà (code version Render).
Remplace son contenu par ce dossier (branche `main`) : le plus simple
est de glisser-déposer les fichiers dans l'interface GitHub, ou en
ligne de commande depuis ce dossier :

```bash
git init
git add .
git commit -m "NEXORA — version Vercel"
git branch -M main
git remote add origin https://github.com/nexora-activate/nexora.git
git push -u origin main --force
```

## 2. Importer dans Vercel

1. Va sur https://vercel.com/new et connecte-toi avec GitHub
   (compte `nexora-activate`).
2. Choisis le dépôt `nexora-activate/nexora` > **Import**.
3. Vercel détecte tout seul : Build Command et Output Directory sont
   déjà dans `vercel.json` (rien à changer). Framework Preset : Other.
4. Ne clique pas encore sur **Deploy** : d'abord les variables
   d'environnement (étape 3), puis **Deploy**.

## 3. Variables d'environnement

Dans le projet Vercel : **Settings > Environment Variables**
(cocher **Production** pour chacune). Les valeurs exactes sont dans
`.env.example` — ne mets JAMAIS de vraie valeur dans le code.

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | URI du **pooler** Supabase (voir ci-dessous) |
| `DISCORD_CLIENT_SECRET` | Secret Discord (à réinitialiser dans le portail développeur, il n'est pas copiable) |
| `DISCORD_REDIRECT_URI` | `https://<ton-projet>.vercel.app/auth/discord/callback` |
| `NEXORA_API_KEY` | Longue chaîne aléatoire (32 caractères ou plus), la même que côté bot |
| `GMAIL_APP_PASSWORD` | Mot de passe d'application Gmail de nexora.activate@gmail.com |

**DATABASE_URL — très important.** En serverless, il faut l'URI du
**pooler** Supabase, pas la connexion directe :
Supabase > dashboard du projet **nexora** > bouton **Connect** >
onglet **Transaction pooler** > copier l'URI (port `6543`, avec
`?pgbouncer=true`). La connexion directe (`db.<ref>.supabase.co:5432`)
utilise IPv6 et ne marche pas de façon fiable depuis Vercel.

**DISCORD_REDIRECT_URI** doit être enregistrée **à l'identique** dans
le portail développeur Discord (application « sniko » >
OAuth2 > Redirects > Add Redirect), sinon le login Discord échoue.

## 4. Appliquer les migrations (une fois, en local)

En serverless, les migrations ne tournent pas au démarrage. Il faut
les appliquer **une fois** contre Supabase, depuis un ordinateur, avec
l'URI **directe** (le pooler ne supporte pas les migrations) :

```bash
npm install
DATABASE_URL="postgresql://postgres:<mot-de-passe-base>@db.<ref-projet>.supabase.co:5432/postgres" npx drizzle-kit migrate
```

C'est idempotent : relancer la commande ne recrée rien. Sans cette
étape, la première action qui touche la base répondra une erreur.

## 5. Déployer et tester

1. Dans Vercel : **Deployments > Redeploy** (si les variables ont été
   ajoutées après le premier déploiement).
2. Ouvre `https://<ton-projet>.vercel.app/` : la page NEXORA s'affiche.
3. Ouvre `https://<ton-projet>.vercel.app/healthz` : `{"ok":true}`.
4. Teste l'inscription : crée un compte, reçois le code à 6 chiffres
   par e-mail, vérifie-le. Sans `GMAIL_APP_PASSWORD`, le code ne part
   pas et l'inscription l'indique proprement.
5. Teste le login Discord : clique sur « Se connecter avec Discord »,
   autorise, le pseudo + avatar apparaissent sur le profil. Si le
   bouton dit « Discord login not configured », c'est que
   `DISCORD_CLIENT_SECRET` ou `DISCORD_REDIRECT_URI` manque ou que
   l'URI n'est pas enregistrée dans le portail Discord.

## 6. Brancher le bot Discord

Dans l'environnement du service `sniko-bot` :

- `NEXORA_API_URL` = `https://<ton-projet>.vercel.app`
- `NEXORA_API_KEY` = la même valeur que sur Vercel

Puis redémarre le bot. Sa boucle `plan_sync` (toutes les 5 minutes)
appelle `getDiscordRoles` et synchronise les rôles d'offres sur NEXORA.

## Limites connues (plan Hobby)

- **Démarrage à froid** : après quelques minutes sans visite, la
  première requête met quelques secondes à répondre (la fonction se
  réveille). Ensuite c'est instantané.
- **Durée max d'une action : 30 secondes** (réglé dans `vercel.json`).
  Les actions NEXORA (base + SMTP) prennent normalement moins de 2 s.
- **Pas de serveur persistant** : pas de tâches de fond côté
  plateforme ; tout passe par les appels `POST /actions`.
- **Base Supabase gratuite** : le pooler accepte un nombre limité de
  connexions ; le pool est limité à 5 par fonction chaude.
- **E-mails** : l'envoi des codes exige `GMAIL_APP_PASSWORD` (mot de
  passe d'application Gmail, à créer dans les paramètres Google du
  compte nexora.activate@gmail.com). Sans lui, rien ne part.
- **Comptes par navigateur** : comme avant, les comptes de la vitrine
  Netlify (stockage navigateur) ne sont PAS les comptes de cette
  plateforme (base Postgres partagée).

## Développement en local

```bash
bun install          # ou npm install
bun run build        # construit le client dans client/dist
npm start            # serveur local sur http://localhost:3000
```

Pour le local, `DATABASE_URL` peut être l'URI directe Supabase (dans
un fichier `.env`, jamais commité). Le serveur local applique les
migrations tout seul au démarrage quand la base est joignable.

## Fichiers à ne jamais mettre en ligne

Pas de `node_modules/`, pas de `client/dist/`, pas de `.env`, pas de
`app.db` dans le dépôt : `.gitignore` les exclut (Vercel reconstruit
tout au déploiement).
