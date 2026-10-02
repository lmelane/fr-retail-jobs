import type { Prisma } from '@prisma/client';
import type { CandidateJob } from '../dedup/match.js';
import { isPortalEmployerOrigin } from './portalEmployer.js';
import { nameTokens, registryMaison } from './maisonAttachment.js';
import { canonicalEmployer } from './resolve.js';

/**
 * D-520, CLASSE « IDENTITÉ D'EMPLOYEUR » : LES CAS ORDINAIRES QUE LE RÉSOLVEUR ABSORBE SEUL, SUR PREUVE.
 *
 * Mesuré sur les 8 RUN du 24/09 au 01/10 (`audits/2026-10-02/classe-identite/`) : 106 occurrences (source × RUN),
 * 8 625 refus d'offres. Deux sous-causes se résolvent sans revue parce que la preuve est déjà en base, et qu'aucune
 * des deux ne déplace une offre : l'offre reste sur l'employeur qu'elle porte déjà. Tout le reste va en file de revue
 * (`reviewQueue.ts`), retenu, jamais deviné.
 *
 *  1. LIBELLÉ OMIS (`LABEL_OMITTED_RULE`) — l'éditeur a nommé l'employeur de CETTE offre lors d'une collecte précédente
 *     (libellé natif, résolu), et l'offre lui est rattachée ; aujourd'hui sa page ne le nomme pas (page « poste
 *     pourvu », fiche momentanément illisible : 19 offres de 8 sources, 9 occurrences). Une donnée absente n'est pas une
 *     donnée contraire (R-143 §10, D-515 §1) : l'offre garde son employeur. Si la DERNIÈRE déclaration native de l'offre
 *     était refusée ou désignait un autre employeur, rien n'est gardé.
 *  2. MÊME MAISON DU REGISTRE (`SAME_MAISON_RULE`) — le libellé change (« B's International » → « B&S International »,
 *     « PUMA SE » → « PUMA North America, Inc. »), mais l'ancien ET le nouveau désignent la Maison au registre de cette
 *     source, au sens de R-143 §5 (`maisonAttachment.ts`) : mêmes mots, ou le nom complet de la Maison prolongé par une
 *     forme juridique, un pays, une succursale. Jamais sur un portail de groupe (MULTI_BRAND, ou registre « Groupe (…) ») :
 *     là, deux Maisons différentes partagent le portail. Et seulement si l'offre est encore sur l'employeur que l'ancien
 *     libellé lui avait donné.
 *
 * Ne sont PAS absorbés ici : une entité juridique qui ne prolonge pas le nom de la Maison (« ALTEX S.A. » pour Funky
 * Buddha), un portail jamais relu dont les offres ne nomment personne (R-142 §3 exige un portail relu), un changement
 * vers un employeur que la source ne publiait pas (D-506 §3). Le suivi de l'éditeur (D-506 §3) reste traité avant la
 * règle 2 par le résolveur.
 */
export const LABEL_OMITTED_RULE = 'NATIVE_LABEL_OMITTED_KEPT' as const;
export const SAME_MAISON_RULE = 'SAME_REGISTRY_MAISON' as const;

/** Les règles par lesquelles un libellé NATIF a rattaché une offre. Une heuristique historique n'est pas une preuve. */
const NATIVE_ATTRIBUTION_RULES: ReadonlySet<string> = new Set(['REVIEWED_ALIAS', 'REVIEWED_MERGE', 'NATIVE_SOURCE_LABEL',
  'NATIVE_EMPLOYER_BRAND_RELATION', 'PUBLISHER_FOLLOWED', SAME_MAISON_RULE]);
/** Une origine de libellé est native si elle vient de la page de l'éditeur : ni le registre, ni une ligne d'avant les origines. */
const isNativeOrigin = (origin: string) => !isPortalEmployerOrigin(origin) && origin !== 'LEGACY_UNSPECIFIED';

/**
 * Règle 1. Rend l'employeur actuel de l'offre si la dernière déclaration native de l'éditeur pour cette offre l'a rattachée
 * à lui ; sinon null (l'appelant lève la revue).
 */
export async function employerKeptWhenLabelOmitted(tx: Prisma.TransactionClient, candidate: Pick<CandidateJob, 'sourceKey' | 'externalId'>) {
  const entry = await tx.jobSource.findUnique({ where: { sourceKey_externalId: { sourceKey: candidate.sourceKey, externalId: candidate.externalId } },
    select: { job: { select: { company: true } } } });
  if (!entry?.job) return null;
  const current = await canonicalEmployer(tx, entry.job.company);
  // Les observations d'une offre se comptent en unités : la plus récente déclaration native fait foi, refusée comprise.
  const observations = await tx.employerObservation.findMany({ where: { sourceKey: candidate.sourceKey, externalId: candidate.externalId },
    orderBy: [{ observedAt: 'desc' }, { id: 'desc' }], select: { labelOrigin: true, rule: true, canonicalEmployerId: true }, take: 200 });
  const native = observations.find(o => isNativeOrigin(o.labelOrigin));
  if (!native?.canonicalEmployerId || !NATIVE_ATTRIBUTION_RULES.has(native.rule)) return null;
  const named = await canonicalEmployer(tx, await tx.company.findUniqueOrThrow({ where: { id: native.canonicalEmployerId } }));
  return named.id === current.id ? current : null;
}

/** Le libellé désigne la Maison au sens de R-143 §5 : mêmes mots, ou le nom complet prolongé (forme juridique, pays, succursale). */
export function designatesMaison(label: string, maison: string): boolean {
  const tokens = nameTokens(label), prefix = nameTokens(maison);
  return prefix.length > 0 && tokens.length >= prefix.length && prefix.every((token, i) => tokens[i] === token);
}

/** La source est-elle un portail de groupe (R-142 §3, `maisonAttachment.ts`) : relue MULTI_BRAND ou inscrite « Groupe (…) » ? */
export function isGroupPortal(source: { maison: string | null; portalScope: string | null }): boolean {
  return source.portalScope === 'MULTI_BRAND' || (source.maison ?? '').includes('(');
}

/**
 * Règle 2. Vrai si l'ancien libellé et le nouveau désignent tous deux la Maison au registre de la source (portail d'une
 * seule Maison) et que l'offre est toujours sur l'employeur que l'ancien libellé lui avait donné.
 */
export async function sameRegistryMaison(tx: Prisma.TransactionClient, sourceKey: string, previousLabel: string, label: string,
  previousEmployerId: string, currentEmployerId: string): Promise<boolean> {
  const source = await tx.source.findUnique({ where: { key: sourceKey }, select: { maison: true, portalScope: true } });
  const maison = registryMaison(source?.maison ?? null);
  if (!source || !maison || isGroupPortal(source)) return false;
  if (!designatesMaison(previousLabel, maison) || !designatesMaison(label, maison)) return false;
  const previous = await canonicalEmployer(tx, await tx.company.findUniqueOrThrow({ where: { id: previousEmployerId } }));
  return previous.id === currentEmployerId;
}
