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
  /**
   * Le prédicat doit isoler les offres qui énumèrent plusieurs lieux RÉELS : un libellé « Lehi, Utah; Remote »
   * n'a qu'un lieu une fois le télétravail écarté, et l'échantillonner ne démontrait pas la multilocalisation.
   */
  { state: 'multilocalisation (plusieurs LIEUX)', sql: Prisma.sql`j."isActive" AND j.location LIKE '%;%'
      AND array_length(array_remove(array(SELECT btrim(x) FROM unnest(string_to_array(j.location, ';')) x
        WHERE btrim(x) !~* '^(remote|virtual|anywhere|télétravail)$'), ''), 1) > 1`,
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
      /**
       * Les localités RÉELLEMENT émises. La clé absente est omise, pas rendue `null` : une première version
       * mappait l'absence sur `null` et donnait à lire « localités=[null] » sur les offres distantes, comme si
       * une localité vide était publiée. Le balisage servi ne porte tout simplement pas la clé.
       */
      jobLocationLocalities: (Array.isArray(posting.jobLocation) ? posting.jobLocation : posting.jobLocation ? [posting.jobLocation] : [])
        .flatMap((pl: any) => (pl?.address?.addressLocality ? [pl.address.addressLocality] : [])),
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
   *   googleEligible           **conforme à la porte technique actuelle de Mode Careers** — et RIEN de plus :
   *                            ce n'est ni une garantie d'apparition dans Google Jobs, ni une promesse
   *                            d'acceptation par Google. Notre porte est volontairement plus stricte que la
   *                            documentation sur certains points (le seuil de description est notre choix).
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
             -- Une adresse physique exige un PAYS établi (correctif du 2026-09-11) : une ville seule ne suffit
             -- pas, et le pays ne se devine pas depuis elle.
             AND "countryCode" IS NOT NULL
             -- Un code ambigu exige une preuve INDÉPENDANTE du suffixe (correctif terminal du 2026-09-11).
             AND ("countryCode" NOT IN ('CA','IN','AL','GA','KY','NC','SC','SD','NE','TN','MO','LA','MT','ID','MS','PA','VA','DE','ME','AR','MD','MA','NV','CO','CT','IL','MN','NL','ND','OK','SK','PE','NU','WA','NH','MI','OH','RI','VT','WI','WY','OR','NY')
                  OR (
             "countryCode" NOT IN ('CA','IN','AL','GA','KY','NC','SC','SD','NE','TN','MO','LA','MT','ID','MS','PA','VA','DE','ME','AR','MD','MA','NV','CO','CT','IL','MN','NL','ND','OK','SK','PE','NU','WA','NH','MI','OH','RI','VT','WI','WY','OR','NY')
             OR (coalesce("countryIntegrity", '') IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED'))
             OR coalesce(location, '') ~* ('\m(' || CASE "countryCode"
                  WHEN 'US' THEN 'United States|USA' WHEN 'CA' THEN 'Canada' WHEN 'DE' THEN 'Germany|Deutschland|Allemagne'
                  WHEN 'IN' THEN 'India|Inde' WHEN 'NL' THEN 'Netherlands|Pays-Bas|Nederland' WHEN 'IL' THEN 'Israel'
                  WHEN 'AR' THEN 'Argentina|Argentine' WHEN 'CO' THEN 'Colombia|Colombie' WHEN 'ID' THEN 'Indonesia'
                  WHEN 'MA' THEN 'Morocco|Maroc' WHEN 'PA' THEN 'Panama' WHEN 'MT' THEN 'Malta|Malte'
                  WHEN 'TN' THEN 'Tunisia|Tunisie' WHEN 'SK' THEN 'Slovakia|Slovaquie' ELSE 'zzzzNOMATCHzzzz' END || ')\M')
           ))
             -- Le libellé ne doit pas contredire ce pays : « Seattle, WA » n'est pas au Canada.
             AND NOT EXISTS (
           SELECT 1 FROM unnest(string_to_array(coalesce(location, city), ';')) seg
           CROSS JOIN LATERAL (SELECT upper(btrim(replace(split_part(seg, ',', 2), '.', ''))) AS suffix) x
           WHERE length(x.suffix) = 2
             AND x.suffix IN ('CA','WA','OR','NY','MA','PA','VA','DE','ME','AR','MD','MI','OH','RI','VT','WI','WY',
                              'IN','AL','GA','KY','NC','SC','SD','NE','TN','MO','LA','MT','ID','MS','NV','CO','CT','IL','MN','ND','OK','NH')
             -- Pas un conflit si le suffixe REDIT le pays, ni s'il est une subdivision DE ce pays.
             AND x.suffix <> "countryCode"
             AND NOT ("countryCode" = 'US' AND x.suffix IN ('AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR'))
             AND NOT ("countryCode" = 'CA' AND x.suffix IN ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'))
         )
             -- Une multilocalisation exige un pays commun établi et non contredit.
             AND NOT (location LIKE '%;%' AND "countryCode" IS NULL)
             AND ("validThrough" IS NULL OR "validThrough" >= now())
             AND url LIKE 'http%')::int google_eligible
    FROM "Job"`;

  /**
   * LES QUATRE MESURES DE LOCALISATION EXIGÉES, par identifiants (correctif terminal P5).
   *
   * Elles ne se déduisent pas les unes des autres et sont donc comptées séparément.
   */
  const locationMeasures: any[] = await p.$queryRaw`
    WITH active AS (SELECT * FROM "Job" WHERE "isActive"), m AS (
      SELECT 'PHYSIQUE_AVEC_VILLE_SANS_PAYS' AS measure, id FROM active
        WHERE "workplaceType" IS DISTINCT FROM 'REMOTE' AND btrim(coalesce(city, '')) <> '' AND "countryCode" IS NULL
      UNION ALL
      SELECT 'REMOTE_SANS_PAYS_ELIGIBILITE', id FROM active
        WHERE "workplaceType" = 'REMOTE' AND "countryCode" IS NULL
      UNION ALL
      SELECT 'MULTILOCALISEE_AVEC_UN_SEUL_PAYS_APPLIQUE', id FROM active
        WHERE location LIKE '%;%' AND "countryCode" IS NOT NULL
          AND array_length(array_remove(array(SELECT btrim(x) FROM unnest(string_to_array(location, ';')) x
            WHERE btrim(x) !~* '^(remote|virtual|anywhere|télétravail)$'), ''), 1) > 1
      UNION ALL
      -- LES QUATRE TYPES DE PREUVE, comptés SÉPARÉMENT : un groupe agrégé « avec preuve » cacherait PAR QUOI le
      -- pays est réellement établi. L'ordre suit la force de la preuve, et chaque offre n'est comptée qu'une fois.
      SELECT 'COUNTRY_INTEGRITY_VERIFIED', id FROM active
        WHERE "countryCode" IN ('CA','IN','AL','GA','KY','NC','SC','SD','NE','TN','MO','LA','MT','ID','MS','PA','VA','DE','ME','AR','MD','MA','NV','CO','CT','IL','MN','NL','ND','OK','SK','PE','NU','WA','NH','MI','OH','RI','VT','WI','WY','OR','NY') AND (coalesce("countryIntegrity", '') IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED'))
      UNION ALL
      SELECT 'COUNTRY_SPELLED_OUT', id FROM active
        WHERE "countryCode" IN ('CA','IN','AL','GA','KY','NC','SC','SD','NE','TN','MO','LA','MT','ID','MS','PA','VA','DE','ME','AR','MD','MA','NV','CO','CT','IL','MN','NL','ND','OK','SK','PE','NU','WA','NH','MI','OH','RI','VT','WI','WY','OR','NY') AND NOT (coalesce("countryIntegrity", '') IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED')) AND (coalesce(location, '') ~* ('\m(' || CASE "countryCode"
            WHEN 'US' THEN 'United States|USA' WHEN 'CA' THEN 'Canada' WHEN 'DE' THEN 'Germany|Deutschland|Allemagne'
            WHEN 'IN' THEN 'India|Inde' WHEN 'NL' THEN 'Netherlands|Pays-Bas|Nederland' WHEN 'IL' THEN 'Israel'
            WHEN 'AR' THEN 'Argentina|Argentine' WHEN 'CO' THEN 'Colombia|Colombie' WHEN 'ID' THEN 'Indonesia'
            WHEN 'MA' THEN 'Morocco|Maroc' WHEN 'PA' THEN 'Panama' WHEN 'MT' THEN 'Malta|Malte'
            WHEN 'TN' THEN 'Tunisia|Tunisie' WHEN 'SK' THEN 'Slovakia|Slovaquie' ELSE 'zzzzNOMATCHzzzz' END || ')\M'))
      UNION ALL
      -- RENOMMÉ (H-GEO-01) : la compatibilité de format n'établit pas l'identité du pays — DE, US, ID, IL et MA
      -- partagent le format à cinq chiffres. Ce groupe est un SIGNAL DE COHÉRENCE, plus une preuve, et il
      -- n'entre plus à lui seul dans googleEligible. Il est volontairement RECOUVRANT, non partitionnant.
      SELECT 'POSTAL_FORMAT_COMPATIBLE', id FROM active
        WHERE "countryCode" IN ('CA','IN','AL','GA','KY','NC','SC','SD','NE','TN','MO','LA','MT','ID','MS','PA','VA','DE','ME','AR','MD','MA','NV','CO','CT','IL','MN','NL','ND','OK','SK','PE','NU','WA','NH','MI','OH','RI','VT','WI','WY','OR','NY') AND (btrim(coalesce("postalCode", '')) <> '' AND btrim("postalCode") ~ CASE "countryCode"
            WHEN 'US' THEN '^[0-9]{5}(-[0-9]{4})?$' WHEN 'CA' THEN '^[A-Za-z][0-9][A-Za-z][ -]?[0-9][A-Za-z][0-9]$'
            WHEN 'DE' THEN '^[0-9]{5}$' WHEN 'NL' THEN '^[0-9]{4} ?[A-Za-z]{2}$' WHEN 'IN' THEN '^[0-9]{6}$'
            WHEN 'PA' THEN '^[0-9]{4}$' WHEN 'MT' THEN '^[A-Za-z]{3} ?[0-9]{4}$' WHEN 'MD' THEN '^(MD-?)?[0-9]{4}$'
            WHEN 'ID' THEN '^[0-9]{5}$' WHEN 'IL' THEN '^[0-9]{5}([0-9]{2})?$' WHEN 'SK' THEN '^[0-9]{3} ?[0-9]{2}$'
            WHEN 'AR' THEN '^[A-Za-z]?[0-9]{4}[A-Za-z]{0,3}$' WHEN 'CO' THEN '^[0-9]{6}$' WHEN 'MA' THEN '^[0-9]{5}$'
            WHEN 'TN' THEN '^[0-9]{4}$' ELSE 'zzzzNOMATCHzzzz' END)
      UNION ALL
      -- La partition PREUVE reste : intégrité, pays en toutes lettres, ou rien. Le groupe POSTAL ci-dessus est
      -- un signal transversal, compté à part et volontairement RECOUVRANT — il ne partitionne plus.
      SELECT 'NO_INDEPENDENT_PROOF', id FROM active
        WHERE "countryCode" IN ('CA','IN','AL','GA','KY','NC','SC','SD','NE','TN','MO','LA','MT','ID','MS','PA','VA','DE','ME','AR','MD','MA','NV','CO','CT','IL','MN','NL','ND','OK','SK','PE','NU','WA','NH','MI','OH','RI','VT','WI','WY','OR','NY') AND NOT (coalesce("countryIntegrity", '') IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED')) AND NOT (coalesce(location, '') ~* ('\m(' || CASE "countryCode"
            WHEN 'US' THEN 'United States|USA' WHEN 'CA' THEN 'Canada' WHEN 'DE' THEN 'Germany|Deutschland|Allemagne'
            WHEN 'IN' THEN 'India|Inde' WHEN 'NL' THEN 'Netherlands|Pays-Bas|Nederland' WHEN 'IL' THEN 'Israel'
            WHEN 'AR' THEN 'Argentina|Argentine' WHEN 'CO' THEN 'Colombia|Colombie' WHEN 'ID' THEN 'Indonesia'
            WHEN 'MA' THEN 'Morocco|Maroc' WHEN 'PA' THEN 'Panama' WHEN 'MT' THEN 'Malta|Malte'
            WHEN 'TN' THEN 'Tunisia|Tunisie' WHEN 'SK' THEN 'Slovakia|Slovaquie' ELSE 'zzzzNOMATCHzzzz' END || ')\M'))
    )
    SELECT measure, count(*)::int postings, (array_agg(id ORDER BY id))[1:10] AS sample_ids FROM m GROUP BY 1 ORDER BY 2 DESC`;

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
        (btrim(coalesce(city, '')) = '' AND "countryCode" IS NULL AND location IS NULL) AS no_usable_location,
        ("workplaceType" IS DISTINCT FROM 'REMOTE' AND btrim(coalesce(city, '')) <> '' AND "countryCode" IS NULL) AS physical_without_country,
        ("workplaceType" = 'REMOTE' AND "countryCode" IS NULL) AS remote_without_country,
        -- Plus de garde sur les seuls pays non-US : l'expression sait qu'un suffixe d'État est cohérent avec son pays.
        ("countryCode" IS NOT NULL AND EXISTS (
           SELECT 1 FROM unnest(string_to_array(coalesce(location, city), ';')) seg
           CROSS JOIN LATERAL (SELECT upper(btrim(replace(split_part(seg, ',', 2), '.', ''))) AS suffix) x
           WHERE length(x.suffix) = 2
             AND x.suffix IN ('CA','WA','OR','NY','MA','PA','VA','DE','ME','AR','MD','MI','OH','RI','VT','WI','WY',
                              'IN','AL','GA','KY','NC','SC','SD','NE','TN','MO','LA','MT','ID','MS','NV','CO','CT','IL','MN','ND','OK','NH')
             -- Pas un conflit si le suffixe REDIT le pays, ni s'il est une subdivision DE ce pays.
             AND x.suffix <> "countryCode"
             AND NOT ("countryCode" = 'US' AND x.suffix IN ('AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR'))
             AND NOT ("countryCode" = 'CA' AND x.suffix IN ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'))
         )) AS country_conflict,
        (location LIKE '%;%' AND "countryCode" IS NULL) AS multi_not_proven,
        ("countryCode" IN ('CA','IN','AL','GA','KY','NC','SC','SD','NE','TN','MO','LA','MT','ID','MS','PA','VA','DE','ME','AR','MD','MA','NV','CO','CT','IL','MN','NL','ND','OK','SK','PE','NU','WA','NH','MI','OH','RI','VT','WI','WY','OR','NY')
          AND NOT (
             "countryCode" NOT IN ('CA','IN','AL','GA','KY','NC','SC','SD','NE','TN','MO','LA','MT','ID','MS','PA','VA','DE','ME','AR','MD','MA','NV','CO','CT','IL','MN','NL','ND','OK','SK','PE','NU','WA','NH','MI','OH','RI','VT','WI','WY','OR','NY')
             OR (coalesce("countryIntegrity", '') IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED'))
             OR coalesce(location, '') ~* ('\m(' || CASE "countryCode"
                  WHEN 'US' THEN 'United States|USA' WHEN 'CA' THEN 'Canada' WHEN 'DE' THEN 'Germany|Deutschland|Allemagne'
                  WHEN 'IN' THEN 'India|Inde' WHEN 'NL' THEN 'Netherlands|Pays-Bas|Nederland' WHEN 'IL' THEN 'Israel'
                  WHEN 'AR' THEN 'Argentina|Argentine' WHEN 'CO' THEN 'Colombia|Colombie' WHEN 'ID' THEN 'Indonesia'
                  WHEN 'MA' THEN 'Morocco|Maroc' WHEN 'PA' THEN 'Panama' WHEN 'MT' THEN 'Malta|Malte'
                  WHEN 'TN' THEN 'Tunisia|Tunisie' WHEN 'SK' THEN 'Slovakia|Slovaquie' ELSE 'zzzzNOMATCHzzzz' END || ')\M')
           )) AS ambiguous_without_proof,
        ("validThrough" IS NOT NULL AND "validThrough" < now()) AS valid_through_expired,
        (url NOT LIKE 'http%') AS no_apply_path
      FROM active
    )
    SELECT reason, count(*)::int postings, (array_agg(id ORDER BY id))[1:10] AS sample_ids
    FROM flagged, LATERAL (VALUES
      ('OPEN_APPLICATION', open_application), ('NO_REAL_POSTED_DATE', no_real_posted_date),
      ('NO_TITLE', no_title), ('DESCRIPTION_TOO_THIN', description_too_thin),
      ('NO_HIRING_ORGANIZATION', no_hiring_organization), ('NO_USABLE_LOCATION', no_usable_location),
      ('PHYSICAL_LOCATION_WITHOUT_COUNTRY', physical_without_country),
      ('REMOTE_WITHOUT_ELIGIBILITY_COUNTRY', remote_without_country),
      ('LOCATION_COUNTRY_CONFLICT', country_conflict),
      ('MULTI_LOCATION_COUNTRY_NOT_PROVEN', multi_not_proven),
      ('AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF', ambiguous_without_proof),
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
           -- Multilocalisation = plusieurs lieux RÉELS, télétravail écarté (« Lehi, Utah; Remote » n'a qu'un lieu).
           count(*) FILTER (WHERE j.location LIKE '%;%'
             AND array_length(array_remove(array(SELECT btrim(x) FROM unnest(string_to_array(j.location, ';')) x
               WHERE btrim(x) !~* '^(remote|virtual|anywhere|télétravail)$'), ''), 1) > 1)::int multi_location,
           count(*) FILTER (WHERE j."workplaceType" = 'REMOTE')::int remote,
           count(*) FILTER (WHERE j."workplaceType" = 'REMOTE' AND j."countryCode" IS NOT NULL)::int remote_with_known_country,
           count(*) FILTER (WHERE j.location LIKE '%;%' AND j.location ILIKE '%remote%')::int multi_location_and_remote,
           count(*) FILTER (WHERE j.location LIKE '%;%')::int enumerating_labels
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
    /** Nommé sans ambiguïté : c'est NOTRE porte, pas un verdict de Google. */
    googleEligible: counts.google_eligible,
    googleEligibleMeaning: 'Conforme à la porte technique actuelle de Mode Careers. Ni une garantie d\'apparition dans Google Jobs, ni une promesse d\'acceptation par Google.',
    descriptionThresholdOrigin: 'Le seuil de 100 caractères est une règle conservatrice interne de Mode Careers, pas un seuil fourni par Google.',
    googleIneligibleByReason: reasons.map((r: any) => ({ reason: r.reason, postings: r.postings, sampleIds: r.sample_ids })),
    googleIneligibleTotal: counts.visible_on_mode_careers - counts.google_eligible,
    locationMeasures: locationMeasures.map((m: any) => ({ measure: m.measure, postings: m.postings, sampleIds: m.sample_ids })),
    vocabulary: {
      multiSource: vocabulary.multi_source,
      multiLocation: vocabulary.multi_location,
      remote: vocabulary.remote,
      remoteWithKnownCountry: vocabulary.remote_with_known_country,
      multiLocationAndRemote: vocabulary.multi_location_and_remote,
      enumeratingLabels: vocabulary.enumerating_labels,
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
  console.log(`googleEligible       ${report.googleEligible}  (porte technique Mode Careers, pas un verdict Google)`);
  console.log(`googleIneligible     ${report.googleIneligibleTotal}`);
  for (const r of report.googleIneligibleByReason) console.log(`   ${r.reason.padEnd(24)} ${String(r.postings).padStart(6)}`);
  console.log('\n--- localisation, mesures par identifiants ---');
  for (const m of report.locationMeasures) console.log(`   ${m.measure.padEnd(42)} ${String(m.postings).padStart(6)}`);
  console.log(`\nvocabulaire : multi-sources ${report.vocabulary.multiSource} · multilocalisation ${report.vocabulary.multiLocation} · télétravail ${report.vocabulary.remote} (dont pays connu ${report.vocabulary.remoteWithKnownCountry})`);
  console.log(`présence dans Google : ${report.googlePresence}`);
  if (failed.length) process.exit(1);
} finally { await p.$disconnect(); }
