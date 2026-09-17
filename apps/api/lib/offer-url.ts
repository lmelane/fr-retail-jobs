/**
 * Le chemin public d'une offre du catalogue : `/emplois/<slug>-<id>` (lot 9).
 *
 * C'est l'adresse de la fiche sur le site candidat (`/emplois/[id]`, lot 6C).
 * Le slug existe pour les personnes et les moteurs ; l'identifiant seul porte
 * l'identité — un slug périmé (titre modifié à la source) ou absent résout
 * encore l'offre, et le site redirige vers la forme canonique.
 *
 * UN SEUL ALGORITHME, RECOPIÉ À L'IDENTIQUE DANS LE SITE (`cheminEmploi`,
 * `src/components/emplois/EmploiCard.tsx`) : le sitemap et le `url` du
 * balisage sortent d'ici, les liens du site de là-bas, et ils doivent être
 * les mêmes octets. Le témoin `offer-url.test.ts` fixe les cas qui divergeaient
 * (NFKD contre NFD pour les ligatures, 80 caractères, tiret final).
 *
 * Zéro dépendance, volontairement : le site le recopie tel quel.
 */

const SLUG_MAX = 80;

/** « Chargé(e) de clientèle — CDI » → « charge-e-de-clientele-cdi ». */
export function offerSlug(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
}

/** Le chemin canonique d'une offre ; l'identifiant nu quand le titre ne donne aucun slug. */
export function offerPath(job: { id: string; title: string }): string {
  const slug = offerSlug(job.title);
  return `/emplois/${slug ? `${slug}-` : ''}${job.id}`;
}

/**
 * Les identifiants candidats d'un paramètre `/emplois/[param]`.
 *
 * Le paramètre est soit un identifiant nu, soit `slug-id`, et un identifiant
 * peut lui-même contenir des tirets (`cw_…` non, les jeux d'essai oui) : la
 * frontière entre slug et identifiant est ambiguë. Essayés dans l'ordre : la
 * valeur brute, puis chaque suffixe après un tiret, du plus court au plus long,
 * borné — un paramètre hostile ne doit pas devenir une série de lectures.
 */
const MAX_SUFFIX_CANDIDATES = 4;

export function offerIdCandidates(raw: string): string[] {
  const candidates = [raw];
  const suffixes: string[] = [];
  for (let cut = raw.lastIndexOf('-'); cut > 0; cut = raw.lastIndexOf('-', cut - 1)) {
    if (cut < raw.length - 1) suffixes.push(raw.slice(cut + 1));
    if (suffixes.length >= MAX_SUFFIX_CANDIDATES) break;
  }
  return [...candidates, ...suffixes];
}
