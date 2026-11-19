# NEXORA — version Netlify (plan gratuit, sans carte bancaire)

Plateforme NEXORA (ex-SnikoLabs, v29) adaptée pour **Netlify** : le client
React est servi en fichiers statiques, et la RPC `POST /actions` tourne
dans une Netlify Function Node.js (`netlify/functions/actions.ts`).
Aucun serveur persistant, aucune carte bancaire, aucune vérification
par téléphone : le plan gratuit de Netlify suffit.

⚠️ **Ce dépôt, c'est la plateforme** (comptes, offres, connexion
Discord), **pas la vitrine**. La vitrine Netlify
(https://nexora-activate94190.netlify.app) reste en ligne telle quelle
sur son propre site : la plateforme doit être déployée sur un
**NOUVEAU site Netlify séparé**. Ne jamais déployer ce code sur le
site de la vitrine, et ne jamais glisser ce dossier sur Netlify Drop
(le Drop ne déploie que des fichiers statiques : il faut passer par
GitHub, étape 2 ci-dessous).

## Ce qui est dedans

- `client/` — l'application React (5 langues, thème noir et blanc).
  Construite par Bun pendant le build Netlify (`bun ./client/build.mjs`),
  servie ensuite en fichiers statiques depuis `client/dist`.
- `netlify/functions/actions.ts` — la Netlify Function : `POST /actions`,
  le même handler RPC que le serveur local (`server/src/rpc.ts`).
- `netlify/functions/healthz.ts` — `GET /healthz`, répond `{ ok: true }`.
- `server/src/` — les actions (comptes, codes 6 chiffres, Discord OAuth,
  offres, `getDiscordRoles`, Patron, support), la base Drizzle/Postgres,
  l'envoi SMTP Gmail. **Aucune API Bun** : ce code tourne sous Node.js.
- `drizzle/` — les migrations SQL Postgres 0001 à 0007 (idempotentes).
- `netlify.toml` — build (installe Bun, construit le client), dossier
  des fonctions, redirections (`/actions` et `/healthz` vers les
  fonctions, repli SPA vers `index.html`).

Fonctionnalités conservées : inscription en 2 étapes avec vrai code à
6 chiffres par e-mail, connexion e-mail + Discord OAuth2 (application
« sniko », Client ID `1571508442114560112`, scope `identify`, échange du
code côté serveur), offres par utilisateur + badges (free par défaut,
premium, premium+, annuelle ; durées 24 h / 30 j / 150 j / 365 j),
`getDiscordRoles` pour le bot (clé `NEXORA_API_KEY`), Patron réservé à
l'e-mail `isaac.201294dz@gmail.com`, easter egg « voleur » si le pseudo
est « sniko », support et demandes de serveur par e-mail, 5 langues.

## 1. Mettre le code sur GitHub

Le dépôt `nexora-activate/nexora` existe déjà (code version Vercel).
Remplace son contenu par ce dossier (branche `main`) : le plus simple
est de glisser-déposer les fichiers dans l'interface GitHub, ou en
ligne de commande depuis ce dossier :

```bash
git init
git add .
git commit -m "NEXORA — version Netlify"
git branch -M main
git remote add origin https://github.com/nexora-activate/nexora.git
git push -u origin main --force
```

## 2. Créer un NOUVEAU site Netlify (séparé de la vitrine)

1. Va sur https://app.netlify.com et connecte-toi (compte Netlify
   existant — pas besoin de numéro de téléphone).
2. **Add new site > Import an existing project** > choisis GitHub
   (compte `nexora-activate`) puis le dépôt `nexora-activate/nexora`.
3. Netlify lit `netlify.toml` tout seul : Build command, Publish
   directory (`client/dist`) et Functions directory
   (`netlify/functions`) sont déjà réglés — rien à changer.
4. Ne clique pas encore sur **Deploy** : d'abord les variables
   d'environnement (étape 3), puis **Deploy**.
5. Netlify donne au site une adresse auto-générée du type
   `https://<nom-hasard>.netlify.app` : note-la, c'est l'adresse
   publique de la plateforme. Tu peux la renommer après dans
   **Site settings > Site details > Change site name** (par exemple
   `nexora-plateforme`).

## 3. Variables d'environnement

Dans le NOUVEAU site Netlify : **Site settings > Environment
variables** (cocher **Production** pour chacune). Les valeurs exactes
sont dans `.env.example` — ne mets JAMAIS de vraie valeur dans le code.

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | URI du **pooler** Supabase (voir ci-dessous) |
| `DISCORD_CLIENT_SECRET` | Secret Discord (à réinitialiser dans le portail développeur, il n'est pas copiable) |
| `DISCORD_REDIRECT_URI` | `https://<ton-site-plateforme>.netlify.app/auth/discord/callback` |
| `NEXORA_API_KEY` | Longue chaîne aléatoire (32 caractères ou plus), la même que côté bot |
| `GMAIL_APP_PASSWORD` | Mot de passe d'application Gmail de nexora.activate@gmail.com |

**DATABASE_URL — très important.** En serverless, il faut l'URI du
**pooler** Supabase, pas la connexion directe :
Supabase > dashboard du projet **nexora** > bouton **Connect** >
onglet **Transaction pooler** > copier l'URI (port `6543`, avec
`?pgbouncer=true`). La connexion directe (`db.<ref>.supabase.co:5432`)
utilise IPv6 et ne marche pas de façon fiable depuis Netlify.

**DISCORD_REDIRECT_URI** doit être enregistrée **à l'identique** dans
le portail développeur Discord (application « sniko » >
OAuth2 > Redirects > Add Redirect), sinon le login Discord échoue.

Si les variables ont été ajoutées après le premier déploiement, il
faut redéployer : **Deploys > Trigger deploy > Deploy site**.

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

1. Dans Netlify : **Deploys** — le déploiement se lance tout seul à
   chaque push sur `main` (ou **Trigger deploy > Deploy site**).
2. Ouvre `https://<ton-site-plateforme>.netlify.app/` : la page NEXORA
   s'affiche.
3. Ouvre `https://<ton-site-plateforme>.netlify.app/healthz` :
   `{"ok":true}`.
4. Teste l'inscription : crée un compte, reçois le code à 6 chiffres
   par e-mail, vérifie-le. Sans `GMAIL_APP_PASSWORD`, le code ne part
   pas et l'inscription l'indique proprement.
5. Teste le login Discord : clique sur « Se connecter avec Discord »,
   autorise, le pseudo + avatar apparaissent sur le profil. Si le
   bouton dit « Discord login not configured », c'est que
   `DISCORD_CLIENT_SECRET` ou `DISCORD_REDIRECT_URI` manque ou que
   l'URI n'est pas enregistrée dans le portail Discord.
6. En cas d'erreur sur une action, regarde les journaux de la
   fonction : **Functions > actions > Function log** dans Netlify.

## 6. Brancher le bot Discord

Dans l'environnement du service `sniko-bot` :

- `NEXORA_API_URL` = `https://<ton-site-plateforme>.netlify.app`
- `NEXORA_API_KEY` = la même valeur que sur Netlify

Puis redémarre le bot. Sa boucle `plan_sync` (toutes les 5 minutes)
appelle `getDiscordRoles` et synchronise les rôles d'offres sur NEXORA.

## Limites connues (plan gratuit Netlify)

- **Durée max d'une fonction : 10 secondes** (plan gratuit, non
  modifiable). Les actions NEXORA (base + SMTP) prennent normalement
  moins de 2 s.
- **Démarrage à froid** : après quelques minutes sans visite, la
  première requête met quelques secondes à répondre (la fonction se
  réveille). Ensuite c'est instantané.
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

Pour tester une Netlify Function en local sans déployer :
`npx netlify-cli dev` (après `npm install -g netlify-cli`), ou
simplement le serveur local ci-dessus — les deux appellent le même
handler RPC (`server/src/rpc.ts`).

## Fichiers à ne jamais mettre en ligne

Pas de `node_modules/`, pas de `client/dist/`, pas de `.env`, pas de
`app.db` dans le dépôt : `.gitignore` les exclut (Netlify reconstruit
tout au déploiement).
