/**
 * LA FIN D'UNE LISTE PAGINÉE SOUS UN TOTAL ANNONCÉ, PROUVÉE PAR LE LECTEUR (D-522 §6, 03/10/2026). Pur ; exporté pour ses
 * témoins.
 *
 * Mesuré au RUN du 02/10 : lvmh (index Algolia, 5 980 lues sur `nbHits` 5 980), wttj-sector (Algolia, 2 144 sur 2 144),
 * hm-group, marella, b-s-international et funky-buddha (API SmartRecruiters, `totalFound` atteint) lisaient tout ce que
 * leur source annonce, douze collectes sur douze depuis le 23/09, et restaient « énumération inconnue » : leurs lecteurs
 * ne déclaraient jamais `complete`, si bien qu'aucune absence n'était attestable (`pipeline/enumeration.ts` : seul un
 * parcours démontré prouve, un total atteint ne suffit pas).
 *
 * Le parcours se démontre ici sur les faits que la source publie à CHAQUE page, et seulement quand tous tiennent :
 *   1. chaque page porte le total, et c'est le même d'un bout à l'autre (`LIST_TOTAL_MISSING`, `LIST_TOTAL_CHANGED`) ;
 *      Algolia dit en outre si ce total est exact (`exhaustiveNbHits`, sinon `LIST_TOTAL_APPROXIMATE`) ;
 *   2. la pagination sert tout le total : Algolia borne `nbPages` par `paginationLimitedTo` (WTTJ, 02/10 : 2 033
 *      offres, `nbPages` 10 pour 100 par page), un plafond se lit donc dans `nbPages × hitsPerPage < total`
 *      (`LIST_PAGINATION_CAPPED`) ;
 *   3. les pages lues se suivent depuis la première, sans trou, et la lecture s'arrête sur la dernière : page courte,
 *      ou total atteint (`LIST_PAGES_NOT_CONTIGUOUS`, `LIST_END_NOT_REACHED`) ;
 *   4. chaque ligne servie est comptée une fois et une seule : lignes servies = identifiants distincts (+ lignes sans
 *      identifiant, nommées à part) = total (`LIST_ROWS_MISMATCH`, `LIST_REPEATED_IDS`).
 * Une ligne sans identifiant natif compte dans la ligne 4 (elle a été servie), mais l'absence reste inattestable
 * (`canonicalAbsenceProofUsable`, au lecteur) : un identifiant historique disparu pourrait être celle-là.
 *
 * Limite écrite, la même que pour tout total annoncé (Workday) : une offre retirée ET une offre ajoutée pendant la
 * lecture, sous un total inchangé, peuvent décaler une offre vivante d'une page à l'autre sans que rien ne se voie.
 */
export type ListPage = {
  /** Le rang de la page lue, à partir de 0, dans l'unité de la source (numéro de page Algolia, offset / taille). */
  index: number;
  /** Le total que la page annonce ; `undefined` si elle n'en porte pas. */
  total?: number;
  /** Lignes servies par la page. */
  rows: number;
  /** Algolia : `nbPages` tel que la page l'annonce (borné par `paginationLimitedTo`). */
  nbPages?: number;
  /** Algolia : le total est-il exact ? `undefined` quand la source ne le dit pas (SmartRecruiters). */
  exhaustive?: boolean;
};

export type ListProofInput = {
  pages: readonly ListPage[];
  /** Taille de page DEMANDÉE. */
  pageSize: number;
  /** Identifiants distincts lus sur toutes les pages. */
  distinctIds: number;
  /** Lignes servies sans aucun identifiant natif. */
  rowsWithoutId: number;
  /** La source publie `nbPages` (Algolia) : il doit alors couvrir le total. */
  requiresPageCount?: boolean;
};

export type ListProof = { complete: boolean; total?: number; failures: string[] };

export function listProof(input: ListProofInput): ListProof {
  const { pages, pageSize } = input;
  if (!pages.length) return { complete: false, failures: ['LIST_NO_PAGE_READ'] };
  const totals = pages.map((p) => p.total);
  const total = totals[0];
  const failures: string[] = [];
  if (totals.some((t) => t === undefined || !Number.isSafeInteger(t) || t < 0)) failures.push('LIST_TOTAL_MISSING');
  else if (totals.some((t) => t !== total)) failures.push(`LIST_TOTAL_CHANGED=${[...new Set(totals)].join('/')}`);
  if (pages.some((p) => p.exhaustive === false)) failures.push('LIST_TOTAL_APPROXIMATE');
  if (input.requiresPageCount && total !== undefined) {
    const nbPages = pages[0]!.nbPages;
    if (nbPages === undefined || !Number.isSafeInteger(nbPages) || nbPages * pageSize < total) failures.push(`LIST_PAGINATION_CAPPED=${nbPages ?? '?'}x${pageSize}/${total}`);
  }
  if (pages.some((p, i) => p.index !== i)) failures.push('LIST_PAGES_NOT_CONTIGUOUS');
  const rows = pages.reduce((sum, p) => sum + p.rows, 0);
  const last = pages[pages.length - 1]!;
  const endReached = last.rows < pageSize || (total !== undefined && rows >= total);
  if (!endReached) failures.push('LIST_END_NOT_REACHED');
  if (total !== undefined) {
    if (rows !== total) failures.push(`LIST_ROWS_MISMATCH=${rows}/${total}`);
    else if (input.distinctIds + input.rowsWithoutId !== total) failures.push(`LIST_REPEATED_IDS=${input.distinctIds + input.rowsWithoutId}/${total}`);
  }
  return { complete: failures.length === 0, ...(total !== undefined ? { total } : {}), failures };
}
