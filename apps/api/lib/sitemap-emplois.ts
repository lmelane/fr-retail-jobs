import { Prisma, prisma } from '@catwalks/db';
import { publicJobSql } from '@catwalks/db/availability';
import { PREFIXE_DIRECT, directPubliableSql } from '@/lib/direct-offers';
import { offerPath } from '@/lib/offer-url';
import { DESCRIPTION_MINIMALE } from '@/lib/job-posting-schema';

/**
 * LE SITEMAP DU CATALOGUE, PAGINÉ (lot 9) — servi par `GET /api/sitemap/emplois?page=n`.
 *
 * Le seul stock ÉLIGIBLE : les offres publiables (deux origines) qui portent
 * une vraie date de publication, une description d'au moins
 * `DESCRIPTION_MINIMALE` caractères, qui ne sont pas des candidatures
 * spontanées et dont l'échéance n'est pas passée. Aucune combinaison de
 * recherche (marché, filtre, langue) n'entre jamais ici : une fiche, un
 * chemin, calculé par le même algorithme que les liens du site (`offerPath`).
 *
 * `lastmod` est la dernière modification réelle de la ligne (`updatedAt`) —
 * jamais l'instant de génération. Pages de `TAILLE_PAGE` chemins, ordre
 * stable (origine, identifiant) : Google accepte 50 000 URL par sitemap, une
 * page plus courte garde les réponses légères. Le site sert
 * `/sitemap-emplois.xml?page=n` depuis la route et ne l'inscrit à son index
 * que lorsque l'indexation du catalogue est ouverte.
 *
 * Vit hors de la route parce qu'un fichier `route.ts` de Next n'exporte que
 * ses champs réservés (le build refuse `TAILLE_PAGE`).
 */
export const TAILLE_PAGE = 5000;

export type PageSitemapEmplois = {
  page: number;
  pages: number;
  taille: number;
  total: number;
  entrees: Array<{ chemin: string; lastmod: string }>;
};

type Ligne = { id: string; title: string; lastmod: Date };

/** Le prédicat d'éligibilité au sitemap, une fois pour chaque origine ; `DESCRIPTION_MINIMALE` est celui du balisage. */
function eligibleAgregee(asOf: Date): Prisma.Sql {
  return Prisma.sql`${publicJobSql(Prisma.sql`j`, asOf)} AND j."postedAt" IS NOT NULL
    AND length(coalesce(j.description, '')) >= ${DESCRIPTION_MINIMALE}
    AND j."opportunityType" IS DISTINCT FROM 'OPEN_APPLICATION'`;
}
function eligibleDirecte(asOf: Date): Prisma.Sql {
  return Prisma.sql`${directPubliableSql(Prisma.sql`d`, asOf)} AND length(coalesce(d.description, '')) >= ${DESCRIPTION_MINIMALE}`;
}

/**
 * La page `page` (à partir de 1) du sitemap : `pages` compte les pages réelles,
 * et une page au-delà de la dernière rend `entrees` vide — c'est à la route de
 * la refuser (404), jamais de servir un sitemap vide.
 */
export async function pageSitemapEmplois(page: number, asOf: Date = new Date()): Promise<PageSitemapEmplois> {
  const [[compte], lignes] = await Promise.all([
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT ((SELECT count(*) FROM "Job" j WHERE ${eligibleAgregee(asOf)})
            + (SELECT count(*) FROM "DirectOffer" d WHERE ${eligibleDirecte(asOf)}))::int AS n`),
    prisma.$queryRaw<Ligne[]>(Prisma.sql`
      SELECT id, title, lastmod FROM (
        SELECT ${PREFIXE_DIRECT} || d.id AS id, d.title, d."updatedAt" AS lastmod, 0 AS origine FROM "DirectOffer" d WHERE ${eligibleDirecte(asOf)}
        UNION ALL
        SELECT j.id, j.title, j."updatedAt" AS lastmod, 1 AS origine FROM "Job" j WHERE ${eligibleAgregee(asOf)}
      ) o ORDER BY origine, id LIMIT ${TAILLE_PAGE} OFFSET ${(page - 1) * TAILLE_PAGE}`),
  ]);
  return {
    page,
    pages: Math.max(1, Math.ceil(compte.n / TAILLE_PAGE)),
    taille: TAILLE_PAGE,
    total: compte.n,
    entrees: lignes.map((l) => ({ chemin: offerPath(l), lastmod: l.lastmod.toISOString() })),
  };
}
