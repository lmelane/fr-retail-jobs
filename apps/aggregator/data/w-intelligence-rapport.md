# Lot W1 — Catwalks Intelligence (pages web) — rapport

Date : 2026-09-06. Périmètre : `apps/web` uniquement. Aucun commit, aucun push.
Chaque chiffre ci-dessous vient d'une exécution (SQL sur la copie locale, `next build`, `vitest`, `curl`, Playwright).

## Ce qui est construit

**11 routes** sous `apps/web/app/intelligence/` (toutes `force-dynamic`, données mémorisées 1 h — voir « Écart ISR ») :
`/intelligence` (home : hero vert-nuit + 8 KPI, carte du monde, « où le recrutement accélère », CGHI, 6 tops, bloc W2, couverture) · `/marche` (Global Hiring Pulse : tableau par fenêtre 7 j → 12 m, CGHI, sous-indices sectoriels, contrats / séniorité / famille, aire empilée familles) · `/geographies` (carte + classement pays + top 30 villes) · `/pays/[code]` · `/villes/[slug]` (`cc-ville`) · `/metiers` (les 25 fonctions + « Non classé ») · `/metiers/[key]` · `/secteurs` (ancres `#mode`, `#luxe`, `#beaute`, `#horlogerie-joaillerie`, `#retail`, `#autres`) · `/maisons/[slug]` (+ ouvertes 7/30/90 j, intensité vs référence, nouveaux marchés) · `/groupes/[slug]` (+ tableau des Maisons du groupe) · `/methodologie`.

**Couche de données** `apps/web/lib/intelligence/` : `taxonomy.ts` (25 clés identiques au pipeline, vérifié contre `apps/aggregator/src/normalize/taxonomy.ts`), `country-ids.ts` (249 codes numériques → alpha-2, embarqué ; vérifié : 177/177 géométries de `world-atlas` résolues), `format.ts` (seuils 30 offres / 2 snapshots, formatteurs fr-FR, slugs), `metrics.ts` (indice base 100, variation J-n exacte, momentum, part, concentration, médiane, repost, intensité — pures), `facts.ts` (13 agrégats `$queryRaw` paramétrés sur `Job`, scope pays / ville / Maison / groupe / secteur / métier, jamais de `findMany`), `snapshots.ts` (lecture `MarketSnapshot`), `cache.ts`, `geo.ts` (projection Natural Earth calculée une fois, Antarctique retirée, `digits(1)`), `seo.ts`, `paths.ts`, `sitemap.ts`, `queries/` (coverage, profile, home, market, lists, methodology, resolve).

**Composants** `apps/web/components/intelligence/` : `intel-nav.tsx` (sous-nav, client), `chrome.tsx` (IntelPage, PageHead 4+6, Coverage, LevelTag FACT/DERIVED/INSIGHT, Kpi, Block, Insight, Mix, JsonLd), `profile-view.tsx` (blocs standard d'un périmètre), `world-map.tsx` (choroplèthe SVG serveur, 5 paliers `color-mix` sur `--fa-green`/`--fa-green-tint`, pays sans offre `--fa-paper-alt`, clic → page pays) + `world-map-frame.tsx` (toggle volume / nouvelles 30 j, client), `charts/` : `line-chart`, `stacked-area`, `bar-list`, `index-gauge`, `small-multiples` (SVG serveur, aucune bibliothèque) + `tip-layer` (une seule infobulle client par page, par délégation `data-tip`). Bloc CSS « Catwalks Intelligence » ajouté à `globals.css` (tokens existants, filets pointillés, radius 5 px, aucune ombre, aucune pill).

**Intégration site** : entrée « Intelligence » dans la nav principale (`site-nav.tsx`) et le footer ; chunk 0 du sitemap enrichi (6 pages statiques + pays / villes / métiers / Maisons / groupes ≥ 30 offres — mesuré en local : 6 statiques + 14 pays) ; `generateMetadata` par page (title ≤ 60 caractères testé, description, canonical, OpenGraph), `noindex, follow` sous 30 offres (vérifié : `/pays/BE` 15 offres → `<meta name="robots" content="noindex, follow"/>` ; `/pays/FR` → aucune balise), JSON-LD `Dataset` sur la home, `WebPage` + `BreadcrumbList` ailleurs, `<` échappé. `lib/countries.ts` : repli Intl (fr + en) des libellés vers ISO-2 + 8 graphies vues en base (« Corée, République de », « Hong Kong, RAS Chine »…) — sert aussi les facettes de `/emplois`.

**Dépendances ajoutées** (`apps/web/package.json`, versions exactes) : `world-atlas@2.0.2`, `topojson-client@3.1.0`, `d3-geo@3.1.1` ; dev : `@types/topojson-client@3.1.5`, `@types/d3-geo@3.1.1`, `@types/geojson@7946.0.16`. ⚠ `npm install` a modifié `package-lock.json` à la racine — inévitable pour ajouter un paquet au workspace ; c'est la seule écriture hors `apps/web` avec ce rapport.

## Vérifications exécutées

- `npx tsc --noEmit` (apps/web) : propre.
- `npx vitest run` : **54 tests, 54 verts** (26 préexistants + 28 nouveaux : `intelligence-metrics.test.ts` 14, `intelligence-format.test.ts` 11, `intelligence-facts.integration.test.ts` 2 + 1 test de config) ; les 2 d'intégration ne tournent que si `DATABASE_URL` vaut exactement l'URL locale du brief (jamais `catwalks_test`, jamais la prod), lecture seule, et vérifient que les totaux se recoupent (pays + sans pays = actives ; Maisons = actives ; scope FR = ligne FR du classement).
- `npm run build -w @catwalks/web` : **verte** ; 11 routes Intelligence en ƒ (dynamiques), 1,94 kB de JS client par page (le toggle carte + l'infobulle), 108 kB first-load partagé (identique aux autres pages).
- Serveur de dev sur la base locale : 16 routes sondées en `curl` — 200 sur les 11 pages + `/sitemaps/0`, **404** sur `/pays/XX`, `/villes/fr-nulle-part`, `/metiers/nope`, `/maisons/inconnue`.
- Serveur **production** (`.next/standalone`, base locale) : `/intelligence` 343 Ko HTML / 99 Ko gzip, 188 ms à froid, **15 ms** cache chaud ; `/pays/FR` 75 Ko / 11 Ko gzip ; `/methodologie` 88 Ko / 16 Ko. Le poids de la home vient de la carte (124 Ko de `<path>` après `digits(1)`, contre 164 Ko avant), présente dans le HTML et dans le flux RSC.
- Sonde SQL de la couche `facts` + `snapshots` + géométrie : **131 ms** pour les 25 requêtes.
- Playwright (Chromium) à **1440** et **390 px**, 11 pages × 2 = **22 captures** dans le scratchpad (`intel-home-1440.png`, `intel-pays-fr-1440.png`, `intel-metier-rca-1440.png`, `intel-maison-cartier-1440.png`, leurs `-390`, + marche, geographies, metiers, secteurs, groupe-hermes, ville-paris, methodologie). Mesuré sur chaque page : 1 seul `<h1>`, aucun débordement horizontal, 0 erreur console (une erreur de clés React dupliquées sur 3 géométries sans id a été trouvée par les captures et corrigée).

## Chiffres réels vus en local (copie `catwalks`, port 55440)

1 996 offres actives · 7 Maisons · 38 pays identifiés (+ 42 offres sans pays : 38 `country` nul, 4 graphies inconnues) · 133 villes · 0 fermée (`closedAt` nul partout) · 0 ré-ouverture · **0 `jobFunction` / `seniority` / `isRetail` / `skills`** (backfill non passé → « Non classé 100 % » affiché tel quel) · France 691 (Paris 335, Pantin 150) · US 296 · CH 169 · Cartier 1 173 (58,8 % du monde), Hermès 547, APM Monaco 84 · secteurs : Horlogerie & Joaillerie 1 257, Mode 682, Retail 57 · 416 sources ACTIVE (teamtailor 117, greenhouse 81, smartrecruiters 43, wttj 39…). Dernière observation : 2026-09-02 11:28 UTC.
**`MarketSnapshot` : 208 lignes pour le 2026-09-06** écrites par le chantier parallèle pendant ce lot (global 1, country 65, city 26, company 7, sector 3, contract 8, group 1, function/seniority/family 1 chacun, country-function 44, country-sector 50). Conséquence visible : indice « disponible à partir du 7 sept. », momentum « à partir du 13 sept. » (point J-7 requis).

## Écarts et décisions à relire

1. **ISR → cache de données.** `export const revalidate = 3600` prérend les routes statiques au **build**, et la build Railway (`apps/web/Dockerfile`) n'a pas de base : `DatabaseUnavailableError` casserait la build (cas déjà documenté sur le sitemap). Les pages restent `force-dynamic` et les agrégats passent par `unstable_cache(…, { revalidate: 3600, tags: ['intelligence'] })` (`lib/intelligence/cache.ts`) : même fraîcheur d'une heure, une erreur n'est jamais mise en cache (page d'erreur D1).
2. **Clés de snapshot réellement écrites** (`apps/aggregator/src/pipeline/snapshot.ts`, lu, non modifié) : `country` = valeur de `Job.country` (ISO-2 en prod, graphies brutes sur cette copie locale non normalisée : « France », « fr »…), `city` = `country|city`, nuls → `unclassified`, contrat nul → `UNKNOWN`. Le web lit les clés du brief (`FR`, `FR|Paris`, id de société, nom de groupe, secteur, clé de métier) : cohérent en prod, pas sur la copie locale (d'où la série pays vide ici alors que 65 lignes `country` existent).
3. **Seuil `noindex`** : posé sous 30 offres (pas seulement à 0) — une page à 5 offres reste servie mais n'entre ni dans l'index ni dans le sitemap. À confirmer.
4. **Concentration** : quand un périmètre a moins de 10 employeurs, le sous-libellé dit « N employeurs au total » (Cartier + 5 = 100 % en France, ce qui est vrai).
5. **Comptes de Maisons par pays** additionnent les graphies d'un même pays (borne haute) — dit dans la méthodologie ; disparaît avec les données ISO de prod.
6. `resolveCompany` recharge la liste des sociétés (comme `getCompanyBySlug`, qui n'expose pas l'id) ; en cas d'homonymie, la société qui a le plus d'offres vivantes l'emporte.

## Non fait, et pourquoi

- **Radar** (« si utile ») : non construit — aucune page W1 ne compare deux entités sur plusieurs axes ; à faire avec le comparateur (W2).
- **Momentum par Maison dans le tableau d'un groupe** : n/d daté ; le calculer exige une série `company` par ligne (N requêtes) — à brancher via `latestAndBefore('company', 7)` (déjà écrit dans `snapshots.ts`) quand le point J-7 existera.
- **Scopes `country-function` / `country-sector`, `ai`, `seniority`, `contract`** des snapshots : non lus en W1 (aucun bloc ne les affiche encore) ; `series()` les accepte.
- **Aire empilée familles** : implémentée (`stacked-area.tsx`, données `family` alignées sur les dates communes) mais visible seulement à partir de 2 jours de snapshots ; en attendant, n/d daté.
- **Ce qui a changé cette semaine** et **Où le recrutement accélère** : n/d datés (13 sept.), par construction.
- Les compétences (`skills[]`) et la taxonomie sont à 0 en local : blocs rendus en « aucune offre classée » + couverture 0 % ; le code lit les colonnes réelles et se remplira au backfill.
- Non couvert par des tests : le rendu des composants SVG (pas de test DOM) — vérifié visuellement sur les 22 captures.
