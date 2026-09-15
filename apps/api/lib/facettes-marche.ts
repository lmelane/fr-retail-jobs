import { facettesDuMarche, type DimensionFacette } from '../../aggregator/src/normalize/marches';

/**
 * QUELLES FACETTES L'API SERT, MARCHÉ PAR MARCHÉ.
 *
 * ── LE PRINCIPE PRODUIT (arbitrage Loïc) ──────────────────────────────────
 *
 * « Respecter les données natives des pays. Offres FR → champs FR → filtres FR.
 * Offres internationales → champs internationaux. Il ne faut pas imposer les
 * champs d'un pays à un autre, ça doit être natif. »
 *
 * Le cas qui fonde la règle est américain, et il est contre-intuitif : les
 * États-Unis sont notre plus gros marché (36 942 offres actives mesurées le
 * 2026-09-15) et c'est précisément là qu'il ne faut PAS servir « Type de
 * contrat ». L'emploi y est *at-will* — 12 503 descriptions américaines le
 * déclarent — donc la durée n'est publiée que sur 19,2 % des offres. Servir la
 * facette rendrait 80,8 % de « non précisé » : le candidat coche, voit le
 * catalogue fondre de quatre cinquièmes, et conclut que le site est vide.
 *
 * Le registre `marches.ts` porte la mesure et le seuil. Ce module ne refait ni
 * l'une ni l'autre : il TRADUIT une décision déjà prise dans le vocabulaire de
 * l'API. C'est volontairement tout ce qu'il fait.
 *
 * ── POURQUOI ON LIT LE REGISTRE AU LIEU DE RECOPIER SA LISTE ──────────────
 *
 * Les dimensions du registre bougent : `metier` et `seniorite` y sont entrées
 * après coup, quand un audit a montré que le registre initial ne décrivait que
 * le vocabulaire CONTRACTUEL et concluait à tort que « le marché américain ne
 * garde qu'une facette ». Une liste de dimensions recopiée ici aurait figé
 * cette erreur côté API, et rien ne l'aurait signalée : le code aurait compilé,
 * les témoins seraient passés, et la facette `metier` — 96,8 % de couverture
 * aux US, la plus dense du marché — n'aurait jamais été servie.
 *
 * D'où la règle de construction : ce module n'énumère JAMAIS les dimensions. Il
 * appelle `facettesDuMarche()` et se contente de traduire ce qu'elle rend. Une
 * dimension ajoutée au registre demain arrive ici sans qu'on touche à ce
 * fichier — à la seule condition qu'elle ait sa ligne dans la table ci-dessous.
 */

/** Les noms de facettes tels que la réponse de l'API les expose (`JobsResult.facets`). */
export type NomFacetteApi =
  | 'sectors'
  | 'contracts'
  | 'workTimes'
  | 'programs'
  | 'engagements'
  | 'cities'
  | 'groups'
  | 'maisons'
  | 'sources'
  | 'countries'
  | 'occupations'
  | 'languages';

/**
 * LA TABLE DE CORRESPONDANCE — facette de l'API ↔ dimension du registre.
 *
 * UN SEUL ENDROIT, et c'est l'essentiel de ce fichier. Les deux vocabulaires
 * ont divergé pour de bonnes raisons — l'API nomme ses facettes en anglais au
 * pluriel depuis l'origine, le registre nomme ses dimensions en français au
 * singulier parce qu'il décrit un arbitrage métier. Les réconcilier à deux
 * endroits, c'est garantir qu'ils dérivent : le jour où quelqu'un renomme une
 * dimension, une seule des deux copies suivrait, et la facette disparaîtrait de
 * tous les marchés sans la moindre erreur.
 *
 * Une facette ABSENTE de cette table n'est PAS oubliée : elle est déclarée hors
 * périmètre du registre, et donc toujours servie. C'est le cas de la majorité
 * d'entre elles, et c'est voulu :
 *
 *  · `sectors`, `cities`, `groups`, `maisons`, `countries`, `sources` ne
 *    décrivent pas le vocabulaire d'emploi d'un pays. Une ville est une ville
 *    partout ; le registre n'a aucune mesure à leur sujet et n'a pas à en
 *    avoir. Les restreindre par marché serait leur appliquer une règle écrite
 *    pour autre chose ;
 *  · `languages` est la facette qui PERMET de traverser les marchés (D-419 §3).
 *    La masquer selon le pays casserait sa raison d'être.
 *
 * `engagements` est le cas limite qui mérite sa ligne. La dimension existe côté
 * API, mais le registre l'a explicitement écartée (130 offres dans TOUT le
 * catalogue, aucune facette, aucun index — règle Loïc du 2026-09-08). Elle est
 * donc ici, mappée sur une dimension que `facettesDuMarche()` ne rendra jamais,
 * ce qui la retire de tout marché connu. L'écrire noir sur blanc vaut mieux que
 * l'omettre : une omission se relit comme un oubli, cette ligne se relit comme
 * une décision.
 */
/*
 * `satisfies` et NON une annotation de type : l'annotation
 * `Partial<Record<NomFacetteApi, …>>` ferait croire au compilateur que TOUTES
 * les facettes sont dans la table, et `keyof typeof` rendrait alors la liste
 * complète. Le type de retour de `facettesServies` déclarerait du coup
 * `sectors` et `cities` optionnelles — elles ne le sont jamais. `satisfies`
 * vérifie la forme sans élargir les clés.
 */
const CORRESPONDANCE_FACETTE = {
  contracts: 'contrat',
  workTimes: 'temps',
  programs: 'programme',
  occupations: 'metier',
  /*
   * `engagementType` est hors facette par décision (130 offres au catalogue).
   * Le registre ne le liste pas dans ses dimensions exposables, donc cette
   * entrée le retire de tout marché reconnu — volontairement, pas par accident.
   */
  engagements: 'engagement' as DimensionFacette,
} as const satisfies Readonly<Partial<Record<NomFacetteApi, DimensionFacette>>>;

/**
 * Cette facette doit-elle être SERVIE pour ce marché ?
 *
 * ── LA DÉGRADATION EST SÛRE, ET C'EST LE POINT LE PLUS IMPORTANT ──────────
 *
 * Un marché absent (`undefined`, chaîne vide) ou inconnu du registre — la
 * Belgique, la Chine, et les 109 autres pays du catalogue que personne n'a
 * mesurés — rend `true` pour TOUT. On sert alors exactement ce qu'on servait
 * avant ce lot : le comportement actuel, inchangé.
 *
 * Le sens de cette dégradation n'est pas arbitraire. Se tromper en servant une
 * facette coûte un filtre peu rempli ; se tromper en la masquant retire au
 * candidat un filtre qui marchait, sans message et sans recours. Entre les
 * deux, on choisit le défaut réversible par un clic.
 *
 * Corollaire : ce module ne décide JAMAIS d'après le pays « probable » d'un
 * visiteur. Seul un marché explicitement mesuré restreint quoi que ce soit —
 * servir les facettes françaises à un candidat belge parce que « c'est
 * presque pareil » serait pire que de ne rien restreindre du tout.
 */
export function facetteServie(nom: NomFacetteApi, marche: string | undefined): boolean {
  // La table ne porte que les facettes conditionnelles ; l'élargissement de
  // lecture est sûr — une clé absente rend `undefined`, donc « toujours servie ».
  const dimension = (CORRESPONDANCE_FACETTE as Readonly<Partial<Record<NomFacetteApi, DimensionFacette>>>)[nom];
  // Hors périmètre du registre (ville, secteur, langue…) : toujours servie.
  if (!dimension) return true;

  const dimensionsDuMarche = facettesDuMarche(marche ?? '');
  // Marché absent ou non mesuré : aucune restriction. Voir la dégradation sûre.
  if (!dimensionsDuMarche.length) return true;

  return dimensionsDuMarche.includes(dimension);
}

/**
 * Retire d'un objet de facettes celles que le marché ne justifie pas.
 *
 * ── ABSENTE, JAMAIS VIDE ──────────────────────────────────────────────────
 *
 * La facette non retenue est SUPPRIMÉE de la réponse, pas remise à `[]`. Les
 * deux états disent des choses opposées au front, et il doit pouvoir les
 * distinguer :
 *
 *  · clé absente  → « cette dimension n'a pas de sens sur ce marché »
 *                   (ne dessine pas le filtre du tout) ;
 *  · tableau vide → « le filtre existe ici, mais la recherche courante ne
 *                   laisse aucune valeur » (dessine-le, désactivé ou vide).
 *
 * Les confondre produirait le pire des deux mondes : soit un filtre américain
 * « Type de contrat » affiché vide et réputé cassé, soit un filtre français
 * légitime qui disparaît dès qu'une recherche est trop étroite.
 *
 * ── CE QUE LE TYPE DE RETOUR DIT, ET POURQUOI IL N'EST PAS `Partial<T>` ───
 *
 * Seules les facettes PRÉSENTES dans la table de correspondance peuvent
 * disparaître. `sectors`, `cities`, `countries`… n'y sont pas, donc elles
 * survivent à tout marché — et le type doit le dire. Rendre `Partial<T>`
 * aurait obligé l'appelant à un `as` pour retrouver ses clés garanties, et ce
 * `as` aurait masqué du même coup toute vraie erreur de forme.
 *
 * `Omit<T, NomFacetteConditionnelle> & Partial<T>` exprime l'invariant :
 * conditionnelles optionnelles, les autres garanties.
 */
/** Les seules facettes qu'un marché peut retirer — celles de la table, et elles seules. */
export type NomFacetteConditionnelle = keyof typeof CORRESPONDANCE_FACETTE;

export function facettesServies<T extends Partial<Record<NomFacetteApi, unknown>>>(
  facettes: T,
  marche: string | undefined,
): Omit<T, NomFacetteConditionnelle> & Partial<T> {
  // Reconstruction plutôt que `delete` : l'objet d'entrée n'est jamais muté,
  // et son appelant peut continuer à s'en servir (compteurs, journalisation).
  const retenues: Partial<T> = {};
  for (const [nom, valeur] of Object.entries(facettes) as [NomFacetteApi, T[NomFacetteApi]][]) {
    if (facetteServie(nom, marche)) retenues[nom] = valeur;
  }
  return retenues as Omit<T, NomFacetteConditionnelle> & Partial<T>;
}
