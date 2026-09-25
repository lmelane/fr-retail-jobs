import { assertPipelineRunning } from '../lib/pipelinePause.js';
import type { PrismaClient } from '@prisma/client';
import { CATALOGUE_CONTRAT_VERSION, ContratInvalideError, lireFlux, type EvenementCatalogue, type FluxCatalogue } from './contrat.js';
import { chargerContexte, type ContexteProjection } from './contexte.js';
import { hashPayload, projeterOffreDirecte } from './projection.js';
import { reprojeterStock, type StatsReprojection } from './reprojection.js';

export { reprojeterLigne, reprojeterStock, type LigneLue, type NonReprojetee, type StatsReprojection } from './reprojection.js';

/**
 * LE CONSOMMATEUR DU FLUX D'OUTBOX (lot 6, D-423) — idempotent, monotone, repris.
 *
 * D-444 (24/09/2026) n'utilise pas ce flux pour la sortie : la copie de production est alimentée par la relecture de la
 * liste publique (`photo.ts`, commande `direct-liste`). Le backend a retiré son outbox de sa branche `development` le
 * 25/09/2026 (`8352cff`) : ce consommateur n'a plus de producteur ; la stack locale l'appelle encore et reste à adapter
 * au lecteur de la liste. Le contrat d'exécution Railway ne l'autorise sur aucun service.
 *
 * Le backend Catwalks sert son outbox page par page, par séquence. Chaque
 * événement est appliqué dans sa propre transaction :
 *
 *  - une séquence déjà consommée est ignorée (rejeu, doublon) ;
 *  - une version inférieure ou égale à celle détenue ne change rien
 *    (désordre, rejeu depuis le début) — une version ancienne ne ressuscite
 *    jamais une offre retirée ni n'écrase une version plus récente ;
 *  - `PUBLIE` projette l'offre ; `RETIRE` la marque inéligible en gardant sa
 *    dernière projection (la fiche peut dire « fermée ») ; `RETIRE` d'une
 *    offre jamais vue ne crée rien ;
 *  - chaque événement laisse une ligne immuable (`DirectOfferEvent`) avec son
 *    effet, et le curseur avance après lui — une interruption reprend au
 *    dernier événement appliqué, sans perte ni double effet ;
 *  - avant la lecture, le stock resté à une correspondance antérieure est
 *    re-projeté depuis son contrat conservé (`reprojeterStock`, D-455).
 *
 * Aucune capture HTTP n'est impliquée : le flux est la projection directe du
 * propriétaire des offres, sa provenance est la séquence et le hachage du
 * contrat reçu.
 */
export const CURSEUR_CATWALKS = 'catwalks';

export type SourceFlux = { lire(depuis: bigint, limite: number): Promise<unknown> };

export type Effet = 'APPLIQUE' | 'STALE' | 'INCONNU' | 'DEJA_VU';

export type StatsFlux = {
  pages: number;
  evenements: number;
  appliques: number;
  stales: number;
  inconnus: number;
  dejaVus: number;
  dernierSeq: bigint | null;
  /** Le stock re-projeté à la correspondance courante avant la lecture (`reprojeterStock`). */
  reprojection: StatsReprojection;
  refus?: string;
};

export class FluxIndisponibleError extends Error {
  constructor(readonly statut: number | null, detail: string) {
    super(`Flux catalogue indisponible : ${detail}`);
    this.name = 'FluxIndisponibleError';
  }
}

/** Le flux HTTP du backend : `GET {base}/api/catalogue/flux?depuis=&limite=` avec la clé partagée. */
export function fluxHttp(base: string, cle: string, fetchImpl: typeof fetch = fetch, delaiMs = 15_000): SourceFlux {
  const racine = base.replace(/\/+$/, '');
  return {
    async lire(depuis, limite) {
      assertPipelineRunning();
      let reponse: Response;
      try {
        reponse = await fetchImpl(`${racine}/api/catalogue/flux?depuis=${depuis}&limite=${limite}`, {
          headers: { accept: 'application/json', authorization: `Bearer ${cle}` },
          signal: AbortSignal.timeout(delaiMs),
        });
      } catch (error) {
        throw new FluxIndisponibleError(null, error instanceof Error ? error.name : 'transport');
      }
      if (!reponse.ok) throw new FluxIndisponibleError(reponse.status, `HTTP ${reponse.status}`);
      return reponse.json();
    },
  };
}

async function appliquer(db: PrismaClient, evenement: EvenementCatalogue, contexte: ContexteProjection): Promise<Effet> {
  return db.$transaction(async (tx) => {
    const vu = await tx.directOfferEvent.findUnique({ where: { seq: evenement.seq } });
    if (vu) return 'DEJA_VU';
    const offreId = evenement.evenement === 'PUBLIE' ? evenement.offre.id : evenement.offreId;
    const courante = await tx.directOffer.findUnique({ where: { id: offreId }, select: { version: true } });
    let effet: Effet;
    if (courante && courante.version >= evenement.version) effet = 'STALE';
    else if (evenement.evenement === 'PUBLIE') {
      const ligne = projeterOffreDirecte(evenement.offre, evenement.seq, evenement.version, contexte);
      await tx.directOffer.upsert({ where: { id: ligne.id }, create: ligne, update: ligne });
      effet = 'APPLIQUE';
    } else if (courante) {
      await tx.directOffer.update({ where: { id: offreId }, data: { eligible: false, version: evenement.version, appliedSeq: evenement.seq } });
      effet = 'APPLIQUE';
    } else effet = 'INCONNU';
    await tx.directOfferEvent.create({ data: {
      seq: evenement.seq, offerId: offreId, version: evenement.version, evenement: evenement.evenement,
      payloadHash: evenement.evenement === 'PUBLIE' ? hashPayload(evenement.offre) : null, effet,
    } });
    await tx.directFeedCursor.upsert({
      where: { id: CURSEUR_CATWALKS },
      create: { id: CURSEUR_CATWALKS, lastSeq: evenement.seq, contractVersion: CATALOGUE_CONTRAT_VERSION, lastReadAt: new Date(), lastError: null },
      update: { lastSeq: evenement.seq, contractVersion: CATALOGUE_CONTRAT_VERSION, lastReadAt: new Date(), lastError: null },
    });
    return effet;
  });
}

export async function consommerFlux(
  db: PrismaClient,
  source: SourceFlux,
  options: { taillePage?: number; depuis?: bigint; pagesMax?: number; contexte?: ContexteProjection } = {},
): Promise<StatsFlux> {
  assertPipelineRunning();
  const contexte = options.contexte ?? await chargerContexte(db);
  const reprojection = await reprojeterStock(db, contexte);
  const taillePage = Math.min(Math.max(options.taillePage ?? 200, 1), 500);
  const curseur = await db.directFeedCursor.findUnique({ where: { id: CURSEUR_CATWALKS } });
  let depuis = options.depuis ?? curseur?.lastSeq ?? BigInt(0);
  const stats: StatsFlux = { pages: 0, evenements: 0, appliques: 0, stales: 0, inconnus: 0, dejaVus: 0, dernierSeq: curseur?.lastSeq ?? null, reprojection };
  const pagesMax = options.pagesMax ?? 10_000;
  try {
    while (stats.pages < pagesMax) {
      let flux: FluxCatalogue;
      try {
        flux = lireFlux(await source.lire(depuis, taillePage));
      } catch (error) {
        if (error instanceof ContratInvalideError) {
          await db.directFeedCursor.upsert({
            where: { id: CURSEUR_CATWALKS },
            create: { id: CURSEUR_CATWALKS, lastSeq: depuis, contractVersion: CATALOGUE_CONTRAT_VERSION, lastReadAt: new Date(), lastError: error.message },
            update: { lastReadAt: new Date(), lastError: error.message },
          });
          return { ...stats, refus: error.message };
        }
        throw error;
      }
      stats.pages += 1;
      for (const evenement of flux.evenements) {
        const effet = await appliquer(db, evenement, contexte);
        stats.evenements += 1;
        if (effet === 'APPLIQUE') stats.appliques += 1;
        else if (effet === 'STALE') stats.stales += 1;
        else if (effet === 'INCONNU') stats.inconnus += 1;
        else stats.dejaVus += 1;
        stats.dernierSeq = evenement.seq;
        depuis = evenement.seq;
      }
      if (flux.suivant === null) break;
      depuis = flux.suivant;
    }
    return stats;
  } catch (error) {
    if (error instanceof FluxIndisponibleError) {
      await db.directFeedCursor.upsert({
        where: { id: CURSEUR_CATWALKS },
        create: { id: CURSEUR_CATWALKS, lastSeq: depuis, contractVersion: CATALOGUE_CONTRAT_VERSION, lastReadAt: new Date(), lastError: error.message },
        update: { lastReadAt: new Date(), lastError: error.message },
      });
    }
    throw error;
  }
}
