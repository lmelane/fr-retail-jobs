import { publicationContentOf, type PresentationSource } from '@catwalks/db/publication-presentation';
import { publicAmount } from '@catwalks/db/money';
import { availableSourceWhere, publicJobWhere, publicJobSql, sourceIsAvailable } from '@catwalks/db/availability';
import { selectApplySource, type ApplySource } from '@catwalks/db/publications';
import { publicSourceFacts, scalarSourceFacts, type PublicSourceFacts } from '@catwalks/db/source-facts';
import type { Perimetre } from '@catwalks/db/marches';
import { getOptionalOccupationPresentation, type OptionalOccupationPresentation } from './occupations';
import { prisma, Prisma, canonicalJobId } from '@catwalks/db';
import { ARITE_CLE_RECHERCHE, searchSummary, type CleRecherche } from './job-search-query';
import { CURSEUR_MAX, decoderCurseur, empreinteCriteres, encoderCurseur } from './curseur';
import { directPubliable, directPubliableSql, directToRow, estIdDirect, idDirect, statutDirect } from './direct-offers';
import { offerIdCandidates } from './offer-url';
import { libellerFacettes, type FacetteServie } from './facettes';
import { exigerPerimetre } from './perimetre';
import { DIMENSIONS, DIMENSIONS_TOLERANTES, planifierRecherche, type CriteresRecherche, type Dimension, type DimensionTolerante, type FiltreRefuse, type Selections } from './search-plan';
import type { LieuResolu } from './lieu';

/** Sector keys are data, not an application enum. Unknown keys stay bound
 * parameters and match zero; dropping them would silently widen the search. */
const publicSources = () => ({
  select: { sourceKey: true, externalId: true, sourceTier: true, isActive: true, url: true, expiresAt: true, sourceFacts: true, presentation: true, captureBatchId: true, captureOutputId: true } as const,
  where: availableSourceWhere(),
});

/**
 * Job queries for the list and the offer pages.
 *
 * There is NO demo fallback (decision D1): a jobboard must never show invented
 * offers. When the database is unavailable, these throw DatabaseUnavailableError
 * and the caller renders a clean error state — never six fictional rows passed
 * off as real listings.
 */

/** Thrown when the database cannot answer, so the UI shows an error, not fake data. */
export class DatabaseUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('The offers database is unavailable.');
    this.name = 'DatabaseUnavailableError';
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Les critères d'une recherche, tels que l'URL les porte (lot 6).
 *
 * Le vocabulaire est celui du contrat de facettes (`CLES_FACETTE`), en
 * français parce que l'URL est visible par le candidat : `contrat`, `temps`,
 * `programme`, `metier`, `secteur`, `ville`, `maison`, `groupe`, `langue`,
 * `pays`. Chaque dimension porte plusieurs valeurs (D-426). `marche` est le
 * périmètre demandé ; il est OBLIGATOIRE au moment de chercher, et sa
 * validation vit dans `exigerPerimetre`, une seule fois. `apres` est le
 * curseur de la page suivante (lot 7), tel que la réponse précédente l'a
 * rendu dans `suivant`.
 */
export type JobFilters = CriteresRecherche & { marche?: string; apres?: string };

/**
 * D-426 — plafond du nombre de valeurs par filtre.
 *
 * Sans lui, `?pays=` répété mille fois construirait une clause SQL de mille
 * termes depuis une simple URL publique. 12 dépasse largement l'usage réel et
 * reste le MÊME plafond que celui du site, pour qu'une URL acceptée par l'un
 * ne soit pas tronquée en silence par l'autre.
 */
export const MAX_VALUES = 12;

/** Offers per page. */
export const PAGE_SIZE = 25;

/**
 * URL query params -> JobFilters, the one mapping every consumer parses
 * against. Les clés techniques historiques (`employmentTerm`, `workTime`,
 * `programType`, `market`) restent LUES pour les liens déjà partagés ; rien ne
 * les émet plus.
 */
export function parseFilters(params: Record<string, string | string[] | undefined>): JobFilters {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 200) || undefined;
  };
  const many = (key: string): string[] | undefined => {
    const value = params[key];
    if (value === undefined) return undefined;
    const brut = Array.isArray(value) ? value : [value];
    const vues = new Set<string>();
    for (const x of brut) {
      const propre = x?.trim().slice(0, 200);
      if (propre) vues.add(propre);
      if (vues.size >= MAX_VALUES) break;
    }
    return vues.size ? [...vues] : undefined;
  };
  const filtres: Selections = {};
  // `monde` désignait « tous les pays » avant le lot 6 ; dans un périmètre, il
  // ne restreint rien et disparaît sans devenir un pays fantôme.
  const pays = many('pays')?.filter((v) => v !== 'monde').map((v) => v.toUpperCase());
  if (pays?.length) filtres.pays = pays;
  const lire = (cle: Dimension, ...alias: string[]) => {
    const valeurs = many(cle) ?? alias.map(many).find(Boolean);
    if (valeurs?.length) filtres[cle] = valeurs;
  };
  lire('metier');
  lire('secteur');
  lire('contrat', 'employmentTerm');
  lire('temps', 'workTime');
  lire('programme', 'programType');
  lire('ville');
  lire('maison');
  lire('groupe');
  const langues = normalizedLanguages(many('langue'));
  if (langues) filtres.langue = langues;

  const apres = params.apres;
  const jeton = (Array.isArray(apres) ? apres[0] : apres)?.trim().slice(0, CURSEUR_MAX + 1) || undefined;

  return {
    q: one('q'),
    lieu: one('lieu'),
    filtres,
    prioritePays: normalizedPriority(one('prioritePays')),
    marche: one('marche') ?? one('market'),
    apres: jeton,
  };
}

/** Deux lettres ISO-639-1 en minuscules, sinon rien : jamais une valeur libre en SQL. */
function normalizedLanguages(vs: string[] | undefined): string[] | undefined {
  const ok = vs?.filter((v) => /^[a-z]{2}$/i.test(v)).map((v) => v.toLowerCase());
  return ok?.length ? ok : undefined;
}
/** Deux lettres ISO-3166 en majuscules, sinon rien. */
function normalizedPriority(v: string | undefined): string | undefined {
  return v && /^[a-z]{2}$/i.test(v) ? v.toUpperCase() : undefined;
}
/** D'où vient l'offre : publiée sur Catwalks par une Maison, ou agrégée depuis une source. */
export type Origine = 'CATWALKS' | 'AGREGEE';

/**
 * L'ACTION DE CANDIDATURE, explicite dans le contrat (passation §2.3) : jamais
 * déduite d'un domaine ni d'une forme d'identifiant. `CATWALKS` ouvre le
 * parcours de candidature du site ; `EXTERNE` sort vers l'employeur, en
 * http(s) seulement ; `AUCUNE` quand la source n'a donné aucun lien exploitable.
 */
export type ActionCandidature =
  | { type: 'CATWALKS'; offreId: string; slug: string; url: string }
  | { type: 'EXTERNE'; url: string }
  | { type: 'AUCUNE' };

/** D-435 — une ligne confirme la recherche, ou reste non confirmée sur des dimensions nommées. */
export type Correspondance =
  | { statut: 'CONFIRMEE' }
  | { statut: 'NON_CONFIRMEE'; dimensions: Dimension[] };

export type JobRow = {
  id: string;
  origine: Origine;
  candidature: ActionCandidature;
  title: string;
  company: string;
  /** The Maison's own domain (`sephora.com`) for its logo; null when no source names it. */
  companyDomain: string | null;
  group: string | null;
  city: string | null;
  location: string | null;
  /** Les dimensions d'emploi, indépendantes : durée, rythme, dispositif, nature, saisonnier. */
  employmentTerm: string | null;
  programType: string | null;
  engagementType: string | null;
  isSeasonal: boolean | null;
  sector: string | null;
  sectorCodes?: string[];
  postedAt: Date | null;
  withdrawnAt?: Date | null;
  opportunityType?: 'JOB_OPENING' | 'OPEN_APPLICATION' | null;
  latitude: number | null;
  longitude: number | null;
  sourceCount: number;
  /** Registry keys of every source that reported this job. */
  sources: string[];
  /** Full posting text: ATS APIs return it with the listing, no extra fetch. */
  description: string | null;
  /** Employer-side apply URL of the highest-ranked source. */
  applyUrl: string;
  /** Complete optional facts of the selected available publication, with explicit coverage status. */
  sourceFacts?: PublicSourceFacts | null;
  postalCode: string | null;
  department: string | null;
  /** Métier et séniorité (taxonomie D38) : ce qui distingue deux offres d'une même Maison dans la liste. */
  jobFunction: string | null;
  occupationCode?: string | null;
  occupationLabel?: string | null;
  seniorityLabel?: string | null;
  occupationFamilyLabel?: string | null;
  occupationStatus?: string;
  seniority: string | null;
  workTime: string | null;
  workplaceType: string | null;
  experienceYears: number | null;
  educationLevel: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  validThrough: Date | null;
  /** Code pays ISO-2 tel que stocké ; libellé via lib/countries. */
  countryCode: string | null;
  /**
   * La PROVENANCE du pays, telle que l'ingestion l'a établie — le verdict qui
   * autorise (ou non) le balisage sous un code ambigu (`CA`, `IN`, `DE`…).
   * Liste positive fermée : `RAW_COUNTRY_CODE`, `RAW_COUNTRY`, `VERIFIED`.
   */
  countryIntegrity: string | null;
  /** ISO-639-1 language of the posting text, when detected at ingest. */
  language: string | null;
  /** Our first sighting, separate from the employer's publication date. */
  firstSeenAt: Date;
  /** Posée par la recherche seulement : absente sur une fiche ou une offre similaire. */
  correspondance?: Correspondance;
};

/** Le périmètre servi, tel que la réponse le décrit au site. */
export type PerimetreServi = {
  code: string;
  nom: string;
  pays: string[];
  /** `true` pour un marché mesuré du registre ; `false` pour un pays servi seul, sans facettes natives. */
  mesure: boolean;
  locales: string[];
  localeParDefaut: string;
};

export type JobsResult = {
  occupationEnrichmentAvailable?: boolean;
  /** One page of results, not the whole match set. */
  jobs: JobRow[];
  /** Every row matching the search inside the perimeter, confirmed or not. */
  total: number;
  /** Rows whose every filtered tolerant dimension is declared (D-435). */
  totalConfirmes: number;
  /** Every live offer of the perimeter, ignoring the search. */
  totalPerimetre: number;
  /** Le curseur de la page suivante (lot 7), ou `null` quand cette page est la dernière. */
  suivant: string | null;
  perimetre: PerimetreServi;
  /** Le contrat de facettes du périmètre, dans l'ordre d'affichage, options comptées et libellées. */
  facettes: FacetteServie[];
  /** Les filtres et le lieu que ce périmètre ne peut pas honorer, nommés ; les résultats sont calculés sans eux. */
  filtresRefuses: FiltreRefuse[];
  /** Ce que le moteur a compris du champ « lieu », même refusé. */
  lieu: { type: LieuResolu['type']; libelle: string } | null;
};

export function perimetreServi(perimetre: Perimetre): PerimetreServi {
  const m = perimetre.marche;
  return {
    code: perimetre.code,
    nom: m?.nom ?? perimetre.code,
    pays: [...perimetre.pays],
    mesure: m !== undefined,
    locales: m ? [...m.locales] : ['fr-FR'],
    localeParDefaut: m?.localeParDefaut ?? 'fr-FR',
  };
}

/** Seuls http et https sont des liens de candidature ; tout le reste est neutralisé. */
export function actionExterne(url: string | null | undefined): ActionCandidature {
  if (!url) return { type: 'AUCUNE' };
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? { type: 'EXTERNE', url: u.toString() } : { type: 'AUCUNE' };
  } catch {
    return { type: 'AUCUNE' };
  }
}

function toRow(row: {
  id: string; url: string; firstSeenAt: Date; withdrawnAt?: Date | null;
  canonicalSourceKey?: string | null; canonicalExternalId?: string | null;
  company: { name: string; sector: string | null; parentGroup: string | null; domain: string | null; sectorCodes?: string[] };
  sources: Array<ApplySource & PresentationSource>;
}, taxonomy: OptionalOccupationPresentation, historical = false, at = new Date()): JobRow {
  const live = row.sources.filter(source => sourceIsAvailable(source, at));
  const publication = selectApplySource(live, row, at) ?? (historical ? row.sources.find(source => source.url === row.url) : undefined);
  const content = publication && publicationContentOf(publication);
  if (!content) throw new Error(`PUBLICATION_PRESENTATION_REBUILD_REQUIRED job=${row.id}`);
  const occupation = taxonomy.available ? taxonomy.taxonomy.classify(content.title, content.department) : null;
  const applyUrl = publication.url;
  const sourceFacts = publicSourceFacts(publication?.sourceFacts);
  const scalars = scalarSourceFacts(sourceFacts);
  const min = publicAmount(scalars.salaryMin), max = publicAmount(scalars.salaryMax);
  const completeSalary = !!scalars.salaryCurrency && !!scalars.salaryPeriod &&
    (scalars.salaryMin === null || min !== null) && (scalars.salaryMax === null || max !== null);
  return {
    id: row.id,
    origine: 'AGREGEE',
    candidature: actionExterne(applyUrl),
    title: content.title,
    company: row.company.name,
    companyDomain: row.company.domain,
    group: row.company.parentGroup,
    city: content.city,
    location: content.location,
    employmentTerm: content.employmentTerm,
    programType: content.programType,
    engagementType: content.engagementType,
    isSeasonal: content.isSeasonal,
    sector: row.company.sector,
    sectorCodes: row.company.sectorCodes ?? [],
    postedAt: content.postedAt,
    withdrawnAt: row.withdrawnAt ?? null,
    opportunityType: content.opportunityType ?? null,
    latitude: scalars.latitude,
    longitude: scalars.longitude,
    sourceCount: live.length,
    sources: live.map((source) => source.sourceKey),
    description: content.description,
    applyUrl,
    sourceFacts,
    postalCode: scalars.postalCode,
    department: content.department,
    jobFunction: occupation?.jobFunction ?? null,
    seniorityLabel: occupation?.seniority ? taxonomy.seniorityLabel(occupation.seniority) : null,
    occupationCode: occupation?.occupationCode ?? null,
    occupationLabel: taxonomy.occupationLabel(occupation?.occupationCode),
    occupationFamilyLabel: taxonomy.functionLabel(occupation?.jobFunction),
    occupationStatus: occupation?.occupationStatus ?? 'UNAVAILABLE',
    seniority: occupation?.seniority ?? null,
    workTime: content.workTime,
    workplaceType: scalars.workplaceType,
    experienceYears: content.experienceYears,
    educationLevel: scalars.educationLevel,
    salaryMin: completeSalary ? min : null,
    salaryMax: completeSalary ? max : null,
    salaryCurrency: completeSalary ? scalars.salaryCurrency : null,
    salaryPeriod: completeSalary ? scalars.salaryPeriod : null,
    validThrough: publication?.expiresAt ?? null,
    countryCode: content.countryCode,
    countryIntegrity: content.countryIntegrity,
    language: content.language,
    firstSeenAt: row.firstSeenAt,
  };
}

/** La colonne d'une ligne qui porte chaque dimension tolérante. */
const CHAMP_TOLERANT: Record<DimensionTolerante, (row: JobRow) => string | null> = {
  contrat: (row) => row.employmentTerm,
  temps: (row) => row.workTime,
  programme: (row) => row.programType,
  langue: (row) => row.language,
};

/**
 * D-435 — une offre non renseignée sur une dimension filtrée reste servie,
 * jamais présentée comme une correspondance confirmée : la ligne nomme les
 * dimensions qu'elle laisse ouvertes.
 */
export function correspondance(row: JobRow, selections: Selections): Correspondance {
  const ouvertes = DIMENSIONS_TOLERANTES.filter((d) => selections[d]?.length && CHAMP_TOLERANT[d](row) === null);
  return ouvertes.length ? { statut: 'NON_CONFIRMEE', dimensions: ouvertes } : { statut: 'CONFIRMEE' };
}

/** A public withdrawal never asserts that the employer closed its vacancy. */
function publicOfferState(row: { isActive: boolean; withdrawnAt: Date | null; closedAt: Date | null;
  sources: Array<ApplySource>; canonicalSourceKey?: string | null; canonicalExternalId?: string | null; url: string }, at: Date) {
  if (row.withdrawnAt) return 'withdrawn' as const;
  if (row.isActive && selectApplySource(row.sources, row, at)) return 'active' as const;
  const expired = row.sources.length > 0 && row.sources.every(source => source.expiresAt && source.expiresAt <= at);
  return row.closedAt || expired ? 'closed' as const : 'withdrawn' as const;
}

export async function getJobStatus(
  id: string,
): Promise<
  | { status: 'active'; job: JobRow }
  // A closed offer still carries its content: the page shows it with an
  // "expirée" banner (§4.13) while the middleware serves 410 for SEO (D22).
  | { status: 'closed'; job: JobRow }
  | { status: 'withdrawn'; canonicalId: string; job: JobRow | null }
  | { status: 'missing' }
> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    // Une offre directe : son espace d'identifiants est le sien ; retirée par
    // le backend ou échue, elle est « fermée » — jamais « retirée » au sens
    // d'un retrait de catalogue, puisque c'est l'employeur lui-même qui parle.
    if (estIdDirect(id)) {
      const direct = await prisma.directOffer.findUnique({ where: { id: idDirect(id) } });
      return direct ? { status: statutDirect(direct), job: directToRow(direct) } : { status: 'missing' };
    }
    const canonicalId = await canonicalJobId(prisma, id);
    if (!canonicalId) return { status: 'missing' };
    const row = await prisma.job.findUnique({
      where: { id: canonicalId },
      omit: { raw: true, searchText: true },
      include: {
        company: true,
        sources: { select: publicSources().select },
      },
    });
    if (!row) return { status: 'missing' };
    const at = new Date(), status = publicOfferState(row, at);
    if (status === 'withdrawn') {
      const owner = selectApplySource(row.sources, row, at) ?? row.sources.find(source => source.url === row.url);
      const presentable = row.withdrawalReason !== 'PUBLICATION_UNVERIFIED' && owner && publicationContentOf(owner);
      return { status, canonicalId, job: presentable ? toRow(row, await getOptionalOccupationPresentation(), true, at) : null };
    }
    return { status, job: toRow(row, await getOptionalOccupationPresentation(), status === 'closed', at) };
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}

/**
 * The status probe requires one usable publication and returns no listing payload.
 */
export async function getOfferState(param: string): Promise<'active' | 'closed' | 'withdrawn' | 'missing'> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    // The param may be a bare id or slug-id (S-01) — try each candidate, so
    // the middleware's 410 decision works on both URL shapes.
    for (const id of offerIdCandidates(param)) {
      if (estIdDirect(id)) {
        const direct = await prisma.directOffer.findUnique({ where: { id: idDirect(id) }, select: { eligible: true, validThrough: true } });
        if (direct) return statutDirect(direct);
        continue;
      }
      const canonicalId = await canonicalJobId(prisma, id);
      if (!canonicalId) continue;
      const row = await prisma.job.findUnique({ where: { id: canonicalId }, select: { isActive: true, withdrawnAt: true, closedAt: true,
        canonicalSourceKey: true, canonicalExternalId: true, url: true, sources: { select: publicSources().select } } });
      if (row) {
        const at = new Date(), status = publicOfferState(row, at);
        if (status !== 'active') return status;
        const owner = selectApplySource(row.sources, row, at)!;
        if (!publicationContentOf(owner)) throw new Error(`PUBLICATION_PRESENTATION_REBUILD_REQUIRED job=${canonicalId}`);
        return 'active';
      }
    }
    return 'missing';
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}

/**
 * Resolves a /offre/[param] value (bare id or slug-id) to the offer.
 * Returns the state plus the id that matched, so the page can 301 a stale or
 * missing slug to the canonical URL.
 */
export async function resolveOfferParam(
  param: string,
): Promise<
  | { status: 'active' | 'closed'; job: JobRow; matchedId: string }
  | { status: 'withdrawn'; canonicalId: string; job: JobRow | null; matchedId: string }
  | { status: 'missing' }
> {
  for (const id of offerIdCandidates(param)) {
    const state = await getJobStatus(id);
    if (state.status !== 'missing') return { ...state, matchedId: id };
  }
  return { status: 'missing' };
}

/**
 * Le bloc Maison de la colonne latérale d'une offre (DA §5.3) : combien
 * d'offres ouvertes, dans combien de villes et de pays.
 *
 * Une seule requête agrégée — la page offre est la plus vue du site, elle ne
 * peut pas se permettre de charger les offres d'une Maison pour les compter.
 */
export type CompanyAside = { openJobs: number; cities: number; countries: number; domain: string | null; sector: string | null; group: string | null };

export async function getCompanyAside(companyName: string): Promise<CompanyAside | null> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    const at = new Date();
    const company = await prisma.company.findFirst({
      where: { name: companyName },
      select: { id: true, domain: true, sector: true, sectorCodes: true, parentGroup: true },
    });
    // Une Maison qui publie sur Catwalks compte ses offres directes avec ses
    // offres agrégées ; une Maison connue par ses seules offres directes a
    // aussi son bloc, sans domaine ni groupe (le registre ne la connaît pas).
    const [agg] = await prisma.$queryRaw<{ jobs: bigint; cities: bigint; countries: bigint }[]>`
      SELECT count(*)::bigint AS jobs,
             count(DISTINCT lower(city))::bigint AS cities,
             count(DISTINCT "countryCode")::bigint AS countries
      FROM (
        SELECT j.city, j."countryCode" FROM "Job" j WHERE j."companyId" = ${company?.id ?? ''} AND ${publicJobSql(Prisma.sql`j`, at)}
        UNION ALL
        SELECT d.city, d."countryCode" FROM "DirectOffer" d WHERE d.company = ${companyName} AND ${directPubliableSql(Prisma.sql`d`, at)}
      ) offres`;
    const openJobs = Number(agg?.jobs ?? 0);
    if (!company && openJobs === 0) return null;
    return {
      openJobs,
      cities: Number(agg?.cities ?? 0),
      countries: Number(agg?.countries ?? 0),
      domain: company?.domain ?? null,
      sector: company?.sector ?? null,
      group: company?.parentGroup ?? null,
    };
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) throw error;
    throw new DatabaseUnavailableError(error);
  }
}

export async function getSimilarJobs(job: JobRow, limit = 6): Promise<JobRow[]> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    const base = {
      ...publicJobWhere(),
      id: { not: job.id },
    };
    const include = {
      company: true,
      sources: publicSources(),
    };
    // Audit UX 14/09 (M5) : une offre à Bordeaux proposait Glasgow et
    // Limerick. Même Maison ET même pays d'abord ; le pays seul ensuite.
    const memePays = job.countryCode ? { countryCode: job.countryCode } : {};
    const taxonomy = await getOptionalOccupationPresentation();
    const ordre: Prisma.JobOrderByWithRelationInput[] = [{ postedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }];
    // D-419 §1 : les offres Catwalks de la même Maison, dans le même pays, ouvrent la liste.
    const directes = (await prisma.directOffer.findMany({
      where: { ...directPubliable(), ...memePays, company: job.company, ...(job.origine === 'CATWALKS' ? { id: { not: idDirect(job.id) } } : {}) },
      // `postedAt` d'une offre directe est toujours renseigné : tri simple.
      orderBy: [{ postedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    })).map(directToRow);
    if (directes.length >= limit) return directes;
    const sameMaison = await prisma.job.findMany({
      where: { ...base, ...memePays, company: { name: job.company } },
      include,
      omit: { raw: true, searchText: true },
      orderBy: [...ordre],
      take: limit - directes.length,
    });
    const memeMaison = [...directes, ...sameMaison.map((row) => toRow(row, taxonomy))];
    if (memeMaison.length >= limit) return memeMaison;

    const sectorCodes = job.sectorCodes ?? [];
    const fill = sectorCodes.length
      ? await prisma.job.findMany({
          where: {
            ...base,
            ...memePays,
            company: { sectorCodes: { hasSome: sectorCodes }, name: { not: job.company } },
            ...(job.city ? { city: { equals: job.city, mode: 'insensitive' as const } } : {}),
          },
          include,
          omit: { raw: true, searchText: true },
          orderBy: [...ordre],
          take: limit - memeMaison.length,
        })
      : [];
    return [...memeMaison, ...fill.map((row) => toRow(row, taxonomy))];
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}

/**
 * LA RECHERCHE (lot 6) : un périmètre obligatoire, un plan, une requête.
 *
 * `exigerPerimetre` lève `PerimetreRequisError` sur un marché absent ou
 * inconnu — la route en fait un 400, jamais une liste mondiale. Le plan
 * décide des filtres honorés et refusés ; le SQL les applique ; les facettes
 * sont libellées depuis le registre et le vocabulaire unique.
 */
/**
 * L'empreinte d'un plan : ce qui, changé, rendrait un curseur vide de sens —
 * le périmètre, les termes, le lieu honoré, les sélections, le pays prioritaire.
 */
function empreintePlan(plan: ReturnType<typeof planifierRecherche>): string {
  return empreinteCriteres({
    perimetre: plan.perimetre.code, termes: plan.termes, lieu: plan.lieu ?? null,
    selections: Object.fromEntries(DIMENSIONS.flatMap((d) => (plan.selections[d]?.length ? [[d, [...plan.selections[d]!].sort()]] : []))),
    prioritePays: plan.prioritePays ?? null, source: plan.source ?? null,
  });
}

export async function getJobs(filters: JobFilters): Promise<JobsResult> {
  const perimetre = exigerPerimetre(filters.marche);
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();

  const plan = planifierRecherche(perimetre, filters);
  const empreinte = empreintePlan(plan);
  // Un curseur d'autres critères est refusé AVANT toute requête (400 CURSEUR_INVALIDE).
  const curseur = filters.apres ? (decoderCurseur(filters.apres, empreinte, ARITE_CLE_RECHERCHE) as CleRecherche) : null;
  try {
    const taxonomy = await getOptionalOccupationPresentation();
    const summary = await searchSummary(plan, curseur, PAGE_SIZE, taxonomy);
    // La page mêle les deux origines dans l'ordre du SQL ; chaque origine est
    // relue dans sa table, et la ligne servie a la même forme pour les deux.
    const idsDirects = summary.ids.filter(estIdDirect).map(idDirect);
    const [rows, directes] = await Promise.all([
      prisma.job.findMany({
        where: { ...publicJobWhere(), id: { in: summary.ids.filter((id) => !estIdDirect(id)) } },
        omit: { raw: true, searchText: true },
        include: { company: true, sources: publicSources() },
      }),
      idsDirects.length ? prisma.directOffer.findMany({ where: { id: { in: idsDirects } } }) : [],
    ]);
    const byId = new Map<string, JobRow>([
      ...rows.map((row): [string, JobRow] => [row.id, toRow(row, taxonomy)]),
      ...directes.map((d): [string, JobRow] => {
        const ligne = directToRow(d);
        return [ligne.id, ligne];
      }),
    ]);
    const jobs = summary.ids.flatMap((id) => {
      const ligne = byId.get(id);
      return ligne ? [{ ...ligne, correspondance: correspondance(ligne, plan.selections) }] : [];
    });
    return {
      jobs,
      occupationEnrichmentAvailable: taxonomy.available,
      total: summary.total,
      totalConfirmes: summary.totalConfirmes,
      totalPerimetre: summary.totalPerimetre,
      suivant: summary.suivant ? encoderCurseur(empreinte, summary.suivant) : null,
      perimetre: perimetreServi(perimetre),
      facettes: await libellerFacettes(plan, summary.facettes, taxonomy),
      filtresRefuses: plan.refus,
      lieu: plan.lieuCompris ?? null,
    };
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}

export { DIMENSIONS };
