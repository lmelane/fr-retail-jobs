# Audit a4 — informations des offres : ce que la Maison publie vs ce que nous affichons

Lecture seule, prod (`sakura.proxy.rlwy.net:40792`), 2026-09-06. Aucune écriture, aucun commit.
Scripts : `apps/aggregator/src/discovery/a4-*.mts` ; SQL, pages et résultats dans le scratchpad de session (`a4-*.sql`, `a4-*.out`, `a4-pages/`, `a4-digest.txt`).

## 0. Méthode et périmètre

- **Échantillon** : 50 offres actives, stratifiées — les 15 plus grosses sources × 2 offres + 20 sources tirées au hasard (`md5`) × 1 offre (`a4-sample.sql`, tirage 09:56 UTC). Les 15 têtes : ulta-jibe 9 959, lvmh 5 655, michael-page-france 3 330, foot-locker-france 2 839, kering 2 468, tapestry 2 005, pandora-talenthub 1 842, loreal 1 782, l-oreal-professionnel 1 771, mango 1 573, estee-lauder-companies 1 470, boots 1 401, pvh 1 347, richemont-workday 1 335, levis 1 311. Dix offres des rangs 16–20 (nordstrom, parfums-chanel, rituals, adidas, hm-group) ont aussi été relevées : citées « hors échantillon » quand elles apportent une preuve.
- **Pour chaque offre** (une requête par page, `fetchWithRetry`, 4 en parallèle) : la base (`Job` + `JobSource.raw`), la page du site `https://modecareers.com/offre/<id>` (JSON-LD JobPosting), la page d'origine `Job.url` (JSON-LD ou API détail de l'ATS : Workday cxs en `en-US` **et** `fr-FR`, SmartRecruiters, Eightfold, Teamtailor, iCIMS). Aucun rendu Playwright n'a été nécessaire.
- **Base mouvante pendant l'audit** : 76 722 offres actives à 09:56 UTC, 72 710 à 11:33 UTC. La source `loreal` (1 782 offres, rang 8) a été retirée entre les deux (0 `JobSource` restante à 11:33) ; ses deux offres échantillonnées sont conservées pour mémoire (n° 15–16). `l-oreal-professionnel` est passée **BROKEN** à 10:17 UTC (0 offre lue contre 1 716 au run précédent) — hors sujet ici, à remonter à l'audit cadence.
- **Vocabulaire** : ✓ conforme à la source · **P** présent à la source mais perdu chez nous · **A** absent à la source · **F** faux chez nous (valeur différente de ce que la Maison publie) · — non vérifiable sans rendu JS.

## 1. Résumé

1. Sur 50 offres, **titre, ville, description et date sont fidèles dans ≥ 86 % des cas** ; les pertes se concentrent sur **temps de travail (30/50 perdus)**, **marque (7 fausses)**, **langue (12 nulles, 2 fausses)**, **pays (4 perdus, 6 absents mais récupérables)** et **lien de candidature (2 murs de login)**.
2. **Cause systémique n° 1 — la base ne guérit pas** : `reattestationFields` (`src/dedup/upsert.ts:378-396`) ne ré-écrit que titre/description/lieu/ville/pays. `postedAt`, `language`, `contract`, `workingTime`, `validThrough`, `salary`, `companyId`, `source` ne sont écrits **qu'à la création**. Mesuré : lignes nées avant le 04/09 → 38 % sans date, 80 % sans langue ; nées après → 3 % et 2 %. C'est ce trou qui explique LVMH (5 212/5 214 sans date alors que 4 131 `raw` portent `publicationTimestamp`), Parfums Chanel, L'Oréal, Kering, Michael Page, les sociétés « Richemont Logo » et les 1 043 offres Kering étiquetées « Kering ».
3. **Cause n° 2 — les valeurs schema.org `FULL_TIME` / `PART_TIME` ne sont pas reconnues** (`src/normalize/contract.ts:84-85` : `/PART[ -]TIME/`, `/FULL[ -]TIME/` — pas de `_`). Rejoué : `PART_TIME → UNKNOWN`. Pandora, PVH, Foot Locker, Teamtailor, Kering, Greenhouse perdent le temps de travail à 100 %. Workday (14 385 offres) le perd aussi : `timeType` n'est pas lu (`workday.ts:105-116`).
4. **Cause n° 3 — le détail Workday est demandé en français** : la liste force `en-US` (`workday.ts:52`) mais `attachWorkdayDescriptions` (`workday.ts:173`) hérite du `accept-language: fr-FR` du transport (`http.ts:143`). Résultat : 1 794 offres Tapestry en français machine (« Coach est une maison de mode… »), 65 offres chez « **Entraîneur** Netherlands B.V. », pays « États-Unis d'Amérique » (98 lignes non-ISO).
5. **Foot Locker (2 839 offres, 100 %)** : le lien de candidature est la page **`/login` d'iCIMS** (titre « Login ») ; la fiche publique existe (`/jobs/<id>/job`, HTTP 200 avec JSON-LD complet). Marque « Foot Locker France » sur 1 769 offres américaines.
6. **LVMH : 2 628 offres (46 %) envoient sur un formulaire de candidature** (`emea3.recruitmentplatform.com/apply-app` → `lvmh.com/rac/csod/prod/apply.html`, titre « Application Form »), pas sur la fiche.
7. **Estée Lauder : pays perdu sur 1 469/1 470** — `standardizedLocations` est une liste de **chaînes** (« Pretoria, GP, ZA »), l'adaptateur la lit comme des objets (`eightfold.ts:39,102,116`).
8. **JSON-LD du site** : `addressCountry` **n'est pas figé à FR** (vérifié code + 50 pages : US, IT, TW, MY, AU, GB, CH…) — le point ouvert de CLAUDE.md est clos. En revanche **21 157 offres actives (29 %) publient un `validThrough` déjà passé** (repli `datePosted + 60 j`, `apps/web/lib/job-posting-schema.ts:53-55`), 11 315 publient `firstSeenAt` comme `datePosted`, 14 074 n'ont pas d'`addressCountry`.
9. **Mise en forme** : 5 605 descriptions sans aucun retour à la ligne (L'Oréal 1 685, Foot Locker 1 020, Crocs 495…) rendues d'un bloc (`whitespace-pre-line`) ; 2 515 descriptions et 123 titres affichent des entités HTML brutes (« d&amp;apos; » lisible tel quel dans le `<h1>` du site).
10. **Périmètre** : Michael Page — 76 titres sur 3 334 (2,3 %) ressemblent au secteur ; Mosaic (ONG, offre de 2014), Make (make.com), Stone by Stone (paiements brésiliens) sont dans le catalogue sous une identité erronée.

## 2. Taux par champ sur les 50 offres

| Champ | ✓ | P perdu | A absent à la source | F faux | Commentaire |
|---|---|---|---|---|---|
| Titre | 50 | 0 | 0 | 0 | Base entière : 123 titres avec entités HTML brutes (§4.9) |
| Société / marque (D11) | 36 | 5 | 2 | 7 | F : n° 7, 8, 11, 12, 17, 53, 54 · P (marque déductible, groupe ou entité juridique affichée) : 19, 20, 27, 55, 18 · A : PVH 25, 26 |
| Ville | 44 | 1 | 1 | 2 | P : 54 (« LAS VEGAS » à la source, `null` chez nous) · F : 30 (« Kittery Premium Outlets »), 45 (« Brown Thomas ») · A : 7 (remote) · 15–16 inconnus |
| Pays | 38 | 4 | 6 | 0 | P : 21, 22 (ZA/PT présents), 60 (« Madrid, Spain » stocké, pays `null`), 54 (« États-Unis d'Amérique » non-ISO) · A mais récupérable : 17, 18, 23, 24, 45, 48 |
| Contrat | 6 | 4 | 40 | 0 | P : 21 (Fulltime-Regular), 22 (Fulltime-Temporary), 51 et 58 (`permanent`) ; la plupart des ATS ne publient qu'un temps de travail |
| Temps de travail | 7 | **30** | 13 | 0 | P : toutes les valeurs `FULL_TIME`/`PART_TIME`/`Full time`/`Teilzeit` publiées (§4.2) |
| Salaire | 1 | 0 | 49 | 0 | Seul Michael Page (n° 5) publie une fourchette ; Ulta/Boots publient `value: 0` |
| Date de publication | 45 | 5 | 0 | 0 | P : 3, 4 (LVMH `publicationTimestamp`), 17, 18 (JSON-LD `datePosted`), 45 (Taleo « 2026-07-27 00:00:00.0 ») → le site publie `firstSeenAt` à la place (F sur la page) |
| Date de fin (`validThrough`) | 4 | 3 | 43 | 0 | P : 11 (`endDate` cxs 2026-09-30), 1, 2 (Ulta) · ✓ : 25, 26, 43, 50 |
| Description | 38 | 2 | 4 | 6 | P : 15, 16 (`NULL`, source retirée) · A (stub à la source) : 9 (157 c.), 29, 30 (115 c.), 47 (78 c.) · F : 11, 12 (traduction machine fr), 17, 18, 42 (mur sans paragraphes), 18 (version structurée écartée, §4.8) · **aucune troncature** mesurée (site ≈ base ≈ source) |
| Lien de candidature | 46 | 0 | 0 | 4 | F : 7, 8 (mur de login iCIMS), 43 (URL polluée `&amp;apos;`, mais 200), 60 (403 WAF pour un robot ; à confirmer en navigateur) |
| Langue | 36 | 12 | 0 | 2 | P : 3, 4 (`raw.language` EN/IT présent), 10 (`inLanguage` en-US) + 9 lignes nées avant le 04/09 jamais détectées · F : 11, 12 (`fr` sur une offre publiée en anglais) |

## 3. Constats BLOQUANTS

### B1 — La ré-attestation ne guérit ni la date, ni la langue, ni le contrat, ni la société
- **Fait** (11:33 UTC, 72 710 actives) : lignes nées avant le 04/09 (26 445) → `postedAt` null **38 %**, `language` null **80 %** ; nées après (46 265) → **3 %** et **2 %**. Par source : lvmh 5 276 lignes nées avant → 100 % sans date, 100 % sans langue ; 379 nées après → 0 % / 1 %. Même profil pour parfums-chanel (1 071 → 100 %/100 %, 22 → 0 %/5 %), kering (1 022 → langue 100 %), michael-page (3 166 → langue 100 %), foot-locker (2 783 → langue 100 %). LVMH : 4 131 `raw.publicationTimestamp` présents sur les 5 214 lignes du 02/09, `postedAt` null sur 5 212. `raw.language` présent (EN 2 794, FR 911, ZH-HANS 179, IT 164…) et `Job.language` null sur 93 %. Sociétés « Richemont Logo » (195), « Cartier Logo » (33), « Chloe Logo » (10), « Jaeger LeCoultre logo » (3), « Logo Diptyque » (149) : toutes nées le 04/09 entre 00:29 et 08:15 UTC, **avant** le correctif `8814924` (12:10 UTC) ; `pipelineVersion` 7, revues aujourd'hui, toujours attachées à la société fantôme.
- **Impact** : 15 % des offres affichent une fausse date (celle de notre premier passage), 33 % n'ont pas de langue (filtre/SEO `inLanguage`), 1 043 offres Kering et 1 628 Tapestry portent le nom du groupe, 390 offres portent « Logo ». Toute correction d'adaptateur ne s'applique qu'aux offres **futures**.
- **Cause** : `src/dedup/upsert.ts:378-396` (`reattestationFields` : `title/description/location/city/country` seulement) ; `src/dedup/upsert.ts:440-475` (update sans `postedAt`, `language`, `contract`, `workingTime`, `validThrough`, `salary*`, `companyId`, `source`). `companyId` n'apparaît que dans le chemin de création (`:211`).
- **Correction** : étendre `reattestationFields` à tous les champs normalisés quand le candidat porte une valeur (`postedAt`, `validThrough`, `language` — ou `detectLanguage(description)` si null —, `contract`, `workingTime`, `salaryMin/Max/Currency/Period`, `remote`, `department`) et ré-attacher `companyId` quand `resolveCompany(candidate.company).key` diffère de la société existante ; ajouter un test sur une ligne née sans date/langue re-attestée avec. Métrique : `heal_gap_global` (a4-facts9.sql) → écart « avant/après 04/09 » ≤ 2 points.

### B2 — Foot Locker : 2 839 liens (100 %) mènent à la page de login iCIMS, sous une marque fausse
- **Fait** : `SELECT count(*) … url ~ '/login(\?|$)'` → **2 842** offres actives, 2 839 pour `foot-locker-france`. Offre n° 7 : `https://us-corp-footlocker.icims.com/jobs/71809/login` → HTTP 200, `<title>Login</title>`, aucun JSON-LD. La fiche publique `…/jobs/71809/job?in_iframe=1` → 200, JSON-LD complet (`employmentType: FULL_TIME`, `hiringOrganization: Foot Locker`). L'API Phenom (`careers.footlocker.com/api/jobs`) publie `apply_url = …/login`, `hiring_organization: "Foot Locker"`, `employment_type: PART_TIME`, `tags4: ["Kids Foot Locker"]` (enseigne), `posted_date`. Le repli de l'adaptateur `${origin}/job/${id}` (`phenom.ts:82`) répond **404** (`/job/71906`, `/job/71906/sales-lead`). Société : 2 839 offres « Foot Locker France », dont 1 769 aux États-Unis, 189 en Allemagne, 179 en Italie.
- **Impact** : le candidat clique « Postuler chez Foot Locker France » pour un poste à Fayetteville (NC) et tombe sur un formulaire d'identification. C'est la promesse D18 (« l'offre Cartier mène chez Cartier ») rompue sur 4 % du catalogue.
- **Cause** : `src/ats/adapters/phenom.ts:82` (`url: data.applyUrl ?? data.apply_url`), pas de champ `company` (`:70-82`) → étiquette du catalogue « Foot Locker France ».
- **Correction** : `url = apply_url.replace(/\/login$/, '/job')` (fiche iCIMS publique, vérifiée 200 ×2) ; `company: data.hiring_organization` (« Foot Locker ») et, pour l'enseigne, `tags4` (« Kids Foot Locker », « Champs Sports »…) ; renommer la ligne de catalogue.

### B3 — Le JSON-LD du site publie 21 157 offres actives (29 %) comme expirées
- **Fait** : `validThrough IS NULL AND coalesce(postedAt, firstSeenAt) < now() − 60 j` → **21 157** sur 72 710 (ulta-jibe 5 686, foot-locker 2 317, michael-page 1 161, mango 799, tapestry 777, rituals 654, boots 496…). Pages vérifiées : n° 2 `validThrough: 2026-08-08` (offre publiée le 09/06, toujours listée par Ulta le 06/09) ; n° 8 `2026-06-30` ; n° 20 `2025-02-17` ; n° 58 `2014-08-24`. Seules 15 offres ont un `validThrough` **stocké** passé.
- **Impact** : Google Jobs traite un `validThrough` passé comme une offre expirée (erreur « Job posting expired » dans Search Console) → ces pages ne sont pas éligibles aux résultats enrichis. C'est le levier d'acquisition D14 qui s'éteint sur un tiers du catalogue, alors que l'offre est vivante (re-listée par la source à chaque run).
- **Cause** : `apps/web/lib/job-posting-schema.ts:26,53-55` — repli `datePosted + 60 j` calculé depuis la date de publication, pas depuis la dernière ré-attestation.
- **Correction** : repli = `max(job.validThrough, job.lastSeenAt + N j)` (N = 2 × l'intervalle de refresh, ex. 30 j) : une offre re-listée reste valide, et le 410 (D22) coupe quand elle disparaît. Lire aussi `validThrough` quand la source la donne (Workday `endDate`, n° 11 : 2026-09-30 publié, null chez nous — `workday.ts:105-116` ne le lit pas).

### B4 — LVMH : 2 628 offres (46 %) envoient sur un formulaire de candidature, pas sur la fiche
- **Fait** : `url` par préfixe (lvmh, 5 655 actives) : `emea3.recruitmentplatform.com/apply-app/…` **2 628**, `career55.sapsf.eu/sfcareer/jobreqcareer` 2 011, `eljs.fa.us2.oraclecloud.com/…CandidateExperience` 423. Suivi : la première (Louis Vuitton, n° `cmtk48qp81g4uny2byu5eltqx`) redirige vers `https://www.lvmh.com/rac/csod/prod/apply.html?jobId=…`, `<title>Application Form</title>`, sans description ni JSON-LD ; la deuxième (Sephora) redirige vers `jobs.sephora.com/…/job/…` (fiche, 200) ; la troisième (Tiffany) → fiche Oracle (200).
- **Impact** : pour Louis Vuitton (615), Christian Dior Couture (480), Parfums Christian Dior, Guerlain, Celine… le candidat quitte Mode Careers pour un formulaire sans le texte de l'offre.
- **Cause** : `src/ats/adapters/lvmhAlgolia.ts:141` — `url: hit.link` (le lien « postuler » du hub, pas la fiche).
- **Correction** : pour les `link` Lumesse (`recruitmentplatform.com/apply-app`), pointer la fiche publique LVMH du jobhub (route publique déjà connue, cf. mémoire « API publique LVMH jobhub ») ou la fiche de la Maison ; garder `hit.link` quand il mène à une fiche (SAP SF, Oracle). Test : 0 URL active contenant `apply-app` ou `apply.html`.

## 4. Constats IMPORTANTS

### 4.1 Tapestry (2 005) : offres traduites en français par la machine, société « Entraîneur »
- **Fait** : 1 794 offres `language = fr`, dont **1 684** hors pays francophones ; descriptions « Coach est une maison de mode internationale… » (1 326), « Depuis son lancement en 1993… Kate Spade » (458). Sociétés « Entraîneur Netherlands B.V. - Taiwan Branch » (9), « Entraîneur Malaysia SDN. BHD. » (15), « Entraîneur Hong Kong Limited » (17) — 65 au total ; « Coach Stores Australie » (11). Contre-preuve : le même détail cxs en `en-US` rend `hiringOrg: "Coach Netherlands B.V. - Taiwan Branch"`, description « Coach is a global fashion house… », `country: "Taiwan Region"` ; en `fr-FR` : « Entraîneur… », « Coach est… », « Taïwan ». Nos valeurs sont celles de la réponse `fr-FR`.
- **Cause** : `src/ats/adapters/workday.ts:173` (`fetchJson(cxsBase+path)` sans en-tête) → `src/lib/http.ts:143` (`accept-language: fr-FR,fr;q=0.9,en;q=0.7`). Le même mécanisme explique 98 pays « États-Unis d'Amérique », 27 « Royaume-Uni », 21 « Italie », 18 « Singapour » stockés non-ISO (`country_not_iso`), et 161 Levi's / 108 Richemont en `fr` hors pays francophones.
- **Correction** : passer `{ headers: { 'accept-language': 'en-US,en;q=0.9' } }` (ou le locale du tenant) dans `attachWorkdayDescriptions`, comme la liste (`:52`) ; les 98 pays non-ISO guériront via `reattestationFields` (`normalizeCountry("États-Unis d'Amérique") → US`, rejoué).

### 4.2 Temps de travail perdu sur 30/50 offres (84 % de la base)
- **Fait** : `workingTime` null 64 472/76 722. Rejeu du normaliseur : `PART_TIME → UNKNOWN`, `FULL_TIME → UNKNOWN`, `Teilzeit → UNKNOWN`, `Fulltime-Regular → contract CDI, workingTime UNKNOWN` ; `Part time`, `Full-time` → ✓. Workday : 14 385/14 385 null alors que chaque détail porte `timeType` (« Full time », « Part time », « Variable ») ; Pandora 1 842/1 842 (JSON-LD `["PART_TIME"]`), PVH 1 347 (`FULL_TIME`), Foot Locker 2 842 (`PART_TIME`), Teamtailor (`FULL_TIME` sur n° 41, 46, 49, 56, 59), Estée Lauder 1 470 (`assignmentcat: Fulltime-Regular`).
- **Cause** : `src/normalize/contract.ts:84-85` (`/PART[ -]TIME/`, `/FULL[ -]TIME/`) ; `src/ats/adapters/workday.ts:105-116` (`timeType` absent du type et du mapping `:175-185`) ; `src/ats/adapters/eightfold.ts` (aucune lecture de `custom_JD.data_fields.assignmentcat`).
- **Correction** : regex `/PART[ _-]?TIME|TEMPS[ -]PARTIEL|MI[ -]TEMPS|TEILZEIT|\d{1,2}\s?H\b/` et `/FULL[ _-]?TIME|TEMPS[ -]PLEIN|PLEIN[ -]TEMPS|VOLLZEIT|35H|39H/` ; Workday : `workingTime: info.timeType`, `remote: info.remoteType` ; Eightfold : `contract/workingTime` depuis `assignmentcat` (« Fulltime-Regular » → CDI + TEMPS_PLEIN, « Fulltime-Temporary » → CDD + TEMPS_PLEIN). Test unitaire sur ces 6 valeurs.

### 4.3 Estée Lauder (1 470) : pays perdu à 100 %, alors que la source le publie
- **Fait** : `country` null 1 469/1 470 ; `location` stocké « PRETORIA,ZA-GP,South Africa », « LISBOA,PT-11,Portugal », « London,GB-LND,United Kingdom ». Le `raw` porte `standardizedLocations: ["Pretoria, GP, ZA"]` ; le JSON-LD de la page publie `addressCountry: {name: "ZA"}`. Kering (même adaptateur) : 179/1 041 null ; la recherche Eightfold rend `["Vienna, Vienna, AT"]`, `["Taipei City,TW"]`.
- **Cause** : `src/ats/adapters/eightfold.ts:39` (`standardizedLocations?: Array<{city, country}>`), `:102` et `:116` (`standardized?.country` sur une **chaîne** → `undefined`).
- **Correction** : `const parts = String(standardizedLocations[0]).split(',').map(s => s.trim()); country = parts.at(-1)` (ISO-2), `city = parts[0]` ; repli `locations[0]` découpé sur `,` (« PRETORIA,ZA-GP,South Africa » → pays « South Africa »). Test sur les deux formes.
- **Même famille** : 12 282 offres sans pays, dont **2 736** portent un nom de pays en fin de `location` (`country_null_recoverable_from_location`) ; boots 1 401 (board britannique sans champ pays → `Source.config.defaultCountry: GB`), make 15 (« Madrid, Spain »), herschel 7 (« Vancouver »), brown-thomas-taleo 68. Effet direct sur le JSON-LD : **14 074 pages sans `addressCountry`** (champ obligatoire de `jobLocation` pour Google) et sur le filtre Pays.

### 4.4 Marque (D11) : groupe, entité juridique ou artefact affiché à la place de la Maison
- **Kering** : 1 043 offres « Kering » ; **901 titres** commencent par la marque (« GUCCI Client Advisor, Harrods », « SAINT LAURENT Assistant Store Director… », « BOTTEGA VENETA Store Manager ») ; l'API détail rend `business_unit: "Gucci"` (offre 563705892604101, vérifié). `brandOf` (`eightfold.ts:67`) lit bien `business_unit`, mais 863 lignes sont nées `GENERIC_JSONLD` avant l'adaptateur et 180 `EIGHTFOLD` restent « Kering » : la société n'est jamais ré-attachée (B1). Source DEGRADED au dernier run.
- **Richemont** : 241 offres sous « … Logo » (B1) ; 600 « Richemont » sur `richemont-workday` dont la boutique est codée dans le JSON-LD de la page (« Boutique CAR - MUMBAI », CAR = Cartier ; « Boutique CHL - LAS VEGAS », CHL = Chloé) mais pas dans le cxs `location` (« MUMBAI »). `hiringOrganization` est une entité régionale (« IN01 Richemont India »).
- **Tapestry** : 1 628/2 005 sous « Tapestry, Inc. » ; la marque est dans le texte (Coach 1 461, Kate Spade 550) et dans `hiringOrg` (« Coach Stores Canada Corporation »).
- **H&M Group** : 1 002 sous le groupe ; `raw.department.label` = COS 96, ARKET 12, & Other Stories 11, Weekday 6 (l'adaptateur `smartrecruiters.ts:44-55` n'écrit pas `company`).
- **L'Oréal** (`l-oreal-professionnel`, `Source.maison = "L'Oréal"`) : 1 771 offres « L'Oréal Professionnel » ; 316 titres nomment une autre marque (Lancôme, Kiehl's, Armani…) ; n° 18 : la description microdata de la page commence par « **SalonCentric** Retail Store Manager ».
- **Estée Lauder** : trois orthographes (« Estée Lauder Companies » 410, « Estée Lauder - Brand » 126, « The Estée Lauder Companies » 4).
- **Entités juridiques Workday** affichées comme Maison : « MANGO MNG, S.A. » (1 573), « Nordstrom Inc » (1 294), « BRUNELLO CUCINELLI SUISSE SA », « Ulta Beauty, Inc. » ; **Dr Pierre Ricaud** : n° 53 est une offre « Groupe Rocher » (titre et page) attribuée à la marque de la ligne de catalogue.
- **Correction** : (a) B1 pour ré-attacher ; (b) Kering : marque = préfixe majuscule du titre parmi les Maisons connues, sinon `business_unit` ; (c) Richemont : lire le code boutique du JSON-LD de la page (table CAR/CHL/MTB/VCA/IWC…) quand `logoImage.alt` manque ; (d) Tapestry/H&M : `hiringOrg`/`department.label` contient Coach/Kate Spade/Stuart Weitzman/COS/ARKET… ; (e) `resolveCompany` : retirer les suffixes juridiques (`, Inc.`, `S.A.`, `SUISSE SA`, `Inc`) avant l'alias ; (f) L'Oréal : marque depuis le titre puis la première ligne de la description.

### 4.5 Dates perdues alors que la source les publie (11 315 pages avec `datePosted = firstSeenAt`)
- **LVMH** 4 186 (B1). **Parfums Chanel** 1 071/1 093 null : le cxs publie `startDate: 2026-07-01` / `2026-08-21` (n° 33–34, hors échantillon) — lignes nées le 02/09 (B1). **L'Oréal** 1 771/1 771 : la page publie `"datePosted": "2026-08-26"` (n° 18) et `"2026-02-01"` (n° 17) ; le parseur de détail les lit (`avature.ts:69`) mais la fusion `withDetails` (`avature.ts:372-379`) ne recopie pas `postedAt`. **adidas** 1 053/1 053 : la page SF ne porte aucune date (rejeu `parseMicrodataDetail` : `postedAt` absent ; `grep datePosted` vide) → **absent à la source**. **Brown Thomas (Taleo)** 68/68 : `"datePosted": "2026-07-27 00:00:00.0"` non parsé → le site publie `2026-09-06`. **tiffany-oracle** 392/419, **zegna-altamira** 60/60, **movado** 127/136.
- **Correction** : B1 ; Avature `:376` ajouter `postedAt: detail.postedAt ?? job.postedAt` ; Taleo : `Date.parse(value.replace(' ', 'T').replace(/\.0$/, ''))`.

### 4.6 Doublons Richemont : 208 postes affichés deux fois
- **Fait** : 388 `JR` communs entre `richemont` (site `broadbean_external`, 433) et `richemont-workday` (site `Richemont`, 1 335) ; **208** sous deux `Job` distincts (ex. JR132942 « Operations Coordinator - Boston » : `cmtm7vk7v13o5pv5jvak5advu` chez « Richemont Logo » et `cmtp524fs2dmwqq4zau00qirn` chez « Richemont »). Cause : `externalId` suffixé par site (`JR126663-1` / `-2`) et société différente (« Richemont Logo » vs « Richemont ») → la dédup ne les rapproche pas. Cas D34.
- **Correction** : externalId Workday = `jobReqId` sans suffixe de site ; après B1 (même société), `reconcile` fusionne ; sinon `retire-source richemont` (sous-ensemble strict : 388/433 déjà chez `richemont-workday`).

### 4.7 Michael Page : 97,7 % des offres hors secteur ; identités de catalogue fausses
- **Fait** : 3 334 actives, **76** titres évoquent mode/luxe/beauté/retail ; tirage : « Kinésithérapeute (F/H) », « Infirmier de Nuit », « Technicien de Maintenance Hydraulique SAV », « Conseiller Clientèle TPE ». Config : `listingUrl: https://www.michaelpage.fr/jobs` sans filtre sectoriel. **Mosaic** (n° 58) : `industry: Non-Profit Organization Management`, offre de 2014. **Make** (n° 60) : make.com, « Head of Brand » Madrid. **Stone by Stone** (443) : « Somos muito mais do que uma empresa de maquininhas! » (Stone, paiements, Brésil). **miu-miu** : « Physician - University Clinic » (2014).
- **Impact** : un candidat mode voit des offres d'infirmier ; les tuiles Entreprises mentent sur l'identité (cf. mémoire « sondes-slug ~70 % fausses »).
- **Correction** : Michael Page → `listingUrl` par secteur (distribution/retail, luxe) ; `retire-source` mosaic, make, stone-by-stone, miu-miu (Greenhouse) après vérification d'identité par le domaine de la marque.

### 4.8 Descriptions : murs de texte (5 605) et version structurée écartée
- **Fait** : 5 605 descriptions > 400 c. sans aucun `\n` (l-oreal-professionnel 1 685/1 771, foot-locker 1 020, crocs 495/495, avolta 226, rolex 205/208, prada-group 164, decjuba 147, douglas-sf 127, parfums-chanel 108, burberry 101, bentley 94). Le site rend en `whitespace-pre-line` (`apps/web/components/job-detail.tsx:167`) → un seul paragraphe. L'Oréal n° 18 : la page porte un bloc `itemprop="description"` de 21 837 c. HTML (21 `<p>`, 28 `<li>`) → `htmlToPlainText` rend 4 811 c. et 94 retours ; la base garde 7 598 c. et 0 retour (le `og:description`) parce que `avature.ts:447` ne remplace que si le texte est **plus long**.
- **Correction** : Avature — préférer la microdata quand elle existe (structure > longueur) ; SF/Phenom/Crocs — vérifier `htmlToPlainText` sur les balises `<br>`/`<p>` de ces pages (Crocs 100 % murs = le parseur, pas la source).

### 4.9 Entités HTML brutes : 123 titres, 2 515 descriptions, 231 URLs
- **Fait** : titre « Chargé_e d&amp;apos;études qualité (FHX) » (sephora-france) → sur le site, `<title>` et `<h1>` affichent littéralement `d&amp;apos;` (React ré-échappe), slug `charge-e-d-amp-apos-etudes…`. Titres : groupe-printemps 27, beiersdorf 26, groupe-chantelle 16 (Talentsoft, generic), sephora-france 6, aptar-beauty 5, bentley 5 (SF). Descriptions : Greenhouse — stone-by-stone 443, dept 216, gorjana 161, infuse 149, stripe-stare 141, reformation 138, quince 134, mejuri 118 (`&amp;` visible). URLs avec `&amp;` : adidas 81, rolex 58, avolta 14, crocs 13… (SF ; `jobs.adidas-group.com/job/…&amp;-Profit…/1419018033/` répond 200 grâce à l'id numérique, mais l'URL est fausse).
- **Correction** : décoder les entités (idempotent) sur `title`, `description`, `url` **à la frontière** (`pipeline/ingest.ts`, à côté de `htmlToPlainText`) ; Greenhouse : le corps est du HTML échappé deux fois → `unescape` avant `htmlToPlainText`.

### 4.10 SmartRecruiters (4 323) : langue et contrat publiés, ignorés
- **Fait** : l'API donne `language.code` (« hu » pour n° 40 Budapest ; « nl » n° 44) — non lu (`smartrecruiters.ts:6`, type `Posting` sans `language`) → détection statistique : n° 40 stocké **`pt`** (21 offres hongroises H&M en `pt`, 6 Primark, 3 Swarovski) ; 1 172 langues nulles. `typeOfEmployment.id = "permanent"` (2 209) → contrat perdu (3 553 null) : seul le `label` « Full-time » est lu, et il file en temps de travail.
- **Correction** : `language: job.language?.code`, `contract: typeOfEmployment.id` (`permanent` → CDI, `contract` → CDD, `intern` → STAGE), `workingTime: typeOfEmployment.label`, `company: department.label` quand il nomme une Maison.

### 4.11 Villes fausses ou perdues
- Brown Thomas (68) : `city` = « Brown Thomas » 39, « Arnotts » 12, « Head Office » 12, « Bt2 » 3 (la source écrit « Brown Thomas, Limerick » : l'enseigne d'abord, la ville ensuite). Levi's n° 30 : « Kittery Premium Outlets » (source « Kittery Premium Outlets, Kittery, ME, USA » → ville Kittery). `richemont` : 48 % sans ville (n° 54 : cxs `location: "LAS VEGAS"`, stocké `null`). Michael Page : « Paris-8e-Arrondissement » (35), « Marseille-16e-Arrondissement » — libellé INSEE brut, à afficher « Paris 8e ». Ferrari n° 57 : `location` « Englewood Cliffs, New, US » (« New Jersey » coupé).

## 5. Constats MINEURS

- **M1** `Job.source` ≠ ATS réel (D3) : kering 863 `GENERIC_JSONLD` sous une source `eightfold`, teamtailor 153, smartrecruiters 8 ; 17 lignes `FASHIONJOBS`/`LVMH_ALGOLIA` sous des sources directes (héritage de la fusion multi-sources). Ré-écriture avec B1.
- **M2** Offres très anciennes affichées actives : 3 434 avec `postedAt` > 1 an (1 234 > 2 ans) : ulta-jibe 1 375, luxe-talent 414, mango 251 ; extrêmes 2014 (miu-miu, mosaic, mvmt), Sacoor 2020 — la source les liste vraiment (SmartRecruiters `releasedDate: 2014-06-25`). Le site affiche « publiée il y a 12 ans » : masquer la date au-delà de 12 mois ou la remplacer par « re-listée le <lastSeenAt> ».
- **M3** Descriptions absentes à la source (stub) : Levi's 126 offres de 115 c. (« LOCATION FULL TIME/PART TIME Current LS&Co Employees… », le cxs n'en dit pas plus), Kastner & Öhler 78 c. (page rendue en JS : à passer par le navigateur), Hermès 604/638 courtes (déjà en investigation D35).
- **M4** Salaire : 95 % absent, conforme aux sources (Ulta et Boots publient `value: 0`). Rien à récupérer hors Michael Page (86 % rempli) et les fourchettes en prose US (Workday) — `extractSalaryBand` n'accepte que l'euro.
- **M5** `postalCode` publié mais non stocké : Jeans Centre « 4811 JE », Monica Vinader « NE1 7AS » (dans `location` seulement) ; Ulta, Pandora, Rituals, Globus ✓.
- **M6** Hors échantillon : Nordstrom n° 32 `timeType: Variable` (à mapper « horaires variables »), H&M n° 39 ✓ sauf marque, Rituals ✓ complet (modèle à suivre : ville, code postal, pays ISO, temps, date, langue).

## 6. Les 10 sources les plus déficientes (base entière)

| # | Source (actives) | Champs perdus / faux | Cause (fichier) |
|---|---|---|---|
| 1 | foot-locker-france (2 839) | lien = login 100 % ; marque fausse 100 % ; temps 100 % ; langue 98 % | `phenom.ts:70-82` ; `contract.ts:84` ; B1 |
| 2 | lvmh (5 655) | date 93 % ; langue 93 % ; lien = formulaire 46 % | B1 ; `lvmhAlgolia.ts:141` (pas de `language`, `link`) |
| 3 | tapestry (2 005) | langue fausse 84 % ; description traduite ; groupe 81 % + « Entraîneur » 65 ; temps 100 % ; `validThrough` | `workday.ts:173` + `http.ts:143` ; `:105-116` |
| 4 | l-oreal-professionnel (1 771, BROKEN 10:17) | date 100 % ; pays 100 % ; murs 95 % ; marque douteuse ; langue 96 % | `avature.ts:372-379,447` ; B1 |
| 5 | estee-lauder-companies (1 470) | pays 100 % ; contrat/temps ; 3 noms Estée Lauder | `eightfold.ts:39,102,116` |
| 6 | kering (1 043) | marque 100 % (901 déductibles) ; langue 98 % ; temps ; `Job.source` | B1 ; `contract.ts:85` |
| 7 | richemont + richemont-workday (1 768) | « Logo » 241 ; groupe 600 ; 208 doublons ; ville 48 % ; pays non-ISO 98 ; temps 100 % | B1 ; `workday.ts:128` ; dédup externalId |
| 8 | parfums-chanel (1 093) | date 98 % ; langue 98 % ; murs 108 | B1 |
| 9 | famille Workday (14 385) | temps 100 % ; remote ; entités juridiques comme Maison | `workday.ts:105-116,175-185` |
| 10 | famille SmartRecruiters (4 323) / generic JSON-LD (pandora 1 842, pvh 1 347, boots 1 401) | langue ignorée, contrat `permanent` perdu, marque `department` ; `FULL_TIME/PART_TIME` non reconnus ; boots pays 100 % | `smartrecruiters.ts:6,51` ; `contract.ts:84-85` ; `jsonLdSitemap.ts:214` |

## 7. JSON-LD JobPosting du site (`apps/web/lib/job-posting-schema.ts`)

| Propriété | Verdict | Preuve |
|---|---|---|
| `jobLocation.address.addressCountry` | **Pas de FR en dur** — clos | code `:57,82` (`countryCode(job.country)`, omis si inconnu) ; 50 pages : US, IT, FR, TW, MY, AU, ES, PT?, GB, CH, DE, NL, SA, AT, HU, CN, IN. Manquant sur 14 074 offres (§4.3) |
| `datePosted` | `postedAt ?? firstSeenAt` (`:52`) | 11 315 offres publient la date de notre premier passage (LVMH 4 186 alors que la source la donne) |
| `validThrough` | repli `datePosted + 60 j` (`:53-55`) | **21 157 pages actives avec une date passée** (B3) |
| `hiringOrganization.name` | = `Job.company` (`:68`) | « Entraîneur Netherlands B.V. - Taiwan Branch », « Richemont Logo », « MANGO MNG, S.A. », « Foot Locker France » sur des offres US |
| `employmentType` | mappé depuis contrat/temps (`:29-49`) | absent sur ~79 % des pages (conséquence de §4.2) ; ✓ n° 3, 4, 6, 23, 24, 34, 41, 44, 53, 56 |
| `directApply` | `false` (`:70`) | honnête (D18) ✓ |
| `identifier` | `{name: company, value: id}` | ✓ |
| `inLanguage` | = `Job.language` | absent sur 33 % ; `fr` sur Tapestry = la langue du texte affiché, pas celle publiée |
| `description` | texte complet | longueur site ≈ base (écart ≤ 1 %, blancs) ✓ ; entités brutes (§4.9) |
| `baseSalary` | seulement si stocké | n° 5 ✓ (32 000–36 000 EUR/YEAR) |

## 8. Les 50 offres (verdicts par champ)

Colonnes : Titre · Marque · Ville · Pays · Contrat · Temps · Salaire · Date · Description · Lien · Langue.

| n° | Source | id | T | M | V | P | C | Tps | $ | D | Desc | Lien | L | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ulta-jibe | cmtpkgtl84n6ipf5lkazyl59q | ✓ | ✓ | ✓ | ✓ | A | A | A | ✓ | ✓ | ✓ | ✓ | site `validThrough` 2026-08-08 (passé) |
| 2 | ulta-jibe | cmtpkexto4ejapf5lsg9k3tde | ✓ | ✓ | ✓ | ✓ | A | A | A | ✓ | ✓ | ✓ | ✓ | |
| 3 | lvmh | cmtk4a3jw1qg5ny2biqra16x3 | ✓ | ✓ | ✓ | ✓ | — | ✓ | A | P | ✓ | ✓ | P | Sephora Roma ; lien SF → fiche jobs.sephora.com |
| 4 | lvmh | cmtk48kc71eckny2b3jsy4z2i | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | A | P | ✓ | ✓ | P | |
| 5 | michael-page-france | cmtki4x2y1i0amn2blvw9esx7 | ✓ | ✓ | ✓ | ✓ | — | A | ✓ | ✓ | ✓ | ✓ | P | hors secteur |
| 6 | michael-page-france | cmtlvk6ms0d0j3nk5bckhobwl | ✓ | ✓ | ✓ | ✓ | ✓ | A | A | ✓ | ✓ | ✓ | P | ville « Paris-8e-Arrondissement » |
| 7 | foot-locker-france | cmtn8wqne2anzqq5llb6grogz | ✓ | **F** | A | ✓ | A | P | A | ✓ | ✓ | **F** | ✓ | login iCIMS ; marque « France » sur un poste US |
| 8 | foot-locker-france | cmtlv28yk041r3nk546w7vioc | ✓ | **F** | ✓ | ✓ | A | P | A | ✓ | ✓ | **F** | P | |
| 9 | kering | cmtm8z6vu1p15pv5jrl76wx75 | ✓ | ✓ | ✓ | ✓ | A | P | A | ✓ | A | ✓ | P | page kering.com : 157 c. à la source |
| 10 | kering | cmtluwuvh01xb3nk521c3xp70 | ✓ | ✓ | ✓ | ✓ | A | P | A | ✓ | ✓ | ✓ | P | `inLanguage en-US` publié |
| 11 | tapestry | cmtp6oz0a2winqq4zdlw3r8ph | ✓ | **F** | ✓ | ✓ | A | P | A | ✓ | **F** | ✓ | **F** | « Entraîneur » ; `endDate` 2026-09-30 perdu |
| 12 | tapestry | cmtp6p8wp3083qq4zfebsh48b | ✓ | **F** | ✓ | ✓ | A | P | A | ✓ | **F** | ✓ | **F** | |
| 13 | pandora-talenthub | cmtpkcgqk43y9pf5ld2xhrzkg | ✓ | ✓ | ✓ | ✓ | A | P | A | ✓ | ✓ | ✓ | ✓ | `["PART_TIME"]` non reconnu |
| 14 | pandora-talenthub | cmtpkcnq9457hpf5lqnid7ewf | ✓ | ✓ | ✓ | ✓ | A | P | A | ✓ | ✓ | ✓ | ✓ | |
| 15 | loreal (retirée) | cmtjw55bk03jgld2b6uyv5c78 | ✓ | ✓ | — | — | A | A | A | ✓ | P | ✓ | P | description NULL ; site 404 à 10:01 UTC |
| 16 | loreal (retirée) | cmtjw1v5a01g3ld2bs56960t4 | ✓ | ✓ | — | — | A | A | A | ✓ | P | ✓ | P | page site rendue sans texte |
| 17 | l-oreal-professionnel | cmtlv60td05lp3nk55iqc608r | ✓ | **F** | ✓ | A | A | A | A | P | **F** | ✓ | P | titre 兰蔻 = Lancôme ; 648 c., 0 retour |
| 18 | l-oreal-professionnel | cmtlv6pjr05yr3nk5gibnmnjw | ✓ | P | ✓ | A | A | A | A | P | **F** | ✓ | P | page : « SalonCentric » ; microdata structurée écartée |
| 19 | mango | cmtn89bnw2353qq5lagw6tmdz | ✓ | P | ✓ | ✓ | A | P | A | ✓ | ✓ | ✓ | ✓ | « MANGO MNG, S.A. » |
| 20 | mango | cmtn89f6a24nzqq5l8pzlcwrl | ✓ | P | ✓ | ✓ | A | P | A | ✓ | ✓ | ✓ | ✓ | publiée 2024-12-19 ; site `validThrough` 2025-02-17 |
| 21 | estee-lauder-companies | cmtnhcp6v21lbqq4z81s1c02r | ✓ | ✓ | ✓ | P | P | P | A | ✓ | ✓ | ✓ | ✓ | MAC ✓ ; ZA perdu ; Fulltime-Regular |
| 22 | estee-lauder-companies | cmtnhcrva22o6qq4zni4kcpm7 | ✓ | ✓ | ✓ | P | P | P | A | ✓ | ✓ | ✓ | ✓ | Le Labo ✓ ; PT perdu ; Fulltime-Temporary |
| 23 | boots | cmtpjxnbb2zwppf5lzr690kw3 | ✓ | ✓ | ✓ | A | A | ✓ | A | ✓ | ✓ | ✓ | ✓ | pays absent du JSON-LD (board GB) |
| 24 | boots | cmtpjxble2xx5pf5l8302maz6 | ✓ | ✓ | ✓ | A | A | ✓ | A | ✓ | ✓ | ✓ | ✓ | |
| 25 | pvh | cmtpjsvbc2q18pf5lz9zb88t6 | ✓ | A | ✓ | ✓ | A | P | A | ✓ | ✓ | ✓ | ✓ | `validThrough` ✓ ; source dit FULL_TIME sur un titre Part-Time |
| 26 | pvh | cmtpjt1b62ra1pf5l1voao0hm | ✓ | A | ✓ | ✓ | A | P | A | ✓ | ✓ | ✓ | ✓ | |
| 27 | richemont-workday | cmtp5287a2f3wqq4zv1mmr299 | ✓ | P | ✓ | ✓ | A | P | A | ✓ | ✓ | ✓ | ✓ | « Richemont » ; boutique CAR = Cartier ; remote perdu |
| 28 | richemont-workday | cmtp529xn2fujqq4zrkhawpic | ✓ | ✓ | ✓ | ✓ | A | P | A | ✓ | ✓ | ✓ | ✓ | Montblanc ✓ |
| 29 | levis | cmtn7s8zq1uhuqq5lkmdv2ky0 | ✓ | ✓ | ✓ | ✓ | A | P | A | ✓ | A | ✓ | A | stub 85 c. à la source |
| 30 | levis | cmtn7s8ey1ua6qq5l6z13r3oz | ✓ | ✓ | **F** | ✓ | A | P | A | ✓ | A | ✓ | A | ville = nom du centre commercial |
| 41 | tropicfeel | cmtlyeu99004gqf5k1yp72wav | ✓ | ✓ | ✓ | ✓ | ✓ | P | A | ✓ | ✓ | ✓ | ✓ | |
| 42 | rolex | cmtpj0w300xpbpf5lo5ma2xnq | ✓ | ✓ | ✓ | ✓ | — | — | A | ✓ | **F** | ✓ | ✓ | mur sans paragraphes (205/208) |
| 43 | tods | cmtp1x2xn035nqq4znd5jkh9h | ✓ | ✓ | ✓ | ✓ | — | — | A | ✓ | ✓ | **F** | ✓ | URL `&amp;apos;` (200) ; `validThrough` ✓ |
| 44 | primark | cmtn76iyg1jbvqq5l5c7hdqhg | ✓ | ✓ | ✓ | ✓ | A | ✓ | A | ✓ | ✓ | ✓ | ✓ | modèle SmartRecruiters ✓ |
| 45 | brown-thomas-taleo | cmtpixeat0fjkpf5lu6mstey7 | ✓ | ✓ | **F** | A | ✓ | P | A | P | ✓ | ✓ | ✓ | ville « Brown Thomas » ; date Taleo non parsée |
| 46 | monica-vinader | cmtlyk23b09teqf5ksxk0n7az | ✓ | ✓ | ✓ | ✓ | A | P | A | ✓ | ✓ | ✓ | ✓ | |
| 47 | kastner-ohler | cmtlyf6zt00f6qf5kl40inqyh | ✓ | ✓ | ✓ | ✓ | A | P | A | ✓ | A | ✓ | ✓ | 78 c. (JSON-LD) ; « Teilzeit » non reconnu |
| 48 | herschel-supply-co | cmtlyg34t01h4qf5kdh75zbah | ✓ | ✓ | ✓ | A | A | P | A | ✓ | ✓ | ✓ | ✓ | CA déductible ; « Part-Time » dans le titre |
| 49 | multiopticas | cmtlynlzg0iipqf5kyqb3yopm | ✓ | ✓ | ✓ | ✓ | A | P | A | ✓ | ✓ | ✓ | ✓ | |
| 50 | globus | cmtpivfd90617pf5lzwmc5n09 | ✓ | ✓ | ✓ | ✓ | A | P | A | ✓ | ✓ | ✓ | ✓ | `validThrough` ✓ ; PART_TIME (40-50 %) perdu |
| 51 | sacoor-brothers | cmtlyett60046qf5kcnej7jp0 | ✓ | ✓ | ✓ | ✓ | P | ✓ | A | ✓ | ✓ | ✓ | ✓ | publiée 2020-01-13 à la source |
| 52 | jeans-centre | cmtlym3rf0dtpqf5kp8oojvdo | ✓ | ✓ | ✓ | ✓ | A | P | A | ✓ | ✓ | ✓ | ✓ | code postal non stocké |
| 53 | dr-pierre-ricaud | cmtmo6p6406ulso5lhvnv5ae8 | ✓ | **F** | ✓ | ✓ | ✓ | A | A | ✓ | ✓ | ✓ | ✓ | offre Groupe Rocher attribuée à Dr Pierre Ricaud |
| 54 | richemont | cmtm7vlnq14a9pv5jpmw99ejc | ✓ | **F** | P | P | A | P | A | ✓ | ✓ | ✓ | ✓ | « Richemont Logo » ; pays « États-Unis d'Amérique » ; boutique CHL = Chloé |
| 55 | brunello-cucinelli | cmtp22d1t0a9eqq4z4hw1oejw | ✓ | P | ✓ | ✓ | A | P | A | ✓ | ✓ | ✓ | ✓ | « BRUNELLO CUCINELLI SUISSE SA » |
| 56 | damart | cmtlyf5ab00daqf5kahknyl9w | ✓ | ✓ | ✓ | ✓ | ✓ | P | A | ✓ | ✓ | ✓ | ✓ | |
| 57 | ferrari | cmtlyg2le01euqf5k3eijy2l4 | ✓ | ✓ | ✓ | ✓ | — | — | A | ✓ | ✓ | ✓ | ✓ | `location` « …, New, US » |
| 58 | mosaic | cmtlyfa7n00hkqf5k5s7w8whs | ✓ | ✓ | ✓ | ✓ | P | ✓ | A | ✓ | ✓ | ✓ | ✓ | ONG, publiée 2014 — hors secteur |
| 59 | silbon | cmtlynbai0gsbqf5k4sn3d516 | ✓ | ✓ | ✓ | ✓ | A | P | A | ✓ | ✓ | ✓ | ✓ | |
| 60 | make | cmtlyhsqb03x4qf5kjz805lis | ✓ | ✓ | ✓ | P | A | A | A | ✓ | ✓ | — | ✓ | make.com — hors secteur ; « Madrid, Spain » sans pays ; 403 robot |

## 9. Ordre de correction proposé

1. **B1** (auto-guérison complète) — sans elle, toute autre correction ne touche que les nouvelles lignes.
2. **B3** (`validThrough` depuis `lastSeenAt`) — une ligne de code, 21 157 pages redeviennent éligibles.
3. **B2** Foot Locker (`/login` → `/job`, marque) et **B4** LVMH (fiche plutôt que formulaire).
4. §4.2 (`FULL_TIME`/`PART_TIME`, Workday `timeType`) + §4.3 (Eightfold chaînes) + §4.1 (Workday `en-US`) — trois correctifs d'une dizaine de lignes, 20 000+ offres.
5. §4.4 marques (Kering, Richemont, Tapestry, H&M, suffixes juridiques), §4.10 SmartRecruiters, §4.9 entités, §4.8 murs.
6. §4.7 périmètre (Michael Page, mosaic, make, stone-by-stone, miu-miu) — décision Loïc (retrait de sources).

## 10. Fichiers de preuve

- Échantillon : `a4-sample.sql` → `a4-sample.json` (60 lignes, 09:56 UTC ; 50 retenues + 10 hors échantillon).
- Pages : `a4-pages/NN-<source>.{site,source}.html` + API détail `.json`, `summary.json` ; digest par offre : `a4-digest.txt` (`a4-digest.py`).
- SQL : `a4-cov.sql`, `a4-landscape.sql`, `a4-facts.sql` … `a4-facts9.sql` et leurs `.out`.
- Rejeux locaux : `a4-sfparse.mts` (adidas), `a4-loreal-desc.mts` (microdata L'Oréal), `a4-contract.mts` (normaliseurs), `a4-country.mts` (pays).
- Réseau ciblé : `a4-phenom.mts` (2 offres), `a4-net1.mts` (URL `&amp;`, titre entité sur le site, recherche Kering), `a4-net2.mts` (détail Gucci, page Phenom), `a4-net3.mts` (liens LVMH Lumesse/Oracle, URL Phenom).
