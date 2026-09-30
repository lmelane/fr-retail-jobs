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

/** Les liens de `pageLinks` qui sont la carte de candidature spontanée que la page elle-même déclare et compte. */
export function joinSpontaneousApplicationCards(html: string, pageUrl: string, pageLinks: readonly string[]): string[] {
  let page: URL;
  try { page = new URL(pageUrl); } catch { return []; }
  if (page.hostname !== 'join.com') return [];
  const script = NEXT_DATA.exec(html)?.[1];
  if (!script) return [];
  let state: Record<string, unknown> | undefined;
  try { state = record(record(record(JSON.parse(script))?.props)?.pageProps)?.initialState as Record<string, unknown> | undefined; }
  catch { return []; }
  const company = record(record(state)?.company), jobs = record(record(state)?.jobs);
  const items = jobs?.items, pagination = record(jobs?.pagination);
  if (record(company?.preference)?.isSpontaneousApplicationEnabled !== true) return [];
  if (typeof company?.domain !== 'string' || !/^[a-z0-9-]+$/i.test(company.domain) || !Array.isArray(items) || !pagination) return [];
  const { page: number, pageCount, perPage, pageSize, total } = pagination;
  if (![number, pageCount, perPage, pageSize, total].every(Number.isSafeInteger)) return [];
  const card = `${page.origin}/companies/${company.domain}/spontaneous-application`;
  if (!pageLinks.includes(card) || items.some(item => record(item)?.idParam === 'spontaneous-application')) return [];
  // Le total de l'éditeur compte exactement les offres paginées et UNE carte, qui ne figure que sur la dernière page.
  const reconciled = number === pageCount && pageSize === items.length &&
    total === ((number as number) - 1) * (perPage as number) + items.length + 1;
  return reconciled ? [card] : [];
}
