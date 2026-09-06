# g6 — six sources ACTIVES sans description, et le complément « descriptions aplaties »

Date : 2026-09-06. Lecture seule en base (`Source`, `SourceRun`, `Job`/`JobSource`) via le proxy Railway ; aucune écriture, aucun commit. Chaque chiffre ci-dessous vient d'une exécution (scripts `src/discovery/g6-*.mts`, mesure = `g6-measure.mts <source> [échantillon]`).

Vérification finale : `npx vitest run src/ats src/connectors` → **29 fichiers, 238 tests verts** (223 avant, +15) ; `npx tsc --noEmit -p .` propre.

## Ce qui a été trouvé, en une ligne par source

| Source | Ligne Source (kind, config) | Où est la description à la source | Cause | Correctif | Avant → après (mesuré) |
|---|---|---|---|---|---|
| `hermes` | `wttj` `{slug:"hermes"}` | API publique `api.welcometothejungle.com/api/v1/organizations/{org}/jobs/{slug}` (`job.description` HTML) | L'index Algolia ne porte plus `description` (`profile` à null) — seulement `summary` (400–550 car.) | `wttj.ts` : détail par l'API après la liste, repli sur `summary` | 609 / desc 0 % → **609 offres \| 609 lieu \| 609 desc>200 \| 609 date \| 49 s** |
| `diptyque` | `wttj` `{slug:"diptyque-paris"}` | idem | idem | idem | 26 / desc 0 % → **26 \| 26 \| 26 \| 26 \| 2 s** |
| `loreal` | **pas une ligne Source** : entrée `SITEMAP_JSONLD` du registre `registry.ts` (`careers.loreal.com/fr_FR/jobs/sitemap.xml`) | Microdata `itemprop="description"` de la page (6 `<p>`, 3 `<br>`, `<li>`) | Le JSON-LD ne porte que `title` + `datePosted` ; le connecteur générique ne lit que le JSON-LD | `jsonLdSitemap.ts` : repli sur le texte de page (microdata, `__NEXT_DATA__`) quand le JSON-LD est inutilisable | 1 716 / desc 0 % → échantillon 30 pages : **29 offres \| 0 lieu \| 28 desc>200 \| 29 date \| 9 s** (1 URL 404 : `/jobs/JobDetail` nu) |
| `kering` | **deux routes sous la même clé** : (a) registre `SITEMAP_JSONLD` `www.kering.com/fr/sitemap.xml` → 1 427, desc 12 % ; (b) ligne Source `eightfold` `{domain:"kering.com"}` → 1 033, desc 99,5 % | (a) `__NEXT_DATA__.props.pageProps.description` (2 329 car., 9 `<p>`, 12 `<li>`) | Le JSON-LD de kering.com met dans `description` le **portrait de la Maison** (151–204 car., identique sur chaque offre) ; les 12 % « avec description » sont les portraits qui dépassent 200 | même repli générique | (a) 12 % → échantillon 40 pages : **40 \| 40 \| 38 desc>200 \| 40 \| 7 s** |
| `jako` | `personio` `{host:"jako.jobs.personio.de"}` | **Nulle part** : les 42 sections `<jobDescription>` du flux `/xml` valent littéralement `Test`, `<em>Test</em>`, `test` (longueur max 13) ; la page publique `jako.jobs.personio.de/job/1280438` rend « Ihre Aufgaben : Test / Ihr Profil : Test » | L'employeur n'a jamais rempli ses fiches Personio | **aucun** (rien à lire) | 20 / desc 0 % → **20 \| 20 \| 0 \| 20 \| 0 s** — inchangé, et c'est juste |
| `sephora-france` | `successfactors` `{origin:"https://jobs.sephora.com/France"}` | Microdata de la page de détail (19 `<p>`, 6 `<li>`, `datePosted`, `streetAddress`) | **URL de détail fausse** : `origin + lien` = `/France/France/job/…`, que le site sert en HTTP 200 comme page générique « Careers at Sephora » (sans microdata) → 0 desc, 0 date, 0 pays | `successfactors.ts` : `new URL(lien, origin)` (un chemin absolu se résout sur l'hôte) | 24 / desc 0 % date 0 % pays 0 % → **24 \| 24 \| 24 \| 24 \| 3 s**, ex. « CDI - Demand Planner (F/H/X) @ SARAN, FR », 9 530 car. |

## Complément — descriptions aplaties (> 1 500 car. sans saut de ligne)

Compté en base le 2026-09-06 (offres actives, `position(E'\n')=0`) :

| Source | Pavés / actives | Ce que la source porte | Cause | Correctif | Après (mesuré) |
|---|---|---|---|---|---|
| `l-oreal-professionnel` (avature, liste) | 1 356 / 1 782, dont **63 commencent par `/a>`** | Détail : microdata avec `<p>`/`<br>`/`<li>` ; carte de liste : `<h3><a>titre</a></h3><span>ville</span><span>Posted dd-Mmm-yyyy</span><div class="article__content">extrait</div>` | (1) `parseMicrodataDescription` (partagée SF/Avature) remplaçait chaque balise par une espace puis écrasait tout blanc → pavé. (2) La capture de carte s'arrêtait sur le `<` de `</a>` : la suite commençait par « /a> » ; et quand ville + date sont dans le même nœud texte (« Dongguan Posted 16-Jun-2026 »), le marqueur ancré en tête de cellule ne les voyait pas → tout (y compris « Share this job: Share ») partait dans l'extrait, et restait en base quand le détail échouait | `successfactors.ts` : microdata → `htmlToPlainText` ; `avature.ts` : bloc utile après `</a>`, marqueur cherché dans la cellule, extrait arrêté au premier bouton/partage, date lue en UTC | 2 pages de liste + détails : **40 \| 38 lieu \| 39 desc>200 \| 40 date \| 14 s \| pavés 0**, ex. 2 487 car., 26 sauts |
| `adidas` (successfactors) | 831 / 1 053 | Microdata, 33 `<p>` par fiche | (1) ci-dessus | idem | 2 pages : **75 \| 75 \| 74 \| 0 date \| 7 s \| pavés 0** (3 259 car., 74 sauts) — la date était déjà à 0 (pas de `datePosted` chez ce tenant), hors périmètre |
| `crocs` (successfactors) | 495 / 495 | idem | idem | idem | 2 pages : **40 \| 40 \| 40 \| 40 \| 8 s \| pavés 0** |
| `avolta` (successfactors) | 217 / 243 | idem | idem | idem | complet : **243 \| 243 \| 239 \| 243 \| 21 s \| pavés 0** |
| `parfums-chanel` (workday) | 878 / 1 098 | `jobPostingInfo.jobDescription` HTML (17–62 `<p>`, jusqu'à 33 `<li>`) | **Pas l'adaptateur** : `htmlToPlainText` rend aujourd'hui 31–91 sauts par offre. Les pavés sont des lignes créées le 2026-09-02 ; le run de 08:21 UTC les a touchées SANS ré-écrire la description, car le commit `4c565b7` (ré-attestation qui ré-écrit une description plus riche) date de 09:07 UTC — après ce run. Sur 8 offres comparées, le texte frais est plus long que le pavé en base (3 499 > 3 400, 4 025 > 3 987, 4 293 > 4 208…) et porte des sauts → **s'auto-guérit au prochain run** avec le code déployé | aucun | — |
| `foot-locker-france` (phenom) | 1 019 / 2 842 | `/api/jobs` : `description` est un **texte plat à la source** (0 balise, 0 saut, 0 puce sur ces offres ; 36/100 de l'échantillon). Le HTML structuré n'existe que dans le JSON-LD de la page `/jobs/{id}?lang=en-us` (8 468 car., 20 `<p>`, 22 `<br>`, 20 `<li>`) — 470 Ko par page, `crawl-delay: 5` déclaré dans robots.txt → 2 832 × 5 s ≈ 4 h par run | plat à l'API | **aucun** — décision : ajouter 2 832 pages/run (≈ 1,3 Go, ~4 h sous crawl-delay) pour la mise en forme de 36 % des offres. Pas prise ici. Les endpoints Phenom `/api/apply/v2/jobs/{id}`, `/api/jobs/{id}`, `/api/job?id=` → 404 ; `descriptionFormat=html` ignoré | — |

## Détail par source

### hermes / diptyque — WTTJ

- Ligne Source : `hermes` kind `wttj` `{"slug":"hermes"}` ; `diptyque` `{"slug":"diptyque-paris"}`. 5 derniers runs : DEGRADED, desc 0 %, date 100 %, pays 100 %.
- Sonde (`g6-probe1.mts wttj`, `g6-probe4.mts wttj`) : hit Algolia = 43 champs, **sans `description`**, `profile: null`, `summary` 401–546 car. ; page HTML de l'offre : 196 Ko avec JSON-LD `JobPosting.description` complet ; API `api.welcometothejungle.com/api/v1/organizations/hermes/jobs/{slug}` : `job.description` 4 741 car. HTML (2 `<p>`, 67 `<br>`, 15 `<li>`), 120–170 ms, fonctionne **sans user-agent ni clé**.
- Correctif `src/ats/adapters/wttj.ts` : après la liste, un appel API par offre (concurrence `detailConcurrency`, défaut 4, porte par hôte du transport), `description` = description + profil + processus convertis par `htmlToPlainText` ; repli `summary` si l'API échoue ; `withDescriptions:false` respecté ; l'API n'est pas appelée si l'index porte encore `description`.
- Fixture `__fixtures__/g6-wttj-diptyque.json` (hit + réponse API réels, réduits) ; `wttj.test.ts` (5 tests).
- Mesure : Hermès **609 | 609 | 609 | 609 | 49 s** (ex. Polisseur(se) @ Chessy, 4 056 car., 51 sauts) ; Diptyque **26 | 26 | 26 | 26 | 2 s** (2 572 car., 27 sauts).

### loreal — sitemap du registre (et la piste « portail » de Loïc)

- `loreal` n'existe pas dans la table `Source` ; la clé vient de `JOB_SOURCES` (`src/connectors/registry.ts`, kind `SITEMAP_JSONLD`) et tourne dans la phase sitemap de `runIngest`. `SourceRun` : 1 716 / desc 0 % / pays 0 % à chaque run. Elle **double** la ligne Source `l-oreal-professionnel` (avature, même tenant `careers.loreal.com`, 1 716 offres, desc 99,7 %, avec lieu) : 1 819 `JobSource` sous `loreal`.
- Sonde : sitemap fr_FR = 1 795 `<loc>`, 1 717 offres ; le JSON-LD d'une page = `{"@type":"JobPosting","title":"_SYNERGIE - Skincare expert","datePosted":"2026-07-15"}` — pas de description, pas de lieu ; le texte est en microdata `itemprop="description"` sur la même page.
- Correctif `src/connectors/generic/jsonLdSitemap.ts` : `richestDescription(html, jsonLd)` prend le texte de page (microdata ou `__NEXT_DATA__`) quand le JSON-LD est < 200 car. ou que la page porte ≥ 2× plus ; `microdataDescriptionHtml` (marche par profondeur de `<div>`, `\r` retirés) est désormais partagée avec SuccessFactors/Avature. Fixture `g6-loreal-jobdetail.html` (JSON-LD + bloc microdata réels), 4 tests dans `jsonLdSitemap.test.ts`.
- Mesure (30 pages) : **29 | 0 lieu | 28 | 29 | 9 s** — la description est là, mais **la route sitemap n'aura jamais le lieu** (ni JSON-LD ni microdata d'adresse sur ces pages) là où la liste Avature l'a.
- Piste « portail » (Loïc) : `careers.loreal.com/fr_FR/jobs/SearchJobs/?listFilterMode=1` n'est **pas** le gabarit Ralph Lauren — 0 `article article--result`, 0 `article--details`, mais 20 cartes `article__content--result` avec `/jobs/JobDetail/{slug}/{id}` et `data-total="999+"`, exactement ce que le mode **liste** (`listingUrl`) lit déjà : `parseAvatureListing` → 20 offres/page, ville, date. Le mode portail rend 0 sur cette page ; l'adapter ne servirait à rien ici.
- **Proposition** : retirer l'entrée `loreal` du registre (route en double, sans lieu, désormais avec description) et laisser `l-oreal-professionnel` porter L'Oréal — puis `retire-source loreal` (D27). Si on garde le sitemap, sa config équivalente en base serait `kind: generic-listing`, `sitemapUrl: https://careers.loreal.com/fr_FR/jobs/sitemap.xml`, `jobUrlPattern: /jobs/JobDetail/`.
- ⚠ `careers.loreal.com` répond **HTTP 406** par rafales (sitemap à 11:08, liste et `SearchJobs/Dongguan` à 11:12–11:15, puis OK après 20–30 s de pause) — ce n'est pas le 202 + `x-amzn-waf-action` de Ralph Lauren, plutôt une limite de débit. Le run de prod passe (1 716 lues à 08:38) ; à surveiller si les deux routes restent actives.

### kering — deux routes, une clé

- Ligne Source `kering` : `eightfold` `{"domain":"kering.com","origin":"https://careers.kering.com"}` → runs OK 1 033, desc 99,5 %. Et l'entrée registre `SITEMAP_JSONLD` `www.kering.com/fr/sitemap.xml` → runs DEGRADED 1 427, desc 12 %. Les deux écrivent `SourceRun.sourceKey = 'kering'` au même instant (deux lignes par run) et 2 546 `JobSource` sous la clé.
- Sonde (12 pages) : JSON-LD présent partout, `description` 151–204 car. = portrait de la Maison (« Fondée en 1917 par l'Espagnol Cristóbal Balenciaga… ») ; le texte du poste est dans `__NEXT_DATA__.props.pageProps.description` (2 329 car., `<p>`/`<li>`). 2/12 « desc>200 » = portraits un peu plus longs, pas des offres.
- Correctif : même repli générique (`nextDataDescriptionHtml`). Fixture `g6-kering-jobdetail.html` (JSON-LD + `pageProps` réduit).
- Mesure (40 pages) : **40 | 40 | 38 | 40 | 7 s**, ex. « BALENCIAGA - STAGE - E-MERCHANDISING (H/F) - FEVRIER 2021 » 1 549 car., 27 sauts.
- ⚠ Cet exemple est un **stage de février 2021** : le sitemap kering.com garde des offres fermées qui répondent 200 (la note du registre le disait déjà). 1 427 − 1 033 = **394 URL au-dessus du flux Eightfold vivant**, ré-attestées à chaque run → jamais fermées par le refresh. Constat à arbitrer (garder la route sitemap ou la retirer via `retire-source`), pas tranché ici.

### jako — Personio : vide à la source

- `personio` `{"host":"jako.jobs.personio.de"}`. `?language=fr` : 20 positions, `<jobDescriptions>` vides ; `/xml` (repli de l'adaptateur) : 42 `<jobDescription>` dont les valeurs distinctes sont `Test`, `<em>Test</em>`, `​Test`, `test` (longueur max 13). Page publique `/job/1280438` : « Ihre Aufgaben / Test », « Ihr Profil / Test ». `jako.de/karriere` = page « WE ARE TEAM », pas d'autre ATS.
- Rien à corriger : la description n'existe pas. L'adaptateur rend bien « Ihre Aufgaben\nTest\nIhr Profil\nTest » (34 car.) → < 200, donc DEGRADED reste le verdict juste.

### sephora-france — SuccessFactors : l'URL de détail

- `successfactors` `{"origin":"https://jobs.sephora.com/France"}` (trouvé manuellement par Loïc). Runs : 4 × « OK 0 offre » puis 24 offres DEGRADED desc 0 / date 0 / pays 0.
- Sonde : liste → 48 liens `/France/job/…/{id}/` (24 offres) ; `parseListing` construisait `${origin}${path}` = `https://jobs.sephora.com/France/France/job/…` → HTTP 200, `<title>Careers at Sephora</title>`, sans `itemprop` (page générique). La bonne URL `https://jobs.sephora.com/France/job/…` porte titre, `streetAddress` « SARAN, FR », `datePosted`, et la description (19 `<p>`, 6 `<li>`).
- Correctif `successfactors.ts` : `new URL(path, origin)` — un chemin absolu se résout sur l'hôte. Test « origine avec segment » ajouté (le test existant avec origine nue reste vert). Fixture `g6-sephora-france-1354866455.html` (bloc microdata réel).
- Mesure : **24 | 24 | 24 | 24 | 3 s** — ex. « CDI - Demand Planner (F/H/X) @ SARAN, FR », 9 530 car., 515 sauts.

### Descriptions aplaties — SuccessFactors + Avature (une cause, cinq sources)

- `parseMicrodataDescription` (`successfactors.ts`, utilisée aussi par le détail Avature) faisait `replace(/<[^>]*>/g,' ')` puis `replace(/\s+/g,' ')` : toute structure perdue. Preuve à la source : adidas 33 `<p>` par fiche, Sephora 19 `<p>` + 6 `<li>`, L'Oréal 6 `<p>` + 3 `<br>` + `<li>` — et `parseMicrodataDescription` rendait 2 454 car., **0 saut** sur la fiche L'Oréal.
- Correctif : `htmlToPlainText(microdataDescriptionHtml(html))`. Test « un bloc à paragraphes ne devient pas un pavé » (`Première phrase.\n\nSeconde phrase.\n• Un\n• Deux`).
- Mesures après : adidas 75 offres / pavés 0 (3 259 car., 74 sauts) ; Crocs 40 / 0 ; Avolta 243 / 0 (2 919 car., 36 sauts) ; L'Oréal Pro 40 / 0 (2 487 car., 26 sauts) ; Sephora 24 / 0.
- Les lignes existantes se ré-écrivent au prochain run par `reattestationFields` **si le texte structuré est plus long** que le pavé (`length >`). Pour SF/Avature il l'est (sauts en plus, espaces en moins : 2 454 → 2 487 sur L'Oréal). Si des cas « plus court » apparaissent en base après le run, la règle `length >` sera à revoir — hors de mon périmètre (`src/dedup/upsert.ts`).

### `/a>` — carte Avature (L'Oréal Pro)

- 63 offres actives en base commencent par `/a> {ville} Posted {date} …` (« /a> Taipei Posted 20-Jul-2026 1. 負責… », « /a> Piscataway, NJ Posted 18-Aug-2026 Job Title - Senior Planner… »). Le motif de carte s'arrêtait sur le `<` de `</a>` ; « /a> » n'étant pas une balise pour le découpage, il devenait la première cellule. Sur ces 63, ville et date étaient dans **la même cellule** que « /a> » (« /a> Taipei Posted 20-Jul-2026 ») : le marqueur ancré `^posted` ne matchait pas, `location` restait vide et **toute** la suite partait en description — conservée parce que le détail avait échoué ou était plus court.
- Correctif `avature.ts` : bloc utile après `</a>` ; marqueur `(posted|publié|…)\s+dd-Mmm-yyyy` cherché dans la cellule, ville = texte avant (même cellule) ou cellule précédente ; extrait arrêté au premier bouton/« Share » ; date lue en UTC (`parseCardDate` — `new Date('15 Jul 2026')` donnait la veille en ISO sur un poste Europe/Paris). Fixture `g6-loreal-listing-card.html` (carte réelle) + cas « Dongguan Posted 16-Jun-2026 » : 3 tests.

## Fichiers touchés

- `src/connectors/generic/jsonLdSitemap.ts` (+ `.test.ts`) — `microdataDescriptionHtml`, `nextDataDescriptionHtml`, `richestDescription`, `fetchJobFromPage` enrichi.
- `src/ats/adapters/successfactors.ts` (+ `.test.ts`) — `parseListing` (`new URL`), `parseMicrodataDescription` (structure conservée).
- `src/ats/adapters/avature.ts` (+ `.test.ts`) — carte de liste (`/a>`, ville+date même cellule, extrait borné), `parseCardDate`.
- `src/ats/adapters/wttj.ts` (+ `wttj.test.ts` nouveau) — descriptions par l'API publique.
- Fixtures : `__fixtures__/g6-sephora-france-1354866455.html`, `g6-loreal-jobdetail.html`, `g6-loreal-listing-card.html`, `g6-kering-jobdetail.html`, `g6-wttj-diptyque.json` (toutes capturées à la source le 2026-09-06, tronquées).
- Scripts lecture seule : `src/discovery/g6-readSources.mts`, `g6-readRuns.mts`, `g6-probe1..9.mts`, `g6-capture.mts`, `g6-measure.mts`, `g6-loreal-portail.mts`.
- Ni dispatch, ni schéma, ni `upsert.ts`, ni `html.ts` touchés. Aucun commit.

## À arbitrer (pas tranché ici)

1. `loreal` (registre) : retirer, doublon sans lieu de `l-oreal-professionnel` → `retire-source loreal`.
2. `kering` (registre sitemap) : 394 URL de plus que le flux Eightfold vivant, dont des offres de 2021 ré-attestées à chaque run ; retirer ou garder ?
3. `foot-locker-france` : mise en forme possible seulement par 2 832 pages de 470 Ko sous crawl-delay 5 (≈ 4 h/run) — vaut-il le coût pour 36 % des offres ?
4. `jako` : 20 offres sans texte à la source ; les garder (titre + lieu + date) ou pas — question produit (D1 ne parle que d'offres fictives, celles-ci sont réelles).
