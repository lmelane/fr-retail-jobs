# Vérifier `/emplois` en local

Périmètre : recherche publique, marché et langue. `/offres`, matching et onboarding n’entrent pas dans ce contrôle ; leur refonte, décidée le 24/09/2026 (D-446 à D-451), n’est pas implémentée. Publication sur `development` uniquement.

## Chaîne réelle

Le site local appelle l’API locale, qui lit la base PostgreSQL `catwalks_consolide_rehearsal` par un tunnel local. Les identifiants restent dans `~/.catwalks/rehearsal-access.json`, hors Git. Ne jamais lancer ces commandes avec une URL de production. Pour un reçu d’exécution, cette base est une copie jetable migrée, jamais la base partagée (voir « Preuve sur copie jetable »).

Depuis la racine de l’agrégateur, vérifier le lanceur et produire une référence indépendante des réponses HTTP :

```sh
node --test apps/aggregator/scripts/ops/e2e/avec-rehearsal.test.mjs
bash apps/aggregator/scripts/ops/e2e/avec-rehearsal.sh node --import tsx apps/aggregator/scripts/ops/e2e/ancres-e2e.mts "$HOME/.catwalks/emplois-e2e-baseline.json"
```

Le lanceur impose le nom exact de la base, un hôte local et des connexions en lecture seule. Le contrôle en base vérifie également `current_database()` et `transaction_read_only`. La référence contient les identifiants publiables des offres agrégées **et** directes, sans secret. Elle expire après une heure pour les tests. La régénérer après une ingestion ou une expiration ; ne pas modifier les attentes à la main.

Démarrer l’API dans un terminal dédié :

```sh
NEXT_DIST_DIR=.next-stack bash apps/aggregator/scripts/ops/e2e/avec-rehearsal.sh npm run dev -w @catwalks/api -- --port 3010
```

Depuis le dépôt `catwalks-website`, dans un second terminal. `npm ci` supprime `node_modules` avant de réinstaller : ne jamais le lancer dans une copie qu’un processus utilise (serveur `next dev`, tests en cours). Pour ce passage E2E, préférer une copie temporaire détachée, sans nouvelle branche (`git worktree add --detach <dossier temporaire> <révision>`), puis la retirer à la fin (`git worktree remove <dossier temporaire>`). Cette copie ne contient pas les fichiers ignorés par Git, dont `.env.local` : les variables utiles au serveur de test se passent par l’environnement, jamais par un fichier committé.

```sh
npm ci
npx playwright install chromium
EMPLOIS_API_URL=http://localhost:3010 NEXT_DIST_DIR=.next-stack npm run dev -- --port 3020
```

Si une clé `CATALOGUE_API_KEY` est configurée, la fournir aux deux processus et au test via l’environnement privé. Ne pas la placer dans l’URL ou Git. Les ports peuvent changer ; les variables ci-dessous doivent désigner les serveurs locaux correspondants.

Depuis `catwalks-website`, lancer :

```sh
CW_E2E_BASE=http://localhost:3020 CW_E2E_API=http://localhost:3010 \
CW_E2E_BASELINE="$HOME/.catwalks/emplois-e2e-baseline.json" npm run test:e2e
```

## Ce qui est vérifié

`npm run test:e2e` exécute `src/**/*.e2e.ts` (`vitest.e2e.config.mts`), soit deux fichiers et 23 cas au commit `7ec15ca` du site. Cette section décrit ce que les tests vérifient ; elle ne vaut pas reçu d’exécution.

`src/lib/langue/__tests__/site-natif.e2e.ts` : 15 cas sur le HTML brut, lu par `fetch`, sans JavaScript. Il exige `CW_E2E_BASE`.

- La home de chaque marché servi par `/api/marches` du site (41 au moins) : statut 200, chemin `/<langue>` conservé, `html lang` égal à l’étiquette de la locale par défaut du marché, `data-marche`, un `h1` non vide.
- Neuf pages publiques sous `/it/…?marche=IT` (`about`, `entreprises`, `contact-candidat`, `recruter-un-talent`, `connexion`, `inscription`, `cgu`, `mentions-legales`, `confidentialite`) : statut 200, chemin conservé, `html lang="it-IT"`, lien vers `/it?marche=IT`.
- `/en/about?marche=IT` corrigé en `/it/about`, marché conservé.
- Un chemin inconnu, `/it/page-inconnue?marche=IT`, rend réellement 404.
- CA, CH et BE, par le proxy du site (`/api/emplois/recherche`) : mêmes identifiants de première page et même total dans chaque langue. Les langues testées sont écrites dans le test ; elles correspondent aujourd’hui aux locales du registre.

`src/lib/emplois/__tests__/e2e-multilingue.e2e.ts` : 8 cas, par l’API et dans Chromium. Il exige aussi `CW_E2E_API` et `CW_E2E_BASELINE`.

- Les locales de CA, CH et BE viennent de la référence SQL, produite depuis le registre. Le test n’en ajoute aucune.
- API, toutes les pages : mêmes identifiants que la référence SQL, sans doublon ; mêmes critères, pays, totaux, facettes et curseurs entre locales ; langue des libellés égale à la langue de la locale demandée.
- Chromium, sélecteur réel (1440 px pour CA et CH, 390 px pour BE) : le menu propose exactement les langues du marché ; le test change de langue puis revient à la première. Il attend les mêmes offres et le même total, l’attribut `lang` du contenu et de `<html>` égal à la locale, un titre, un bouton de connexion, un pied de page et des libellés de filtres traduits.
- Conservation d’une recherche filtrée non vide (mot du titre et Maison) et d’une recherche vide contenant des chiffres (`CDI 2024`), critères d’URL compris.
- Marché inconnu (`ZZ`) : refus visible. Filtre `RECHERCHE` à 390 px sur CH en allemand : bouton arrondi, focus, 12 suggestions au plus, `geneve` trouve `Genève`, navigation, fermeture par Échap. Filtre `FACETTE` : cases sans champ de recherche.
- Aucun débordement horizontal à 390 px sur la page CH filtrée ; aucune erreur JavaScript pendant les parcours du sélecteur.

Les tests unitaires restent séparés : un E2E ne se saute pas silencieusement si la chaîne ou la référence manque.

## État connu au 24/09/2026

Relevé daté, qui ne vaut pas garantie durable. Au commit `7ec15ca` du site, la partie Chromium de `e2e-multilingue.e2e.ts` visait un balisage qui n’existait plus. Elle cherchait les langues en `button[role=menuitem][lang]`, alors que `SelecteurPaysLangue.tsx` les rend en liens `<a lang>` dans `.cw-marche__locales`. Elle cherchait un `input[type=search]` dans le bloc du filtre, alors que `FiltreMenu.tsx` rend un `input.cw-filtre__recherche` de type texte, dans un menu en portail sous `body`. Ces cas ne pouvaient pas passer.

Avec le lot de correctifs du site (sélecteurs réalignés, non committé au moment du relevé), un passage du 24/09/2026 sur la base de répétition partagée a donné `site-natif.e2e.ts` à 15 sur 15 et `e2e-multilingue.e2e.ts` à 3 sur 8 :

- 3 échecs, le sélecteur réel pour CA, CH et BE : toute recherche portant `q` rend « indisponible ». La base partagée s’arrête à `20260922100000_douglas_brand_property`, soit 86 migrations sur les 90 du dépôt. Il lui manque notamment `20260924120000_search_projection` et `20260924130000_search_market_index`, qui créent la projection de recherche : `SearchGeneration` y est absente. Sans `q`, ces trois cas passent.
- 2 échecs, l’API pour CH et BE en locale allemande : le témoin lisait la facette `metier` sans filtre, alors que l’API ne la sert que sous un filtre métier (`apps/api/lib/search-plan.ts:69`), comportement retenu par D-443 §4. Le témoin a ensuite été aligné sur D-443 (point 4) dans le même lot de correctifs : il vérifie que la facette est absente sans filtre, puis lit son libellé sous `metier=sales-advisor`. Le relevé ci-dessus ne couvre pas cette version.

**Reçu d’exécution du 24/09/2026** : 23 cas sur 23 (`site-natif.e2e.ts` 15, `e2e-multilingue.e2e.ts` 8), à trois reprises, à 18:06, 18:09 et 18:13, heure de Paris (heures de départ de vitest, machine réglée sur Europe/Paris).

- Base : copie jetable de la base de répétition, dans un conteneur Docker local publié sur 127.0.0.1, migrée jusqu’à la dernière migration du dépôt (90 migrations, dernière `20260924130000_search_market_index`), projection de recherche reconstruite (40 188 documents, `pending` 0, version `search-3-20260924-v2`), puis supprimée.
- API : code de `c62a534` (`apps/api` et `packages` inchangés jusqu’à `ce08bd2`), servie sur cette copie : la base partagée n’a pas de projection de recherche et la production n’a pas les mêmes identifiants que la référence.
- Site : copie détachée à `7ec15ca`, augmentée du diff non committé de la copie de travail du site tel qu’il était à 18:01 (sélecteurs réalignés, témoin `metier` aligné sur D-443 §4). Les changements ultérieurs de cette copie de travail, dont les textes légaux (témoin unitaire : `src/lib/langue/__tests__/legal.test.ts`), ne sont pas couverts par ce reçu.
- Commande : `npm run test:e2e` avec `CW_E2E_BASE`, `CW_E2E_API` et `CW_E2E_BASELINE`, la référence étant régénérée en lecture seule à 18:04.
- Le témoin peut échouer : à 18:09, sur la même chaîne, l’ancienne version du témoin a échoué sur 2 cas et deux versions altérées ont échoué sur 3 cas chacune.

Faux rouge connu : un passage relancé dans la même minute (18:07) a rendu 21 sur 23. Un cas a lu `data-recherche="trop-de-demandes"` ; l’autre a attendu en vain le filtre `RECHERCHE`, que la page ne rend pas quand la recherche est refusée. Le site limite les rendus de `/emplois` à 60 par minute et par IP, dans la mémoire du serveur (`src/app/(site)/[langue]/emplois/PageEmplois.tsx:26,82,126` ; `rateLimit`, `src/lib/anti-abus.ts:45`). Attendre une minute entre deux passages.

## Preuve sur copie jetable

**Une preuve d’exécution ne se fait jamais sur la base de répétition partagée.** Elle s’arrête à 86 migrations sur 90 et d’autres sessions la lisent : elle n’est ni migrée ni modifiée. La preuve se fait sur une copie jetable, migrée jusqu’à la dernière migration du dépôt, puis supprimée. Procédure suivie le 24/09/2026 :

1. Copier la base partagée par une sauvegarde logique, en lecture seule, et la restaurer dans un conteneur PostgreSQL local neuf nommé `catwalks-e2e-throwaway-AAAAMMJJhhmmss`, base `catwalks_consolide_rehearsal`, dont le port 5432 est publié sur 127.0.0.1 seulement.
2. Dans un dossier hors du dépôt, par exemple `~/.catwalks/<nom du conteneur>/`, écrire `throwaway-access.json` (`PGHOST` à `127.0.0.1`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, fichier en mode 600), `throwaway.port` et `throwaway.name`.
3. Migrer la copie, puis reconstruire sa projection de recherche, par le lanceur d’écriture [avec-copie-jetable.mjs](../../apps/aggregator/scripts/ops/e2e/avec-copie-jetable.mjs), depuis la racine de l’agrégateur :

   ```sh
   export CW_COPIE_JETABLE="$HOME/.catwalks/<nom du conteneur>"
   node apps/aggregator/scripts/ops/e2e/avec-copie-jetable.mjs npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
   node apps/aggregator/scripts/ops/e2e/avec-copie-jetable.mjs npx tsx apps/api/scripts/search/index.mts rebuild
   ```

   Le lanceur sort en code 3, sans lancer la commande ni ouvrir de connexion, si l’hôte n’est pas `127.0.0.1`, si le port n’est pas celui que Docker publie pour ce conteneur, si la base n’est pas `catwalks_consolide_rehearsal`, si le dossier d’accès est dans le dépôt, ou si la commande porte `migrate reset`, `db push`, `--shadow-database-url`, `--from-migrations` ou `--to-migrations`. Il ne lit aucun `.env` et retire `DATABASE_URL`, `DIRECT_URL` et `PG*` hérités avant de poser l’URL de la copie. `apps/api/.env.local` désigne la production avec le superutilisateur (D-437) ; Next.js n’applique jamais un `.env.local` à une variable déjà posée. Ne pas utiliser `npm run db:migrate` (`prisma migrate dev`).
4. Produire la référence et démarrer l’API en lecture seule sur la copie : les commandes de « Chaîne réelle », avec `CW_REHEARSAL_ACCESS="$CW_COPIE_JETABLE/throwaway-access.json"` en préfixe.
5. Lancer l’E2E depuis une copie détachée du site (voir « Chaîne réelle »), en attendant une minute entre deux passages.
6. Supprimer le conteneur jetable et son dossier d’accès. Le reçu nomme la base réellement utilisée et sa dernière migration.

## Contrat de présentation

`locale` est un paramètre d’affichage de `/api/jobs`, `/api/companies` et `/api/offres/:id`. Il est distinct de `langue`, filtre sur la langue native des annonces. Il n’entre ni dans le plan de recherche ni dans l’empreinte du curseur. Le proxy du site le transmet aussi lors de la pagination et de l’ouverture d’une fiche.

Le registre garde la décision sur les dimensions, l’ordre et les types d’interaction. L’API traduit les libellés, jamais le texte de l’annonce. Les traductions complémentaires des métiers et secteurs vivent dans `apps/api/lib/data/taxonomy-labels.json`, séparées des règles de classification. Une traduction native du concept prime ; une traduction complémentaire n’est utilisée que si son libellé anglais de référence n’a pas changé. Un concept nouveau ou renommé conserve son libellé natif jusqu’à traduction.

Document HTML, état de `development` au commit `7ec15ca` du site, non déployé : le layout du groupe `(site)` rend côté serveur `html lang` à l’étiquette de la locale servie pour le marché (par exemple `it-IT`) et `dir="rtl"` quand la langue servie est l’arabe, soit les marchés AE et SA du registre, `ltr` sinon (`src/app/(site)/layout.tsx:30`). Aucun code client ne modifie ces attributs après hydratation : `AppliquerLangue` a été supprimé par le commit `5bd2c6a`. Le groupe `(candidat)` (`/offres`, `/maisons`, `/carriere`, `/fashion-jobs`, `/bot`, `/desabonnement` et l’espace candidat), gelé jusqu’à D-448 (24/09/2026), garde un `html lang="fr"` statique (`src/app/(candidat)/layout.tsx:15`), y compris sous un préfixe de langue lorsque `src/middleware.ts` réécrit le chemin vers ce groupe. Aucun test ne vérifie encore `dir="rtl"`.

## Vérification différentielle du 24 septembre 2026

La branche de travail couvre le contrat français unifié et les filtres stricts :
fixtures PostgreSQL locales pour CDI, CDD, stage, alternance en CDI, freelance et
valeur absente, avec les deux origines d’offres. La locale de l’annuaire ne change
ni ses identifiants, ni ses comptes, ni ses critères de pagination. Les catalogues
front sont contrôlés sans fusion avec le français. Ces preuves ciblées ne clôturent
ni la revue produit de tous les pays ni la traduction de toutes les pages du site.
