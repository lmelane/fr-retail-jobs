# Lot 12 — suppression du legacy et documentation

Bilan daté du **16 septembre 2026**. Périmètre : les trois espaces de travail du dépôt agrégateur (`apps/api`, `apps/aggregator`, `packages/db`), leurs scripts et leurs documents maintenus. Le site candidat et le backend restent locaux et hors de ce lot, sauf ce qui est dit au § Décisions ouvertes.

## État avant, mesuré

- **API du catalogue** : un service qui ne sert plus que des routes API depuis D-420 (14/09), mais dont l’arbre portait encore les vestiges de Mode Careers : 17 modules `lib/intelligence/*` (1 565 lignes) sans appelant hors témoins et hors `country-ids`, quatre témoins dédiés dont deux ignorés à chaque validation (`intelligence-facts`, gardés par `READ_ONLY_CORPUS_TEST`), un script `test:sql`, 14 dépendances d’interface (leaflet, react-leaflet, d3-geo, topojson-client, world-atlas, radix-ui, shadcn, lucide-react, motion, clsx, class-variance-authority, tailwind-merge, tailwindcss, tw-animate-css, `@tailwindcss/postcss` et leurs types), `components.json`, `postcss.config.mjs`, `DESIGN.md` (renvoyant à un `design_2.md` absent du dépôt), un hook vidéo, des polices, un logo et une vidéo sous `public/`, un artefact Playwright versionné (`test-results/.last-run.json`), une CSP autorisant les tuiles OpenStreetMap et les favicons DuckDuckGo « pour la carte », et des règles `.gitignore` visant `apps/web`.
- **Code sans consommateur**, relevé par un outil écrit pour ce lot sur l’API du compilateur TypeScript ([`scripts/exports-morts.mts`](scripts/exports-morts.mts), rejouable) : sur 667 fichiers, 55 exports sans aucun usage (24 agrégateur, 30 API dont les racines Next, 1 base), 41 exports de production consommés par leurs seuls témoins, 5 modules sans importeur. Première version de l’outil trompeuse : elle excluait tout dossier nommé `coverage`, donc l’atelier de qualification `scripts/coverage` ; corrigée avant toute suppression.
- **Scripts d’exploitation** : 37 fichiers de `scripts/ops` absents du README du dossier, dont 16 sans aucune référence dans le dépôt ; le README mentionnait aussi trois scripts supprimés depuis, à titre historique.
- **Documents** : 251 fichiers Markdown suivis, 18 hors `audits/` ; contrôle automatique des chemins et liens cités : un seul chemin mort (`apps/web`, dans `source-access.md`) ; la mention « anciens écrivains non liés au registre » signalée par la passation était déjà au passé composé (supprimés en 5G3B3B).
- **`verif:couverture`** (passation §11.2) : la référence n’est plus cassée — le script `scripts/ops/verif-couverture-registre.mts` existe et `apps/aggregator/package.json`, modifié par le propriétaire et non committé, le déclare ; rien à faire, rien touché.

## 12A — vestiges de l’interface dans l’API (commit `8d5104b`, 47 fichiers)

- `lib/intelligence/*`, ses quatre témoins et `test:sql` supprimés ; la seule fonction vivante, `knownAlpha2()`, vit dans `lib/iso-alpha2.ts` (mêmes 249 codes, même ordre, générés depuis la table numérique historique). Les deux témoins de base qui prenaient l’oracle Intelligence (`headline`, `closedFacts`) comptent désormais directement (`publicJobSql`, `prisma.job.count`).
- Dépendances d’interface retirées ; `package-lock.json` passe de 677 à 247 entrées ; `npm ci` rejoué sur le checkout de vérification depuis ce lock, Leaflet et Tailwind absents de `node_modules` après réinstallation.
- Fichiers retirés : `components.json`, `postcss.config.mjs`, `DESIGN.md`, `hooks/use-hero-video.ts`, `public/brand/*`, `public/fonts/*`, `public/fashion-atlas-logo.svg`, `test-results/.last-run.json` ; `public/.gitkeep` reste (le `Dockerfile` copie `public/`).
- CSP réduite à ce que le service sert (`default-src 'self'`, inline toléré pour la seule page « introuvable » de Next, aucune origine tierce) ; `.gitignore` sans `apps/web`, règle générique pour les artefacts de tests et pour un futur dossier de route `*.xml`.
- Validation : API 27 fichiers / 266 témoins verts (aucun ignoré), agrégateur 169 / 2 613 et 69 / 780, build de l’API vert.

## 12B — code sans appelant et scripts (commit : voir reçu `12b-post-commit.json`)

Supprimé, chaque retrait vérifié par le relevé puis par l’exécution :

- **Modules sans importeur** : `connectors/fashionjobs/offers.ts` (lecture d’offres FashionJobs, refusée par la politique de collecte), `connectors/lvmh/publicOffers.ts`, `enrich/types.ts` (document `enrichment` jamais écrit), `lib/externalDns.ts` (contournement DNS optionnel de l’incident du 03/09, sans appelant, donc sans option d’environnement réelle), `pipeline/discoverAts.ts` et, par cascade, `discovery/serper.ts` (recherche web) avec la clé `SERPER_API_KEY` de `.env.example` ; `remediation/sourceWithdrawal.ts` (écrivain de retrait parallèle au registre, vivant par son seul témoin) ; `apps/api/lib/safe-json-ld.ts` (l’échappement JSON-LD est fait par le site depuis le lot 9).
- **Exports sans usage** : `fetchSuccessFactorsJobs`, `isApiSource`, `slugFromFashionJobsUrl`, `jobFingerprint`, `normalizeJobTitle`, `skillKind`, les types et libellés de taxonomie (`JobFamily`, `JobFunction`, `Seniority`, `SENIORITY_LABELS`, `familyOf`, `FunctionDefinition`, `JOB_FUNCTIONS`), `discoverFashionJobsCompanies`, `discoverAts` et `scoreResult` de `ats/detect.ts`, `usePublicResolver`, `compositeKey`/`splitCompositeKey`, `pickWikidataEntity`, `isProvingVerdict`, `fetchJobFromPage`, les trois prédicats de mode (`collectsAutomatically`, `publishes`, `mayCloseOnAbsence` : le pipeline n’en lisait aucun, le refresh décide sur l’attestation ; le registre garde `decideMode`, lu par `source-registry.mts` et `operations-report.mts`), les re-exports `FACT_READER_VERSION`, `EVALUATOR_VERSION`, `EMPLOYMENT_LABELS`, `MAX_TERMES` ; côté API `companyPath`, `companyIdentitySql`, `Country`, `oublierComptesPerimetre`, `paysConnu`, `OccupationPresentation`, `getOccupationMetrics`, `sectorJoin`, `sectorSql`, `languageLabel` ; côté base `sameAmount`.
- **Locals et imports inutilisés** (balayage `tsc --noUnusedLocals` sur les deux applications et les scripts, jusqu’à zéro hors environnement) : vingt-cinq retraits, dont `CAREERS_LINK_RE`, `WORK_TIME_PATTERNS`, `flattenJsonLd`, trois fixtures Tapestry `brand-*-p1` lues par une constante morte.
- **Scripts d’exploitation** : `_ca2.mts`, `_demote.mts`, `p9-ingest-facts.mts`, `p9-set-locale.mts` (mutation ponctuelle de configuration), `p9-url-proof.mts` supprimés ; les 28 autres scripts non documentés le sont désormais dans [`scripts/ops/README.md`](../../apps/aggregator/scripts/ops/README.md), en quatre sections (mesure d’un cycle, registre et rapports, fusion sans tuer un run, mesures datées rejouables), chaque lien vérifié.
- **Témoins adaptés, jamais affaiblis** : les cas qui passaient par une enveloppe retirée exercent la brique de production directement (composition page → JobPosting → description la plus riche ; classifieur compilé ; premier du classement Wikidata ; définitions des modes inlinées) ; un témoin tautologique (unicité des clés d’une `Map`) remplacé par une assertion qui peut échouer.

Conservé sciemment, et pourquoi :

- `apps/api/lib/matching/vocabulaire.ts` (sept exports, un témoin `vocabulaire-d421`) : aucun appelant de production ; c’est le vocabulaire de correspondance du matching, sujet que la passation (§17.3) réserve explicitement à une phase ultérieure. **Écart classé « décision validée non implémentée »**, à brancher ou retirer au lot matching.
- Seams de test qui observent un état interne d’un module vivant (`cooldownRemainingMs`, `rateLimitHits`, `resetRateLimitSignal`, `setWafPrimer`, `clearWafTokens`), fixtures du flux direct (`direct/fixture.ts`), re-exports de types, constantes de décision de `packages/db/marches.ts` (`SEUIL_FACETTE_DENSE`, `PLANCHER_FACETTE_DENSE`) et `libelleFacette`, ancre du contrat de parité avec le site.
- `scripts/coverage/*` : l’atelier de qualification des sources (§11), traité avec la qualification, pas ici.

Validation (checkout de vérification synchronisé, base jetable migrée, `lot6-check.py` puis `lot6-full.py 12b`) : Prisma généré, migrations déployées, typecheck vert (`tsc` puis `tsconfig.scripts.json`) ; API 26 fichiers / 261 témoins verts ; agrégateur unitaire 169 / 2 613 ; intégration 68 / 776 (quatre témoins retirés avec leur sujet : retrait revu, clés composites) ; build de l’API vert. Relevé final de l’outil : 652 fichiers, aucun module sans importeur, aucun import non résolu, un seul export sans usage conservé sciemment (`SPECIALISATION`, matching).

## Registre des sources : un seul parcours, une découverte qui ne certifie rien

Vérifié dans le code, pas dans la doc : `src/discovery/discoverMaisons.ts` n’écrit qu’un journal de progression (`appendFileSync`), `scripts/ops/source-discovery.mts` lit les sources ACTIVE/PAUSED et n’en modifie aucune ; aucun `update` de `Source.status` ni de revue d’identité hors du parcours `source-onboard` décrit dans [`source-onboarding.md`](../../docs/architecture/source-onboarding.md) (candidat → preuves → décision → promotion). La répétition d’un candidat identique ne réécrit ni configuration ni statut (§ Candidat du document, relu contre `source-onboard.mts` au lot 5G3B3B).

## 12C — documents

- `source-access.md` : chemin mort `apps/web` reformulé. `README.md` racine : les bilans de lots renvoient du lot 1 au lot 12. `apps/aggregator/README.md` : paragraphe des lots 6 à 9 et 12. `production-foundations.md` : ligne « API du catalogue » complétée. `scripts/ops/README.md` : voir 12B.
- Les 48 documents de `audits/reprise-2026-09-15` et les dossiers `audits/legacy-*` (rapports datés de septembre, anciens plans) sont des preuves datées identifiables : conservés, non réécrits. La passation reste une photographie de reprise, pas une documentation opérationnelle.
- Ce qui n’a PAS été vérifié : l’exactitude de chaque affirmation de fond des 17 documents hors audits (seuls les chemins, liens et mentions des éléments retirés l’ont été, automatiquement) ; les affirmations sur l’état déployé (révision `dd3e24d`, workers gelés) datent de l’audit du 15 septembre et sont à relire avant release.

## Décisions ouvertes (cartes)

🔷 **DÉCISION — bascule du circuit historique `/offres` du site**
Contexte : le site candidat sert encore, en production, sept familles de pages `/offres/*` (arrondissement, contrat, métier, secteur, spécialité, ville, fiche `[slug]`), les flux `jobs.xml`, `jobs-careerjet.xml`, `llms-full.txt` et huit sitemaps enfants ; `/emplois` reste `noindex` et son sitemap n’entre pas dans l’index (lot 9). Rien de ce circuit ne vit dans le dépôt agrégateur.
Enjeu : « zéro ancien circuit » ne peut pas s’appliquer au site sans décider la promesse publique de `/offres` (passation §17.3 : ne pas l’inventer) ; retirer ces routes avant la bascule casserait des URL indexées et des candidatures.
Options : A. Garder `/offres` comme surface publique de référence jusqu’à la décision de matching et ouvrir `/emplois` ensuite (redirections 308 des anciennes URL déjà écrites au lot 9 pour les fiches) — réversible ; B. Ouvrir `/emplois` à l’indexation maintenant (`EMPLOIS_INDEXABLE=1`) et rediriger `/offres` — peu réversible pour le référencement ; C. Retirer les flux et sitemaps `/offres` seuls — sans intérêt tant que la surface reste indexée.
Reco : A. Impact si on ne tranche pas : deux surfaces publiques coexistent, dont une non indexée ; aucune perte tant que le cutover n’est pas déclenché.

🔷 **DÉCISION — vocabulaire de matching sans appelant**
Contexte : `apps/api/lib/matching/vocabulaire.ts` (correspondances contrat, temps, télétravail, séniorité, univers ; D-421) n’est appelé par aucune route ; le matching est réservé à une phase ultérieure (§17.3).
Options : A. Conserver comme spécification exécutable, marquée ainsi (fait) ; B. Retirer et regraver au lot matching.
Reco : A, jusqu’au lot matching.

## Limites

- Le relevé de code mort est syntaxique : un symbole atteint par une chaîne (`registry[name]`) ou un chargement dynamique hors des formes reconnues ne serait pas vu comme consommé ; l’outil a été corrigé une fois (dossier `coverage`) et n’a plus signalé d’import non résolu.
- L’arbre de travail du propriétaire n’a pas `@aws-sdk/client-s3` dans `node_modules` alors que le lock et le checkout de vérification l’ont : son typecheck local de l’agrégateur échoue sur `retention/objectStore.ts` ; `npm ci` le corrigerait, non exécuté ici (environnement du propriétaire).
- Le circuit `/offres` du site, les flux et les sitemaps historiques ne sont pas touchés (carte ci-dessus).
