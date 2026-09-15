/**
 * LE REGISTRE DU VOCABULAIRE NATIF PAR MARCHÉ — données pures, zéro branchement.
 *
 * ── LE PRINCIPE PRODUIT (arbitrage Loïc) ──────────────────────────────────
 *
 * « On canonise en fonction du PAYS, toujours sur la même logique de filtres,
 * sauf que le nom et le type des champs sont différents. En France "Type de
 * contrat", ailleurs "Job type", donc les valeurs ne sont pas les mêmes. »
 *
 * Autrement dit : les DIMENSIONS canoniques (durée, rythme, programme,
 * saisonnalité, métier, séniorité) restent mondiales et ne bougent pas. Ce qui
 * change d'un marché à l'autre, c'est (a) le LIBELLÉ sous lequel on les
 * présente, et (b) LESQUELLES on présente. Un candidat français qui clique sur
 * le drapeau australien tombe sur l'Australie, en anglais, avec les facettes
 * australiennes.
 *
 * ── CE QUE CE MODULE EST, ET CE QU'IL N'EST PAS ───────────────────────────
 *
 * C'est un module de DONNÉES : aucun import de la base, aucun effet de bord,
 * aucun appelant à ce stade. Il ne filtre rien, ne requête rien, ne décide rien
 * à l'exécution. Le branchement de l'API et des adaptateurs est un lot séparé.
 *
 * Il ne remplace ni `country.ts` (qui normalise un code pays) ni `language.ts`
 * (qui lit la langue d'une ANNONCE). Un marché n'est pas une langue : la Suisse
 * expose ici `fr-CH` parce que c'est la locale de service par défaut retenue,
 * pas parce que toutes ses annonces sont en français.
 *
 * ── CE QUE LES TAUX DÉCRIVENT : LES MARCHÉS, PAS NOS BUGS ─────────────────
 *
 * Mesuré le 2026-09-15 sur 83 431 offres actives. Le point le plus contre-
 * intuitif du registre — les États-Unis, notre plus gros marché, sans facette
 * de contrat — a été vérifié AVANT d'être gravé, précisément parce qu'un taux
 * bas ressemble toujours à une panne de normalisation :
 *
 *  · le BRUT américain publie une durée de contrat sur 18,8 % des offres, et
 *    nous en canonisons 19,2 %. Nous lisons donc TOUT ce qui existe, et même un
 *    peu plus (titres et descriptions récupèrent le reste). Il n'y a rien à
 *    réparer en amont : le gisement est vide à la source ;
 *  · 12 503 descriptions américaines déclarent l'emploi *at-will* — la relation
 *    y est résiliable à tout moment de part et d'autre. « CDI vs CDD » n'est pas
 *    une question que le marché américain se pose, donc les employeurs ne la
 *    renseignent pas. Le taux mesure une RÉALITÉ JURIDIQUE, pas un défaut.
 *
 * La conséquence produit est la même dans les deux cas : un filtre qu'on ne
 * peut pas remplir ne doit pas être affiché.
 */

/**
 * LE SEUIL D'AFFICHAGE D'UNE FACETTE.
 *
 * Au-dessous de 20 % de couverture, un filtre rend majoritairement du
 * « non précisé » : le candidat coche « CDI », voit le catalogue fondre de 80 %
 * et conclut que le site est vide — alors que les offres manquantes sont
 * simplement muettes sur la dimension. Il perd l'offre ET la confiance.
 *
 * Le seuil est une CONSTANTE nommée, exportée, et le seul endroit où le nombre
 * existe : une valeur recopiée dans chaque marché dériverait au premier
 * ajustement, et le registre deviendrait faux sans que rien ne le signale.
 *
 * Il n'a rien d'une vérité mathématique — c'est un arbitrage produit, révisable
 * par décision. Ce qui n'est PAS révisable, c'est qu'il se décide sur un chiffre
 * mesuré par marché, jamais sur une impression.
 */
export const SEUIL_AFFICHAGE_FACETTE = 0.2;

/**
 * ── POURQUOI « CASUAL » N'EST PAS UNE DIMENSION (AUSTRALIE) ────────────────
 *
 * Bloc nommé et volontairement trouvable : la question reviendra, et la réponse
 * mesurée doit être plus facile à retrouver que l'intuition qui la contredit.
 *
 * L'audit défensif a proposé de créer une dimension `casual` pour l'Australie,
 * sur le constat que le mot apparaît dans 17,8 % des descriptions australiennes
 * et qu'il y désigne un STATUT JURIDIQUE local, sans équivalent ailleurs. La
 * mesure du 2026-09-15 dit que le constat est vrai à moitié, et que la
 * conclusion ne suit pas :
 *
 *  · 220 offres australiennes portent « casual » dans leur description ;
 *  · 121 d'entre elles (55 %) sont DÉJÀ `isSeasonal = true` — donc déjà
 *    couvertes par une dimension existante ;
 *  · il reste 99 offres (45 % des « casual », soit 8 % du marché australien)
 *    que rien ne couvre — très loin des 20 % du seuil d'affichage ;
 *  · AUCUN champ structuré ne porte « casual » : le mot ne vit que dans le
 *    texte libre. Une dimension construite là-dessus serait alimentée par de
 *    l'extraction lexicale, pas par une donnée déclarée.
 *
 * Le contexte réel des offres tranche : « Holiday Superstar Casual »,
 * « Seasonal Casual Sales Consultants », « casual Holiday Stock Replenishment
 * Assistants ». En Australie, `casual` est massivement le VOCABULAIRE du
 * saisonnier, pas une dimension parallèle. Créer une facette reviendrait à
 * afficher deux filtres qui sélectionnent largement les mêmes offres — le pire
 * cas pour un candidat, qui croit affiner et ne fait que se perdre.
 *
 * SI CE RÉSIDUEL MONTAIT UN JOUR au-dessus du seuil, la bonne réponse resterait
 * d'AMÉLIORER LA DÉTECTION DU SAISONNIER pour absorber les 45 % non marqués —
 * pas d'ajouter une dimension. Un gisement mal détecté est un défaut de
 * normalisation ; il ne se répare pas en lui donnant sa propre colonne.
 */

/**
 * ── LE GARDE-FOU PRODUIT : AU MOINS UNE FACETTE DENSE PAR MARCHÉ ───────────
 *
 * Le seuil de 20 % empêche d'afficher un filtre inutilisable. Il n'empêche pas
 * le cas inverse, et bien plus sournois : un marché dont TOUTES les facettes
 * exposées frôlent le seuil. Techniquement conforme, produit mort.
 *
 * C'est exactement l'état du registre sur les seules dimensions contractuelles.
 * Mesuré le 2026-09-15, toutes les facettes exposées laissent 70 % ou plus de
 * « non précisé », la seule exception étant le contrat français (69,2 % de
 * couverture, donc 30,8 % de muettes). Un candidat allemand qui coche
 * « Vollzeit » sur une facette à 74,9 % perd déjà un quart du catalogue.
 *
 * `metier` change la nature du problème : 90,0 à 96,8 % sur neuf marchés sur
 * dix. Ces neuf-là exposent désormais une facette qui rend presque tout le
 * catalogue et qui porte le besoin réel du candidat (« je cherche un poste de
 * vendeur »), pendant que les facettes contractuelles affinent à la marge.
 *
 * LA SUISSE EST L'EXCEPTION, ET ELLE EST MESURÉE, PAS TOLÉRÉE. Son métier
 * plafonne à 77,7 % — le plus bas du registre de plus de douze points. Ce
 * n'est pas un marché sans facette dense par accident : c'est le plus petit
 * marché mesuré (1 220 offres), le seul dont AUCUNE dimension n'atteint 90 %.
 * La barre de densité est donc gardée à 77 % : elle échoue si un marché tombe
 * sous le plancher suisse, et le seuil PLEIN de 90 % est vérifié séparément
 * sur les neuf autres. Graver 90 % pour tout le monde aurait obligé à exclure
 * la Suisse du témoin — c'est-à-dire à retirer du garde-fou le seul marché
 * qu'il aurait attrapé.
 *
 * L'invariant est gardé par un témoin qui ROUGIT si un marché n'expose plus
 * aucune facette dense : un marché dont tous les filtres sont creux n'est pas
 * exploitable, et il vaut mieux l'apprendre en test qu'en production.
 */
export const SEUIL_FACETTE_DENSE = 0.9;

/**
 * Le PLANCHER de densité, en dessous duquel un marché n'est plus exploitable.
 *
 * 77 %, c'est-à-dire juste sous la Suisse (77,705 %) — le marché le moins bien
 * couvert du registre. Deux constantes plutôt qu'une parce qu'elles gardent
 * deux choses différentes : `SEUIL_FACETTE_DENSE` décrit la cible atteinte par
 * neuf marchés, `PLANCHER_FACETTE_DENSE` est la limite qu'AUCUN marché ne doit
 * franchir. Une seule constante aurait forcé à choisir entre un témoin qui
 * ignore la Suisse et un témoin qui ne garde plus rien.
 */
export const PLANCHER_FACETTE_DENSE = 0.77;

/**
 * Les marchés MESURÉS le 2026-09-15, et eux seuls.
 *
 * BE et CN ont été volontairement ÉCARTÉS. Le tableau de couverture ne porte
 * que dix pays ; pour la Belgique et la Chine, nous ne disposons d'aucun taux.
 * Les inscrire supposerait de recopier ceux d'un voisin (« la Belgique, c'est
 * comme la France ») — or c'est exactement l'erreur que le registre existe pour
 * empêcher : CA-fr et FR parlent la même langue et n'ont PAS le même libellé.
 * Un marché entre ici quand il est mesuré, pas quand il est plausible.
 */
export const CODES_MARCHE = ['US', 'FR', 'GB', 'CA', 'DE', 'IT', 'ES', 'NL', 'AU', 'CH'] as const;
export type CodeMarche = (typeof CODES_MARCHE)[number];

/**
 * Les DIMENSIONS exposables — strict sous-ensemble du modèle de `employment.ts`.
 *
 * `engagementType` n'y figure pas : 162 offres sur 83 431 actives (0,19 %,
 * mesuré en production le 2026-09-15), aucune facette, aucun index (règle Loïc,
 * 2026-09-08). Le registre ne réintroduit pas par la fenêtre une dimension que
 * le modèle a laissée hors facette.
 *
 * DEUX VALEURS DISTINCTES SEULEMENT — FREELANCE (118) et INDEPENDENT_CONTRACTOR
 * (44). Même si la couverture montait un jour au-dessus du seuil, ce serait la
 * dimension la plus pauvre du registre en pouvoir de discrimination : `metier`
 * en porte 27, `seniorite` 6. Le nombre de valeurs compte autant que le taux de
 * remplissage, et c'est pourquoi le registre mesure les deux.
 *
 * ── MÉTIER ET SÉNIORITÉ : LE TROU QUE L'AUDIT A RÉVÉLÉ ────────────────────
 *
 * Le registre a d'abord été écrit avec les seules dimensions du VOCABULAIRE
 * CONTRACTUEL, et cette omission a produit un contresens : on en a conclu que
 * « le marché américain ne garde qu'une facette ». Il en garde TROIS, parce que
 * `metier` y couvre 96,8 % des offres et `seniorite` 29,7 %.
 *
 * Un registre qui ignore ses deux dimensions les mieux remplies ne décrit pas
 * le marché, il décrit le sous-ensemble qu'on avait mesuré. Elles entrent donc
 * ici, mesurées le 2026-09-15 comme les autres :
 *
 *  · `metier` — 90 à 97 % partout sauf CH (77,7 %), 27 valeurs distinctes.
 *    C'est la dimension DENSE de chaque marché, celle qui rend un filtre utile
 *    au premier clic ;
 *  · `seniorite` — 18 à 35 %, 6 valeurs distinctes. Elle passe le seuil sur
 *    sept marchés et le rate sur trois (DE, IT, CH) — la même règle que pour le
 *    contrat, appliquée sans exception.
 *
 * Aucune des deux n'est dégénérée : 27 et 6 valeurs distinctes. Une dimension
 * à une seule valeur serait un filtre qui ne filtre rien, et le nombre de
 * valeurs est la seule façon de le savoir avant de l'afficher.
 */
export const DIMENSIONS_FACETTE = [
  'contrat',
  'temps',
  'programme',
  'saisonnier',
  'metier',
  'seniorite',
] as const;
export type DimensionFacette = (typeof DIMENSIONS_FACETTE)[number];

/** La couverture mesurée d'un marché, dimension par dimension, en proportion. */
export type CouvertureMesuree = Readonly<Record<DimensionFacette, number>>;

export type Marche = {
  /** Le code ISO 3166-1 alpha-2, tel que le rend `normalizeCountry`. */
  readonly code: CodeMarche;
  /**
   * La locale de SERVICE du marché — la langue dans laquelle on lui parle.
   *
   * Distincte de la langue d'une annonce (`language.ts`) : un candidat français
   * qui visite l'Australie lit « Job type », même si son navigateur est en
   * français. C'est le marché qui impose sa langue, pas le visiteur.
   */
  readonly locale: string;
  /**
   * Les LIBELLÉS natifs, dans la langue du marché.
   *
   * Relevés marché par marché chez Indeed, qui sert ces dix pays avec dix
   * traductions et deux découpages différents. La dimension ne change jamais —
   * seul son nom change. C'est toute la raison d'être de ce registre : un
   * libellé codé en dur côté front aurait affiché « Type de contrat » à un
   * candidat néerlandais.
   *
   * Un libellé n'est présent que si la dimension l'est : une clé absente est un
   * choix, pas un oubli, et le type l'impose (`Partial` + contrôle au témoin).
   */
  readonly libelles: Readonly<Partial<Record<DimensionFacette, string>>>;
  /** Le nombre d'offres actives mesurées — sert à dater et pondérer le registre. */
  readonly offresMesurees: number;
  /** La couverture mesurée, sur laquelle le seuil s'applique. Rien n'est estimé. */
  readonly couverture: CouvertureMesuree;
};

/**
 * LE REGISTRE — un enregistrement par marché mesuré.
 *
 * Les taux sont recopiés de la mesure de production du 2026-09-15 et d'elle
 * seule. Aucune ligne n'est arrondie « pour faire propre » : 17,2 % reste
 * 0.172, parce que c'est ce chiffre-là qui décide que la Suisse n'expose pas de
 * facette de contrat, et qu'un arrondi à 0.2 inverserait la décision.
 */
export const MARCHES: Readonly<Record<CodeMarche, Marche>> = {
  /**
   * ÉTATS-UNIS — le plus gros marché, et celui SANS facette de contrat.
   *
   * 19,2 % : c'est le cas qui fonde le seuil. Exposer « Job type » ici
   * afficherait un filtre qui masque 4 offres sur 5 dès le premier clic, sur le
   * marché où nous avons le plus à perdre. Le rythme (81,8 %) porte à lui seul
   * le besoin réel — et c'est précisément la dimension que le vocabulaire
   * américain nomme : « full-time » 20 %, « part-time » 18 % des descriptions.
   *
   * Le saisonnier (6,1 %) reste sous le seuil malgré 11 % de « seasonal » dans
   * les descriptions : un mot cité n'est pas une dimension renseignée.
   *
   * TROIS facettes, pas une. Le métier (96,8 %) est la mieux couverte de tout
   * le registre et la séniorité passe le seuil (29,7 %). Lire « les US ne
   * gardent qu'une facette » était une conclusion tirée du sous-ensemble
   * contractuel, pas du marché.
   */
  US: {
    code: 'US',
    locale: 'en-US',
    libelles: { temps: 'Job type', metier: 'Job category', seniorite: 'Experience level' },
    offresMesurees: 36_942,
    couverture: {
      contrat: 0.192,
      temps: 0.818,
      programme: 0.003,
      saisonnier: 0.061,
      metier: 0.96836,
      seniorite: 0.29709,
    },
  },

  /**
   * FRANCE — le marché contractuellement le mieux renseigné, et le seul à
   * exposer les CINQ dimensions du registre.
   *
   * 69,2 % de contrat : le droit français NOMME la durée (CDI 19 %, CDD 12 % des
   * descriptions), donc les employeurs la publient. C'est le miroir exact de la
   * situation américaine — même produit, même modèle canonique, conséquence
   * opposée, décidée par la mesure et non par le pays d'origine du produit.
   *
   * Programme à 22,2 % : stage (17 %) et alternance (4 %) sont des dispositifs
   * structurants du marché français, pas une niche. La combinaison mesurée
   * FULL_TIME+INTERNSHIP (1 226 offres) confirme que programme et rythme sont
   * bien DEUX dimensions, et qu'elles se cumulent.
   */
  FR: {
    code: 'FR',
    locale: 'fr-FR',
    libelles: {
      contrat: 'Type de contrat',
      temps: 'Temps de travail',
      programme: 'Type de programme',
      metier: 'Métier',
      seniorite: 'Niveau d’expérience',
    },
    offresMesurees: 11_026,
    couverture: {
      contrat: 0.692,
      temps: 0.643,
      programme: 0.222,
      saisonnier: 0.002,
      metier: 0.95538,
      seniorite: 0.23,
    },
  },

  /**
   * ROYAUME-UNI — contrat (38,9 %) et rythme (64,6 %) ; « Job type » comme aux US.
   *
   * La séniorité y est la mieux couverte du registre (34,9 %) : le marché
   * britannique nomme le niveau (« junior », « senior », « head of ») dans ses
   * intitulés bien plus systématiquement que les marchés latins.
   */
  GB: {
    code: 'GB',
    locale: 'en-GB',
    libelles: {
      contrat: 'Job type',
      temps: 'Job type',
      metier: 'Job category',
      seniorite: 'Experience level',
    },
    offresMesurees: 3_305,
    couverture: {
      contrat: 0.389,
      temps: 0.646,
      programme: 0.006,
      saisonnier: 0.029,
      metier: 0.94221,
      seniorite: 0.34917,
    },
  },

  /**
   * CANADA — le marché qui prouve que le libellé ne se déduit PAS de la langue.
   *
   * Indeed sert le Canada francophone avec « Type de poste », pas « Type de
   * contrat ». Même langue que la France, libellé différent. Un registre indexé
   * sur la langue au lieu du marché aurait écrit « Type de contrat » à Montréal.
   *
   * Locale `fr-CA` : le Canada est officiellement bilingue et le catalogue luxe
   * y est majoritairement québécois. C'est un choix de service, révisable par
   * décision — pas une déduction de la mesure, qui ne dit rien de la langue.
   *
   * Saisonnier 11,4 % : sous le seuil, donc non exposé, malgré la combinaison
   * FIXED_TERM+PART_TIME+SEASONAL mesurée 245 fois. Une combinaison fréquente
   * dans le sous-ensemble renseigné ne dit rien du taux de remplissage global.
   */
  CA: {
    code: 'CA',
    locale: 'fr-CA',
    libelles: {
      contrat: 'Type de poste',
      temps: 'Type de poste',
      metier: 'Domaine',
      seniorite: 'Niveau d’expérience',
    },
    offresMesurees: 3_129,
    couverture: {
      contrat: 0.349,
      temps: 0.795,
      programme: 0.012,
      saisonnier: 0.114,
      metier: 0.9364,
      seniorite: 0.31256,
    },
  },

  /**
   * ALLEMAGNE — « Anstellungsart », et le programme qui rate le seuil de justesse.
   *
   * 8,0 % de programme alors que « ausbildung » est le mot le plus fréquent des
   * descriptions allemandes (13 %). L'écart dit exactement ce que le seuil
   * protège : le mot est PARTOUT dans le texte, la dimension est renseignée
   * nulle part. Un filtre construit sur la fréquence lexicale au lieu de la
   * couverture réelle aurait été vide huit fois sur dix.
   *
   * SÉNIORITÉ À 19,838 % — sous le seuil de 20 % de seize millièmes. Le libellé
   * « Erfahrungslevel » est relevé et conservé, la facette n'est PAS exposée.
   * C'est le cas qui mesure la valeur d'un seuil : à cette distance, la
   * tentation d'arrondir « puisque c'est pareil » est maximale, et céder une
   * fois vide le seuil de tout pouvoir de décision. Le jour où la mesure passe
   * la barre, il n'y a rien à traduire — seulement un chiffre à mettre à jour.
   */
  DE: {
    code: 'DE',
    locale: 'de-DE',
    libelles: {
      contrat: 'Anstellungsart',
      temps: 'Arbeitszeit',
      metier: 'Berufsfeld',
      seniorite: 'Erfahrungslevel',
    },
    offresMesurees: 3_080,
    couverture: {
      contrat: 0.325,
      temps: 0.749,
      programme: 0.08,
      saisonnier: 0.048,
      metier: 0.92468,
      seniorite: 0.19838,
    },
  },

  /**
   * ITALIE — « Tipo di contratto » ; programme à 16,2 %, sous le seuil.
   *
   * Séniorité 18,975 % : sous le seuil, non exposée, comme en Allemagne et en
   * Suisse. Trois marchés sur dix la ratent — c'est la dimension la plus
   * inégalement renseignée du registre (18,0 % en CH, 34,9 % au GB).
   */
  IT: {
    code: 'IT',
    locale: 'it-IT',
    libelles: {
      contrat: 'Tipo di contratto',
      temps: 'Orario di lavoro',
      metier: 'Categoria',
      seniorite: 'Livello di esperienza',
    },
    offresMesurees: 2_693,
    couverture: {
      contrat: 0.453,
      temps: 0.68,
      programme: 0.162,
      saisonnier: 0.004,
      metier: 0.91682,
      seniorite: 0.18975,
    },
  },

  /** ESPAGNE — « Tipo de empleo » ; « contrato indefinido » 9 % des descriptions. */
  ES: {
    code: 'ES',
    locale: 'es-ES',
    libelles: {
      contrat: 'Tipo de empleo',
      temps: 'Jornada laboral',
      metier: 'Categoría',
      seniorite: 'Nivel de experiencia',
    },
    offresMesurees: 2_197,
    couverture: {
      contrat: 0.477,
      temps: 0.665,
      programme: 0.053,
      saisonnier: 0.0,
      metier: 0.90032,
      seniorite: 0.20346,
    },
  },

  /**
   * PAYS-BAS — « Dienstverband » ; un seul mot néerlandais pour les deux axes.
   *
   * « Vakgebied » et « Ervaringsniveau » sont en revanche deux mots distincts :
   * la fusion de libellés est une particularité de la dimension contractuelle
   * néerlandaise, pas une règle du marché.
   */
  NL: {
    code: 'NL',
    locale: 'nl-NL',
    libelles: {
      contrat: 'Dienstverband',
      temps: 'Dienstverband',
      metier: 'Vakgebied',
      seniorite: 'Ervaringsniveau',
    },
    offresMesurees: 1_849,
    couverture: {
      contrat: 0.361,
      temps: 0.782,
      programme: 0.025,
      saisonnier: 0.002,
      metier: 0.91076,
      seniorite: 0.2861,
    },
  },

  /**
   * AUSTRALIE — le seul marché du registre à exposer le SAISONNIER.
   *
   * 17,0 % : sous le seuil de 20 %, donc PAS exposé — et c'est volontaire.
   * Le vocabulaire australien est pourtant le plus saisonnier du lot
   * (« seasonal » 19 %, « casual » 18 % des descriptions), et FIXED_TERM+SEASONAL
   * y est mesuré 111 fois. C'est le cas limite qui montre que le seuil tranche
   * même quand l'intuition métier dit l'inverse : 83 % de « non précisé »
   * resterait 83 % de « non précisé ».
   *
   * À rouvrir par décision si une mesure ultérieure passe la barre — pas par
   * conviction. Et pas non plus en créant une dimension `casual` : voir le bloc
   * « POURQUOI CASUAL N'EST PAS UNE DIMENSION » en tête de fichier, qui mesure
   * ce gisement à 99 offres non saisonnières, soit 8 % du marché.
   */
  AU: {
    code: 'AU',
    locale: 'en-AU',
    libelles: {
      contrat: 'Job type',
      temps: 'Job type',
      metier: 'Job category',
      seniorite: 'Experience level',
    },
    offresMesurees: 1_234,
    couverture: {
      contrat: 0.362,
      temps: 0.657,
      programme: 0.007,
      saisonnier: 0.17,
      metier: 0.94408,
      seniorite: 0.31118,
    },
  },

  /**
   * SUISSE — pas de facette de contrat (17,2 %), mais une facette PROGRAMME.
   *
   * Le seul marché du registre dont le programme dépasse le seuil (26,3 %)
   * pendant que son contrat le rate. L'apprentissage y est une institution :
   * APPRENTICESHIP arrive en 3e position des combinaisons canoniques (131), et
   * « apprentissage » (10 %) devance « stage » (9 %) dans les descriptions.
   *
   * Un registre qui aurait supposé « contrat partout, programme nulle part »
   * aurait affiché le filtre inutile et masqué le seul qui compte ici.
   *
   * Indeed expose en Suisse « Type de contrat » ET « Temps de travail » comme
   * DEUX filtres distincts. Nous conservons donc deux libellés distincts — mais
   * seul « Temps de travail » sera affiché tant que le contrat reste sous le
   * seuil. Le libellé décrit le marché ; le seuil décide de l'affichage. Les
   * deux sont séparés exprès : le jour où la couverture monte, il n'y a rien à
   * traduire.
   *
   * LE MARCHÉ LE PLUS PAUVREMENT COUVERT DU REGISTRE, sur toutes les dimensions
   * à la fois : métier 77,705 % (le seul sous 90 %, douze points sous le
   * neuvième), séniorité 18,033 % (sous le seuil, non exposée), rythme 49,1 %
   * (le seul sous 60 %). Avec 1 220 offres, c'est aussi le plus petit. Il n'a
   * donc AUCUNE facette dense au sens du seuil de 90 %, et c'est lui qui fixe
   * le plancher du témoin de densité — voir `PLANCHER_FACETTE_DENSE`.
   *
   * Les libellés suisses suivent la France, locale de service `fr-CH` oblige.
   * C'est le seul endroit du registre où deux marchés partagent leurs libellés,
   * et c'est une DÉDUCTION DE SERVICE, pas une mesure : contrairement au Canada,
   * aucun relevé Indeed distinct n'a été fait pour la Suisse romande. À
   * re-vérifier si un écart apparaît, exactement comme CA-fr a révélé le sien.
   */
  CH: {
    code: 'CH',
    locale: 'fr-CH',
    libelles: {
      contrat: 'Type de contrat',
      temps: 'Temps de travail',
      programme: 'Type de programme',
      metier: 'Métier',
      seniorite: 'Niveau d’expérience',
    },
    offresMesurees: 1_220,
    couverture: {
      contrat: 0.172,
      temps: 0.491,
      programme: 0.263,
      saisonnier: 0.008,
      metier: 0.77705,
      seniorite: 0.18033,
    },
  },
};

/** Le marché existe-t-il dans le registre ? Sert de garde avant tout accès. */
export function estCodeMarche(code: string): code is CodeMarche {
  return (CODES_MARCHE as readonly string[]).includes(code);
}

/**
 * Le marché, ou `undefined` si le code n'est pas mesuré.
 *
 * On s'abstient plutôt que de retomber sur un marché par défaut : servir les
 * facettes françaises à un candidat belge serait pire qu'un catalogue sans
 * facettes — il filtrerait sur une dimension que nous n'avons pas mesurée chez
 * lui, et croirait le résultat.
 */
export function marche(code: string): Marche | undefined {
  /*
   * GARDE DE TYPE, et pas une précaution théorique.
   *
   * L'audit défensif du 15/09/2026 a montré que `undefined`, `null`, un
   * nombre, un objet ou un tableau faisaient LEVER une exception sur
   * `code.trim()` — alors que le contrat documenté juste au-dessus promet
   * « une liste vide, jamais une exception », précisément parce que ce
   * registre sera lu sur un CHEMIN DE RENDU.
   *
   * Un pays hors périmètre doit dégrader l'écran en catalogue sans facettes.
   * Un paramètre d'URL absent ou malformé arrive `undefined` : sans cette
   * garde, il faisait tomber la page entière.
   *
   * Le témoin ne couvrait que des chaînes malformées — la branche qui
   * plantait n'était testée nulle part.
   */
  if (typeof code !== 'string') return undefined;
  const normalise = code.trim().toUpperCase();
  return estCodeMarche(normalise) ? MARCHES[normalise] : undefined;
}

/**
 * Les dimensions dont la COUVERTURE MESURÉE justifie l'affichage sur ce marché.
 *
 * Deux conditions cumulatives, et la seconde n'est pas redondante : la
 * couverture doit atteindre le seuil, ET le marché doit porter un libellé natif
 * pour la dimension. Une dimension bien remplie mais sans traduction relevée
 * serait affichée en anglais au milieu d'une page allemande — un défaut visible
 * par le candidat, causé par un trou de registre invisible en revue.
 *
 * L'ordre du rendu suit `DIMENSIONS_FACETTE` et non l'ordre de déclaration du
 * marché : la position d'un filtre dans une barre de recherche est un fait
 * d'interface, il ne doit pas dépendre de l'ordre où quelqu'un a saisi un objet.
 *
 * Un code inconnu rend une liste VIDE, jamais une exception : ce registre sera
 * lu sur un chemin de rendu, et un pays hors périmètre doit dégrader l'écran en
 * catalogue sans facettes, pas le faire tomber.
 */
export function facettesDuMarche(code: string): readonly DimensionFacette[] {
  const m = marche(code);
  if (!m) return [];
  return DIMENSIONS_FACETTE.filter(
    (dimension) => m.couverture[dimension] >= SEUIL_AFFICHAGE_FACETTE && m.libelles[dimension] !== undefined,
  );
}

/**
 * Le libellé natif d'une facette sur ce marché, ou `undefined`.
 *
 * `undefined` signifie « ce marché n'expose pas cette dimension » — jamais
 * « traduis-la toi-même » ni « prends celle de la France ».
 */
export function libelleFacette(code: string, dimension: DimensionFacette): string | undefined {
  return marche(code)?.libelles[dimension];
}
