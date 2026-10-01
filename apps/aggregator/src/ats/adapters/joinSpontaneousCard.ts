/**
 * La carte « Candidature spontanée » des pages entreprise de join.com (30/09/2026, Gemmyo).
 *
 * Quand l'entreprise accepte les candidatures spontanées, join.com ajoute après ses offres une carte vers
 * `/companies/<entreprise>/spontaneous-application`, et la COMPTE dans le total de sa pagination. Mesuré sur les pages
 * archivées de Gemmyo : 7 = 6 offres + la carte (23/09), 6 = 5 + 1 (28/09), 5 = 4 + 1 (29/09 et 30/09). Le lien répond
 * au motif des offres et sa page ne porte aucun JobPosting : lue comme une fiche, elle rendait DETAIL_FAILURES=1 chaque
 * jour, et la preuve d'énumération de la source tombait.
 *
 * La carte se reconnaît sur l'état que la page de liste embarque (`__NEXT_DATA__`), jamais sur son seul chemin :
 *  - l'entreprise y déclare accepter les candidatures spontanées ;
 *  - aucune offre de la page ne porte ce chemin ;
 *  - la pagination de la page réconcilie le total de l'éditeur avec ses offres ET cette carte, sur la dernière page.
 * Faute d'une seule de ces preuves, rien n'est reconnu : le lien reste lu comme une fiche, comme avant.
 */

const NEXT_DATA = /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/;
/** La raison nommée de la ligne qui la retient : lue, expliquée, jamais une offre ni un échec de collecte. */
export const SPONTANEOUS_APPLICATION_CARD = 'LISTED_SPONTANEOUS_APPLICATION_CARD';

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** L'état que la page de liste join.com embarque, pour une entreprise qui accepte les candidatures spontanées. */
function spontaneousListingState(html: string, pageUrl: string) {
  let page: URL;
  try { page = new URL(pageUrl); } catch { return undefined; }
  if (page.hostname !== 'join.com') return undefined;
  const script = NEXT_DATA.exec(html)?.[1];
  if (!script) return undefined;
  let state: Record<string, unknown> | undefined;
  try { state = record(record(record(JSON.parse(script))?.props)?.pageProps)?.initialState as Record<string, unknown> | undefined; }
  catch { return undefined; }
  const company = record(record(state)?.company), jobs = record(record(state)?.jobs);
  const items = jobs?.items, pagination = record(jobs?.pagination);
  if (record(company?.preference)?.isSpontaneousApplicationEnabled !== true) return undefined;
  if (typeof company?.domain !== 'string' || !/^[a-z0-9-]+$/i.test(company.domain) || !Array.isArray(items) || !pagination) return undefined;
  const { page: number, pageCount, perPage, pageSize, total } = pagination;
  if (![number, pageCount, perPage, pageSize, total].every(Number.isSafeInteger)) return undefined;
  // La carte n'est jamais une offre de la page : un élément qui en porterait le chemin rend l'état illisible.
  if (items.some(item => record(item)?.idParam === 'spontaneous-application')) return undefined;
  return { card: `${page.origin}/companies/${company.domain}/spontaneous-application`, items,
    number: number as number, pageCount: pageCount as number, perPage: perPage as number, pageSize: pageSize as number, total: total as number };
}

/** Les liens de `pageLinks` qui sont la carte de candidature spontanée que la page elle-même déclare et compte. */
export function joinSpontaneousApplicationCards(html: string, pageUrl: string, pageLinks: readonly string[]): string[] {
  const state = spontaneousListingState(html, pageUrl);
  if (!state || !pageLinks.includes(state.card)) return [];
  const { card, items, number, pageCount, perPage, pageSize, total } = state;
  // Le total de l'éditeur compte exactement les offres paginées et UNE carte, qui ne figure que sur la dernière page.
  const reconciled = number === pageCount && pageSize === items.length &&
    total === (number - 1) * perPage + items.length + 1;
  return reconciled ? [card] : [];
}

/**
 * LA CARTE SEULE SUR UNE DERNIÈRE PAGE QUE L'ÉDITEUR NE SERT PAS (Gemmyo, RUN du 01/10/2026).
 *
 * join.com rend toujours la première page de la liste, quel que soit le paramètre de page : la réponse à `page=2` est
 * la page 1 (139 075 octets dans les deux cas, archivés par le RUN). Tant que les offres et la carte tenaient sur une
 * page (4 + 1 le 30/09), la carte se lisait et se comptait. Le 01/10, 5 offres remplissent la page de 5 et la carte
 * passe seule en page 2 : total 6, 5 lues, la source tronquée chaque jour tant que l'éditeur publie 5 offres.
 *
 * La page lue suffit à le démontrer, sans deviner : l'entreprise déclare accepter les candidatures spontanées, la page
 * est pleine (`pageSize` = `perPage` = ses offres), aucune n'est la carte ni n'en porte le lien, et le total annonce
 * exactement UN élément de plus, sur la page suivante, qui est la dernière. Cet élément est la carte, que join.com
 * compte toujours en dernier (7 = 6 + 1 le 23/09, 6 = 5 + 1 le 28/09). Une sixième offre ferait un total de 7 et
 * rien n'est reconnu. Mesuré le 01/10/2026 sur l'API publique de join.com : `rowCount` 5, les 5 offres de la page.
 */
export function joinUnreachableSpontaneousCard(html: string, pageUrl: string, pageLinks: readonly string[]): string | undefined {
  const state = spontaneousListingState(html, pageUrl);
  if (!state || pageLinks.includes(state.card)) return undefined;
  const { card, items, number, pageCount, perPage, pageSize, total } = state;
  const full = perPage > 0 && pageSize === perPage && items.length === perPage;
  // Chaque offre de l'état est un lien réellement lu sur la page : l'inférence porte sur ce qui a été vu.
  const base = card.slice(0, -'spontaneous-application'.length);
  const listed = items.every(item => typeof record(item)?.idParam === 'string' && pageLinks.includes(`${base}${record(item)!.idParam}`));
  return full && listed && pageCount === number + 1 && total === number * perPage + 1 ? card : undefined;
}
