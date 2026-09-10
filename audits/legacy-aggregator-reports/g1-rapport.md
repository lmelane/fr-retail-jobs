# g1 — Rapport : 6 portails « GENERIC » résolus (mesures du 2026-09-06)

Lecture seule. Aucune écriture en base, aucun commit. Scripts : `src/discovery/g1-*.mts`.
Chaque chiffre ci-dessous vient d'une exécution (`npx tsx src/discovery/g1-validate.mts <nom>` ou `g1-acne.mts <acne|zegna>`).

| # | Portail | Verdict | Mesure |
|---|---|---|---|
| 1 | LuxExperience (YNAP + Mytheresa) | **RÉSOLU** (GENERIC_JSONLD paginé) | 50 offres · 50 lieu · 50 desc · 6 s |
| 2 | Mytheresa | **RÉSOLU** (GENERIC_JSONLD paginé) — sous-ensemble strict du n° 1 | 22 offres · 22 lieu · 22 desc · 3 s |
| 3 | Ermenegildo Zegna Group | **API TROUVÉE, adaptateur écrit** (`altamira.ts`) | 60 offres · 60 lieu · 60 desc · 17 s |
| 4 | Audemars Piguet | **RÉSOLU** (SMARTRECRUITERS) | 86 offres · 86 lieu · 86 desc · 7 s |
| 5 | Acne Studios | **API TROUVÉE, adaptateur écrit** (`jobylon.ts`) | 27 offres · 27 lieu · 27 desc · 3 s |
| 6 | Swatch Group | **RÉSOLU** (GENERIC_JSONLD paginé) | 279 offres · 272 lieu · 274 desc · 45 s |

Total : **6 → 524 offres lues** là où le générique en lisait 40.

---

## 1. LuxExperience / YNAP — RÉSOLU

`career.luxexperience.com` et `career.mytheresa.com` sont **le même site TYPO3** (thème `MytheresaKarriere`, même bundle) : LuxExperience est l'entité fusionnée Mytheresa + NET-A-PORTER + MR PORTER + YOOX. Le listing annonce « 50 Jobs found », pagination `?page=N` **1-based** (`?page=0` rend une liste vide, `?page=7` re-rend la dernière page — le générique s'arrête à la première page sans lien nouveau). Chaque fiche porte un JSON-LD `JobPosting` complet (titre, `datePosted`, `addressLocality`, `addressCountry`, `identifier` = numéro Workday `R-xxxxx`).

```json
{ "type": "GENERIC_JSONLD",
  "config": { "listingUrl": "https://career.luxexperience.com/open-positions",
              "linkPattern": "/open-positions/job-detail/",
              "pageParam": "page", "pageStart": 1, "maxPages": 40 } }
```
Mesure : `50 offres | 50 lieu | 50 desc | 6s` — ex. « Assistant Buyer @ Aschheim ».

**Attribution par marque, à décider** : `hiringOrganization` vaut « LuxExperience » sur les 50. La marque n'est lisible que dans le slug de l'URL (`-mytheresa-r-`, `-net-a-porter-r-`, `-mr-porter-r-`/`-mrporter-`, `-yoox-r-`). Comptage sur les 50 : Mytheresa 25 · NET-A-PORTER 9 · MR PORTER 4 · YOOX 2 · sans marque (siège groupe) 10. Le générique ne sait pas lire le slug ; sans règle, les 50 tomberont sous « LuxExperience ».

## 2. Mytheresa — RÉSOLU, mais DOUBLON du n° 1

Même mécanique, listing « 22 Jobs found », 3 pages.
```json
{ "type": "GENERIC_JSONLD",
  "config": { "listingUrl": "https://career.mytheresa.com/en/open-positions",
              "linkPattern": "/open-positions/job-detail/",
              "pageParam": "page", "pageStart": 1, "maxPages": 40 } }
```
Mesure : `22 offres | 22 lieu | 22 desc | 3s` — ex. « Assistant Buyer @ Aschheim ».

⚠️ Les 22 identifiants `R-xxxxx` sont **inclus** dans les 50 de LuxExperience (même fiche, deux URLs : `…/assistant-buyer-mytheresa-r-17353` sur les deux hôtes). Activer les deux = chaque poste Mytheresa affiché deux fois (le cas D34 ELC/Dr. Jart). Recommandation : **une seule source, LuxExperience**, avec attribution de marque par slug — ou Mytheresa seule si on renonce aux 28 offres NAP/MRP/YOOX/groupe. Décision Loïc.

## 3. Ermenegildo Zegna Group — API TROUVÉE, adaptateur écrit (Altamira)

Aucun ATS connu derrière : le portail est **Altamira Recruiting** (ATS italien, WebForms ASP.NET, traceur `Altamira.Statistics?m=rJob&id=…`). Pas d'API JSON, pas de JSON-LD sur les fiches (0 `ld+json`), donc le générique ne pouvait rien rendre au-delà des 9 liens de la page 1. Le `sitemap.xml` (66 URLs `/jobs/<slug>-<id>.htm`) est **périmé : 404 sur chaque URL testée**.

- Liste : `GET https://careers.zegnagroup.com/default?ctl294=N&FreeSearch=&RunDefaultAction=true&StartupViewID=TableView&PagerAnnunci=N`, N à partir de **1**, 10 lignes par page ; **au-delà de la fin, la dernière page est rendue en boucle** (page 7 = page 6) → arrêt à la première page sans `JobID` nouveau. Mesuré : 6 pages, 60 identifiants uniques.
- Ligne : `<a href="/jobs/job-details?JobID={id}&Team={team}">` → titre dans `tableJobs__cellText--bold` (le premier bold est le logo, vide), lieu « Ville , Pays » dans `tableJobs__cellText`.
- Détail : `GET /jobs/job-details?JobID={id}&Team={team}`, champs dans des `<td data-title="…">` : `Title`, `Locations` (« United States/NY/New York »), `Brand` (la maison), `Contract type`, `JOB FUNCTION`, `Text` (description HTML). **Pas de date de publication.**
- Adaptateur : `src/ats/adapters/altamira.ts` (`fetchAltamiraJobs({ origin })`), test `altamira.test.ts` (6 tests, fixtures capturées). Non branché au dispatch.

Mesure (`g1-acne.mts zegna`) : `60 offres | 60 lieu | 60 desc | 17s` — ex. « Corporate Visual Merchandiser @ Milano, Italy ». Pays : Italie 28, États-Unis 12, Arabie saoudite 5, UK 3, Suisse 3… `Brand` = **Zegna sur les 60** : ni Thom Browne ni TOM FORD Fashion n'y publient — leurs offres ne sont pas sur ce portail (Thom Browne a son propre site carrière, non vérifié ici).

Config : `{ "type": "ALTAMIRA", "config": { "origin": "https://careers.zegnagroup.com" } }`

## 4. Audemars Piguet — RÉSOLU (SmartRecruiters)

Le site AEM `careers.audemarspiguet.com` est un habillage : Playwright montre qu'il appelle lui-même `https://api.smartrecruiters.com/v1/companies/audemarspiguet/postings?limit=100&offset=0` (`totalFound: 86`, et la page affiche « 86 de 86 postes ouverts »). Le générique lisait 0 parce que la liste est rendue côté client.

```json
{ "type": "SMARTRECRUITERS", "config": { "company": "AudemarsPiguet" } }
```
Mesure : `86 offres | 86 lieu | 86 desc | 7s` — ex. « Application Security Expert @ Route de France 16, VD, ch ». Le générique n'est plus nécessaire ; l'URL publique produite est `jobs.smartrecruiters.com/AudemarsPiguet/<id>` (candidature directe).

## 5. Acne Studios — API TROUVÉE, adaptateur écrit (Jobylon)

Le `feed` proposé par le détecteur (`/feed/`) est le flux RSS WordPress du site vitrine : 0 offre, normal. La page « Open positions » ne contient **aucun lien d'offre** : un `<div id="jobylon-jobs-widget">` + `cdn.jobylon.com/embedder.js` avec `jbl_company_id = 2631`. Le widget charge :

- `GET https://cdn.jobylon.com/jobs/companies/2631/embed/v2/?target=jobylon-jobs-widget&page_size=100` → HTML (151 Ko) qui embarque **toutes les offres dans un littéral JavaScript** `JBL.embed_v2['jobs'] = [ { id: '379770', url: '/jobs/379770-…/', title: '…', company: 'Acne Studios', layers: { 'layers_1': ['Japan'] … } } ]` — pas du JSON (clés nues, apostrophes, `'`). `page_size` ne change rien (27 offres avec 10 comme avec 100) : pagination côté client. `layer_headers[1] = 'Countries'`. Cloudflare est présent (challenge JS) mais **sert le HTML à `fetchText` sans blocage**.
- Fiche publique : `https://emp.jobylon.com{url}` → JSON-LD `JobPosting` complet (`datePosted`, description, `jobLocation.address.streetAddress` = « Tokyo, Japan » avec `addressLocality` **vide** — le normaliseur partagé ne lisait donc aucun lieu ; l'adaptateur relit `streetAddress`).
- Pas de feed JSON/XML public trouvé (`feed.jobylon.com/feeds/…` exige un jeton client ; `/api/…`, `/companies/2631/…/feed` → 404).
- Adaptateur : `src/ats/adapters/jobylon.ts` (`fetchJobylonJobs({ companyId })`), test `jobylon.test.ts` (6 tests). Non branché au dispatch. Réutilisable pour tout site portant `jbl_company_id`.

Mesure (`g1-acne.mts acne`) : `27 offres | 27 lieu | 27 desc | 3s | declaredTotal=27` — ex. « Supply Chain Planner (Japan) @ Tokyo, Japan », 27 dates, 12 pays.

Config : `{ "type": "JOBYLON", "config": { "companyId": "2631" } }`

## 6. Swatch Group — RÉSOLU (générique paginé)

Site Drupal derrière Akamai. **curl échoue** (HTTP/2 `INTERNAL_ERROR`, HTTP/1.1 : 0 octet en 40 s), mais Playwright ET le transport du pipeline (`fetchText`, ~500 ms/page) passent — donc pas de bot-wall pour nous. Pagination `?page=N` **0-based**, pager « dernier » = 27 → 28 pages × 10. Liens `/{fr|en|de|it}/job/{id}` (chaque offre dans sa langue de publication), fiches avec JSON-LD `JobPosting`.

```json
{ "type": "GENERIC_JSONLD",
  "config": { "listingUrl": "https://www.swatchgroup.com/fr/job-finder",
              "linkPattern": "/job/", "pageParam": "page", "pageStart": 0, "maxPages": 60 } }
```
Mesure : `279 offres | 272 lieu | 274 desc | 45s` — ex. « Swatch Assistant Store Manager - Green Hills (Nashville) @ 37215 Nashville TN ». 7 offres sans lieu et 5 sans description > 200 c. dans le JSON-LD source (non investigué offre par offre). Les marques (Omega, Longines, Tissot…) sont dans le titre/`hiringOrganization` de chaque fiche : attribution par offre à vérifier à l'ingest.

---

## Fichiers produits (tous nouveaux, rien d'existant modifié)

- `src/ats/adapters/altamira.ts` + `altamira.test.ts` — Zegna (6 tests verts)
- `src/ats/adapters/jobylon.ts` + `jobylon.test.ts` — Acne (6 tests verts)
- `src/discovery/g1-validate.mts` — Lux / Mytheresa / AP / Swatch via `fetchAtsJobs`
- `src/discovery/g1-acne.mts` — rejoue `jobylon` (`acne`) et `altamira` (`zegna`)
- `src/discovery/g1-sniff.mts` — capture réseau Playwright (Swatch, Acne, Zegna, AP)
- `src/discovery/g1-swatch.mts` — preuve que `fetchText` passe là où curl échoue

---

## Approfondissement (2026-09-06, demande Loïc)

### A. Zegna / Altamira — la date de publication N'EXISTE NULLE PART sur le portail

Toutes les pistes ont été exécutées (scripts : curl + `g1-*`), aucune ne porte une date d'offre :

| Piste | Résultat mesuré |
|---|---|
| (1) Fiche détail complète `/jobs/job-details?JobID=272432342&Team=…` (82 Ko) | 9 cellules `data-title` : Title ×2, Company Logo, Locations, Brand, Contract type, JOB FUNCTION, CompanyID, Text — **aucune date**. Aucun `<time>`, aucun `<meta>` date/published/modified. Seule chaîne datée du HTML : `…/uploads/2021/11/11.-Code-of-Ethics.pdf` (menu). 4 hidden inputs (`VMxxCurrentViewID`) sans valeur métier. Le traceur `Altamira.Statistics?m=rJob&id=…` répond vide. Version ITA et ENG : mêmes 9 cellules. |
| (1bis) En-têtes HTTP | `Cache-Control: private`, `Date` du jour ; **pas de `Last-Modified`, pas d'`ETag`**. |
| (2) Liste WebForms | En-têtes de colonnes : **Brand · Title · LOCATION · JOB FUNCTION** — pas de colonne date. Aucun `<select>`, aucun lien Sort/Order/Ordina ; inputs : `FreeSearch`, `companyid`, `AltamiraWebUIButton`. L'ordre par défaut n'est même pas strictement par `JobID` décroissant (7 inversions sur 60), donc pas de proxy de récence fiable. |
| (3) Flux | `/rss`, `/feed`, `/rss.xml`, `/jobs.xml`, `/feed.xml`, `/jobs/rss(.xml)`, `/jobs/feed`, `/Altamira.Rss`, `/jobs/rss.aspx` → 404 ; `/jobs/feed.xml` → **500** ; `StartupViewID=RSSView` → rend le HTML normal. `sitemap.xml` (= `/jobs/sitemap.xml`) : 66 URLs `/jobs/<slug>-<id>.htm` avec `<lastmod>` de 2020 à 2025, **0 identifiant commun** avec les 60 offres vivantes, chaque URL testée → 404 : c'est le sitemap d'une ancienne version du portail. |
| (4) `https://careers.zegnagroup.com/?cngLanguage=ENG` | Le portail sert déjà l'anglais par défaut (`<html lang="en">`) : mêmes 60 `JobID`, même pager (6 pages), mêmes 9 cellules sur la fiche. Rien de plus. Langues offertes : ENG, ITA, CHN, JAP, KOR. |

Conclusion : **la date n'est pas publiée par Altamira sur ce tenant** ; l'adaptateur `altamira.ts` reste sans `postedAt`, ce qui est exact. Le pipeline datera l'offre à son `firstSeenAt` (première ingestion), comme pour toute source sans date. À noter : le bouton « Apply » renvoie vers `/careerarea/…`, chemin **interdit par robots.txt** (`Disallow: /careerarea`) — on ne le suit pas ; l'URL publique reste la fiche `job-details`.

### B. Swatch Group — le JSON-LD est INCOMPLET, le HTML porte tout

#### B1. Les 7 offres « sans lieu » : lieu présent dans le HTML, absent du JSON-LD

| URL | Titre | JSON-LD `jobLocation.address` | Bloc HTML `#jl` (« Job location ») |
|---|---|---|---|
| /en/job/33040 | Client Advisor | region `""`, street = « The Swatch Group (Nordic) AB P.O. Box 12033 112 34 Stockholm » | Østergade 61 · 1100 Copenhagen (Capital Region of Denmark) · Denmark |
| /en/job/32916 | Swatch Part Time Keyholder - SouthPark (NC) | region `""`, street = « The Swatch Group (U.S.) Inc. 800 Waterford Way Suite 1000 Miami, FL 33126 » | 4400 Sharon Road (Room G06) · NC 28211 Charlotte (North Carolina) · United States |
| /en/job/32719 | Swatch Full Time Keyholder - Cherry Creek (Denver, CO) | idem Miami | (Denver, même gabarit) |
| /en/job/32682 | Swatch Full Time Keyholder - SouthPark (NC) | idem Miami | (Charlotte) |
| /en/job/32647 | Sales Lead (Halifax Shopping Centre) | region `""`, street = « The Swatch Group (Canada) Ltd. 555 Richmond Street West Suite 1105 CA-Toronto » | Mumford Road 7001 · B3L 4X6 Halifax (Nova Scotia) · Canada |
| /en/job/32587 | Omega Luxury Timepieces - Keyholder/Technician - Boston | idem Miami | (Boston) |
| /en/job/32452 | Swatch Part Time Keyholder - Cherry Creek (Denver) | idem Miami | (Denver) |

Mécanique exacte (lue sur le HTML brut) : le site Drupal génère le JSON-LD avec **`addressRegion` = « code postal + ville » du lieu de travail** (ex. `"37215 Nashville TN"`, `"60313 Frankfurt"`) et **`streetAddress` = l'adresse du SIÈGE de la filiale** (`f-n-field-job-ca`, « Company address »), sans `addressLocality` ni `addressCountry`. Quand `addressRegion` est vide (7 cas), le normaliseur n'a plus rien — et lire `streetAddress` donnerait le **mauvais** lieu (Miami pour un poste à Charlotte, Stockholm pour Copenhague). Le vrai lieu de travail est dans le HTML, dans le bloc :
```html
<aside class="job-card"> … <div id="jl" class="mb-4"><p class="blue-bold mb-0">Job location</p> 4400 Sharon Road (Room G06)<br /> NC 28211 Charlotte (North Carolina)<br /> United States </div>
```
(étiquette localisée : « Job location » / « Arbeitsort » / « Lieu de travail » ; 3 lignes : rue · code postal + ville (région) · pays). Le pays n'est **jamais** dans le JSON-LD : les 272 « avec lieu » n'ont que « CP ville », le pays vient du HTML seul. → **Lecture de repli à ajouter au générique** (ou un adaptateur Swatch) : `#jl` → lignes 2 et 3 = ville/CP + pays, prioritaire sur `streetAddress`.

#### B2. Les 5 offres « sans description > 200 » : le JSON-LD ne porte qu'UNE section sur cinq

Le JSON-LD `description` = uniquement le champ Drupal `f-n-body` (section « Job description / Stellenbeschreibung »). La page a quatre autres sections, hors JSON-LD : `f-n-field-job-company-intro` (l'entreprise), `f-n-field-job-profile` (missions), `f-n-field-job-prof-requ` (profil requis), `f-n-field-job-languages` (langues + « ce que nous offrons »). Sur les 5 offres courtes, le rédacteur a mis une phrase d'accroche dans `body` et tout le contenu ailleurs :

| URL | Titre | `body` (JSON-LD) | HTML hors JSON-LD |
|---|---|---|---|
| /de/job/33044 | Verkaufsberater Tissot Concession Düsseldorf & Köln | 199 c. | intro 471 + profile 958 + prof-requ 525 + languages 1 546 c. |
| /de/job/32981 | E-Com Manager Longines | 129 c. | (même gabarit) |
| /fr/job/32653 | Apprentissage opérateur·rice en horlogerie AFP (Omega, Bienne) | 199 c. | (même gabarit) |
| /de/job/32628 | Marketing Manager Tissot | 152 c. | (même gabarit) |
| /de/job/32334 | Boutique Manager Hour Passion Metzingen | 130 c. | (même gabarit) |

Sur les 279, longueur de la description JSON-LD : ≤200 = 5 · 201-500 = 43 · 501-1000 = 130 · 1001-3000 = 97 · >3000 = 4 — donc 48 offres (17 %) ont moins de 500 caractères alors que la page en porte 2 000 à 4 000. Champs d'adresse remplis (JSON-LD) : `[region + street]` = 272, `[street seul]` = 7, `addressLocality` et `addressCountry` = **0 sur 279**.

Et ce n'est pas propre à ces 5 : sur 33040 (Client Advisor Omega Copenhague), le JSON-LD a le `body` complet mais **perd** intro (427 c.), profile (247 c.) et langues (169 c.). → Repli à ajouter : concaténer `f-n-body` + `f-n-field-job-company-intro` + `f-n-field-job-profile` + `f-n-field-job-prof-requ` + `f-n-field-job-languages` (dans cet ordre, c'est l'ordre de la page). Les 5 offres ne sont **pas** incomplètes à la source.

#### B3. Attribution par marque : `hiringOrganization.name` = l'entité LÉGALE, jamais la marque seule

Distribution sur les 279 (41 valeurs) : ETA SA Manufacture Horlogère Suisse 44 · The Swatch Group (U.S.) Inc. 41 · The Swatch Group (France) S.A.S. 20 · The Swatch Group (Italia) S.p.A. 19 · The Swatch Group (Australia) PTY. LTD. 16 · The Swatch Group (Canada) Ltd. 15 · **Omega Ltd. 12** · The Swatch Group (Deutschland) GmbH 8 · The Swatch Group (Netherlands) B.V. 8 · **Longines Watch Co. Francillon Ltd. 7** · The Swatch Group Trading (Thailand) Limited 6 · Nivarox-FAR S.A. 6 · ST Sportservice GmbH 5 · **Swatch Ltd 5** · The Swatch Group (España) S.A. 5 · Renata AG 5 · EM Microelectronic-Marin Ltd 5 · Universo S.A. 4 · Meco SA 4 · The Swatch Group (UK) Limited 3 · Comadur SA 3 · **Rado Watch Co. Ltd. 3** · The Swatch Group Les Boutiques Ltd 3 · **Blancpain Ltd 3** · Rubattel et Weyermann S.A. 3 · The Swatch Group Services Ltd 3 · The Swatch Group (Malaysia) SDN BHD 2 · **Tissot Ltd 2** · The Swatch Group (Österreich) GmbH 2 · **Glashütter Uhrenbetrieb GmbH 2** · **Montres Breguet Ltd 2** · ICB Ingénieurs Conseils en Brevets SA 2 · The Swatch Group Ltd 2 · Hour Passion S.A.S. 2 · The Swatch Group (Nordic) AB 1 · Lascor S.p.A. 1 · Swiss Timing LTD 1 · The Swatch Group (Hong Kong) Limited 1 · Micro Crystal Ltd 1 · MOM Le Prélet S.A. 1 · CPK Swatch Group 1.

Lecture : seules **~36 offres (13 %)** portent une marque candidat dans l'organisation (Omega, Longines, Swatch, Rado, Blancpain, Tissot, Glashütte, Breguet). Les 165 offres des filiales pays « The Swatch Group (X) » sont des postes retail/office **de marque** (« Swatch Part Time Keyholder », « Omega Luxury Timepieces … Boston », « Tissot Concession Düsseldorf », « E-Com Manager Longines ») : la marque est dans le **titre** et dans le **logo** (`hiringOrganization.logo` = `/sites/default/files/brands-logos/tissot.png` sur 33044, même quand le nom est « The Swatch Group (Deutschland) GmbH »). Les 44 d'ETA + Nivarox, Comadur, Universo, Meco, Renata, EM Micro, Rubattel… sont les manufactures de composants (Suisse) — pas une marque candidat, mais des postes horlogers réels. Marque citée dans le TITRE (mesuré sur les 279, casse confondue) : Swatch 41 · Omega 26 · Hour Passion 7 · Tissot 7 · Longines 6 · Blancpain 4 · Breguet 4 · Certina 1 · Rado 1 · Glashütte 1 · **aucune marque dans le titre : 181** (manufactures ETA/Nivarox/Comadur…, fonctions groupe, filiales pays).

Règle d'attribution proposée (décision Loïc) : marque = `hiringOrganization.logo` (nom de fichier `brands-logos/<marque>.png`) si présent, sinon marque citée dans le titre, sinon l'entité légale telle quelle. Sans règle, le catalogue affichera 41 « sociétés » dont 15 « The Swatch Group (pays) ».

---

## Adaptateur dédié Swatch Group (2026-09-06)

Fichiers : `src/ats/adapters/swatchgroup.ts` (`fetchSwatchGroupJobs({ origin?, lang? })`), `swatchgroup.test.ts` (12 tests, verts), fixtures capturées `src/ats/adapters/__fixtures__/swatchgroup-{32916,33044,33046}.html` (fiche « sans lieu », fiche « sans description », fiche normale — head/nav/footer retirés, contenu inchangé), mesure `src/discovery/g1-swatch-adapter.mts`. Ni dispatch ni schéma touchés ; `tsc --noEmit` propre sur ces fichiers.

**Mesure (`npx tsx src/discovery/g1-swatch-adapter.mts`)** :
`swatch-group (adaptateur): 279 offres | 279 lieu | 279 desc | 27s | declaredTotal=279` — ex. « Swatch Assistant Store Manager - Green Hills (Nashville) @ 37215 Nashville TN, United States [Nashville / US] | Swatch ». Contre le générique : 272 → **279 lieu**, 274 → **279 desc > 200** (aucune ≤ 200), 0 → **273 pays**, 279 dates, 274 URLs de candidature Lumesse TalentLink dans `raw.applyUrl`.

Ce qu'il fait, et pourquoi (chaque point mesuré dans l'approfondissement B) :
1. **Liste** : `/{lang}/job-finder?page=N` (0-based), liens `/xx/job/{id}` — chaque carte porte le lien **3 fois** (image, titre, « En savoir plus ») : dédoublonnage dans la page puis entre pages ; arrêt à la première page sans lien nouveau (le pager rend la dernière page en boucle). Piège rencontré : sans dédoublonnage intra-page, 837 « offres » = 3 × 279.
2. **Lieu** : bloc `#jl` (« Job location / Arbeitsort / Lieu de travail / Luogo di lavoro »), ligne 2 « CP ville (région) » + ligne 3 pays ; `streetAddress` **jamais lu** (siège de la filiale). Pays en ISO-2 par table de ~90 libellés en/fr/de/it, sinon libellé tel quel. Repli si `#jl` absent : `addressRegion` du JSON-LD (qui est bien le lieu de travail). **Deuxième gabarit découvert** : 6 fiches sur 279 (32973, 32815, 32797 Sydney · 32964 Venezia · 32734, 32735 La Chaux-de-Fonds) ont un `#jl` à une ligne `<div class="field f-n-field-job-work-address">2000 Sydney</div>`, sans pays → lieu/ville/CP gardés, **pays absent** (2 %), volontairement non déduit de l'adresse de la filiale.
3. **Description** : concaténation dans l'ordre de la page de `f-n-field-job-company-intro` → `f-n-body` → `f-n-field-job-profile` → `f-n-field-job-prof-requ` → `f-n-field-job-languages`, via `htmlToPlainText` (les `<h2>` de section sortent sur leur ligne). Exclus : `f-n-field-job-contact` (personne de contact) et `f-n-field-job-ca` (adresse du siège).
4. **Titre** : `<h1><span class="field f-n-title">` (le JSON-LD double-échappe les entités : « &amp;amp; ») ; **identifiant** = numéro de l'URL ; **date** = `datePosted` du JSON-LD (279/279) ; `language` = préfixe de langue de l'URL ; `group` = « Swatch Group » ; entité légale conservée dans `raw.legalEntity`.
5. **Marque** (`company`) : logo `brands-logos/<fichier>.png` → table documentée dans le fichier (25 fichiers observés, effectifs inclus) ; `swatch-group.png` (45 fiches) est le logo générique du groupe, donc pas une marque → on passe au **titre** (17 motifs, Harry Winston/Glashütte Original avant les mots courts) → sinon « Swatch Group ».

**Distribution des marques sur les 279** : Swatch 68 · ETA 44 · Omega 40 · **Swatch Group 27** · Longines 16 · Tissot 10 · Blancpain 10 · Hour Passion 9 · Swiss Timing 6 · Nivarox 6 · Rado 5 · Renata 5 · EM Microelectronic 5 · Universo 4 · Breguet 4 · Meco 4 · Comadur 3 · Glashütte Original 3 · Rubattel et Weyermann 3 · Certina 1 · Lascor 1 · Micro Crystal 1 · MOM Le Prélet 1 · Hamilton 1 · CPK Swatch Group 1 · Flik Flak 1.
Les 27 « Swatch Group » restants sont des postes de filiale sans marque ni dans le logo ni dans le titre (« IT Help Desk Support », « Watchmaker », « Warehouse Associate », « Sales Coordinator ») : c'est exact, pas un défaut de lecture. Pays : CH 118 · US 41 · FR 22 · IT 19 · DE 15 · CA 15 · AU 13 · NL 8 · TH 7 · ES 6 · GB 3 · MY 2 · AT 2 · DK 1 · HK 1 · absent 6.

Config proposée une fois le type branché : `{ "type": "SWATCHGROUP", "config": { "origin": "https://www.swatchgroup.com", "lang": "fr" } }`. Note : l'ATS réel derrière le site est **Lumesse TalentLink** (`apply5.lumessetalentlink.com/apply-app/pages/application-form?jobId=…`) — les fiches Drupal sont la surface publique complète, on n'a pas besoin de l'atteindre.

## Points à trancher (Loïc)

1. LuxExperience vs Mytheresa : une seule des deux (sinon 22 doublons), et règle d'attribution de marque par slug.
2. Brancher `ALTAMIRA` et `JOBYLON` au dispatch (`src/ats/index.ts`, `KIND_TO_ATS`, enum Prisma `AtsType`) — hors périmètre du brief.
3. Zegna : Thom Browne et TOM FORD Fashion ne sont pas sur ce portail (0/60) ; à chercher séparément.
