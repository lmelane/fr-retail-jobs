import { prisma, Prisma } from '@catwalks/db';
import { publicJobSql } from '@catwalks/db/availability';
import { DatabaseUnavailableError } from './jobs';

/**
 * D-471 — LE REGISTRE DES SOCIÉTÉS, CHERCHÉ PAR SON NOM, POUR LE BACK-OFFICE.
 *
 * L'équipe lie une Maison du backend à une société du registre (« Maison du
 * catalogue ») : ce lien prime sur le rattachement par le nom dans la
 * projection des offres Catwalks (correspondance version 6). Cette recherche
 * lui montre les candidats : sociétés CANONIQUES seulement (une société
 * fusionnée n'est plus un choix, sa survivante l'est), trouvées par leur nom ou
 * par un alias revu, sans casse, accents ni apostrophes typographiques
 * (`catwalks_normaliser_texte`, la normalisation de la recherche d'offres).
 *
 * Le fragment saisi est une donnée, jamais un motif. Il est NORMALISÉ d'abord, puis `%`, `_` et `\` y sont
 * échappés pour `LIKE`, dans la requête elle-même : échappé avant, la normalisation (`unaccent`) aurait refait des
 * jokers des formes pleine chasse `％ ＿ ＼` (audit du 27/09/2026). Le nom exact se compare au texte normalisé, non
 * échappé.
 *
 * Vingt résultats au plus, choisis par la pertinence du nom : exact, puis commençant par le fragment, puis les
 * autres, le nom le plus court d'abord. Parmi eux, à pertinence égale, la société qui publie le plus d'offres passe
 * devant, parce que c'est ce qui départage deux homonymes (« Loewe », 80 offres, et « Perfumes Loewe », 7, le
 * 27/09/2026). Les offres ne se comptent que pour ces vingt-là : une recherche trop large se précise, elle ne se
 * trie pas sur tout le registre.
 */
export const REGISTRE_RESULTATS_MAX = 20;
export const REGISTRE_Q_MIN = 2;
export const REGISTRE_Q_MAX = 80;

export type SocieteDuRegistre = { id: string; nom: string; domaine: string | null; groupe: string | null; offres: number };

export async function rechercherSocietes(q: string, at = new Date()): Promise<SocieteDuRegistre[]> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    const lignes = await prisma.$queryRaw<Array<{ id: string; nom: string; domaine: string | null; groupe: string | null; offres: number }>>`
      WITH cible AS (SELECT catwalks_normaliser_texte(${q.trim()}) AS n),
      motif AS (SELECT n, replace(replace(replace(n, '\\', '\\\\'), '%', '\\%'), '_', '\\_') AS m FROM cible),
      candidats AS (
        SELECT c.id, c.name, c.domain, c."parentGroup",
          catwalks_normaliser_texte(c.name) = motif.n AS exact,
          catwalks_normaliser_texte(c.name) LIKE motif.m || '%' ESCAPE '\\' AS prefixe
        FROM "Company" c, motif
        WHERE c."mergedIntoId" IS NULL
          AND (catwalks_normaliser_texte(c.name) LIKE '%' || motif.m || '%' ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM "CompanyAlias" a WHERE a."companyId" = c.id AND a."reviewId" IS NOT NULL
              AND catwalks_normaliser_texte(a."displayName") LIKE '%' || motif.m || '%' ESCAPE '\\'))
        ORDER BY exact DESC, prefixe DESC, length(c.name), c.name
        LIMIT ${REGISTRE_RESULTATS_MAX}
      )
      SELECT k.id, k.name AS nom, k.domain AS domaine, k."parentGroup" AS groupe,
        (SELECT count(*)::int FROM "Job" j WHERE j."companyId" = k.id AND ${publicJobSql(Prisma.sql`j`, at)}) AS offres
      FROM candidats k
      ORDER BY k.exact DESC, k.prefixe DESC, offres DESC, k.name`;
    return lignes.map((l) => ({ id: l.id, nom: l.nom, domaine: l.domaine, groupe: l.groupe, offres: Number(l.offres) }));
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}
