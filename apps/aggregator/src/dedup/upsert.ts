import { assertSourceRunning } from '../lib/sourceBudget.js';
import { lockCompanyRows, lockSourceWrites } from '../lib/writeLocks.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { selectCanonicalSource } from './canonical.js';
import { blockingKey, isProbableDuplicate, SOURCE_PRIORITY, type CandidateJob } from './match.js';
import { classifySector, sectorForSource, type Sector } from '../normalize/sector.js';
import { findMaison } from '../normalize/maisons.js';
import { resolveCompany } from '../normalize/company.js';
import { countryFromLocation, normalizeCountry } from '../normalize/country.js';
import { resolveGeography } from '../normalize/geography.js';
import { cityFromLocation, displayCity } from '../normalize/location.js';
import { isFranceJob } from '../lib/france.js';
import { detectLanguage } from '../lib/language.js';
import { PIPELINE_VERSION } from '../pipeline/version.js';
import { classifyJob, TAXONOMY_VERSION } from '../normalize/taxonomy.js';
import { changedEvents, diffStructuralFields, structuralValuesOf, toNestedEventRow, type JobEventInput } from '../pipeline/jobEvents.js';


/** Classifier sectors map 1:1 onto the CompanySector enum. */
const SECTOR_TO_COMPANY_SECTOR: Record<Sector, string> = {
  FASHION: 'FASHION',
  LUXURY: 'LUXURY',
  BEAUTY: 'BEAUTY',
  JEWELRY_WATCHES: 'JEWELRY_WATCHES',
  RETAIL: 'RETAIL',
  SUPPLIER: 'SUPPLIER',
  MEDIA_AGENCY: 'MEDIA_AGENCY',
  RECRUITER: 'RECRUITER',
  OTHER: 'OTHER',
};

/**
 * Write-time deduplication — the guarantee that the database NEVER holds the same
 * opening twice, not even for a second.
 *
 * Deduplicating on a schedule would leave a window in which the front end shows
 * one job three times: Dior posts, LVMH republishes two hours later, and the
 * duplicate is visible until the next pass. So dedup is an INSERT rule, not a
 * periodic job:
 *
 *   1. compute the cluster key (resolved company + normalized city)
 *   2. compare against live jobs already in that cluster
 *   3. match  -> attach a JobSource, and promote the canonical URL if this
 *                source outranks the current one
 *      no match -> create the Job, with its first JobSource
 *
 * A separate weekly reconcile pass still earns its place, but only for
 * retroactive merges after an alias or synonym is added — never as the mechanism
 * that keeps the data clean.
 */

function tierRank(tier: string): number {
  const index = SOURCE_PRIORITY.indexOf(tier as (typeof SOURCE_PRIORITY)[number]);
  // An unknown tier must never outrank a known one.
  return index === -1 ? SOURCE_PRIORITY.length : index;
}

export type UpsertOutcome = 'CREATED' | 'MERGED' | 'UPDATED';

export type UpsertResult = {
  jobId: string;
  outcome: UpsertOutcome;
  /** True when this source took over the canonical apply URL. */
  promoted: boolean;
};

/**
 * Inserts one posting, merging it into an existing cluster when it is the same
 * opening. `companyId` is the resolved identity, not the raw source string.
 */
export async function upsertDeduplicated(
  prisma: PrismaClient,
  candidate: CandidateJob & { companyId: string },
): Promise<UpsertResult> {
  for (let attempt = 0; ; attempt++) {
    assertSourceRunning();
    try {
      return await prisma.$transaction(async tx => {
        await lockSourceWrites(tx, candidate.sourceKey);
        const source = await tx.source.findUnique({ where: { key: candidate.sourceKey }, select: { status: true } });
        if (source?.status === 'RETIRED') throw new Error(`Source ${candidate.sourceKey} is RETIRED`);
        // Source identity protects relocation/renaming; company serializes the
        // matching decision across independent feeds and cluster buckets.
        for (const key of [JSON.stringify(['entry', candidate.sourceKey, candidate.externalId]), JSON.stringify(['company', candidate.companyId])]) {
          await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        }
        const target = await tx.company.findUnique({
          where: { fashionjobsUrl: `resolved:${candidate.companyId}` }, select: { id: true },
        });
        const current = await tx.jobSource.findUnique({
          where: { sourceKey_externalId: { sourceKey: candidate.sourceKey, externalId: candidate.externalId } },
          select: { job: { select: { companyId: true } } },
        });
        await lockCompanyRows(tx, [target?.id, current?.job.companyId].filter((id): id is string => !!id));
        assertSourceRunning();
        const result = await upsertInTransaction(tx, candidate);
        assertSourceRunning(); // Throw inside the transaction so cancellation rolls writes back.
        return result;
      }, { maxWait: 10_000, timeout: 30_000 });
    } catch (error) {
      // Retry the entire transaction, never query inside an aborted transaction.
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (attempt >= 2 || (code !== 'P2034' && code !== 'P2002')) throw error;
    }
  }
}

async function upsertInTransaction(
  prisma: Prisma.TransactionClient,
  candidate: CandidateJob & { companyId: string },
): Promise<UpsertResult> {
  const clusterKey = blockingKey(candidate);
  const now = new Date();
  if (candidate.raw !== undefined && candidate.raw !== null) {
    const payload = JSON.stringify(candidate.raw);
    const contentHash = createHash('sha256').update(payload).digest('hex');
    await prisma.sourceObservation.upsert({
      where: { sourceKey_externalId_contentHash: { sourceKey: candidate.sourceKey, externalId: candidate.externalId, contentHash } },
      create: { sourceKey: candidate.sourceKey, externalId: candidate.externalId, contentHash, raw: candidate.raw as Prisma.InputJsonValue, pipelineVersion: PIPELINE_VERSION, observedAt: now },
      update: {},
    });
  }

  // Job.companyId is a foreign key, so the Company row has to exist first —
  // otherwise every single write fails on a constraint violation and the run
  // ends with an empty database.
  // Classify once, at write time: the front end reads Company.kind, which
  // otherwise stays at its UNKNOWN default and every sector facet reads
  // "UNKNOWN" no matter how well the classifier works.
  // Pass the source's sector so an unrecognised employer from a sector-scoped
  // source (FashionJobs -> FASHION, LVMH -> LUXURY) inherits it instead of
  // falling to OTHER — this is what rescues the ~300 real Maisons the reference
  // list has never heard of.
  const verdict = classifySector({
    company: candidate.company,
    title: candidate.title,
    sourceSector: sectorForSource(candidate.sourceKey),
    // Toute offre ingérée vient d'une source promue au catalogue : son
    // appartenance au secteur est déjà établie (voir classifySector).
    fromCatalogue: Boolean(candidate.sourceKey),
  });
  const sector = (SECTOR_TO_COMPANY_SECTOR[verdict.sector] ?? 'OTHER') as never;

  // The reference list knows Sandro belongs to SMCP and Dior to LVMH. Storing
  // it lets a search for one brand reach offers a group portal published under
  // the parent's name — and gives the group its own filter.
  // Le référentiel d'abord, puis le groupe que porte l'alias (Cartier → Richemont) :
  // ~5 100 offres de flux de groupe n'avaient aucun groupe (audit A1).
  const parentGroup = findMaison(candidate.company)?.group || resolveCompany(candidate.company).group || null;

  const company = await prisma.company.upsert({
    where: { fashionjobsUrl: `resolved:${candidate.companyId}` },
    create: {
      name: candidate.company,
      canonicalKey: candidate.companyId,
      sector,
      // The unique key is the employer identity, not a FashionJobs URL: employers
      // reach us from their own sites too, and most never appear on that board.
      fashionjobsUrl: `resolved:${candidate.companyId}`,
      parentGroup,
      lastSeenAt: now,
      // The Maison's domain (its logo), when this source names it: the
      // catalogue's careers host, never a guess from the name.
      ...(candidate.companyDomain ? { domain: candidate.companyDomain, domainSource: 'source-careers' } : {}),
    },
    // Re-write the name on every update, not only on create: a Company created
    // before the "+N" strip (decision D11) shipped keeps its polluted name
    // forever otherwise ("Cartier +3", "IWC Schaffhausen +3"…), because the old
    // update left `name` untouched. candidate.company is already the resolved,
    // stripped display name, and it is identical for every offer of the same
    // companyId, so this is a stable self-heal — the 40 legacy rows clean up on
    // their next ingest.
    update: { name: candidate.company, sector, parentGroup, lastSeenAt: now },
    select: { id: true, domain: true },
  });

  // A Company first created by a group feed (no domain) gets its domain the
  // day its own careers site re-attests it. Fill only when EMPTY: a domain
  // already set — by the catalogue, Wikidata or a hand — is never overwritten,
  // so a wrong write cannot churn a logo back and forth between two sources.
  if (candidate.companyDomain && !company.domain) {
    await prisma.company.updateMany({
      where: { id: company.id, domain: null },
      data: { domain: candidate.companyDomain, domainSource: 'source-careers' },
    });
  }

  /**
   * Identité EXACTE d'abord : la même source qui re-parle de la même offre
   * (sourceKey + externalId) — le cas de loin le plus fréquent, indexé, et
   * valable que l'offre soit active ou fermée.
   *
   * Audit A2 (2026-09-06) : sans ce chemin, une offre dont la clé de cluster
   * gravée ne correspondait plus à la clé recalculée (4 906 offres) ratait la
   * recherche de cluster, tombait dans la récupération P2002 qui touchait le
   * Job mais jamais la JobSource — 1 855 offres vivantes avec une JobSource
   * inactive, fermées (410) par le refresh puis ré-ouvertes par l'ingest
   * suivant, tous les jours. Ici, Job ET JobSource sont ré-attestés, et la
   * clé de cluster est ré-écrite si elle a changé.
   */
  const ownEntry = await prisma.jobSource.findUnique({
    where: { sourceKey_externalId: { sourceKey: candidate.sourceKey, externalId: candidate.externalId } },
    select: { job: { include: { sources: true }, omit: { searchText: true } } },
  });
  if (ownEntry) return attachToExisting(prisma, candidate, ownEntry.job, now, clusterKey, company.id);

  // Only live jobs in the same cluster can absorb this posting. The cluster key
  // is indexed, so this stays a narrow lookup rather than a scan.
  const clusterJobs = await prisma.job.findMany({
    where: { clusterKey, isActive: true, sources: { none: { sourceKey: candidate.sourceKey } } },
    select: {
      id: true, title: true, countryCode: true, city: true, location: true, postedAt: true,
      sources: { select: { sourceKey: true, externalId: true } },
    },
    orderBy: [{ firstSeenAt: 'asc' }, { id: 'asc' }],
  });

  /**
   * One source never publishes one opening twice: a job that already carries a
   * JobSource from THIS source under a DIFFERENT id is a different opening,
   * whatever the titles score. This guard existed in match.ts but the old code
   * fed it the CANDIDATE's own sourceKey/externalId (`{...candidate}`), so it
   * could never fire at write time — three distinct "Sales Associate" ids at
   * the same boutique collapsed into one displayed offer (audit D-01). The
   * sources are already loaded; compare against the real ones.
   */
  const existing = clusterJobs.find((job) => {
    const sameSourceOtherId = job.sources.some(
      (source) =>
        source.sourceKey === candidate.sourceKey && source.externalId !== candidate.externalId,
    );
    if (sameSourceOtherId) return false;
    return isProbableDuplicate(candidate, {
      ...candidate,
      title: job.title,
      // Use the stored posting's evidence, not the incoming country's/city's
      // values inherited by the spread above.
      country: job.countryCode ?? undefined,
      city: job.city ?? undefined,
      location: job.location ?? undefined,
      postedAt: job.postedAt ?? undefined,
    });
  });

  if (!existing) return createJob(prisma, candidate, company.id, clusterKey, now);

  const matched = await prisma.job.findUniqueOrThrow({ where: { id: existing.id }, include: { sources: true }, omit: { searchText: true } });
  return attachToExisting(prisma, candidate, matched, now, clusterKey, company.id);
}

async function createJob(
  prisma: Prisma.TransactionClient,
  candidate: CandidateJob & { companyId: string },
  companyId: string,
  clusterKey: string,
  now: Date,
): Promise<UpsertResult> {
  // Résolu UNE fois : la subdivision en dépend, et deux lectures divergentes du
  // même candidat produiraient un pays et une subdivision incohérents.
  const country = countryOf(candidate);
  const created = await prisma.job.create({
    data: {
        companyId,
        externalId: candidate.externalId,
        // The real ATS, not a hard-coded default: the unique key
        // (companyId, source, externalId) must separate two different sources
        // that happen to share an externalId for the same employer.
        source: candidate.atsType ?? 'GENERIC_JSONLD',
        title: candidate.title,
        location: candidate.location,
        /**
         * Pays canonique (ISO-2), jamais la valeur brute de la source.
         *
         * Mesuré en prod le 2026-09-05 : 256 valeurs distinctes pour ~90 pays.
         * La France s'écrivait FR / France / fr / FRANCE — quatre lignes dans
         * le filtre Pays, dont aucune ne montrait plus du tiers des offres
         * françaises. Normaliser ICI répare toutes les sources d'un coup, là où
         * un correctif par adaptateur en aurait laissé passer la moitié.
         */
        countryCode: country,
        adminArea1: adminArea1Of(candidate, country),
        // Stored as a FLAG, never used as a discard: the site defaults to the
        // French view and can widen later. This line was missing — every job
        // sat at the schema default `false`, and a front end filtering on
        // isFrance:true would have shown an empty board over a full database.
        isFrance: isFranceJob(country ?? candidate.country, candidate.location),
        employmentTerm: candidate.employmentTerm,
        engagementType: candidate.engagementType,
        isSeasonal: candidate.isSeasonal,
        // Rich fields the richer vendors publish. Absent means "this source does
        // not expose it", so they are written through rather than dropped.
        /**
         * La ville de l'adaptateur, ou, à défaut, celle que porte `location`.
         *
         * Mesuré en prod le 2026-09-05 : 30 716 offres actives (61 %) n'avaient
         * AUCUNE ville — mais 24 681 d'entre elles portaient un `location`
         * parfaitement exploitable (« Paris », « London, England, gb »,
         * « New York,US-NY,United States »). Le champ n'était jamais dérivé :
         * il ne venait que des adaptateurs qui le renseignent explicitement.
         * Sans ville, l'offre est infiltrable, introuvable sur une carte et
         * absente du filtre Ville.
         *
         * `normalizeLocationString` fait déjà cette extraction pour la clé de
         * dédup — on réutilise donc un chemin éprouvé plutôt que d'en écrire un
         * second qui divergerait.
         */
        city: cityOf(candidate),
        postalCode: candidate.postalCode,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        workTime: candidate.workTime,
        workplaceType: candidate.workplaceType,
        experienceYears: candidate.experienceYears,
        educationLevel: candidate.educationLevel,
        salaryMin: candidate.salaryMin,
        salaryMax: candidate.salaryMax,
        salaryCurrency: candidate.salaryCurrency,
        salaryPeriod: candidate.salaryPeriod,
        department: candidate.department,
        validThrough: candidate.validThrough,
        description: candidate.description,
        // Stored, never filtered on (decision, 2026-09-03): the catalogue is
        // worldwide and the language serves display/translation later.
        language: candidate.language ?? detectLanguage(candidate.description ?? candidate.title),
        url: candidate.url,
        postedAt: candidate.postedAt,
        clusterKey,
        canonicalTier: candidate.sourceTier,
        canonicalSourceKey: candidate.sourceKey,
        canonicalExternalId: candidate.externalId,
        fingerprint: `${clusterKey}|${candidate.title}`,
        pipelineVersion: PIPELINE_VERSION,
        lastSeenAt: now,
        // Taxonomie Intelligence (D38) : métier, séniorité, retail, IA,
        // compétences — classés ici, à la naissance de la ligne.
        ...classifyJob(candidate),
        /**
         * Le dispositif vient de la SOURCE si elle le nomme, et seulement à
         * défaut de l'intitulé : un champ dédié bat une inférence de titre.
         * Posé APRÈS `classifyJob` pour que cet ordre soit lisible ici plutôt
         * que dépendant de la position des clés.
         */
        programType: candidate.programType ?? classifyJob(candidate).programType,
        /**
         * The untouched source payload. Nothing is discarded: the normalized
         * columns are the standard view, and this keeps every field a vendor
         * publishes — including ones no column exists for yet, which can then be
         * promoted later without re-fetching the whole market.
         */
        raw: candidate.raw as never,
        sources: {
          create: {
            sourceKey: candidate.sourceKey,
            sourceTier: candidate.sourceTier,
            externalId: candidate.externalId,
            url: candidate.url,
            title: candidate.title,
            postedAt: candidate.postedAt,
            lastSeenAt: now,
            // Per-source payload too: each source sees the posting differently.
            raw: candidate.raw as never,
          },
        },
        // L'histoire commence ici (D38) : une ouverture, dans la même écriture
        // que la ligne — jamais une offre sans son événement de naissance.
        events: { create: { type: 'OPENED', at: now } },
      },
  });
  return { jobId: created.id, outcome: 'CREATED', promoted: true };
}

/**
 * Pays ISO du candidat : celui de la source, sinon celui que porte le lieu
 * (audit A1 : 14 074 offres sans pays).
 *
 * `resolveGeography` est consulté AVANT `countryFromLocation` parce qu'il porte
 * la garde de collision : « Nashville, TN » y devient US/Tennessee, mais
 * « Berlin, DE » reste allemande. `countryFromLocation`, qui lit les segments à
 * l'envers sans cette garde, produisait 567 offres berlinoises au Delaware
 * (audit du 2026-09-08).
 */
function countryOf(candidate: CandidateJob): string | undefined {
  const geo = resolveGeography({
    rawCountry: candidate.country,
    location: candidate.location,
    city: candidate.city,
  });
  return (
    normalizeCountry(candidate.country) ??
    geo.countryCode ??
    countryFromLocation(candidate.location) ??
    // Un lieu que les signaux français reconnaissent (code postal, département,
    // région) sans pays nommé est en France : 440 offres actives « Paris (75) »
    // portaient isFrance sans pays (audit I-1, 2026-09-06).
    (isFranceJob(undefined, candidate.location) ? 'FR' : undefined)
  );
}

/**
 * La subdivision administrative, lue par la même chaîne que le pays.
 *
 * `legacyCountry` reçoit le pays que `countryOf` vient d'établir : sans lui,
 * « Success, WA » (Western Australia) redeviendrait « Washington » à chaque
 * ré-attestation, et le backfill et l'ingest divergeraient — l'invariant
 * `ingest == replay` l'interdit.
 */
function adminArea1Of(candidate: CandidateJob, country: string | undefined): string | undefined {
  return resolveGeography({
    rawCountry: candidate.country,
    location: candidate.location,
    city: candidate.city,
    legacyCountry: country,
  }).adminArea1;
}

/** Ville affichable — jamais un pays ou un code pays (« Ch », « Germany » : ~800 « villes », audit A1). */
function cityOf(candidate: CandidateJob): string | undefined {
  // La ville de l'adaptateur si elle est un lieu (location.ts rejette pays, états,
  // codes magasin, modes de travail), SINON celle que porte le lieu : +1 231
  // offres avec ville (lot 4). Pas de garde « ≠ pays » ici : elle effaçait
  // Singapour, Hong Kong, Luxembourg, Monaco (750 offres légitimes).
  return displayCity(candidate.city) ?? cityFromLocation(candidate.location);
}

type ExistingJob = Prisma.JobGetPayload<{ include: { sources: true }; omit: { searchText: true } }>;

/**
 * Ce qu'une ré-attestation ré-écrit sur une offre déjà en base.
 *
 * Mesuré en prod le 2026-09-06, après le premier run complet avec les
 * normalisations d'écriture (pays ISO, ville dérivée, titre de carte, texte
 * propre) : pays distincts 276 → 282, offres sans ville 37 845 → 37 770,
 * « Apply Now » 184 → 184. Les correctifs ne touchaient que la CRÉATION ; les
 * 56 000 lignes existantes étaient ré-attestées à chaque run sans jamais être
 * ré-écrites. Une offre que sa source re-liste porte les valeurs normalisées
 * de MAINTENANT : c'est l'auto-guérison de la base, une source à la fois.
 *
 * Règles : le pays et la ville ne sont ré-écrits que si le candidat en porte
 * un (jamais effacés) ; le titre et la description seulement quand c'est la
 * source actuellement canonique (`hasAuthority`) — une autre
 * source n'a pas autorité sur le texte du canonique — et la description
 * même si la correction est plus courte.
 */
type Reattestable = Pick<
  ExistingJob,
  | 'title' | 'description' | 'location' | 'city' | 'countryCode' | 'adminArea1' | 'isFrance' | 'postedAt' | 'validThrough'
  | 'language' | 'employmentTerm' | 'workTime' | 'programType' | 'engagementType' | 'isSeasonal' | 'workplaceType' | 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod'
>;

/**
 * Champs simples : REMPLIS par n'importe quelle source quand ils sont vides,
 * RÉ-ÉCRITS seulement par la source actuellement canonique (`hasAuthority`).
 *
 * Audit A4 (2026-09-06) : date, langue, contrat, temps de travail, validité,
 * salaire n'étaient écrits qu'à la création — lignes nées avant le 04/09 :
 * 38 % sans date, 80 % sans langue ; après : 3 % / 2 %. LVMH : 4 131 dates
 * présentes dans le brut, 5 212 offres sans date.
 */
const SIMPLE_FIELDS = [
  'postedAt', 'validThrough', 'language', 'employmentTerm', 'workTime', 'programType', 'engagementType', 'isSeasonal', 'workplaceType',
] as const;
const SALARY_FIELDS = ['salaryMin', 'salaryMax', 'salaryCurrency', 'salaryPeriod'] as const;

export function reattestationFields(
  candidate: CandidateJob,
  existing: Reattestable,
  hasAuthority: boolean,
): Partial<Reattestable> {
  const out: Partial<Reattestable> = {};
  const country = countryOf(candidate);
  const maySetGeography = hasAuthority || (!existing.countryCode && !existing.city && !existing.location);
  if (maySetGeography) {
    if (country && country !== existing.countryCode) out.countryCode = country;
    if (country) {
      const isFrance = isFranceJob(country, candidate.location);
      if (isFrance !== existing.isFrance) out.isFrance = isFrance;
    }
    /**
     * `adminArea1` est DÉRIVÉ, comme le pays — il n'existe pas sur le candidat.
     * Il doit pouvoir être POSÉ **et EFFACÉ** : une offre australienne étiquetée
     * « Washington » par l'ancienne chaîne (703 cas mesurés le 2026-09-08) ne se
     * répare que si la ré-attestation sait écrire `null`. Sans ce chemin, chaque
     * correctif de géographie n'existerait qu'en backfill — donc temporaire.
     *
     * On n'efface QUE lorsque le candidat porte un lieu : une source qui n'en
     * publie pas ne doit pas détruire ce qu'une autre a établi.
     */
    const admin = adminArea1Of(candidate, country);
    if (admin !== (existing.adminArea1 ?? undefined) && (admin || candidate.location)) {
      out.adminArea1 = admin ?? null;
    }
    const city = cityOf(candidate);
    if (city && city !== existing.city) out.city = city;
    if (candidate.location && (!existing.location || hasAuthority) && candidate.location !== existing.location) {
      out.location = candidate.location;
    }
  } else if (country && country === normalizeCountry(existing.countryCode) && country !== existing.countryCode) {
    out.countryCode = country; // spelling normalization, not a change of country
  }
  for (const field of SIMPLE_FIELDS) {
    const value = candidate[field];
    if (value === undefined || value === null) continue;
    const current = existing[field];
    const same = current instanceof Date && value instanceof Date ? current.getTime() === value.getTime() : current === value;
    if ((current === null || hasAuthority) && !same) (out as Record<string, unknown>)[field] = value;
  }
  // A salary is one tuple: never combine an employer amount with a board's
  // currency, or preserve an old currency after an authoritative new amount.
  if (SALARY_FIELDS.some(field => candidate[field] !== undefined) &&
      (hasAuthority || SALARY_FIELDS.every(field => existing[field] === null))) {
    for (const field of SALARY_FIELDS) {
      const value = candidate[field] ?? null;
      if (value !== existing[field]) (out as Record<string, unknown>)[field] = value;
    }
  }
  if (hasAuthority) {
    if (candidate.title && candidate.title !== existing.title) out.title = candidate.title;
    if (candidate.description !== undefined && candidate.description !== existing.description) {
      out.description = candidate.description;
    }
  }
  return out;
}

async function attachToExisting(
  prisma: Prisma.TransactionClient,
  candidate: CandidateJob,
  existing: ExistingJob,
  now: Date,
  /** La clé de cluster d'AUJOURD'HUI : ré-écrite si elle diffère de celle gravée. */
  clusterKey?: string,
  /** La société résolue d'aujourd'hui : ré-écrite par la source de l'entrée (alias corrigé, « Logo », marque de groupe). */
  companyId?: string,
): Promise<UpsertResult> {
  const alreadyKnown = existing.sources.some(
    (source) => source.sourceKey === candidate.sourceKey && source.externalId === candidate.externalId,
  );

  const observedSource = await prisma.jobSource.upsert({
    where: {
      sourceKey_externalId: {
        sourceKey: candidate.sourceKey,
        externalId: candidate.externalId,
      },
    },
    create: {
      jobId: existing.id,
      sourceKey: candidate.sourceKey,
      sourceTier: candidate.sourceTier,
      externalId: candidate.externalId,
      url: candidate.url,
      title: candidate.title,
      postedAt: candidate.postedAt,
      lastSeenAt: now,
      raw: candidate.raw as Prisma.InputJsonValue | undefined,
    },
    update: { url: candidate.url, title: candidate.title, postedAt: candidate.postedAt, sourceTier: candidate.sourceTier, lastSeenAt: now, isActive: true, raw: candidate.raw as Prisma.InputJsonValue | undefined },
  });

  const owner = selectCanonicalSource([
    ...existing.sources.filter(s => s.id !== observedSource.id), observedSource,
  ], existing)!;
  const hasAuthority = owner.id === observedSource.id;
  const promoted = hasAuthority && (
    owner.sourceKey !== existing.canonicalSourceKey || owner.externalId !== existing.canonicalExternalId
  ) && tierRank(owner.sourceTier) < tierRank(existing.canonicalTier ?? '');

  const data = {
    lastSeenAt: now,
    isActive: true,
    // Every touch carries the current generation, so a merged offer is never
    // left below the version line and re-purged on the next run.
    pipelineVersion: PIPELINE_VERSION,
    // The normalized values of today reach the rows of yesterday.
    ...reattestationFields(candidate, existing, hasAuthority),
    // La taxonomie suit la même règle d'auto-guérison : re-classée par la
    // source de l'entrée, ou dès que les règles ont changé de version.
    ...(hasAuthority || existing.taxonomyVersion < TAXONOMY_VERSION
      ? classifyJob({
          title: hasAuthority ? candidate.title : existing.title,
          department: hasAuthority ? candidate.department : existing.department ?? undefined,
          description: hasAuthority ? candidate.description : existing.description,
        })
      : {}),
    // A cluster key that drifted (city normalized differently) is re-graved,
    // so the cluster lookup — and the weekly reconcile — find the row again.
    ...(hasAuthority && clusterKey && clusterKey !== existing.clusterKey ? { clusterKey } : {}),
    // 1 166 offres restaient sous une société périmée (audit A1) : l'alias ou
    // la marque corrigés ne les atteignaient jamais.
    ...(hasAuthority && companyId && companyId !== existing.companyId ? { companyId } : {}),
    url: owner.url,
    canonicalTier: owner.sourceTier,
    canonicalSourceKey: owner.sourceKey,
    canonicalExternalId: owner.externalId,
    ...(hasAuthority && candidate.raw !== undefined ? { raw: candidate.raw as Prisma.InputJsonValue } : {}),
  };

  /**
   * L'histoire (D38) : un CHANGED par champ structurant qui change vraiment
   * (titre, ville, pays, société, métier — jamais la description, les dates
   * ou le salaire), et une RÉ-OUVERTURE quand une source re-liste une offre
   * que le refresh avait fermée. Avant, `isActive: true` était remis sans le
   * dire : la fermeture disparaissait de la base sans laisser de trace.
   */
  const reopening = !existing.isActive;
  const events: JobEventInput[] = [
    ...(reopening ? [{ jobId: existing.id, type: 'REOPENED' as const, at: now }] : []),
    // `structuralValuesOf` traduit les noms de COLONNE en noms d'ÉVÉNEMENT
    // (`countryCode` → `country`) : sans lui, un changement de pays cesse
    // silencieusement d'être tracé.
    ...changedEvents(existing.id, diffStructuralFields(structuralValuesOf(existing), structuralValuesOf(data)), now),
  ];

  // Une seule écriture : la ligne et ses événements dans la même requête
  // (createMany imbriqué), sans transaction interactive à tenir sous six
  // workers concurrents.
  await prisma.job.update({
    where: { id: existing.id },
    data: {
      ...data,
      ...(reopening ? { closedAt: null, reopenedCount: { increment: 1 } } : {}),
      ...(events.length ? { events: { createMany: { data: events.map(toNestedEventRow) } } } : {}),
    },
  });

  return {
    jobId: existing.id,
    outcome: alreadyKnown ? 'UPDATED' : 'MERGED',
    promoted,
  };
}
