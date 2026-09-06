# Lot g3 — portails GENERIC résolus (mesures du 2026-09-06)

Lecture seule : aucune écriture en base, aucun fichier existant modifié. Scripts dans `src/discovery/g3-*.mts` ; deux adaptateurs nouveaux (`src/ats/adapters/jibe.ts`, `volcanic.ts`) avec tests vitest (9/9 verts), **non câblés** dans le dispatch (`src/ats/index.ts`) ni dans `KIND_TO_ATS`.

Format de mesure : `N offres | N lieu | N desc>200 | N date | durée`.

| # | Portail | Verdict | Mesure |
|---|---|---|---|
| 1 | Selfridges | **RÉSOLU** (générique, pagination en chemin) | 43 \| 43 \| 40 \| 43 \| 9 s |
| 2 | Fenwick | **API TROUVÉE — adaptateur écrit** (`volcanic.ts`) | 31 \| 31 \| 31 \| 0 \| 1 s |
| 3 | END. Clothing | **RÉSOLU** (générique, sitemap → Breezy HR) | 22 \| 22 \| 22 \| 22 \| 4 s |
| 4 | PVH | **CHEMIN TROUVÉ, adaptateur à écrire** (WAF AWS : jeton navigateur obligatoire) | 1 339 \| 1 325 \| 1 334 \| 1 339 \| 409 s |
| 5 | Boots | **RÉSOLU** (générique, sitemap index) — lieu à corriger dans le normaliseur | 1 391 \| 1 391* \| 1 391 \| 1 391 \| 226 s |
| 6 | APM Monaco | **VIDE** (aucune offre publiée ; « écrivez à careers@apm.mc ») | 0 |
| 7 | Ulta Beauty | **API TROUVÉE — adaptateur écrit** (`jibe.ts`) ; les sous-portails iCIMS ne sont plus publics | 9 959 \| 9 959 \| 9 959 \| 9 959 \| 63 s |

\* Boots : les 1 391 « lieux » valent littéralement `-, -, -` après normalisation (voir §5).

---

## 1. Selfridges — RÉSOLU

**Pourquoi le générique lisait 10 offres** : `/jobs/search` est rendu serveur, 10 offres par page, mais la pagination n'est ni `?page=N` ni un formulaire GET (le formulaire est en POST et ignore `page`) : le pager rend des liens **en chemin** `https://jobsearch.selfridges.com/jobs/search/-1/2`, `/-1/3`, `/-1/4`… (mesuré : `?page=2`, `?p=2`, `?start=10`, `POST page=2` rendent tous la page 1).

**Piège secondaire** : `sitemap.xml` liste 5 sitemaps enfants (`/sitemap/1`…`/sitemap/5`, 10+10+10+10+3 = 43 URLs) mais les enveloppe dans `<urlset>` au lieu de `<sitemapindex>`. `fetchSitemapUrls` n'y voit donc pas un index et rend les 5 URLs de sitemaps comme pages d'offres → 0 offre (config `sitemapUrl` mesurée : 0 en 2 s). Un correctif d'une ligne dans `jsonLdSitemap.ts` (traiter comme index une liste dont les `<loc>` sont eux-mêmes des sitemaps) le rendrait utilisable ; non fait (lecture seule).

**Config** (type `GENERIC_JSONLD`) :
```json
{ "listingUrl": "https://jobsearch.selfridges.com/jobs/search/-1/{page}", "linkPattern": "/jobs/job/", "pageStart": 1, "maxPages": 50 }
```
**Mesure** : `43 offres | 43 lieu | 40 desc | 43 date | 43 url | 9s` — ex. « Christmas Temp - Private Host (40 Duke) @ London, W1U 1QS ». 43 = total du sitemap. Pays : United Kingdom 43. Les pages détail portent un JSON-LD `JobPosting` complet.

Script : `g3-generic.mts selfridges-listing` ; diagnostic : `g3-selfridges.mts`, `g3-selfridges2.mts`.

## 2. Fenwick — API TROUVÉE, adaptateur écrit (`volcanic.ts`)

**Plateforme** : Volcanic (télémétrie `Volcanic.prod-eu-2`, `/api/v1/csrf_meta_tags.json`). Site annonce « Found 31 jobs ». `/job/sitemap.xml` liste bien 31 URLs, **mais les pages détail ne portent aucun JSON-LD** (0 bloc `ld+json` sur 708 Ko) → le générique lit 0 quel que soit le mode (sitemap et listing mesurés : 0).

**API** : `GET https://www.careers.fenwick.co.uk/api/v1/jobs.json?page=N` — JSON public, aucune clé ni en-tête particulier. Réponse : `{ jobs: [...], total_count: 31, page_count: 2, current_page: N }`, 20 offres par page, pagination 1-indexée, arrêt à `page >= page_count` (ou `jobs` vide). Champs par offre : `id` (identifiant), `job_title`/`title`, `job_location` (chaîne, ex. « Royal Tunbridge Wells »), `job_type` (« Full Time »), `disciplines[].name` (« Retail »), `description` (HTML complet, ~2 800 car.), `clean_description`, `salary_low`/`salary_high`, `cached_slug` → URL publique `https://www.careers.fenwick.co.uk/job/{cached_slug}`. **Pas de date** : `start_date`/`end_date` sont `null` sur 31/31. Pas de pays (site UK).

**Adaptateur** : `src/ats/adapters/volcanic.ts` — `fetchVolcanicJobs({ origin })`, `parseVolcanicPage` testé (`volcanic.test.ts`, 4 tests).
**Config** : `{ "origin": "https://www.careers.fenwick.co.uk" }`
**Mesure** (appel direct, `g3-adapters.mts fenwick`) : `31 offres | 31 lieu | 31 desc | 0 date | 1s ; declaredTotal 31 ; truncated false` — ex. « Team Leader - Womenswear @ Royal Tunbridge Wells ».

Reste à faire pour l'exploiter : ajouter le type `VOLCANIC` au dispatch et à `KIND_TO_ATS`.

## 3. END. Clothing — RÉSOLU

**Plateforme** : Breezy HR (`end.breezy.hr`), habillée sur `careers.endclothing.com`. La page d'accueil rend 0 lien d'offre côté serveur (liste chargée en JS), et les offres vivent sur un **autre hôte** (`end.breezy.hr`) — d'où le 0 du générique en mode `startUrl` (il ne suit que les liens de même origine).

`https://careers.endclothing.com/sitemap.xml` liste les 22 pages Breezy (+ la racine), et chaque page Breezy porte un JSON-LD `JobPosting` complet (titre, lieu structuré avec pays, date, description HTML).

**Config** (type `GENERIC_JSONLD`) :
```json
{ "sitemapUrl": "https://careers.endclothing.com/sitemap.xml" }
```
**Mesure** : `22 offres | 22 lieu | 22 desc | 22 date | 22 url | 4s` — ex. « Applications Analyst @ Washington » ; pays GB 21, IT 1. 22 = le nombre d'ouvertures affiché sur le portail.

Alternative sans page détail : `GET https://end.breezy.hr/json` (tableau de 22 positions : `id`, `friendly_id`, `name`, `url`, `published_date`, `location{city,country{id,name}}`, `department`, `type`) — sans description ; la description est sur la page (JSON-LD). Le sitemap suffit.

## 4. PVH (Calvin Klein, Tommy Hilfiger) — chemin trouvé, adaptateur à écrire

**Ce que le détecteur avait pris** (`/blogs/first-blog-draft`) est un flux de blog ; il n'a rien à voir avec les offres.

**Plateforme** : site carrière **Clinch** (cookie `_clinch_session`, `/api/v1/public/log_requests/init`, `/me/consents?company_id=4f5cc7fa…`), derrière **AWS WAF** (`challenge.js`). ATS derrière : **Workday, mais interne** — le seul lien Workday de la page est « If you are a current PVH Associate → https://www.myworkday.com/pvh » ; le bouton APPLY candidat est un formulaire Clinch. Aucun site public `pvh.wdN.myworkdayjobs.com` trouvé (wd1/wd3/wd5/wd12/wd103/wd108 : HTTP 406, identique à la racine Richemont avec les mêmes en-têtes, donc non concluant sur le data-center ; `/en-US/PVH` : 404).

**L'énumération** : `https://careers.pvh.com/sitemap.xml` — 1 413 `<loc>`, dont **1 347 pages d'offres** `/jobs/<slug>`. Chaque page porte un JSON-LD `JobPosting` complet (titre, `datePosted`, `identifier`, `jobLocation` avec rue/ville/région/CP/pays, description ~3 000–7 000 car.). La recherche `/jobs/search?page=N` (45 pages × 30) est un formulaire Turbo (`Accept: text/vnd.turbo-stream.html`) — inutile, le sitemap suffit.

**Le blocage, mesuré** : le WAF laisse passer des requêtes isolées (robots, sitemap, 1 détail, 1 recherche : 200) mais bascule en **challenge** dès qu'on enchaîne : réponse **HTTP 202, corps vide, `x-amzn-waf-action: challenge`**.
- générique `sitemapUrl` (concurrence 4) : **0 offre sur 1 413 en 114 s** — chaque page 202 vide, ignorée en silence ;
- 40 détails à concurrence 4 sans jeton : **40/40 challenge** ;
- **avec le cookie `aws-waf-token`** posé par une seule navigation Playwright sur `/jobs/search` : 120/120 détails OK en 13 s, puis la passe complète : **1 339 offres | 1 325 lieu | 1 334 desc | 1 339 date | 409 s** (sitemap 1 347, 0 challenge, 8 erreurs — URLs périmées du sitemap, non vérifiées une à une). Pays : US 526, DE 150, NL 126, IT 126, FR 90, CA 61, GB 53, TR 41… **145 offres ont un `datePosted` > 1 an** (annonces permanentes, ex. Roosendaal 2024-01-23) — à garder en tête pour la fraîcheur affichée.

**Adaptateur à écrire** (`clinch`, ou option du générique) : (1) une navigation Playwright (`chromium`, UA desktop) sur `{origin}/jobs/search`, ~6 s, lire les cookies du contexte (`aws-waf-token`, `_clinch_session`) ; (2) crawl du sitemap en HTTP simple (`fetchText`) avec `cookie:` rejoué, concurrence 4, parse JSON-LD via `parseJobPostings` — exactement `g3-pvh-full.mts`. Le jeton a tenu 409 s / 1 347 requêtes sans renouvellement. `fetchRenderedHtml` (lib/browser.ts) ne suffit pas tel quel : il rend le HTML mais n'expose pas les cookies. Ne pas partir sur un rendu navigateur des 1 347 pages : inutile et 30× plus lent.

Scripts : `g3-pvh.mts` (turbo/WAF), `g3-pvh-browser.mts`, `g3-pvh-workday.mts`, `g3-pvh-workday2.mts`, `g3-pvh-waf.mts` (jeton réutilisable), `g3-pvh-volume.mts` (40 sans / 120 avec), `g3-pvh-full.mts` (passe complète).

## 5. Boots — RÉSOLU (générique) — mais le lieu normalisé est faux

**Plateforme** : pas Radancy — **WordPress** (`wp-admin/admin-ajax.php`, thème `boots-pharmacy`), widget inploi en iframe. `/search-jobs/results?…` (gabarit Radancy) → 404.

**Deux chemins, tous deux mesurés** :
- **Sitemap** (`robots.txt` → `sitemap_index.xml`) : `jobs-sitemap.xml` 1 000 + `jobs-sitemap2.xml` 414 + `jobs-sitemap3.xml` 0 = **1 414 offres** (+ post/page/category sitemaps, sans offres). Chaque page détail porte un JSON-LD `JobPosting` (titre, `datePosted`, `identifier` = référence « 259681BR », `hiringOrganization` Boots, description complète, `geo` lat/long).
- **API XHR** : `POST https://www.boots.jobs/wp-admin/admin-ajax.php`, corps `action=boots_job_search&nonce={n}&data={JSON}` avec `data = {"jobfeed":"external","search_text":"","location":"","show":"24","show_job_alert_card":"0","sort_by":"","store_last_search":true,"page":"0","per_page":"24"}` ; le nonce vient de `POST admin-ajax.php` `action=get_dynamic_nonces` → `data.jobs_nonce` (public, sans session). Réponse `{ success, data: { html, count: 1414, shown, page, next_page, per_page, has_more } }` — `html` = cartes (2 liens `/jobs/<slug>` par carte), `per_page` jusqu'à **200** accepté (mesuré : 400 liens = 200 cartes), `page` 0-indexé. Pas de description dans les cartes : les pages détail restent nécessaires → le sitemap est le bon chemin.

**Config** (type `GENERIC_JSONLD`) :
```json
{ "sitemapUrl": "https://www.boots.jobs/sitemap_index.xml", "concurrency": 4 }
```
**Mesure** : `1391 offres | 1391 lieu | 1391 desc | 1391 date | 1391 url | 226s` — 1 391 < 1 414 du sitemap (23 pages sans JobPosting exploitable ou en erreur, ignorées en silence par le générique ; non listées une à une).

**Défaut bloquant pour l'affichage** : le JSON-LD Boots met des tirets de remplissage : `addressLocality: "-"`, `addressRegion: "-"`, `postalCode: "-"`, pas de pays, et le vrai lieu dans `streetAddress` (« Tunbridge Wells, Calverley Road », « Manchester, Didsbury »). Le normaliseur produit donc `location = "-, -, -"`, `city = "-"`, `country = undefined` sur les 1 391 offres — mesuré sur 2 pages (`g3-boots-loc.mts`). À corriger dans `normalizeJobPosting` (ignorer un champ d'adresse égal à `-`, replier sur `streetAddress`, exploiter `geo`) avant d'activer la source, sinon 1 391 offres « -, -, - » sur le site. Question à Loïc : Boots (pharmacie/beauté UK, 1 400 offres majoritairement pharmacie/optique) est-il dans le périmètre Beauté·Retail ?

## 6. APM Monaco — VIDE

Boutique Shopify. `https://www.apm.mc/pages/career-opportunities` redirige la version fr vers l'accueil ; la version `uk.apm.mc/pages/career-opportunities` rend, dans `<main>`, exactement : « If you would like to join APM Monaco, please contact us at careers@apm.mc — Follow our linkedIn account to discover new opportunities. » + un lien LinkedIn Jobs. Aucune offre sur le site, aucun ATS référencé (seuls indices : GraphQL Shopify, Klaviyo, Trustpilot). Rien à ingérer (LinkedIn n'est pas une source). Trois pistes vérifiées : page carrière (uk + www + fr), sitemap.xml (57 shards produits/pages), capture réseau Playwright (99 appels, aucun d'offres).

## 7. Ulta Beauty — API TROUVÉE, adaptateur écrit (`jibe.ts`)

**Les sous-portails iCIMS** trouvés dans la page (`fdcnmcareers-ulta.icims.com`, `cdcmcareers-ulta.icims.com`, `ulta.icims.com`, + `internal-ulta`) **ne sont plus des listings publics** :
- adaptateur iCIMS : 0 offre sur fdcnm et cdcm ; `ulta.icims.com` → boucle de redirections (> 5) ;
- `/jobs/search?ss=1&in_iframe=1&pr=0` répond 150 octets : `window.top.location.href = 'https://careers.ulta.com/careers/jobs'` ; sans `in_iframe`, une coquille Angular d'1 Mo avec 0 `iCIMS_JobCardItem` ; `cdcm…/jobs/515485/job` → 410.
Le listing public est le portail **Jibe (iCIMS Attract)** `careers.ulta.com`.

**API** : `GET https://careers.ulta.com/api/jobs?page=N&limit=100&sortBy=relevance&descending=false&internal=false` — JSON `{ jobs: [{ data: {...} }], totalCount: 9959, … }`. Pièges mesurés : (a) **sans le cookie de session** (`jasession`/`jrasession`, posé par `GET /careers/jobs`), la réponse est `jobs: [], totalCount: 0` — même avec Referer/Accept navigateur ; (b) `limit=100` passe, `limit=500` → HTTP 422. Champs : `req_id`/`slug` (id), `title`, `full_location` (« Lakewood, Colorado, US »), `city`, `state`, `country_code`, `postal_code`, `latitude`/`longitude`, `description` (HTML complet, ~14 000 car.), `department`, `hiring_organization`, `posted_date`, `posting_expiry_date`, `meta_data.canonical_url` (URL publique `https://careers.ulta.com/jobs/{id}?lang=en-us`). **`apply_url` est à éviter** : il pointe sur `…icims.com/jobs/{id}/login`, une page de connexion.

**Adaptateur** : `src/ats/adapters/jibe.ts` — `fetchJibeJobs({ origin, searchPath?, pageSize? })` : 1 GET de la page pour le cookie, puis pages de 100 jusqu'à `totalCount` ; `parseJibePage` testé (`jibe.test.ts`, 5 tests) ; lève une erreur si `totalCount > 0` et 0 offre (cookie non pris) plutôt qu'un `[]` silencieux.
**Config** : `{ "origin": "https://careers.ulta.com" }`
**Mesure** (`g3-adapters.mts ulta`) : `9959 offres | 9959 lieu | 9959 desc | 9959 date | 63s ; declaredTotal 9959 ; truncated false ; 9959 ids uniques` — ex. « Specialty Beauty Advisor - Lancome @ Lakewood, Colorado ». Pays : **US 9 948, PR 11** — aucune offre hors États-Unis. 9 959 = les 9 961 URLs des 4 sitemaps (2 500 × 3 + 2 461) à 2 près.

Question à Loïc : Ulta est un retailer beauté 100 % américain (~10 000 offres, majorité magasin). L'ingérer ajoute +33 % au catalogue actuel sur un seul pays hors Europe — dans le périmètre « disponible en France » ? Non tranché ici.

---

## Fichiers produits
- Adaptateurs + tests : `src/ats/adapters/jibe.ts`, `jibe.test.ts`, `volcanic.ts`, `volcanic.test.ts` (non câblés au dispatch).
- Discovery : `src/discovery/g3-probe.mts`, `g3-probe2.mts`, `g3-probe3.mts`, `g3-sniff.mts`, `g3-sniff2.mts`, `g3-generic.mts` (mesure générique par nom), `g3-adapters.mts` (mesure des 2 adaptateurs), `g3-icims.mts`, `g3-ulta.mts`, `g3-ulta-icims.mts`, `g3-ulta-icims2.mts`, `g3-boots.mts` (API admin-ajax), `g3-boots-loc.mts`, `g3-fenwick.mts`, `g3-selfridges.mts`, `g3-selfridges2.mts`, `g3-pvh*.mts`.

## Amorçage WAF — brique de transport (suite de mission, 2026-09-06)

Autorisation du coordinateur : ajouts dans `src/lib/browser.ts`, `src/lib/http.ts` ; nouveau `src/lib/wafToken.ts` ; aucune option ajoutée au générique (inutile, point 3).

**Ce qui a été construit**
- `browser.ts` — `primeWafToken(origin): Promise<string | undefined>` : ouvre `${origin}/` dans le Chromium partagé (même profil que `fetchRenderedHtml` : UA, locale fr-FR, accept-language, porte d'hôte, garde SSRF), sonde les cookies du contexte toutes les 500 ms jusqu'à voir `aws-waf-token`, renvoie `aws-waf-token=…` ; `undefined` après 20 s (`WAF_PRIME_TIMEOUT_MS`). Mémorisé par origine (Map de promesses) : un amorçage par run et par hôte, y compris sous demandes parallèles ; un amorçage en échec n'est pas gravé.
- `wafToken.ts` — la table `origine → cookie` + `isWafChallenge(response)` (202 **et** `x-amzn-waf-action: challenge`) + `primeWafCookie(url)` (dédoublonne les amorçages en vol, charge `browser.ts` paresseusement, amorceur remplaçable pour les tests) + `WafChallengeError` (« WAF challenge non levé pour <url> »). Journalise `[waf] <origine>: amorçage réussi en N ms`.
- `http.ts` — point unique dans `fetchWithRetry`, pour TOUS les adaptateurs (D25) : (1) `withWafCookie` joint le cookie amorcé de l'origine à chaque requête, après un éventuel cookie de l'appelant ; (2) un challenge reçu **avant** le test `response.ok` (jusqu'ici un 202 vide passait pour une page) déclenche l'amorçage puis **une** re-tentative hors budget normal ; un challenge sur une requête déjà munie du jeton, ou un amorçage sans jeton, lève `WafChallengeError` immédiatement, jamais rejouée, jamais un corps vide rendu. Comportement existant inchangé pour tout ce qui n'est pas un challenge (un 202 ordinaire passe comme avant — testé).

**Tests** (`src/lib/wafToken.test.ts`, réseau mocké, Playwright jamais lancé) — 7/7 : amorçage + re-tentative unique avec cookie ; `WafChallengeError` si le challenge persiste (1 challenge + 1 re-tentative, pas de 3ᵉ appel) ; échec sans re-tentative quand aucun jeton n'apparaît ; jeton mémorisé par origine (1 amorçage pour 3 requêtes) ; 3 requêtes parallèles challengées → 1 seul amorçage ; autre origine intacte et cookie de l'appelant préservé (`session=abc; aws-waf-token=…`) ; 202 ordinaire inchangé. Suite `src/lib` + `connectors/generic` + tests du générique : 73/73. `npx tsc --noEmit` : propre sur mes fichiers ; **une erreur étrangère** : `src/ats/index.ts` importe `./adapters/asosAlgolia.js`, fichier supprimé sur disque par une autre session (`git status` : `D`), ce qui rend le dispatch inimportable pendant la mesure.

**Mesure réelle** (`g3-pvh-waf-measure.mts` — tente `fetchAtsJobs('GENERIC_JSONLD', …)`, replie sur `fetchGenericJsonLdJobs`, la fonction exacte que le dispatch appelle, à cause de l'import cassé ci-dessus) :
```
[waf] https://careers.pvh.com: amorçage réussi en 2423 ms
pvh (générique + amorçage WAF): 1347 offres | 1333 lieu | 1342 desc | 1347 date | 156s
   ex: Sales Advisor 32 uur @ Roosendaal, Noord-Brabant, 4703 TB
   pays: US:527 DE:151 NL:128 IT:126 FR:90 CA:61 GB:54 TR:43 AU:21 PL:19
```
Seconde passe sur le code final (après le dernier ajustement de `http.ts`) : `amorçage réussi en 1572 ms` → `1347 offres | 1333 lieu | 1342 desc | 1347 date | 129s`, mêmes pays.
1 347 / 1 347 URLs du sitemap sur les deux passes (attendu ≈ 1 339 : les 8 erreurs de la passe manuelle étaient transitoires), **amorçage 1,6–2,4 s**, config inchangée `{ "sitemapUrl": "https://careers.pvh.com/sitemap.xml" }` — aucune option d'adaptateur. Avant la brique, la même config lisait 0 offre en 114 s.

Réutilisable tel quel pour Ralph Lauren (Avature derrière le même WAF) : rien à écrire côté adaptateur, le challenge est absorbé dans `fetchWithRetry`. Limite connue : l'amorçage ouvre `${origin}/` — si un site ne pose le challenge que sur un sous-chemin, le jeton n'apparaîtra pas et la requête échouera en `WafChallengeError` (visible, pas silencieux).

## Points transverses remontés
1. `fetchSitemapUrls` ne reconnaît un index qu'à la balise `<sitemapindex>` : Selfridges (index mal déclaré en `<urlset>`) rend 0.
2. `normalizeJobPosting` prend `-` pour une ville : Boots rend 1 391 lieux « -, -, - ».
3. Le générique ignore en silence une page qui ne parse pas : sous un WAF (PVH), une source entière passe à 0 sans erreur — le seul signal est la santé (chute de volume).
