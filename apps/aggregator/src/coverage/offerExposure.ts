/**
 * L'ÉTAT D'EXPOSITION D'UNE OFFRE — D-520 §3 (02/10/2026) : « la source est lue, l'offre est collectée, dédupliquée,
 * rattachée à la bonne Maison, canonisée, maintenue fraîche, puis exposée ou non au candidat selon un état que nous
 * comprenons ».
 *
 * UNE SEULE FONCTION DE VÉRITÉ (`classifyExposure`), pure, sur les colonnes que la recherche lit. Elle ne réécrit aucun
 * prédicat : « confirmée » est `sourceIsConfirmed`, « disponible » est `sourceIsAvailable` (`packages/db/availability.ts`,
 * ceux de `publicJobSql`), la fin par autorité est `authorityClosure` (`packages/db/publications.ts`, celle du refresh), le
 * marché est `marketOf` (`MARCHES`, celui de la couverture). Un témoin d'intégration
 * (`pipeline/offerExposure.operational.test.ts`) prouve que l'état EXPOSEE rend exactement les offres de `publicJobSql`
 * dans un pays de marché ouvert, c'est-à-dire ce que sert `/emplois`.
 *
 * VOCABULAIRE FERMÉ. Chaque offre reçoit un état et une cause, et une seule. Ce qui n'entre dans aucune cause connue
 * devient INEXPLIQUEE / SANS_CAUSE : jamais un repli silencieux vers un état plausible. La preuve demandée par le CEO
 * (« aucune offre dans un état inexplicable ») est le compte de cet état, à zéro.
 *
 * Ordre de lecture, du plus définitif au plus temporaire : regroupée sous une jumelle, puis le cycle de vie (fermée,
 * retirée), puis la disponibilité de la représentation (masquée), puis le marché.
 *
 * EXPOSÉE veut dire SERVIE PAR LA RECHERCHE : `/emplois` sert un marché ouvert, et aussi un pays connu seul
 * (`perimetreDeRecherche`, `PAYS_CONNUS`) ; une offre servie dans un tel pays est EXPOSEE / PAYS_SEUL. HORS_MARCHE ne
 * garde que ce qu'aucune recherche n'atteint : sans pays, ou un pays que le catalogue ne connaît pas (atteignable par
 * son seul lien).
 *
 * Une source EN PAUSE garde ses offres servies telles qu'elles ont été vues (D-485, D-493, D-506 ; épargnées par le
 * plafond de 72 h, pas par la sonde des liens) : EXPOSEE / SOURCE_EN_PAUSE, une cause à part pour qu'elles se voient.
 * Les retirer serait une décision produit, non prise. Une source RETIRÉE retire ses offres (`SOURCE_RETIRED`) :
 * NON_PUBLIABLE / SOURCE_EXCLUE.
 */
import { sourceIsAvailable, sourceIsConfirmed } from '@catwalks/db/availability';
import { authorityClosure } from '@catwalks/db/publications';
import { knownAlpha2 } from '@catwalks/db/iso-alpha2';
import { retentionClass } from '../pipeline/publicationDisposition.js';
import { marketOf } from './coverageReading.js';

const KNOWN_COUNTRIES: ReadonlySet<string> = new Set(knownAlpha2());

export const EXPOSURE_CAUSES = {
  EXPOSEE: ['CONFIRMEE', 'SOURCE_EN_PAUSE', 'PAYS_SEUL'],
  MASQUEE: ['NON_RECONFIRMEE', 'PLAFOND_72H', 'LIEN_MORT', 'RETIREE_SANS_PREUVE'],
  RETENUE_PAR_REGLE: ['CANDIDATURE_SPONTANEE', 'HORS_PERIMETRE', 'POSTE_SANS_ANNONCE', 'RETIREE_DU_LISTING', 'PREUVE_DE_LA_SOURCE'],
  ABSORBEE: ['DOUBLON'],
  FERMEE: ['PAR_LA_SOURCE', 'PAR_AUTORITE', 'PAR_ECHEANCE'],
  NON_PUBLIABLE: ['IDENTITE_EN_REVUE', 'IDENTITE_CONTREDITE', 'SOURCE_EXCLUE', 'PUBLICATION_NON_VERIFIEE'],
  HORS_MARCHE: ['SANS_PAYS', 'PAYS_INCONNU'],
  INEXPLIQUEE: ['SANS_CAUSE'],
} as const;
export type ExposureState = keyof typeof EXPOSURE_CAUSES;
export type ExposureCause = (typeof EXPOSURE_CAUSES)[ExposureState][number];
export const EXPOSURE_STATES = Object.keys(EXPOSURE_CAUSES) as ExposureState[];

export const STATE_LABEL: Readonly<Record<ExposureState, string>> = {
  EXPOSEE: 'exposée', MASQUEE: 'masquée', RETENUE_PAR_REGLE: 'retenue par règle', ABSORBEE: 'absorbée par un doublon',
  FERMEE: 'fermée', NON_PUBLIABLE: 'non publiable', HORS_MARCHE: 'hors marché', INEXPLIQUEE: 'inexpliquée',
};
export const CAUSE_LABEL: Readonly<Record<ExposureCause, string>> = {
  CONFIRMEE: 'confirmée par sa source',
  SOURCE_EN_PAUSE: 'servie telle que vue en dernier : sa source est en pause (D-485, D-493, D-506)',
  PAYS_SEUL: 'servie dans un pays sans marché ouvert, atteint par la recherche de ce seul pays',
  NON_RECONFIRMEE: 'non reconfirmée : une collecte crédible de sa source ne la liste plus',
  PLAFOND_72H: 'non reconfirmée : sa source active ne l’a plus revue depuis 72 h',
  LIEN_MORT: 'lien de candidature mort (lu par la sonde)',
  RETIREE_SANS_PREUVE: 'retirée sans preuve de fin (plus aucune représentation attestée)',
  PUBLICATION_NON_VERIFIEE: 'retirée par une réparation : sa publication ne peut plus être vérifiée',
  CANDIDATURE_SPONTANEE: 'candidature spontanée ou vivier sans poste (D-511, D-512)',
  HORS_PERIMETRE: 'hors périmètre, décision relue de l’équipe (D-456 §2)',
  POSTE_SANS_ANNONCE: 'poste listé sans annonce publiée (D-514 §4)',
  RETIREE_DU_LISTING: 'retirée de son listing public par la source (D-462)',
  PREUVE_DE_LA_SOURCE: 'jamais publiée : la source elle-même la rend non publiable (description vide, test, événement, refus nommé)',
  DOUBLON: 'regroupée sous une jumelle (R-143 §4)',
  PAR_LA_SOURCE: 'fermée par la source (absente de sa liste prouvée, ou retrait natif)',
  PAR_AUTORITE: 'fermée par la source officielle, malgré une source secondaire (R-143 §3)',
  PAR_ECHEANCE: 'échéance déclarée atteinte',
  IDENTITE_EN_REVUE: 'employeur en revue d’identité (publication non rattachée)',
  IDENTITE_CONTREDITE: 'identité contredite par une décision',
  SOURCE_EXCLUE: 'source retirée du registre par décision',
  SANS_PAYS: 'sans pays : atteignable par son seul lien, aucune recherche ne la sert',
  PAYS_INCONNU: 'pays inconnu du catalogue : atteignable par son seul lien, aucune recherche ne la sert',
  SANS_CAUSE: 'aucune cause connue : à instruire',
};

/** Une représentation, telle que la recherche et le cycle de vie la lisent. Les colonnes R-143 sont absentes d'une base en retard. */
export type ExposureSource = {
  sourceKey: string; sourceTier: string; externalId: string; url: string; isActive: boolean; expiresAt: Date | null;
  lastSeenAt: Date; availabilityHold?: string | null; availabilityHoldAt?: Date | null; holdRule?: string | null;
  publisherClosedAt?: Date | null;
  /** Le statut du registre de sa source (`Source.status`), null si la clé n'y est pas. */
  sourceStatus: string | null;
  /** La dernière retenue de collecte observée pour cette publication (`SourceObservation.publicationHold`). */
  lastHold?: string | null;
  /** Une décision de périmètre relue l'écarte (`PostingScopeDecision` OUT_OF_SCOPE). */
  scopeOut?: boolean;
};
export type ExposureJob = {
  id: string; isActive: boolean; mergedIntoId: string | null; closedAt: Date | null; withdrawnAt: Date | null;
  withdrawalReason: string | null; countryCode: string | null; sources: readonly ExposureSource[];
};
export type ExposureVerdict<S extends ExposureState = ExposureState> = {
  state: S; cause: (typeof EXPOSURE_CAUSES)[S][number];
  /** La représentation qui porte la cause (celle qui sert, retient, ferme ou masque), quand il y en a une. */
  sourceKey: string | null;
  /** Le fait lu qui fonde la cause, en clair. */
  detail: string;
};

const verdict = <S extends ExposureState>(state: S, cause: (typeof EXPOSURE_CAUSES)[S][number], sourceKey: string | null, detail: string): ExposureVerdict =>
  ({ state, cause, sourceKey, detail }) as ExposureVerdict;
const iso = (d: Date | null | undefined) => d ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'inconnue';

/** Le retrait d'une offre, rendu en état : chaque motif de `WithdrawalReason` (`pipeline/lifecycle.ts`) a sa cause, prouvée. */
function withdrawn(job: ExposureJob): ExposureVerdict {
  const holds = job.sources.filter(s => s.lastHold);
  const held = (reason: string) => holds.find(s => s.lastHold === reason) ?? null;
  switch (job.withdrawalReason) {
    case 'SOURCE_RETIRED': {
      const retired = job.sources.find(s => s.sourceStatus === 'RETIRED') ?? null;
      return verdict('NON_PUBLIABLE', 'SOURCE_EXCLUE', retired?.sourceKey ?? null,
        `retirée le ${iso(job.withdrawnAt)} avec sa source${retired ? ` ${retired.sourceKey} (statut RETIRED)` : ''}`);
    }
    case 'IDENTITY_CONTRADICTED':
      return verdict('NON_PUBLIABLE', 'IDENTITE_CONTREDITE', null, `retirée le ${iso(job.withdrawnAt)} : identité contredite`);
    case 'OUT_OF_SCOPE': {
      const scoped = job.sources.find(s => s.scopeOut) ?? held('SCOPE_OUT_OF_PERIMETER');
      if (scoped) return verdict('RETENUE_PAR_REGLE', 'HORS_PERIMETRE', scoped.sourceKey, `retirée le ${iso(job.withdrawnAt)} : décision de périmètre relue`);
      const spontaneous = held('NATIVE_SPONTANEOUS_APPLICATION');
      if (spontaneous) return verdict('RETENUE_PAR_REGLE', 'CANDIDATURE_SPONTANEE', spontaneous.sourceKey, `retirée le ${iso(job.withdrawnAt)} : retenue NATIVE_SPONTANEOUS_APPLICATION`);
      return verdict('INEXPLIQUEE', 'SANS_CAUSE', null, 'retirée hors périmètre sans décision de périmètre ni retenue de collecte');
    }
    case 'SOURCE_UNLISTED': {
      const advert = held('NATIVE_ADVERTISEMENT_WITHDRAWN');
      if (advert) return verdict('RETENUE_PAR_REGLE', 'POSTE_SANS_ANNONCE', advert.sourceKey, `retirée le ${iso(job.withdrawnAt)} : retenue NATIVE_ADVERTISEMENT_WITHDRAWN`);
      const unlisted = held('SOURCE_UNLISTED');
      if (unlisted) return verdict('RETENUE_PAR_REGLE', 'RETIREE_DU_LISTING', unlisted.sourceKey, `retirée le ${iso(job.withdrawnAt)} : retenue SOURCE_UNLISTED`);
      return verdict('INEXPLIQUEE', 'SANS_CAUSE', null, 'retirée du listing sans retenue de collecte qui le prouve');
    }
    case 'ATTESTATION_MISSING':
      return verdict('MASQUEE', 'RETIREE_SANS_PREUVE', null, `retirée le ${iso(job.withdrawnAt)} : plus aucune représentation attestée, sans preuve de fin`);
    case 'PUBLICATION_UNVERIFIED':
      return verdict('NON_PUBLIABLE', 'PUBLICATION_NON_VERIFIEE', null, `retirée le ${iso(job.withdrawnAt)} : publication invérifiable après réparation`);
    default:
      return verdict('INEXPLIQUEE', 'SANS_CAUSE', null, `retirée pour un motif inconnu (${job.withdrawalReason ?? 'aucun'})`);
  }
}

/** La fin prouvée : par autorité (même règle que le refresh), par échéance, sinon par la source (absence prouvée, retrait natif). */
function closed(job: ExposureJob, at: Date): ExposureVerdict {
  const authority = authorityClosure(job.sources, at);
  if (authority) return verdict('FERMEE', 'PAR_AUTORITE', authority.sourceKey,
    `la source officielle ${authority.sourceKey} l’a terminée${authority.publisherClosedAt ? ` le ${iso(authority.publisherClosedAt)}` : ''} ; une source secondaire la montre encore`);
  const closedAt = job.closedAt ?? at;
  const deadline = job.sources.find(s => s.expiresAt && s.expiresAt.getTime() <= closedAt.getTime() + 60_000);
  if (deadline) return verdict('FERMEE', 'PAR_ECHEANCE', deadline.sourceKey, `échéance du ${iso(deadline.expiresAt)} déclarée par ${deadline.sourceKey}`);
  const native = job.sources.find(s => s.lastHold?.startsWith('APPLICATION_'));
  const last = [...job.sources].sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())[0];
  return verdict('FERMEE', 'PAR_LA_SOURCE', native?.sourceKey ?? last?.sourceKey ?? null, native
    ? `fermée le ${iso(job.closedAt)} : ${native.sourceKey} rend la candidature impossible (${native.lastHold})`
    : `fermée le ${iso(job.closedAt)} : absente de la liste prouvée de sa source (vue pour la dernière fois le ${iso(last?.lastSeenAt)})`);
}

/** Une offre active que rien ne sert : la retenue de disponibilité la plus forte, ou l'échéance atteinte. */
function unserved(job: ExposureJob, at: Date): ExposureVerdict {
  const available = job.sources.filter(s => sourceIsAvailable(s, at));
  const holding = (test: (s: ExposureSource) => boolean) => available.find(s => s.availabilityHold && test(s));
  const dead = holding(s => s.availabilityHold === 'APPLY_LINK_DEAD');
  if (dead) return verdict('MASQUEE', 'LIEN_MORT', dead.sourceKey, `la sonde a lu la page de candidature morte le ${iso(dead.availabilityHoldAt)}`);
  const ceiling = holding(s => s.availabilityHold === 'NOT_RECONFIRMED' && s.holdRule === 'CEILING_72H');
  if (ceiling) return verdict('MASQUEE', 'PLAFOND_72H', ceiling.sourceKey, `${ceiling.sourceKey} ne l’a plus revue depuis le ${iso(ceiling.lastSeenAt)} (retenue du ${iso(ceiling.availabilityHoldAt)})`);
  const missed = holding(s => s.availabilityHold === 'NOT_RECONFIRMED');
  if (missed) return verdict('MASQUEE', 'NON_RECONFIRMEE', missed.sourceKey, `la collecte crédible de ${missed.sourceKey} du ${iso(missed.availabilityHoldAt)} ne la liste plus (vue le ${iso(missed.lastSeenAt)})`);
  if (available.length) {
    const unknown = available.find(s => s.availabilityHold)!;
    return verdict('INEXPLIQUEE', 'SANS_CAUSE', unknown?.sourceKey ?? null, `retenue de disponibilité inconnue (${unknown?.availabilityHold ?? 'aucune'})`);
  }
  const expired = job.sources.filter(s => s.isActive && s.expiresAt && s.expiresAt <= at);
  if (expired.length) return verdict('FERMEE', 'PAR_ECHEANCE', expired[0].sourceKey,
    `échéance du ${iso(expired[0].expiresAt)} atteinte ; le prochain refresh la fermera`);
  return verdict('INEXPLIQUEE', 'SANS_CAUSE', null, 'active sans aucune représentation active');
}

/**
 * Une publication retenue dès la collecte, jamais devenue une offre : l'état que sa dernière retenue lui donne. Les
 * retenues arbitrées (`publicationDisposition.ts`, `retentionClass`) ont leur cause ; une retenue « à instruire » reste
 * INEXPLIQUEE, comme le RUN la tient pour bloquante.
 */
export function classifyCollectionHold(hold: string, sourceKey: string | null, detail: string): ExposureVerdict {
  switch (hold) {
    case 'NATIVE_SPONTANEOUS_APPLICATION': return verdict('RETENUE_PAR_REGLE', 'CANDIDATURE_SPONTANEE', sourceKey, detail);
    case 'NATIVE_ADVERTISEMENT_WITHDRAWN': return verdict('RETENUE_PAR_REGLE', 'POSTE_SANS_ANNONCE', sourceKey, detail);
    case 'SCOPE_OUT_OF_PERIMETER': return verdict('RETENUE_PAR_REGLE', 'HORS_PERIMETRE', sourceKey, detail);
    case 'SOURCE_UNLISTED': return verdict('RETENUE_PAR_REGLE', 'RETIREE_DU_LISTING', sourceKey, detail);
    case 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL': return verdict('NON_PUBLIABLE', 'IDENTITE_EN_REVUE', sourceKey, `${detail} : l’annonce ne nomme pas son employeur`);
  }
  if (hold.startsWith('APPLICATION_')) return verdict('FERMEE', 'PAR_LA_SOURCE', sourceKey, detail);
  if (retentionClass(hold) === 'NATIVE') return verdict('RETENUE_PAR_REGLE', 'PREUVE_DE_LA_SOURCE', sourceKey, detail);
  return verdict('INEXPLIQUEE', 'SANS_CAUSE', sourceKey, `${detail} : retenue à instruire`);
}

/** L'état d'exposition d'une offre, et sa cause. Pure : même entrée, même verdict. */
export function classifyExposure(job: ExposureJob, at = new Date()): ExposureVerdict {
  if (job.mergedIntoId) return verdict('ABSORBEE', 'DOUBLON', null, `regroupée sous ${job.mergedIntoId}`);
  if (!job.isActive) {
    if (job.withdrawnAt) return withdrawn(job);
    if (job.closedAt) return closed(job, at);
    return verdict('INEXPLIQUEE', 'SANS_CAUSE', null, 'inactive sans date de fermeture ni de retrait');
  }
  const serving = job.sources.find(s => sourceIsConfirmed(s, at));
  if (!serving) return unserved(job, at);
  if (!job.countryCode) return verdict('HORS_MARCHE', 'SANS_PAYS', serving.sourceKey, 'aucun pays lu dans l’offre');
  const seen = `servie par ${serving.sourceKey}, vue le ${iso(serving.lastSeenAt)}`;
  if (!marketOf(job.countryCode)) {
    // La recherche sert un pays connu seul (`perimetreDeRecherche`), exactement avec `PAYS_CONNUS` (même liste).
    return KNOWN_COUNTRIES.has(job.countryCode.toUpperCase())
      ? verdict('EXPOSEE', 'PAYS_SEUL', serving.sourceKey, `${seen} ; pays ${job.countryCode}, sans marché ouvert`)
      : verdict('HORS_MARCHE', 'PAYS_INCONNU', serving.sourceKey, `pays ${job.countryCode}, inconnu du catalogue`);
  }
  // Toutes les représentations confirmées viennent d'une source en pause : la cause le dit.
  const confirmed = job.sources.filter(s => sourceIsConfirmed(s, at));
  if (confirmed.every(s => s.sourceStatus === 'PAUSED')) return verdict('EXPOSEE', 'SOURCE_EN_PAUSE', serving.sourceKey, `${seen} ; source en pause`);
  return verdict('EXPOSEE', 'CONFIRMEE', serving.sourceKey, seen);
}

/**
 * LA TRAJECTOIRE (D-520 §2, la même grille que les sources) : revient seule, à réparer, sur décision, ou rien à faire.
 * Vérifiée dans le code : seul un retrait ATTESTATION_MISSING se rouvre par une collecte (`dedup/upsert.ts`,
 * `refresh.ts` `canRefreshReactivate`), et SOURCE_UNLISTED par une annonce de nouveau listée (`explicitlyListed`) ; tout
 * autre retrait est définitif sans remédiation. Une retenue de disponibilité tombe dès que la source revoit l'offre,
 * ce qu'une source en pause ne fait pas.
 */
export const TRAJECTORIES = ['DEJA_SERVIE', 'REVIENT_SEULE', 'A_REPARER', 'SUR_DECISION', 'AUCUNE'] as const;
export type Trajectory = (typeof TRAJECTORIES)[number];
export const TRAJECTORY_LABEL: Readonly<Record<Trajectory, string>> = {
  DEJA_SERVIE: 'servie', REVIENT_SEULE: 'revient seule', A_REPARER: 'à réparer', SUR_DECISION: 'seulement sur décision', AUCUNE: 'rien à faire',
};
export type ComebackContext = { sourceState?: string | null; sourceStatus?: string | null; winnerId?: string | null;
  /** La base porte les retenues de R-143 §2 : le masquage est en service (sinon, il n'est pas encore livré). */
  maskingLive?: boolean };

/** CE QUI LA FERAIT REVENIR : la classe de trajectoire et sa phrase, selon la cause et l'état de la source qui la porte. */
export function trajectory(v: ExposureVerdict, context: ComebackContext = {}): { kind: Trajectory; text: string } {
  const source = v.sourceKey ? `${v.sourceKey}${context.sourceState ? ` (${context.sourceState})` : ''}` : 'sa source';
  const paused = context.sourceStatus === 'PAUSED' || context.sourceStatus === 'RETIRED';
  const sourceReturn = (text: string) => paused
    ? { kind: 'A_REPARER' as const, text: `Sa source ${source} n’est plus collectée : elle ne revient qu’à la reprise de la source.` }
    : { kind: 'REVIENT_SEULE' as const, text };
  switch (v.cause as ExposureCause) {
    case 'CONFIRMEE': case 'PAYS_SEUL':
      return { kind: 'DEJA_SERVIE', text: context.maskingLive === false
        ? `Servie tant que ${source} la liste ; fermée quand sa liste prouvée ne la contient plus (le masquage de R-143 §2 n’est pas encore en service sur cette base).`
        : `Servie tant que ${source} la revoit ; masquée si une collecte crédible ne la liste plus, ou après 72 h sans être revue.` };
    case 'SOURCE_EN_PAUSE': return { kind: 'DEJA_SERVIE', text: `Servie telle que vue en dernier : ${source} est en pause, rien ne la revoit ni ne la ferme`
      + (context.maskingLive === false ? ' ; elle reste servie jusqu’à la reprise de la source.' : ' ; seule la sonde des liens peut la masquer.') };
    case 'NON_RECONFIRMEE': case 'PLAFOND_72H':
      return sourceReturn(`Revient seule dès qu’une collecte de ${source} la liste de nouveau : la retenue tombe à l’écriture.`);
    case 'LIEN_MORT': return sourceReturn(`Revient seule si ${source} la revoit après la sonde ; sinon la page de candidature est morte, rien à faire.`);
    case 'RETIREE_SANS_PREUVE': return sourceReturn(`Revient seule si ${source} la revoit : une réattestation rouvre ce retrait.`);
    case 'PUBLICATION_NON_VERIFIEE': return { kind: 'A_REPARER', text: 'Ne revient pas d’elle-même : ce retrait de réparation ne se rouvre par aucune collecte ; il faut une remédiation relue.' };
    case 'CANDIDATURE_SPONTANEE': return { kind: 'AUCUNE', text: 'Jamais : une candidature spontanée ou un vivier sans poste n’est pas une offre (D-511, D-512). Revenir sur la règle demande une remédiation.' };
    case 'HORS_PERIMETRE': return { kind: 'SUR_DECISION', text: 'Seulement par une nouvelle décision de périmètre relue, suivie d’une remédiation : aucune collecte ne rouvre ce retrait.' };
    case 'POSTE_SANS_ANNONCE': return sourceReturn(`Revient seule si ${source} publie de nouveau une annonce pour ce poste (D-514 §4).`);
    case 'RETIREE_DU_LISTING': return sourceReturn(`Revient seule si ${source} la liste de nouveau publiquement.`);
    case 'PREUVE_DE_LA_SOURCE': return sourceReturn(`Publiée seule si ${source} la publie de nouveau sans cette preuve.`);
    case 'DOUBLON': return { kind: 'AUCUNE', text: `Rien : l’opportunité est servie une fois, sous ${context.winnerId ?? 'sa jumelle'}. Elle ne redevient une offre à part que si une partition relue défait la fusion.` };
    case 'PAR_LA_SOURCE': return sourceReturn(`Se rouvre seule si ${source} la republie.`);
    case 'PAR_AUTORITE': return sourceReturn(`Se rouvre seule si la source officielle ${source} la republie ; une source secondaire ne suffit pas (R-143 §3).`);
    case 'PAR_ECHEANCE': return sourceReturn(`Se rouvre si ${source} publie une nouvelle échéance (ou la retire).`);
    case 'IDENTITE_EN_REVUE': return { kind: 'SUR_DECISION', text: 'Publiée quand la revue d’identité rattache l’employeur à une Maison.' };
    case 'IDENTITE_CONTREDITE': return { kind: 'SUR_DECISION', text: 'Seulement par une décision d’identité relue, suivie d’une remédiation.' };
    case 'SOURCE_EXCLUE': return { kind: 'SUR_DECISION', text: `Seulement par une décision de réactiver ${source}, suivie d’une remédiation : réactiver la source ne rouvre pas ce retrait.` };
    case 'SANS_PAYS': return { kind: 'A_REPARER', text: 'À réparer : le lieu de l’offre ne donne pas de pays au catalogue ; aucune recherche ne la sert tant que la lecture du lieu n’est pas corrigée.' };
    case 'PAYS_INCONNU': return { kind: 'A_REPARER', text: 'À réparer : le pays lu n’est pas dans la liste des pays connus (`packages/db/iso-alpha2.ts`).' };
    case 'SANS_CAUSE': return { kind: 'A_REPARER', text: 'Inconnu : état à instruire, c’est un défaut.' };
  }
}
/** La phrase seule (compatibilité des appelants). */
export function comeback(v: ExposureVerdict, context: ComebackContext = {}): string {
  return trajectory(v, context).text;
}

export type ExposureCounts = { total: number; byState: Record<ExposureState, number>; byCause: Record<string, number> };
export function emptyCounts(): ExposureCounts {
  return { total: 0, byState: Object.fromEntries(EXPOSURE_STATES.map(s => [s, 0])) as Record<ExposureState, number>, byCause: {} };
}
export function countVerdict(counts: ExposureCounts, v: ExposureVerdict, n = 1): void {
  counts.total += n;
  counts.byState[v.state] += n;
  const key = `${v.state}/${v.cause}`;
  counts.byCause[key] = (counts.byCause[key] ?? 0) + n;
}

/** Ce que la répartition rend au bulletin et au back-office. */
export type ExposureSummary = {
  counts: ExposureCounts;
  /** Publications non rattachées à une offre, en revue d'identité (jamais servies) : NON_PUBLIABLE / IDENTITE_EN_REVUE. */
  identityReview: number;
  /**
   * Publications retenues dès la collecte, jamais devenues des offres (dernière retenue observée par publication), par
   * `état/cause` : elles comptent dans la preuve « aucune sans cause » (une retenue à instruire y est INEXPLIQUEE).
   */
  retainedAtCollection?: Record<string, number>;
  /** Offres sans cause : la preuve demandée est 0 ; chaque identifiant est nommé (au plus 50). */
  unexplained: Array<{ id: string; detail: string }>;
};

/** Les lignes courtes du bulletin : la répartition, et les offres sans cause nommées s'il y en a. */
export function exposureLines(d: ExposureSummary): string[] {
  const n = (v: number) => v.toLocaleString('fr-FR');
  const states = (Object.keys(d.counts.byState) as Array<keyof typeof STATE_LABEL>).filter(s => d.counts.byState[s] > 0)
    .map(s => `${STATE_LABEL[s]} ${n(d.counts.byState[s])}`);
  const masked = Object.entries(d.counts.byCause).filter(([k, v]) => k.startsWith('MASQUEE/') && v > 0)
    .map(([k, v]) => `${CAUSE_LABEL[k.split('/')[1] as keyof typeof CAUSE_LABEL]} ${n(v)}`);
  const lines = [`État d’exposition des ${n(d.counts.total)} offres : ${states.join(' ; ')}${d.identityReview ? ` ; et ${n(d.identityReview)} publications en revue d’identité` : ''}.`];
  if (masked.length) lines.push(`Masquées, par cause : ${masked.join(' ; ')}.`);
  const retained = Object.entries(d.retainedAtCollection ?? {}).filter(([, v]) => v > 0);
  const retainedUnexplained = retained.filter(([k]) => k.startsWith('INEXPLIQUEE/')).reduce((t, [, v]) => t + v, 0);
  if (retained.length) lines.push(`Retenues dès la collecte, jamais publiées : ${n(retained.reduce((t, [, v]) => t + v, 0))} publications (${retained
    .map(([k, v]) => `${CAUSE_LABEL[k.split('/')[1] as keyof typeof CAUSE_LABEL]} ${n(v)}`).join(' ; ')}).`);
  lines.push(d.counts.byState.INEXPLIQUEE
    ? `À instruire : ${n(d.counts.byState.INEXPLIQUEE)} offres sans cause connue (${d.unexplained.slice(0, 5).map(u => u.id).join(', ')}${d.counts.byState.INEXPLIQUEE > 5 ? '…' : ''}).`
    : 'Aucune offre sans cause connue.');
  if (retainedUnexplained) lines.push(`À instruire : ${n(retainedUnexplained)} publications retenues à la collecte pour un motif non arbitré.`);
  return lines;
}

