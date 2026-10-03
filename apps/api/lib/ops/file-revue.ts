import { readIdentityQueue } from '@catwalks/aggregator/src/identity/reviewQueue.js';
import { ambiguousSources, readRegistrySources } from '@catwalks/aggregator/src/registry/explicitRegistryRead.js';
import { readLatestCoverageSnapshot } from '@catwalks/aggregator/src/coverage/coverageReading.js';
import { CAUSE_LABEL } from '@catwalks/aggregator/src/coverage/coverageBulletin.js';
import type { AlertCause } from '@catwalks/aggregator/src/coverage/coverageAlert.js';
import { entreeIdentite, type LectureSources } from './sources';
import type { Tx } from './lecture';

/**
 * D-522 §5 — la file de revue, EN LECTURE : ce qui attend réellement un humain, lu là où chaque mécanisme l'écrit.
 *  - identité d'employeur : la file `EmployerIdentityQueue` (`readIdentityQueue`, la plus urgente d'abord) ;
 *  - registre : les sources à trancher (intention A_TRANCHER, revue humaine) et les sources ambiguës
 *    (`ambiguousSources` : sans explication, explication périmée, réexamen échu) ;
 *  - sources en revue humaine : l'état opérationnel l'a escaladée (`REVUE_HUMAINE`) ;
 *  - couverture à vérifier : les pertes que l'alerte du dernier RUN a posées « à vérifier ».
 * Les gestes (approuver, rattacher, refuser) appartiennent au lot 3.
 */
const POURQUOI_AMBIGU: Readonly<Record<string, string>> = {
  UNEXPLAINED: 'sans explication au registre', STALE_EXPLANATION: 'explication d’un autre statut (périmée)', REVIEW_OVERDUE: 'réexamen échu',
};

export async function lireFileRevue(tx: Tx, sources: LectureSources, now: Date) {
  const [identite, registre, photo] = await Promise.all([readIdentityQueue(tx, now), readRegistrySources(tx), readLatestCoverageSnapshot(tx)]);
  const today = now.toISOString().slice(0, 10);
  const maison = new Map(sources.lignes.map(l => [l.cle, l.maison]));
  return {
    at: now.toISOString(),
    identite: identite.map(entreeIdentite),
    registre: {
      aTrancher: registre.filter(r => r.status !== 'ACTIVE' && (r.statusIntention === 'A_TRANCHER' || r.statusTrajectory === 'REVUE_HUMAINE'))
        .map(r => ({ cle: r.key, maison: maison.get(r.key) ?? r.key, statut: r.status, question: r.statusQuestion, motif: r.statusReason,
          decision: r.statusDecision, reexamen: r.statusReviewAt, offres: r.activeJobs })),
      ambigues: ambiguousSources(registre, today).map(a => ({ cle: a.key, maison: maison.get(a.key) ?? a.key, statut: a.status, pourquoi: a.why,
        pourquoiLibelle: POURQUOI_AMBIGU[a.why] ?? a.why })),
    },
    sourcesEnRevue: sources.lignes.filter(l => l.calcule && l.trajectoire === 'REVUE_HUMAINE')
      .map(l => ({ cle: l.cle, maison: l.maison, cause: l.cause, causeLibelle: l.causeLibelle, manque: l.manque, depuis: l.depuis, ageJours: l.ageJours,
        offresEnJeu: l.offres.enJeu })),
    couvertureAVerifier: (photo?.rows ?? []).filter(r => r.gravity === 'A_VERIFIER')
      .map(r => ({ portee: r.scope, cle: r.key, libelle: r.label, auRun: r.served, reference: r.reference, cause: r.cause,
        causeLibelle: r.cause && Object.hasOwn(CAUSE_LABEL, r.cause) ? CAUSE_LABEL[r.cause as AlertCause] : r.cause })),
    photographie: photo ? photo.takenAt.toISOString() : null,
  };
}
