import { createHash } from 'node:crypto';
import { type Prisma, type Source, type SourceIdentityReview, type PrismaClient } from '@prisma/client';
import { resolveCompany } from '../normalize/company.js';
import { lockSourceWrites } from '../lib/writeLocks.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import type { ObjectStore } from '../retention/objectStore.js';
import { belongsToOfficialDomain, configuredPortal, reviewedOfficialDomain } from './sourcePortal.js';
import { effectiveSourceConfig } from './sourceConfig.js';
import { readIdentitySource } from './sourceRegistryRead.js';
import { inspectSourceRelation, SOURCE_RELATION_POLICY } from './sourceRelation.js';

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)]));
  return value;
}

export type IdentitySource = Pick<Source, 'key' | 'maison' | 'kind' | 'config' | 'careersDomain' | 'tenantKey' | 'tier'>;
export type RevisionIdentitySource = IdentitySource & Pick<Source, 'currentRevisionId'>;
export type IdentityReviewDocument = {
  sourceKey: string; sourceRevisionId: string; captureBatchId: string;
  verdict: 'VERIFIED' | 'CONTRADICTED' | 'UNRESOLVED'; officialDomain: string;
  statement: string; reviewer: string; checkedAt: Date | string; portalScope: 'SINGLE_BRAND' | 'MULTI_BRAND' | null;
};
type IdentityDecision = Omit<SourceIdentityReview, 'artifactText'>;

export class SourceIdentityGateError extends Error {
  constructor(readonly code: 'REVIEW_MISSING' | 'REVISION_MISMATCH' | 'ORDER_UNKNOWN' | 'EVIDENCE_INVALID', message: string) {
    super(message); this.name = 'SourceIdentityGateError';
  }
}
const invalid = (message: string): never => { throw new SourceIdentityGateError('EVIDENCE_INVALID', message); };

/** Null historical ordinals are for inspection only; they can never certify a source. */
export const identityReviewOrder: Prisma.SourceIdentityReviewOrderByWithRelationInput[] = [
  { sequence: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' },
];

/** Legacy source-scoped alias/candidate fingerprint. Review authority comes from SourceRevision. */
export function sourceIdentityHash(source: IdentitySource): string {
  const { key, maison, kind, config, careersDomain, tenantKey, tier } = source;
  return createHash('sha256').update(JSON.stringify(sorted({ key, maison, kind, config, careersDomain, tenantKey, tier }))).digest('hex');
}
export function sourceSubjectKey(source: Pick<Source, 'maison'>): string {
  return resolveCompany(source.maison.split('(')[0].trim()).companyId;
}

function assertRevision(source: RevisionIdentitySource, revisionId: string | null): void {
  if (!source.currentRevisionId || revisionId !== source.currentRevisionId) {
    throw new SourceIdentityGateError('REVISION_MISMATCH', 'Identity evidence does not match the current source revision');
  }
}
function recent(date: Date | string, now: Date): boolean {
  const age = now.getTime() - new Date(date).getTime();
  return Number.isFinite(age) && age >= -300_000 && age <= 30 * 86_400_000;
}

/** The dossier contains the human decision only. HTTP facts and native portal
 * references are reconstructed from the archive, never supplied by a caller. */
function decisionDocument(input: IdentityReviewDocument): Readonly<IdentityReviewDocument> {
  const keys = ['sourceKey', 'sourceRevisionId', 'captureBatchId', 'verdict', 'officialDomain', 'statement', 'reviewer', 'checkedAt', 'portalScope'];
  if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(key => !keys.includes(key)) ||
    keys.some(key => !Object.hasOwn(input, key))) return invalid('Identity decision requires an exact source revision, native capture and explicit reviewer fields');
  for (const key of keys.filter(key => !['checkedAt', 'portalScope'].includes(key)) as (keyof IdentityReviewDocument)[]) {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim() || value.length > (key === 'statement' ? 16000 : 300)) return invalid('Invalid identity decision text');
  }
  if (!['VERIFIED', 'CONTRADICTED', 'UNRESOLVED'].includes(input.verdict) ||
    (input.portalScope !== null && !['SINGLE_BRAND', 'MULTI_BRAND'].includes(input.portalScope)) ||
    (input.verdict !== 'VERIFIED' && input.portalScope !== null) || input.statement.trim().length < 30) return invalid('Invalid identity verdict, statement or portal scope');
  if (!(input.checkedAt instanceof Date) && typeof input.checkedAt !== 'string') return invalid('Invalid identity decision date');
  const checkedAt = new Date(input.checkedAt);
  if (!recent(checkedAt, new Date())) return invalid('Identity review must have been checked within 30 days');
  reviewedOfficialDomain(input.officialDomain);
  return Object.freeze({ ...input, checkedAt: checkedAt.toISOString() });
}

/** The body is verified before recording. Readers consume the immutable,
 * SQL-bound projection instead of loading megabytes of historical artifact text. */
export function assertIdentityReview(source: RevisionIdentitySource, review: IdentityDecision | null, now = new Date()): void {
  if (!review || review.verdict !== 'VERIFIED') throw new SourceIdentityGateError('REVIEW_MISSING', `"${source.key}" has no verified employer identity review`);
  if (review.sequence == null) throw new SourceIdentityGateError('ORDER_UNKNOWN', 'Identity review has no recorded decision order');
  assertRevision(source, review.sourceRevisionId);
  if (review.sourceKey !== source.key || review.tenantKey !== source.tenantKey || review.subjectKey !== sourceSubjectKey(source) || review.sourceHash !== sourceIdentityHash(source)) {
    return invalid('Identity evidence does not match the current employer/tenant/configuration');
  }
  if (!recent(review.checkedAt, now)) return invalid('Identity review must have been checked within 30 days');
  if (!['OFFICIAL_LINK', 'OFFICIAL_DOMAIN'].includes(review.method)) return invalid('Only an inspected official link or a portal served under the reviewed official domain can certify identity; a name match or unqualified document cannot');
  const report = review.relationReport as Record<string, unknown> | null;
  const witness = report?.witness as Record<string, unknown> | undefined;
  const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!review.evidenceCaptureBatchId || !report || report.archiveVerified !== true || report.policy !== SOURCE_RELATION_POLICY || report.verdict !== 'LINK_MATCHED' ||
    report.sourceKey !== source.key || report.sourceRevisionId !== source.currentRevisionId || report.captureBatchId !== review.evidenceCaptureBatchId ||
    report.bodyHash !== review.artifactHash || !hash(review.artifactHash) || report.officialDomain !== review.officialDomain ||
    report.proofUrl !== review.proofUrl || report.configuredPortal !== review.portalUrl || report.identityApproved !== false || report.coverageAttested !== false ||
    typeof report.inspectorRevision !== 'string' || !report.inspectorRevision || typeof report.responseId !== 'string' || !report.responseId ||
    typeof report.captureObservedAt !== 'string' || !recent(report.captureObservedAt, now) ||
    typeof report.evaluatedAt !== 'string' || !recent(report.evaluatedAt, now) ||
    !witness || !['a', 'iframe', 'script', 'document'].includes(String(witness.element)) || witness.attribute !== (witness.element === 'a' ? 'href' : witness.element === 'document' ? 'url' : 'src') ||
    (review.method === 'OFFICIAL_DOMAIN') !== (witness.element === 'document') ||
    !Number.isSafeInteger(witness.ordinal) || Number(witness.ordinal) < 0 || !hash(witness.referenceHash) || !hash(witness.resolvedReferenceHash) ||
    !Array.isArray(witness.queryKeys) || witness.queryKeys.some(key => typeof key !== 'string') ||
    !review.reviewer.trim() || review.statement.trim().length < 30) return invalid('Identity evidence requires an archived, inspected official link of the current policy');
  try { reviewedOfficialDomain(review.officialDomain); }
  catch { return invalid('Invalid reviewed official domain'); }
  const portal = configuredPortal(source.kind, effectiveSourceConfig(source.config));
  if (!belongsToOfficialDomain(review.proofUrl, review.officialDomain) || !portal || portal.url !== review.portalUrl) return invalid('Identity evidence does not match the official domain and exact native portal');
}

export async function requireSourceIdentity(tx: Prisma.TransactionClient, source: Source) {
  // Never filter for VERIFIED: a later contradiction must supersede it.
  const review = await tx.sourceIdentityReview.findFirst({ where: { sourceKey: source.key }, orderBy: identityReviewOrder, omit: { artifactText: true } });
  assertIdentityReview(source, review);
  return review!;
}

/** Archive I/O and inspection happen before acquiring the registry lock. The
 * locked writer then rechecks the exact revision; SQL also enforces provenance. */
export async function recordSourceIdentityReview(prisma: PrismaClient, input: IdentityReviewDocument, apply = false, store?: ObjectStore) {
  const document = decisionDocument(input);
  const source = await readIdentitySource(prisma, document.sourceKey);
  if (!source) throw new Error('Identity review source does not exist');
  assertRevision(source, document.sourceRevisionId);
  const relation = await inspectSourceRelation(prisma, document.sourceKey, { captureBatchId: document.captureBatchId, officialDomain: document.officialDomain }, store);
  if (!relation.archiveVerified) return invalid(`Identity archive cannot be used: ${relation.reason}`);
  if (document.verdict === 'VERIFIED' && relation.verdict !== 'LINK_MATCHED') return invalid(`Official portal relation not proven: ${relation.reason}`);
  if (new Date(document.checkedAt).getTime() < Date.parse(relation.captureObservedAt) - 300_000) return invalid('The identity decision predates its observed evidence');
  // Stable decision identity excludes the parser's clock. A retried decision
  // cannot jump ahead of a later contradiction, including after a new build.
  const id = `identity-review:${evidenceHash(document)}`;
  return prisma.$transaction(async tx => {
    await lockSourceWrites(tx, document.sourceKey, true);
    const current = await readIdentitySource(tx, document.sourceKey, true);
    if (!current) throw new Error('Identity review source does not exist');
    assertRevision(current, document.sourceRevisionId);
    const data = { sourceKey: current.key, sourceRevisionId: current.currentRevisionId, sourceHash: sourceIdentityHash(current),
      tenantKey: current.tenantKey, subjectKey: sourceSubjectKey(current), verdict: document.verdict,
      method: document.verdict !== 'VERIFIED' ? 'ARCHIVED_RESPONSE' : (relation as { witness?: { element?: string } }).witness?.element === 'document' ? 'OFFICIAL_DOMAIN' : 'OFFICIAL_LINK', officialDomain: document.officialDomain,
      proofUrl: relation.proofUrl, portalUrl: relation.verdict === 'LINK_MATCHED' ? relation.configuredPortal : '',
      statement: document.statement, artifactHash: relation.bodyHash, reviewer: document.reviewer,
      checkedAt: new Date(document.checkedAt), portalScope: document.portalScope,
      evidenceCaptureBatchId: document.captureBatchId, relationReport: relation as Prisma.JsonObject };
    if (document.verdict === 'VERIFIED') assertIdentityReview(current, { id, ...data, sequence: 1n, createdAt: new Date() });
    let written = 0;
    if (apply && !await tx.sourceIdentityReview.findUnique({ where: { id }, select: { id: true } })) {
      await tx.sourceIdentityReview.create({ data: { id, ...data } }); written = 1;
    }
    const latest = apply ? await tx.sourceIdentityReview.findFirst({ where: { sourceKey: current.key }, orderBy: identityReviewOrder, select: { id: true } }) : null;
    return { sourceKey: current.key, sourceRevisionId: current.currentRevisionId, sourceHash: data.sourceHash, verdict: document.verdict,
      evidenceCaptureBatchId: document.captureBatchId, reviewId: id, written, isLatestDecision: apply ? latest?.id === id : null };
  });
}

export function portalScopeOf(source: RevisionIdentitySource, review: IdentityDecision | null, now = new Date()): 'SINGLE_BRAND' | 'MULTI_BRAND' | null {
  try { assertIdentityReview(source, review, now); } catch { return null; }
  return review?.portalScope === 'SINGLE_BRAND' || review?.portalScope === 'MULTI_BRAND' ? review.portalScope : null;
}

export type CertifiedPortalIdentity = { scope: 'SINGLE_BRAND' | 'MULTI_BRAND'; ownerName: string; ownerKey: string; sourceRevisionId: string; reviewId: string | null };

/**
 * QUI RECRUTE, D'APRÈS LE REGISTRE (lot F5, 18/09/2026).
 *
 * Les trois informations rendues ici viennent toutes de `Source`, et c'était DÉJÀ le cas avant ce
 * lot : `ownerName` était `source.maison`, `ownerKey` en était dérivé par `sourceSubjectKey`, et
 * seul `scope` transitait par la revue d'identité. Depuis le lot F4 le périmètre est une colonne du
 * registre, relue à la main. La revue ne faisait donc plus que recopier le registre, au prix d'une
 * capture réseau par source.
 *
 * Et elle se trompait. Mesuré sur le lot Railway du 18/09 (20 sources) : 12 IDENTITE_NON_PROUVEE
 * dont au moins 3 faux refus — `club-monaco` (apex 403, `www` 200), `bellroy` et `figs` (lien exact
 * présent mais dans un <script>, écarté par principe). Au même moment, les 50 boards Greenhouse du
 * registre relu concordaient à 49/50 avec l'API du fournisseur, l'unique écart étant une maison
 * mère documentée comme telle. La vérification automatique était redondante ET moins fiable.
 *
 * `reviewId` vaut donc NULL : l'identité s'appuie sur le registre, pas sur une revue.
 *
 * CE QUE CETTE FONCTION NE FAIT TOUJOURS PAS : autoriser une collecte (robots.txt, inchangé et
 * indépendant), ni attester une couverture. Elle répond à une seule question — sous quel employeur
 * publier une offre qui n'en porte aucun.
 */
export async function certifiedPortalIdentity(db: Pick<Prisma.TransactionClient, '$queryRaw'>, sourceKey: string, _now = new Date()): Promise<CertifiedPortalIdentity | null> {
  const rows = await db.$queryRaw<Array<Pick<Source, 'key' | 'maison' | 'currentRevisionId' | 'portalScope'>>>`
    SELECT key, maison, "currentRevisionId", "portalScope" FROM "Source" WHERE key=${sourceKey}`;
  const source = rows[0];
  if (!source?.currentRevisionId || !source.maison?.trim()) return null;
  // Le périmètre est revalidé ici : la colonne porte une CHECK en base, mais une lecture qui
  // accepterait n'importe quelle chaîne ferait dépendre l'attribution d'employeur d'une faute de frappe.
  const scope = source.portalScope === 'SINGLE_BRAND' || source.portalScope === 'MULTI_BRAND' ? source.portalScope : null;
  if (!scope) return null;
  return { scope, ownerName: source.maison.trim(), ownerKey: sourceSubjectKey(source),
    sourceRevisionId: source.currentRevisionId, reviewId: null };
}

export async function certifiedPortalScope(db: Pick<Prisma.TransactionClient, '$queryRaw'>, sourceKey: string, now = new Date()): Promise<'SINGLE_BRAND' | 'MULTI_BRAND' | null> {
  return (await certifiedPortalIdentity(db, sourceKey, now))?.scope ?? null;
}
