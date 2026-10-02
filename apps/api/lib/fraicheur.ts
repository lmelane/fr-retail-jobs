import { Prisma } from '@catwalks/db';

/**
 * D-510 (décision du CEO, 02/10/2026) — LA FRAÎCHEUR D'UNE OFFRE, clé unique du tri au contrat 2 (`x-catwalks-client: 2`).
 *
 * La date de publication que donne la source, sauf quand elle manque ou qu'elle est postérieure à notre première
 * observation (`firstSeenAt` ; `receivedAt` pour une offre Catwalks) : l'offre était alors en ligne avant la date
 * qu'elle annonce, et c'est la première observation qui date sa mise en ligne. Une seule expression le dit :
 * `LEAST(postedAt, firstSeenAt)` (PostgreSQL ignore un `NULL` dans `LEAST`). Une date future est couverte du même coup.
 *
 * Mesuré en production le 02/10/2026, en lecture seule (`audits/2026-10-02/fraicheur-d510/mesure-postedat.sql`) : sur
 * 89 766 offres agrégées publiques, 3 166 sans date (3,5 %, dont 2 024 sans pays, donc jamais servies), aucune date
 * future (l'ingestion écarte une date à plus d'un jour, `plausiblePostedAt`), 2 928 dates postérieures de plus d'un jour
 * à la première observation (republications) ; 59 offres Catwalks, toutes datées, aucune incohérente.
 */
export function fraicheurSql(alias?: 'b' | 'j' | 'd'): Prisma.Sql {
  // L'alias vient d'ici, jamais d'une saisie.
  const t = alias ? `${alias}.` : '';
  return Prisma.raw(`LEAST(${t}"postedAt", ${t}"firstSeenAt")`);
}

/** La même clé côté JS, sur les COLONNES de l'offre (`Job.postedAt`, `firstSeenAt` ; `receivedAt` d'une offre Catwalks). */
export function fraicheurDe(colonnes: { postedAt: Date | null; firstSeenAt: Date }): number {
  const vue = colonnes.firstSeenAt.getTime();
  return colonnes.postedAt ? Math.min(colonnes.postedAt.getTime(), vue) : vue;
}

/**
 * D-510 : les offres Catwalks d'abord (D-419 §1), puis la plus fraîche d'abord, puis l'identifiant (départage stable).
 * `fraicheur` rend la clé d'une ligne lue AVANT sa projection : la date affichée d'une offre agrégée vient de sa
 * publication (`toRow`), le tri de la recherche de la colonne `Job.postedAt` ; les deux peuvent différer.
 */
export function trierParFraicheur<T extends { id: string; origine: string }>(lignes: readonly T[], fraicheur: (ligne: T) => number): T[] {
  const rang = (l: T) => (l.origine === 'CATWALKS' ? 0 : 1);
  return [...lignes].sort((a, b) => rang(a) - rang(b) || fraicheur(b) - fraicheur(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
