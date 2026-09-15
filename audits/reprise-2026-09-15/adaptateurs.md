# C. Catalogue par famille technique

43 kinds enregistrés dans la base. Chaque ligne de sources.csv hérite du profil de sa famille ci-dessous. Les valeurs de configuration sont volontairement exclues ; leurs noms de clés figurent dans le CSV. Les comptes représentent des JobSource actives reliées à une Job publique, donc ne doivent pas être additionnés comme des offres uniques.

Les lignes de code ci-dessous sont des preuves de mécanisme, pas une certification d’exhaustivité de chaque portail aujourd’hui. Les conditions spécifiques à chaque configuration et le dernier canAttestAbsence figurent séparément. Coût monétaire par portail : non mesuré. Fréquence visée : quotidienne ; exécution planifiée actuellement suspendue.

## altamira

Sources : 1 ; actives : 1 ; représentations publiques : 64. Dispatch : `ALTAMIRA`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [altamira.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/altamira.ts)

```typescript
25: const PAGE_SIZE_HINT = 10;
47: for (const match of html.matchAll(ROW)) {
81: raw: { source: 'altamira', team: row.team, locations },
92: for (let page = 1; page <= maxPages; page += 1) {
95: for (const row of fresh) {
```

## ashby

Sources : 1 ; actives : 1 ; représentations publiques : 83. Dispatch : `ASHBY`.

Endpoint JSON de toutes les offres, drapeau de publication et contrôle des rejets.

Code : [ashby.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/ashby.ts)

```typescript
24: for (const job of data.jobs) {
28: rejectedRows.push({ reason: 'MISSING_ID_TITLE_OR_PUBLICATION_FLAG', raw: job }); continue;
41: raw: job,
45: complete: rejectedRows.length === 0 && new Set(jobs.map(j => j.externalId)).size === jobs.length,
```

## avature

Sources : 2 ; actives : 2 ; représentations publiques : 2908. Dispatch : `AVATURE`.

Portails HTML spécifiques ; cartes/détail et variantes par employeur.

Code : [avature.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/avature.ts)

```typescript
43: for (const pattern of patterns) {
86: raw: { source: 'avature', url },
109: export function titleFromCard(raw: string, url: string): string | undefined {
142: export function parseCardDate(raw: string): Date | undefined {
162: for (const match of html.matchAll(LISTING_CARD)) {
214: for (const cell of excerptCells) {
227: raw: { source: 'avature' },
288: for (const card of html.match(PORTAL_CARD) ?? []) {
301: raw: {
340: for (const block of html.match(PORTAL_DETAIL_BLOCK) ?? []) {
374: for (const list of lists) {
380: for (let offset = 0, page = 0; page < maxPages; page += 1) {
385: for (const job of fresh) {
455: for (let page = 0; page < maxPages; page++) {
```

## bashtalents

Sources : 1 ; actives : 1 ; représentations publiques : 57. Dispatch : `BASH_TALENTS`.

Listing HTML puis détails ; modification locale de dates en cours.

Code : [bashTalents.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/bashTalents.ts)

```typescript
124: for (const block of html.split(CARD_SPLIT).slice(1)) {
147: raw: { source: 'bash-talents' },
189: raw: { ...(job.raw as object), experience: detail.experience },
```

## digitalrecruiters

Sources : 5 ; actives : 5 ; représentations publiques : 783. Dispatch : `DIGITALRECRUITERS`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [digitalrecruiters.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/digitalrecruiters.ts)

```typescript
37: const PAGE_SIZE = 100;
39: const MAX_PAGES = Number(process.env.DR_MAX_PAGES ?? 60);
98: raw: { ...primary, diffusions: diffusions.map((d) => ({ id: d.id, location: d.location, url: d.url })), locations },
166: for (const locale of locales) {
183: for (let page = 1; page <= MAX_PAGES; page++) {
195: for (const item of items) {
208: rejectedRows.push({ reason: 'MISSING_TITLE_OR_ID', raw: item,
```

## easycruit

Sources : 1 ; actives : 1 ; représentations publiques : 50. Dispatch : `EASYCRUIT`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [easycruit.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/easycruit.ts)

```typescript
30: for (const department of array<Xml>(v.Departments?.Department)) {
47: const entries:Array<{raw:Xml;id:string;url:string;version:Xml}>=[];
48: for (const row of vacancies) {
51: rejectedRows.push({reason:'INVALID_ID_TITLE_OR_NATIVE_VACANCY_URL',raw:row});continue;
53: if (seen.has(id)) {rejectedRows.push({reason:'DUPLICATE_NATIVE_ID',raw:publicVacancy(row)});continue;}
54: seen.add(id);entries.push({raw:publicVacancy(row),id,url,version});
75: raw:{listing:entry.raw,detail,detailError,detailFailurePayload,fieldEvidence:{country:{path:'Versions.Version.Region.Country',values:countries},
81: return {...job,raw:{...(job.raw as object),publicPageError}};
83: return {jobs,rejectedRows,complete:enumerationComplete(true,issues,rejectedRows),
```

## eightfold

Sources : 3 ; actives : 2 ; représentations publiques : 2776. Dispatch : `EIGHTFOLD`.

API recherche par pages de 10, maximum 300 configurable ; détails et preuve des identifiants.

Code : [eightfold.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/eightfold.ts)

```typescript
32: const PAGE_SIZE = 10;
33: const MAX_PAGES = Number(process.env.EIGHTFOLD_MAX_PAGES ?? 300);
86: for (const value of [data?.efcustomTextBrand, data?.efcustomTextHouse, data?.brand, data?.business_unit]) {
185: raw: position,
243: for (let page = 0; page < MAX_PAGES; page++) {
252: for (const position of positions) {
```

## eqwa

Sources : 1 ; actives : 1 ; représentations publiques : 321. Dispatch : `EQWA`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [eqwa.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/eqwa.ts)

```typescript
105: raw: row,
```

## fashionjobs

Sources : 1 ; actives : 0 ; représentations publiques : 0. Dispatch : `FASHIONJOBS`.

Adaptateur disponible mais source RETIRED ; ancienne rotation encore codée.

Code : [fashionjobs.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/fashionjobs.ts)

```typescript

```

## flatchr

Sources : 4 ; actives : 4 ; représentations publiques : 354. Dispatch : `FLATCHR`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [flatchr.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/flatchr.ts)

```typescript
94: raw: item,
100: complete: declaredTotal !== undefined && declaredTotal === jobs.length };
```

## generic-listing

Sources : 18 ; actives : 17 ; représentations publiques : 6233. Dispatch : `GENERIC_JSONLD`.

Sitemap, listing paginé ou RSS selon configuration ; parsing JSON-LD et preuves d’URL.

Code : [genericJsonLd.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/genericJsonLd.ts)

```typescript
69: return { jobs: await fetchRssJobs(config), complete: false };
130: for (let page = 0; page < Number(config.maxPages ?? 400); page++) {
210: for (const u of links) seen.add(u);
272: ...(publisherCount !== undefined ? [{ scope: 'publisherCount', declaredTotal: publisherCount, uniqueIds: seen.size, pages: pagesRead, complete: seen.size >= publisherCount }] : []),
273: { scope: 'listedLinks', declaredTotal: publisherCount ?? seen.size, uniqueIds: seen.size, pages: pagesRead, complete: reachedEnd && !belowCount },
311: if (parsed.length === 0) rejectedRows.push({ reason: 'LISTED_PAGE_WITHOUT_JOBPOSTING', raw: { url } });
315: rejectedRows.push({ reason: 'LISTED_PAGE_FETCH_FAILED', raw: { url, error: String(error).slice(0, 200) } });
332: scopes: [{ scope: 'shards', declaredTotal: sitemap.shards.length, uniqueIds: sitemap.shards.length - sitemap.failedShards.length, pages: sitemap.shards.length, complete: sitemap.failedShards.length === 0 },
333: { scope: 'listedUrls', declaredTotal: urls.length, uniqueIds: urls.length - fetchFailures, pages: sitemap.shards.length, complete: fetchFailures === 0 },
358: for (const job of [...direct, ...pages.flat()]) byKey.set(`${job.externalId}|${job.url}`, job);
361: return { jobs: [...byKey.values()], complete: false, truncated: links.size > 150,
```

## geodirectory

Sources : 1 ; actives : 1 ; représentations publiques : 110. Dispatch : `GEODIRECTORY`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [geodirectory.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/geodirectory.ts)

```typescript
18: const PAGE_SIZE = 100;
19: const MAX_PAGES = 40;
79: raw: post,
96: for (let page = 1; page <= MAX_PAGES; page++) {
109: for (const post of posts) {
```

## greenhouse

Sources : 86 ; actives : 63 ; représentations publiques : 2545. Dispatch : `GREENHOUSE`.

Endpoint public du board, objets source conservés ; contrat de complétude posé au dispatch.

Code : [greenhouse.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/greenhouse.ts)

```typescript
19: for (const office of job.offices ?? []) {
44: raw: job,
```

## harri

Sources : 1 ; actives : 1 ; représentations publiques : 36. Dispatch : `HARRI`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [harri.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/harri.ts)

```typescript
59: for (let page = 0; page < maxPages; page++) {
72: for (const row of rows) {
74: rejectedRows.push({ reason: 'MISSING_POSTING_ID_TITLE_OR_EMPLOYER', raw: row }); continue;
121: raw: { listing, detail, detailReadError, detailUrl, portal: { id: profile.id, name: profile.name, slug: profile.slug, url: profile.url }, portalEvidence },
124: return { jobs, declaredTotal: total, complete: terminated && issues.length === 0 && rejectedRows.length === 0, rejectedRows,
```

## icims

Sources : 3 ; actives : 2 ; représentations publiques : 1593. Dispatch : `ICIMS`.

Listing HTML, maximum 50 pages, détails enrichis séparément.

Code : [icims.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/icims.ts)

```typescript
59: for (const card of html.matchAll(JOB_CARD)) {
78: raw: { source: 'icims', reference: block.match(FIELD.reference)?.[1]?.trim() },
85: const MAX_PAGES = 50;
110: for (let page = 0; page < MAX_PAGES; page += 1) {
130: for (const job of fresh) {
156: catch (error) { return { ...job, raw: { ...(job.raw as object), detailReadError: String(error) } }; }
```

## jibe

Sources : 1 ; actives : 1 ; représentations publiques : 10290. Dispatch : `JIBE`.

API par pages de 100, maximum 200 pages.

Code : [jibe.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/jibe.ts)

```typescript
28: const PAGE_SIZE = 100;
30: const MAX_PAGES = 200;
94: for (const entry of page.jobs ?? []) {
133: raw: job,
166: for (let page = 1; page <= MAX_PAGES; page += 1) {
173: for (const job of fresh) {
```

## jobaffinity-wordpress

Sources : 2 ; actives : 2 ; représentations publiques : 978. Dispatch : `JOBAFFINITY_WORDPRESS`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [jobaffinityWordpress.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/jobaffinityWordpress.ts)

```typescript
22: export function jobaffinityApplyUrl(raw: string): string {
40: for (const r of rows) {
94: raw: { board: { url: config.listingUrl, row }, post, geographyEvidence: geo ?? null,
110: for (let i = 0; i < rows.length; i += 100) {
114: for (const p of page) posts.set(p.id, p);
156: return { jobs, declaredTotal, truncated: false, complete: true };
```

## jobylon

Sources : 1 ; actives : 1 ; représentations publiques : 31. Dispatch : `JOBYLON`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [jobylon.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/jobylon.ts)

```typescript
90: function streetAddressOf(raw: unknown): string | undefined {
93: for (const place of places) {
112: raw: { source: 'jobylon', listing, posting: posting?.raw },
```

## lever

Sources : 25 ; actives : 18 ; représentations publiques : 820. Dispatch : `LEVER`.

API paginée, limite configurable ; objets source conservés.

Code : [lever.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/lever.ts)

```typescript
27: for (let page = 0; page < maxPages; page++) {
40: for (const row of rows) {
60: raw: job,
```

## lvmh_algolia

Sources : 1 ; actives : 1 ; représentations publiques : 6433. Dispatch : `LVMH_ALGOLIA`.

API Algolia par pages de 100, plafond 120 configurable.

Code : [lvmhAlgolia.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/lvmhAlgolia.ts)

```typescript
39: const PAGE_SIZE = 100;
42: const MAX_PAGES = Number(process.env.LVMH_MAX_PAGES ?? 120);
114: for (const chunk of chunks) {
172: raw: hit,
197: for (let page = 0; page < MAX_PAGES; page++) {
222: for (const hit of hits) {
```

## magnet

Sources : 2 ; actives : 2 ; représentations publiques : 492. Dispatch : `MAGNET`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [magnet.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/magnet.ts)

```typescript
28: const PAGE_SIZE = 100;
30: const MAX_PAGES = Number(process.env.MAGNET_MAX_PAGES ?? 40);
165: raw: offer,
190: for (let page = 0; page < MAX_PAGES; page++) {
205: for (const offer of list) {
```

## oraclehcm

Sources : 2 ; actives : 2 ; représentations publiques : 1215. Dispatch : `ORACLE_HCM`.

Requisitions de 200, maximum 50 pages ; listing et détail conservés.

Code : [oraclehcm.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/oraclehcm.ts)

```typescript
28: const PAGE_SIZE = 200;
30: const MAX_PAGES = 50;
122: raw: { source: 'oraclehcm', site, list: req },
156: raw: { ...(job.raw as Record<string, unknown>), detail },
171: for (let page = 0; page < MAX_PAGES; page += 1) {
179: for (const req of fresh) {
```

## personio

Sources : 24 ; actives : 14 ; représentations publiques : 186. Dispatch : `PERSONIO`.

Flux et détail selon configuration ; réponse entière, preuve de rejets.

Code : [personio.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/personio.ts)

```typescript
46: for (const raw of list) {
80: raw: { ...(enriched.raw as object), personioDetail: detail.evidence },
85: return { ...job, raw: { ...(job.raw as object), detailReadError: String(error).slice(0,1000) } };
90: complete: rejectedRows.length === 0 && new Set(jobs.map(job=>job.externalId)).size === list.length,
```

## phenom

Sources : 3 ; actives : 3 ; représentations publiques : 5299. Dispatch : `PHENOM`.

API par pages de 100, maximum 80 configurable ; variantes de langue.

Code : [phenom.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/phenom.ts)

```typescript
31: const PAGE_SIZE = 100;
33: const MAX_PAGES = Number(process.env.PHENOM_MAX_PAGES ?? 80);
139: raw: data,
171: for (let page = 1; page <= MAX_PAGES; page++) {
180: for (const entry of batch) {
233: pageEvidence, scopes: [{ scope: 'jobs', declaredTotal: declaredTotal ?? -1, uniqueIds: jobs.length, pages, complete }, { scope: 'languageVariants', declaredTotal: languageVariants, uniqueIds: languageVariants, pages, complete: true }, { scope: 'entriesWithoutData', declaredTotal: withoutData, uniqueIds: withoutData, pages, complete: true }] } };
240: export function phenomCoordinates(raw: unknown): { latitude: number; longitude: number } | null {
360: raw: data as unknown as Record<string, unknown>,
389: for (let page = 0; page < MAX_PAGES; page++) {
402: for (const entry of batch) {
479: for (const node of postings) {
```

## radancy

Sources : 1 ; actives : 1 ; représentations publiques : 54. Dispatch : `GENERIC_JSONLD`.

Sitemap, listing paginé ou RSS selon configuration ; parsing JSON-LD et preuves d’URL.

Code : [genericJsonLd.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/genericJsonLd.ts)

```typescript
69: return { jobs: await fetchRssJobs(config), complete: false };
130: for (let page = 0; page < Number(config.maxPages ?? 400); page++) {
210: for (const u of links) seen.add(u);
272: ...(publisherCount !== undefined ? [{ scope: 'publisherCount', declaredTotal: publisherCount, uniqueIds: seen.size, pages: pagesRead, complete: seen.size >= publisherCount }] : []),
273: { scope: 'listedLinks', declaredTotal: publisherCount ?? seen.size, uniqueIds: seen.size, pages: pagesRead, complete: reachedEnd && !belowCount },
311: if (parsed.length === 0) rejectedRows.push({ reason: 'LISTED_PAGE_WITHOUT_JOBPOSTING', raw: { url } });
315: rejectedRows.push({ reason: 'LISTED_PAGE_FETCH_FAILED', raw: { url, error: String(error).slice(0, 200) } });
332: scopes: [{ scope: 'shards', declaredTotal: sitemap.shards.length, uniqueIds: sitemap.shards.length - sitemap.failedShards.length, pages: sitemap.shards.length, complete: sitemap.failedShards.length === 0 },
333: { scope: 'listedUrls', declaredTotal: urls.length, uniqueIds: urls.length - fetchFailures, pages: sitemap.shards.length, complete: fetchFailures === 0 },
358: for (const job of [...direct, ...pages.flat()]) byKey.set(`${job.externalId}|${job.url}`, job);
361: return { jobs: [...byKey.values()], complete: false, truncated: links.size > 150,
```

## recruitee

Sources : 22 ; actives : 22 ; représentations publiques : 639. Dispatch : `RECRUITEE`.

Endpoint JSON des offres, réponse entière, rejets explicites.

Code : [recruitee.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/recruitee.ts)

```typescript
28: rejectedRows.push({ reason: 'MISSING_OR_INVALID_ID_OR_TITLE', raw: job }); return false;
42: raw: job,
46: complete: rejectedRows.length === 0 && new Set(jobs.map(job=>job.externalId)).size === jobs.length,
```

## rituals

Sources : 1 ; actives : 1 ; représentations publiques : 1245. Dispatch : `RITUALS`.

Union des langues, pagination bornée à 100 ; objets source conservés.

Code : [rituals.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/rituals.ts)

```typescript
34: const MAX_PAGES = 100;
124: raw: source,
145: for (let guard = 0; guard < MAX_PAGES; guard += 1) {
172: for (const language of languages) {
178: for (const source of sources) {
184: scopes.push({ scope: `locale:${language}`, declaredTotal: total ?? -1, uniqueIds: seen.size - before, pages: 1, complete: localeComplete });
```

## smartrecruiters-whitelabel

Sources : 46 ; actives : 45 ; représentations publiques : 5860. Dispatch : `SMARTRECRUITERS`.

API de postings, offsets de 100, plafond 20 000 ; détail selon mode.

Code : [smartrecruiters.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/smartrecruiters.ts)

```typescript
64: raw: job,
104: for (let offset = 0; offset < 20_000; offset += 100) {
106: for (const job of page.content ?? []) out.push(parseSmartRecruitersPosting(job, company, typeof config.employerField === 'string' ? config.employerField : undefined));
```

## successfactors

Sources : 34 ; actives : 31 ; représentations publiques : 4230. Dispatch : `SUCCESSFACTORS`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [successfactors.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/successfactors.ts)

```typescript
32: const MAX_PAGES = Number(process.env.SF_MAX_PAGES ?? 10000);
67: for (const match of html.matchAll(JOB_LINK)) {
91: for (const part of parts) {
154: for (const match of html.matchAll(/(?:[?&]|&amp;)locale=([a-z]{2}_[A-Z]{2})/g)) found.add(match[1]);
171: export function parseRmkLocation(raw: string): { location?: string; city?: string; country?: string; postalCode?: string } {
182: for (const part of parts.slice(1)) {
260: raw: { ...item, locale, source: 'successfactors-rmk-v2', rmkDateEvidence: {
325: for (const locale of locales) {
329: for (let sweep = 0; sweep < RMK_MAX_SWEEPS; sweep++) {
331: for (let page = 0; page < RMK_MAX_PAGES; page++) {
339: for (const row of records) {
341: if (!job) { rejectedRows.push({ reason: `INVALID_RMK_ROW:${locale}`, raw: row }); continue; }
375: for (const script of scripts) {
403: return finish({ ...result, complete: result.complete && discovery.issues.length === 0,
```

## swatchgroup

Sources : 1 ; actives : 1 ; représentations publiques : 293. Dispatch : `SWATCH_GROUP`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [swatchgroup.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/swatchgroup.ts)

```typescript
36: const MAX_PAGES = 60;
213: for (const [re, brand] of BRAND_IN_TITLE) if (re.test(title)) return brand;
254: raw: { source: 'swatchgroup', legalEntity: raw?.hiringOrganization?.name, logo, applyUrl, jsonLd: posting?.raw },
267: for (let page = 0; page < maxPages; page += 1) {
274: for (const link of fresh) {
299: if (!job) rejectedRows.push({ reason: 'DETAIL_UNPARSED', raw: { url } });
303: rejectedRows.push({ reason: 'DETAIL_FETCH_FAILED', raw: { url, error: String(error).slice(0, 200) } });
318: scopes: [{ scope: 'links', declaredTotal: links.length, uniqueIds: links.length, pages: pagesRead, complete: termination === 'REPEATED_PAGE' }, { scope: 'details', declaredTotal: links.length, uniqueIds: links.length - rejectedRows.length, pages: links.length, complete: rejectedRows.length === 0 }], pageEvidence } };
```

## talentfunnel

Sources : 1 ; actives : 1 ; représentations publiques : 153. Dispatch : `TALENT_FUNNEL`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [talentFunnel.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/talentFunnel.ts)

```typescript
32: const PAGE_SIZE = 500;
33: const MAX_PAGES = 40;
162: raw: { vacancy, detail },
176: for (let page = 0; page < MAX_PAGES; page += 1) {
```

## talentrecruiter

Sources : 1 ; actives : 1 ; représentations publiques : 17. Dispatch : `TALENT_RECRUITER`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [talentRecruiter.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/talentRecruiter.ts)

```typescript
57: for (let page=0; page<maxPages; page++) {
68: for (const p of data.Items) {
83: rejectedRows.push({reason:'INVALID_POSTING_ID_TITLE_EMPLOYER_OR_URL',raw:p ? publicPosition(p) : p,
93: } catch { rejectedRows.push({reason:'POSTING_URL_IDENTITY_MISMATCH',raw:publicPosition(p),canonicalId:String(p.Id)}); continue; }
121: for (const el of $('iframe[src]').toArray()) {
145: raw:{position:p,mapAddress,detailError,publicationPath:'position.Published',
150: return {jobs,rejectedRows,declaredTotal:total,complete:enumerationComplete(terminated,issues,rejectedRows),
```

## talentsoft

Sources : 7 ; actives : 7 ; représentations publiques : 353. Dispatch : `TALENTSOFT`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [talentsoft.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/talentsoft.ts)

```typescript
121: raw: item as Record<string, unknown>,
148: for (const [i, match] of matches.entries()) {
187: raw: { path },
210: for (const item of list) {
233: for (let page = 1; page <= maxPages; page++) {
258: for (const job of cards) {
282: return rss ? { ...job, ...rss, url: job.url, location: rss.location ?? job.location, raw: { ...(job.raw as object), rss: rss.raw } } : job;
284: for (const [id, job] of byId) {
290: else rejectedRows.push({ reason: 'RSS_ITEM_LINK_OFF_BOARD_AND_ABSENT_FROM_LISTING', raw: job.raw });
315: scopes: [{ scope: 'listing', declaredTotal: declaredTotal ?? -1, uniqueIds: seenListing.size, pages, complete }, { scope: 'rss', declaredTotal: byId.size, uniqueIds: byId.size, pages: 1, complete: true }],
```

## talentview

Sources : 4 ; actives : 4 ; représentations publiques : 80. Dispatch : `TALENTVIEW`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [talentview.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/talentview.ts)

```typescript
125: raw: campaign,
165: for (const websiteId of websiteIds) {
168: for (let page = 1; page <= maxPages; page++) {
176: for (const campaign of campaigns) {
197: const result = { jobs, truncated, complete: complete && !truncated };
225: raw: { ...(job.raw as object), detail },
```

## taleo

Sources : 1 ; actives : 1 ; représentations publiques : 76. Dispatch : `TALEO`.

Listing HTML et cookie de session ; sections, pages de 10, plafond 100.

Code : [taleo.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/taleo.ts)

```typescript
34: const PAGE_SIZE = 10;
36: const MAX_PAGES = 100;
63: for (const row of html.matchAll(RESULT_ROW)) {
72: raw: { source: 'taleo-tbe' },
118: for (let page = 1; page < MAX_PAGES && cookie; page += 1) {
123: for (const job of fresh) {
139: for (const cws of sections) {
140: for (const job of await readSection(origin, org, cws)) {
```

## teamtailor

Sources : 125 ; actives : 113 ; représentations publiques : 5355. Dispatch : `TEAMTAILOR`.

Feed JSON paginé next_url ; fin explicite, détails JobPosting enrichis.

Code : [teamtailor.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/teamtailor.ts)

```typescript
21: const PAGE_SIZE = 100;
23: const MAX_PAGES = Number(process.env.TEAMTAILOR_MAX_PAGES ?? 40);
111: raw: item,
135: for (let page = 0; page < maxPages; page++) {
147: for (const item of feed.items) {
155: if (feed.next_url === undefined || feed.next_url === null) return { jobs, complete: true, truncated: false };
167: return { jobs, complete: false, truncated: true };
```

## typesense

Sources : 1 ; actives : 1 ; représentations publiques : 47. Dispatch : `TYPESENSE`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [rivoliTypesense.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/rivoliTypesense.ts)

```typescript
23: const MAX_PAGES = 20;
50: for (const doc of docs) {
77: raw: doc,
95: for (let page = 1; page <= MAX_PAGES; page++) {
```

## volcanic

Sources : 1 ; actives : 1 ; représentations publiques : 31. Dispatch : `VOLCANIC`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [volcanic.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/volcanic.ts)

```typescript
20: const MAX_PAGES = 500;
60: for (const job of page.jobs ?? []) {
80: raw: job,
94: for (let page = 1; page <= MAX_PAGES; page += 1) {
99: for (const job of fresh) {
111: catch (error) { return { ...job, raw: { ...(job.raw as object), detailReadError: String(error) } }; }
```

## wordpress

Sources : 1 ; actives : 1 ; représentations publiques : 478. Dispatch : `WORDPRESS`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [wordpress.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/wordpress.ts)

```typescript
19: const PAGE_SIZE = 100;
20: const MAX_PAGES = 40;
46: for (let page = 1; page <= MAX_PAGES; page++) {
57: for (const post of posts) {
68: raw: post,
```

## workable

Sources : 4 ; actives : 4 ; représentations publiques : 280. Dispatch : `WORKABLE`.

Mécanisme spécifique : boucles, bornes et stockage ci-dessous ; validation native à refaire par source avant promotion.

Code : [workable.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/workable.ts)

```typescript
55: rejectedRows.push({ reason: 'MISSING_OR_INVALID_ID_OR_TITLE', raw: job }); return false;
74: raw: job,
89: for (; pages < 10000;) {
100: for (const row of page.results) {
102: rejectedRows.push({ reason: 'INVALID_LISTING_ROW', raw: row }); continue;
118: for (const row of listed.values()) if (!widgetIds.has(row.shortcode)) {
126: raw: { listing: row, detailReadError: 'ABSENT_FROM_DETAIL_WIDGET' },
134: for (const job of jobs) representations.set(job.externalId, [...(representations.get(job.externalId) ?? []), job]);
143: return { ...chosen, raw: { ...(chosen.raw as object),
150: complete: terminal === 'CURSOR_EXHAUSTED' && stableTotal && sameIds && listed.size === declaredTotal && rejectedRows.length === 0 && !conflictingRepresentations,
```

## workday

Sources : 54 ; actives : 54 ; représentations publiques : 19711. Dispatch : `WORKDAY`.

CXS, offsets de 20, partitions/facettes et balayages de rattrapage, détails séparés.

Code : [workday.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/workday.ts)

```typescript
91: fresh: number; termination: string; complete: boolean;
135: raw: job,
148: raw: { ...job, locationPrefix: attributed.prefix },
159: raw: { ...job, facet: board.partition },
196: for (let offset = 0; offset < 5000; offset += 20) {
205: for (const job of postings) {
218: shared.rejectedRows.push({ reason: 'ROW_WITHOUT_EXTERNAL_PATH', raw: job });
258: for (let offset = 10, sweepPages = 0; offset < total && local.size + localPathless.size < total && sweepPages < 250; offset += 20, sweepPages += 1) {
264: for (const job of postings) {
323: for (const board of boards) results.push(await enumerateBoard(shared, board));
355: const boardScopes: Scope[] = results.map((r) => ({ scope: r.scope, declaredTotal: r.scope === 'jobs:unpartitioned' ? r.fresh : r.total || -1, uniqueIds: r.scope === 'jobs:unpartitioned' ? r.fresh : r.uniqueIds, pages: r.pages, complete: r.complete }));
477: if (!info) return { ...job, raw: { ...(job.raw as Record<string, unknown>), detail }, publicationHold: 'WORKDAY_DETAIL_SCHEMA_INVALID' };
497: raw: { ...(job.raw as Record<string, unknown>), detail },
512: raw: { ...(job.raw as Record<string, unknown>), detail },
```

## wttj

Sources : 40 ; actives : 1 ; représentations publiques : 766. Dispatch : `WTTJ`.

Algolia paginé ; mode sectoriel découvre les organisations puis joint leurs résultats.

Code : [wttj.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/wttj.ts)

```typescript
45: const PAGE_SIZE = 100;
231: raw: hit,
246: for (let page = 0; ; page++) {
261: for (const hit of hits) {
```

## wttj-sector

Sources : 1 ; actives : 1 ; représentations publiques : 2002. Dispatch : `WTTJ`.

Algolia paginé ; mode sectoriel découvre les organisations puis joint leurs résultats.

Code : [wttjSector.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/wttjSector.ts)

```typescript
87: for (const country of Object.keys(whole.facets?.['offices.country_code'] ?? {})) {
96: for (const slug of partial) union.add(slug);
129: for (const slug of extra) found.add(slug);
149: for (const result of perOrganization) {
152: for (const job of result.jobs) {
```

Code : [wttj.ts](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/wttj.ts)

```typescript
45: const PAGE_SIZE = 100;
231: raw: hit,
246: for (let page = 0; ; page++) {
261: for (const hit of hits) {
```
