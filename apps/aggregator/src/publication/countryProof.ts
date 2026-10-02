import type { Prisma } from '@prisma/client';
import type { CandidateJob } from '../dedup/match.js';
import { preuvePays, type MemoireMarches, type PreuvePays } from '../geo/paysParPreuve.js';
import type { Frontieres } from '../geo/frontieres.js';
import { cityOf, countryChainStatus } from './content.js';

type Lecteur = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * La preuve de pays d'une publication que la chaîne laisse sans pays (D-520, offres sans pays), lue AVANT le contenu :
 * `publicationJobContent` reste pur, la lecture du référentiel et du marché de la source se fait ici. Une publication dont la
 * chaîne décide un pays, ou s'abstient sur une contradiction, n'en reçoit aucune : la preuve ne remplace jamais la chaîne.
 * Appelée par l'ingestion (`dedup/upsert.ts`), la réparation relue (`dedup/repair.ts`) et le rattrapage du stock
 * (`geo/rattrapagePays.ts`) : une seule règle pour les trois.
 */
export async function countryProofOf(db: Lecteur, candidate: CandidateJob, frontieres?: Frontieres, marches?: MemoireMarches): Promise<PreuvePays | undefined> {
  const status = countryChainStatus(candidate);
  if (status === 'DECIDED') return undefined;
  if (status === 'ABSTAINED') return { pays: null, cause: 'CONTRADICTION_DECLAREE' };
  return preuvePays(db, { sourceKey: candidate.sourceKey, externalId: candidate.externalId, ville: cityOf(candidate) ?? null, lieu: candidate.location ?? null,
    latitude: candidate.latitude ?? null, longitude: candidate.longitude ?? null }, frontieres, marches);
}

/** La publication, avec sa preuve de pays (ou sans, quand la chaîne décide). Ne mute pas l'entrée. */
export async function withCountryProof<T extends CandidateJob>(db: Lecteur, candidate: T, frontieres?: Frontieres): Promise<T> {
  const paysParPreuve = await countryProofOf(db, { ...candidate, paysParPreuve: undefined }, frontieres);
  return { ...candidate, paysParPreuve };
}
