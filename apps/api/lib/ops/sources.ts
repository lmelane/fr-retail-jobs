import { prisma } from '@catwalks/db';
import { readSourceStates, type SourceStatesReading } from '@catwalks/aggregator/src/pipeline/sourceStateRead.js';
import { CAUSES, OPERATIONAL_STATES, STATE_LABEL, TRAJECTORIES, TRAJECTORY_LABEL, summarizeStates, type SourceState } from '@catwalks/aggregator/src/pipeline/sourceState.js';
import { readRegistrySources, type RegistrySource } from '@catwalks/aggregator/src/registry/explicitRegistryRead.js';
import { buildHealthReport } from '@catwalks/aggregator/src/pipeline/healthReport.js';
import { readIdentityQueue } from '@catwalks/aggregator/src/identity/reviewQueue.js';
import { OpsRefus, type Tx } from './lecture';

/**
 * D-522 §5 — les sources pour la console : l'état opérationnel (`readSourceStates`, le calcul de `etat-sources`),
 * l'explication du registre (`readRegistrySources`), les offres en jeu et la dernière collecte de RUN
 * (`buildHealthReport`, le rapport de santé). Aucune de ces valeurs n'est recalculée ici : elles sont jointes par clé.
 */
const JOUR = 86_400_000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export type Sante = Awaited<ReturnType<typeof buildHealthReport>>;
/** Le rapport de santé ouvre sa propre transaction en lecture seule (`healthReport.ts`) : il se lit à part. */
export const lireSante = (at: Date): Promise<Sante> => buildHealthReport(prisma, at);

export type LigneSource = {
  cle: string; maison: string; famille: string; tier: string; statut: string;
  /** false : source active dont aucune collecte n'a encore calculé l'état (base d'avant le premier RUN r6). */
  calcule: boolean;
  etat: string; etatLibelle: string; cause: string | null; causeLibelle: string | null;
  trajectoire: string | null; trajectoireLibelle: string | null; manque: string | null;
  /** null : aucun état persisté, le début de l'épisode n'est pas connu (base d'avant le premier RUN r6). */
  depuis: string | null; ageJours: number | null; echeance: string | null; tentatives: number; escalade: boolean; decision: string | null; codes: string[];
  registre: { intention: string | null; motif: string | null; fondement: string | null; decision: string | null; prochaineAction: string | null;
    question: string | null; reexamen: string | null; explique: boolean } | null;
  offres: { enJeu: number; seulementParElle: number; aRisque: number; publicationsActives: number };
  derniereCollecteRun: { a: string; statut: string | null } | null;
  derniereCollecteEtat: { a: string; type: string | null } | null;
};

export type LectureSources = { at: string; etatCalcule: boolean; nonCalculees: number; lignes: LigneSource[]; etats: SourceStatesReading['states'] };

function ligne(s: SourceState, ctx: { reading: SourceStatesReading; registre: Map<string, RegistrySource>; sante: Map<string, Sante['sources'][number]>;
  meta: Map<string, { kind: string; tier: string }>; now: Date }): LigneSource {
  const reg = ctx.registre.get(s.sourceKey), sante = ctx.sante.get(s.sourceKey), meta = ctx.meta.get(s.sourceKey);
  return {
    cle: s.sourceKey, maison: ctx.reading.maison.get(s.sourceKey) ?? s.sourceKey, famille: meta?.kind ?? '', tier: meta?.tier ?? '', statut: reg?.status ?? '',
    calcule: !ctx.reading.neverComputedKeys.has(s.sourceKey),
    etat: s.state, etatLibelle: STATE_LABEL[s.state], cause: s.cause, causeLibelle: s.cause ? CAUSES[s.cause].label : null,
    trajectoire: s.trajectory, trajectoireLibelle: s.trajectory ? TRAJECTORY_LABEL[s.trajectory] : null, manque: s.missing,
    ...(ctx.reading.persistedKeys.has(s.sourceKey)
      ? { depuis: s.since.toISOString(), ageJours: Math.max(0, Math.floor((ctx.now.getTime() - s.since.getTime()) / JOUR)) }
      : { depuis: null, ageJours: null }),
    echeance: iso(s.deadline), tentatives: s.attempts, escalade: s.escalated, decision: s.decision, codes: s.codes,
    registre: reg && reg.status !== 'ACTIVE' ? { intention: reg.statusIntention, motif: reg.statusReason, fondement: reg.statusBasis,
      decision: reg.statusDecision, prochaineAction: reg.statusNextAction, question: reg.statusQuestion, reexamen: reg.statusReviewAt,
      explique: !!reg.statusReviewId && reg.statusExplainedFor === reg.status } : null,
    offres: { enJeu: sante?.activeJobs ?? 0, seulementParElle: sante?.exclusivelyBackedJobs ?? 0, aRisque: sante?.atRiskJobs ?? 0,
      publicationsActives: reg?.activeJobs ?? 0 },
    derniereCollecteRun: sante?.lastRunAt ? { a: new Date(sante.lastRunAt).toISOString(), statut: sante.lastStatus } : null,
    derniereCollecteEtat: s.lastCollectionAt ? { a: s.lastCollectionAt.toISOString(), type: s.lastCollectionKind } : null,
  };
}

/** Toutes les sources, la plus urgente d'abord : trajectoire (à réparer, revue, revient seule, décision), puis offres en jeu. */
export async function lireSources(tx: Tx, sante: Sante, now: Date): Promise<LectureSources> {
  const [reading, registre, meta] = await Promise.all([
    readSourceStates(tx, now), readRegistrySources(tx),
    tx.source.findMany({ select: { key: true, kind: true, tier: true } }),
  ]);
  const ctx = { reading, registre: new Map(registre.map(r => [r.key, r])), sante: new Map(sante.sources.map(s => [s.sourceKey, s])),
    meta: new Map(meta.map(m => [m.key, { kind: m.kind, tier: m.tier }])), now };
  const rang = (l: LigneSource) => !l.calcule ? 5 : l.etat === 'NORMALE' ? 6
    : ({ A_REPARER: 0, REVUE_HUMAINE: 1, AUTO: 2, DECISION: 4 } as Record<string, number>)[l.trajectoire ?? ''] ?? 3;
  const lignes = reading.states.map(s => ligne(s, ctx))
    .sort((a, b) => rang(a) - rang(b) || b.offres.enJeu - a.offres.enJeu || a.cle.localeCompare(b.cle));
  return { at: now.toISOString(), etatCalcule: reading.persisted > 0, nonCalculees: reading.neverComputed, lignes, etats: reading.states };
}

/**
 * La synthèse par état, trajectoire et cause (`summarizeStates`), sur les seules sources dont l'état est calculé ou porté
 * par le registre : une source active jamais collectée depuis l'état opérationnel n'est pas comptée « bloquée ».
 */
export function synthese(lecture: LectureSources) {
  const calculees = new Set(lecture.lignes.filter(l => l.calcule).map(l => l.cle));
  const s = summarizeStates(lecture.etats.filter(e => calculees.has(e.sourceKey)), new Date(lecture.at));
  return {
    total: lecture.lignes.length, comptees: s.total, nonCalculees: lecture.nonCalculees,
    parEtat: OPERATIONAL_STATES.map(etat => ({ etat, libelle: STATE_LABEL[etat], n: s.byState[etat] })),
    parTrajectoire: TRAJECTORIES.map(trajectoire => ({ trajectoire, libelle: TRAJECTORY_LABEL[trajectoire], n: s.byTrajectory[trajectoire] })),
    parCause: Object.entries(s.byCause).map(([cause, n]) => ({ cause, libelle: CAUSES[cause as keyof typeof CAUSES].label, n: n ?? 0 }))
      .sort((a, b) => b.n - a.n || a.cause.localeCompare(b.cause)),
  };
}

export const CLE_SOURCE = /^[a-z0-9][a-z0-9._:-]{0,119}$/i;

/** Le détail d'une source : sa ligne, ses dernières collectes, ses entrées ouvertes de file d'identité. */
/** La clé demandée, contrôlée AVANT toute lecture en base. */
export function cleDemandee(cle: string): string {
  if (!CLE_SOURCE.test(cle)) throw new OpsRefus(400, 'Clé de source invalide.');
  return cle;
}

export async function lireSource(tx: Tx, cle: string, sante: Sante, now: Date) {
  const lecture = await lireSources(tx, sante, now);
  const source = lecture.lignes.find(l => l.cle === cle);
  if (!source) throw new OpsRefus(404, 'Source inconnue du registre.');
  const [runs, identite, config] = await Promise.all([
    tx.sourceRun.findMany({ where: { sourceKey: cle }, orderBy: [{ ranAt: 'desc' }, { id: 'desc' }], take: 12,
      select: { runId: true, status: true, jobs: true, previousJobs: true, fetched: true, accepted: true, declaredTotal: true, truncated: true,
        complete: true, canAttestAbsence: true, errors: true, note: true, ranAt: true } }),
    readIdentityQueue(tx, now),
    tx.source.findUnique({ where: { key: cle }, select: { careersDomain: true, portalScope: true, config: true } }),
  ]);
  const commandes = new Map((await tx.pipelineRun.findMany({ where: { id: { in: runs.flatMap(r => (r.runId ? [r.runId] : [])) } },
    select: { id: true, command: true } })).map(p => [p.id, p.command]));
  return {
    at: lecture.at, etatCalcule: lecture.etatCalcule, source,
    portail: { domaine: config?.careersDomain ?? null, perimetre: config?.portalScope ?? null, adresse: adressePortail(config?.config) },
    collectes: runs.map(r => ({ a: r.ranAt.toISOString(), statut: r.status, commande: r.runId ? commandes.get(r.runId) ?? null : null,
      offres: r.jobs, offresAvant: r.previousJobs, lues: r.fetched, acceptees: r.accepted, totalAnnonce: r.declaredTotal, tronquee: r.truncated,
      complete: r.complete, absenceAttestable: r.canAttestAbsence, erreurs: r.errors, note: r.note ? r.note.slice(0, 300) : null })),
    fileIdentite: identite.filter(e => e.sourceKey === cle).map(entreeIdentite),
  };
}

/** L'adresse publique du portail lu, seule : la configuration de l'adaptateur n'est pas exposée telle quelle. */
function adressePortail(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null;
  for (const champ of ['listingUrl', 'url', 'origin', 'sitemapUrl']) {
    const v = (config as Record<string, unknown>)[champ];
    if (typeof v === 'string' && /^https?:\/\/[^\s]{1,500}$/i.test(v)) return v;
  }
  return null;
}

export const entreeIdentite = (e: Awaited<ReturnType<typeof readIdentityQueue>>[number]) => ({
  id: e.id, source: e.sourceKey, motif: e.motif, libelleBrut: e.rawLabel, nomPropose: e.proposedName, offres: e.offers,
  depuis: e.firstSeenAt.toISOString(), vueLe: e.lastSeenAt.toISOString(), ageJours: e.ageDays, echue: e.overdue,
  echeance: e.escalateAt.toISOString(), manque: e.missingProof, question: e.question, exemples: e.sampleExternalIds.slice(0, 5),
});
