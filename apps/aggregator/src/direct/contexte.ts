import type { Prisma, PrismaClient } from '@prisma/client';
import { loadOccupationTaxonomy, type CompiledOccupationTaxonomy } from '@catwalks/db/occupations';
import { chargerFrontieres, paysDesCoordonnees, type Frontieres, type VerdictPays } from '../geo/frontieres.js';
import { classifyJob } from '../normalize/taxonomy.js';

/**
 * CE QUE LA PROJECTION D'UNE OFFRE DIRECTE LIT HORS DE L'OFFRE (D-444 ; introduit en correspondance version 4,
 * inchangé en version 5).
 *
 *  - le GROUPE : la Maison publique est rattachée au registre `Company` par son nom, ses alias revus (toutes sources,
 *    comme le filtre « Maison » de l'API) ou le nom d'une société fusionnée ; la comparaison ignore la casse, les
 *    accents, les apostrophes typographiques et les espaces répétés (« L'Occitane » et « L’Occitane »), rien d'autre. Le
 *    groupe est celui de la société rattachée (`Company.parentGroup`, lu par la recherche). Un nom qui désigne deux
 *    sociétés canoniques distinctes, ou aucune, ne rattache rien : jamais un rattachement deviné. Un mandat sans Maison
 *    publique n'est rattaché à rien. La recherche (option et filtre « Maison ») et l'annuaire suivent ce rattachement ;
 *    le bloc Maison d'une fiche et les similaires « même employeur » comparent encore le nom exact.
 *  - le MÉTIER : la version active de la taxonomie des métiers, appliquée à l'intitulé comme pour une offre agrégée ;
 *    le code n'existe que lorsqu'une seule règle revue le désigne (`occupationStatus` CLASSIFIED).
 *  - le PAYS d'une offre de la liste publique : ses coordonnées, par le tracé des frontières, avec abstention (D-435).
 *
 * Le contexte est chargé une fois par passe : une Maison ajoutée au registre, un alias revu ou une nouvelle version de
 * la taxonomie atteignent les offres directes à la passe suivante, par la comparaison des projections (`photo.ts`).
 */
export type MetierProjete = { occupationCode: string | null; occupationReleaseId: string | null };
export type ContexteProjection = {
  rattacher(nomMaison: string | null | undefined): string | null;
  metier(titre: string): MetierProjete;
  pays(latitude: number | null, longitude: number | null): VerdictPays;
};

type Database = PrismaClient | Prisma.TransactionClient;
export type SocieteRegistre = { id: string; name: string; mergedIntoId: string | null };
export type AliasRegistre = { companyId: string; displayName: string };

/** La clé de comparaison d'un nom de Maison : accents, casse, apostrophes typographiques et espaces ne distinguent pas. */
export function cleMaison(nom: string): string {
  return nom.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[’‘‛`´ʼ]/gu, "'").replace(/[\s  ]+/gu, ' ').trim().toLowerCase();
}

/** Le rattacheur d'un registre : nom ou alias → identifiant canonique (fusions suivies), ou `null` si absent ou ambigu. */
export function rattacheurRegistre(societes: readonly SocieteRegistre[], alias: readonly AliasRegistre[]): (nom: string | null | undefined) => string | null {
  const parId = new Map(societes.map((s) => [s.id, s]));
  const canonique = (id: string): string | null => {
    const vus = new Set<string>();
    let courant = parId.get(id);
    while (courant?.mergedIntoId) {
      if (vus.has(courant.id)) return null;
      vus.add(courant.id);
      courant = parId.get(courant.mergedIntoId);
    }
    return courant?.id ?? null;
  };
  const index = new Map<string, Set<string>>();
  const ajouter = (nom: string, id: string) => {
    const cible = canonique(id);
    const cle = cleMaison(nom);
    if (!cible || !cle) return;
    const ensemble = index.get(cle) ?? new Set<string>();
    ensemble.add(cible);
    index.set(cle, ensemble);
  };
  for (const s of societes) ajouter(s.name, s.id);
  for (const a of alias) ajouter(a.displayName, a.companyId);
  return (nom) => {
    if (!nom?.trim()) return null;
    const trouves = index.get(cleMaison(nom));
    return trouves?.size === 1 ? [...trouves][0] : null;
  };
}

export function metierDepuisTaxonomie(taxonomie: CompiledOccupationTaxonomy): (titre: string) => MetierProjete {
  return (titre) => {
    const decision = classifyJob({ title: titre }, taxonomie);
    return { occupationCode: decision.occupationCode, occupationReleaseId: decision.occupationReleaseId };
  };
}

export function contexteDepuis(societes: readonly SocieteRegistre[], alias: readonly AliasRegistre[], taxonomie: CompiledOccupationTaxonomy,
  frontieres: Frontieres = chargerFrontieres()): ContexteProjection {
  const rattacher = rattacheurRegistre(societes, alias);
  const metier = metierDepuisTaxonomie(taxonomie);
  return { rattacher, metier, pays: (latitude, longitude) => paysDesCoordonnees(latitude, longitude, frontieres) };
}

/** Le contexte courant, lu dans la base : registre (alias revus seulement, comme l'API) et version active de la taxonomie. */
export async function chargerContexte(db: Database): Promise<ContexteProjection> {
  const [societes, alias, taxonomie] = await Promise.all([
    db.company.findMany({ select: { id: true, name: true, mergedIntoId: true } }),
    db.companyAlias.findMany({ where: { reviewId: { not: null } }, select: { companyId: true, displayName: true } }),
    loadOccupationTaxonomy(db),
  ]);
  return contexteDepuis(societes, alias, taxonomie);
}
