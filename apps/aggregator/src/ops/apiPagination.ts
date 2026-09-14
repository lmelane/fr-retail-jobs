/**
 * LIRE UNE COLLECTION PAGINÉE JUSQU'AU BOUT — ou échouer bruyamment.
 *
 * Un outil de CONTRÔLE qui s'arrête avant la fin ne rend pas un résultat partiel : il rend un résultat FAUX,
 * parce que tout ce qu'il n'a pas lu ressort « absent ». C'est arrivé en production : la réconciliation des
 * surfaces publiques plafonnait à 50 pages, l'API sert 25 offres par page, et Skechers en publie 1 656 sur
 * **67 pages** — 406 offres parfaitement servies ont été rapportées absentes de l'API.
 *
 * *Une borne arbitraire dans un instrument de mesure fabrique le défaut qu'elle prétend constater.*
 *
 * D'où les deux règles portées ici : la borne vient du `pageCount` **annoncé par la source**, et tout arrêt
 * prématuré — page illisible, pagination invraisemblable — **lève**, pour qu'aucun appelant ne puisse lire un
 * ensemble tronqué comme un ensemble complet.
 */

/** Au-delà, la pagination annoncée est un défaut à signaler, pas une valeur à suivre. */
export const MAX_ANNOUNCED_PAGES = 2000;

export type PageReader<T> = (page: number) => Promise<{ items: T[]; pageCount?: number } | null>;

export async function readAllPages<T>(read: PageReader<T>, label = 'collection'): Promise<T[]> {
  const out: T[] = [];
  let pageCount = 1;
  for (let page = 1; page <= pageCount; page++) {
    const res = await read(page);
    // `null` = la page n'a pas pu être lue. Retourner ce qu'on a déjà transformerait une panne en absence.
    if (!res) throw new Error(`${label}: page ${page} illisible — ensemble incomplet, aucune absence n'est concluable`);
    out.push(...res.items);
    if (page === 1) {
      pageCount = Number(res.pageCount ?? 1);
      if (!Number.isFinite(pageCount) || pageCount < 1) throw new Error(`${label}: pageCount invalide (${res.pageCount})`);
      if (pageCount > MAX_ANNOUNCED_PAGES) throw new Error(`${label}: ${pageCount} pages annoncées — pagination suspecte`);
    }
  }
  return out;
}
