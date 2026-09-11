/**
 * LA CHAÎNE PUBLIQUE, VÉRIFIÉE PAR ENSEMBLES D'IDENTIFIANTS — jamais par des totaux.
 *
 * Un total identique de part et d'autre ne prouve rien : deux ensembles de 1 000 offres peuvent n'avoir aucune
 * offre en commun. Ce contrôle compare donc, pour chaque parcours :
 *
 *   BASE      l'ensemble des identifiants que la base rend sous le prédicat de sélection publique ;
 *   API       l'ensemble que `/api/jobs` rend réellement, page par page ;
 *   COMPTEUR  le `total` annoncé ;
 *   FACETTE   la valeur de facette correspondante, quand le parcours en a une ;
 *   FICHE     l'accessibilité de la fiche pour un échantillon nommé d'identifiants.
 *
 * Les écarts sont rendus par identifiant (`onlyInDatabase`, `onlyInApi`), pas par différence de compteur, pour
 * qu'une cause soit cherchable.
 *
 * L'API est interrogée sur `PUBLIC_BASE_URL` (par défaut le site de production, en LECTURE SEULE : seules des
 * requêtes GET sont émises). La base est lue par le même `DATABASE_URL` que le reste des scripts de mesure.
 *
 * usage: public-chain.mts [--out=<file.json>] [--base=<url>] [--max-pages=N]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const BASE = (arg('base') ?? 'https://modecareers.com').replace(/\/$/, '');
/** L'API pagine par 25 ; on borne le nombre de pages pour rester un contrôle borné, et on le déclare. */
const MAX_PAGES = Number(arg('max-pages') ?? 8);
const PAGE_SIZE = 25;

const p = new PrismaClient();

/**
 * L'identité de Maison, reproduite à l'IDENTIQUE de `apps/web/lib/company-identity.ts` — l'importer serait plus
 * sûr mais le workspace aggregator ne peut pas compiler un fichier hors de sa racine (`TS6059`).
 *
 * La copie est donc explicitement datée et vérifiée : nom canonique OU alias **revu** (`reviewId IS NOT NULL`,
 * sur `displayName`, jamais une colonne `alias` — celle-là n'existe pas, et l'avoir supposée m'a d'abord fait
 * écrire un prédicat qui échouait). Si le fichier web change, ce contrôle doit être mis à jour : c'est le prix
 * de la copie, et il est écrit ici plutôt que découvert plus tard.
 */
const identity = (name: string) => Prisma.sql`(
  lower(c.name) = lower(${name})
  OR c.id IN (SELECT a."companyId" FROM "CompanyAlias" a
              WHERE a."reviewId" IS NOT NULL AND lower(a."displayName") = lower(${name})))`;

type Journey = {
  name: string;
  /** Les paramètres publics, tels qu'un visiteur les enverrait. */
  query: Record<string, string>;
  /** Le prédicat SQL équivalent, écrit à partir du code de sélection et non deviné. */
  sql: Prisma.Sql;
  /** La facette à confronter, quand le parcours en filtre une. */
  facet?: { kind: string; value: string };
};

/**
 * Les parcours contrôlés. Chaque `sql` reproduit le prédicat de `searchSummary` pour ce filtre — `isFrance` pour
 * la France, `lower(countryCode)` pour les autres pays, `ILIKE` pour la ville (la colonne porte des graphies
 * mélangées), l'identité de société pour la Maison.
 */
const JOURNEYS: Journey[] = [
  // ── Périmètres géographiques ────────────────────────────────────────────────
  { name: 'monde (aucun filtre)', query: {}, sql: Prisma.sql`true` },
  { name: 'France', query: { pays: 'FR' }, sql: Prisma.sql`j."isFrance"`, facet: { kind: 'countries', value: 'FR' } },
  { name: 'pays IT', query: { pays: 'IT' }, sql: Prisma.sql`lower(j."countryCode") = 'it'`, facet: { kind: 'countries', value: 'IT' } },
  { name: 'pays US', query: { pays: 'US' }, sql: Prisma.sql`lower(j."countryCode") = 'us'`, facet: { kind: 'countries', value: 'US' } },
  { name: 'pays GB', query: { pays: 'GB' }, sql: Prisma.sql`lower(j."countryCode") = 'gb'`, facet: { kind: 'countries', value: 'GB' } },

  // ── Maisons ────────────────────────────────────────────────────────────────
  // L'identité de Maison n'est PAS une égalité de nom : elle couvre les alias et les entités fusionnées
  // (D45/D60). Le SQL doit donc reproduire ce que fait `companyIdentitySql`, alias compris.
  { name: 'maison Ulta Beauty', query: { maison: 'Ulta Beauty' }, sql: identity('Ulta Beauty'), facet: { kind: 'maisons', value: 'Ulta Beauty' } },
  { name: 'maison Sephora', query: { maison: 'Sephora' }, sql: identity('Sephora'), facet: { kind: 'maisons', value: 'Sephora' } },
  { name: 'maison Foot Locker', query: { maison: 'Foot Locker' }, sql: identity('Foot Locker'), facet: { kind: 'maisons', value: 'Foot Locker' } },

  // ── Métiers ────────────────────────────────────────────────────────────────
  { name: 'métier sales-advisor', query: { metier: 'sales-advisor' }, sql: Prisma.sql`j."occupationCode" = 'sales-advisor'`, facet: { kind: 'occupations', value: 'sales-advisor' } },
  { name: 'métier beauty-consultant', query: { metier: 'beauty-consultant' }, sql: Prisma.sql`j."occupationCode" = 'beauty-consultant'`, facet: { kind: 'occupations', value: 'beauty-consultant' } },
  /**
   * ITEM 5 — le métier NON CANONISÉ. 41 548 offres actives n'ont pas de code métier. Elles doivent rester
   * accessibles, regroupées sous une valeur explicite (`unclassified`), et surtout ne JAMAIS être versées dans
   * une facette métier à laquelle elles n'appartiennent pas.
   */
  { name: 'métier non canonisé', query: { metier: 'unclassified' }, sql: Prisma.sql`j."occupationCode" IS NULL`, facet: { kind: 'occupations', value: 'unclassified' } },

  // ── Contrats et rythmes (dimensions indépendantes, D52) ─────────────────────
  { name: 'contrat PERMANENT', query: { employmentTerm: 'PERMANENT' }, sql: Prisma.sql`j."employmentTerm" = 'PERMANENT'`, facet: { kind: 'contracts', value: 'PERMANENT' } },
  { name: 'contrat FIXED_TERM', query: { employmentTerm: 'FIXED_TERM' }, sql: Prisma.sql`j."employmentTerm" = 'FIXED_TERM'`, facet: { kind: 'contracts', value: 'FIXED_TERM' } },
  { name: 'rythme PART_TIME', query: { workTime: 'PART_TIME' }, sql: Prisma.sql`j."workTime" = 'PART_TIME'`, facet: { kind: 'workTimes', value: 'PART_TIME' } },

  // ── Secteurs (tableau de codes sur la société) ──────────────────────────────
  { name: 'secteur RETAIL', query: { secteur: 'RETAIL' }, sql: Prisma.sql`'RETAIL' = ANY(c."sectorCodes")`, facet: { kind: 'sectors', value: 'RETAIL' } },
  { name: 'secteur BEAUTY', query: { secteur: 'BEAUTY' }, sql: Prisma.sql`'BEAUTY' = ANY(c."sectorCodes")`, facet: { kind: 'sectors', value: 'BEAUTY' } },

  // ── Villes : la colonne porte des graphies mélangées, le filtre est insensible à la casse ───
  { name: 'ville Paris', query: { ville: 'Paris' }, sql: Prisma.sql`j.city ILIKE 'Paris'` },
  { name: 'ville New York', query: { ville: 'New York' }, sql: Prisma.sql`j.city ILIKE 'New York'` },

  // ── Combinaisons : c'est là que des filtres se télescopent (bug historique des trois `company:`) ───
  { name: 'France + PERMANENT', query: { pays: 'FR', employmentTerm: 'PERMANENT' }, sql: Prisma.sql`j."isFrance" AND j."employmentTerm" = 'PERMANENT'` },
  { name: 'secteur + maison + pays', query: { secteur: 'BEAUTY', maison: 'Sephora', pays: 'FR' },
    sql: Prisma.sql`'BEAUTY' = ANY(c."sectorCodes") AND ${identity('Sephora')} AND j."isFrance"` },
  { name: 'métier non canonisé + France', query: { metier: 'unclassified', pays: 'FR' }, sql: Prisma.sql`j."occupationCode" IS NULL AND j."isFrance"` },

  // ── Frontières de filtre : une valeur qui n'existe pas doit rendre 0, jamais tout ───
  { name: 'frontière : pays inexistant', query: { pays: 'ZZ' }, sql: Prisma.sql`false` },
  /**
   * Un code de secteur inconnu ne doit pas ÉLARGIR la sélection. Vérifié dans le code : `sectorSql` construit
   * `sectorCodes @> ARRAY['NOT_A_SECTOR']`, donc 0 résultat. C'est la réponse sûre — un filtre qui ne correspond
   * à rien montre rien, jamais tout. *(Ma première spécification attendait `true` ici, en supposant qu'un code
   * invalide serait ignoré : c'était mon erreur, pas un défaut du produit.)*
   */
  { name: 'frontière : secteur invalide', query: { secteur: 'NOT_A_SECTOR' }, sql: Prisma.sql`false` },
  { name: 'frontière : métier inexistant', query: { metier: 'metier-qui-nexiste-pas' }, sql: Prisma.sql`false` },
  { name: 'frontière : maison inexistante', query: { maison: 'Maison Qui N Existe Pas' }, sql: Prisma.sql`false` },

];

/**
 * POPULATIONS À CONTRÔLER AUTREMENT — champs absents, télétravail, multilocalisation.
 *
 * Ces quatre cas n'ont PAS de filtre public dédié : il n'existe pas de `?sansVille=1`. Les confronter à l'API
 * sans filtre produirait un « écart » qui ne dit rien (c'est ce qu'une première version de ce script a fait :
 * 78 932 côté API contre 3 813 côté base, un faux positif de ma conception, pas un défaut du produit).
 *
 * Ce qu'il faut vérifier à leur sujet est différent, et c'est fait plus bas : que la dimension absente ne soit
 * **rangée dans aucune valeur de facette**, et qu'une offre multi-sources apparaisse **une seule fois**.
 */
const POPULATIONS: Array<{ name: string; sql: Prisma.Sql; expectation: string }> = [
  { name: 'sans ville', sql: Prisma.sql`j.city IS NULL`,
    expectation: 'absentes de toute valeur de la facette villes' },
  { name: 'sans contrat', sql: Prisma.sql`j."employmentTerm" IS NULL`,
    expectation: 'absentes de toute valeur de la facette contrats' },
  { name: 'sans métier canonique', sql: Prisma.sql`j."occupationCode" IS NULL`,
    expectation: 'regroupées sous la valeur explicite « unclassified », jamais versées dans un vrai métier' },
  { name: 'télétravail REMOTE', sql: Prisma.sql`j."workplaceType" = 'REMOTE'`,
    expectation: 'population mesurée ; aucun filtre public dédié à ce jour' },
  { name: 'multilocalisation (plusieurs sources actives)',
    sql: Prisma.sql`(SELECT count(*) FROM "JobSource" s WHERE s."jobId" = j.id AND s."isActive") > 1`,
    expectation: 'une seule occurrence dans les résultats : une offre canonique, N représentations' },
];

/** Une page de l'API publique. */
async function apiPage(query: Record<string, string>, page: number) {
  const url = new URL(`${BASE}/api/jobs`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  if (page > 1) url.searchParams.set('page', String(page));
  const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' as never });
  if (!response.ok) throw new Error(`${url.pathname}${url.search} → HTTP ${response.status}`);
  return { url: url.toString(), body: await response.json() as any };
}

/** Tous les identifiants que l'API rend pour ce parcours, dans la limite bornée déclarée. */
async function apiIds(query: Record<string, string>) {
  const first = await apiPage(query, 1);
  const total: number = first.body.total ?? 0;
  const pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / PAGE_SIZE)));
  const ids: string[] = (first.body.jobs ?? []).map((j: any) => String(j.id));
  const facets = first.body.facets ?? null;
  for (let page = 2; page <= pages; page++) {
    const next = await apiPage(query, page);
    ids.push(...(next.body.jobs ?? []).map((j: any) => String(j.id)));
  }
  return { total, ids, facets, pagesRead: pages, pagesAvailable: Math.ceil(total / PAGE_SIZE), firstUrl: first.url };
}

try {
  const [{ at }]: any[] = await p.$queryRaw`SELECT now() AS at`;
  const results: any[] = [];

  for (const journey of JOURNEYS) {
    /**
     * La base, sous le MÊME ordre que l'API (`postedAt DESC NULLS LAST, firstSeenAt DESC, id`), pour que la
     * comparaison des premières pages soit comparable. Le total, lui, porte sur tout l'ensemble.
     */
    const [{ total: dbTotal }]: any[] = await p.$queryRaw(Prisma.sql`
      SELECT count(*)::int total FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
      WHERE j."isActive" AND ${journey.sql}`);
    const dbRows: any[] = await p.$queryRaw(Prisma.sql`
      SELECT j.id FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
      WHERE j."isActive" AND ${journey.sql}
      ORDER BY j."postedAt" DESC NULLS LAST, j."firstSeenAt" DESC, j.id
      LIMIT ${MAX_PAGES * PAGE_SIZE}`);
    const dbIds = dbRows.map((r) => String(r.id));

    let api: Awaited<ReturnType<typeof apiIds>> | null = null;
    let apiError: string | null = null;
    try { api = await apiIds(journey.query); } catch (e) { apiError = String((e as Error).message).slice(0, 200); }

    const dbSet = new Set(dbIds);
    const apiSet = new Set(api?.ids ?? []);
    const onlyInDatabase = dbIds.filter((id) => !apiSet.has(id));
    const onlyInApi = (api?.ids ?? []).filter((id) => !dbSet.has(id));

    /** La facette annoncée pour ce parcours, à confronter au compteur du même parcours. */
    let facetCount: number | null = null;
    if (journey.facet && api?.facets) {
      const rows = api.facets[journey.facet.kind] ?? [];
      facetCount = rows.find((f: any) => String(f.value) === journey.facet!.value)?.count ?? null;
    }

    results.push({
      journey: journey.name, query: journey.query, apiUrl: api?.firstUrl ?? null, apiError,
      database: { total: dbTotal, idsCompared: dbIds.length },
      api: { total: api?.total ?? null, idsCompared: api?.ids.length ?? 0,
             pagesRead: api?.pagesRead ?? 0, pagesAvailable: api?.pagesAvailable ?? 0 },
      counterMatchesDatabase: api ? api.total === dbTotal : null,
      facet: journey.facet ? { ...journey.facet, count: facetCount, matchesCounter: facetCount === (api?.total ?? null) } : null,
      /** Les écarts par IDENTIFIANT : c'est cela qu'on peut expliquer, pas une différence de compteur. */
      identifierGaps: { onlyInDatabase: onlyInDatabase.slice(0, 20), onlyInDatabaseCount: onlyInDatabase.length,
                        onlyInApi: onlyInApi.slice(0, 20), onlyInApiCount: onlyInApi.length },
      /** Une comparaison bornée ne dit rien au-delà de sa borne, et on l'écrit. */
      scope: `les ${MAX_PAGES * PAGE_SIZE} premiers identifiants de chaque côté, même ordre`,
    });
  }

  /**
   * LES POPULATIONS : une dimension absente ne doit pas être rangée dans une valeur, et une offre attestée par
   * plusieurs sources doit apparaître UNE SEULE FOIS dans les résultats.
   */
  const populations: any[] = [];
  const unfiltered = await apiPage({}, 1);
  const facetsOf = (kind: string) => (unfiltered.body.facets?.[kind] ?? []) as Array<{ value: string; count: number }>;
  const sumOf = (kind: string) => facetsOf(kind).reduce((n, f) => n + f.count, 0);
  const [{ total: activeTotal }]: any[] = await p.$queryRaw`SELECT count(*)::int total FROM "Job" WHERE "isActive"`;

  for (const pop of POPULATIONS) {
    const [{ n }]: any[] = await p.$queryRaw(Prisma.sql`
      SELECT count(*)::int n FROM "Job" j JOIN "Company" c ON c.id = j."companyId" WHERE j."isActive" AND ${pop.sql}`);
    populations.push({ population: pop.name, postings: n, expectation: pop.expectation });
  }

  /**
   * Le contrôle décisif : la somme d'une facette + la population sans valeur doit faire le total actif. S'il
   * manque, une partie des offres est rangée dans une valeur qu'elle ne porte pas ; s'il y a trop, une offre est
   * comptée deux fois. La facette villes est PLAFONNÉE à 60 valeurs, donc elle ne peut pas boucler — on le dit
   * au lieu de présenter son écart comme un défaut.
   */
  const [{ noCity }]: any[] = await p.$queryRaw`SELECT count(*)::int "noCity" FROM "Job" WHERE "isActive" AND (city IS NULL OR trim(city) = '')`;
  const [{ noTerm }]: any[] = await p.$queryRaw`SELECT count(*)::int "noTerm" FROM "Job" WHERE "isActive" AND "employmentTerm" IS NULL`;
  const [{ noOcc }]: any[] = await p.$queryRaw`SELECT count(*)::int "noOcc" FROM "Job" WHERE "isActive" AND "occupationCode" IS NULL`;

  const facetClosure = [
    { facet: 'contracts', sum: sumOf('contracts'), withoutValue: noTerm, total: activeTotal,
      closes: sumOf('contracts') + noTerm === activeTotal, capped: false },
    { facet: 'occupations', sum: sumOf('occupations'), withoutValue: 0, total: activeTotal,
      // `unclassified` EST une valeur de cette facette : la somme doit donc boucler seule.
      closes: sumOf('occupations') === activeTotal, capped: false,
      unclassifiedValue: facetsOf('occupations').find((f) => f.value === 'unclassified')?.count ?? null,
      unclassifiedInDatabase: noOcc },
    { facet: 'cities', sum: sumOf('cities'), withoutValue: noCity, total: activeTotal,
      closes: null, capped: true, note: 'facette plafonnée à 60 valeurs : la somme ne peut pas boucler, ce n\'est pas un écart' },
  ];

  /** Une offre multi-sources apparaît-elle une seule fois ? Comparé sur les identifiants rendus, pas sur un total. */
  const multi: any[] = await p.$queryRaw`
    SELECT j.id FROM "Job" j WHERE j."isActive"
      AND (SELECT count(*) FROM "JobSource" s WHERE s."jobId" = j.id AND s."isActive") > 1 LIMIT 200`;
  const multiIds = new Set(multi.map((r) => String(r.id)));
  const worldIds = (results.find((r) => r.journey === 'monde (aucun filtre)')?.identifierGaps ? null : null);
  const world = await apiIds({});
  const duplicates = world.ids.filter((id, i) => world.ids.indexOf(id) !== i);
  const multiSeen = world.ids.filter((id) => multiIds.has(id));

  const report = { at, base: BASE, boundedTo: `${MAX_PAGES} pages × ${PAGE_SIZE}`, journeys: results,
    populations, facetClosure,
    duplication: { idsReturned: world.ids.length, duplicateIds: duplicates,
      multiSourcePostingsAmongThem: multiSeen.length,
      note: 'Une offre attestée par plusieurs sources est UNE offre canonique : elle doit apparaître une seule fois.' } };
  const json = JSON.stringify(report, (_k, v) => (v instanceof Date ? v.toISOString() : v), 1);
  const out = arg('out');
  if (out) writeFileSync(out, json);
  for (const r of results) {
    console.log(`${r.journey.padEnd(24)} base=${String(r.database.total).padStart(6)} api=${String(r.api.total ?? 'ERR').padStart(6)} ` +
      `compteur=${r.counterMatchesDatabase === null ? 'n/d' : r.counterMatchesDatabase ? 'OK' : 'ÉCART'} ` +
      `facette=${r.facet ? (r.facet.matchesCounter ? 'OK' : `${r.facet.count}`) : '—'} ` +
      `ids: base-seul=${r.identifierGaps.onlyInDatabaseCount} api-seul=${r.identifierGaps.onlyInApiCount}` +
      (r.apiError ? ` · ${r.apiError}` : ''));
  }
  console.log('\n--- populations (pas de filtre public dédié) ---');
  for (const x of populations) console.log(`  ${x.population.padEnd(38)} ${String(x.postings).padStart(6)}  → ${x.expectation}`);
  console.log('\n--- bouclage des facettes ---');
  for (const f of facetClosure) console.log(`  ${f.facet.padEnd(12)} somme=${String(f.sum).padStart(6)} sans-valeur=${String(f.withoutValue).padStart(6)} total=${f.total} ` +
    (f.capped ? 'PLAFONNÉE (non bouclable)' : f.closes ? 'BOUCLE ✓' : 'NE BOUCLE PAS'));
  console.log(`\n--- doublons dans les résultats : ${report.duplication.duplicateIds.length} (dont multi-sources vus : ${report.duplication.multiSourcePostingsAmongThem})`);
} finally { await p.$disconnect(); }
