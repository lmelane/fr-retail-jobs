import { SEARCH_VERSION } from './search-index';
import { publicationContentOf, type PresentationSource } from '@catwalks/db/publication-presentation';
import { publicAmount } from '@catwalks/db/money';
import { availableSourceWhere, publicJobWhere, publicJobSql, sourceIsAvailable, sourceIsConfirmed } from '@catwalks/db/availability';
import { selectApplySource, type ApplySource } from '@catwalks/db/publications';
import { publicSourceFacts, scalarSourceFacts, type PublicSourceFacts } from '@catwalks/db/source-facts';
import { MARCHES, localeServie, type Perimetre } from '@catwalks/db/marches';
import { langueDesLibelles, type LangueLibelles } from '@catwalks/db/presentation';
import { getOptionalOccupationPresentation, type OptionalOccupationPresentation } from './occupations';
import { prisma, Prisma, canonicalJobId } from '@catwalks/db';
import type { DirectOffer } from '@prisma/client';
import { ARITE_CLE_FRAICHEUR, ARITE_CLE_RECHERCHE, ARITE_CLE_SCORE, examenNouveautes, searchSummary, type CleFraicheur, type CleRecherche, type CleScore } from './job-search-query';
import { instantDeReference, lireClassement, type Classement } from './classement';
import { fraicheurDe, trierParFraicheur } from './fraicheur';
import { CURSEUR_MAX, CurseurInvalideError, decoderCurseur, empreinteCriteres, encoderCurseur } from './curseur';
import { directPubliable, directPubliableSql, directToRow, estIdDirect, estMandatCatwalks, idDirect, statutDirect } from './direct-offers';
import { offerIdCandidates } from './offer-url';
import { localeAffichage } from './presentation-locale';
import { libellerFacettes, type FacetteServie } from './facettes';
import { exigerPerimetre, resoudrePerimetre } from './perimetre';
import { localiserPlan } from './geo';
import { DIMENSIONS, planifierRecherche, type CriteresRecherche, type Dimension, type FiltreRefuse, type PreferencesClassement, type Selections } from './search-plan';
import type { LieuResolu } from './lieu';

/** Sector keys are data, not an application enum. Unknown keys stay bound
 * parameters and match zero; dropping them would silently widen the search. */
const publicSources = () => ({
  select: { sourceKey: true, externalId: true, sourceTier: true, isActive: true, url: true, expiresAt: true, sourceFacts: true, presentation: true, captureBatchId: true, captureOutputId: true,
    availabilityHold: true } as const,
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
export type JobFilters = CriteresRecherche & {
  marche?: string; apres?: string; locale?: string;
  /**
   * D-496 : le client annonce le contrat de proximité (`contrat-client.ts`) ; posé par la route, jamais lu dans l'URL.
   * Absent : la recherche d'avant le lot, à l'identique.
   */
  proximite?: boolean;
  // D-500 : `comprendre` (CriteresRecherche), posé par la route avec le même signal du client que la proximité.
  // D-510 : `fraicheur` (CriteresRecherche), de même : le tri par fraîcheur.
};

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
  const preferences = lirePreferences(one, many);

  return {
    q: (Array.isArray(params.q) ? params.q[0] : params.q)?.trim() || undefined,
    lieu: one('lieu'),
    filtres,
    prioritePays: normalizedPriority(one('prioritePays')),
    marche: one('marche') ?? one('market'),
    apres: jeton,
    locale: one('locale'),
    ...(preferences ? { preferences } : {}),
  };
}

/**
 * R-143 §7 — les préférences de l'inscrit que le site transmet pour le classement (`pref_metier`, `pref_lieu`,
 * `pref_contrat` répétés ; `pref_teletravail` = `oui` | `non` ; `pref_salaire` = `montant:DEVISE:HOUR|MONTH|YEAR`). Elles
 * ne filtrent rien ; `planifierRecherche` les nettoie et ne les lit qu'au contrat 2.
 */
function lirePreferences(one: (k: string) => string | undefined, many: (k: string) => string[] | undefined): PreferencesClassement | undefined {
  const teletravail = one('pref_teletravail');
  const salaire = one('pref_salaire')?.match(/^(\d{1,9}(?:\.\d{1,2})?):([A-Za-z]{3}):(HOUR|MONTH|YEAR)$/);
  const p: PreferencesClassement = {
    metiers: many('pref_metier'), lieux: many('pref_lieu'), contrats: many('pref_contrat'),
    ...(teletravail === 'oui' ? { teletravail: true } : teletravail === 'non' ? { teletravail: false } : {}),
    ...(salaire ? { salaire: { montant: Number(salaire[1]), devise: salaire[2].toUpperCase(), periode: salaire[3] as 'HOUR' | 'MONTH' | 'YEAR' } } : {}),
  };
  return p.metiers || p.lieux || p.contrats || p.teletravail !== undefined || p.salaire ? p : undefined;
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
  /**
   * La société du registre : celle d'une offre agrégée ; pour une offre Catwalks, celle que le lecteur lui a rattachée
   * (lien du back-office, sinon nom — D-444, D-471), `null` pour un mandat ou une Maison hors registre. Le bloc Maison
   * et les offres « même employeur » la suivent avant le nom publié.
   */
  companyId?: string | null;
  /**
   * D-471 : le visuel généré d'une offre Catwalks (URL du bucket public), affiché en tête de sa fiche. Absent d'une offre
   * agrégée ; retiré des lignes de liste, qui ne l'affichent pas (`projeterLigne`).
   */
  visuel?: string | null;
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
  /**
   * R-143 §7 : posé par la recherche au classement pertinent seulement (contrat 2, requête ou préférences) : les critères
   * qui ont joué, l'âge de l'offre et son score (`classement.ts`). Absent dans l'ordre par fraîcheur et au contrat 1.
   */
  classement?: Classement;
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
  /** La langue des libellés d'emploi, de pays et de langue servis (lot 8) : celle du marché si un catalogue existe, sinon `fr`. */
  langueDesLibelles: LangueLibelles;
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

export function perimetreServi(perimetre: Perimetre, locale?: string): PerimetreServi {
  const m = perimetre.marche;
  return {
    code: perimetre.code,
    nom: m?.nom ?? perimetre.code,
    pays: [...perimetre.pays],
    mesure: m !== undefined,
    locales: m ? [...m.locales] : ['fr-FR'],
    localeParDefaut: m?.localeParDefaut ?? 'fr-FR',
    // La locale explicite ne change que la présentation ; sinon, repli prévu par le marché.
    langueDesLibelles: langueDesLibelles(localeAffichage(locale, perimetre)),
  };
}

/**
 * La langue des libellés d'une offre lue seule : celle du marché qui sert son
 * pays (une offre irlandaise appartient au marché GB, une autrichienne au
 * marché DE), sinon celle d'un pays servi seul, c'est-à-dire le français (lot 8).
 */
export function langueDesLibellesDuPays(countryCode: string | null | undefined): LangueLibelles {
  const code = countryCode?.trim().toUpperCase();
  if (!code) return 'fr';
  const marche = Object.values(MARCHES).find((m) => m.pays.includes(code));
  // Même règle qu'au-dessus : la locale SERVIE, jamais la locale cible — sinon un marché en
  // repli retombe sur le français faute de catalogue dans sa langue native.
  return langueDesLibelles(localeServie(marche) ?? localeServie(resoudrePerimetre(code)?.marche));
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
  company: { id?: string; name: string; sector: string | null; parentGroup: string | null; domain: string | null; sectorCodes?: string[] };
  sources: Array<ApplySource & PresentationSource & { availabilityHold?: string | null }>;
}, taxonomy: OptionalOccupationPresentation, historical = false, at = new Date()): JobRow {
  // R-143 §2 : le lien « Postuler » vient d'une publication confirmée quand l'offre en a une ; sinon, comme avant.
  const available = row.sources.filter(source => sourceIsAvailable(source, at));
  const confirmed = available.filter(source => sourceIsConfirmed(source, at));
  const live = confirmed.length ? confirmed : available;
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
    companyId: row.company.id ?? null,
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
  langue: LangueLibelles = 'fr',
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
      return { status, canonicalId, job: presentable ? toRow(row, await getOptionalOccupationPresentation(langue), true, at) : null };
    }
    return { status, job: toRow(row, await getOptionalOccupationPresentation(langue), status === 'closed', at) };
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
  langue?: LangueLibelles,
): Promise<
  | { status: 'active' | 'closed'; job: JobRow; matchedId: string }
  | { status: 'withdrawn'; canonicalId: string; job: JobRow | null; matchedId: string }
  | { status: 'missing' }
> {
  for (const id of offerIdCandidates(param)) {
    const state = await getJobStatus(id, langue);
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

export async function getCompanyAside(companyName: string, companyId: string | null = null): Promise<CompanyAside | null> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    const at = new Date();
    // D-471 : la société rattachée d'abord (le nom publié par le backend peut s'écrire autrement qu'au registre :
    // « Lancel » et « LANCEL »), le nom exact seulement à défaut.
    const select = { id: true, domain: true, sector: true, sectorCodes: true, parentGroup: true } as const;
    const company = companyId
      ? await prisma.company.findUnique({ where: { id: companyId }, select })
      : await prisma.company.findFirst({ where: { name: companyName }, select });
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
        SELECT d.city, d."countryCode" FROM "DirectOffer" d
        WHERE (d.company = ${companyName} OR d."companyId" = ${company?.id ?? ''}) AND ${directPubliableSql(Prisma.sql`d`, at)}
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

/**
 * Les offres similaires d'une fiche, par blocs (D-468, D-470, D-471) : la même Maison et le même pays (ses offres
 * Catwalks, puis ses offres agrégées), puis le même secteur (les offres Catwalks, puis les agrégées). D-470 §1 a écarté
 * « toutes les offres Catwalks avant même les offres agrégées de la même Maison » : les blocs restent. D-510 (contrat 2,
 * `fraicheur`) : dans chaque bloc, la plus fraîche d'abord (`trierParFraicheur`) ; sans le contrat 2, l'ordre d'avant.
 */
export async function getSimilarJobs(job: JobRow, limit = 6, langue: LangueLibelles = 'fr', fraicheur = false): Promise<JobRow[]> {
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
    const taxonomy = await getOptionalOccupationPresentation(langue);
    const ordre: Prisma.JobOrderByWithRelationInput[] = [{ postedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }];
    // D-471 : « même employeur » suit la société du registre quand l'offre en a une, le nom publié à défaut. Sous `AND` :
    // `directPubliable()` porte déjà un `OR`, qu'un second `OR` étalé à côté écraserait.
    const societe = job.companyId ?? null;
    const memeSocieteDirecte: Prisma.DirectOfferWhereInput = societe ? { OR: [{ companyId: societe }, { company: job.company }] } : { company: job.company };
    // D-510 : la fraîcheur de chaque offre lue, sur ses colonnes (celles du tri de la recherche), avant sa projection.
    const fraicheurs = new Map<string, number>();
    const directeLue = (d: DirectOffer): JobRow => {
      const ligne = directToRow(d);
      fraicheurs.set(ligne.id, fraicheurDe({ postedAt: d.postedAt, firstSeenAt: d.receivedAt }));
      return ligne;
    };
    const agregeeLue = (row: Parameters<typeof toRow>[0] & { postedAt: Date | null; firstSeenAt: Date }): JobRow => {
      fraicheurs.set(row.id, fraicheurDe(row));
      return toRow(row, taxonomy);
    };
    // Un bloc est d'une seule origine : le tri y range la plus fraîche d'abord, puis l'identifiant.
    const trier = (bloc: JobRow[]) => (fraicheur ? trierParFraicheur(bloc, (l) => fraicheurs.get(l.id) ?? fraicheurDe(l)) : bloc);
    const memeEmployeur = async (): Promise<JobRow[]> => {
      // D-419 §1 : les offres Catwalks de la même Maison, dans le même pays, ouvrent la liste.
      const directes = trier((await prisma.directOffer.findMany({
        where: { ...directPubliable(), ...memePays, AND: [memeSocieteDirecte], ...(job.origine === 'CATWALKS' ? { id: { not: idDirect(job.id) } } : {}) },
        // `postedAt` d'une offre directe est toujours renseigné : tri simple.
        orderBy: [{ postedAt: 'desc' }, { id: 'asc' }],
        take: limit,
      })).map(directeLue));
      if (directes.length >= limit) return directes;
      const sameMaison = await prisma.job.findMany({
        where: { ...base, ...memePays, ...(societe ? { companyId: societe } : { company: { name: job.company } }) },
        include,
        omit: { raw: true, searchText: true },
        orderBy: [...ordre],
        take: limit - directes.length,
      });
      return [...directes, ...trier(sameMaison.map(agregeeLue))];
    };
    // D-456 §4 : « Catwalks » ne nomme pas un employeur commun aux mandats sans Maison publique. Sur leur fiche, le bloc
    // « même employeur » (offres directes, puis agrégées) ne propose rien : la liste passe directement au remplissage.
    const memeMaison = estMandatCatwalks(job) ? [] : await memeEmployeur();
    if (memeMaison.length >= limit) return memeMaison;

    const sectorCodes = job.sectorCodes ?? [];
    if (!sectorCodes.length) return memeMaison;
    const memeVille = job.city ? { city: { equals: job.city, mode: 'insensitive' as const } } : {};
    // D-468 §1 : le remplissage retrouve aussi les offres Catwalks du même secteur, dans la même ville et le même pays,
    // et elles l'ouvrent (D-419 §1). Jamais l'employeur de l'offre elle-même, déjà servi par le bloc « même employeur » ;
    // sur la fiche d'un mandat, cet employeur est « Catwalks » : aucun autre mandat n'y est proposé (D-456 §4).
    const directesRemplissage = trier((await prisma.directOffer.findMany({
      where: {
        ...directPubliable(), ...memePays, ...memeVille,
        sectorCodes: { hasSome: sectorCodes },
        company: { not: job.company },
        // Une offre sans société (mandat, Maison hors registre) reste candidate : `NOT companyId = x` l'écarterait (NULL).
        ...(societe ? { AND: [{ OR: [{ companyId: null }, { companyId: { not: societe } }] }] } : {}),
        ...(job.origine === 'CATWALKS' ? { id: { not: idDirect(job.id) } } : {}),
      },
      orderBy: [{ postedAt: 'desc' }, { id: 'asc' }],
      take: limit - memeMaison.length,
    })).map(directeLue));
    const reste = limit - memeMaison.length - directesRemplissage.length;
    const fill = reste > 0
      ? await prisma.job.findMany({
          where: {
            ...base,
            ...memePays,
            company: { sectorCodes: { hasSome: sectorCodes }, name: { not: job.company } },
            ...(societe ? { companyId: { not: societe } } : {}),
            ...memeVille,
          },
          include,
          omit: { raw: true, searchText: true },
          orderBy: [...ordre],
          take: reste,
        })
      : [];
    return [...memeMaison, ...directesRemplissage, ...trier(fill.map(agregeeLue))];
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
  // D-496 : les villes trouvées entrent dans l'empreinte (un autre point, un autre ordre) ; sans ville trouvée, la clé
  // `proximite` est absente et l'empreinte reste celle d'avant (les curseurs déjà servis restent lisibles).
  const p = plan.proximite;
  const point = (v: { id: string; latitude: number; longitude: number }) => [v.id, v.latitude, v.longitude];
  return empreinteCriteres({
    version: `${SEARCH_VERSION}-strict-filters-fr-2`, perimetre: plan.perimetre.code, q: plan.q, lieu: plan.lieu ?? null,
    selections: Object.fromEntries(DIMENSIONS.flatMap((d) => (plan.selections[d]?.length ? [[d, [...plan.selections[d]!].sort()]] : []))),
    prioritePays: plan.prioritePays ?? null, source: plan.source ?? null,
    // D-500 : la requête comprise change les offres retenues ; sans elle, l'empreinte d'avant.
    ...(plan.comprendre ? { comprendre: 1 } : {}),
    // D-510 : le tri par fraîcheur change l'ordre et la forme de la clé ; sans lui, l'empreinte d'avant.
    ...(plan.fraicheur ? { tri: 'fraicheur' } : {}),
    // D-513 : les offres non précisées retenues changent la recherche et la clé ; sans elles, l'empreinte d'avant.
    ...(plan.nonPrecisees ? { nonPrecisees: 1 } : {}),
    // R-143 §7 : le classement pertinent change l'ordre et la forme de la clé, ses préférences changent les scores.
    ...(plan.pertinence ? { tri: 'pertinence', preferences: plan.pertinence.preferences } : {}),
    ...(p ? { proximite: { lieu: p.lieu ? point(p.lieu) : null, villes: p.villes ? p.villes.resolues.map(point).sort((x, y) => String(x[0]).localeCompare(String(y[0]))) : null } } : {}),
  });
}

/**
 * Les lignes servies d'une liste d'identifiants rendus par le SQL, dans SON ordre. La page mêle les deux origines ;
 * chaque origine est relue dans sa table, et la ligne servie a la même forme pour les deux. Une offre dépubliée entre
 * le SQL et cette relecture disparaît de la page, jamais servie périmée.
 */
async function lignesDansLOrdre(ids: string[], taxonomy: OptionalOccupationPresentation): Promise<JobRow[]> {
  const idsDirects = ids.filter(estIdDirect).map(idDirect);
  const [rows, directes] = await Promise.all([
    prisma.job.findMany({
      where: { ...publicJobWhere(), id: { in: ids.filter((id) => !estIdDirect(id)) } },
      omit: { raw: true, searchText: true },
      include: { company: true, sources: publicSources() },
    }),
    idsDirects.length ? prisma.directOffer.findMany({ where: { ...directPubliable(), id: { in: idsDirects } } }) : [],
  ]);
  const byId = new Map<string, JobRow>([
    ...rows.map((row): [string, JobRow] => [row.id, toRow(row, taxonomy)]),
    ...directes.map((d): [string, JobRow] => {
      const ligne = directToRow(d);
      return [ligne.id, ligne];
    }),
  ]);
  return ids.flatMap((id) => {
    const ligne = byId.get(id);
    return ligne ? [ligne] : [];
  });
}

/** R-130 §3 — au plus 50 nouvelles lues par examen : l'e-mail en montre 3, le reste sert l'anti-doublon. */
export const NOUVELLES_MAX = 50;

export type ExamenAlerte = {
  total: number;
  nouvelles: number;
  jobs: JobRow[];
  /**
   * D-515 §2 — les nouvelles qui respectent avec certitude tous les autres critères mais ne précisent pas le contrat ou le
   * temps de travail filtré, dans l'ordre de la page ; chacune porte `correspondance: NON_CONFIRMEE` et ses dimensions.
   * Au seul contrat 2 (`nonPrecisees`) : absentes au contrat 1, dont l'examen reste celui d'avant, au champ près.
   */
  incompletes?: number;
  jobsIncompletes?: JobRow[];
  perimetre: PerimetreServi;
  filtresRefuses: FiltreRefuse[];
};

/**
 * L'EXAMEN D'UNE ALERTE (R-128 §2, R-130 §3 ; D-464 §1, §3) : la recherche de `/emplois` — même `parseFilters`, même
 * plan, même base SQL — et, parmi ses offres, celles entrées au catalogue après `entreeApres` et publiées après
 * `publieeApres` (ou sans date). Le backend fixe les deux bornes : le filigrane de l'alerte et « il y a 30 jours ».
 */
export async function examinerAlerte(filters: JobFilters, entreeApres: Date, publieeApres: Date): Promise<ExamenAlerte> {
  const perimetre = exigerPerimetre(filters.marche);
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  // Une alerte ne connaît ni le pays du visiteur ni un curseur (R-128 §1).
  const planTexte = planifierRecherche(perimetre, { ...filters, prioritePays: undefined });
  try {
    // D-496 : la même proximité que la page (le lieu et les villes trouvés dans la base de villes).
    const plan = filters.proximite ? await localiserPlan(planTexte, filters.locale) : planTexte;
    const taxonomy = await getOptionalOccupationPresentation(langueDesLibelles(localeAffichage(filters.locale, perimetre)));
    const examen = await examenNouveautes(plan, entreeApres, publieeApres, NOUVELLES_MAX);
    const dimensions = new Map(examen.idsIncompletes.map((x) => [x.id, x.dimensions]));
    const [certaines, incompletes] = await Promise.all([
      lignesDansLOrdre(examen.ids, taxonomy),
      lignesDansLOrdre(examen.idsIncompletes.map((x) => x.id), taxonomy),
    ]);
    return {
      total: examen.total,
      nouvelles: examen.nouvelles,
      // Au contrat 1 (sans `nonPrecisees`), les lignes d'avant, à l'identique (témoins différentiels D-496, D-500).
      jobs: filters.nonPrecisees ? certaines.map((ligne): JobRow => ({ ...ligne, correspondance: { statut: 'CONFIRMEE' } })) : certaines,
      ...(filters.nonPrecisees ? {
        incompletes: examen.incompletes,
        // Une incomplète sans dimension nommée ne peut pas se signaler : elle n'est pas servie (jamais présentée certaine).
        jobsIncompletes: incompletes.flatMap((ligne): JobRow[] => {
          const d = dimensions.get(ligne.id);
          return d?.length ? [{ ...ligne, correspondance: { statut: 'NON_CONFIRMEE', dimensions: [...d] } }] : [];
        }),
      } : {}),
      perimetre: perimetreServi(perimetre, filters.locale),
      filtresRefuses: planTexte.refus,
    };
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}

/**
 * R-143 §7 — un curseur du classement pertinent : six termes, dont l'instant de référence du score. Un instant futur, ou
 * plus vieux que 30 jours, n'est pas un curseur servi par cette API : refusé comme une autre forme.
 */
const DUREE_CURSEUR_CLASSE_S = 30 * 86_400;
function curseurClasse(jeton: string, empreinte: string): CleScore {
  const k = decoderCurseur(jeton, empreinte, ARITE_CLE_SCORE);
  const maintenant = instantDeReference();
  const [t0, origine, nc, ns, nf, id] = k;
  if (typeof t0 !== 'number' || !Number.isInteger(t0) || t0 > maintenant + 300 || t0 < maintenant - DUREE_CURSEUR_CLASSE_S) throw new CurseurInvalideError('instant');
  if (![0, 1].includes(origine as number) || ![0, 1].includes(nc as number) || !Number.isSafeInteger(ns) || typeof nf !== 'number' || typeof id !== 'string') {
    throw new CurseurInvalideError('clé');
  }
  return [t0, origine as number, nc as number, ns as number, nf, id];
}

export async function getJobs(filters: JobFilters): Promise<JobsResult> {
  const perimetre = exigerPerimetre(filters.marche);
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();

  const planTexte = planifierRecherche(perimetre, filters);
  // D-496 : le lieu et les villes cherchés, trouvés dans la base de villes (une requête, mémorisée par instance).
  let plan: typeof planTexte;
  try {
    plan = filters.proximite ? await localiserPlan(planTexte, filters.locale) : planTexte;
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
  const empreinte = empreintePlan(plan);
  // Un curseur d'autres critères est refusé AVANT la recherche (400 CURSEUR_INVALIDE).
  const curseur = !filters.apres ? null : plan.pertinence
    ? curseurClasse(filters.apres, empreinte)
    : plan.fraicheur
    ? (decoderCurseur(filters.apres, empreinte, ARITE_CLE_FRAICHEUR) as CleFraicheur)
    : (decoderCurseur(filters.apres, empreinte, ARITE_CLE_RECHERCHE) as CleRecherche);
  try {
    const taxonomy = await getOptionalOccupationPresentation(langueDesLibelles(localeAffichage(filters.locale, perimetre)));
    const summary = await searchSummary(plan, curseur, PAGE_SIZE);
    // D-513 : une offre servie alors qu'elle ne précise pas une dimension filtrée (contrat 2) le dit sur sa carte.
    const jobs = (await lignesDansLOrdre(summary.ids, taxonomy)).map((ligne): JobRow => {
      const dimensions = summary.nonPrecisees[ligne.id];
      const classement = summary.classement[ligne.id];
      return { ...ligne, correspondance: dimensions?.length ? { statut: 'NON_CONFIRMEE', dimensions: [...dimensions] } : { statut: 'CONFIRMEE' },
        ...(classement ? { classement: lireClassement(classement) } : {}) };
    });
    return {
      jobs,
      occupationEnrichmentAvailable: taxonomy.available,
      total: summary.total,
      totalConfirmes: summary.totalConfirmes,
      totalPerimetre: summary.totalPerimetre,
      suivant: summary.suivant ? encoderCurseur(empreinte, summary.suivant) : null,
      perimetre: perimetreServi(perimetre, filters.locale),
      facettes: await libellerFacettes(plan, summary.facettes, taxonomy, filters.locale),
      filtresRefuses: plan.refus,
      // Une ville trouvée se dit comme la base l'écrit (« Chennevières-sur-Marne (94) ») ; sinon ce que le texte a compris.
      lieu: plan.proximite?.lieu && plan.lieuCompris ? { type: plan.lieuCompris.type, libelle: plan.proximite.lieu.libelle } : plan.lieuCompris ?? null,
    };
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}

export { DIMENSIONS };
