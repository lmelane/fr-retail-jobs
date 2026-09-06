# g4 — Rituals · ASOS · Dr. Martens · Ba&sh (mesuré le 2026-09-06)

Quatre portails, quatre adaptateurs écrits sur le modèle de `icims.ts`, chacun avec
un test vitest sur fixture capturée et un script d'exécution en direct. Rien n'a été
câblé dans `src/ats/index.ts`, `KIND_TO_ATS` ni Prisma. Lecture seule, aucune écriture
en base. Chaque chiffre ci-dessous sort d'une exécution.

| Portail | Verdict | Mesure réelle |
|---|---|---|
| Rituals | **API TROUVÉE + adaptateur écrit** (`rituals.ts`) | fr-FR : **252 offres \| 252 lieu \| 252 desc \| 252 date \| 0 s** — 22 locales : **1 088 uniques** |
| ASOS | **API TROUVÉE + adaptateur écrit** (`asosAlgolia.ts`) | **64 offres \| 64 lieu \| 64 desc \| 64 date \| 0 s** |
| Dr. Martens | **API TROUVÉE + adaptateur écrit** (`talentFunnel.ts`) | **143 offres \| 143 lieu \| 141 desc \| 143 date \| 16 s** |
| Ba&sh | **HTML serveur + adaptateur écrit** (`bashTalents.ts`) | **50 offres \| 50 lieu \| 50 desc \| 50 date \| 9–30 s** |

Tests : `npx vitest run src/ats/adapters/{rituals,asosAlgolia,talentFunnel,bashTalents}.test.ts`
→ **4 fichiers, 28 tests, 28 verts**. `tsc --noEmit` : aucune erreur sur les fichiers g4.

---

## 1. Rituals — `careers.rituals.com`

**Verdict : API TROUVÉE, adaptateur écrit** — `src/ats/adapters/rituals.ts` (`fetchRitualsJobs`).

- **Appel** : `POST https://careers.rituals.com/api/v1/jobs/` — en-tête `content-type: application/json`, aucune clé. Réponse Elasticsearch brute (`hits.total.value`, `hits.hits[]._source`).
- **Body exact** (capturé par Playwright, rejoué tel quel avec `CatwalksJobsBot/0.1`, 200) :
  `{"role":[],"department":[],"locationType":"all","isInternal":false,"typeOfShop":[],"lat":0,"lon":0,"locationName":[],"distanceInKm":"","textQuery":"","careerLevel":[],"grade":[],"jobFamily":[],"language":"fr-FR","page":1}`
- **Pagination — piège n° 1, mesuré** : elle est **cumulative**. `page:1` → 20 hits, `page:2` → 40, `page:3` → 60, **tous en partant du premier** (même `refNumber` en tête). Ni `size` ni `pageSize` ne sont honorés (toujours 20). `page:13` (= ceil(252/20)) → **252 hits, 252 jobAdId uniques** ; `page:50` → toujours 252. L'adaptateur lit la page 1 pour le total puis **une seule** page dimensionnée `ceil(total/20)`. Condition d'arrêt : `hits.length >= total` ou plus de croissance.
- **Piège n° 2 : un index par locale, une locale = un pays.** Mesuré locale par locale (`g4-rituals-locales.mts`) :

  | locale | total | pays | | locale | total | pays |
  |---|---|---|---|---|---|---|
  | fr-FR | 252 | FR | | en-NL | 129 | NL |
  | de-DE | 269 | DE | | nl-NL | 129 | NL (**mêmes 129 ids qu'en-NL**) |
  | de-AT | 71 | AT | | es-ES | 66 | ES |
  | nb-NO | 55 | NO | | pl-PL | 45 | PL |
  | it-IT | 41 | IT | | en-GB | 34 | GB |
  | de-CH | 32 | CH | | pt-PT | 22 | PT |
  | ro-RO | 18 | RO | | nl-BE | 16 | BE |
  | sv-SE | 12 | SE | | en-IE | 10 | IE |
  | hu-HU | 8 | HU | | fi-FI | 4 | FI |
  | da-DK | 2 | DK | | fr-CH / fr-LU | 1 / 1 | CH / LU |
  | fr-BE | 0 | — | | | | |

  Somme annoncée 1 217, **1 088 offres uniques** après dédup par `jobAdId` (seul chevauchement : en-NL = nl-NL). Les 22 locales viennent du sitemap `https://careers.rituals.com/api/sitemap/`. Le défaut de l'adaptateur est `fr-FR` ; passer `languages:[…]` pour le monde.
- **Champs (`_source`)** : id `jobAdId` · titre `title` · lieu `city`, `postalCode`, `country` (ISO-2), `lonLat.lat/lon` · date `releasedDate` (**epoch millisecondes**, pas secondes) · description `jobDescriptionPlain` + `qualificationsPlain` + `additionalInformationPlain` (déjà en texte brut ; 252/252 > 200 caractères) · contrat `contractType.label` · fonction `function` · langue `languageData.code`.
- **URL publique** : `https://careers.rituals.com/{locale}/jobs/{slug}/{jobAdId}/`. Le serveur **ignore le slug** (mesuré : `/fr-FR/jobs/x/<id>/` → 200 avec le vrai `<title>`). Le slug généré depuis le titre coïncide avec celui du sitemap sur 250/252 ; les 2 écarts sont « & » rendu « et » en français — sans effet sur la résolution.
- **Config** : `{}` (fr-FR) ou `{ "languages": ["fr-FR","de-DE",…] }` ; `origin` optionnel.
- **Mesure** : `npx tsx src/discovery/g4-rituals.mts` →
  `rituals (fr-FR): 252 offres | 252 lieu | 252 desc | 252 date | 0s | declaredTotal=252 truncated=false`
  `ex: Responsable Adjoint(e) - CDI 35h - Euralille @ Lille, FR → https://careers.rituals.com/fr-FR/jobs/responsable-adjoint-e-cdi-35h-euralille/e7ecf015-19bd-4842-a8cb-acb9052bbb43/`
  22 locales : `1088 offres | 1088 lieu | 1084 desc | 1088 date | 3s | declaredTotal=1217` (les 129 « manquants » sont la locale nl-NL, doublon d'en-NL).

## 2. ASOS — `careers.asos.com` → `www.asoscareers.com`

**Verdict : API TROUVÉE, adaptateur écrit** — `src/ats/adapters/asosAlgolia.ts` (`fetchAsosJobs`).

- **Appel** : `POST https://RVMOB42DFH-dsn.algolia.net/1/indexes/production__asoscare2201__sort-rank/query`, en-têtes `x-algolia-application-id: RVMOB42DFH`, `x-algolia-api-key: 2b53aa632c86586c5c2ad89bc0791a7b`, body `{"query":"","hitsPerPage":100,"page":0}`. Mécanique de `lvmhAlgolia.ts` (hitsPerPage/page, arrêt quand `page+1 >= nbPages` ou page incomplète).
- **Mesuré** : `nbHits 64, nbPages 1, exhaustiveNbHits true` — les 64 offres tiennent en une page. Le site lui-même n'en demande que 5 par page (`hitsPerPage=5`), d'où l'impression d'un portail tronqué.
- **Clé** : en clair dans le HTML de la page d'accueil (`const AG_ID = "RVMOB42DFH"; const AG_KEY = "2b53…"; const AG_INDEX = {"default":"production__asoscare2201__sort-rank"}`). Sur 403, l'adaptateur relit `AG_KEY` dans la page une fois, puis **échoue fort** (jamais un « 0 offre » silencieux).
- **Champs** : id `objectID` (aussi `ats_requisition_id` = id SmartRecruiters) · titre `title` · ville `town_city` (London 62 / Barnsley / Watford) — **`location` vaut « Nationwide » sur les 64 hits, c'est une étiquette de site, pas un lieu** · pays **absent du flux** (laissé undefined) · date `opening_date_timestamp` (secondes, présent sur 32/64) sinon `opening_date` jj/mm/aaaa (64/64) · description `description` + `qualifications` (HTML → texte ; 64/64 > 200 car.) · contrat `contract_type` · `department`, `team`, `work_level` dans `raw`.
- **URL publique** : `jd_url` est **relatif** (`/job-search/…/744000147479639`) → résolu sur `https://www.asoscareers.com` (vérifié 200). `apply_url` (SmartRecruiters `jobs.smartrecruiters.com/ASOS/…`) reste dans `raw`, disponible si le câblage préfère l'ATS.
- **Config** : `{}` (tout est épinglé) ; `appId`, `indexName`, `apiKey`, `siteOrigin` optionnels.
- **Mesure** : `npx tsx src/discovery/g4-asos.mts` →
  `asos: 64 offres | 64 lieu | 64 desc | 64 date | 0s | declaredTotal=64 truncated=false`
  `ex: Digital Trading Assistant @ London → https://www.asoscareers.com/job-search/commercial-customer/global-commerce/london/digital-trading-assistant/744000147479639`

## 3. Dr. Martens — `jobs.drmartens.com` (ATS : Talent Funnel)

**Verdict : API TROUVÉE, adaptateur écrit** — `src/ats/adapters/talentFunnel.ts` (`fetchTalentFunnelJobs`), nommé par le vendeur (`ats-api.talent-funnel.com`), pas par la maison.

- **Le `__NEXT_DATA__` de `/results` ne porte que 15 vacancies sur 143** (`pageProps.vacancies`, `totalResults: 143`) ; la liste complète vient d'un XHR vers un autre hôte.
- **Liste** : `POST https://ats-api.talent-funnel.com/js/search/vacancy`, body
  `{"limit":5000,"start":0,"sort":[{"order":"DESC","field":"createdDateTime"}],"fields":["id","category","company","description","hoursType","jobTitle","location","remuneration","applicationUrl","validFrom","validTo"]}`.
  **En-tête obligatoire `tenant: a3e88308-2615-4415-bb56-cc5267bc1ced`** — sans lui : 403 quels que soient Origin/Referer/User-Agent (testé les trois). Le tenant est en clair dans le `__NEXT_DATA__` de la page (15 occurrences) et dans chaque vacancy. Pagination : `start` = offset (vérifié `start=100&limit=50` → 43 sur 143), `totalResults` = total ; l'adaptateur pagine par 500.
- **Piège mesuré** : la recherche rend `description` **vide sur 142/143** (même avec `excludeContent:false`). Le texte complet est dans **`GET https://ats-api.talent-funnel.com/js/vacancy/{id}`** (même en-tête `tenant`) → `positionProfile.description` (~5 Ko HTML), `contractType`, `hoursType`, `seniority`, `remoteWorking`, `language`, `location.postCode`, `remuneration`. Un appel par offre, 4 en parallèle, 16 s au total. `/js/search/vacancy/{id}` → 404 (pas de raccourci).
- **Champs** : id `id` · titre `jobTitle` · lieu `location.city`, `location.country` (ISO-2 ; 13 pays : US, FR, IN, GB, DE, IT, NL, AT, DK, BE, ES, VN, HK), `location.geoLocation.coordinates` = `[[lon, lat]]` (GeoJSON, longitude d'abord) · date `validFrom` (aaaa-mm-jj, 143/143) · `validTo` = `9999-12-31` quand sans échéance → ignoré · salaire `remuneration.ranges[0]` (`value: 0` = « Dependent on experience » → ignoré ; `currency` présent sur une partie seulement, jamais devinée) · `category` → department.
- **`company.name` est l'entité régionale** (« Dr. Martens US », « Dr. Martens FR », « Dr Martens »… 15 variantes) : **non propagée** comme employeur — elle ferait 15 sociétés fantômes (cf. D11). Reste dans `raw`.
- **URL publique** : `https://jobs.drmartens.com/job/{id}` (vérifié 200). `applicationUrl` (formulaire `forms.talent-funnel.com`) dans `raw`.
- **Config** : `{ "origin": "https://jobs.drmartens.com", "tenant": "a3e88308-2615-4415-bb56-cc5267bc1ced" }` ; `withDescriptions:false` pour la liste seule ; `api` optionnel.
- **Mesure** : `npx tsx src/discovery/g4-drmartens.mts` →
  `drmartens (detail=true): 143 offres | 143 lieu | 141 desc | 143 date | 16s | declaredTotal=143 truncated=false`
  `ex: Part Time Sales Associate - North Star @ San Antonio, US → https://jobs.drmartens.com/job/3JdSjP2U8xS10ZhJSvMeCy`
  (2 offres ont une description < 200 caractères à la source, 2 n'ont pas de ville dans le flux mais ont un pays.)

## 4. Ba&sh — `talents.ba-sh.com` (l'hôte `carriere.ba-sh.com` du brief n'existe pas)

**Verdict : rendu SERVEUR, aucun XHR — adaptateur HTML écrit** — `src/ats/adapters/bashTalents.ts` (`fetchBashTalentsJobs`).

- **`carriere.ba-sh.com` → NXDOMAIN** (`dig` vide, curl `http=000`, Playwright `ERR_NAME_NOT_RESOLVED`). Le lien « Carrières » de `ba-sh.com/fr/fr/` pointe sur **`https://talents.ba-sh.com/fr-FR/offres`** (c'est aussi l'URL de `sources.gated.csv`).
- **Aucun appel XHR ne liste les offres** : le listing est un HTML de 426 Ko rendu par PHP (`FRONTOFFICE/…`, jQuery), avec les offres en **microdonnées `itemscope itemtype="http://schema.org/JobPosting"`**. Pas de JSON-LD (0 sur le listing et le détail — d'où le 0 du générique), pas de `sitemap.xml` (404), `robots.txt` n'interdit que `/BACKOFFICE/`, `/DATAS/`, `/KERNEL/`. Le site affiche **« 50 Résultats »** et rend 50 blocs — **le 58 du brief est d'une autre date**. Une seule page.
- **Sélecteurs du listing** (mesurés sur 50/50) : bloc = `<div class="job-wrapper simulate-href" attr-href="https://talents.ba-sh.com/fr-FR/offre/BASH_xxx" itemscope …>` ; titre `itemprop="title"` ; métier `itemprop="industry"` ; lieu `<i class="icon icon-position"></i> <b>Ville, Région</b>` (+ `addressLocality` / `addressRegion`) ; contrat `<i class="icon icon-contract"></i> <b>CDD|CDI|Stage|Alternance</b>` ; date `itemprop="datePosted"` jj/mm/aaaa (50/50) ; `itemprop="employmentType"`. **`itemprop="description"` n'est rempli que sur 3/50** → détail obligatoire.
- **Détail** `/fr-FR/offre/BASH_xxx` : `<p class="title-primary" itemprop="title">`, puis trois blocs `cms-content` : intro maison (ignorée), **« Descriptif du poste »** (`itemprop="description"`) et **« Profil recherché »** — concaténés. `itemprop="experienceRequirements"` (ex. « Etudiant ») gardé dans `raw`. Le HTML est du Word collé (`<!DOCTYPE html>` imbriqué, styles `Mso*`) encodé en **entités nommées** (`&eacute;`, `&ccedil;`, `&laquo;`…) que `htmlToPlainText` ne décode pas : l'adaptateur les décode avant — **0 entité résiduelle sur 50** après correction (il y en avait sur les 50 avant).
- **Config** : `{}` ; `origin`, `locale` (fr-FR), `withDescriptions`, `detailConcurrency` optionnels. 51 requêtes par run (1 listing + 50 détails à 4 en parallèle).
- **Mesure** : `npx tsx src/discovery/g4-bash.mts` →
  `bash (detail=true): 50 offres | 50 lieu | 50 desc | 50 date | 9s | declaredTotal=50 truncated=false`
  `ex: responsable f/h - boutique toulouse - cdd 39h @ Toulouse, Occitanie → https://talents.ba-sh.com/fr-FR/offre/BASH_35C529`
  `descriptions avec entités HTML résiduelles: 0` (premier run avant la porte par hôte chaude : 30 s).

---

## Fichiers livrés (tous nouveaux, aucun fichier existant modifié)

- Adaptateurs : `src/ats/adapters/rituals.ts`, `asosAlgolia.ts`, `talentFunnel.ts`, `bashTalents.ts`
- Tests : `src/ats/adapters/rituals.test.ts`, `asosAlgolia.test.ts`, `talentFunnel.test.ts`, `bashTalents.test.ts` (fixtures capturées le 2026-09-06, inline comme `icims.test.ts`)
- Scripts de mesure : `src/discovery/g4-rituals.mts`, `g4-rituals-locales.mts`, `g4-asos.mts`, `g4-drmartens.mts`, `g4-bash.mts`
- Captures : `src/discovery/g4-sniff.mts` (bodies des 4 portails), `g4-drm-headers.mts` (a révélé l'en-tête `tenant`), `g4-drm-detail.mts`

## À câbler par le demandeur

- Dispatch `src/ats/index.ts` + `KIND_TO_ATS` + enum Prisma `AtsType` : quatre types à nommer (suggestion : `RITUALS`, `ASOS_ALGOLIA`, `TALENT_FUNNEL`, `BASH_TALENTS`). Talent Funnel est un vendeur générique : tout autre portail appelant `ats-api.talent-funnel.com` se configure avec `origin` + `tenant`.
- Décisions ouvertes, non prises ici : (a) Rituals — `fr-FR` seul ou les 22 locales (1 088 offres, 20 pays) ; (b) ASOS — `url` = page ASOS (`jd_url`, choisi) ou lien SmartRecruiters (`apply_url`, dans `raw`) ; (c) Dr. Martens — `company` laissé au registre plutôt que les 15 entités régionales du flux.
