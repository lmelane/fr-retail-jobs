# Audit a2 — architecture et robustesse du pipeline (`apps/aggregator/src`)

Date : 2026-09-06, 09:55 → 10:10 UTC. Lecture du code à HEAD `1a58761`, tests exécutés en local, mesures en **lecture seule** sur la base de prod (`sakura.proxy.rlwy.net`, scripts `src/discovery/a2-*.mts`, SELECT uniquement).

⚠️ Pendant l'audit, une autre session écrivait en prod (D36 : `retire-source kering --external-prefix`, `retire-source loreal`, fusion L'Oréal). Les compteurs ont bougé entre deux requêtes (offres actives : 75 915 à 09:58, 73 491 à 10:04 ; `kering` ids-URL : 1 467 → 325). Chaque chiffre porte son heure.

Tests : `npm run test:unit` → 40 fichiers, 438 tests, 0 échec (981 ms). `test:integration` sur `catwalks_test` → 13 fichiers, 66 tests, 0 échec (2,1 s). Deux batteries **hors scripts** (voir C-19) : 5 fichiers unitaires (34 tests) et `src/dedup` (13 tests, base) — passent aussi.

---

## BLOQUANT

### B-1 — 1 855 offres vivantes portent une JobSource inactive : elles seront fermées (410) au prochain refresh, puis ré-ouvertes par l'ingest suivant

**Fait mesuré (10:04 UTC)** : 1 855 offres `isActive=true` dont AUCUNE JobSource n'est active (0 offre sans JobSource du tout). Leur `Job.lastSeenAt` est du 06/09 (ré-attestées ce matin) alors que la JobSource date du 03/09 ou 04/09 :

| source | offres | Job.lastSeenAt | JobSource.lastSeenAt |
|---|---|---|---|
| element-6 | 386 | 2026-09-06 | 2026-09-04 |
| jean-paul-gaultier-5 | 220 | 2026-09-06 | 2026-09-04 |
| a-derma-4 | 208 | 2026-09-06 | 2026-09-03 |
| aptar-beauty | 194 | 2026-09-06 | 2026-09-03 |
| conde-nast-france | 138 | 2026-09-06 | 2026-09-03 |

Exemple : job `cmtk0hj910a3ps32bk77maveb` (« Sr. Training Manager, Biotherm », AVATURE, `l-oreal-professionnel` #254155) : `Job.lastSeenAt` 06/09 09:51, JobSource `isActive=false`, `lastSeenAt` 04/09 01:29.

**Cause** — `src/dedup/upsert.ts` :
- L135-138 : la recherche de cluster ne regarde que `isActive: true` ET la `clusterKey` gravée à la création.
- L163-239 : quand la recherche rate, `createJob` viole l'unique `(companyId, source, externalId)` et le **chemin de récupération P2002** (L190-237) met à jour le Job (`lastSeenAt`, `isActive: true`, titre, ville…) mais **ne touche jamais la JobSource** (ni `lastSeenAt`, ni `isActive`, ni `title`, ni `url`) et **ne réécrit jamais `clusterKey`** (seul `createJob` L314 l'écrit).
- La recherche rate de façon PERMANENTE dès que la clé gravée diverge de la clé recalculée : **4 906 offres actives** ont une `clusterKey` ≠ `blockingKey` d'aujourd'hui (`a2-clusterdrift.mts`), dont **1 449 des 1 855** offres du constat (78 %). Origine : les normalisations de lieu ont changé après l'écriture (`ADIDAS|` gravé alors que `location="Singapore, SG"` donne `ADIDAS|SINGAPORE` ; `L_OREAL_PROFESSIONNEL|` : 1 782 offres, 461 villes, une seule clé). Les ~400 restantes passent par le même chemin sur un titre changé (« Apply Now » → vrai titre : 1 277 offres mono-source ont `JobSource.title ≠ Job.title`).
- `src/pipeline/refresh.ts` L95-102 ne lit que `JobSource.lastSeenAt` → il désactive la JobSource après 48 h et L153-162 ferme le Job ; l'ingest suivant retombe dans le chemin P2002 (le job fermé n'est plus dans le cluster) et le ré-ouvre sans réactiver la JobSource. **Cycle quotidien : 410 la nuit, 200 le matin.** Preuve du cycle déjà joué : 550 offres fermées ont un `Job.lastSeenAt` > 1 h après leur dernière JobSource.

**Impact** : candidat — 1 855 offres réelles alternent expirée/active ; Google reçoit un 410 puis un 200 chaque jour sur les mêmes URLs (D22 cassée) ; le filtre Source (`apps/web/lib/jobs.ts` L218/434, `sources.some.isActive`) ne les montre pas. Loïc — le refresh à la reprise (D36 : ingest → refresh) fermera ces 1 855 offres vivantes.

**Correction** :
1. Dans `upsertDeduplicated`, chercher d'abord l'identité exacte `findUnique({companyId, source, externalId})` (actives ET fermées) AVANT le cluster : c'est le cas le plus fréquent, il est indexé, et il supprime la course P2002 pour une ré-attestation.
2. Toute ré-attestation (chemin exact, chemin P2002, `attachToExisting`) passe par UNE fonction qui met à jour Job **et** JobSource (`lastSeenAt`, `isActive`, `title`, `url`) et **réécrit `clusterKey`** quand elle a changé.
3. Test d'intégration : « une offre fermée, re-listée par sa source sous un lieu normalisé différemment, revient active avec sa JobSource active et sa clusterKey à jour ; un refresh immédiat ne la ferme pas ».
4. Réparation one-shot : réactiver les JobSource des 1 855 offres (leur Job vient d'être re-attesté) et recalculer `clusterKey` sur les 4 906 offres dérivées (sinon `reconcile.ts` L31-35, qui groupe par clé gravée, ne peut pas non plus fusionner).

### B-2 — Trois sources `icims` ACTIVE (2 252 offres déclarées) ne sont jamais planifiées, sans aucun signal

**Fait mesuré (09:59 UTC)** : `Source` kind=`icims` : `urbn-hub` (1 329 offres vérifiées), `urbn-stores` (906), `aeropostale` (17), toutes ACTIVE, `lastRunStatus = null`, **0 ligne SourceRun**. Ce sont les 3 seules sources ACTIVE sans `lastRunStatus`.

**Cause** : `src/pipeline/ingest.ts` L346-386 `KIND_TO_ATS` n'a pas d'entrée `icims` alors que l'adaptateur existe (`src/ats/adapters/icims.ts`, 5 tests) et que le dispatcher le sert (`src/ats/index.ts` L80). `ingestOrchestrator.ts` L88 filtre `KIND_TO_ATS[source.kind]` → la clé n'entre pas dans le run ; `health.ts` n'en entend jamais parler ; le digest Brevo non plus.

**Impact** : 2 252 offres absentes du site. Aucune alerte possible par construction (une source jamais lancée n'a pas de « run précédent »).

**Correction** : ajouter `icims: 'ICIMS'` ; test unitaire « chaque `AtsType` servi par `dispatch` a une clé dans `KIND_TO_ATS` » ; dans `loadActiveSources`, refuser (erreur nommée) une source ACTIVE dont le kind n'a pas d'adaptateur, au lieu de la laisser hors du run.

### B-3 — Le registre `registry.ts` fait tourner 6 routes sitemap à côté de la table Source : 663 offres en double, une fausse alerte par run, un « 0 » enregistré OK à chaque run

**Fait mesuré (09:58 UTC)**, `JobSource` par clé et forme d'id (`http…` = route sitemap du registre ; autre = adaptateur de la table Source) :

| clé | ids API (actifs) | ids URL (actifs) | offres portant les deux |
|---|---|---|---|
| courir | 410 (409) | 410 (407) | **0** |
| galeries-lafayette | 170 (168) | 168 (168) | **0** |
| lacoste | 469 (460) | 98 (88) | **0** |
| puig | 12 (12) | — (route registre : 0 offre, 21 runs à zéro) | — |
| decathlon | — (pas de ligne Source) | 319 (136) | — |
| wttj | — (pas de ligne Source) | 33 (21) | — |

Aucune offre ne porte les deux ids → **407 + 168 + 88 = 663 postes affichés deux fois** (Courir : une fiche SmartRecruiters + une fiche sitemap pour chaque poste). `SourceRun` : deux lignes par run et par clé au même `ranAt` — `lacoste` alterne `OK 450 / DEGRADED 87 (« 81 % fewer »)` à chaque run (08:23, 09:35) ; `courir` `OK 395 / OK 375` ; `puig` `OK 12 / OK 0`.

**Cause** :
- `src/pipeline/ingest.ts` L566-571 fusionne `plainHttpSources()` (registre) et la table par `key` ; `runIngest({only:'lacoste'})` lance L657 la source API **et** L675 la route sitemap sous la même clé.
- `src/dedup/upsert.ts` L149-154 : même `sourceKey`, `externalId` différent ⇒ « autre poste » (garde D-01) ⇒ deux Jobs.
- `checkSourceHealth` reçoit deux `IngestStats` pour la même clé ; `health.ts` L219-249 écrit deux `SourceRun` au même `ranAt` ; `previousCounts` L204-215 prend l'une des deux au hasard ⇒ DEGRADED fictif de Lacoste dans le digest.
- `decathlon` et `wttj` n'existent pas dans `Source` (4 clés orphelines dans JobSource : `decathlon` 319, `wttj` 33, `iwc-schaffhausen-3` 441, `loreal` 939 à 09:58 / 0 à 10:02) : DEC-3 (« l'ingest lit la base ») est faux pour ces routes, et `retire-source` (D27) n'a pas de ligne à passer RETIRED.
- Le registre porte 13 entrées ; seules les 6 `SITEMAP_JSONLD` tournent (L566-568) ; `richemont`, `sephora` (XML_FEED), `hermes`, `apec`, `france-travail` (PUBLIC_API), `lvmh`, `fashionjobs` (BROWSER_REQUIRED) sont du code mort ; `EXCLUDED_SOURCES`, `employerSources()`, `jobboardSources()` n'ont **aucun** lecteur. Kering a eu exactement ce défaut (D36) ; Courir/GL/Lacoste sont le même cas, non traité.

**Impact** : candidat — 663 doublons visibles ; Loïc — un email DEGRADED faux par run (Lacoste), et deux sources mortes (puig sitemap, wttj sitemap : 14 offres/run derrière le WAF) qui consomment du temps de run.

**Correction** : supprimer `registry.ts` du chemin d'exécution (D5). Les 6 routes deviennent des lignes `Source` (kind `generic-listing`/sitemap, avec `jobUrlPattern`) **ou** disparaissent : `courir`, `galeries-lafayette`, `lacoste`, `puig` (doublons de leur ligne API → `retire-source <clé> --external-prefix=https://` comme pour Kering), `wttj` sitemap (morte, D35), `decathlon` (à recataloguer, voir I-3). `SourceTier` reste dans `match.ts`. Test : « une clé n'apparaît qu'une fois dans `allSourceKeys` ET ne produit qu'un `IngestStats` ».

---

## IMPORTANT

### I-1 — Un zéro silencieux passe encore : après un run BROKEN, le run suivant à 0 est enregistré **OK** et le refresh ferme les offres

**Fait mesuré (09:59 UTC)** : 66 lignes `SourceRun` `status='OK', jobs=0` sur 17 sources, dont des sources qui produisaient : `nordstrom` (max 1 294, 2 runs à 0 en OK), `rolex` (208, 2), `michael-page-france` (3 869, 5), `prada-beauty-8` (1 380, 4), `sephora-france` (24, **9** runs OK à 0 d'affilée les 05/09 et 06/09). Séquence type `sephora-france` : `… OK 0 (prev 0) ×4 → DEGRADED 24`.

**Cause** : `src/pipeline/health.ts` L90 (`jobs === 0 && before > 0` → BROKEN) et L101 (`before > 0 && …` → DEGRADED) exigent un run précédent > 0. Après un BROKEN (jobs=0 enregistré), `before = 0` : ni BROKEN, ni DEGRADED ; L186-187 `fetched < 20` saute la porte de couverture ⇒ **OK**. Puis `refresh.ts` L64-79 n'exclut que les sources dont le DERNIER run est BROKEN/TIMEOUT/ERROR : dès le 2ᵉ run à zéro, la source est « OK » et ses offres sont fermées au refresh suivant (48 h). Le digest Brevo n'envoie qu'un email (le 1ᵉʳ BROKEN), puis silence.

**Impact** : une source morte n'est signalée qu'une fois ; ses offres sont fermées 48 h plus tard alors que D32(c) veut les garder ; une source qui décline de 40 % par run (100 → 60 → 36) n'est jamais signalée (seuil `< 0,5 × précédent`).

**Correction** : baseline = **dernier run > 0** (pas le dernier run) ; un run à 0 reste BROKEN tant que ce dernier run > 0 existe dans l'historique ; comparer aussi au max des N derniers runs (déclin cumulé). Tests : « BROKEN puis 0 → BROKEN », « 100/60/36 → DEGRADED au 3ᵉ ».

### I-2 — Une source expirée par timeout continue de tourner et d'écrire en arrière-plan

**Fait** : `src/pipeline/ingestOrchestrator.ts` L97-104 `withTimeout` fait un `Promise.race` sans annulation ; `runIngest` reçoit `deadlineMs` mais seuls 3 chemins le lisent (`ingest.ts` L248 sitemap, `adapters/genericJsonLd.ts` L76, `adapters/fashionjobs.ts`) — les 35 autres adaptateurs l'ignorent. Après « timed out, moving on », la source continue à fetcher (créneaux de porte d'hôte, connexions Prisma du pool de 8) et à écrire, sans être comptée ; en fin de run `cli.ts` L279-280 ferme le navigateur et déconnecte Prisma pendant ses écritures. 0 TIMEOUT en prod à ce jour (SourceRun) — risque code, pas incident.

**Correction** : passer un `AbortSignal` dans `config` et dans `fetchWithRetry` (`init.signal`) ; l'orchestrateur `abort()` à l'expiration ; test « après timeout, plus aucun `fetch` ni écriture de cette source ».

### I-3 — Une source sitemap trop lente ne voit jamais sa queue : Decathlon 104 offres/run sur 1 240, le reste fermé par le refresh

**Fait mesuré** : `SourceRun decathlon` : OK 105 (07:14), OK 104 (09:01), note `desc 100 %…` ; `JobSource decathlon` 319 lignes, **136 actives**. Registre : `crawlDelaySeconds: 10`, `verifiedTotal: 1240`.

**Cause** : `ingest.ts` L235-236 sérialise à 1 requête / 10 s ⇒ ~110 pages en 18,5 min (`PER_SOURCE_TIMEOUT_MS` − marge) ; L248-251 s'arrête « pour continuer au prochain run » mais aucun curseur n'existe pour les sitemaps (`sourceCursor.ts` ne connaît que `fashionjobs`) ⇒ chaque run relit les mêmes ~105 premières URLs ; les autres ne sont jamais créées ou sont fermées après 48 h. La santé ne le voit pas : le chemin sitemap ne renseigne pas `declaredTotal` (L192-205), donc pas de « troncature ».

**Correction** : curseur générique par source (page/offset) pour tout chemin qui s'arrête à la deadline ; `declaredTotal = urls.length` sur le chemin sitemap pour que `health.ts` L117-128 signale la troncature ; test « un run coupé à N reprend à N+1 ».

### I-4 — Un 404 est rejoué 3 fois avec ~4 s d'attente : les pages périmées des sitemaps coûtent ×3

**Preuve exécutée** (`a2-http404.mts`, fetch simulé, sans réseau) : `/404 → 3 appels, 3 884 ms` ; `/410 → 3 appels, 3 970 ms` ; `/ok → 1 appel`. **Cause** : `src/lib/http.ts` L167-169 lève `HTTP 404` **à l'intérieur** du `try` (L120-189) ; le `catch` L190-197 ne laisse passer que `BlockedUrlError`/`WafChallengeError` et rejoue tout le reste, contrairement au commentaire L158-166. Kering sitemap portait 394 URLs périmées (D36) : 394 × 2 requêtes inutiles + 394 × 4 s. **Correction** : lever une `HttpStatusError` non rejouable pour 4xx hors 403/405/429 (ou tester `response.ok` hors du try) ; test « 404 = 1 appel ».

### I-5 — Ré-attestation : le titre canonique peut être réécrit par une source de rang inférieur ; « plus riche » = « plus long »

**Fait** : `src/dedup/upsert.ts` L446 appelle `reattestationFields(candidate, existing, alreadyKnown)` ; `alreadyKnown` (L399-401) vaut « CE sourceKey a déjà une JobSource sur ce Job », **pas** « cette source possède le canonique ». Scénario : offre Hermès (EMPLOYER_DIRECT) + JobSource FashionJobs ; chaque re-listage FashionJobs réécrit `Job.title` avec son titre (L385), puis Hermès le remet (ordre des sources dans le run) ⇒ titre/URL-slug oscillants (`offerPath` dépend du titre → 301 en boucle, `page.tsx` L79). La description est remplacée dès qu'elle est **plus longue** (L386-388) — un jobboard qui colle un pied de page de 2 000 caractères gagne — et `language` n'est pas recalculée sur ce chemin (il l'est L457 sur promotion). Mesure prod : 0 job avec titre venant d'un rang inférieur aujourd'hui (907 offres multi-sources) — le risque est réel, pas encore observé. Le commentaire L367-371 décrit la bonne règle ; le code ne l'applique pas.

**Correction** : `sameEntry = alreadyKnown && candidate.sourceTier === existing.canonicalTier` (ou `sourceKey` du propriétaire de l'URL) ; description : ne remplacer que si même source ou rang ≥ ; test « une JobSource de jobboard déjà rattachée ne réécrit pas le titre ».

### I-6 — La clé de cluster ignore la ville de l'adaptateur : 4 158 offres avec ville rangées « sans ville »

**Fait mesuré (10:00 UTC)** : 6 281 offres actives ont une `clusterKey` finissant par `|` (sans ville) ; **4 158 ont pourtant `city` renseignée** et 4 319 un `location`. Cluster `L_OREAL_PROFESSIONNEL|` : 1 782 offres, 461 villes ; `ADIDAS|` : 1 044 / 340 ; `LUXE_TALENT|` : 478, 0 ville (légitime).

**Cause** : `src/dedup/match.ts` L65-68 `blockingKey` ne lit que `job.location` ; `createJob` L294 stocke `candidate.city ?? cityFromLocation(location)` — deux dérivations différentes (`cityFromLocation` saute un segment de voirie, `normalizeLocationString` non). Dans un bucket sans ville, `isProbableDuplicate` (L170-176) compare par titre seul : deux « Sales Advisor » de deux sources (groupe + marque) dans deux villes différentes fusionnent ; inversement, la même offre avec `location` d'un côté et `city` seule de l'autre tombe dans deux buckets ⇒ deux Jobs (1 seule offre multi-source mesurée dans ces buckets : la dédup y est quasi inopérante).

**Correction** : `blockingKey = companyId | (candidate.city ?? cityFromLocation(location))`, une seule fonction de ville ; réécrire `clusterKey` à la ré-attestation (B-1). Test : « un candidat avec `city` et sans `location` se range avec la ville ».

### I-7 — Alerte et heartbeat : ce qui n'est pas signalé

- `health.ts` L50-53 : la porte de couverture ignore une source de < 20 offres. Les `errors` d'écriture n'entrent dans aucun verdict (une source qui perd 40 % de ses offres en erreurs d'écriture reste OK si `jobs ≥ 0,5 × before`).
- `cli.ts` L117 : heartbeat « succès » si `failed === 0` — 100 sources TIMEOUT = succès.
- `alert.ts` L91 : sujet `[Atlas]` (D31 : « toutes les mentions visibles remplacées » — pas celle-ci).

### I-8 — Santé : O(runs × sources) à chaque source

`health.ts` L204-215 `previousCounts` lit **toute** la table `SourceRun` (10 130 lignes, 512 clés, 991 lignes pour le dernier run) à chaque appel, et `checkSourceHealth` est appelé **par source** (`ingestOrchestrator.ts` L141) ⇒ ~5 M lignes transférées par run, plus le `deleteMany` de rétention L252-259 exécuté 492 fois. Correction : `SELECT DISTINCT ON (sourceKey)` pour la clé demandée ; rétention une fois par run.

---

## MINEUR

### M-1 — `import-sources` rejoué à chaque démarrage de conteneur écrase 83 lignes depuis un CSV figé
`Dockerfile` CMD : `import-sources` avant chaque pipeline ; `sourceStore.ts` L168-183 réécrit `config`, `tier`, `careersDomain`, `robotsVerdict`, `verifiedJobCount` et `robotsCheckedAt = '2026-09-02'` (L178, en dur) pour les 83 clés du CSV (dont `dr-jart-13`, RETIRED). Mesure (`a2-csvdrift.mts`, comparaison insensible à l'ordre des clés) : **0 divergence aujourd'hui** — le risque est structurel : toute correction de config faite en base sur une de ces 83 clés est annulée au déploiement suivant, et le verdict robots « rajeunit » à chaque déploiement sans avoir été relu. 409 des 492 sources ne viennent d'ailleurs plus du CSV. Correction : seed **une fois** (commande explicite), jamais dans le CMD ; `robotsCheckedAt` = date réelle de lecture.

### M-2 — Chemins morts et commandes orphelines (D5)
- `ingest.ts` L320-343 `catalogSitemapSources` + `isApiSource` : **0** ligne `Source` avec `jobUrlPattern` en prod ⇒ jamais exécuté.
- `cli.ts` `ingest` (L46-77) doublonne `ingest-all` + `INGEST_ONLY_KEYS` (D36) ; `purge --yes` (L216-243) supprime toute la base depuis un conteneur de prod ; `separate-fused` (L187) : réparation D26 exécutée, `fusedAfter=0` — à garder comme métrique ou retirer.
- Modules sans importeur runtime : `connectors/fashionjobs/offers.ts`, `connectors/lvmh/publicOffers.ts`, `pipeline/discoverAts.ts`, `pipeline/discoverFashionJobs.ts`, `pipeline/validateSources.ts` (2 importeurs dans `discovery/`), `lib/externalDns.ts` (4, `discovery/`).
- `src/discovery/` : 52 fichiers, **33 non suivis par git** (`dbg*`, `g1..g5-*`, sondes) — outils d'enquête commités nulle part, donc ni relus ni supprimables proprement.
- `Job.fingerprint` (`upsert.ts` L316, `separateFused.ts` L107) : écrit, indexé, jamais lu.
- `registry.ts` : `crawlDelaySeconds`, `employerSlugPattern`, `verifiedOn` ne servent qu'aux 6 routes (B-3) ; `SourceKind` défini deux fois avec deux sens (`registry.ts` L15, `sourceCatalog.ts` L15).
- `purge.ts` : `PIPELINE_VERSION = 7` est une constante (`version.ts` L61) ⇒ la purge par génération n'agit qu'à un bump ; 413 lignes < v7 subsistent (sources qui ne tournent plus). Le commentaire L36-39 (« un job sous-version = non re-listé ce run ») est faux ; le vrai cycle de vie est `refresh.ts`.

### M-3 — Transport : constantes contradictoires, double cache WAF, lecture .gz non bornée
- `ingest.ts` L42 `CONCURRENCY = 6` par source contre `hostGate.ts` L29 `4` par hôte et `http.ts` L36 `DEFAULT_DETAIL_CONCURRENCY = 4` (« un pLimit(8) parque 4 requêtes dans la file ») : 2 workers sur 6 attendent toujours.
- `wafToken.ts` L20 `cookies` et `browser.ts` L56 `wafTokens` mémorisent le même jeton par origine ; `http.ts` L146 : un jeton présent mais challengé ⇒ `WafChallengeError` immédiate, jamais de ré-amorçage ⇒ un jeton AWS expiré en cours de run fait échouer la source jusqu'au prochain process.
- `jsonLdSitemap.ts` L39-40 : `.gz` lu via `response.arrayBuffer()` hors de `readBodyBounded` (F-01 : ni délai ni taille).
- `hostGate.ts` L35 : la map `hosts` ne se vide jamais (acceptable pour un process = un run ; à surveiller pour la découverte 14 k).

### M-4 — Sécurité aux frontières
- **XSS JSON-LD : corrigé** — `apps/web/app/offre/[id]/page.tsx` L23-31 `safeJsonLd` échappe `<`, U+2028/2029 ; seul `dangerouslySetInnerHTML` du site. `CLAUDE.md` « Sécurité — points ouverts » est **périmé** sur ce point.
- **SSRF** : `lib/ssrf.ts` L62-79 ne vérifie que les IP littérales ; un hôte DNS résolvant vers 10.x/169.254.x passe (pas de résolution avant `fetch`, pas d'allow-list par source). Les URLs viennent de la table `Source` (écrite par les scripts de promotion) et des liens HTML de découverte. Rappel : `postgres.railway.internal` est bloqué par le suffixe `.internal` (L74). Correction : résoudre l'hôte et refuser une réponse privée, ou épingler l'hôte de config à `careersDomain`.
- **Clés** : `adapters/wttj.ts` L36 clé de recherche Algolia en dur avec auto-rafraîchissement L72-74 ; `adapters/lvmhAlgolia.ts` L164 `FALLBACK_KEY` ; ce sont des clés de recherche publiques (search-only) — à documenter comme telles, pas des secrets. Brevo/healthchecks lus dans l'env, jamais loggés.
- `retireSource.ts` L61 passe la ligne RETIRED puis détache ; un ingest **déjà lancé** (liste de clés lue en début de run, `ingestOrchestrator.ts` L107) peut ré-écrire les rattachements pendant la passe. À exécuter entre deux runs (D34 le dit) — pas de verrou.

### M-5 — Tests : périmètre et trous
- Non couverts par un script npm (`package.json` L16-17 énumère les chemins) donc **jamais exécutés en CI** (`.github/workflows/ci.yml` L44-46) : `src/dedup/upsert.test.ts` (8), `reattestation.test.ts` (5), `src/lib/hostGate.test.ts` (3), `wafToken.test.ts`, `normalize.test.ts` (14), `src/connectors/sourceConfig.test.ts` (6), `sourceStore.test.ts` (4) — 47 tests qui passent en local et que personne ne voit casser.
- À écrire, par ordre : (1) B-1 ré-attestation d'une offre fermée à clé dérivée ; (2) I-1 « BROKEN puis 0 → BROKEN » ; (3) B-2 `KIND_TO_ATS` ⊇ adaptateurs dispatchés ; (4) B-3 une clé = un `IngestStats` ; (5) I-4 « 404 = 1 appel » ; (6) I-2 annulation à l'expiration ; (7) I-5 titre non réécrit par un rang inférieur ; (8) I-3 curseur sitemap.

---

## Plan de simplification (10 points)

1. **Un seul chemin d'identité à l'écriture** : `findUnique(companyId, source, externalId)` d'abord, cluster ensuite, une seule fonction de ré-attestation Job + JobSource + `clusterKey`. Bénéfice : B-1 disparaît (1 855 offres stables), la course P2002 devient l'exception, `reconcile` retrouve ses clusters.
2. **Supprimer `registry.ts` du runtime** ; 6 routes → lignes `Source` ou `retire-source`. Bénéfice : 663 doublons en moins, fin des DEGRADED fictifs, une seule source de vérité (DEC-3 tenue).
3. **Santé : baseline = dernier run productif** et déclin cumulé. Bénéfice : plus de zéro silencieux après un BROKEN, digest fiable.
4. **`KIND_TO_ATS` dérivé du dispatcher** (une table `kind → AtsType` unique, testée). Bénéfice : +2 252 offres iCIMS, impossible d'oublier un adaptateur.
5. **Annulation réelle par `AbortSignal`** dans orchestrateur → `fetchWithRetry` → adaptateurs. Bénéfice : un timeout arrête vraiment, plus d'écritures fantômes ni de pool saturé.
6. **Curseur générique de reprise** pour tout chemin qui s'arrête à la deadline, `declaredTotal` sur les sitemaps. Bénéfice : Decathlon 1 240 offres au lieu de 105, troncature visible.
7. **Statuts HTTP non rejouables** (4xx hors 403/405/429). Bénéfice : ~⅓ de requêtes en moins sur les sitemaps périmés, runs plus courts.
8. **Une seule dérivation de ville** partagée par `blockingKey` et `Job.city`. Bénéfice : dédup opérante sur 4 158 offres, moins de fausses fusions.
9. **Seed CSV hors CMD, `SourceRun` lu par clé, rétention une fois par run.** Bénéfice : plus d'écrasement au déploiement, ~5 M lignes en moins par run.
10. **Ménage D5** : `ingest`, `purge`, modules sans importeur, 33 scripts non suivis, `fingerprint`, double cache WAF, `CONCURRENCY` alignée sur la porte, sujet `[Atlas]`, section sécurité de `CLAUDE.md` mise à jour (XSS corrigé). Bénéfice : moins de surface à relire, moins de faux « points ouverts ».

Scripts d'audit (lecture seule) : `src/discovery/a2-sql.mts`, `a2-clusterdrift.mts`, `a2-csvdrift.mts`, `a2-http404.mts`.
