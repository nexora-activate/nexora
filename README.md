# NEXORA — Déploiement sur Render (gratuit)

La plateforme NEXORA, en vrai serveur Node autonome. Elle tourne avec une
base Supabase (Postgres) et envoie ses e-mails en SMTP via Gmail.

## Ce qu'il te faut avant de commencer

- Un compte Render gratuit (render.com, pas besoin de carte bancaire).
- Un compte GitHub (pour mettre le code, Render le récupère depuis GitHub).
- Ton projet Supabase « Nexora » (déjà créé).
- Ton application Discord « sniko » (Client ID `1571508442114560112`).

## Étape 1 — Mettre le code sur GitHub

1. Va sur github.com et crée un dépôt (par exemple `nexora`). Il peut être
   privé, ça marche pareil.
2. Dans le dépôt, clique sur « Add file » puis « Upload files ».
3. Glisse TOUS les fichiers et dossiers de ce ZIP dans la page (pas le ZIP
   lui-même, son contenu). Attends que tout soit envoyé, puis « Commit ».

## Étape 2 — Créer le service sur Render

1. Va sur render.com, connecte-toi, clique sur « New + » puis
   « Web Service ».
2. Choisis ton dépôt GitHub `nexora`.
3. Remplis comme ça :
   - **Name** : `nexora`
   - **Region** : Frankfurt (Europe) de préférence.
   - **Branch** : `main`
   - **Build Command** : `bun install && bun run build`
   - **Start Command** : `bun run start`
   - **Instance Type** : `Free`
4. Clique sur « Create Web Service ». Le premier déploiement démarre.

(Si tu utilises le fichier `render.yaml` de ce ZIP, Render peut aussi
détecter la configuration tout seul avec « New + » → « Blueprint ».)

## Étape 3 — Les 5 variables d'environnement

Sur la page du service, va dans « Environment » puis « Add Environment
Variable ». Ajoute ces 5 variables (les valeurs ne sont JAMAIS à mettre
dans le code, seulement ici) :

| Variable | Valeur | Où la trouver |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:[MOT-DE-PASSE]@db.lbqnfrqsgyvhltkbnqlg.supabase.co:5432/postgres` | Remplace `[MOT-DE-PASSE]` par le mot de passe de ta base Supabase (celui que tu as défini dans Supabase > Database Settings > Reset database password). |
| `DISCORD_CLIENT_SECRET` | Le secret de ton appli Discord | Portail développeur Discord (discord.com/developers) > ton appli « sniko » > OAuth2 > Client Secret (« Reset Secret » si tu ne l'as plus). |
| `DISCORD_REDIRECT_URI` | `https://<ton-site-render>/auth/discord/callback` | Remplace `<ton-site-render>` par l'adresse que Render te donne (ex. `https://nexora-xxxx.onrender.com`). Elle doit être EXACTEMENT la même ici et dans le portail Discord (OAuth2 > Redirects). |
| `NEXORA_API_KEY` | Une longue clé au hasard, que tu choisis | Invente une longue chaîne de lettres et chiffres. Elle doit être IDENTIQUE ici et dans les variables du bot Discord « sniko bot ». |
| `GMAIL_APP_PASSWORD` | Le mot de passe d'application Gmail | Compte Google nexora.activate@gmail.com > Sécurité > Mots de passe d'application > crée-en un pour « NEXORA ». Sans lui, aucun code d'inscription ne partira par e-mail. |

Après avoir ajouté les variables, clique sur « Save Changes » : Render
redéploie tout seul.

## Étape 4 — Tester

1. Ouvre l'adresse du site (ex. `https://nexora-xxxx.onrender.com`).
2. Crée un compte avec ton e-mail : tu dois recevoir un code à 6 chiffres
   par e-mail.
3. Teste le bouton « Se connecter avec Discord » : il doit ouvrir Discord
   et revenir sur le site avec ton pseudo et ton avatar.
4. Si le bouton dit « Discord login not configured », c'est que
   `DISCORD_CLIENT_SECRET` ou `DISCORD_REDIRECT_URI` manque ou n'est pas
   identique au portail Discord.

## Pour que le bot synchronise les offres

Dans les variables d'environnement du service qui fait tourner
« sniko bot », ajoute aussi :
- `NEXORA_API_URL` = l'adresse de ton site Render
  (ex. `https://nexora-xxxx.onrender.com`)
- `NEXORA_API_KEY` = la MÊME clé que sur Render.

Le bot ira alors chercher les offres des utilisateurs sur le site et
donnera les rôles Discord automatiquement. En attendant, les offres se
gèrent avec la commande `/setplan` sur Discord.

## À savoir

- **Le gratuit s'endort** : après 15 minutes sans visite, le serveur
  s'endort. La première visite après met 30 à 60 secondes à se réveiller.
  C'est normal, ce n'est pas une panne. Les données restent en sécurité
  sur Supabase.
- **La vitrine Netlify ne change pas** : le site
  `nexora-activate94190.netlify.app` reste en ligne tel quel. Ce
  déploiement Render, c'est la vraie plateforme (comptes, connexion
  Discord, offres).
- **Ne partage jamais** `DISCORD_CLIENT_SECRET`, `NEXORA_API_KEY`,
  `GMAIL_APP_PASSWORD` ni le mot de passe de ta base dans un message
  normal : ils se mettent uniquement dans les variables d'environnement
  de Render (ou dans le coffre sécurisé pour me les transmettre).

## En cas de problème

- Le site affiche une erreur au démarrage : regarde les « Logs » du service
  sur Render, l'erreur y est écrite. Vérifie surtout que les 5 variables
  sont bien définies.
- `DATABASE_URL is not set` : la variable `DATABASE_URL` manque ou est
  vide.
- Les e-mails n'arrivent pas : vérifie `GMAIL_APP_PASSWORD` (il faut un
  mot de passe d'application, pas le mot de passe du compte Google).
