import { Prisma, type PrismaClient } from '@prisma/client';
import { log } from '../observability/logger.js';
import { normalizedEmployerName } from '../normalize/employerName.js';
import { ESCALATION } from '../pipeline/sourceState.js';
import { registryMaison } from './maisonAttachment.js';
import type { EmployerIdentityReviewRequired, MotifIdentite } from './errors.js';

/**
 * D-520 — LA FILE DE REVUE D'IDENTITÉ D'EMPLOYEUR, UNIQUE.
 *
 * Avant ce lot, chaque offre dont l'employeur n'était pas prouvé faisait échouer le RUN (`EmployerIdentityReviewRequired`),
 * et chaque source demandait une enquête pour savoir ce qui manquait : 106 occurrences (source × RUN) sur les 8 RUN du
 * 24/09 au 01/10, 8 625 offres refusées. Désormais :
 *   · ce qui se prouve se résout dans le résolveur (`ordinaryIdentity.ts`, le suivi de l'éditeur D-506 §3) ;
 *   · le reste est RETENU : l'offre n'est pas écrite (ni publiée ni devinée ; une publication antérieure reste telle
 *     quelle) et rejoint UNE entrée de cette file par source, motif, libellé et employeur en jeu. L'entrée dit les
 *     offres en jeu, la preuve qui manque et la question précise. Elle ne fait pas échouer le RUN : la source porte
 *     la cause IDENTITE_EMPLOYEUR (`pipeline/sourceState.ts`), revue humaine à l'échéance ;
 *   · une entrée ouverte depuis plus de 7 jours (48 h quand la source ne publie plus rien, mêmes échéances que
 *     `sourceState.ts`) est escaladée, une fois, et le reste jusqu'à sa résolution ;
 *   · une collecte complète (liste prouvée, hors passe incrémentale) qui ne refuse plus ce libellé résout l'entrée :
 *     alias relu, périmètre relu, suivi de l'éditeur, ou offres disparues. Une collecte incomplète ne résout rien.
 */

export type IdentityRefusal = { externalId: string; rawEmployerName: string; proposedName: string; motif: MotifIdentite };
export const refusalOf = (error: EmployerIdentityReviewRequired): IdentityRefusal =>
  ({ externalId: error.externalId, rawEmployerName: error.rawEmployerName, proposedName: error.proposedName, motif: error.motif });

/** Ce que la file sait de la source, lu au registre. */
export type QueueSource = { key: string; kind?: string | null; maison: string | null; tier: string | null; portalScope: string | null; careersDomain: string | null };

export type QueueEntryDraft = {
  motif: MotifIdentite; normalizedLabel: string; proposedKey: string; rawLabel: string; proposedName: string | null;
  offers: number; sampleExternalIds: string[]; missingProof: string; question: string;
};

/** Le motif porte un code, pas un employeur, dans `proposedName` pour ces deux refus : il n'y a pas d'employeur en jeu. */
const NO_EMPLOYER_AT_STAKE: ReadonlySet<MotifIdentite> = new Set(['PORTAL_OWNER_NOT_CERTIFIED', 'ALIAS_SOURCE_OR_TENANT_CHANGED']);
/** Ce qui ne pose aucune question : l'offre déjà nommée par l'éditeur est gardée telle quelle (`ordinaryIdentity.ts`, règle 1). */
export const NOT_QUEUED: ReadonlySet<MotifIdentite> = new Set(['NATIVE_LABEL_OMITTED']);
/** Welcome to the Jungle, seul job board collecté (R-142 §1) : jamais une source à retirer. */
const isWttj = (source: QueueSource) => (source.kind ?? '').startsWith('wttj') || source.key.startsWith('wttj');
const JOB_BOARD_TIERS: ReadonlySet<string> = new Set(['SPECIALIST_JOBBOARD', 'AGGREGATOR']);
const SAMPLE = 5;

const quote = (name: string) => `« ${name.trim()} »`;
const offers = (n: number) => `${n} offre${n > 1 ? 's' : ''}`;

/** La preuve qui manque et la question précise, par motif. Texte interne, sans tiret cadratin (D-319). */
export function identityQuestion(source: QueueSource, entry: Pick<QueueEntryDraft, 'motif' | 'rawLabel' | 'proposedName' | 'offers'>): { missingProof: string; question: string } {
  const maison = registryMaison(source.maison) ?? source.key;
  const raw = quote(entry.rawLabel), proposed = entry.proposedName ? quote(entry.proposedName) : 'son employeur actuel', n = offers(entry.offers);
  switch (entry.motif) {
    case 'PORTAL_OWNER_NOT_CERTIFIED':
      if (source.tier && JOB_BOARD_TIERS.has(source.tier) && isWttj(source)) return {
        missingProof: 'le nom de l’employeur sur la page de chaque offre : WTTJ n’est pas un employeur, et reste collecté (R-142 §1)',
        question: `${source.key} (WTTJ) : offres sans employeur nommé : ${entry.offers}. Quel champ de la page WTTJ nomme l’employeur de ces offres, pour que le lecteur le lise ?` };
      if (source.tier && JOB_BOARD_TIERS.has(source.tier)) return {
        missingProof: 'rien à trancher : R-142 §1 exclut ce job board, R-142 §2 décide son retrait',
        question: `${source.key} est un job board hors WTTJ ; offres sans employeur nommé : ${entry.offers}. Retrait déjà décidé par R-142 §2, à exécuter (retire-source ${source.key}).` };
      return {
        missingProof: 'le périmètre relu du portail (Source.portalScope), exigé par R-142 §3 pour publier une offre qui ne nomme pas son employeur',
        question: `Le portail ${source.key} (registre ${quote(maison)}${source.careersDomain ? `, ${source.careersDomain}` : ''}) publie-t-il pour un seul employeur (SINGLE_BRAND) ou pour plusieurs enseignes d’un groupe (MULTI_BRAND) ? Offres sans employeur nommé : ${entry.offers}. Une fois le portail relu, elles publient sous ${quote(maison)}.` };
    case 'PORTAL_OWNER_REPLACES_EMPLOYER':
      return { missingProof: 'une preuve que ces offres changent d’employeur : l’éditeur n’en nomme aucun',
        question: `Sur ${n} du portail ${source.key}, l’éditeur ne nomme pas d’employeur et le registre proposerait ${quote(maison)} à la place de ${proposed}. Garder ${proposed} ou passer à ${quote(maison)} ?` };
    case 'ALIAS_CONFLICT':
      return { missingProof: 'une seule décision d’alias pour ce libellé',
        question: `Deux alias relus rattachent ${raw} à deux employeurs différents (${entry.proposedName ?? 'conflit'}) sur ${source.key}. Lequel garder ?` };
    case 'ALIAS_SOURCE_OR_TENANT_CHANGED':
      return { missingProof: 'une relecture de l’alias pour la configuration actuelle de la source',
        question: `La configuration de ${source.key} a changé depuis l’alias relu de ${raw} (${n}). L’alias vaut-il toujours pour cette configuration ?` };
    case 'EMPLOYER_CHANGE_MASS':
      return { missingProof: 'la confirmation que l’éditeur change bien l’employeur de ces offres (garde de masse de D-506 §3 franchie)',
        question: `Dans une même collecte, ${source.key} fait passer ${n} de ${proposed} à ${raw}. Suivre l’éditeur (alias ou fusion relus) ou garder ${proposed} ?` };
    case 'EMPLOYER_SPELLING_DIVERGED':
      return { missingProof: `un lien officiel entre ${raw} et ${proposed} (site de la Maison, mentions légales, page carrière), ou la preuve que ce sont deux employeurs`,
        question: `Sur ${n} de ${source.key} (registre ${quote(maison)}), l’éditeur nomme désormais ${raw} à la place de ${proposed}. ${raw} est-il ${proposed} (alias limité à la source) ou un autre employeur ?` };
    case 'NATIVE_LABEL_OMITTED':
      return { missingProof: 'rien : l’éditeur avait nommé l’employeur de ces offres, gardées telles quelles',
        question: `Sur ${n} de ${source.key}, la page ne nomme plus ${proposed}, que l’éditeur nommait : rien à trancher.` };
    case 'EMPLOYER_TARGET_MISMATCH':
    case 'SOURCE_NEVER_PUBLISHED_FOR_HOUSE':
      return { missingProof: `la preuve que ${raw} et ${proposed} sont le même employeur, ou que l’offre change d’employeur`,
        question: `Sur ${n} de ${source.key}, ${raw} remplacerait ${proposed}, l’employeur déjà publié. Même employeur, ou changement d’employeur ?` };
  }
}

/** Les refus d'une collecte, regroupés en entrées de la file. Pur. */
export function queueEntries(source: QueueSource, refusals: readonly IdentityRefusal[]): QueueEntryDraft[] {
  const groups = new Map<string, { refusal: IdentityRefusal; ids: Set<string> }>();
  for (const refusal of refusals) {
    if (NOT_QUEUED.has(refusal.motif)) continue;
    const proposedKey = NO_EMPLOYER_AT_STAKE.has(refusal.motif) ? '' : normalizedEmployerName(refusal.proposedName);
    const key = JSON.stringify([refusal.motif, normalizedEmployerName(refusal.rawEmployerName), proposedKey]);
    const group = groups.get(key) ?? groups.set(key, { refusal, ids: new Set() }).get(key)!;
    group.ids.add(refusal.externalId);
  }
  return [...groups.values()].map(({ refusal, ids }) => {
    const proposedName = NO_EMPLOYER_AT_STAKE.has(refusal.motif) ? null : refusal.proposedName;
    const draft = { motif: refusal.motif, normalizedLabel: normalizedEmployerName(refusal.rawEmployerName),
      proposedKey: proposedName === null ? '' : normalizedEmployerName(proposedName), rawLabel: refusal.rawEmployerName.trim(), proposedName,
      offers: ids.size, sampleExternalIds: [...ids].sort().slice(0, SAMPLE) };
    return { ...draft, ...identityQuestion(source, draft) };
  }).sort((a, b) => b.offers - a.offers || a.normalizedLabel.localeCompare(b.normalizedLabel));
}

const HOUR = 3_600_000;
/** L'échéance d'une entrée : celle de `sourceState.ts` — 48 h si la source ne publie plus rien, 7 jours sinon. */
export function escalationDeadline(firstSeenAt: Date, published: number): Date {
  return new Date(firstSeenAt.getTime() + (published > 0 ? ESCALATION.degradedDays * 24 : ESCALATION.waitingHours) * HOUR);
}

export type IdentityQueueSync = { open: number; opened: number; escalated: number; resolved: number; offers: number;
  /** Offres gardées telles quelles, libellé omis (règle 1) : comptées, sans entrée. */
  kept: number;
  /** Les entrées ouvertes de la source après la collecte, pour l'alerte : la question, les offres, l'échéance. */
  entries: Array<{ motif: string; rawLabel: string; offers: number; question: string; overdue: boolean }> };

/**
 * Tient la file à jour après la collecte d'une source : ouvre, met à jour, escalade, et — sur une collecte complète
 * seulement — résout. Chaque transition est journalisée. Une erreur ici est une erreur de la collecte (rien n'est
 * perdu : la file est recalculée à la collecte suivante).
 */
export async function syncIdentityQueue(db: PrismaClient, input: { sourceKey: string; refusals: readonly IdentityRefusal[];
  captureBatchId: string | null; published: number; complete: boolean; incremental?: boolean; now?: Date }): Promise<IdentityQueueSync> {
  const now = input.now ?? new Date();
  const kept = input.refusals.filter(r => NOT_QUEUED.has(r.motif)).length;
  const result: IdentityQueueSync = { open: 0, opened: 0, escalated: 0, resolved: 0, offers: 0, kept, entries: [] };
  // Rien à ouvrir ni à résoudre : une seule lecture (les entrées ouvertes de la source), pour l'alerte.
  const queued = input.refusals.some(r => !NOT_QUEUED.has(r.motif));
  if (!queued && !input.complete) return withOpenEntries(db, input.sourceKey, result, now);
  const source = queued ? await db.source.findUnique({ where: { key: input.sourceKey },
    select: { key: true, kind: true, maison: true, tier: true, portalScope: true, careersDomain: true } }) : null;
  const drafts = queueEntries(source ?? { key: input.sourceKey, maison: null, tier: null, portalScope: null, careersDomain: null }, input.refusals);
  const seen = new Set<string>();
  for (const draft of drafts) {
    const outcome = await upsertEntry(db, input.sourceKey, draft, input, now);
    seen.add(outcome.id);
    result.offers += draft.offers;
    if (outcome.opened) {
      result.opened++;
      await log.info('employer.identity_review_opened', { sourceKey: input.sourceKey, motif: draft.motif, rawLabel: draft.rawLabel,
        proposedName: draft.proposedName, offers: draft.offers, missingProof: draft.missingProof, question: draft.question, decision: 'D-520' });
    }
    if (outcome.escalated) {
      result.escalated++;
      await log.warn('employer.identity_review_escalated', { sourceKey: input.sourceKey, motif: draft.motif, rawLabel: draft.rawLabel,
        offers: draft.offers, firstSeenAt: outcome.firstSeenAt, question: draft.question, decision: 'D-520' });
    }
  }
  if (input.complete) {
    const stale = await db.employerIdentityQueue.findMany({ where: { sourceKey: input.sourceKey, resolvedAt: null, id: { notIn: [...seen] } },
      select: { id: true, motif: true, rawLabel: true, firstSeenAt: true } });
    if (stale.length) {
      await db.employerIdentityQueue.updateMany({ where: { id: { in: stale.map(s => s.id) }, resolvedAt: null }, data: { resolvedAt: now } });
      result.resolved = stale.length;
      for (const entry of stale) await log.info('employer.identity_review_resolved', { sourceKey: input.sourceKey, motif: entry.motif,
        rawLabel: entry.rawLabel, firstSeenAt: entry.firstSeenAt, decision: 'D-520' });
    }
  }
  return withOpenEntries(db, input.sourceKey, result, now);
}

async function withOpenEntries(db: PrismaClient, sourceKey: string, result: IdentityQueueSync, now: Date): Promise<IdentityQueueSync> {
  const open = await db.employerIdentityQueue.findMany({ where: { sourceKey, resolvedAt: null }, orderBy: { offers: 'desc' } });
  return { ...result, open: open.length, entries: open.map(e => ({ motif: e.motif, rawLabel: e.rawLabel, offers: e.offers, question: e.question,
    overdue: e.escalatedAt !== null || now.getTime() >= e.escalateAt.getTime() })) };
}

async function upsertEntry(db: PrismaClient, sourceKey: string, draft: QueueEntryDraft,
  input: { captureBatchId: string | null; published: number; incremental?: boolean }, now: Date, attempt = 1): Promise<{ id: string; opened: boolean; escalated: boolean; firstSeenAt: Date }> {
  const where = { sourceKey_motif_normalizedLabel_proposedKey: { sourceKey, motif: draft.motif, normalizedLabel: draft.normalizedLabel, proposedKey: draft.proposedKey } };
  const fields = { rawLabel: draft.rawLabel, proposedName: draft.proposedName, offers: draft.offers, sampleExternalIds: draft.sampleExternalIds,
    missingProof: draft.missingProof, question: draft.question, lastSeenAt: now, lastCaptureBatchId: input.captureBatchId };
  try {
    const existing = await db.employerIdentityQueue.findUnique({ where });
    if (!existing || existing.resolvedAt) {
      // Neuve, ou rouverte : une entrée résolue qui revient repart de zéro (date, échéance, escalade).
      // Une passe ne sait pas si la source publie encore : échéance longue, la collecte complète suivante la raccourcit.
      const reset = { ...fields, firstSeenAt: now, collections: 1, escalateAt: escalationDeadline(now, input.incremental ? 1 : input.published),
        escalatedAt: null, resolvedAt: null };
      const row = existing ? await db.employerIdentityQueue.update({ where: { id: existing.id }, data: reset })
        : await db.employerIdentityQueue.create({ data: { sourceKey, motif: draft.motif, normalizedLabel: draft.normalizedLabel, proposedKey: draft.proposedKey, ...reset } });
      return { id: row.id, opened: true, escalated: false, firstSeenAt: row.firstSeenAt };
    }
    // Une passe incrémentale (D-517) ne lit que le neuf : elle ne refait ni le compte des offres ni l'échéance.
    if (input.incremental) {
      const row = await db.employerIdentityQueue.update({ where: { id: existing.id }, data: { lastSeenAt: now } });
      return { id: row.id, opened: false, escalated: false, firstSeenAt: row.firstSeenAt };
    }
    // L'échéance suit la gravité actuelle : une source qui ne publie plus rien n'attend pas 7 jours.
    const escalateAt = new Date(Math.min(existing.escalateAt.getTime(), escalationDeadline(existing.firstSeenAt, input.published).getTime()));
    const escalating = !existing.escalatedAt && now.getTime() >= escalateAt.getTime();
    const row = await db.employerIdentityQueue.update({ where: { id: existing.id }, data: { ...fields, escalateAt,
      collections: existing.lastCaptureBatchId === input.captureBatchId && input.captureBatchId ? existing.collections : existing.collections + 1,
      ...(escalating ? { escalatedAt: now } : {}) } });
    return { id: row.id, opened: false, escalated: escalating, firstSeenAt: row.firstSeenAt };
  } catch (error) {
    // Deux collectes de la même source au même instant (RUN et passe) : la seconde relit l'entrée créée par la première.
    if (attempt === 1 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return upsertEntry(db, sourceKey, draft, input, now, 2);
    throw error;
  }
}

export type OpenQueueEntry = Awaited<ReturnType<typeof readIdentityQueue>>[number];
/** La file ouverte, la plus urgente d'abord : escaladées ou échues, puis par offres en jeu. `overdue` se lit à `now`. */
export async function readIdentityQueue(db: PrismaClient, now = new Date()) {
  const rows = await db.employerIdentityQueue.findMany({ where: { resolvedAt: null } });
  return rows.map(row => ({ ...row, overdue: row.escalatedAt !== null || now.getTime() >= row.escalateAt.getTime(),
    ageDays: Math.floor((now.getTime() - row.firstSeenAt.getTime()) / (24 * HOUR)) }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.offers - a.offers || a.sourceKey.localeCompare(b.sourceKey));
}

/** La file en lignes lisibles, pour la commande `file-identite` (sans tiret cadratin, D-319). */
export function identityQueueLines(entries: readonly OpenQueueEntry[]): string[] {
  const total = entries.reduce((n, e) => n + e.offers, 0), overdue = entries.filter(e => e.overdue).length;
  const head = `File de revue d’identité : ${entries.length} entrée${entries.length > 1 ? 's' : ''} ouverte${entries.length > 1 ? 's' : ''}, ${offers(total)} retenue${total > 1 ? 's' : ''}, ${overdue} échue${overdue > 1 ? 's' : ''}.`;
  return [head, ...entries.map(e => `${e.overdue ? '[ÉCHUE] ' : ''}${e.sourceKey} · ${e.motif} · ${quote(e.rawLabel)} · ${offers(e.offers)} · depuis ${e.ageDays} j\n` +
    `  manque : ${e.missingProof}\n  question : ${e.question}\n  exemples : ${e.sampleExternalIds.join(', ')}`)];
}
