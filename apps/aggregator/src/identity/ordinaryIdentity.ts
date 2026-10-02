import { Prisma } from '@prisma/client';
import type { CandidateJob } from '../dedup/match.js';
import { isPortalEmployerOrigin } from './portalEmployer.js';
import { nameTokens, registryMaison } from './maisonAttachment.js';
import { canonicalEmployer } from './resolve.js';

/**
 * D-520, CLASSE « IDENTITÉ D'EMPLOYEUR » : LES CAS ORDINAIRES QUE LE RÉSOLVEUR TRAITE SANS REVUE HUMAINE, SUR PREUVE.
 *
 * Mesuré sur les 8 RUN du 24/09 au 01/10 (`audits/2026-10-02/classe-identite/`) : 106 occurrences (source × RUN),
 * 8 625 refus d'offres. Aucune des deux règles ne déplace une offre ni n'invente d'employeur. Tout le reste va en file de
 * revue (`reviewQueue.ts`), retenu, jamais deviné.
 *
 *  1. LIBELLÉ OMIS (`employerKeptWhenLabelOmitted`, motif `NATIVE_LABEL_OMITTED`) : l'éditeur a nommé l'employeur de
 *     CETTE offre lors d'une collecte précédente (libellé natif, résolu par une règle native), l'offre lui est
 *     rattachée, et aujourd'hui sa page ne le nomme plus. Une donnée absente n'est pas une donnée contraire (D-515 §1,
 *     R-143 §10) : l'offre n'est NI réécrite NI reconfirmée (R-143 §2 : sa disponibilité suit son plafond), sa
 *     publication garde son employeur, et rien ne va en file. Vaut aussi sur un portail relu MULTI_BRAND (D-479 §2 :
 *     l'offre qui nomme sa Maison la garde). Si la DERNIÈRE déclaration native de l'offre a été refusée ou désigne un
 *     autre employeur, rien n'est gardé.
 *  2. MÊME MAISON DU REGISTRE (`sameRegistryMaison`, règle `SAME_REGISTRY_MAISON`) : l'éditeur nommait l'employeur
 *     (libellé NATIF ; un employeur venu du registre ou du portail certifié reste en revue, lecture de D-506 §3), et le
 *     nouveau libellé, comme l'ancien, désigne la Maison au registre de la source au sens de R-143 §5 : mêmes mots, ou
 *     nom complet de la Maison prolongé. Avec les gardes de `attachToMaison` (`maisonAttachment.ts`) :
 *       · le portail est relu SINGLE_BRAND (jamais un périmètre NULL ni un portail de groupe) ;
 *       · toutes les sources qui ont publié l'un ou l'autre libellé sont inscrites pour cette même Maison, sans portail
 *         de groupe (une autre source « Puma Energy » suffit à refuser « Puma Energy » sur le portail de Puma) ;
 *       · l'employeur actuel n'est pas un groupe ; au plus une ligne non fusionnée porte le nom de la Maison, qui n'est
 *         pas un groupe et dont le groupe parent ne contredit pas celui de l'employeur actuel ;
 *       · l'offre est encore sur l'employeur que l'ancien libellé lui avait donné. Elle ne bouge pas.
 *
 * Le suivi de l'éditeur (D-506 §3) reste traité avant la règle 2 par le résolveur.
 */
export const SAME_MAISON_RULE = 'SAME_REGISTRY_MAISON' as const;

/** Les règles par lesquelles un libellé NATIF a rattaché une offre. Une heuristique historique n'est pas une preuve. */
const NATIVE_ATTRIBUTION_RULES: ReadonlySet<string> = new Set(['REVIEWED_ALIAS', 'REVIEWED_MERGE', 'NATIVE_SOURCE_LABEL',
  'NATIVE_EMPLOYER_BRAND_RELATION', 'PUBLISHER_FOLLOWED', SAME_MAISON_RULE]);
/** Une origine de libellé est native si elle vient de la page de l'éditeur : ni le registre, ni une ligne d'avant les origines. */
export const isNativeOrigin = (origin: string) => !isPortalEmployerOrigin(origin) && origin !== 'LEGACY_UNSPECIFIED';

/**
 * Règle 1. Rend l'employeur actuel de l'offre si la dernière déclaration native de l'éditeur pour cette offre l'a rattachée
 * à lui ; sinon null (l'appelant lève la revue).
 */
export async function employerKeptWhenLabelOmitted(tx: Prisma.TransactionClient, candidate: Pick<CandidateJob, 'sourceKey' | 'externalId'>) {
  const entry = await tx.jobSource.findUnique({ where: { sourceKey_externalId: { sourceKey: candidate.sourceKey, externalId: candidate.externalId } },
    select: { job: { select: { company: true } } } });
  if (!entry?.job) return null;
  const current = await canonicalEmployer(tx, entry.job.company);
  // La plus récente déclaration native fait foi, refusée comprise.
  const observations = await tx.employerObservation.findMany({ where: { sourceKey: candidate.sourceKey, externalId: candidate.externalId },
    orderBy: [{ observedAt: 'desc' }, { id: 'desc' }], select: { labelOrigin: true, rule: true, canonicalEmployerId: true }, take: 200 });
  const native = observations.find(o => isNativeOrigin(o.labelOrigin));
  if (!native?.canonicalEmployerId || !NATIVE_ATTRIBUTION_RULES.has(native.rule)) return null;
  const named = await canonicalEmployer(tx, await tx.company.findUniqueOrThrow({ where: { id: native.canonicalEmployerId } }));
  return named.id === current.id ? current : null;
}

/** Le libellé désigne la Maison au sens de R-143 §5 : mêmes mots, ou le nom complet de la Maison prolongé. */
export function designatesMaison(label: string, maison: string): boolean {
  const tokens = nameTokens(label), prefix = nameTokens(maison);
  return prefix.length > 0 && tokens.length >= prefix.length && prefix.every((token, i) => tokens[i] === token);
}

/** La source est-elle un portail de groupe (R-142 §3, `maisonAttachment.ts`) : relue MULTI_BRAND ou inscrite « Groupe (…) » ? */
export function isGroupPortal(source: { maison: string | null; portalScope: string | null }): boolean {
  return source.portalScope === 'MULTI_BRAND' || (source.maison ?? '').includes('(');
}

type Current = { id: string; kind: string; parentGroupId: string | null };

/** Règle 2 (voir l'en-tête). Vrai seulement si chaque garde tient ; toute incertitude laisse l'offre en revue. */
export async function sameRegistryMaison(tx: Prisma.TransactionClient, input: { sourceKey: string; previousLabel: string; previousOrigin: string;
  label: string; previousEmployerId: string; currentEmployer: Current }): Promise<boolean> {
  if (!isNativeOrigin(input.previousOrigin) || input.currentEmployer.kind === 'GROUP') return false;
  const source = await tx.source.findUnique({ where: { key: input.sourceKey }, select: { maison: true, portalScope: true } });
  const maison = registryMaison(source?.maison ?? null);
  if (!source || !maison || source.portalScope !== 'SINGLE_BRAND' || isGroupPortal(source)) return false;
  if (!designatesMaison(input.previousLabel, maison) || !designatesMaison(input.label, maison)) return false;
  const key = nameTokens(maison).join(' ');
  // Accord de toutes les sources qui ont publié l'un ou l'autre libellé (index `EmployerObservation_normalizedEmployerName_idx`).
  const publishers = await tx.$queryRaw<{ sourceKey: string; maison: string | null; portalScope: string | null }[]>`
    SELECT DISTINCT o."sourceKey", s.maison, s."portalScope" FROM "EmployerObservation" o LEFT JOIN "Source" s ON s.key = o."sourceKey"
    WHERE o."normalizedEmployerName" IN (${input.previousLabel}, ${input.label})`;
  if (publishers.some(p => isGroupPortal(p) || nameTokens(registryMaison(p.maison) ?? '').join(' ') !== key)) return false;
  const previous = await canonicalEmployer(tx, await tx.company.findUniqueOrThrow({ where: { id: input.previousEmployerId } }));
  if (previous.id !== input.currentEmployer.id) return false;
  // La ligne Maison : au plus une, pas un groupe, sans groupe parent contraire.
  const firstWord = maison.trim().split(/\s+/)[0]!.toLowerCase().replace(/[\\%_]/g, '\\$&');
  const candidates = await tx.$queryRaw<{ id: string; name: string; kind: string; parentGroupId: string | null }[]>`
    SELECT id, name, kind::text AS kind, "parentGroupId" FROM "Company" WHERE "mergedIntoId" IS NULL AND lower(name) LIKE ${`${firstWord}%`}`;
  const rows = candidates.filter(row => nameTokens(row.name).join(' ') === key);
  if (rows.length > 1) return false;
  const row = rows[0];
  if (row && (row.kind === 'GROUP' || (input.currentEmployer.parentGroupId && row.id !== input.currentEmployer.id
    && row.parentGroupId !== input.currentEmployer.parentGroupId))) return false;
  return true;
}
