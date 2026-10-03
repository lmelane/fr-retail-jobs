import { readLatestCoverageSnapshot, readServedCoverage, type SnapshotLine } from '@catwalks/aggregator/src/coverage/coverageReading.js';
import { CAUSE_LABEL } from '@catwalks/aggregator/src/coverage/coverageBulletin.js';
import { SEVERITY, type AlertCause, type Gravity } from '@catwalks/aggregator/src/coverage/coverageAlert.js';
import type { Tx } from './lecture';

/**
 * D-522 §5 — la couverture par Maison et par marché : les offres servies maintenant (`readServedCoverage`, le filtre et
 * le regroupement de l'alerte de couverture) à côté de la dernière photographie du RUN (`readLatestCoverageSnapshot` :
 * offres servies au RUN, référence comparée, cause et gravité posées par `evaluateCoverage`). Rien n'est réévalué ici :
 * une perte est celle que l'alerte du RUN a posée.
 */
const GRAVITE_LIBELLE: Readonly<Record<Gravity, string>> = { A_REPARER: 'à réparer', A_VERIFIER: 'à vérifier', INFORMATION: 'information' };
const libelleCause = (cause: string | null) => (cause && Object.hasOwn(CAUSE_LABEL, cause) ? CAUSE_LABEL[cause as AlertCause] : cause);
const severite = (g: string | null) => (g && Object.hasOwn(SEVERITY, g) ? SEVERITY[g as Gravity] : -1);

export type LigneCouverture = { portee: 'MAISON' | 'MARCHE' | 'SOURCE'; cle: string; libelle: string; servies: number | null;
  auRun: number | null; reference: number | null; cause: string | null; causeLibelle: string | null; gravite: string | null; graviteLibelle: string | null };

const depuisPhoto = (row: SnapshotLine) => ({ auRun: row.served, reference: row.reference, cause: row.cause, causeLibelle: libelleCause(row.cause),
  gravite: row.gravity, graviteLibelle: row.gravity && Object.hasOwn(GRAVITE_LIBELLE, row.gravity) ? GRAVITE_LIBELLE[row.gravity as Gravity] : row.gravity });

export async function lireCouverture(tx: Tx, now: Date) {
  const [servie, photo] = await Promise.all([readServedCoverage(tx, now), readLatestCoverageSnapshot(tx)]);
  const auRun = new Map((photo?.rows ?? []).map(r => [`${r.scope}:${r.key}`, r]));
  const lignes = (portee: 'MAISON' | 'MARCHE'): LigneCouverture[] => {
    const vues = new Set<string>();
    const out: LigneCouverture[] = servie.entities.filter(e => e.scope === portee).map(e => {
      vues.add(e.key);
      const r = auRun.get(`${portee}:${e.key}`);
      return { portee, cle: e.key, libelle: e.label, servies: e.served, ...(r ? depuisPhoto(r)
        : { auRun: null, reference: null, cause: null, causeLibelle: null, gravite: null, graviteLibelle: null }) };
    });
    // Une Maison ou un marché photographié au RUN qui ne sert plus rien aujourd'hui reste visible, à zéro.
    for (const r of photo?.rows ?? []) if (r.scope === portee && !vues.has(r.key)) out.push({ portee, cle: r.key, libelle: r.label, servies: 0, ...depuisPhoto(r) });
    return out.sort((a, b) => severite(b.gravite) - severite(a.gravite) || (b.servies ?? 0) - (a.servies ?? 0) || a.libelle.localeCompare(b.libelle));
  };
  const pertes: LigneCouverture[] = (photo?.rows ?? []).filter(r => r.cause !== null || r.gravity !== null)
    .map(r => ({ portee: r.scope as LigneCouverture['portee'], cle: r.key, libelle: r.label, servies: null, ...depuisPhoto(r) }))
    .sort((a, b) => severite(b.gravite) - severite(a.gravite) || ((b.reference ?? 0) - (b.auRun ?? 0)) - ((a.reference ?? 0) - (a.auRun ?? 0)));
  return { at: now.toISOString(), offresServies: servie.total,
    photographie: photo ? { prise: photo.takenAt.toISOString(), runId: photo.runId } : null,
    maisons: lignes('MAISON'), marches: lignes('MARCHE'), pertes };
}
