import { Prisma } from '@prisma/client';
import { PORTAL_EMPLOYER_ORIGINS } from './portalEmployer.js';

/**
 * UNE OFFRE SUIT L'ÉDITEUR VERS UN EMPLOYEUR DÉJÀ PUBLIÉ PAR SA SOURCE (D-506 §3, arbitrage CEO du 01/10/2026).
 *
 * Une offre déjà attribuée à l'employeur A dont l'éditeur déclarait A et déclare désormais B passe à B SANS revue
 * humaine lorsque la MÊME source publie B sur d'autres offres de cette collecte, déjà attribuées à cet employeur avant
 * elle : le libellé natif B y est résolu vers lui.
 * Hors les deux cas de masse traités le 29/09, une à deux offres par jour changent ainsi d'employeur ; chacune rendait
 * le RUN rouge (`EMPLOYER_SPELLING_DIVERGED`) jusqu'à une revue (le 01/10 : Puma R43416 PUMA SE → PUMA North America,
 * Inc. ; Richemont JR132200 Richemont → Cartier).
 *
 * Ce qui reste en revue humaine, comme avant :
 *   · un employeur jamais vu dans la source avant ce RUN, même s'il existe ailleurs dans le référentiel, même s'il
 *     apparaît dans la même collecte : on ne suit jamais l'éditeur vers une société qu'il ne publiait pas ;
 *   · une offre dont l'éditeur ne nommait pas l'employeur auparavant (attribution du registre ou du portail
 *     certifié) : ce n'est pas un changement chez l'éditeur, D-479 et la relation native marque/employeur s'appliquent ;
 *   · une offre sans observation attribuée précédente (`EMPLOYER_TARGET_MISMATCH`) : rien ne prouve que l'éditeur a
 *     changé d'avis ;
 *   · une source qui n'est pas le portail d'un employeur ou d'un groupe (le job board WTTJ, R-142 §1) : elle publie
 *     des centaines d'employeurs, « la source publie déjà B » n'y prouve aucun lien entre A et B ;
 *   · au-delà de la garde de masse ci-dessous, toutes les offres de la source qui l'auraient suivi.
 *
 * Un alias revu (`REVIEWED_ALIAS`) reste traité avant tout cela par le résolveur : il est une décision humaine, il
 * n'entre ni dans ce suivi ni dans sa garde.
 */

/**
 * LA GARDE DE MASSE (D-506 §3) : quand, dans une même collecte, plus de max(`floor`, `share` × offres collectées) offres
 * de la source changent d'employeur chez l'éditeur, AUCUNE ne suit l'éditeur : toutes restent en revue humaine
 * (`EMPLOYER_CHANGE_MASS` pour celles qui l'auraient suivi). Sont comptés tous les changements d'un employeur nommé
 * par l'éditeur vers un autre, qu'ils puissent suivre ou non : un changement sur une part de la source est une
 * réorganisation ou une erreur de l'éditeur, pas le fil ordinaire de ses offres. Même dénominateur et même borne
 * stricte que la garde de D-484 §1 : 5 changements sur 100 offres collectées passent, 6 sont revus. Tout ou rien : la
 * décision se prend sur le compte complet de la source, avant la première offre déplacée.
 */
export const PUBLISHER_FOLLOW_MASS = { floor: 5, share: 0.05 } as const;

export function publisherFollowBound(collected: number): number {
  return Math.max(PUBLISHER_FOLLOW_MASS.floor, PUBLISHER_FOLLOW_MASS.share * collected);
}

/** Les portails d'un employeur ou d'un groupe (R-142 §1). Liste fermée : un rang inconnu ne suit jamais l'éditeur. */
const EMPLOYER_PORTAL_TIERS: ReadonlySet<string> = new Set(['EMPLOYER_DIRECT', 'GROUP_OFFICIAL', 'ATS_OFFICIAL']);
export function followsPublisherTier(tier: string | undefined): boolean {
  return tier !== undefined && EMPLOYER_PORTAL_TIERS.has(tier);
}

/**
 * Ce que le résolveur fait d'une offre qui remplit la règle :
 *   · `DEFER` — rien d'écrit : il lève `PublisherFollowDeferred`, l'écriture est annulée et l'ingestion la reprend
 *     après le compte de la source, sous l'un des deux modes suivants ;
 *   · `FOLLOW` — l'offre passe à l'employeur déjà publié (`PUBLISHER_FOLLOWED`) ;
 *   · `MASS_GUARDED` — la garde de masse est franchie : revue humaine, motif `EMPLOYER_CHANGE_MASS`.
 * `witnessesBefore` et `publishedUnder` figent la preuve AVANT la première écriture : le début de la collecte, et les
 * libellés natifs que cette collecte donne à chaque offre publiable. La décision ne dépend donc ni de l'ordre des offres
 * dans la liste de l'éditeur ni de ce que la boucle a déjà écrit.
 * Absent, la règle ne s'applique pas : revue humaine comme avant D-506. Seule l'ingestion, qui tient la garde de masse,
 * le renseigne pour écrire ; le rejeu en lecture seule (`rejouer-identite.mts`) s'en sert pour compter.
 */
/** Les origines qui ne sont pas un libellé natif de la page (`ordinaryIdentity.ts`, `isNativeOrigin`). */
const NON_NATIVE_ORIGINS = [...PORTAL_EMPLOYER_ORIGINS, 'LEGACY_UNSPECIFIED'];

export type PublisherFollowMode = 'DEFER' | 'FOLLOW' | 'MASS_GUARDED';
export type PublisherFollow = {
  mode: PublisherFollowMode;
  /** Seule une attribution antérieure témoigne — en production, le début de la collecte de la source. */
  witnessesBefore: Date;
  /** Libellé natif normalisé → offres publiables de cette collecte qui le portent (`collectionEmployerLabels`). */
  publishedUnder: ReadonlyMap<string, readonly string[]>;
};

/** L'index de la collecte : chaque libellé natif normalisé, et les offres qui le portent. */
export function collectionEmployerLabels(postings: Iterable<{ externalId: string; label: string }>): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const { externalId, label } of postings) index.set(label, [...(index.get(label) ?? []), externalId]);
  return index;
}

/** Pas une erreur d'identité : l'offre remplit la règle, sa décision attend le compte de la source (aucune écriture). */
export class PublisherFollowDeferred extends Error {
  constructor(public readonly sourceKey: string, public readonly externalId: string) {
    super(`Publisher follow deferred until the source count: source=${sourceKey} externalId=${externalId}`);
    this.name = 'PublisherFollowDeferred';
  }
}

/**
 * La MÊME source publie-t-elle déjà le libellé natif `normalized` sous l'employeur `employerId` ? Il faut au moins une
 * AUTRE offre de cette collecte (`candidates` : celles que l'éditeur nomme `normalized` aujourd'hui) dont la dernière
 * observation d'employeur AVANT `witnessesBefore` porte ce libellé et cet employeur. D'où trois exclusions voulues :
 *   · une offre apparue, ou passée à B, pendant cette collecte ne témoigne pas : un employeur neuf du jour reste
 *     « jamais vu », et une offre qui suit l'éditeur ne peut pas en entraîner une autre ;
 *   · une offre que l'éditeur ne nomme plus B dans cette collecte ne témoigne plus pour B, même si elle le portait hier ;
 *   · une offre refusée en revue sur B (dernière observation sans employeur) n'est pas attribuée à cet employeur.
 * « Active » veut dire présente et publiable dans la collecte de l'éditeur : c'est lui qui la publie, aujourd'hui.
 *
 * Mesuré en lecture seule sur la production le 01/10/2026 : partir des observations de la source et de l'employeur
 * (index `canonicalEmployerId` et `sourceKey`, croisés) coûte 7 à 24 ms au pire (ulta-jibe, 11 115 offres), contre 2 s
 * pour un parcours des publications ; la liste `candidates` restreint encore la recherche.
 */
export async function sourcePublishesEmployer(tx: Prisma.TransactionClient, sourceKey: string, candidates: readonly string[],
  normalized: string, employerId: string, witnessesBefore: Date): Promise<boolean> {
  if (!candidates.length) return false;
  const [row] = await tx.$queryRaw<{ published: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM "EmployerObservation" w
      WHERE w."sourceKey" = ${sourceKey} AND w."externalId" = ANY(${[...candidates]}::text[])
        AND w."canonicalEmployerId" = ${employerId} AND w."normalizedEmployerName" = ${normalized}
        -- D-506 §3 : seul un libellé NATIF témoigne, jamais un employeur venu du registre ou de la liste du groupe (D-522 §6).
        AND w."labelOrigin" <> ALL(${[...NON_NATIVE_ORIGINS]}::text[])
        AND w."observedAt" < (${witnessesBefore}::timestamptz AT TIME ZONE 'UTC')
        -- w est la dernière observation de sa publication avant la collecte (même ordre que le résolveur : date, puis id).
        AND NOT EXISTS (SELECT 1 FROM "EmployerObservation" later
          WHERE later."sourceKey" = w."sourceKey" AND later."externalId" = w."externalId"
            AND later."observedAt" < (${witnessesBefore}::timestamptz AT TIME ZONE 'UTC')
            AND (later."observedAt" > w."observedAt" OR (later."observedAt" = w."observedAt" AND later.id > w.id)))
    ) AS published`;
  return row?.published === true;
}
