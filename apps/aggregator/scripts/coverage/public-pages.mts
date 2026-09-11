/**
 * LES FICHES, LE RENDU ET LE BALISAGE — vérifiés page par page sur la production, en LECTURE SEULE.
 *
 * Trois questions sont tenues SÉPARÉES, parce que les confondre est la faute la plus facile ici :
 *
 *   VISIBILITÉ sur Mode Careers      la fiche est-elle servie, et avec quel statut HTTP ?
 *   ÉLIGIBILITÉ au balisage          un JSON-LD `JobPosting` est-il émis, et le mérite-t-elle ?
 *   PRÉSENCE possible dans Google    ce que le balisage AUTORISE — jamais ce qu'on constate, qu'on ne mesure pas
 *                                    d'ici (aucune requête à Google n'est faite, et aucune ne le prouverait).
 *
 * Une offre sans date de publication réelle est **visible sans balisage** : c'est voulu. On n'invente jamais une
 * date pour la rendre éligible.
 *
 * Les identifiants contrôlés sont choisis par ÉTAT (active, fermée, retirée, fusionnée, sans date, sans
 * description, avec HTML dans la description…), nommés dans la sortie, et le contrôle est **borné** : il ne
 * prétend pas à l'exhaustivité.
 *
 * usage: public-pages.mts [--out=<file.json>] [--base=<url>] [--per-state=N]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const BASE = (arg('base') ?? 'https://modecareers.com').replace(/\/$/, '');
const PER_STATE = Number(arg('per-state') ?? 3);

const p = new PrismaClient();

/** Les états de fiche à contrôler, avec le prédicat qui les définit et l'attente pour chacun. */
const STATES: Array<{ state: string; sql: Prisma.Sql; expectHttp: number[]; expectSchema: 'YES' | 'NO' | 'EITHER'; why: string }> = [
  { state: 'active avec date', sql: Prisma.sql`j."isActive" AND j."postedAt" IS NOT NULL`, expectHttp: [200], expectSchema: 'YES',
    why: 'visible et éligible : une vraie date de publication existe' },
  { state: 'active SANS date', sql: Prisma.sql`j."isActive" AND j."postedAt" IS NULL`, expectHttp: [200], expectSchema: 'NO',
    why: 'visible mais NON éligible : aucune date réelle, et on n\'en invente pas' },
  /**
   * Corrigé le 2026-09-11 : une offre sans description complète est **visible sans balisage**. La version
   * précédente acceptait `EITHER` en considérant que « le balisage dépend de la date, pas de la description » —
   * c'était l'erreur même que ce bloc corrige.
   */
  { state: 'datée mais description incomplète', sql: Prisma.sql`j."isActive" AND j."postedAt" IS NOT NULL AND length(btrim(coalesce(j.description, ''))) < 100`,
    expectHttp: [200], expectSchema: 'NO',
    why: 'visible, AUCUN JobPosting : une description incomplète ne mérite pas de balisage, même datée' },
  { state: 'active, échéance dépassée', sql: Prisma.sql`j."isActive" AND j."validThrough" IS NOT NULL AND j."validThrough" < now()`,
    expectHttp: [200], expectSchema: 'NO',
    why: 'visible si voulu, AUCUN JobPosting : une échéance passée annonce un poste clos. Date de la source conservée telle quelle' },
  { state: 'multilocalisation (plusieurs LIEUX)', sql: Prisma.sql`j."isActive" AND j.location LIKE '%;%'`,
    expectHttp: [200], expectSchema: 'EITHER',
    why: 'un jobLocation par lieu réellement énuméré, cohérent avec la page — et jamais l\'agrégat trompeur de la colonne city' },
  { state: 'télétravail total (REMOTE)', sql: Prisma.sql`j."isActive" AND j."workplaceType" = 'REMOTE'`,
    expectHttp: [200], expectSchema: 'EITHER',
    why: 'jobLocationType TELECOMMUTE, et applicantLocationRequirements quand la restriction est connue' },
  { state: 'fermée (closedAt)', sql: Prisma.sql`NOT j."isActive" AND j."closedAt" IS NOT NULL`, expectHttp: [410], expectSchema: 'NO',
    why: '410 Gone + noindex, et AUCUN JobPosting : baliser une offre fermée est trompeur' },
  { state: 'retirée (withdrawnAt)', sql: Prisma.sql`NOT j."isActive" AND j."withdrawnAt" IS NOT NULL`, expectHttp: [410], expectSchema: 'NO',
    why: 'retrait administratif : la page sort de l\'index, sans prétendre à une fermeture employeur' },
  { state: 'fusionnée / redirigée', sql: Prisma.sql`j."mergedIntoId" IS NOT NULL`, expectHttp: [200, 301, 302, 308, 410], expectSchema: 'EITHER',
    why: 'l\'identifiant doit mener à l\'offre survivante, jamais à une page morte sans explication' },
  // MULTI-SOURCES ≠ multilocalisation : ici on compte des `JobSource`, pas des lieux.
  { state: 'multi-sources (plusieurs JobSource)', sql: Prisma.sql`j."isActive" AND (SELECT count(*) FROM "JobSource" s WHERE s."jobId" = j.id AND s."isActive") > 1`,
    expectHttp: [200], expectSchema: 'EITHER', why: 'une offre canonique : une seule fiche, un seul lien canonique' },
  { state: 'description avec balisage HTML', sql: Prisma.sql`j."isActive" AND j.description ~ '<[a-zA-Z/]'`, expectHttp: [200], expectSchema: 'EITHER',
    why: 'le HTML d\'une source externe ne doit jamais être rendu comme du balisage actif' },
];

/**
 * Ce qui, dans le CONTENU EXTERNE RENDU, trahirait un rendu non sûr.
 *
 * Deux faux positifs à éviter, rencontrés en écrivant ce contrôle :
 *   · les `<script>` de Next.js sont les bundles du framework, pas une injection — chercher « un script dans la
 *     page » faisait échouer 24 fiches sur 24 et n'aurait rien appris ;
 *   · `</script` apparaît légitimement à chaque fermeture de balise.
 *
 * On n'inspecte donc PAS la page entière, mais la zone où le texte de la source est rendu, et on y cherche du
 * balisage ACTIF. Un `&lt;script&gt;` échappé n'est pas dangereux : c'est précisément la preuve que l'échappement
 * fonctionne.
 */
const DANGEROUS: Array<{ name: string; re: RegExp }> = [
  { name: 'script actif dans la description', re: /<script/i },
  { name: 'iframe dans la description', re: /<iframe/i },
  { name: 'gestionnaire d\'événement en ligne', re: /\son(?:error|load|click|mouseover|focus)\s*=\s*["']/i },
  { name: 'URL javascript:', re: /(?:href|src)\s*=\s*["']\s*javascript:/i },
  { name: 'balise object/embed', re: /<(?:object|embed)\b/i },
  { name: 'formulaire injecté', re: /<form\b/i },
];

/**
 * Le JSON-LD doit être échappé pour ne pas pouvoir SORTIR de son `<script>` : une description contenant
 * `</script>` casserait le bloc et injecterait du HTML dans la page. On vérifie que la séquence n'apparaît pas
 * telle quelle À L'INTÉRIEUR d'un bloc JSON-LD.
 */
const JSONLD_BREAKOUT = /<\/script/i;

const offerPath = (id: string) => `/offre/${id}`;

async function inspect(id: string) {
  /**
   * La redirection est SUIVIE. Un identifiant nu redirige en 308 vers l'URL canonique porteuse du slug — c'est le
   * comportement SEO voulu, pas un défaut. S'arrêter au 308 (`redirect: 'manual'`) faisait inspecter une page
   * vide et rendait « aucune fiche ne porte de balisage », ce qui était faux.
   */
  const firstHop = await fetch(`${BASE}${offerPath(id)}`, { redirect: 'manual', cache: 'no-store' as never });
  const redirectedTo = firstHop.headers.get('location');
  const response = [301, 302, 307, 308].includes(firstHop.status)
    ? await fetch(new URL(redirectedTo ?? '', BASE), { cache: 'no-store' as never })
    : firstHop;
  const status = response.status;
  const location = redirectedTo;
  const robots = response.headers.get('x-robots-tag') ?? firstHop.headers.get('x-robots-tag');
  const html = status === 204 || status === 304 ? '' : await response.text();

  /** Le JSON-LD est extrait tel qu'il est servi : on lit ce que le crawler lira, pas ce que le code prétend. */
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => { try { return JSON.parse(m[1]!); } catch { return { __unparsable: m[1]!.slice(0, 120) }; } });
  const flat = blocks.flatMap((b: any) => (Array.isArray(b) ? b : b?.['@graph'] ?? [b]));
  const posting = flat.find((b: any) => b?.['@type'] === 'JobPosting') ?? null;

  /**
   * Le balisage doit correspondre à la page VISIBLE. On vérifie que le titre annoncé dans le JSON-LD apparaît
   * bien dans le HTML rendu : un balisage qui décrit autre chose que la page est précisément ce que Google
   * sanctionne.
   */
  const visibleTitle = posting?.title ? html.includes(String(posting.title).slice(0, 40)) : null;

  /**
   * La zone de contenu externe : tout ce qui suit le premier bundle du framework est du rendu applicatif. On
   * cible la description telle qu'elle est servie — le JSON-LD la porte aussi, et c'est là qu'un échappement
   * raté se verrait.
   */
  const jsonLdRaw = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!);
  const description = String(posting?.description ?? '');
  const externalContent = [description, ...jsonLdRaw].join('\n');
  const jsonLdBreakout = jsonLdRaw.some((block) => JSONLD_BREAKOUT.test(block));

  return {
    redirectedTo,
    jsonLdBreakout,
    status, location, robots,
    hasJobPosting: Boolean(posting),
    unparsableBlocks: flat.filter((b: any) => b?.__unparsable).length,
    schema: posting ? {
      datePosted: posting.datePosted ?? null, validThrough: posting.validThrough ?? null,
      hasTitle: Boolean(posting.title), hasDescription: Boolean(posting.description),
      hasHiringOrganization: Boolean(posting.hiringOrganization?.name),
      hasJobLocation: Boolean(posting.jobLocation), directApply: posting.directApply ?? null,
      /** Scénarios 3 et 4 : la forme du lieu, telle qu'elle est servie. */
      jobLocationCount: Array.isArray(posting.jobLocation) ? posting.jobLocation.length : posting.jobLocation ? 1 : 0,
      jobLocationLocalities: (Array.isArray(posting.jobLocation) ? posting.jobLocation : posting.jobLocation ? [posting.jobLocation] : [])
        .map((pl: any) => pl?.address?.addressLocality ?? null),
      jobLocationType: posting.jobLocationType ?? null,
      applicantLocationRequirements: posting.applicantLocationRequirements ?? null,
      employmentType: posting.employmentType ?? null, identifier: Boolean(posting.identifier),
      titleVisibleOnPage: visibleTitle,
    } : null,
    dangerous: [...DANGEROUS.filter((d) => d.re.test(externalContent)).map((d) => d.name),
                ...(jsonLdBreakout ? ['JSON-LD non échappé : sortie de bloc possible'] : [])],
    bytes: html.length,
  };
}

try {
  const [{ at }]: any[] = await p.$queryRaw`SELECT now() AS at`;
  const results: any[] = [];

  for (const state of STATES) {
    const rows: any[] = await p.$queryRaw(Prisma.sql`
      SELECT j.id, j."postedAt", j."validThrough", j."closedAt", j."withdrawnAt", j."mergedIntoId",
             (j.description IS NOT NULL AND j.description <> '') AS has_description
      FROM "Job" j WHERE ${state.sql} ORDER BY j.id LIMIT ${PER_STATE}`);
    const checks: any[] = [];
    for (const row of rows) {
      const page = await inspect(String(row.id));
      const httpOk = state.expectHttp.includes(page.status);
      const schemaOk = state.expectSchema === 'EITHER' ? true
        : state.expectSchema === 'YES' ? page.hasJobPosting : !page.hasJobPosting;
      /** Le balisage ne doit JAMAIS porter une date que la base ne contient pas. */
      const dateInvented = Boolean(page.schema?.datePosted) && !row.postedAt;
      const expiryInvented = Boolean(page.schema?.validThrough) && !row.validThrough;
      checks.push({
        id: String(row.id), databasePostedAt: row.postedAt, databaseValidThrough: row.validThrough,
        ...page, httpOk, schemaOk, dateInvented, expiryInvented,
        verdict: httpOk && schemaOk && !dateInvented && !expiryInvented && page.dangerous.length === 0 && page.unparsableBlocks === 0 ? 'PASS' : 'FAIL',
      });
    }
    results.push({ state: state.state, expectation: state.why, expectHttp: state.expectHttp,
      expectSchema: state.expectSchema, sampled: checks.length, checks });
  }

  /**
   * LES QUATRE MESURES, NOMMÉES POUR CE QU'ELLES SONT (corrigé le 2026-09-11).
   *
   * La version précédente appelait « éligible au balisage » le compte des offres actives ayant une `postedAt`
   * — 77 482. C'était faux : la date n'est qu'UNE des conditions requises. Une offre sans description, sans lieu
   * exploitable ou dont l'échéance est dépassée n'est pas éligible, même datée.
   *
   *   visibleOnModeCareers     la page est servie
   *   markupEmitted            un JobPosting est réellement émis
   *   googleEligible           toutes les conditions requises sont réunies
   *   googleIneligibleByReason le détail des refus, par motif ET par identifiants
   *
   * Les conditions sont celles de `markupIneligibility` (apps/web/lib/job-posting-schema.ts), reproduites en SQL
   * pour compter à l'échelle du catalogue — et le contrôle par fiche ci-dessus vérifie que le rendu réel s'y
   * conforme, ce qui protège contre une dérive entre les deux expressions de la règle.
   */
  const [counts]: any[] = await p.$queryRaw`
    SELECT count(*) FILTER (WHERE "isActive")::int visible_on_mode_careers,
           count(*) FILTER (WHERE "isActive"
             AND "opportunityType" IS DISTINCT FROM 'OPEN_APPLICATION'
             AND "postedAt" IS NOT NULL
             AND btrim(coalesce(title, '')) <> ''
             AND length(btrim(coalesce(description, ''))) >= 100
             AND btrim(coalesce((SELECT c.name FROM "Company" c WHERE c.id = "Job"."companyId"), '')) <> ''
             AND (btrim(coalesce(city, '')) <> '' OR "countryCode" IS NOT NULL)
             AND ("validThrough" IS NULL OR "validThrough" >= now())
             AND url LIKE 'http%')::int google_eligible
    FROM "Job"`;

  /** Les motifs de refus, avec leurs identifiants : un chiffre sans identifiants n'est pas cherchable. */
  const reasons: any[] = await p.$queryRaw`
    WITH active AS (
      SELECT j.*, c.name AS company_name FROM "Job" j LEFT JOIN "Company" c ON c.id = j."companyId"
      WHERE j."isActive"
    ), flagged AS (
      SELECT id,
        ("opportunityType" = 'OPEN_APPLICATION') AS open_application,
        ("postedAt" IS NULL) AS no_real_posted_date,
        (btrim(coalesce(title, '')) = '') AS no_title,
        (length(btrim(coalesce(description, ''))) < 100) AS description_too_thin,
        (btrim(coalesce(company_name, '')) = '') AS no_hiring_organization,
        (btrim(coalesce(city, '')) = '' AND "countryCode" IS NULL) AS no_usable_location,
        ("validThrough" IS NOT NULL AND "validThrough" < now()) AS valid_through_expired,
        (url NOT LIKE 'http%') AS no_apply_path
      FROM active
    )
    SELECT reason, count(*)::int postings, (array_agg(id ORDER BY id))[1:10] AS sample_ids
    FROM flagged, LATERAL (VALUES
      ('OPEN_APPLICATION', open_application), ('NO_REAL_POSTED_DATE', no_real_posted_date),
      ('NO_TITLE', no_title), ('DESCRIPTION_TOO_THIN', description_too_thin),
      ('NO_HIRING_ORGANIZATION', no_hiring_organization), ('NO_USABLE_LOCATION', no_usable_location),
      ('VALID_THROUGH_EXPIRED', valid_through_expired), ('NO_APPLY_PATH', no_apply_path)
    ) AS r(reason, hit)
    WHERE hit GROUP BY reason ORDER BY 2 DESC`;

  /**
   * LA TERMINOLOGIE, corrigée (2026-09-11) — trois notions distinctes que le contrôle précédent confondait :
   *   multi-sources    plusieurs `JobSource` actives pour une même offre canonique
   *   multilocalisation plusieurs LIEUX PHYSIQUES réellement énumérés par la source
   *   télétravail      `workplaceType = 'REMOTE'`
   * Le contrôle d'avant ne mesurait que le premier et affirmait les deux autres.
   */
  const [vocabulary]: any[] = await p.$queryRaw`
    SELECT count(*) FILTER (WHERE (SELECT count(*) FROM "JobSource" s WHERE s."jobId" = j.id AND s."isActive") > 1)::int multi_source,
           count(*) FILTER (WHERE j.location LIKE '%;%')::int multi_location,
           count(*) FILTER (WHERE j."workplaceType" = 'REMOTE')::int remote,
           count(*) FILTER (WHERE j."workplaceType" = 'REMOTE' AND j."countryCode" IS NOT NULL)::int remote_with_known_country,
           count(*) FILTER (WHERE j.location LIKE '%;%' AND j.location ILIKE '%remote%')::int multi_location_and_remote
    FROM "Job" j WHERE j."isActive"`;

  /**
   * Un échec signale un écart entre la règle en vigueur dans le code et le balisage SERVI. Avant le déploiement
   * de la règle stricte, les états « description incomplète » et « échéance dépassée » échouent nécessairement :
   * la production applique encore la porte fondée sur la seule `postedAt`. C'est la preuve du défaut, pas un
   * défaut du contrôle — et c'est à cela que sert ce script après un déploiement.
   */
  const failed = results.flatMap((r) => r.checks.filter((c: any) => c.verdict === 'FAIL').map((c: any) => ({ state: r.state, ...c })));
  /** Le balisage RÉELLEMENT émis, compté sur les fiches contrôlées — un échantillon, et on le dit. */
  const allChecks = results.flatMap((r) => r.checks);
  const markupSampleSize = allChecks.length;
  const markupEmittedOnSample = allChecks.filter((c: any) => c.hasJobPosting).length;
  const report = {
    at, base: BASE, boundedTo: `${PER_STATE} fiches par état, ${STATES.length} états — contrôle BORNÉ, non exhaustif`,
    /** Les quatre mesures, nommées pour ce qu'elles sont. Jamais additionnées, jamais confondues. */
    visibleOnModeCareers: counts.visible_on_mode_careers,
    markupEmitted: markupEmittedOnSample,
    googleEligible: counts.google_eligible,
    googleIneligibleByReason: reasons.map((r: any) => ({ reason: r.reason, postings: r.postings, sampleIds: r.sample_ids })),
    googleIneligibleTotal: counts.visible_on_mode_careers - counts.google_eligible,
    vocabulary: {
      multiSource: vocabulary.multi_source,
      multiLocation: vocabulary.multi_location,
      remote: vocabulary.remote,
      remoteWithKnownCountry: vocabulary.remote_with_known_country,
      multiLocationAndRemote: vocabulary.multi_location_and_remote,
      note: 'multi-sources ≠ multilocalisation ≠ télétravail. Trois notions, trois mesures.',
    },
    googlePresence: 'NON MESURÉE — ne peut pas l\'être depuis ce script, et ne se déduit pas du balisage.',
    states: results, failures: failed,
  };

  const json = JSON.stringify(report, (_k, v) => (v instanceof Date ? v.toISOString() : v), 1);
  const out = arg('out');
  if (out) writeFileSync(out, json);
  for (const r of results) {
    const pass = r.checks.filter((c: any) => c.verdict === 'PASS').length;
    console.log(`${r.state.padEnd(30)} ${pass}/${r.sampled} PASS   attendu HTTP ${r.expectHttp.join('|')} · balisage ${r.expectSchema}`);
    for (const c of r.checks.filter((x: any) => x.verdict === 'FAIL')) {
      console.log(`    FAIL ${c.id} http=${c.status} schema=${c.hasJobPosting} dangereux=${c.dangerous.join(',') || '—'} dateInventée=${c.dateInvented}`);
    }
  }
  console.log(`\nvisibleOnModeCareers ${report.visibleOnModeCareers}`);
  console.log(`markupEmitted (sur les ${markupSampleSize} fiches contrôlées) ${report.markupEmitted}`);
  console.log(`googleEligible       ${report.googleEligible}`);
  console.log(`googleIneligible     ${report.googleIneligibleTotal}`);
  for (const r of report.googleIneligibleByReason) console.log(`   ${r.reason.padEnd(24)} ${String(r.postings).padStart(6)}`);
  console.log(`\nvocabulaire : multi-sources ${report.vocabulary.multiSource} · multilocalisation ${report.vocabulary.multiLocation} · télétravail ${report.vocabulary.remote} (dont pays connu ${report.vocabulary.remoteWithKnownCountry})`);
  console.log(`présence dans Google : ${report.googlePresence}`);
  if (failed.length) process.exit(1);
} finally { await p.$disconnect(); }
