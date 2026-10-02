import { FACET_LABELS, langueDesLibelles } from '@catwalks/db/presentation';
import { validateSearchQuery } from './search-intent';
import { facettesContrat, type CleFacette, type FacetteContrat, type Perimetre } from '@catwalks/db/marches';
import { resolveLieu, type LieuResolu } from './lieu';
import type { Proximite } from './geo';

/**
 * LE PLAN DE RECHERCHE — ce que le moteur va réellement demander au SQL, décidé
 * en un seul endroit, pur, avant toute requête.
 *
 * Il tranche trois choses que deux chemins (`whereClause` Prisma et
 * `searchSummary` SQL) tranchaient chacun à leur façon avant le lot 6 :
 *
 *  1. Le PÉRIMÈTRE est acquis (déjà résolu, jamais absent) et borne tout.
 *  2. Les FILTRES sont ET entre dimensions, OU entre les valeurs d'une
 *     dimension. Un filtre que le marché ne sert pas, ou dont la valeur sort
 *     du périmètre, est REFUSÉ explicitement : il est nommé dans `refus`,
 *     retiré du plan, et la réponse le dit. Rien n'est réinterprété en silence
 *     — un lien partagé avec `contrat=CDI` sur le marché américain ne filtre
 *     pas sur une dimension que 83 % des offres n'ont pas, et ne se tait pas.
 *  3. Les dimensions TOLÉRANTES (contrat, temps, programme, langue) gardent
 *     les offres non renseignées (D-435) : le SQL les conserve et les marque
 *     non confirmées ; ce plan dit seulement lesquelles sont tolérantes.
 */
export type Dimension = CleFacette;

export const DIMENSIONS: readonly Dimension[] = ['pays', 'metier', 'secteur', 'contrat', 'temps', 'programme', 'ville', 'maison', 'groupe', 'langue'];

/** Un filtre que le périmètre n'honore pas, nommé dans la réponse (les dimensions tolérantes : `DIMENSIONS_NON_PRECISEES`). */
export type FiltreRefuse = {
  cle: Dimension | 'lieu';
  valeurs: string[];
  motif: 'FACETTE_NON_SERVIE' | 'PAYS_HORS_MARCHE' | 'LIEU_HORS_MARCHE';
};

export type Selections = Partial<Record<Dimension, readonly string[]>>;

export type CriteresRecherche = {
  q?: string;
  lieu?: string;
  filtres: Selections;
  source?: string;
  prioritePays?: string;
  /** D-500 : le client annonce le contrat 2 (`contrat-client.ts`) ; posé par la route, jamais lu dans l'URL. */
  comprendre?: boolean;
  /** D-510 : le tri par fraîcheur, au même client (`annonceFraicheur`) ; posé par la route, jamais lu dans l'URL. */
  fraicheur?: boolean;
  /** D-513, R-143 §6 : les offres qui ne précisent pas un filtre d'emploi restent servies, après (`annonceNonPrecisees`). */
  nonPrecisees?: boolean;
};

/**
 * D-513, R-143 §6 (lecture D-492 du 02/10/2026) — LES FILTRES D'EMPLOI NE CACHENT PAS CE QU'ILS NE RECONNAISSENT PAS.
 *
 * Le contrat et le temps de travail ne sont renseignés que sur 37 % et 73 % des offres servies (mesure du 02/10,
 * `audits/2026-10-02/r143-filtres-alertes/` de l'agrégateur) : un filtre strict « CDI » retirait les deux tiers des CDI.
 * Au contrat 2, une offre qui ne dit rien de la dimension filtrée reste servie, APRÈS les offres reconnues, et signalée
 * (« Type de contrat non précisé par la Maison ») ; une offre qui déclare autre chose (un CDD, un stage) reste écartée
 * (exigence validée de [[D-433]] : « conserver l'accès aux offres non renseignées, sans les présenter comme des
 * correspondances confirmées »). Une ALERTE, elle, n'envoie que les offres reconnues (R-143 §8) : l'examen n'en retient
 * aucune autre (`examenNouveautes`).
 */
export const DIMENSIONS_NON_PRECISEES = ['contrat', 'temps'] as const satisfies readonly Dimension[];
export type DimensionNonPrecisee = (typeof DIMENSIONS_NON_PRECISEES)[number];

export type PlanRecherche = {
  perimetre: Perimetre;
  /** Complete input: excessive queries are refused, never truncated. */
  q: string;
  /** Le lieu accepté dans le périmètre ; `undefined` sans lieu ou lieu refusé. */
  lieu: LieuResolu | undefined;
  /** Ce que le moteur a compris du lieu, même refusé : le front l'affiche tel quel. */
  lieuCompris: { type: LieuResolu['type']; libelle: string } | undefined;
  /** Les sélections acceptées, dimension par dimension. */
  selections: Selections;
  refus: FiltreRefuse[];
  facettes: readonly FacetteContrat[];
  source: string | undefined;
  /** Le pays du visiteur, s'il appartient au périmètre : ses offres d'abord (D-419 §2). */
  prioritePays: string | undefined;
  /**
   * D-496 : les villes cherchées que la base de villes connaît (lieu de la barre, valeurs du filtre `ville`). Posée par
   * `localiserPlan` (geo.ts, une requête), jamais ici : ce plan reste pur. Absente : la recherche d'avant.
   */
  proximite?: Proximite;
  /**
   * D-500 (Q1) : la requête comprise (écriture inclusive, marques de genre, liaisons, formes de base d'un mot seul), au
   * seul client du contrat 2. Absente : la lecture d'avant, à l'identique. (Le classement par le titre, Q4, est remplacé
   * par le tri par fraîcheur de D-510.)
   */
  comprendre?: boolean;
  /**
   * D-510 : l'ordre est l'origine (Catwalks d'abord), puis la fraîcheur (`fraicheur.ts`), puis l'identifiant. La
   * pertinence, la distance et le pays du visiteur ne trient plus ; ils ne servent qu'à retenir les offres (correspondance
   * et cercles). Absente : l'ordre d'avant, à l'identique (contrat 1).
   */
  fraicheur?: boolean;
  /**
   * D-513, R-143 §6 : les dimensions de `DIMENSIONS_NON_PRECISEES` filtrées gardent les offres qui ne les précisent pas,
   * après les reconnues. Absente : le filtre strict d'avant, à l'identique (contrat 1).
   */
  nonPrecisees?: boolean;
};

export function planifierRecherche(perimetre: Perimetre, criteres: CriteresRecherche): PlanRecherche {
  const q = (criteres.q ?? '').trim();
  validateSearchQuery(q);
  // Les liens partagés et les consommateurs API peuvent porter un métier
  // explicite. Cette contrainte reste applicable sans proposer un sélecteur
  // concurrent de la recherche principale dans le contrat initial.
  const facettes = [...facettesContrat(perimetre)];
  if (criteres.filtres.metier?.length) facettes.unshift({ cle: 'metier',
    libelle: FACET_LABELS[langueDesLibelles(perimetre.marche?.localeParDefaut)].metier });
  const servies = new Set(facettes.map((f) => f.cle));
  const refus: FiltreRefuse[] = [];
  const selections: Selections = {};

  for (const cle of DIMENSIONS) {
    const valeurs = criteres.filtres[cle];
    if (!valeurs?.length) continue;
    if (cle === 'pays') {
      /*
       * Un pays du périmètre ne change rien quand la facette n'est pas servie
       * (`?pays=FR` sur le marché français, hérité de l'époque mondiale) : il
       * n'est ni un filtre ni un refus. Un pays HORS périmètre est refusé,
       * facette servie ou non — l'honorer changerait de marché en silence.
       */
      const dedans = valeurs.filter((v) => perimetre.pays.includes(v));
      const dehors = valeurs.filter((v) => !perimetre.pays.includes(v));
      if (dehors.length) refus.push({ cle, valeurs: dehors, motif: 'PAYS_HORS_MARCHE' });
      if (dedans.length && servies.has(cle)) selections.pays = dedans;
      continue;
    }
    if (!servies.has(cle)) {
      refus.push({ cle, valeurs: [...valeurs], motif: 'FACETTE_NON_SERVIE' });
      continue;
    }
    selections[cle] = [...valeurs];
  }

  const resolu = resolveLieu(criteres.lieu) ?? undefined;
  let lieu = resolu;
  if (resolu?.type === 'pays' && !perimetre.pays.includes(resolu.country)) {
    refus.push({ cle: 'lieu', valeurs: [resolu.libelle], motif: 'LIEU_HORS_MARCHE' });
    lieu = undefined;
  }

  return {
    perimetre,
    q,
    lieu,
    lieuCompris: resolu ? { type: resolu.type, libelle: resolu.libelle } : undefined,
    selections,
    refus,
    facettes,
    source: criteres.source,
    prioritePays: criteres.prioritePays && perimetre.pays.includes(criteres.prioritePays) ? criteres.prioritePays : undefined,
    ...(criteres.comprendre ? { comprendre: true } : {}),
    ...(criteres.fraicheur ? { fraicheur: true } : {}),
    ...(criteres.nonPrecisees ? { nonPrecisees: true } : {}),
  };
}
