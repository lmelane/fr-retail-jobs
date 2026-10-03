import { explainOffer } from '@catwalks/aggregator/src/coverage/offerExposureReading.js';
import { OpsRefus, type Tx } from './lecture';

/**
 * D-522 §5 — « pourquoi cette offre est ou n'est pas exposée » : `explainOffer` (D-520 §3), la commande `pourquoi-offre`
 * elle-même, sur un identifiant, un slug-id de catwalks.io, un lien d'offre ou de publication, ou `source:identifiant`.
 * Aucune adresse n'est appelée : un lien n'est qu'une clé de recherche en base.
 */
export const REF_MAX = 600;

/** La référence demandée, contrôlée AVANT toute lecture en base. */
export function refDemandee(brut: string | null): string {
  const ref = (brut ?? '').trim();
  if (!ref || ref.length > REF_MAX || /[\u0000-\u001f\u007f]/.test(ref)) throw new OpsRefus(400, `ref : 1 à ${REF_MAX} caractères, sans caractère de contrôle.`);
  if (/^https?:\/\//i.test(ref)) {
    try { new URL(ref); } catch { throw new OpsRefus(400, 'Lien illisible.'); }
  }
  return ref;
}

export async function lirePourquoi(tx: Tx, ref: string, now: Date) {
  const explication = await explainOffer(tx, ref, now);
  if (!explication) throw new OpsRefus(404, `Aucune offre ni publication pour « ${ref.slice(0, 120)} ».`);
  // La preuve de fermeture brute (`DataCorrection.evidence`) n'a pas sa place dans une réponse d'écran : sa date suffit.
  const { lifecycleProof, ...reste } = explication;
  const preuve = lifecycleProof && typeof lifecycleProof === 'object' && 'at' in lifecycleProof ? { at: String((lifecycleProof as { at: unknown }).at) } : null;
  return { ...reste, lifecycleProof: preuve };
}
