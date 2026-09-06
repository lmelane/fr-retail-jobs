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

## Points à trancher (Loïc)

1. LuxExperience vs Mytheresa : une seule des deux (sinon 22 doublons), et règle d'attribution de marque par slug.
2. Brancher `ALTAMIRA` et `JOBYLON` au dispatch (`src/ats/index.ts`, `KIND_TO_ATS`, enum Prisma `AtsType`) — hors périmètre du brief.
3. Zegna : Thom Browne et TOM FORD Fashion ne sont pas sur ce portail (0/60) ; à chercher séparément.
