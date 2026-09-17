# Index des preuves par code

Constats initiaux du 15 septembre, avant correction. Les SHA-256 identifient les versions inspectées ; les extraits sont historiques et ne décrivent pas le code courant. Les comptes rendus de lots et la documentation d’architecture décrivent les remplacements. Les liens vers des fichiers conservés ouvrent leur version actuelle.

## Refresh : conditions de périmètre

[refresh.ts:139](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/refresh.ts:139)

`sha256 3b0f30ddbe41af553d31acae67a764dc85d9755366b977eeaa0a45e4931e956d`

```text
137:    * absente de la liste ne peut être ni désactivée ni fermée, quel que soit son statut ou son ancienneté.
138:    */
139:   const allowed = options.onlyKeys?.length ? { sourceKey: { in: options.onlyKeys } } : {};
140:   /**
141:    * Le manifeste borne les lignes par IDENTIFIANT, en plus de l'allowlist par source. Les deux se cumulent :
142:    * une ligne doit appartenir à une source autorisée ET figurer au manifeste. Un manifeste VIDE ne signifie
143:    * pas « aucune borne » — il signifie « rien à désactiver », et `in: []` le traduit exactement.
144:    */
145:   const manifested = options.manifestJobSourceIds !== undefined
146:     ? { id: { in: options.manifestJobSourceIds } } : {};
147:
148:   // Which source listings are stale AND belong to a source that is not broken.
```

## Refresh : sourceKey écrasé

[refresh.ts:156](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/refresh.ts:156)

`sha256 3b0f30ddbe41af553d31acae67a764dc85d9755366b977eeaa0a45e4931e956d`

```text
154:       ...allowed,
155:       ...manifested,
156:       ...(skipped.size ? { sourceKey: { notIn: skippedBrokenSources } } : {}),
157:     },
158:     select: { id: true, jobId: true },
159:   });
160:
161:   // Which jobs WOULD close: those where, after deactivating the stale sources
162:   // above, no active source would remain. Compute before writing anything so the
163:   // mass-closure guard can refuse first.
164:   const staleJobIds = new Set(staleSources.map((s) => s.jobId));
165:   const orphans = await prisma.job.findMany({
```

## Refresh : orphelins globaux

[refresh.ts:165](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/refresh.ts:165)

`sha256 3b0f30ddbe41af553d31acae67a764dc85d9755366b977eeaa0a45e4931e956d`

```text
163:   // mass-closure guard can refuse first.
164:   const staleJobIds = new Set(staleSources.map((s) => s.jobId));
165:   const orphans = await prisma.job.findMany({
166:     where: { isActive: true, sources: { none: { isActive: true } } }, select: { id: true },
167:   });
168:   const wouldClose: string[] = orphans.map(j => j.id);
169:   if (staleJobIds.size > 0) {
170:     for (const ids of chunk([...staleJobIds])) {
171:     const affected = await prisma.job.findMany({
172:       where: { id: { in: ids }, isActive: true },
173:       select: { id: true, sources: { select: { id: true, isActive: true } } },
174:     });
```

## Refresh : réouvertures globales

[refresh.ts:209](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/refresh.ts:209)

`sha256 3b0f30ddbe41af553d31acae67a764dc85d9755366b977eeaa0a45e4931e956d`

```text
207:   // between planning and writing must survive, and events must match committed transitions.
208:   const candidates = new Set([...staleJobIds, ...orphans.map(j => j.id)]);
209:   const revived = await prisma.job.findMany({
210:     where: { isActive: false, sources: { some: { isActive: true } } }, select: { id: true },
211:   });
212:   for (const job of revived) candidates.add(job.id);
213:   const closedSources = { count: 0 }, closedJobs = { count: 0 }, reopened = { count: 0 };
214:   let withdrawn = 0, republished = 0;
215:   for (const ids of chunk([...candidates], 100)) {
216:     const planned = await prisma.job.findMany({ where: { id: { in: ids } }, select: { id: true, companyId: true } });
217:     const companies = new Map<string, string[]>();
218:     for (const job of planned) companies.set(job.companyId, [...(companies.get(job.companyId) ?? []), job.id]);
```

## Actualisation des faits

[upsert.ts:504](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/dedup/upsert.ts:504)

`sha256 ce7c54b1f00de3faf87a91d203ec92fdad4bd6aa58db9c4be36ce63140b7d6ce`

```text
502: const SALARY_FIELDS = ['salaryMin', 'salaryMax', 'salaryCurrency', 'salaryPeriod'] as const;
503:
504: export function reattestationFields(
505:   candidate: CandidateJob,
506:   existing: Reattestable,
507:   hasAuthority: boolean,
508: ): Partial<Reattestable> {
509:   const out: Partial<Reattestable> = {};
510:   const { countryCode: country, countryIntegrity } = countryWithProvenance(candidate);
511:   const maySetGeography = hasAuthority || (!existing.countryCode && !existing.city && !existing.location);
512:   if (maySetGeography) {
513:     if (country && country !== existing.countryCode) out.countryCode = country;
```

## Job.raw promu

[upsert.ts:669](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/dedup/upsert.ts:669)

`sha256 ce7c54b1f00de3faf87a91d203ec92fdad4bd6aa58db9c4be36ce63140b7d6ce`

```text
667:     canonicalExternalId: owner.externalId,
668:     ...(hasAuthority && candidate.employmentEvidence ? {rawContract:candidate.rawContract??null,rawWorkingTime:candidate.rawWorkingTime??null,employmentEvidence:candidate.employmentEvidence as Prisma.InputJsonValue}:{}),
669:     ...(hasAuthority && candidate.raw !== undefined ? { raw: candidate.raw as Prisma.InputJsonValue } : {}),
670:   };
671:
672:   /**
673:    * L'histoire (D38) : un CHANGED par champ structurant qui change vraiment
674:    * (titre, ville, pays, société, métier — jamais la description, les dates
675:    * ou le salaire), et une RÉ-OUVERTURE quand une source re-liste une offre
676:    * que le refresh avait fermée. Avant, `isActive: true` était remis sans le
677:    * dire : la fermeture disparaissait de la base sans laisser de trace.
678:    */
```

## Salaire persistant entier

[schema.prisma:564](/Users/lmelane/Downloads/catwalks-job-aggregator/packages/db/prisma/schema.prisma:564)

`sha256 79681ae75ba4489ca412f381b7e075b08428883778909ff977d5ecf77fb6c774`

```text
562:   // Compensation, when the source publishes it (Pinpoint, WTTJ, TalentView,
563:   // Teamtailor). Stored as a band because that is how postings state it.
564:   salaryMin      Int?
565:   salaryMax      Int?
566:   salaryCurrency String?
567:   salaryPeriod   String?
568:
569:   /**
570:    * Function or department: "Retail", "Marketing"…
571:    */
572:   department   String?
573:   /**
```

## Lecture du workplace

Ancien lecteur retiré. [Lecteur actuel par source](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/facts/workplace.ts).

`sha256 94d66ed73dae0d589481b09554faab60231c26c12ab6ce3ebc392a8245720bb4`

```text
89:  * champ, « true » est ininterprétable — c'est pourquoi il est obligatoire.
90:  */
91: export function readWorkplaceField(fieldName: string, raw?: string | null): WorkplaceReading | undefined {
92:   if (raw === undefined || raw === null) return undefined;
93:   const value = upper(String(raw).trim().replace(/^\["?|"?\]$/g, ''));
94:   if (!value) return undefined;
95:
96:   const key = upper(fieldName);
97:
98:   // Un booléen ne se lit qu'avec le sens de sa clé.
99:   if (NEGATIVE_FIELD.test(value) || POSITIVE_FIELD.test(value)) {
100:     const positive = POSITIVE_FIELD.test(value);
```

## Ordre des signaux workplace

[resolve.ts:246](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/trust/resolve.ts:246)

`sha256 398acd43742109eb40a332b3eefee90b42c2290a50d4807f51680a475291244b`

```text
244:    * `locationType` (= un type de site, pas un mode de travail).
245:    */
246:   const WORKPLACE_KEYS = [
247:     'remote', 'isRemote', 'workplaceType', 'custOnsiteRemote',
248:     'telecommuting', 'on_site', 'hybrid', 'remote_work_type',
249:   ] as const;
250:   if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
251:     const payload = raw as Record<string, unknown>;
252:     for (const key of WORKPLACE_KEYS) {
253:       const v = payload[key];
254:       if (v === undefined || v === null) continue;
255:       const read = readWorkplaceField(key, Array.isArray(v) ? String(v[0] ?? '') : String(v));
```

## Déduplication

[match.ts:219](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/dedup/match.ts:219)

`sha256 8f1389bb53cbae62b7f0244652839c357f11f75bf71b3374bb010b28d76b33b9`

```text
217: }
218:
219: export function isProbableDuplicate(a: CandidateJob, b: CandidateJob): boolean {
220:   if (blockingKey(a) !== blockingKey(b)) return false;
221:   if (cannotBeSameOpening(a, b)) return false;
222:   if (normalizeJobTitle(a.title) === normalizeJobTitle(b.title)) return true;
223:   return titleSimilarity(a.title, b.title) >= TITLE_SIMILARITY_THRESHOLD;
224: }
225:
226: export type JobCluster = {
227:   /** The posting whose source ranks highest; its URL is the canonical one. */
228:   canonical: CandidateJob;
```

## Marché sans pays

[jobs.ts:190](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/api/lib/jobs.ts:190)

`sha256 6fd90570fcfcf35fc3a109cf276725bd53c74e9373431a6524166ec1e586712c`

```text
188:   // ce sont les facettes, plus précises qu'une saisie libre.
189:   const lieu = resolveLieu(one('lieu'));
190:   const countries = paysExplicite ?? (lieu?.type === 'pays' ? [lieu.country] : undefined);
191:   const cityLoose = one('ville') === undefined && lieu?.type === 'ville' ? lieu.cityLoose : undefined;
192:   const remote = lieu?.type === 'teletravail' ? true : undefined;
193:   const lieuResolu = lieu ? { type: lieu.type, libelle: lieu.libelle } : undefined;
194:
195:   return {
196:     q: one('q'),
197:     // D-426 : les dimensions à facettes sont multi-valeurs (`in` SQL) ; `ville`
198:     // et `fonction` restent mono — ce sont des valeurs d'autocomplétion uniques.
199:     occupations: many('metier'),
```

## Filtrage SQL

[job-search-query.ts:25](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/api/lib/job-search-query.ts:25)

`sha256 ad82b447546c111638b19c9c4cede10fc707ae91bace8bd18440b21fe8ff4f59`

```text
23: /** One materialized match set instead of re-running the text search for every facet. */
24: export async function searchSummary(filters: JobFilters, page: number, pageSize: number, presentation?: OptionalOccupationPresentation): Promise<SearchSummary> {
25:   const conditions: Prisma.Sql[] = [Prisma.sql`j."isActive"`];
26:
27:   /*
28:    * D-426 — une dimension cochée sur plusieurs valeurs devient UNE condition
29:    * `(a OR b OR c)`, jointe aux autres par `AND`.
30:    *
31:    * Ce fichier est le chemin SQL RÉELLEMENT emprunté par la recherche ; il
32:    * double `whereClause` (Prisma) et les deux doivent dire la même chose. Une
33:    * dimension traitée ici en égalité simple alors qu'elle est multi-valuée
34:    * ailleurs ferait diverger la liste affichée et son compte, sans erreur.
```

## Classement

[job-search-query.ts:18](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/api/lib/job-search-query.ts:18)

`sha256 ad82b447546c111638b19c9c4cede10fc707ae91bace8bd18440b21fe8ff4f59`

```text
16: // Only these fixed SQL fragments become identifiers. User values remain bound parameters.
17: const facet = (column: Prisma.Sql, limit?: number) => Prisma.sql`
18:   (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
19:    FROM (SELECT ${column}::text AS value, count(*)::int AS n FROM scoped
20:      WHERE ${column} IS NOT NULL AND ${column}::text <> '' GROUP BY ${column}
21:      ORDER BY n DESC, value ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}) f)`;
22:
23: /** One materialized match set instead of re-running the text search for every facet. */
24: export async function searchSummary(filters: JobFilters, page: number, pageSize: number, presentation?: OptionalOccupationPresentation): Promise<SearchSummary> {
25:   const conditions: Prisma.Sql[] = [Prisma.sql`j."isActive"`];
26:
27:   /*
```

## Projection de présentation

[projection.ts:4](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/api/lib/projection.ts:4)

`sha256 e2ac36d4ba8861ce94df8fe7077da63da6136b1bf849fd7a8337bdb2fcdfa59a`

```text
2: import { countryLabel } from './countries';
3: import {
4:   employmentTermLabel,
5:   engagementTypeLabel,
6:   programTypeLabel,
7:   workTimeLabel,
8:   workplaceTypeLabel,
9: } from './format';
10:
11: /**
12:  * Projections JSON de l'API de lecture (F1, phase 1).
13:  *
```

## Source brute Ba&sh

[bashTalents.ts:147](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/bashTalents.ts:147)

`sha256 cd6d3f05632fa7aa48d6da449777155f75a7bfe38506ec7caf4b64001edc9416`

```text
145:       url: link[1],
146:       postedAt: parseDayMonthYear(block.match(FIELD.posted)?.[1]),
147:       raw: { source: 'bash-talents' },
148:     });
149:   }
150:
151:   return { jobs, declaredTotal: declaredTotal ? Number(declaredTotal) : undefined };
152: }
153:
154: /** Description complète (poste + profil), date de publication réelle et expérience d'une fiche. */
155: export function parseBashDetail(html: string): { description?: string; experience?: string; postedAt?: Date } {
156:   const parts = [html.match(DETAIL.description)?.[1], html.match(DETAIL.profile)?.[1]]
```

## Source brute Taleo

[taleo.ts:72](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/adapters/taleo.ts:72)

`sha256 475f63a82a2aa16cbfe39ebfbbfc195354f61050407f9b765a0366e637b351fe`

```text
70:       location: decode(location) || undefined,
71:       url: decode(href),
72:       raw: { source: 'taleo-tbe' },
73:     });
74:   }
75:   return jobs;
76: }
77:
78: /** Le texte complet d'une page `viewRequisition`, ou undefined si l'offre est retirée. */
79: export function parseTaleoDescription(html: string): string | undefined {
80:   if (/Job Not Available|no longer available/i.test(html) && !/cwsJobDescription/i.test(html)) return undefined;
81:   const start = html.search(/<div name="cwsJobDescription"/i);
```

## Ordonnanceur courant

[ingestOrchestrator.ts:56](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/ingestOrchestrator.ts:56)

`sha256 7c14072afa39c2f979f7e71af7055a7d862031347a084b35f33299ba378bc8ed`

```text
54:  * Le pool doit garder de la marge pour les requêtes de suivi et les verrous.
55:  */
56: const SOURCE_CONCURRENCY = Number(process.env.INGEST_SOURCE_CONCURRENCY ?? 4);
57:
58: export type OrchestratorResult = {
59:   total: number;
60:   ok: number;
61:   failed: number;
62:   timedOut: number;
63:   failures: string[];
64:   /** Sources that returned degraded/broken health this run — feeds the alert. */
65:   incidents: SourceHealth[];
```

## Budget HTTP partagé en mémoire

[hostGate.ts:38](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/lib/hostGate.ts:38)

`sha256 ae6e43d2f7abb612eeba2f21315dfd7510fc74dcb3474c497f9fa35d116413b1`

```text
36: const GAP_DECAY = 0.8;
37:
38: const hosts = new Map<string, HostState>();
39:
40: function stateFor(host: string): HostState {
41:   let state = hosts.get(host);
42:   if (!state) {
43:     state = { active: 0, nextAllowedAt: 0, gapMs: BASE_GAP_MS, queue: [] };
44:     hosts.set(host, state);
45:   }
46:   return state;
47: }
```

## Contrat de retour adaptateur

[index.ts:56](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/index.ts:56)

`sha256 7b9ea6e537f5492e9fb5c5f63eab568477f7cb49d116bbf1d7fa770fed6cbb1b`

```text
54:  * as they are touched — wrapping them changes nothing they did not measure.
55:  */
56: function toResult(value: NormalizedJob[] | AdapterResult): AdapterResult {
57:   return Array.isArray(value) ? { jobs: value } : value;
58: }
59:
60: export async function fetchAtsJobs(type: AtsType, config: Record<string, unknown>): Promise<AdapterResult> {
61:   const result = await dispatch(type, config);
62:   return normalizeAdapterResult(result);
63: }
64:
65: export function normalizeAdapterResult(result: NormalizedJob[] | AdapterResult): AdapterResult {
```

## Source candidate

[sourceCandidate.ts:14](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/connectors/sourceCandidate.ts:14)

`sha256 659713529139a5e3d53ca4142f80a67fdacf66552c16e50a4fecd2ac61be7b3d`

```text
12:  * evidence pass the existing promotion gate separately. Replays cannot overwrite
13:  * operational settings or resurrect a retired source. */
14: export async function registerSourceCandidate(prisma: PrismaClient, candidate: SourceCandidate) {
15:   if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.key) || !candidate.maison.trim() || !KIND_TO_ATS[candidate.kind] ||
16:     !['EMPLOYER_DIRECT','GROUP_OFFICIAL','ATS_OFFICIAL'].includes(candidate.tier) || !Object.keys(candidate.config).length ||
17:     !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(candidate.careersDomain)) throw new Error('Invalid source candidate');
18:   const tenantKey = tenantKeyOf(candidate.kind, JSON.stringify(candidate.config), candidate.careersDomain, candidate.maison);
19:   const data = { ...candidate, tenantKey, config: candidate.config as Prisma.InputJsonValue };
20:   return prisma.$transaction(async tx => {
21:     await lockSourceWrites(tx, candidate.key, true);
22:     const previous = await tx.source.findUnique({ where: { key: candidate.key } });
23:     if (previous) {
```

## Registre marchés

[marches.ts:64](/Users/lmelane/Downloads/catwalks-job-aggregator/packages/db/marches.ts:64)

`sha256 5789002a21fd92b17c11711f83a80cb2f96cd669d99b76053a3f9c56d50bd94b`

```text
62:  * mesuré par marché, jamais sur une impression.
63:  */
64: export const SEUIL_AFFICHAGE_FACETTE = 0.2;
65:
66: /**
67:  * ── POURQUOI « CASUAL » N'EST PAS UNE DIMENSION (AUSTRALIE) ────────────────
68:  *
69:  * Bloc nommé et volontairement trouvable : la question reviendra, et la réponse
70:  * mesurée doit être plus facile à retrouver que l'intuition qui la contredit.
71:  *
72:  * L'audit défensif a proposé de créer une dimension `casual` pour l'Australie,
73:  * sur le constat que le mot apparaît dans 17,8 % des descriptions australiennes
```

## API clé absente

[cle-api.ts:57](/Users/lmelane/Downloads/catwalks-job-aggregator/apps/api/lib/cle-api.ts:57)

`sha256 4b6c893a4ee6492f76f9a2f888b92b5abf9949cb802047caf8fd085422c37f38`

```text
55: export function refuserSiCleInvalide(request: NextRequest, requestId: string): NextResponse | null {
56:   const attendue = cleAttendue();
57:   if (!attendue) {
58:     console.info(JSON.stringify({ evenement: 'api.cle', requestId, etat: 'desarme', detail: 'CATALOGUE_API_KEY absente' }));
59:     return null;
60:   }
61:   const entete = request.headers.get('authorization')?.trim() ?? '';
62:   const fournie = /^Bearer\s+(.+)$/i.exec(entete)?.[1]?.trim() ?? '';
63:   if (fournie && egalesEnTempsConstant(fournie, attendue)) return null;
64:
65:   console.info(JSON.stringify({
66:     evenement: 'api.cle',
```

## Langues déclarées

[langue.ts:48](/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-website/src/lib/langue/langue.ts:48)

`sha256 37db03df45520366e9ffb736f53916ccec3ef29c225f3de28110d912e366f1c1`

```text
46:
47: /** Les langues d'INTERFACE ouvertes. Deux pour ce lot, pas six. */
48: export const LANGUES = ["fr", "en"] as const;
49:
50: export type Langue = (typeof LANGUES)[number];
51:
52: /**
53:  * La langue servie quand rien n'est demandé ni devinable.
54:  *
55:  * `fr` et non `en` : le corpus éditorial du site est écrit en français, et
56:  * l'anglais de ce lot en est la traduction. Le repli doit pointer vers la
57:  * langue COMPLÈTE, jamais vers celle qui peut avoir des trous.
```

## Langue client cookie

[AppliquerLangue.tsx:71](/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-website/src/components/langue/AppliquerLangue.tsx:71)

`sha256 76b6e4af3969523131ceb014e28fa4ee492b1246cd4c85aab59955172bbf7367`

```text
69:       ?.slice(COOKIE_LANGUE.length + 1);
70:
71:     const langue = estLangue(brut) ? brut : LANGUE_PAR_DEFAUT;
72:     const etiquette = etiquetteLang(langue, marcheUrl);
73:     if (document.documentElement.lang !== etiquette) {
74:       document.documentElement.lang = etiquette;
75:     }
76:   }, [marche, chemin]);
77:
78:   return null;
79: }
```

## Pays globaux ajoutés aux suggestions

[api.ts:530](/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-website/src/lib/emplois/api.ts:530)

`sha256 fe4938feb3fd5523301b446e49b8db1f7c20a700473783b212ecf4f17e7ecc04`

```text
528:   if (type === "city") {
529:     if (prefixe.length >= 2 && sansAccents("Télétravail").startsWith(prefixe)) pousser("Télétravail");
530:     for (const pays of paysParPrefixe(prefixe)) pousser(pays);
531:   }
532:   for (const b of brutes) pousser(b);
533:   return propres.slice(0, 8);
534: }
535:
536: export async function suggerer(
537:   type: TypeSuggestion,
538:   q: string,
539:   requestId: string = randomUUID(),
```

## PageEmplois reste en français

[PageEmplois.tsx:16](/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-website/src/app/emplois/PageEmplois.tsx:16)

`sha256 88c13393206cf8982a680f0e6de67954f97a3e7572896e0a21e4ad520baa9d3c`

```text
14: import "./emplois.css";
15:
16: const FORMAT_NOMBRE = new Intl.NumberFormat("fr-FR");
17: /**
18:  * Audit 14/09 (H2) : chaque rendu déclenche une recherche amont. Plafond par
19:  * IP et par minute, en mémoire d'instance (limite connue, M1) : suffisant
20:  * contre une rafale d'un seul poste ; le cache Vercel (120 s) absorbe le reste.
21:  */
22: const RENDUS_PAR_MINUTE = 60;
23:
24: /**
25:  * Le titre de la page dit ce que le moteur a COMPRIS, jamais la saisie brute
```

## Ancien catalogue /offres

[page.tsx:7](/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-website/src/app/offres/page.tsx:7)

`sha256 f550c0700b390083b1e3410e94719013f5e9d6ed209b59d9d7a51b4215e86007`

```text
5: import { OffersBrowser } from "@/components/offers/OffersBrowser";
6: import { filtersToParams, FILTRES_VIDES } from "@/components/offers/offers-url";
7: import { searchJobs } from "@/lib/api/jobs";
8: import { facetteMaisons } from "@/lib/seo/pages-categories";
9: import { FilAriane } from "@/components/seo/FilAriane";
10: import { HubNavigation } from "@/components/seo/HubNavigation";
11: import { LIBELLES_OFFRES } from "@/lib/seo/titres";
12: // Styles des composants partagés (accordéons filtres + liste). Même fichier que
13: // /mes-jobs : Next dédoublonne l'import global. Dette assumée (namespace cw-mesjobs__
14: // à renommer dans un lot CSS dédié) — voir D-75.
15: import "@/app/mes-jobs/mes-jobs.css";
16: import "./offres.css";
```

## Métadonnées de fiche agrégée

[page.tsx:25](/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-website/src/app/emplois/[id]/page.tsx:25)

`sha256 b5c8487d6da6a5f258ab985c0b1dc04b502d4e7d80a8e16d302599e15449d48a`

```text
23: type Props = { params: Promise<{ id: string }>; searchParams: Promise<EmploisSearchParams> };
24:
25: export async function generateMetadata({ params }: Props): Promise<Metadata> {
26:   const { id } = await params;
27:   const r = await lireEmploi(id);
28:   if (!r.ok) return { title: "Offre d'emploi | Catwalks", robots: { index: false, follow: false } };
29:   const e = r.resultat.emploi;
30:   const fermee = r.resultat.statut === "closed";
31:   return {
32:     title: `${fermee ? "Offre fermée · " : ""}${e.title} chez ${e.company} | Catwalks`,
33:     description: e.description ? e.description.slice(0, 155).trim() : `${e.title}, ${e.company}.`,
34:     alternates: { canonical: cheminEmploi(e) },
```

## Menu accessible

[FiltreMenu.tsx:100](/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-website/src/components/emplois/FiltreMenu.tsx:100)

`sha256 675f780bfca4a0533fab8cd3b1eb887770c877a6928f8b51819d6258e895dba6`

```text
98:         className={`cw-btn -size-s cw-filtre__bouton ${actifs.length ? "-primary" : "-secondary"}`}
99:         aria-haspopup="true"
100:         aria-expanded={ouvert}
101:         aria-controls={menuId}
102:         onClick={() => (ouvert ? fermer(false) : setOuvert(true))}
103:       >
104:         <span className="cw-filtre__libelle">{libelleActif ? `${libelle} : ${libelleActif}` : libelle}</span>
105:         <svg className="cw-filtre__chevron" viewBox="0 0 12 12" aria-hidden="true">
106:           <path d="M2 4.5 6 8.5l4-4" stroke="currentColor" strokeWidth="1.2" fill="none" />
107:         </svg>
108:       </button>
109:       {/*
```

## Logo, faux positif du détecteur

[LogoMaison.tsx:40](/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-website/src/components/emplois/LogoMaison.tsx:40)

`sha256 2b5b4d13e22d9c073fcc8c016dcb5e301aebfe3971636e3e3d9de1f5db338b4e`

```text
38:     <img
39:       className="cw-logo-maison"
40:       src={`/api/emplois/logo?domain=${encodeURIComponent(domaine)}&size=${taille * 2}`}
41:       alt=""
42:       width={taille}
43:       height={taille}
44:       loading="lazy"
45:       decoding="async"
46:       onError={() => setEchec(true)}
47:     />
48:   );
49: }
```

## Page légale localisée

[page.tsx:5](/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-website/src/app/cgu/page.tsx:5)

`sha256 7c48a49434d7641e9b0b90322f9ef83305a1a29a4d4fa9c9db2717ca72be109a`

```text
3: import { Header } from "@/components/header/Header";
4: import { Footer } from "@/components/footer/Footer";
5: import { langueCourante } from "@/lib/langue/serveur";
6: import { legalDe, dateMajLocalisee } from "@/lib/langue/legal";
7: import { AvertissementLegal } from "@/components/legal/AvertissementLegal";
8: import "../legal.css";
9:
10: /**
11:  * PREMIER JET — à faire valider juridiquement avant mise en ligne (D-14).
12:  *
13:  * Décrit le service tel qu'il fonctionne réellement au 22/07/2026 : CV
14:  * obligatoire, analyse automatisée, offres au client masqué, approche directe.
```

## Journal : empreinte source

[translation-rules.mjs:141](/Users/lmelane/Desktop/catwalksmedia-system/catwalksmedia/newsroom/src/lib/translation-rules.mjs:141)

`sha256 21f83c5a133e1f2cc263d3de78ca24850d9f50fd6d2c8e001481e5e8ea198536`

```text
139:  * un anglais faux en ligne sans que rien ne le signale.
140:  */
141: export const empreinteSource = ({ title, excerpt, bodyMarkdown }) =>
142:   createHash('sha256')
143:     .update(`${title ?? ''}<NUL>${excerpt ?? ''}<NUL>${bodyMarkdown ?? ''}`)
144:     .digest('hex');
145:
146: // --- VALIDATION DE LA SORTIE DU MODELE ---------------------------------------
147: /**
148:  * Controle COMPLET d'une traduction avant ecriture. Rend la liste des motifs
149:  * de refus ; vide = acceptable. Aucune correction silencieuse ici : le
150:  * nettoyage D-319 est explicite et fait par l'appelant AVANT ce controle.
```

## Journal : délai

[translate-article.mjs:352](/Users/lmelane/Desktop/catwalksmedia-system/catwalksmedia/newsroom/src/lib/translate-article.mjs:352)

`sha256 65690f4063c4d8b7199ee98aefc0839405460a312f14f5d2a13b9d6b85b50bee`

```text
350:   });
351:   try {
352:     return await Promise.race([traduireEtEnregistrerSansPlafond(articleId, { model }), plafond]);
353:   } finally {
354:     clearTimeout(minuteur);
355:   }
356: }
357:
358: async function traduireEtEnregistrerSansPlafond(articleId, { model } = {}) {
359:   try {
360:     const rows = await queryJson(`
361:       SELECT COALESCE(jsonb_agg(a), '[]'::jsonb) FROM (
```

## Journal : publication console

[console-server.mjs:289](/Users/lmelane/Desktop/catwalksmedia-system/catwalksmedia/newsroom/src/console-server.mjs:289)

`sha256 9610b45e910ce01339cb71bf9ac4f05a35d932e877477c64449ac387528c5b68`

```text
287:   // empecher l'article francais de paraitre. L'echec est trace en base
288:   // (status FAILED + failure_reason) et rattrapable par `npm run traduire:stock`.
289:   const trad = await traduireEtEnregistrer(pub.id).catch((e) => ({ ok: false, raison: String(e.message).slice(0, 300) }));
290:   if (!trad.ok) console.error('[console] traduction EN non produite :', trad.raison);
291:
292:   await revalidateFront(pub, { slugEn: trad.ok ? trad.slug : null })
293:     .catch((e) => console.error('[console] revalidation front :', e.message));
294:   return { code: 200, ...publishResponse(pub), traduction_en: trad.ok ? { slug: trad.slug } : { echec: trad.raison } };
295: }
296:
297: /** Titres PUBLISHED des 7 derniers jours (fenetre de la gate doublon) —
298:  *  l'article en cours de publication est exclu (republication apres retrait). */
```

## Journal : reprise du stock

[traduire-stock.mjs:23](/Users/lmelane/Desktop/catwalksmedia-system/catwalksmedia/newsroom/src/traduire-stock.mjs:23)

`sha256 627dce7e4fe48d17646cb927e57e6cb42904ea184a44b231fe16aac8910ab311`

```text
21: //   node src/traduire-stock.mjs --executer           # traduit tout le reste
22: //   node src/traduire-stock.mjs --executer --max 5   # par tranches
23: //   node src/traduire-stock.mjs --executer --perimes # rejoue les PERIMES
24: import { queryJson, dbChannel } from './lib/journal-db.mjs';
25: import { num } from './lib/sql-lit.mjs';
26: import { traduireEtEnregistrer, TARGET_LANG } from './lib/translate-article.mjs';
27: import { empreinteSource } from './lib/translation-rules.mjs';
28:
29: const args = process.argv.slice(2);
30: const a = (n) => args.includes(n);
31: const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
32:
```

## Journal : contraintes

[025_article_translations.up.sql:1](/Users/lmelane/Desktop/catwalksmedia-system/catwalksmedia/newsroom/migrations/025_article_translations.up.sql:1)

`sha256 15d8daca72a7f4fd6fb5f3fd51706bb019096d52eb8d477bf58101bf3686b091`

```text
1: -- Lot 25 — TRADUCTION AUTOMATIQUE DES ARTICLES, EN ANGLAIS UNIQUEMENT
2: -- (decision CEO 2026-09-15 : « traduire automatiquement tous les articles
3: --  (en anglais uniquement pour le coup) donc EN et FR seulement »).
4: --
5: -- Le Journal est le SEUL perimetre a deux langues : FR source + EN traduit.
6: -- Aucune autre langue n'est prevue, et la contrainte CHECK ci-dessous le grave
7: -- explicitement plutot que de laisser la porte ouverte en silence.
8: --
9: -- ------------------------------------------------------------------------
10: -- POURQUOI UNE TABLE, ET NON UNE COLONNE `language` SUR journal_articles
```
