# Audit a3 — cadence, durée des runs, validation localisée

Lecture seule, 2026-09-06 (mesures prises entre 09:55 et 10:10 UTC). Base de prod via le proxy TCP Railway, logs Railway par identifiant de déploiement (`railway logs <deploymentId> --service catwalks-aggregator --since … --until … --json`, tranches de 5 min : la CLI ne rend que les logs du dernier déploiement réussi si on omet l'identifiant, ce qui renvoyait 0 ligne pour les deux runs).

Scripts (SELECT uniquement, aucun réseau vers les Maisons) : `src/discovery/a3-runTiming.mts` (chronométrage par source depuis un fichier de logs), `a3-sourceRuns.mts` (historique SourceRun, tailles, churn, fraîcheur), `a3-tailSources.mts`, `a3-doubleRoutes.mts`, `a3-newness.mts`, `a3-dbLatency.mts`, `a3-liveCheck.mts`, `a3-whoWrites.mts`.

Contexte vérifié : crons `0 0 29 2 *` sur les 3 services (manifestes des déploiements 44b2ab63 / a57d8d71). Le refresh a tourné une dernière fois le 06 à 05:32:57 (déploiement 54ac4b16 : `checked 60216, closedSources 1818, closedJobs 2985, reopened 3`), avant le gel. `PIPELINE_VERSION = 7` (`src/pipeline/version.ts`).

---

## 1. Mesures

### 1.1 Run 1 — 07:59:41 → 09:01:07 UTC (déploiement 7c5afa37, commit 89076fa)

`a3-runTiming.mts` sur 1 260 lignes de logs :

| Mesure | Valeur |
|---|---|
| Orchestrateur (492 sources, 4 voies) | **61,4 min** de mur, 492/492 OK, 0 timeout |
| Somme des durées par source | **235,0 min** (4 voies → plancher théorique 58,8 min : le run est à 96 % de saturation) |
| Après l'orchestrateur : géocodage + digest Brevo + indexation + heartbeat | **20 s** (`geo: pending 7775, lookedUp 104, jobsLocated 455` ; indexation `skipped` faute de domaine ; `heartbeat: pinged`) |
| Offres lues | 71 482 |
| 405 sources < 10 s | 9,3 min cumulées |
| 50 sources 10–60 s | 19,3 min |
| 23 sources 1–5 min | 51,3 min |
| 10 sources 5–15 min | 83,1 min |
| 4 sources > 15 min | 72,0 min |

**Top 30 (durée départ → fin de la source, pas l'écart avec la suivante)** — 84 % de la somme :

| min | fenêtre | source | résultat |
|---|---|---|---|
| 19,2 | 08:37:54→08:57:08 | michael-page-france | 1 450 lues (0,80 s/offre, pages de détail sous Cloudflare) |
| 18,5 | 08:42:34→09:01:07 | decathlon [sitemap] | 104 lues, **stopped at time budget, 1 080 deferred** |
| 18,5 | 08:39:33→08:58:06 | fashionjobs | 153 lues (7,27 s/offre, Chromium), curseur page 161 → 1 |
| 15,7 | 08:07:58→08:23:40 | lacoste | API 450 en 47 s **puis sitemap 87 pages × crawl-delay 10 s = 14,9 min** |
| 11,8 | 08:30:45→08:42:34 | pandora-talenthub | 1 826 (0,39 s/offre, pages de détail) |
| 11,7 | 08:06:27→08:18:11 | courir | API 396 en 37 s **puis sitemap 394 pages en 11,1 min, 20 erreurs** |
| 10,6 | 08:16:50→08:27:24 | kering | API Eightfold 1 033 en 7,3 min puis sitemap 1 427 pages en 3,2 min |
| 10,1 | 08:28:45→08:38:53 | l-oreal-professionnel | 1 716 (0,35 s/offre) |
| 9,4 | 08:27:20→08:36:46 | estee-lauder-companies | 1 444 (0,39 s/offre, `position_details` par offre) |
| 6,5 | 08:33:05→08:39:33 | tapestry | 2 000 (Workday, détail par offre) |
| 6,2 | 08:48:06→08:54:17 | loreal [sitemap] | 1 717 pages, desc 0 % |
| 6,0 | 08:42:04→08:48:06 | ulta-jibe | 9 959 créées (0,036 s/offre : coût d'écriture pur) |
| 5,7 | | mango | 1 547 (Workday) |
| 5,1 | | richemont-workday | 1 334 |
| 4,4 | | boots | 1 401 |
| 4,3 | | nordstrom | 1 294 |
| 4,0 | | levis | 1 294 |
| 4,0 | | parfums-chanel | 1 092 |
| 3,7 | 08:54:17→08:57:58 | wttj [sitemap] | **144 351 entrées de sitemap → 60 493 URLs d'offres → 2 552 en périmètre → 14 lues, 2 538 erreurs WAF** (+ 20,6 s d'amorçage Chromium « sans jeton ») |
| 3,2 | | lvmh | 5 518 (0,035 s/offre) |
| 2,5 | | pvh | 1 347 (WAF amorcé en 1,8 s) |
| 2,3 / 2,2 / 2,0 / 2,0 / 2,0 / 1,8 / 1,6 / 1,6 / 1,5 | | luxe-talent, nike, swarovski, adidas, aritzia, saks, hm-group, richemont, bloomingdales-oracle | |

**Répartition du temps-source (235 min)** :

| Classe | min | part | sources | offres |
|---|---|---|---|---|
| Routes sitemap (page par page, JSON-LD) | 67,0 | 29 % | 8 routes | 3 505 |
| API avec page de détail par offre (≥ 0,12 s/offre, ≥ 100 offres) | 128,3 | 55 % | 40 | 24 821 |
| API sans détail (≤ 0,12 s/offre) | 28,2 | 12 % | 51 | 35 159 |
| Sources < 100 offres | 11,4 | 5 % | 393 | 7 617 |

Coût d'écriture pur, mesuré sur les sources rapides ≥ 1 000 offres : 18–36 ms/offre (rituals 18, foot-locker 24, lvmh 35, ulta-jibe 36). La **part des visites de pages de détail** est donc ≈ 128,3 − 24 821 × 0,03 s ≈ **116 min, soit 49 % du temps-source**. Le **géocodage final pèse 20 s (0,5 %)** : ce n'est pas un levier, contrairement à l'hypothèse du brief.

**Sources qui atteignent la deadline douce** (`PER_SOURCE_TIMEOUT_MS 20 min − 90 s = 18,5 min`, `ingestOrchestrator.ts:35-42`) : decathlon (seule à le dire : « stopped at time budget »), fashionjobs et michael-page-france (s'arrêtent en silence via `pastDeadline()`, `fashionjobs.ts:97`, `genericJsonLd.ts` — aucune ligne de log). Toutes trois démarrent entre 08:37 et 08:42 parce que l'ordre est « plus petites d'abord » (`allSourceKeys`, `ingestOrchestrator.ts:86-95`) : **la queue du run = 40 min pour atteindre les géantes + 18,5 min de deadline**, pendant lesquelles 3 des 4 voies sont occupées par des sources qui ne finiront pas.

**Source rotative** : `fashionjobs` seule (`ROTATING_SOURCES`, `sourceCursor.ts:15-19`). Curseur : `nextPage 1`, mis à jour 08:58. Voir §1.3.

### 1.2 Run 2 — 09:12:10 → coupé à 09:54:25 (déploiement b92768f9, commit 4c565b7)

- Dernière ligne de log 09:54:25 ; déploiement suivant 44b2ab63 créé **09:53:27** (`reason: deploy`, commit c82e2a5) → le conteneur a été arrêté par le déploiement. Aucune ligne « orchestrator done », pas de géocodage, pas de digest, pas de heartbeat.
- 490 sources démarrées, 486 terminées, **4 en vol perdues** : michael-page-france (démarrée 09:47:16), fashionjobs (09:50:21), ulta-jibe (09:50:23), decathlon (09:51:34) ; **2 jamais démarrées** : loreal, wttj. Aucune des 6 n'a de ligne SourceRun pour ce run (table B) — le `catch` de l'orchestrateur qui écrit TIMEOUT/ERROR (`ingestOrchestrator.ts:163-172`) ne s'exécute pas quand le processus meurt.
- ulta-jibe : 7 710 JobSource ré-attestées sur 9 959 avant la coupure (`a3-whoWrites`), 2 249 gardent le `lastSeenAt` du run 1.
- Temps-source des 486 terminées : 150,5 min ; mêmes 5 sources en tête (lacoste 15,7, l-oreal-professionnel 13,0, courir 12,1, pandora 11,4, kering 10,4).
- SourceRun : **491 lignes pour 486 clés** dans la fenêtre 09:11→09:56 — 5 clés écrivent deux lignes par run (§2.2).

### 1.3 Ce que les deux runs révèlent — constats

#### BLOQUANT — B1. Une source coupée par la deadline relit la MÊME tête de liste à chaque run : la queue n'est jamais atteinte, et le refresh ferme des offres vivantes

Preuves (`a3-tailSources.mts`, `a3-doubleRoutes.mts`) :

| Source | À la source | JobSource actives | Vues au run 1 | Non vues aujourd'hui | Historique SourceRun |
|---|---|---|---|---|---|
| decathlon | **1 184 URLs** (sitemap lue à chaque run) | 136 | 89 | 31 (vues 09-04/09-05) | 101, 100, 106, 105, 105, 105, 105, **104** offres/run depuis le 05 — jamais plus |
| michael-page-france | ~3 800 (`config.maxPages 400`, listing 20/page) | **3 330** | 1 443 | **1 887** (213 vues le 09-04, 188 le 09-05, le reste au run de 02:40) | 2 506 → 2 839 → 3 122 → 3 121 → BROKEN 0 → 2 936 → BROKEN 0 → **1 450** |
| fashionjobs | ~165 pages × 27 cartes (fin de board atteinte à la page ~166 : « page 161 → resumes at 1 ») | 889 | 153 | **522** | 119, 107, 108, 112, 112, 111, 112, 111, 110, 110, 104, **153** offres/run |

- **Decathlon** : `ingestSitemapSource` (`ingest.ts:241-251`) reprend `urls` dans l'ordre de la sitemap à chaque run, sans curseur ; le message « 1080 deferred to next run » (`ingest.ts:306`) est faux — **les 1 080 mêmes pages sont reportées à chaque run depuis le 05**. 136 offres affichées pour 1 184 publiées (11 %).
- **Michael Page** : `genericJsonLd.ts` repart de `page = 0` et s'arrête au `pastDeadline()` ; avec 4 voies en parallèle (2 Chromium actifs au même moment : FashionJobs + amorçage WTTJ à 08:54) le débit est tombé à 1 450 offres en 19 min, contre 2 936–3 122 en série. Les 1 887 offres non ré-attestées ont un `lastSeenAt` du 04/05 : **le prochain refresh les fermera** (`refresh.ts:95-102`, `STALE_HOURS 48`) alors qu'elles sont, pour l'essentiel, encore listées (pages 73→190 du listing). 634 JobSource Michael Page sont déjà inactives.
- **FashionJobs** : `requiredStaleHours` (`sourceCursor.ts:35-40`) calcule 8 runs × 4 h × 1,5 = 48 h avec `windowPages: 40`. **Fenêtre réelle mesurée : 104–153 offres par run = 4 à 6 pages** (7,27 s/offre sous Cloudflare, 18,5 min de budget), soit une rotation complète en ~30–40 runs → 5–7 jours à 4 h. `cadence.test.ts` est vert sur une constante, pas sur la mesure. Conséquence déjà visible : **108 Jobs fermés dont la seule source est fashionjobs, 210 JobSource fashionjobs inactives**, et 522 offres actives non vues depuis > 24 h que le refresh fermera à 48 h. Le refresh du 06 à 05:32 a fermé 2 985 Jobs : une partie est ce churn artificiel.

Impact candidat : offres réelles absentes (Decathlon ×1 048) ou affichées « expirée » à tort (Michael Page, FashionJobs) — D1 et D23 dans les deux sens. Impact Loïc : le digest DEGRADED/BROKEN ne le voit pas (statuts OK).

Correction (testable) :
1. **Curseur pour toute source coupée** : `SourceCursor` déjà en place → l'étendre aux sitemaps (`nextOffset` dans `urls`, avancé de `fetched+errors`, remis à 0 en fin de liste) et au listing générique (`startPage` = `lastPageDone + 1`, comme `fashionjobs.ts:126`). Test d'intégration `ingest.cursor.test.ts` : une sitemap de 30 URLs avec deadline après 10 → trois runs couvrent 30 URLs distinctes.
2. **L-01 mesuré, pas supposé** : `advanceCursor` enregistre `pagesDone` ; `requiredStaleHours(key)` lit la moyenne des 5 derniers `pagesDone` (`SourceCursor.lastWindowPages`) et non la constante ; le test compare à la valeur en base. Tant que la rotation dépasse 48 h : **le refresh ne ferme une offre d'une source rotative qu'après un balayage COMPLET sans la voir** (`SourceCursor.rotationStartedAt`, posé quand le curseur repasse à 1 ; cutoff = ce timestamp pour cette clé). Test `refresh.rotation.test.ts`.
3. Logger l'arrêt à la deadline dans **tous** les adaptateurs (`pastDeadline` → `console.error('[ingest] key: stopped at time budget after page N')`), sinon Michael Page et FashionJobs s'arrêtent en silence.

#### IMPORTANT — I1. Cinq clés portent deux routes (API + sitemap) sous le même nom : 26,5 min de temps-source pour 0 offre supplémentaire, et un faux DEGRADED

`runIngest({only})` (`ingest.ts:566-585` et `:650-652`) réunit `plainHttpSources()` (registre) **et** le catalogue par clé, puis exécute les deux : dans les logs, `1 API feeds: lacoste` et `1 sitemap sources: lacoste` à la même seconde.

| Clé | Route API (catalogue) | Route sitemap (registre) | Coût sitemap | Apport |
|---|---|---|---|---|
| lacoste | digitalrecruiters, 450 offres, desc 99 % | 87 pages FR × crawl-delay 10 s | **14,9 min** | 87 ⊂ 450, desc 98 % : rien |
| courir | smartrecruiters, 396, desc 100 % | 394 pages, 1,7 s/page (backoff hôte), 20 erreurs | **11,1 min** | 374 ⊂ 396 : rien |
| puig | wttj, 12 | 230 URLs → 0 offre | 0,3 min | rien |
| galeries-lafayette | teamtailor, 163 | 163 pages | 0,2 min | rien |
| kering / loreal | eightfold 1 033 / avature (l-oreal-professionnel) | 1 427 / 1 717 pages, desc 12 % / 0 % | 3,2 / 6,2 min | **déjà retirées du registre le 06 à 11:31 (commit be1bbf4)** — non re-signalé |

Le faux incident : `checkSourceHealth` reçoit deux `IngestStats` pour la même clé et compare chacun au **dernier** SourceRun de la clé — run 2, lacoste : ligne API `OK 450 (prev 450)` puis ligne sitemap **`DEGRADED 87 (prev 450) — "81% fewer offers than the previous run"`**, et `Source.lacoste.lastRunStatus = DEGRADED`. Le digest Brevo porte un incident qui n'existe pas. Idem `kering` DEGRADED « desc 12 % » au run 1 (route sitemap), alors que la route Eightfold est à 99,5 %.

Correction : dans `allSourceKeys`/`runIngest`, **une clé présente au catalogue avec un `kind` API ne charge jamais la route sitemap du registre** (ou : l'import refuse la collision, comme la garde tenant). Retirer lacoste/courir/puig/galeries-lafayette de `registry.ts`, puis `retire-source <clé> --external-prefix=https://` pour détacher les JobSource à id-URL (lacoste 98, courir 410, galeries-lafayette 168 ; les offres survivent par la route API). Test unitaire `ingestOrchestrator.test.ts` : catalogue `{lacoste: digitalrecruiters}` + registre `{lacoste: SITEMAP_JSONLD}` → une seule route.

#### IMPORTANT — I2. Un push pendant un run tue le run, et le run mort ne laisse aucune trace

Run 2 : 4 sources en vol perdues, 2 non démarrées, 0 SourceRun pour elles, ni digest, ni heartbeat (`hc-ping` attend un ping toutes les 4 h + 2 h de grâce — pendant le gel il alerte de toute façon). Le refresh lira « OK » au run 1 pour ces 6 clés : correct pendant 48 h, faux au-delà. Cause : Railway redéploie chaque push sur `apps/aggregator/**` (`watchPatterns`) sans attendre le conteneur en cours (`overlapSeconds: null`, `drainingSeconds: null`). Correction minimale : `SIGTERM` capturé dans `cli.ts` → écrire un `SourceRun ERROR "killed by deploy"` pour chaque source en vol (l'orchestrateur connaît `keys` en cours) et `pingHeartbeat(false)` ; côté process, ne pas pousser pendant un run (les runs ciblés du §2 réduisent la fenêtre de 61 min à quelques minutes).

#### IMPORTANT — I3. Le rejeu local contre la prod est DÉJÀ pratiqué, sans garde-fou — pendant cet audit

`a3-whoWrites` à 10:07 UTC : `hermes` 541 JobSource ré-attestées entre 10:06:19 et 10:08:17, `Source.l-oreal-professionnel` mis à jour à 10:04:21 ; **aucun conteneur aggregator actif** (déploiement 44b2ab63 : « Stopping Container » 09:57:41, aucune autre ligne) ; une connexion `active` depuis `100.64.0.20` (adresse du proxy TCP, comme la mienne). C'est un `ingest --source=` lancé d'un poste (session parallèle, suite au commit be1bbf4 « descriptions Hermès… L'Oréal Pro »). Entre deux de mes requêtes, `Job` actives est passé de 75 340 à 73 491 et `kering` de 1 160 à 1 041 JobSource actives : des `retire-source`/fusions tournent aussi. Rien n'est anormal dans l'intention ; ce qui manque est au §2.

#### MINEUR — M1. WTTJ sitemap : 4,0 min par run pour 14 offres (21 JobSource actives)
144 351 entrées, 60 493 URLs d'offres téléchargées et filtrées, 2 552 pages de détail dont 2 538 refusées par le WAF Amazon, amorçage Chromium 20,6 s « sans jeton ». D35 a déjà mesuré que l'API WTTJ par société fonctionne (clés `*-wttj`). → `retire-source wttj` + retrait du registre.

#### MINEUR — M2. Le chemin de fin de run n'est pas un levier
Géocodage 20 s (cache `GeoCache` : 7 775 en attente, 104 appels), digest Brevo < 1 s, indexation Google `skipped` (pas de domaine, D30), heartbeat 1 requête. Rien à sortir du chemin critique ici ; le gain est dans l'orchestrateur.

#### MINEUR — M3. Les 8 sources DEGRADED depuis ≥ 5 runs ne coûtent pas de temps
foot-locker-france (troncature 2 832/2 843, 1,1 min), loreal (route retirée), hermes (desc 0 %, en cours de rejeu à 10:06), gant, helena-rubinstein-8, diptyque, jako, lagardere-travel-retail (20/109 déclarées) : ≤ 1,1 min chacune. Les sauter n'accélère rien et retirerait leur ré-attestation (D23). Levier = les corriger, pas les ignorer.

#### MINEUR — M4. Variable `RAILWAY_RUN_COMMAND` encore = `prisma db push --accept-data-loss && npm run ingest-all`
Ignorée tant que le Dockerfile a un `CMD` (mémoire projet), mais c'est une commande destructrice qui redeviendrait active si le `CMD` disparaissait. À supprimer du service.

---

## 2. Validation localisée — rejouer UNE source ou UN lot en quelques minutes

### 2.1 Ce qui existe aujourd'hui

- CLI : `npx tsx src/cli.ts ingest --source=<clé>` (`cli.ts:48` ; le brief dit `--only`, c'est le nom de l'option interne `IngestOptions.only`, `ingest.ts:539`). `--no-geocode` existe. `INGEST_MAX_PER_SOURCE` plafonne mais **seulement la route sitemap** (`ingest.ts:229`).
- Ce que fait `ingest --source=lacoste` avec `DATABASE_URL` prod : `loadActiveSources` (catalogue prod) → route(s) API et sitemap de la clé, **sans deadline** (`deadlineMs` absent) → `purgeStaleForSource(clé, 7)` si ≥ 1 écriture → `runGeocode` sur tout le backlog (20 s) → `checkSourceHealth` : **écrit SourceRun + `Source.lastRun*`** → `sendHealthAlert` (no-op sans `BREVO_API_KEY`) → exit 1 si BROKEN. Le JSON final est déjà un rapport par source (fetched/created/merged/updated/errors + couverture desc/date/pays/url), sans durée ni avant/après.

### 2.2 Mesures

- **Latence base** (`a3-dbLatency`) : `SELECT 1` via `sakura.proxy.rlwy.net:40792` — min 16,0 ms, **médiane 17,7 ms**, p90 21,8 ms (interne Railway : sub-ms). `upsertDeduplicated` fait 6 à 8 requêtes par offre (`upsert.ts:96-437`) → **+110 à +140 ms/offre** en local : lacoste (450) ≈ +1 min, une source Workday de 1 400 ≈ +3 min, LVMH (5 518) ≈ +12 min. Acceptable pour une source, pas pour un lot de 50.
- Egress : IP locale ≠ `208.77.244.167` (sonde `[egress]` des runs, AS400940 NL). D32 l'a prouvé dans l'autre sens : **un succès local ne prouve pas le chemin prod** (WAF, Cloudflare, géo-blocage), et un échec prod ne se reproduit pas forcément en local. Le rejeu local valide l'adaptateur et l'écriture ; seul un run ciblé **sur Railway** valide la source.
- Porte par hôte (D25) : l'état `hosts` est en mémoire de processus (`hostGate.ts:35`). Deux processus (un run prod + un rejeu local, ou deux rejeux) sur le même hôte ne se voient pas → double martèlement, précisément ce que D25 a corrigé. Aujourd'hui les crons sont gelés : le risque est entre rejeux parallèles de deux sessions.

### 2.3 Risques concrets du rejeu local, par ordre

1. **Purge + version** : `purgeStaleForSource(clé, PIPELINE_VERSION)` supprime les offres de la clé dont `pipelineVersion < version`. Même version (7 = 7) : un rejeu partiel (Ctrl-C, `INGEST_MAX_PER_SOURCE`, deadline) ne supprime rien. **Version locale bumpée (8) sur une branche** : un rejeu plafonné supprime tout ce qu'il n'a pas réécrit — LVMH plafonné à 50 = 5 468 offres détachées/supprimées. Garde à poser : pas de purge si `MAX_JOBS_PER_SOURCE > 0`, `truncated`, `stoppedAtDeadline` ou `--dry-run`.
2. **Historique pollué** : SourceRun/`Source.lastRun*` reçoivent le rejeu (jobs=50 sur un rejeu plafonné → `Source.lastRunJobs 50` dans le catalogue ; un BROKEN local par egress bloqué → le prochain run prod compare à 0 et passe « NEW »).
3. **Concurrence** : aucun verrou ni signal « run en cours ». À la reprise des crons, un rejeu local pendant un run = deux écrivains sur la même clé (purge de l'un pendant l'upsert de l'autre : pas de corruption grâce aux contraintes uniques, mais des offres détachées puis recréées → `firstSeenAt` réinitialisé, D22).
4. **Egress** (ci-dessus). 5. **Géocodage** : 20 s, sans risque. 6. **Heartbeat** : `ingest` simple ne pingue pas (bien) ; `ingest-all --only` ne devrait pas non plus.

### 2.4 Ce qui manque — implémentation minimale (pas écrite)

**a) Run ciblé sur Railway** — `src/pipeline/ingestOrchestrator.ts`
```ts
export type KeySelection = { only?: string[]; skip?: string[] };
export function selectSourceKeys(keys: string[], selection: KeySelection): string[]; // pur, testable
export async function allSourceKeys(prisma, selection?: KeySelection): Promise<string[]>;
```
`cli.ts` : `ingest-all --only=a,b,c` / `--skip=x,y` ou variables `INGEST_ONLY_KEYS` / `INGEST_SKIP_KEYS` (Railway : poser la variable, poser le cron à la minute voulue, retirer la variable ensuite ; le `CMD` Docker lit déjà `PIPELINE_CMD`). En mode `only` : **pas de `pingHeartbeat`**, pas d'indexation, digest conservé (il est le rapport). Refuser une clé inconnue (exit 1 avec la liste). Test unitaire `ingestOrchestrator.test.ts` : `selectSourceKeys(['a','b','c'], {only:['b','zz']})` → erreur `zz` ; `{skip:['a']}` → `['b','c']` ; ordre petites-d'abord conservé.

**b) `--dry-run`** — `IngestOptions.dryRun: boolean` traversant `ingestApiSource`/`ingestSitemapSource` : fetch + normalisation + `toCandidate` réels, puis à la place de `upsertDeduplicated` : `classifyCandidate(prisma, candidate)` (nouveau, `src/dedup/classify.ts`) qui lit `JobSource (sourceKey, externalId)` et le cluster, et rend `{ outcome: 'WOULD_CREATE'|'WOULD_UPDATE'|'WOULD_MERGE', changed: ('title'|'description'|'country'|'city'|'url'|'contract')[] }`. Pas de purge, pas de SourceRun, pas de `Source.lastRun*`, pas de digest. `checkSourceHealth` reçoit `dryRun` et ne fait que calculer. Test d'intégration `ingest.dryRun.test.ts` (base `catwalks_test`) : compte `Job`/`JobSource`/`SourceRun` identiques avant/après, et `classifyCandidate` renvoie `WOULD_UPDATE changed:['description']` sur une offre existante dont seule la description diffère.

**c) Rapport de fin lisible** — `src/pipeline/replayReport.ts`
```ts
export type ReplayReport = {
  source: string; durationMs: number; fetched: number; declaredTotal?: number;
  outcome: { created: number; merged: number; updated: number; errors: number };
  coverageBefore: Rates | null;  // Source.descriptionRate/dateRate/countryRate/urlRate (dernier run)
  coverageAfter: Rates;
  fieldChanges: Record<'title'|'description'|'country'|'city'|'url'|'contract', number>;
  notReattested: number;         // JobSource actives de la clé non vues par ce rejeu = ce que le refresh fermerait
  sampleErrors: string[];        // 3 premiers briefError
};
export function buildReplayReport(stats: IngestStats, before: SourceRow | null, notReattested: number, startedAt: number): ReplayReport;
export function formatReplayReport(report: ReplayReport): string; // tableau texte, une ligne par champ : avant → après
```
Test unitaire `replayReport.test.ts` sur fixtures (pas de base) : `desc 0 % → 99 %` s'affiche, `notReattested 1 887` s'affiche en tête. `IngestStats` gagne `fieldChanges` (alimenté par `upsertDeduplicated`, qui sait déjà ce qu'il réécrit — `reattestationFields`) et `durationMs`. Ajouter `durationMs` à `SourceRun` (migration additive) : c'est aussi la donnée qui manque pour la règle de cadence du §3.

**d) Garde-fous du rejeu local** — dans `cli.ts` avant `ingest --source` : si `SourceRun` a une ligne < 15 min pour une autre clé, ou si `JobSource.lastSeenAt` max < 2 min sur une autre clé, afficher « un run semble en cours » et exiger `--force`. Pas de purge sur run plafonné/coupé (§2.3-1). Test `purge.guard.test.ts`.

Ordre : a) puis c) (utilisables ensemble en une demi-journée), b) ensuite. Avec a) seul, rejouer lacoste sur Railway = poser `INGEST_ONLY_KEYS=lacoste` + cron à la minute → **~1 min de run** au lieu de 61, avec le vrai egress et la porte par hôte du vrai processus.

---

## 3. Cadence cible

### 3.1 Ce que valent 4 h aujourd'hui

- Base : 73 491 offres actives (à 10:07), 492 sources ; **457 offres nouvelles le 05 (journée stable, 6 runs), venant de 53 sources**, réparties sur la journée (59 à 00 h, 87 à 04 h, 43 à 08 h, 20 à 12 h, 26+24+29+27 de 14 à 18 h, 59 à 22 h). Fermetures : 2 985 au refresh du 06 (dont le churn artificiel B1), 326→946/jour les jours précédents.
- **0,6 % de la base change par jour** ; un run de 4 h ré-atteste 71 482 offres pour en publier ~76 nouvelles : **~940 offres relues par offre nouvelle**. Coût de la cadence 4 h : 6 × 61 min = **6 h 08 de conteneur par jour**, 6 × 71 482 lectures + ~6 × 24 800 pages de détail chez les Maisons.
- Fraîcheur réelle du marché : `postedAt` médian des actives = **34 jours** ; 11 654 actives (16 %) publiées depuis < 7 j. Un délai de publication moyen de 4 h (cadence 8 h) au lieu de 2 h (cadence 4 h) est invisible pour un candidat qui regarde des offres vieilles d'un mois.
- Les 5 sources qui produisent le plus de nouveautés (fashionjobs 71, prada-group 69, lvmh 49, estee-lauder 46, hermes 19 = 56 % des 457) — deux d'entre elles (fashionjobs, ELC) sont dans le top 10 des durées.

### 3.2 Règle simple proposée (à valider par Loïc)

1. **Voie principale, toutes les 8 h** (00:00, 08:00, 16:00) : les ~487 sources qui finissent en < 15 min. Après §1 (I1, M1, B1-voie lente) : temps-source ≈ 235 − 26,5 − 9,4 − 4,0 − 56,2 = **139 min → ≈ 35 min de mur à 4 voies**, plus une source ne touche la deadline. 3 × 35 min = **1 h 45 / jour** (−72 %). `INGEST_INTERVAL_HOURS` 4 → 8 ; `REFRESH_STALE_HOURS 48` = 6 runs de marge (2 aujourd'hui à 4 h… non : 12 ; 6 suffisent, l'invariant est « ≥ 2 runs manqués absorbés »).
2. **Voie lente, 1 fois par jour** (ex. 02:00), 2 voies, budget 3 h par source, `INGEST_ONLY_KEYS=decathlon,fashionjobs,michael-page-france` : Decathlon 1 184 pages × 10 s = **3,3 h pour un passage complet** (ensuite un curseur ; +1 048 offres visibles) ; Michael Page ~3 800 offres × 0,8 s ≈ **51 min** (seule, sans partage de CPU avec Chromium) ; FashionJobs ~165 pages × 27 × 7,3 s ≈ 9 h si le débit mesuré tient — **à mesurer seule** : le 7,3 s/offre a été pris avec 3 autres voies et un second Chromium en concurrence. Tant que la rotation dépasse 48 h : règle « fermeture après balayage complet » (B1-2).
3. **Règle de bascule automatique** : `SourceRun.durationMs` (à ajouter) — une source dont la médiane des 3 derniers runs > 15 min passe en voie lente ; < 10 min, elle revient. Pas de liste à la main.
4. **Refresh** : quotidien, 1 h après le run principal du matin, jamais sans un run complet (statut heartbeat) dans les 24 h précédentes — aujourd'hui le gel du refresh coûte **472 offres non ré-attestées depuis > 48 h toujours affichées** (toutes vues pour la dernière fois le 04), +≈ 500/jour.
5. Grosses vs petites : aucune raison de cadence différente par taille — la source de 5 518 offres (LVMH) coûte 3,2 min, la source de 87 pages à crawl-delay 10 s en coûte 14,9. **Le critère est la durée mesurée, pas le volume.**

---

## 4. Ce qui sort du chemin critique du run — chiffré (run 1)

| Élément | Temps-source | Offres | Verdict |
|---|---|---|---|
| Géocodage final | 20 s | 455 localisées | **reste** (déjà hors voie, cache efficace) |
| Digest Brevo, indexation Google, heartbeat | < 2 s | — | **reste** |
| Sources DEGRADED ≥ 5 runs (8) | ≤ 1,1 min chacune, ~3 min | 4 600 | **restent** (les corriger) |
| Sitemap WTTJ | 4,0 min | 14 | **sort** (retire-source) |
| Routes sitemap doublonnées lacoste/courir/puig/GL | 26,5 min | 0 nouvelle | **sortent** |
| Routes sitemap kering/loreal | 9,4 min | 0 nouvelle | **déjà sorties** (be1bbf4) |
| Decathlon (crawl-delay 10 s) | 18,5 min | 104/1 184 | **voie lente + curseur** |
| FashionJobs (Chromium) | 18,5 min | 153/889+ | **voie lente + règle rotation** |
| Michael Page (Cloudflare) | 19,2 min | 1 450/3 330+ | **voie lente + curseur** |

Somme sortie : 96,1 min de temps-source sur 235 → 139 min ; et surtout la **queue** (40 min d'attente + 18,5 min de deadline) disparaît.

---

## 5. Plan en 5 points

1. **Retirer les routes doublonnées et WTTJ** (`registry.ts` : lacoste, courir, puig, galeries-lafayette, wttj ; `retire-source … --external-prefix=https://` pour les 4 premières, `retire-source wttj`) — **−30,5 min de temps-source (≈ −7,6 min de mur)**, 0 offre perdue (676 JobSource à id-URL détachées, toutes doublées par la route API), 1 faux DEGRADED (lacoste) en moins dans le digest. Une demi-journée.
2. **Curseur pour les sources coupées + arrêt loggé + L-01 mesuré** (B1) — Decathlon **+1 048 offres** visibles (136 → 1 184), Michael Page **1 887 offres** sauvées de la fermeture au prochain refresh, FashionJobs **522** ; `cadence.test.ts` lit la fenêtre réelle. Une journée, tests d'intégration inclus.
3. **`INGEST_ONLY_KEYS`/`--only` + rapport de fin + garde « run en cours »** (§2.4 a, c, d) — rejouer une source = **1 à 12 min** (Railway, vrai egress) au lieu d'un run de 61 min ; c'est aussi le mécanisme de la voie lente. Une journée.
4. **Voie lente quotidienne** (service cron `catwalks-slow` ou `INGEST_ONLY_KEYS` + cron sur le même service, budget 3 h) pour decathlon / fashionjobs / michael-page — **−56,2 min de temps-source sur le run principal, dont la queue de 18,5 min** ; run principal ≈ **35 min** (mesure attendue, à confirmer au premier run). 5 500 offres concernées (Decathlon 1 184, Michael Page ~3 800, FashionJobs ~900+).
5. **Cadence 8 h + refresh dégelé sous condition** — **1 h 45 de conteneur/jour au lieu de 6 h 08 (−4 h 23)**, −67 % de requêtes chez les Maisons (≈ 3 × 47 k au lieu de 6 × 71 k), délai moyen de publication 4 h au lieu de 2 h sur ~457 offres/jour ; refresh quotidien après le run du matin → les **472 offres** non ré-attestées depuis > 48 h (et +≈ 500/jour) cessent d'être affichées. Décision Loïc (cadence = intention métier).

`--dry-run` (§2.4 b) vient après les cinq : utile, non bloquant, une demi-journée.
