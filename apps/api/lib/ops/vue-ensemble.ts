import { readRunOverview } from '@catwalks/aggregator/src/pipeline/runReading.js';
import { readIdentityQueue } from '@catwalks/aggregator/src/identity/reviewQueue.js';
import { lireCouverture } from './couverture';
import { synthese, type LectureSources, type Sante } from './sources';
import type { Tx } from './lecture';

/**
 * D-522 §5 — la vue d'ensemble : sources par état et trajectoire (`summarizeStates`), offres servies (couverture),
 * dernier RUN et son verdict (`readRunOverview`, la réconciliation journalisée par le RUN), fraîcheur (rapport de santé :
 * offres actives qu'aucune source n'a revues depuis 48 h), pertes de couverture (photographie du dernier RUN) et la file
 * d'identité. Chaque chiffre vient d'un lecteur existant ; la vue ne fait que les assembler.
 */
export async function lireVueEnsemble(tx: Tx, sources: LectureSources, sante: Sante, now: Date) {
  const [run, couverture, identite] = await Promise.all([readRunOverview(tx), lireCouverture(tx, now), readIdentityQueue(tx, now)]);
  const parGravite = (g: string) => couverture.pertes.filter(p => p.gravite === g).length;
  return {
    at: now.toISOString(),
    etatCalcule: sources.etatCalcule,
    sources: synthese(sources),
    offresServies: couverture.offresServies,
    run,
    fraicheur: { fenetreHeures: sante.freshnessHours, offresActives: sante.totals.activeJobs, nonRevues: sante.totals.withoutFreshSource,
      aRisque: sante.totals.atRiskJobs, sansSourceActive: sante.totals.withoutActiveSource },
    couverture: { photographie: couverture.photographie, aReparer: parGravite('A_REPARER'), aVerifier: parGravite('A_VERIFIER'),
      information: parGravite('INFORMATION'), principales: couverture.pertes.filter(p => p.gravite !== 'INFORMATION').slice(0, 8) },
    fileIdentite: { ouvertes: identite.length, echues: identite.filter(e => e.overdue).length, offres: identite.reduce((n, e) => n + e.offers, 0) },
    actions: sources.lignes.filter(l => l.calcule && (l.trajectoire === 'A_REPARER' || l.trajectoire === 'REVUE_HUMAINE')).slice(0, 8)
      .map(l => ({ cle: l.cle, maison: l.maison, trajectoire: l.trajectoire, trajectoireLibelle: l.trajectoireLibelle, causeLibelle: l.causeLibelle,
        manque: l.manque, ageJours: l.ageJours, offresEnJeu: l.offres.enJeu })),
  };
}
