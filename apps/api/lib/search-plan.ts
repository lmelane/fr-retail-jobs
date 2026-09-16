import { facettesContrat, type CleFacette, type FacetteContrat, type Perimetre } from '@catwalks/db/marches';
import { resolveLieu, type LieuResolu } from './lieu';

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

/** Les dimensions où « non renseigné » n'exclut pas (D-435) ; les autres sont structurelles ou choisies explicitement. */
export type DimensionTolerante = 'contrat' | 'temps' | 'programme' | 'langue';
export const DIMENSIONS_TOLERANTES: readonly DimensionTolerante[] = ['contrat', 'temps', 'programme', 'langue'];

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
  page: number;
};

export type PlanRecherche = {
  perimetre: Perimetre;
  /** Les termes de la recherche texte, bornés en nombre. */
  termes: readonly string[];
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
  page: number;
};

/**
 * AUDIT 14/09/2026 — le nombre de TERMES est borné, pas seulement la longueur
 * de `q` : chaque terme coûte une requête d'alias et ses clauses `ILIKE`. Huit
 * termes dépassent largement une recherche d'emploi réelle ; les termes au-delà
 * sont IGNORÉS, pas refusés — une recherche bavarde rend des résultats.
 */
export const MAX_TERMES = 8;

export function planifierRecherche(perimetre: Perimetre, criteres: CriteresRecherche): PlanRecherche {
  const facettes = facettesContrat(perimetre);
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
    termes: (criteres.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, MAX_TERMES),
    lieu,
    lieuCompris: resolu ? { type: resolu.type, libelle: resolu.libelle } : undefined,
    selections,
    refus,
    facettes,
    source: criteres.source,
    prioritePays: criteres.prioritePays && perimetre.pays.includes(criteres.prioritePays) ? criteres.prioritePays : undefined,
    page: criteres.page,
  };
}
