# g2 — six portails « GENERIC » résolus (mesures du 2026-09-06)

Lecture seule : aucune écriture en base, aucun `.env`, aucun commit. Scripts dans `src/discovery/g2-*.mts`, adaptateurs dans `src/ats/adapters/{geodirectory,eqwa,rivoliTypesense,frontityJobs}.ts` (+ tests vitest, 26 tests verts), dispatch et schéma Prisma non touchés.

| Portail | Verdict | Mesure (offres \| lieu \| desc \| temps) | Comment |
|---|---|---|---|
| Douglas | **RÉSOLU** (SUCCESSFACTORS, chemin RMK v2 ajouté — voir section « RMK v2 ») ; `frontityJobs.ts` en complément (+16 offres internes) | 130 \| 130 \| 130 \| 17 s (SF) · 146 \| 146 \| 146 \| 11 s (Frontity) | `jobs.douglas.group` = SAP RMK v2 JSON ; l'état Frontity de careers.douglas.group porte les mêmes 130 + 16 internes |
| Beiersdorf | **RÉSOLU** (GENERIC_JSONLD) | 105 \| 105 \| 105 \| 11 s | ajax Sitecore paginé + JSON-LD sur les fiches |
| Beauty Success | **API TROUVÉE — adaptateur écrit** (`geodirectory.ts`) | 109 \| 109 \| 109 \| 7 s | REST GeoDirectory `/wp-json/geodir/v2/offres` |
| Nocibé | **API TROUVÉE — adaptateur écrit** (`eqwa.ts`) | 306 \| 306 \| 306 \| 25 s | tableau HTML complet + fiche `.job-detail-desc` |
| Globus | **RÉSOLU** (GENERIC_JSONLD) | 23 \| 23 \| 23 \| 2 s | listing + JSON-LD ; le générique ne suivait pas les liens |
| Rivoli Group | **API TROUVÉE — adaptateur écrit** (`rivoliTypesense.ts`) | 47 \| 47 \| 46 \| 14 s | Typesense, clé de recherche publique dans le HTML |

Total : **736 offres** là où le générique en lisait 22.

---

## 1. Douglas — `https://careers.douglas.group/fr/jobs/`

**Ce que c'est.** Un WordPress headless sous **Frontity** (`{"theme":…,"source":…,"frontity":…}` dans un `<script>` de 3,2 Mo ; l'API WP réelle est sur un hôte interne `p710549.webspaceconfig.de`, `/wp-json` sur le domaine public répond la coquille SPA). Le rendu serveur montre 12 cartes (`per_page: 6` par section), le reste est paginé côté client — d'où les 12 du générique.

**Le vrai chemin : l'état embarqué.** `source.data.jobs` de la page `/fr/jobs/` (identique sur `/de/` et `/en/`, vérifié) porte **163 entrées** = 146 postes uniques :
- 147 entrées SuccessFactors (id `603-en_US`, `603-de_DE`… → 130 postes ; url `/{lang}/jobs/{slug}/{id13}/` ; `description` HTML présente),
- 16 entrées « behindbeauty » (id `16468` ; url `/de/jobs/{slug}-{id}/` ; description vide dans le listing, présente dans l'état de la page de détail — vérifié : 3 035 c).
Champs : `title`, `url`, `city.value`, `country`, `employment.value` (contrat), `company.value` (DOUGLAS 150 / PARFUMDREAMS 10 / NICHE-BEAUTY.COM 3), `department`, `language.code`, `raw.created` (« Wed, 03 06 2026 » = **jour mois année**, pas l'ordre JS) ou `raw.advertCreationDate` (epoch ms), `structuredData` (JobPosting).
Pays : DE 139, AT 19, BG 2, PL 1, ES 1, CH 1. Langues : DE 142, EN 19, PL 1, ES 1.

**L'ATS derrière, mesuré aussi.** `jobs.douglas.group` est un SAP RMK nouvelle génération (`rmk-jobs-search`, rendu client) : `POST https://jobs.douglas.group/services/recruiting/v1/jobs`, body `{"locale":"de_DE","pageNumber":0,"sortBy":"","keywords":"","location":"","facetFilters":{},"brand":"","skills":[],"categoryId":0,"alertId":"","rcmCandidateId":""}`, 10 par page, `totalJobs` par locale : de_DE 126, en_US 11, en_GB 8, es_ES 1, pl_PL 1, fr/it/nl/ro/bg 0 → **147**, exactement les entrées SF de l'état Frontity. L'adaptateur SUCCESSFACTORS existant (liens `/job/…/id/` dans `/search/?startrow=`) y lit **0** : la page HTML ne contient aucun lien, tout est JSON. Rien de plus à gagner de ce côté ; l'état Frontity est plus riche (descriptions + les 16 offres internes).

**Adaptateur** `frontityJobs.ts` — `fetchFrontityJobs({ origin: 'https://careers.douglas.group', lang: 'fr' })` : une requête, dédoublonnage par poste (`preferLanguages`, défaut FR > EN > DE), fiches détail seulement pour les 16 offres sans description (concurrence 2, 3 Mo chacune). Mesure : `146 offres | 146 lieu | 146 desc | 11s` — ex. « Parfümerieverkäufer (w/m/d) geringfügig, samstags » @ Salzburg, AT.
Note : Playwright (Chrome 131, locale fr-FR) reçoit un **500** `text/plain` de `/fr/jobs/` ; curl et `fetchText` (Chrome 124/131) reçoivent 200. Non élucidé, sans effet sur l'adaptateur.

Script : `src/discovery/g2-douglas.mts [fr|de|en]`.

## 2. Beiersdorf — `https://www.beiersdorf.com/career/your-application/job-search` — RÉSOLU

**Ce que c'est.** Sitecore ; la liste est chargée par un ajax HTML : `GET /ajax/Jobboard/JobResultAjax?db=web&contextItemId={213FB95D-4545-426C-9F6A-7CD5753A00EA}&lang=en&page=N` (`page` 1-based, 10 liens `/career/jobs/<hash32>` par page, `data-result-count="132"`). Les fiches `/career/jobs/<hash>` portent un JSON-LD JobPosting complet (jobLocation inclus).

**Config** (type `GENERIC_JSONLD`, kind `generic-listing`) :
```json
{"listingUrl":"https://www.beiersdorf.com/ajax/Jobboard/JobResultAjax?db=web&contextItemId={213FB95D-4545-426C-9F6A-7CD5753A00EA}&lang=en","linkPattern":"career/jobs/","pageParam":"page","pageStart":1,"maxPages":40}
```
Mesure : `105 offres | 105 lieu | 105 desc | 11s` — ex. « Category Manager » @ Dublin. 105 URLs uniques.

**Écart 132 → 105, expliqué.** Le compteur compte des lignes, pas des offres : les pages 1–14 rendent 10, 9, 10, 10, 8, 7, 5, 7, 3, 8, 9, 10, 7, 2 liens *uniques* (une même fiche est listée sur plusieurs lignes, sans doute une par lieu), et les pages 15+ répètent 2 liens déjà vus — le générique s'arrête bien là. `lang=de`/`fr` donnent le même 132. **105 est le vrai nombre de fiches.**

## 3. Beauty Success — `https://recrutement.beautysuccess.fr/offres/` — API TROUVÉE, adaptateur écrit

**Ce que c'est.** WordPress + Elementor + **GeoDirectory** : chaque offre est un `gd_place`. Les fiches n'ont **aucun JSON-LD** (0 — d'où le générique muet), le flux `/offres/feed/` n'a que 25 items sur 109, `/wp/v2/offres` (annoncée par `/wp/v2/types`) répond 404. La candidature part chez **Jobaffinity** (`jobaffinity.fr/posting/apply/…?src=CARRIEREBEAUTYSUCCESS`) — l'ATS réel, mais le site WordPress est déjà la source complète.

**API.** `GET https://recrutement.beautysuccess.fr/wp-json/geodir/v2/offres?per_page=100&page=N` (UA navigateur, `accept: application/json`) ; en-têtes `x-wp-total: 109`, `x-wp-totalpages: 2` → arrêt à `page >= x-wp-totalpages`.
Chemins : `id` · `title.rendered` · `link` (URL publique) · `date_gmt` · `content.rendered` + `description_de_lemployeur` + `profil_recherch` (description, HTML) · `city` / `zip` / `region` / `country` / `latitude` / `longitude` · `type_de_contrat.rendered` (CDI…) · `temps_de_travail.rendered` · `apply_url`.

**Adaptateur** `geodirectory.ts` — `fetchGeoDirectoryJobs({ origin: 'https://recrutement.beautysuccess.fr', restBase: 'offres' })`, `declaredTotal` = `x-wp-total`. Mesure : `109 offres | 109 lieu | 109 desc | 7s` — ex. « CONSEILLER.E ESTHETICIEN.NE POLYVALENT.E H/F » @ Sarrebourg, 57400, France, CDI.

Script : `src/discovery/g2-beautysuccess.mts`.

## 4. Nocibé — `https://recrutement-nocibe.fr/front-jobs.html` — API TROUVÉE, adaptateur écrit

**Ce que c'est.** Portail « propulsé par **Eqwa** » (PHP, DataTables). `front-jobs.html` en GET rend **toutes** les offres dans un seul `<table class="with-datatable">` (306 lignes, 306 `id_job` uniques) — la pagination est purement côté client. Aucun JSON-LD ni sur la liste ni sur la fiche (0), d'où « rien détecté ».

**Chemins (HTML).** Ligne : `a[href*="id_job="]` → id + `title` ; `td[0] @data-sort` = date ISO ; `td[1]` = région + `<small>` « 75000 PARIS » ; `td[2]` = contrat (« CDI Temps complet »). Attention : le gabarit imbrique le `<td>` contrat *dans* le `<td>` lieu ; cheerio referme la cellule et rend bien trois cellules (testé). Fiche `front-jobs-detail.html?id_job=N&id_origin=0` : description dans `.job-detail-desc`, lieu dans `.job-detail-reference dt:contains(Localisation) + dd`.

**Adaptateur** `eqwa.ts` — `fetchEqwaJobs({ origin: 'https://recrutement-nocibe.fr' })`, fiches à concurrence 4. Mesure : `306 offres | 306 lieu | 306 desc | 25s` — ex. « Responsable adjoint F/H » @ PARIS, 75000, Île-de-France, CDI Temps complet, 2025-06-12.

Script : `src/discovery/g2-nocibe.mts [--all]`.

## 5. Globus — `https://jobs.globus.ch/offre-emplois.html` — RÉSOLU

**Pourquoi 0.** Le listing est bien rendu côté serveur (23 liens `…-fr-j2510.html` / `…-de-j2495.html`), mais le crawler `startUrl` ne suit que les chemins contenant `job|career|carriere|recrutement|vacanc` — ces slugs n'en contiennent aucun. Les fiches portent un JSON-LD JobPosting (lieu « Genève, Genève, 1204 »). `stellenangebote.html` (DE) liste les 23 mêmes ; `jobs.globus.ch/` n'en liste aucun. **23 = tout le site.**
robots.txt : `Disallow: /` uniquement pour une liste d'UA (wget, python-requests, axios, node-fetch, Scrapy…) ; ni `CatwalksJobsBot` ni l'UA navigateur ne sont visés, pas de bloc `*`.

**Config** (type `GENERIC_JSONLD`, kind `generic-listing`) :
```json
{"listingUrl":"https://jobs.globus.ch/offre-emplois.html","linkPattern":"-j","maxPages":2}
```
(`-j` : seuls les liens d'offre `…-fr-j2510.html` le contiennent ; la page 2 répète la page 1 et arrête la boucle.)
Mesure : `23 offres | 23 lieu | 23 desc | 2s` — ex. « Conseiller/ère de vente à 70% pour le corner Baobab » @ Genève, Genève, 1204.

## 6. Rivoli Group — `https://www.rivoligroup.com/careers/vacancies` — API TROUVÉE, adaptateur écrit

**Ce que c'est.** Concrete CMS + Vue ; la liste est vide côté serveur (`vacancies-list-item` × 0) et remplie par **Typesense** auto-hébergé. Dans le HTML : `var TYPESENSE_API_KEY = 'XVzrzN4lSwOowagLCo3jidFzJoDnq7ww'`, `TYPESENSE_NODES = [{"host":"typesense.rivoligroup.com","port":"443","protocol":"https"}]`, `data-typesense-collection="vacancy"`, `data-items-per-page="6"`. `app.min.js` filtre `page_locale : SITE_ACTIVE_LOCALE`. La clé est une clé de recherche (le `GET /collections/vacancy` schéma répond 401 avec elle).

**API.** `GET https://typesense.rivoligroup.com/collections/vacancy/documents/search?q=*&query_by=title&per_page=250&page=N`, en-tête `x-typesense-api-key: XVzrzN4lSwOowagLCo3jidFzJoDnq7ww` → `found: 52`, `hits[].document` : `id`, `title`, `url` (publique), `page_locale`, `job_location[]`, `department`, `public_date_time_stamp` (epoch s), `page_index_content` (texte de la fiche, 51/52 > 200 c). Arrêt : `hits.length < per_page` ou cumul ≥ `found`.

**Le piège mesuré.** 52 documents = **9 en_AE + 43 ar_AE** pour **47 slugs uniques** ; 38 offres n'ont pas de document anglais alors que leur page anglaise `/careers/vacancies/<slug>` existe (200, h1 anglais) — l'index anglais du site est incomplet. 6 pages n'existent qu'en arabe (404 en anglais : `assistant-manager-trade-marketing-2`, `assistant-manager-eyewear-distribution`, `floor-supervisor-travel-retail`, `assistant-manager-digital-marketing-2`, `sales-associate-rivoli-retail-2`, `sales-associate-emiratinationals`) et restent en arabe. La casse du slug compte (`Sales-Associate-EmiratiNationals` ≠ minuscule).

**Adaptateur** `rivoliTypesense.ts` — `fetchRivoliTypesenseJobs({ typesenseOrigin: 'https://typesense.rivoligroup.com', apiKey: '…', collection: 'vacancy', origin: 'https://www.rivoligroup.com' })` : fusion par slug (anglais préféré), page anglaise lue (`main h1`, `.vacancies--detail .default-text-block`) pour les 38 offres indexées seulement en arabe. Mesure : `47 offres | 47 lieu | 46 desc | 14s` — ex. « Customer Care Representative » @ Dubai, 2026-08-23. La clé publique va dans la config de la source (comme la clé Algolia LVMH), pas dans le code.

Script : `src/discovery/g2-rivoli.mts`.

---

## RMK v2 — chemin JSON ajouté à l'adaptateur SuccessFactors (suite de mission, 2026-09-06)

**Pourquoi dans `successfactors.ts` et pas un adaptateur par Maison.** `jobs.douglas.group` et `careers.breitling.com` sont la nouvelle génération SAP Recruiting Marketing (`rmk-jobs-search`, `rmkcdn.successfactors.com`) : la page `/search/` ne rend **aucun** lien `/job/…/id/` (0 sur les deux, mesuré), la liste vient de `POST {origin}/services/recruiting/v1/jobs`. C'est un vendeur ; tout futur tenant SAP migré y passera.

**Le contrat de l'endpoint (mesuré sur les deux tenants).**
- `POST {origin}/services/recruiting/v1/jobs`, en-têtes `content-type: application/json`, `accept: application/json`, UA navigateur. Body : `{"locale":"de_DE","pageNumber":0,"sortBy":"date","keywords":"","location":"","facetFilters":{},"brand":"","skills":[],"categoryId":0,"alertId":"","rcmCandidateId":""}`.
- Réponse : `{"totalJobs":126,"jobSearchResult":[{"response":{…}}]}` ; **10 par page, fixe** (aucun champ `pageSize`/`limit`/`rows`… n'est honoré — 7 essayés). Champs utiles : `id` (réquisition), `unifiedStandardTitle`, `urlTitle`/`unifiedUrlTitle`, `brandUrl` (« default » chez Douglas, absent chez Breitling), `jobLocationShort[]` (« Hamburg, Deutschland » / « La Chaux-de-Fonds, NE, CHE, 2301<br/> » / « Montreal, QC, CAN, »), `jobLocationShortWithCoordinates[].key` (lat,lng), `unifiedStandardStart` (« 10.07.26 » de_DE, « 23/06/2026 » en_GB — jour d'abord), `supportedLocales`, plus des champs custom par tenant (`custFullTimePartTime`, `filter2`…). **Pas de description dans la liste.**
- **Locales** : une par appel ; l'ensemble se lit dans les liens `…&amp;locale=xx_XX` du sélecteur de langue — sur `/search/` **et** sur `/` (la page search de Breitling n'en montre qu'une, la home cinq ; fr_FR et de_DE y portent des offres absentes d'en_GB). Douglas : bg de en_GB en_US es fr it nl pl ro ; totaux de_DE 126, en_US 11, en_GB 8, es 1, pl 1, autres 0. Breitling : en_GB 41, fr_FR 5, de_DE 4, ja/zh 0.
- **URL publique** : `{origin}[/{brandUrl}]/job/{urlTitle}/{id}-{locale}` — vérifiée 200 : `https://jobs.douglas.group/default/job/Director-SAP-S4-HANA-Transformation-%28fmx%29/612-en_US`, `https://careers.breitling.com/job/Sales-Associate-Montreal/1426-en_GB` (le `&amp;` des slugs est décodé ; `/default/…` répond aussi 200 chez Breitling).
- **Détail** : la fiche est rendue **côté serveur** (aucun XHR de détail — capture Playwright : seul le `document` et un beacon `/services/t/l`), avec la microdonnée des sites SAP classiques (`itemprop="title"`, `itemprop="description"`), mais **sans adresse** (ni `streetAddress`, ni `addressLocality`, ni `data-careersite-propertyid`) — le lieu vient donc de la liste. `attachSuccessFactorsDescriptions` existant est réutilisé tel quel.
- **Le piège : l'ordre n'est pas stable.** Deux balayages identiques des 126 lignes de_DE de Douglas donnent 106 puis 110 ids distincts (pages qui se chevauchent et en sautent), quel que soit `sortBy` (`''`, relevancy, relevance, date, newest, title, startDate… ; « date » est le moins mauvais). Correctif : `sortBy: "date"` + **balayages répétés** d'une locale jusqu'à ce que l'union des ids atteigne `totalJobs` ou qu'un balayage n'apporte rien (max 8). Mesuré : convergence en 1–2 balayages (Douglas de_DE [104 → 126], Breitling en_GB [36 → 41]).

**Ce qui a changé dans `successfactors.ts`** (chemin HTML intact, ses tests inchangés et verts) :
- `parseRmkLocales`, `parseRmkLocation` (ISO-3 → ISO-2 pour ~40 pays, nom de pays sinon, code postal), `parseRmkDate`, `rmkJobUrl`, `normalizeRmkItem`, `fetchRmkV2Jobs` (locales × pages × balayages, dédup par id de réquisition, première locale préférée fr_FR > en_GB > en_US).
- Déclenchement : `config.rmk === true` → JSON direct ; sinon **seulement** si la page 0 de `/search/` ne rend aucun lien d'offre (un tenant non-RMK y reçoit 404/401 et garde le verdict HTML).
- `successfactors.test.ts` : +14 tests sur fixtures capturées (item Douglas de_DE, items Breitling en_GB et talent pool multi-sites, sélecteur de langue). Une fixture a attrapé un vrai bug : les liens du sélecteur sont `&amp;locale=`, la première regex `[?&]locale=` n'en voyait aucun.

**Mesures (adaptateur SUCCESSFACTORS, config `{"origin": …}` sans autre clé).**

| Tenant | Avant | Après | Exemple |
|---|---|---|---|
| Douglas `https://jobs.douglas.group` | 0 (HTML) | **130 offres \| 130 lieu \| 130 desc \| 17 s** | « Internship Marketing Strategic Campaigns (f/m/x) » @ Düsseldorf, Germany, 2026-09-02 |
| Breitling `https://careers.breitling.com` | 0 (HTML) | **41 offres \| 41 lieu \| 41 desc \| 6 s** | « Manager Machines Garnissage T0 (m/f/x) » @ La Chaux-de-Fonds, NE, CHE, 2301 (CH), 2026-09-03 |
| Puig `https://jobs.puig.com` (config actuelle) | — | **230 offres \| 230 lieu \| 230 desc \| 21 s** (chemin HTML, inchangé) | « Marketing Graduate » @ Ciudad de México, MEX, MX |

Contrôle Douglas (`g2-rmkDebug.mts`) : union RMK = **130 ids = exactement les 130 postes SuccessFactors de l'état Frontity** (0 manquant, 0 en trop) ; les 16 offres internes « behindbeauty » de careers.douglas.group ne sont pas dans SAP — seul `frontityJobs.ts` les voit (146 = 130 + 16). Breitling : union 41 = en_GB 41 (fr_FR 5 et de_DE 4 sont des traductions d'offres déjà en anglais).

**Puig n'expose PAS cet endpoint — preuve.** `careers.puig.com` n'est pas SAP : `POST /services/recruiting/v1/jobs` → **404** (HTML de la SPA), `/search/` → 404 (l'adaptateur lève `HTTP 404`), `/opportunities` → Next.js derrière un challenge Cloudflare, données via `GET https://careers.puig.com/api/search?locale=en&page=N` (12/page, `pagination.totalItems 222`, items `id,title,category,brands,place,contractType`, fiche `/en/opportunity/{id}` rendue client). `jobs.puig.com` (l'origin cataloguée) reste un SAP ancienne génération : `/search/?startrow=` sert 25 liens `/job/…/id/` par page → **230 offres** par le chemin HTML ; son `/services/recruiting/v1/jobs` répond **401** `{"error":{"code":"Error","message":"Error retrieving jobs"},"totalJobs":0}`. Les « 15 offres lues » venaient de `careers.puig.com` ; la bonne origin est `jobs.puig.com` (222 chez l'un, 230 chez l'autre : même vivier SF, la page custom filtre un peu).

Scripts : `g2-measureSF.mts` (mesure), `g2-rmkDebug.mts` (contrôle par locale vs Frontity), `g2-sniff.mts douglas-detail|breitling|puig` (captures).

---

## Reste à faire (hors périmètre lecture seule)
- Brancher les 4 adaptateurs dans `src/ats/index.ts` + `KIND_TO_ATS` (`geodirectory`, `eqwa`, `rivoli-typesense`, `frontity`) et le type `AtsType` Prisma — non touché ici, décision d'intégration à prendre.
- Cataloguer les 2 configs GENERIC (Beiersdorf, Globus) telles quelles.
- Vérifier robots.txt à la source pour chaque hôte au moment de la promotion (Globus déjà lu ; les cinq autres non lus dans ce lot).
