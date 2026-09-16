# Lot F2 — stack locale complète et reproductible

Bilan daté du **16 septembre 2026**. Livrable : un seul parcours maintenu pour préparer, démarrer, vérifier, arrêter et réinitialiser une stack locale complète (catalogue, API, backend Catwalks de test, site, synchronisation des offres directes, archive RAW, boîte de réception), documenté dans [docs/stack-locale.md](../../docs/stack-locale.md). « Build vert » n’est pas le livrable : la stack a tourné, a été vérifiée en mode développement et en mode build/start, arrêtée conteneurs compris, redémarrée, et revérifiée.

## Ce qui existait, mesuré

- `npm run test:local` (`validate-local.mjs`) : une base jetable en tmpfs, migrations, suites ; rien pour faire tourner le produit. Aucun guide local pour B et W au-delà de `npm run dev` avec leurs vrais `.env.local`.
- `node_modules` du dépôt A **incapable de démarrer** une commande de collecte : `@aws-sdk/client-s3` (déclaré, présent dans le lock) absent du disque ; la date du lock ne le montrait pas.
- Les trois dépôts lisent leurs `.env.local` avec de vraies clés (Brevo, PostHog, Sentry, Firebase, Turnstile) ; Sentry s’active dès `NODE_ENV=production` avec un DSN codé en dur, donc un build/start local aurait rapporté au Sentry de production. Vérifié avec `@next/env` : une valeur posée dans l’environnement du processus prime sur `.env.local`.
- Ports du propriétaire en usage : API de développement 3010 ; par défaut site 3000, backend 3001. `*.localhost` est résolu par Chrome et Firefox sans DNS ; le `fetch` de Node refuse l’en-tête `Host`.
- Le flux d’outbox sert l’**état courant** de l’offre pour chaque ligne (la ligne ne porte que la séquence) ; l’agrégateur journalise chaque événement consommé (`DirectOfferEvent`) avec le curseur dans une transaction par événement.

## Fait

| Composant | Réalisation |
|---|---|
| Orchestrateur | `apps/aggregator/scripts/stack-local/` : `index.mjs` (commandes), `infra.mjs` (Docker par socket Unix épinglé, ports, secrets 0600, PID, restauration des fichiers réécrits par Next), `env.mjs` (environnements minimaux et explicites, tiers neutralisés), `seed.mjs` (semis synthétique par le client Prisma du backend), `verify.mjs` (18 à 19 constats, captures), `inbox.mjs` (imitation de l’API Brevo). Scripts racine `stack:*`. |
| Infrastructure | conteneurs `catwalks-stack-*` (label `catwalks.purpose=stack-local`, `--restart unless-stopped`) : PostgreSQL 18 épinglé (image de `test:local`) pour le catalogue et le backend de test, MinIO (image locale, digest enregistré) avec le bucket `catwalks-stack-observations` ; volumes nommés ; ports 56432, 56433, 56900/56901, 56025, 3110, 3101, 3100 ; refus de tout port pris, aucun conteneur étranger touché. |
| Installation | Node vérifié contre `engines` ; `npm ci` si `node_modules` manque, sinon installation **additive** depuis le lock avec sondage réel des paquets requis (résolution à la manière de Node, pas la carte `exports`) et restauration du lock s’il change ; le SDK S3 manquant a été installé ainsi, lock racine inchangé. |
| Bases et données | migrations 78 (catalogue) et 104 (backend) ; Maison « Maison Test Stack (synthétique) », 650 offres `STACK-TEST-…` sur treize villes et douze marchés, compte `candidat.stack@catwalks.test` (mot de passe privé), comptes jetables supprimés après usage ; réinitialisation bornée aux volumes de la stack. |
| Clés des deux côtés | `CATALOGUE_API_KEY` (API ↔ site) et `CATALOGUE_FLUX_KEY` (backend ↔ agrégateur) générées ; garde vérifiée sans puis avec clé, en mode dev (401) et en mode build (`NODE_ENV=production`, 401). |
| Neutralisation | Brevo dirigé vers la boîte locale (`BREVO_API_URL`), PostHog, Sentry (`SENTRY_DISABLED=1`), Firebase, Turnstile, Slack, Google, jetons Railway/Vercel : vides ou synthétiques ; environnement du shell jamais transmis. |
| Modifications locales des dépôts protégés | B `fde29ac` : `distDir` par `NEXT_DIST_DIR`, `BREVO_API_URL` surchargeable (trois modules), `SENTRY_DISABLED`, `/.next-stack/` ignoré ; témoins `src/lib/__tests__` 96 fichiers / 1 004 verts. W `2ea9f76` : `BREVO_API_URL`, `SENTRY_DISABLED` ; témoin `notification-interne` 4/4. Aucun push. Les fichiers du propriétaire restent seuls non committés. |
| A | `apps/api/next.config.mjs` : `distDir` par `NEXT_DIST_DIR` (le `.next` du serveur 3010 du propriétaire n’est plus écrasé) ; `.next-*/` et `.stack-local/` ignorés. |

## Preuves

Exécutions de référence conservées hors Git dans `backups/reprise-20260916-lotF/f2-preuves/` (rapports JSON et trois captures Chromium).

| Exécution | Résultat |
|---|---|
| `stack:prepare` | conteneurs créés, bucket créé, installations résolues, 78 + 104 migrations, 650 offres / 650 lignes d’outbox |
| `stack:verify` mode dev (18 h 56 UTC) | **18 / 18** |
| `stack:verify --mode=build` (18 h 59 UTC), builds de production des trois applications | **19 / 19**, captures `emplois-fr`, `emplois-hote-de`, `inbox` |
| arrêt serveurs + conteneurs, redémarrage, `stack:verify` (19 h 01 UTC) | **18 / 18** sans nouveau semis (curseur poursuivi à 1 064) |
| suites A sur le checkout synchronisé (`lot6-full f2`) | typecheck vert, API 251 / 251, unitaires 2 609 / 2 609, intégration 762 / 762, build API vert |

Constats notables : rejeu complet de plus de 500 offres par pages de 200 (curseur sans erreur) ; rejeu depuis zéro idempotent (0 réappliqué, 650 éligibles, aucun doublon) ; retrait puis remise en ligne (version 654 → 656, copie qui suit) ; **interruption réelle** d’une consommation d’événements neufs (processus tué après 5 événements sur 80, curseur 907) puis reprise exacte (75 restants : 35 appliqués, 40 périmés ; curseur 982 = attendu) ; API à deux origines, Catwalks en tête (100 offres FR, 50 DE) ; hôtes pays `fr`/`de`/`us` servant leur marché (le `h1` compte les offres du marché, en anglais pour `us`), hôte neutre qui invite au choix ; connexion du compte de test ; réinitialisation de mot de passe capturée par la boîte locale (template 16), rien vers Brevo.

## Ce que le lot ne prouve pas

- Le **désordre** des événements n’est pas exercé par `verify` (le flux sert l’état courant par séquence) ; il reste couvert par les témoins unitaires de `direct/feed.test.ts` (versions périmées, rejeu).
- Le redémarrage a été simulé par arrêt complet des conteneurs et serveurs, pas par un reboot du poste.
- Téléversement de CV et avatars : Firebase neutralisé, aucun bucket isolé encore (F5). Langues DE/IT/ES/NL/CN : F5 (`de.` sert l’interface française).
- Aucune offre externe dans la stack tant que F3 n’a pas ingéré des captures qualifiées ; l’archive MinIO est branchée pour cela.

## Défauts trouvés en route, corrigés

- Enveloppe `npx` tuée sans son processus fils : un `direct-sync` orphelin continuait à consommer pendant que le témoin mesurait ; désormais processus détaché et groupe tué.
- Statistiques du CLI lues au mauvais niveau (`data`) et `refus` absent quand faux ; sondage des paquets faussé par la carte `exports` de Next ; `fetch` de Node incapable d’envoyer `Host` ; limite de trois réinitialisations par compte et par heure. Chaque constat de `verify` porte maintenant ses valeurs, et un constat non concluant le dit.
- Espace disque : 1,8 Gio libres avant les builds ; libération des trois révisions Chromium inutilisées de Playwright (le dépôt n’en utilise qu’une). Les 88 Go de sauvegardes privées des lots et le disque colima ne sont pas touchés.
