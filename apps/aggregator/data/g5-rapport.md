# g5 — Rapport : Oracle HCM · Taleo · « Cornerstone » Ralph Lauren

Mesures du 2026-09-06, lecture seule, depuis un poste local. Chaque chiffre vient d'une exécution (`src/discovery/g5-*.mts`), pas d'une déduction.

## Résumé

| Portail | Vendeur réel | Verdict | Mesure |
|---|---|---|---|
| Bloomingdale's | Oracle HCM (`ebwh.fa.us2`, site `CX_1002`) | **RÉSOLU** — adaptateur `oraclehcm.ts` écrit | 762 offres / 762 annoncées · 762 lieu · 761 desc>200 · 762 date · 85 s |
| Tiffany & Co. | Oracle HCM (`eljs.fa.us2`, site `CX`) | **RÉSOLU** — même adaptateur | 419 / 419 · 419 lieu · 419 desc>200 · 419 date · 52 s |
| Brown Thomas / Arnotts | **Taleo Business Edition** (pas Taleo Enterprise) | **RÉSOLU** — adaptateur `taleo.ts` écrit | 68 offres · 68 lieu · 68 desc>200 · 0 date · 14 s |
| Ralph Lauren | **Avature** (pas Cornerstone), derrière AWS WAF (levé par le transport commun) | **RÉSOLU** — mode « portail » ajouté à `avature.ts` | **1 082 / 1 082 annoncées** · 1 082 lieu · 1 082 desc>200 · 1 052 ville · 1 082 pays · 0 date · 449 s (Corporate 209 + Retail 873) |

Deux adaptateurs nouveaux (`oraclehcm.ts`, `taleo.ts`) + un mode « portail » dans `avature.ts` (autorisation explicite du coordinateur), chacun avec tests sur fixtures capturées (`npx vitest run src/ats` vert, `tsc --noEmit` propre). Ni `src/ats/index.ts`, ni `KIND_TO_ATS`, ni Prisma touchés — Oracle HCM et Taleo restent à brancher ; Ralph Lauren passe par le type `AVATURE` existant.

---

## 1. Oracle HCM Recruiting Cloud — Bloomingdale's et Tiffany & Co. : RÉSOLU

### Ce qui a été trouvé

- `https://www.bloomingdalesjobs.com/` → **302** vers `https://ebwh.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1002/` (`siteNumber` = `CX_1002`, lu dans l'URL).
- `https://www.tiffanycareers.com/` → **403 Akamai** (« Access Denied ») à curl ET à Chromium/Playwright (la page rendue titre « Access Denied », robots.txt inclus). Le domaine de marque est une vitrine fermée aux robots. L'hôte Oracle réel, trouvé par recherche web : **`eljs.fa.us2.oraclecloud.com`**, site `CX` (`siteNumber=CX` et `CX_1` renvoient le même total 419 ; `CX` est retenu, c'est le segment de l'URL).
- Les deux hôtes Oracle répondent **200 sans User-Agent navigateur, sans cookie, sans jeton** — `fetchJson` nu suffit. `robots.txt` → 404 sur les deux hôtes (aucune interdiction publiée).

### L'API (rejouée)

Liste — GET, réponse JSON :
```
{origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions
  ?onlyData=true&expand=requisitionList.secondaryLocations,flexFieldsFacet.values
  &finder=findReqs;siteNumber={site},limit=200,offset={offset}
```
- `items[0].TotalJobsCount` = total annoncé ; `items[0].requisitionList[]` = jusqu'à 200 lignes ; pagination par `offset` += 200, arrêt quand `offset+200 ≥ TotalJobsCount` (ou page vide). Vérifié : offset 600 sur Bloomingdale's → 162 lignes, `hasMore:false`.
- Chemins : `Id` (ex. `REQ_802310` ou `63156`), `Title`, `PostedDate` (jour seul), `PrimaryLocation` (« New York, NY, United States »), `PrimaryLocationCountry` (ISO-2), `JobSchedule`, `ContractType`, `WorkerType`, `ShortDescriptionStr` (vide sur ces deux tenants). **Pas de description dans la liste.**

Détail — GET, une requête par offre (~11 Ko) :
```
{origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails
  ?onlyData=true&expand=all&finder=ById;siteNumber={site},Id="{Id}"
```
- (`findByPrimaryKey` du brief → **400** « finder … is not valid » ; c'est `ById` qui marche.)
- Chemins : `items[0].ExternalDescriptionStr` (HTML, 7 946 car. sur l'exemple Tiffany), `ExternalQualificationsStr`, `ExternalResponsibilitiesStr`, `ExternalPostedStartDate` (ISO à l'heure), `PrimaryLocation`, `PrimaryLocationCountry`, `ContentLocale`, `workLocation[0]` (`TownOrCity`, `PostalCode`, `Country`, `Latitude`, `Longitude` — ville/pays souvent null, coordonnées présentes).

URL publique de l'offre : `{origin}/hcmUI/CandidateExperience/en/sites/{site}/job/{Id}` (vérifiée 200 sur Tiffany). Le domaine de marque n'est pas utilisable pour Tiffany (403).

### Configs
```json
{ "origin": "https://ebwh.fa.us2.oraclecloud.com", "siteNumber": "CX_1002" }
{ "origin": "https://eljs.fa.us2.oraclecloud.com", "siteNumber": "CX" }
```

### Mesure (`npx tsx src/discovery/g5-oraclehcm.mts`)
```
Bloomingdale's: 762 offres (total annoncé 762) | 762 lieu | 761 desc>200 | 762 date | 762 coords | 85s
   pays: US=762
   ex: Commission Sales Associate - Young World, Full Time - 59th S @ New York, NY, United States
Tiffany & Co.: 419 offres (total annoncé 419) | 419 lieu | 419 desc>200 | 419 date | 397 coords | 52s
   pays: US=261 CA=34 AU=16 JP=14 KR=10 FR=9 DE=9 BR=9
   ex FR: IT Director – People & HR Technology @ Paris, France — desc 6537 car.
```
Bloomingdale's est 100 % États-Unis (aucune offre France) ; Tiffany : 9 offres FR sur 419.

### Livrables
- `src/ats/adapters/oraclehcm.ts` — `fetchOracleHcmJobs({ origin, siteNumber, lang?, withDescriptions?, detailConcurrency? })`, liste paginée + détail en concurrence 4 via `fetchJson` (porte par hôte), `declaredTotal` renseigné.
- `src/ats/adapters/oraclehcm.test.ts` — 6 tests sur fixtures réduites des réponses réelles (liste Bloomingdale's, détail Tiffany).
- `src/discovery/g5-oraclehcm.mts` — mesure.

---

## 2. Taleo — Brown Thomas / Arnotts : RÉSOLU (Taleo Business Edition)

### Ce qui a été trouvé

- `https://careers.brownthomas.com/` → **timeout TCP** (83.138.185.232, curl et Playwright). `https://www.brownthomas.com/careers` → **HTTP 410** avec une page de 440 Ko qui ne contient qu'un lien utile : **`https://www.brownthomasarnottscareers.com/`** (WordPress/Elementor, 200).
- Ce site lie **17 sections Taleo Business Edition** : `https://lde.tbe.taleo.net/lde02/ats/careers/v2/searchResults?org=ARNOTTS&cws=N` — retail `cws=70…79`, head office `cws=60,61,62,63,64,66`, et `cws=79` en « toutes offres » sur l'accueil. Ce n'est **pas** Taleo Enterprise : ni `careersection/…/jobsearch.ftl`, ni `/rest/jobboard/searchjobs` (les chemins `/jobs`, `/rss`, `format=json` → 404 ou HTML). Tout est HTML serveur, sans API JSON.
- `cws=1` → boucle de redirections (section inexistante). Aucune section ne liste tout : `cws=79` n'a que 4 offres, `cws=70` en a 13 ; l'union des 16 sections réelles donne **68 réquisitions uniques** (dédup sur `rid`).

### Le chemin (rejoué)

- Liste : GET `{origin}/ats/careers/v2/searchResults?org=ARNOTTS&cws={cws}` → 10 lignes par page. Chaque ligne : `<a href="…viewRequisition?org=ARNOTTS&cws=N&rid=NNNN" class="viewJobLink">Titre</a>`, puis `<div>Lieu</div>`, `<div>rid</div>`.
- Pagination : GET `…searchResults?org=ARNOTTS&cws={cws}&next&rowFrom=10&act=null&sortColumn=null&sortOrder=null` — **liée à la session** : la première réponse pose `JSESSIONID` (Path=/lde02/ats) ; sans ce cookie la page suivante répond 200 avec un corps **d'un octet**. Avec le cookie : `rowFrom=10` sur `cws=70` → 3 lignes de plus (13 au total). Arrêt : page sans nouveau `rid`.
- Détail : GET `…/v2/viewRequisition?org=ARNOTTS&cws=N&rid=NNNN` → titre (`<strong>`), « Location », « ID », et le texte complet dans `<div name="cwsJobDescription">` (borné par `<link rel="stylesheet"` / `oracletaleocwsv2-button-navigation`). Une réquisition retirée répond 200 « This job has moved or is no longer available » (ex. `rid=7755`, encore lié depuis le site de marque).
- **Aucune date de publication** nulle part (liste ni détail) — `postedAt` restera vide.
- `robots.txt` du pod → 404 (« Come Back Soon »), aucune interdiction publiée.

### Config
```json
{ "origin": "https://lde.tbe.taleo.net/lde02", "org": "ARNOTTS",
  "cws": [79, 70, 71, 72, 73, 74, 75, 76, 77, 78, 60, 61, 62, 63, 64, 66] }
```

### Mesure (`npx tsx src/discovery/g5-taleo.mts`)
```
Brown Thomas Arnotts: 68 offres | 68 lieu | 68 desc>200 | 0 date | 14s
   ex: 2026 Christmas Team @ Brown Thomas, Dublin — https://lde.tbe.taleo.net/lde02/ats/careers/v2/viewRequisition?org=ARNOTTS&cws=79&rid=7770
```
Lieux : Dublin, Dundrum, Cork, Limerick, Galway, Blanchardstown, head office Dublin. 100 % Irlande, 0 France (attendu). Descriptions de 1 692 à 8 568 caractères.

### Livrables
- `src/ats/adapters/taleo.ts` — `fetchTaleoJobs({ origin, org, cws, withDescriptions?, detailConcurrency? })` : lit chaque section, relit le `JSESSIONID` sur la première réponse (`fetchWithRetry`) et le renvoie sur les pages suivantes, dédup sur `rid`, détail en concurrence 4.
- `src/ats/adapters/taleo.test.ts` — 6 tests (ligne de liste, entités, dédup, page d'un octet, description bornée, réquisition retirée).
- `src/discovery/g5-taleo.mts` — mesure.

---

## 3. « Cornerstone » Ralph Lauren : RÉSOLU — c'est AVATURE derrière AWS WAF

### Ce qui a été trouvé

- `careers.ralphlauren.com/robots.txt` déclare les portails **`ralphlauren.avature.net`** (`RetailManager`, `RLAgency`, `HKEarlyCareer`, `CareersCorporate` = portail 47). `jobRecordsPerPage` / `listFilterMode` sont des paramètres **Avature**, pas Cornerstone. Aucune trace de `csod.com`.
- Tout `fetch` nu sur `careers.ralphlauren.com/en_US/CareersCorporate/…` (liste, `…/json`, `JobDetail`, sitemap `en_US`) recevait **HTTP 202, corps vide, `x-amzn-waf-action: challenge`** (Cloudflare devant AWS WAF). `ralphlauren.avature.net/…` → 301 vers le même domaine. Les sitemaps ne listent que 61 routes utilitaires, **0 offre**.
- Chromium passe le challenge et reçoit un cookie `aws-waf-token` ; rejoué sur un `fetch` nu, il ouvre tout. Depuis la brique commune (`src/lib/wafToken.ts` + `primeWafToken`, branchée dans `fetchWithRetry`), **`fetchText` lève le challenge seul** : sur la mesure finale, un seul amorçage (`[waf] https://careers.ralphlauren.com: amorçage réussi en 2786 ms`) puis ~1 270 requêtes HTTP simples sans un 202.
- `robots.txt` : `Allow: /CareersCorporate`, `Allow: /*/CareersCorporate`, seul `*qtvc=` est interdit — nos URLs n'en portent pas.

### Le gabarit (rejoué)

Base : `https://careers.ralphlauren.com/en_US/CareersCorporate`. Le portail a **trois listes**, chacune avec sa route de détail :

| Liste | Annoncé (2026-09-06) | Route détail |
|---|---|---|
| `SearchJobsCorporate` | 209 | `JobDetailCorporate?jobId=` |
| `SearchJobsRetail` | 876 le matin, 873 sur la mesure finale | `JobDetailRetail?jobId=` |
| `SearchJobsNorthCarolinaCampus` | pas de total affiché ; **0 id nouveau** (ses cartes sont déjà dans les deux autres listes) | `JobDetailNorthCarolinaCampus?jobId=` |

1. Liste paginée — GET `{base}/{Liste}/?jobOffset={n}&listFilterMode=1` : `jobRecordsPerPage` est **ignoré, 6 cartes par page** (« 1-6 of 209 results ») ; l'offset avance du nombre de cartes lues ; arrêt sur page sans nouvel id (la dernière page se répète). Carte `<article class="article article--result">` : titre = lien `JobDetail{Liste}?jobId={id}`, `span.list-item-location` (« München, Bavaria, Germany »), `span.list-item-ref` (`#W181339`), `span.list-item-department`, extrait `p.article__content`.
2. Endpoint JSON `{base}/{Liste}Data/` (carte géographique) : `{ locations: { "<latlon>": { jobs:[{id,title,url}] } }, totalCount }` — `totalCount` = nombre de LIEUX, et l'énumération **plafonne à 500 ids** (Retail : 500 sur 876). Non utilisé par l'adaptateur.
3. Détail — GET `{base}/JobDetail{Liste}?jobId={id}` : **pas de JSON-LD, pas de microdata, pas de date**. Blocs `<article class="article article--details">` : le premier porte les champs `Ref #`, `State/Region`, `Department`, `Location` (= pays), `City` ; les suivants sont des sections titrées `<h2>` (COMPANY DESCRIPTION, POSITION OVERVIEW, ESSENTIAL DUTIES & RESPONSIBILITIES, EXPERIENCE, SKILLS & KNOWLEDGE) ; « Share this job » et « Job Notifications » sont écartés.

### Config (type `AVATURE`, mode portail déclenché par `lists`)
```json
{ "origin": "https://careers.ralphlauren.com",
  "lists": ["en_US/CareersCorporate/SearchJobsCorporate",
            "en_US/CareersCorporate/SearchJobsRetail",
            "en_US/CareersCorporate/SearchJobsNorthCarolinaCampus"] }
```

### Mesure (`npx tsx src/discovery/g5-ralphlauren.mts`, via `fetchAtsJobs('AVATURE', config)`)
```
Ralph Lauren (3 listes): 1082 offres (annoncé 1082) | 1082 lieu | 1082 desc>200 | 1052 ville | 1082 pays | 0 date | 449s
   pays: United States=751 India=66 United Kingdom=65 Canada=56 Hong Kong SAR=39 France=25 Italy=18 Spain=12 Germany=11 Netherlands=11
   par liste: Corporate=209 Retail=873
   ex: (Senior) Sales Executive (w/m/d), Polo MW @ München, Bavaria, Germany — https://careers.ralphlauren.com/en_US/CareersCorporate/JobDetailCorporate?jobId=67979
   ex FR: Brand Image specialist @ Paris, Paris, France — desc 3064 car.
```
1 082 = 209 + 873 = le total annoncé par les deux listes ; 25 offres France. `postedAt` reste `undefined` (aucune date à la source). Les 30 offres sans `city` ont un `location` de liste (le champ `City` n'est pas rempli sur ces fiches). 449 s pour ~1 270 requêtes (porte par hôte, détail en concurrence 4).

### Livrables
- `src/ats/adapters/avature.ts` — mode portail : `parseAvaturePortalListing`, `parseAvaturePortalDetail`, `fetchAvaturePortalJobs` (branché dans `fetchAvatureJobs` quand `lists` est fourni ; les modes `listingUrl` / `sitemapUrl` sont intacts). `declaredTotal` = somme des « of N results » des listes.
- `src/ats/adapters/avature.test.ts` — 7 tests ajoutés sur fixtures capturées (carte Corporate, page de détail 67979) ; les 15 tests existants inchangés et verts (22 au total).
- `src/discovery/g5-ralphlauren.mts` — mesure via `fetchAtsJobs`.

---

## Ce qui reste à faire (hors périmètre du brief)
1. Brancher `ORACLE_HCM` et `TALEO` dans `src/ats/index.ts` / `KIND_TO_ATS` / l'enum Prisma `AtsType` (décision de schéma, pas prise ici). Ralph Lauren n'a besoin que d'une ligne de catalogue `AVATURE` avec la config ci-dessus.
2. Le tenant Oracle `ebwh` (Macy's Inc.) héberge sans doute d'autres sites (`CX_1`…) : à sonder si Macy's entre au catalogue.

## Fichiers
- `apps/aggregator/src/ats/adapters/oraclehcm.ts`, `oraclehcm.test.ts`
- `apps/aggregator/src/ats/adapters/taleo.ts`, `taleo.test.ts`
- `apps/aggregator/src/ats/adapters/avature.ts`, `avature.test.ts` (mode portail ajouté)
- `apps/aggregator/src/discovery/g5-oraclehcm.mts`, `g5-taleo.mts`, `g5-ralphlauren.mts`, `g5-sniff.mts` (capture réseau Playwright), `g5-rl-debug.mts` (comptage des trois listes RL)
