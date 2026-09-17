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
 * saisonnalité, métier) restent mondiales et ne bougent pas. Ce qui
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
 * `metier` DEVAIT changer la nature du problème — 90,0 à 96,8 % sur dix marchés
 * sur douze. CES CHIFFRES ÉTAIENT CEUX DE `jobFunction`, une colonne que la
 * facette ne sert pas. Re-mesurée le 2026-09-15 sur `occupationCode`, la
 * colonne réellement agrégée (`job-search-query.ts:167`), la même dimension
 * couvre 25,7 % (CH) à 57,0 % (ES).
 *
 * ⚠️ LA CONSÉQUENCE EST BRUTALE ET ELLE DOIT ÊTRE DITE : AUCUN MARCHÉ N'A PLUS
 * DE FACETTE MÉTIER DENSE. Quatre marchés atteignent encore le plancher de
 * 77 % — US (81,8 %), BE (81,4 %), CA (79,5 %), NL (78,2 %) — mais tous les
 * quatre par le RYTHME, une facette à deux valeurs qui affine à la marge. La
 * facette qui porte l'intention du candidat (« je cherche un poste de
 * vendeur ») est creuse PARTOUT : 57,0 % au mieux (ES), 25,7 % au pire (CH).
 *
 * Le garde-fou « au moins une facette dense par marché » ne gardait donc pas ce
 * qu'il prétendait : il était satisfait par un chiffre mesuré sur une colonne
 * que personne ne sert. C'est le motif d'erreur dominant de ce dépôt sous une
 * forme nouvelle — non pas un commentaire resté en arrière, mais un TÉMOIN VERT
 * sur la mauvaise donnée.
 *
 * ── CE QUI EST FAIT ICI, ET CE QUI NE L'EST PAS ──────────────────────────
 *
 * Les constantes sont CONSERVÉES et le témoin de densité est converti en constat
 * mesuré : il grave l'état réel (aucun marché dense) au lieu d'affirmer un
 * invariant que les données ne portent pas. Baisser le plancher à 33 % pour
 * refaire passer le témoin aurait été l'interdit explicite du CLAUDE.md —
 * modifier une règle pour la faire correspondre après coup au code.
 *
 * ⚠️ CE QUI RESTE À ARBITRER PAR LE CEO, ET N'EST PAS TRANCHÉ ICI : que faire
 * d'un catalogue dont la facette métier laisse 43 à 74 % de « Métier à
 * préciser » selon le marché. Trois voies existent — améliorer le taux de
 * classification (`occupationStatus = PENDING`), remonter le seuil d'affichage,
 * ou servir la famille `jobFunction` (mieux remplie, 27 valeurs) à la place du
 * métier fin. Chacune change ce que le candidat voit, donc aucune n'est un
 * réglage de registre.
 */
export const SEUIL_FACETTE_DENSE = 0.9;

/**
 * Le PLANCHER de densité, en dessous duquel un marché n'est plus exploitable.
 *
 * 77 % — la valeur d'origine, CONSERVÉE À DESSEIN alors qu'aucun marché ne
 * l'atteint plus depuis la re-mesure du métier sur la bonne colonne.
 *
 * Elle était calée « juste sous la Suisse (77,705 %) », un chiffre de
 * `jobFunction`. La Suisse réelle est à 25,656 % sur la facette servie, et sa
 * meilleure facette exposée (le rythme, 49,1 %) reste sous le plancher.
 *
 * La constante reste donc la CIBLE PRODUIT — le niveau auquel une facette
 * mérite d'être appelée dense — et non plus la description d'un état atteint.
 * L'abaisser à la mesure du jour reviendrait à supprimer le garde-fou en
 * feignant de le respecter.
 */
export const PLANCHER_FACETTE_DENSE = 0.77;

/**
 * Les marchés MESURÉS, et eux seuls.
 *
 * ── LA BELGIQUE EST ENTRÉE LE 2026-09-15, PARCE QU'ELLE A ÉTÉ MESURÉE ─────
 *
 * Elle était écartée pour la seule raison qui vaille — « nous ne disposons
 * d'aucun taux » — et non par jugement sur le marché. La mesure a été faite :
 * 671 offres actives, et QUATRE dimensions passent le seuil d'affichage (cinq
 * avant le retrait de la séniorité). C'est le marché le MIEUX couvert du
 * registre en nombre de facettes, à égalité avec la France. L'écarter plus
 * longtemps fermait un marché sur une absence de données qui n'existait plus.
 *
 * Le registre n'a pas changé de règle pour l'accueillir : ses taux sont
 * recopiés de la même requête que les dix autres, ses libellés sont relevés et
 * non déduits de la France voisine — exactement le piège que CA-fr a révélé.
 *
 * ── LA CHINE EST ENTRÉE LE 2026-09-15, ET ELLE A CHANGÉ UNE RÈGLE ────────
 *
 * Elle était écartée pour la bonne raison : mesurable, mais « non ouverte »,
 * et l'ouverture d'un marché appartient au CEO — « non mesuré » se répare par
 * une requête, « non ouvert » se tranche par une décision.
 *
 * Son entrée a révélé que LE SEUIL SEUL NE SUFFIT PAS. Le rythme chinois
 * couvre 81,9 % des offres — très au-dessus des 20 % — mais 99,7 % de ses
 * valeurs renseignées sont identiques. Un filtre qui passe le seuil peut donc
 * être parfaitement inutile, et le registre le sait désormais : voir le bloc
 * de la Chine, qui porte la mesure, la contre-épreuve française et le
 * mécanisme retenu (pas de libellé, donc pas de facette).
 */
export const CODES_MARCHE = ['US', 'FR', 'GB', 'CA', 'DE', 'IT', 'ES', 'NL', 'AU', 'CH', 'BE', 'CN'] as const;
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
 * en porte 51. Le nombre de valeurs compte autant que le taux de remplissage,
 * et c'est pourquoi le registre mesure les deux.
 *
 * ── MÉTIER : LA DIMENSION, ET LA COLONNE QUI LA PORTE RÉELLEMENT ─────────
 *
 * Le registre a d'abord été écrit avec les seules dimensions du VOCABULAIRE
 * CONTRACTUEL, et cette omission a produit un contresens : on en a conclu que
 * « le marché américain ne garde qu'une facette ». `metier` a donc été ajouté
 * — mais MESURÉ SUR LA MAUVAISE COLONNE, et c'est le défaut que l'audit du
 * 2026-09-15 (chantier 2) a trouvé.
 *
 * LES TAUX GRAVÉS ÉTAIENT CEUX DE `jobFunction` (95,5 % en FR, 77,7 % en CH).
 * La facette réellement servie au candidat lit `occupationCode` — vérifié dans
 * le code, pas déduit : `job-search-query.ts:167` agrège
 * `COALESCE("occupationCode",'unclassified')` en facette `occupations`, que
 * `facettes-marche.ts:116` mappe sur la dimension `metier`. `jobFunction` n'est
 * JAMAIS agrégé en facette : il n'est qu'un critère de filtrage interne
 * (`job-search-query.ts:47`, paramètre `?fonction=`) et un libellé de famille
 * sur la fiche (`jobs.ts:616`).
 *
 * Les deux colonnes ne disent d'ailleurs pas la même chose : `jobFunction` est
 * la FAMILLE (27 valeurs, dérivée du code — `occupation-engine.ts:494`),
 * `occupationCode` est le MÉTIER lui-même (51 valeurs). Le registre décrivait
 * donc la couverture d'une colonne pendant que le produit en servait une autre,
 * moins remplie de 42 points en moyenne.
 *
 * Les taux ci-dessous sont RE-MESURÉS sur `occupationCode`, même population
 * (83 431 offres actives, 2026-09-15) : 25,7 % (CH) à 57,0 % (ES). Les douze
 * marchés restent au-dessus du seuil d'affichage, donc aucun ne perd la facette
 * — mais AUCUN n'atteint plus la densité de 90 %, ni même le plancher de 77 %.
 * Voir le bloc `SEUIL_FACETTE_DENSE`, qui porte la conséquence.
 *
 * ── `seniorite` N'EST PLUS UNE DIMENSION DE FACETTE (2026-09-15) ─────────
 *
 * Elle a été RETIRÉE de cette liste. La raison n'est pas la couverture — elle
 * passait le seuil sur sept marchés — mais la PROVENANCE de la donnée :
 *
 *  · 22 625 offres sur 22 631 tirent leur séniorité d'un REGEX SUR L'INTITULÉ
 *    (`occupationEvidence->>'seniorityConfidence' = 'TITLE_HEURISTIC'`), contre
 *    6 d'une mention littérale certifiée. Soit 99,97 % de déduit ;
 *  · confrontée à la source quand les deux existent (1 861 offres), la
 *    déduction CONTREDIT le niveau déclaré par l'employeur dans 1 489 cas,
 *    soit 80,0 %. « Team Lead (Part time) », déclaré `Entry Level` à la source,
 *    ressort MANAGER ; « Allievo/a Manager di Store » — un manager STAGIAIRE,
 *    déclaré `Associate` — ressort MANAGER lui aussi ;
 *  · le moteur le dit lui-même, dans son propre champ de preuve :
 *    « Migrated title heuristic; not a source-certified experience level »
 *    (`occupation-engine.ts:523`).
 *
 * Un filtre « Niveau d'expérience » est une PROMESSE faite au candidat : qu'en
 * cochant « Senior » il verra des postes seniors. Sur une donnée déduite à
 * 99,97 % et fausse 4 fois sur 5 face à la source, cette promesse ne peut pas
 * être tenue — et un candidat junior écarté d'une offre « Lead Cashier » classée
 * SENIOR ne saura jamais pourquoi son écran est vide.
 *
 * ⚠️ LE REGISTRE DÉCRIVAIT DÉJÀ UNE CIBLE COMME UN ÉTAT EXISTANT. `seniorite`
 * portait douze libellés natifs relevés (`经验`, `Erfahrungslevel`…) et un taux
 * par marché, alors qu'elle n'était servie NULLE PART : absente de
 * `CORRESPONDANCE_FACETTE`, de `JobsResult['facets']` et de `CleFiltre` côté
 * site. Aucun candidat n'a jamais vu ce filtre. Le retrait ne supprime donc
 * aucune fonctionnalité — il aligne le registre sur la réalité.
 *
 * CE QUI LA FERAIT REVENIR : une séniorité SOURCÉE, pas déduite. Le chantier
 * qui branche l'expérience DÉCLARÉE (`experienceYears`, alimenté par les
 * adaptateurs ATS) est en cours. Le jour où cette donnée existe et couvre un
 * marché au-dessus du seuil, la dimension peut renaître — sur du sourcé, avec
 * ses libellés qui sont conservés dans l'historique de ce fichier, et par
 * DÉCISION (le retrait comme le retour sont des arbitrages produit).
 *
 * CE QUI N'EST PAS SUPPRIMÉ : la colonne `Job.seniority` et le moteur qui la
 * remplit restent en place. La déduction garde un usage INTERNE légitime
 * (matching, agrégats Intelligence, index `[isActive, seniority]`). On retire
 * la PROMESSE faite au candidat, pas la donnée.
 *
 * ── `saisonnier` RESTE UNE DIMENSION MESURÉE, ET C'EST DÉLIBÉRÉ ──────────
 *
 * Elle n'a jamais été exposée (aucun marché ne porte de libellé natif) et elle
 * ne PEUT pas l'être : `isSeasonal` porte `true` sur 3 449 offres et `null` sur
 * les 79 982 autres — ZÉRO `false`, vérifié en base le 2026-09-15. Une colonne
 * à une seule valeur distincte ne partitionne rien : un filtre construit dessus
 * ne saurait que tout garder ou tout exclure.
 *
 * Elle reste NÉANMOINS dans cette liste, contrairement à `seniorite`, parce que
 * les deux cas sont différents et que confondre les deux coûterait cher :
 *
 *  · `seniorite` était une PROMESSE — douze libellés relevés, un taux au-dessus
 *    du seuil sur sept marchés, donc une facette qui n'attendait que son
 *    câblage. Elle est retirée ;
 *  · `saisonnier` est une MESURE dont la conclusion est « non », et elle porte
 *    l'argument qui ferme la question du `casual` australien (voir le bloc
 *    nommé en tête de fichier, qui compare 17,0 % de saisonnier AU à 8 % de
 *    résiduel casual). La retirer effacerait la mesure qui justifie le refus,
 *    et la question reviendrait à la revue suivante sans sa réponse.
 *
 * L'invariant « aucun marché ne porte de libellé saisonnier » est gardé par un
 * témoin, et c'est lui qui garantit qu'elle ne sera pas exposée par accident.
 */
export const DIMENSIONS_FACETTE = [
  'contrat',
  'temps',
  'programme',
  'saisonnier',
  'metier',
] as const;
export type DimensionFacette = (typeof DIMENSIONS_FACETTE)[number];

/** La couverture mesurée d'un marché, dimension par dimension, en proportion. */
export type CouvertureMesuree = Readonly<Record<DimensionFacette, number>>;

/**
 * ── LE CONTRAT DE RECHERCHE PARTAGÉ (lot 6) ───────────────────────────────
 *
 * Ce registre est la SEULE description des marchés lue par l'API et, à
 * travers `GET /api/marches` et les réponses de `/api/jobs`, par le site. Il
 * porte donc tout ce qu'un marché est pour le produit : son périmètre
 * géographique (le SQL borne les offres à ces pays), ses langues de service,
 * les facettes qu'il expose et leurs libellés natifs. Le site n'en garde
 * aucune copie : la version du contrat change quand sa FORME change.
 */
export const CONTRAT_RECHERCHE_VERSION = 1;

/**
 * Les clés de facette telles que l'URL du site et l'API les nomment — le
 * vocabulaire visible par le candidat, en français parce que l'URL l'est.
 * `pays` n'est une facette que sur les marchés qui couvrent plusieurs pays ou
 * où le découpage territorial sert (BE, CA) ; `langue` traverse tous les
 * marchés (D-419 §3).
 */
export const CLES_FACETTE = ['pays', 'metier', 'secteur', 'contrat', 'temps', 'programme', 'ville', 'maison', 'groupe', 'langue'] as const;
export type CleFacette = (typeof CLES_FACETTE)[number];

/** Les facettes propres au site, hors périmètre de la mesure : une ville est une ville partout. */
export const CLES_FACETTE_SITE = ['pays', 'secteur', 'ville', 'maison', 'groupe', 'langue'] as const;
export type CleFacetteSite = (typeof CLES_FACETTE_SITE)[number];

/** La dimension mesurée qui gouverne une clé de facette ; absente pour les facettes du site. */
export const DIMENSION_PAR_CLE: Readonly<Partial<Record<CleFacette, DimensionFacette>>> = {
  contrat: 'contrat',
  temps: 'temps',
  programme: 'programme',
  metier: 'metier',
};

export type Marche = {
  /** Le code ISO 3166-1 alpha-2 du marché, tel que le sélecteur le porte. */
  readonly code: CodeMarche;
  /** Le libellé du marché, dans sa langue native (`Deutschland`, `中国`). */
  readonly nom: string;
  /**
   * Le PÉRIMÈTRE GÉOGRAPHIQUE : les codes pays dont ce marché sert les offres.
   * C'est lui que le SQL impose (lot 6) ; `DE` sert l'Allemagne ET l'Autriche,
   * `GB` le Royaume-Uni ET l'Irlande. Un marché n'est pas forcément un pays.
   */
  readonly pays: readonly string[];
  /** Toutes les langues de service de ce marché, en étiquettes BCP 47. Au moins une. */
  readonly locales: readonly string[];
  /**
   * La langue de SERVICE par défaut — celle dans laquelle on parle au marché
   * sans demande explicite. Toujours dans `locales`.
   *
   * Distincte de la langue d'une annonce (`language.ts`) : un candidat français
   * qui visite l'Australie lit « Job type », même si son navigateur est en
   * français. C'est le marché qui impose sa langue, pas le visiteur.
   */
  readonly localeParDefaut: string;
  /** Les facettes propres au site exposées sur ce marché, dans l'ordre du contrat. */
  readonly facettesSite: readonly CleFacetteSite[];
  /** Les libellés natifs des facettes du site, relevés dans la langue de service. */
  readonly libellesSite: Readonly<Record<CleFacetteSite, string>>;
  /**
   * Les LIBELLÉS natifs, dans la langue du marché.
   *
   * Relevés marché par marché, et JAMAIS déduits d'une traduction : Indeed
   * pour les marchés occidentaux, qu'il sert avec autant de traductions et
   * plusieurs découpages différents. La dimension ne change jamais — seul son
   * nom change. C'est toute la raison d'être de ce registre : un libellé codé
   * en dur côté front aurait affiché « Type de contrat » à un candidat
   * néerlandais.
   *
   * ⚠️ LA SOURCE N'EST PAS LA MÊME PARTOUT, et il ne faut pas la supposer. Les
   * libellés chinois viennent de `zhaopin.com` (dont la barre de filtres rend
   * `经验` et `职位类别`), pas d'Indeed : c'est là que le marché local se lit.
   * Relever un libellé chinois sur un site occidental aurait reproduit, en
   * pire, l'erreur que le Canada a révélée — déduire le libellé de la langue
   * qu'on suppose au lieu de le relever là où le marché vit.
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
   * DEUX facettes, pas une, et pas trois. Le métier (53,9 % sur la colonne
   * réellement servie) passe le seuil et s'ajoute au rythme. Lire « les US ne
   * gardent qu'une facette » était une conclusion tirée du sous-ensemble
   * contractuel, pas du marché.
   *
   * ⚠️ 96,8 % ÉTAIT LE TAUX DE `jobFunction`, pas celui de la facette servie.
   * Re-mesuré sur `occupationCode` : 53,949 %. Le marché reste le mieux couvert
   * du registre sur cette dimension, mais « la mieux couverte de tout le
   * registre » décrivait une colonne que le candidat ne voit jamais.
   *
   * La séniorité a été RETIRÉE des dimensions de facette (déduite à 99,97 %,
   * contredit la source à 80 %) : voir le bloc `DIMENSIONS_FACETTE`.
   */
  US: {
    code: 'US',
    nom: 'United States',
    pays: ['US'],
    /**
     * `es-US` ajouté le 2026-09-17 (D-436). Relevé sur la page publique « Country and language »
     * d'Indeed le même jour : les États-Unis y sont proposés en DEUX langues — « United States
     * (English) » et « Estados Unidos (español) ». Ce n'est pas une déduction depuis la
     * démographie : c'est la locale que l'éditeur de référence expose.
     *
     * Rien à traduire : `es-US` partage le catalogue `es`, déjà livré au lot F5b. Une locale
     * régionale n'est pas un catalogue — voir le bloc `locales` du type.
     */
    locales: ['en-US', 'es-US'],
    localeParDefaut: 'en-US',
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'],
    libellesSite: { pays: 'Country', secteur: 'Sector', ville: 'City', maison: 'Maison', groupe: 'Group', langue: 'Language' },
    libelles: { temps: 'Job type', metier: 'Job category' },
    offresMesurees: 36_942,
    couverture: {
      contrat: 0.192,
      temps: 0.818,
      programme: 0.003,
      saisonnier: 0.061,
      metier: 0.53949,
    },
  },

  /**
   * FRANCE — le marché contractuellement le mieux renseigné, et l'un des deux
   * (avec la Belgique) à exposer QUATRE dimensions du registre.
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
    nom: 'France',
    pays: ['FR'],
    locales: ['fr-FR'],
    localeParDefaut: 'fr-FR',
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'],
    libellesSite: { pays: 'Pays', secteur: 'Secteur', ville: 'Ville', maison: 'Maison', groupe: 'Groupe', langue: 'Langue' },
    libelles: {
      contrat: 'Type de contrat',
      temps: 'Temps de travail',
      programme: 'Type de programme',
      metier: 'Métier',
    },
    offresMesurees: 11_026,
    couverture: {
      contrat: 0.692,
      temps: 0.643,
      programme: 0.222,
      saisonnier: 0.002,
      metier: 0.48767,
    },
  },

  /**
   * ROYAUME-UNI — contrat (38,9 %) et rythme (64,6 %) ; « Job type » comme aux US.
   *
   * Le marché britannique nomme le niveau (« junior », « senior », « head of »)
   * dans ses intitulés bien plus systématiquement que les marchés latins — ce
   * qui faisait de lui le mieux couvert en séniorité (34,9 %). C'est
   * précisément ce qu'on ne peut PAS servir : un niveau lu dans l'intitulé est
   * une déduction, et elle contredit la source déclarée 4 fois sur 5. La
   * dimension a été retirée des facettes (voir `DIMENSIONS_FACETTE`).
   */
  GB: {
    code: 'GB',
    nom: 'United Kingdom',
    /** Le Royaume-Uni ET l'Irlande : le drapeau seul mentirait, le code reste affiché à côté (D-433). */
    pays: ['GB', 'IE'],
    locales: ['en-GB'],
    localeParDefaut: 'en-GB',
    /** `pays` : le périmètre couvre deux pays, le candidat peut s'y restreindre. */
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue', 'pays'],
    libellesSite: { pays: 'Country', secteur: 'Sector', ville: 'City', maison: 'Maison', groupe: 'Group', langue: 'Language' },
    libelles: {
      contrat: 'Job type',
      temps: 'Job type',
      metier: 'Job category',
    },
    offresMesurees: 3_305,
    couverture: {
      contrat: 0.389,
      temps: 0.646,
      programme: 0.006,
      saisonnier: 0.029,
      metier: 0.4118,
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
    nom: 'Canada',
    pays: ['CA'],
    /*
     * Bilingue, et l'anglais domine le catalogue (2 308 offres en anglais, 400
     * en français, mesuré le 15/09/2026) : `en-CA` par défaut, `fr-CA` servi.
     * Les libellés relevés restent ceux d'Indeed Canada francophone (« Type de
     * poste ») : la langue ne détermine pas le libellé, le marché si.
     */
    locales: ['en-CA', 'fr-CA'],
    localeParDefaut: 'en-CA',
    /** `pays` : un marché où le candidat filtre utilement par territoire. */
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue', 'pays'],
    libellesSite: { pays: 'Pays', secteur: 'Secteur', ville: 'Ville', maison: 'Maison', groupe: 'Groupe', langue: 'Langue' },
    libelles: {
      contrat: 'Type de poste',
      temps: 'Type de poste',
      metier: 'Domaine',
    },
    offresMesurees: 3_129,
    couverture: {
      contrat: 0.349,
      temps: 0.795,
      programme: 0.012,
      saisonnier: 0.114,
      metier: 0.36529,
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
   * LA SÉNIORITÉ ALLEMANDE ÉTAIT À 19,838 %, sous le seuil de seize millièmes —
   * le cas qui mesurait la valeur d'un seuil, puisque la tentation d'arrondir
   * « puisque c'est pareil » y est maximale.
   *
   * Cet argument est CADUC depuis le retrait de la dimension : ce n'est plus le
   * taux qui l'écarte, c'est la provenance de la donnée (déduite par regex sur
   * l'intitulé, contredisant la source dans 80 % des cas confrontables). Le
   * seuil aurait laissé passer sept marchés sur douze — il ne protégeait pas
   * contre ce défaut-là, et aucun seuil ne le pouvait.
   */
  DE: {
    code: 'DE',
    nom: 'Deutschland',
    /** L'Allemagne ET l'Autriche (D-433) ; le code ISO reste affiché à côté du drapeau. */
    pays: ['DE', 'AT'],
    locales: ['de-DE'],
    localeParDefaut: 'de-DE',
    /** `pays` : le périmètre couvre deux pays, le candidat peut s'y restreindre. */
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue', 'pays'],
    libellesSite: { pays: 'Land', secteur: 'Branche', ville: 'Stadt', maison: 'Haus', groupe: 'Gruppe', langue: 'Sprache' },
    libelles: {
      contrat: 'Anstellungsart',
      temps: 'Arbeitszeit',
      metier: 'Berufsfeld',
    },
    offresMesurees: 3_080,
    couverture: {
      contrat: 0.325,
      temps: 0.749,
      programme: 0.08,
      saisonnier: 0.048,
      metier: 0.49513,
    },
  },

  /**
   * ITALIE — « Tipo di contratto » ; programme à 16,2 %, sous le seuil.
   *
   * La séniorité y était à 18,975 %, sous le seuil — elle n'est plus une
   * dimension de facette du tout, sur aucun marché (voir `DIMENSIONS_FACETTE`).
   */
  IT: {
    code: 'IT',
    nom: 'Italia',
    pays: ['IT'],
    locales: ['it-IT'],
    localeParDefaut: 'it-IT',
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'],
    libellesSite: { pays: 'Paese', secteur: 'Settore', ville: 'Città', maison: 'Maison', groupe: 'Gruppo', langue: 'Lingua' },
    libelles: {
      contrat: 'Tipo di contratto',
      temps: 'Orario di lavoro',
      metier: 'Categoria',
    },
    offresMesurees: 2_693,
    couverture: {
      contrat: 0.453,
      temps: 0.68,
      programme: 0.162,
      saisonnier: 0.004,
      metier: 0.52395,
    },
  },

  /** ESPAGNE — « Tipo de empleo » ; « contrato indefinido » 9 % des descriptions. */
  ES: {
    code: 'ES',
    nom: 'España',
    pays: ['ES'],
    locales: ['es-ES'],
    localeParDefaut: 'es-ES',
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'],
    libellesSite: { pays: 'País', secteur: 'Sector', ville: 'Ciudad', maison: 'Maison', groupe: 'Grupo', langue: 'Idioma' },
    libelles: {
      contrat: 'Tipo de empleo',
      temps: 'Jornada laboral',
      metier: 'Categoría',
    },
    offresMesurees: 2_197,
    couverture: {
      contrat: 0.477,
      temps: 0.665,
      programme: 0.053,
      saisonnier: 0.0,
      metier: 0.56987,
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
    nom: 'Nederland',
    pays: ['NL'],
    /**
     * UNE SEULE LOCALE — `en-GB` retiré le 2026-09-17 (D-436), et le motif du retrait vaut
     * au-delà de ce marché.
     *
     * L'ancien commentaire justifiait `en-GB` ainsi : « 1 033 offres en néerlandais, 561 en
     * anglais ». C'est un raisonnement faux, et le CEO l'a tranché : **la langue des OFFRES d'un
     * marché ne dit rien de la langue d'INTERFACE que ce marché doit servir**. Les annonces
     * restent dans leur langue native quelle que soit la locale ; un Néerlandais lisant son
     * interface en néerlandais voit ses 561 offres anglaises, en anglais. Les deux notions sont
     * indépendantes, et les confondre conduit à ouvrir des locales que rien ne demande.
     *
     * Relevé sur la page publique « Country and language » d'Indeed le 17/09 : les Pays-Bas n'y
     * sont proposés qu'en néerlandais — « Nederland (Nederlands) ».
     *
     * Si l'anglais devait être servi ici un jour, la forme serait `en-NL`, jamais `en-GB` : une
     * locale d'interface est localisée à son pays (cf. `en-BE` et `en-CH` chez Indeed).
     */
    locales: ['nl-NL'],
    localeParDefaut: 'nl-NL',
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'],
    libellesSite: { pays: 'Land', secteur: 'Sector', ville: 'Stad', maison: 'Maison', groupe: 'Groep', langue: 'Taal' },
    libelles: {
      contrat: 'Dienstverband',
      temps: 'Dienstverband',
      metier: 'Vakgebied',
    },
    offresMesurees: 1_849,
    couverture: {
      contrat: 0.361,
      temps: 0.782,
      programme: 0.025,
      saisonnier: 0.002,
      metier: 0.38724,
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
    nom: 'Australia',
    pays: ['AU'],
    locales: ['en-AU'],
    localeParDefaut: 'en-AU',
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'],
    libellesSite: { pays: 'Country', secteur: 'Sector', ville: 'City', maison: 'Maison', groupe: 'Group', langue: 'Language' },
    libelles: {
      contrat: 'Job type',
      temps: 'Job type',
      metier: 'Job category',
    },
    offresMesurees: 1_234,
    couverture: {
      contrat: 0.362,
      temps: 0.657,
      programme: 0.007,
      saisonnier: 0.17,
      metier: 0.37358,
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
   * à la fois : métier 25,656 % (le PLUS BAS du registre), rythme 49,1 % (le
   * seul sous 60 %). Avec 1 220 offres, c'est aussi le plus petit.
   *
   * ⚠️ 77,705 % ÉTAIT SON TAUX DE `jobFunction`, la colonne que la facette ne
   * sert pas. Sur `occupationCode`, la Suisse tombe à 25,656 % — à cinq points
   * du seuil d'affichage, et non plus à onze points de la cible de densité.
   * Elle garde la facette métier, mais de justesse : c'est le marché qu'une
   * dégradation de la classification fermerait en premier.
   *
   * Elle ne fixe plus « le plancher » de quoi que ce soit : depuis la
   * re-mesure, AUCUN marché n'a de facette métier dense, et la meilleure
   * facette suisse (rythme, 49,1 %) reste elle-même sous les 77 % — comme celle
   * de sept autres marchés. Seuls US, BE, CA et NL franchissent encore le
   * plancher, et par le rythme. Voir `PLANCHER_FACETTE_DENSE`.
   *
   * Les libellés suisses suivent la France, locale de service `fr-CH` oblige.
   * C'est le seul endroit du registre où deux marchés partagent leurs libellés,
   * et c'est une DÉDUCTION DE SERVICE, pas une mesure : contrairement au Canada,
   * aucun relevé Indeed distinct n'a été fait pour la Suisse romande. À
   * re-vérifier si un écart apparaît, exactement comme CA-fr a révélé le sien.
   */
  CH: {
    code: 'CH',
    nom: 'Suisse · Schweiz',
    pays: ['CH'],
    locales: ['fr-CH', 'de-CH', 'it-CH'],
    localeParDefaut: 'fr-CH',
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'],
    libellesSite: { pays: 'Pays', secteur: 'Secteur', ville: 'Ville', maison: 'Maison', groupe: 'Groupe', langue: 'Langue' },
    libelles: {
      contrat: 'Type de contrat',
      temps: 'Temps de travail',
      programme: 'Type de programme',
      metier: 'Métier',
    },
    offresMesurees: 1_220,
    couverture: {
      contrat: 0.172,
      temps: 0.491,
      programme: 0.263,
      saisonnier: 0.008,
      metier: 0.25656,
    },
  },

  /**
   * BELGIQUE — QUATRE FACETTES EXPOSÉES, à égalité avec la France et avec elle
   * seule. Mesuré le 2026-09-15 sur 671 offres actives.
   *
   * Contrat 43,1 % · temps 81,4 % · programme 22,4 % · métier 45,9 %. Les
   * quatre dimensions exposables passent le seuil ; le saisonnier le rate
   * (2,7 %), comme en France (0,2 %).
   *
   * ⚠️ CE BLOC A DIT « CINQ FACETTES » ET « métier 90,5 % ». Les deux étaient
   * faux pour la même raison : le métier était mesuré sur `jobFunction` (90,462 %)
   * quand la facette sert `occupationCode` (45,902 %), et la cinquième facette
   * était la séniorité, retirée depuis (déduite à 99,97 %). Le taux reste
   * largement au-dessus du seuil : la Belgique garde bien sa facette métier.
   *
   * Vérifié dans le code plutôt qu'affirmé : `facettesDuMarche` rend quatre
   * entrées pour FR et BE, trois pour GB/CA/DE/IT/ES/NL/AU/CH, deux pour US et
   * une pour CN. Une première rédaction de ce bloc disait « le SEUL marché à
   * cinq facettes » — c'était faux, la France en expose autant, et seul le
   * comptage réel l'a montré.
   *
   * Ce qui EST singulier tient au PROGRAMME : à 22,4 %, la Belgique rejoint la
   * France (22,2 %) et la Suisse (26,3 %) dans le très petit groupe des marchés
   * où stage et alternance sont assez publiés pour qu'un filtre tienne. C'est
   * ce qui la sépare de GB, CA, NL et AU, qui s'arrêtent à quatre.
   *
   * Le plus petit marché du registre par le volume (671 offres, moins que la
   * Suisse) et pourtant parmi les mieux couverts. Volume et densité sont deux
   * choses distinctes : c'est précisément pourquoi le registre mesure les deux
   * et n'infère jamais l'une de l'autre.
   *
   * ── LES LIBELLÉS SONT BILINGUES, ET CE N'EST PAS UN ORNEMENT ─────────────
   *
   * Mesuré : 163 offres néerlandophones contre 144 francophones (et 224 en
   * anglais). Le NÉERLANDAIS DEVANCE LE FRANÇAIS. Servir la Belgique avec les
   * seuls libellés français aurait reproduit, sur le marché où c'est le plus
   * faux, l'erreur que le Canada a révélée — déduire le libellé de la langue
   * qu'on suppose, au lieu de le relever.
   *
   * La forme retenue suit celle de la Suisse pour les mêmes raisons (locale de
   * service unique, marché réellement plurilingue), avec une différence
   * assumée : la Suisse porte les libellés d'UNE langue, la Belgique porte les
   * DEUX, séparées par « · ». Indeed sert bel et bien deux sites belges
   * distincts (be.indeed.com en fr et en nl), et aucune des deux langues n'est
   * assez majoritaire pour écraser l'autre — 163 contre 144, l'écart tient en
   * dix-neuf offres.
   *
   * `locale` reste `fr-BE` : c'est la locale de SERVICE (dans quelle langue on
   * parle au visiteur par défaut), pas un verdict sur la langue des annonces.
   * Le registre côté site porte les trois locales réellement servies.
   *
   * ── LE SAISONNIER RESTE DEHORS ──────────────────────────────────────────
   *
   * 2,7 % : très loin du seuil, et aucun libellé natif relevé. La règle
   * s'applique sans exception, y compris sur le marché le mieux couvert.
   */
  BE: {
    code: 'BE',
    nom: 'Belgique · België',
    pays: ['BE'],
    /**
     * QUATRE LOCALES, corrigées le 2026-09-17 (D-436).
     *
     * `de-BE` ajouté : l'allemand est la troisième langue officielle belge, et Indeed le déclare
     * (`de_BE`, documentation éditeur des locales supportées, relevée le 17/09).
     *
     * `en-GB` REMPLACÉ par `en-BE`, et c'est une correction de fond, pas de forme. Servir
     * l'anglais BRITANNIQUE à un candidat belge était une approximation : Indeed déclare `en_BE`,
     * comme il déclare `en_CH` pour la Suisse — l'anglais proposé en langue supplémentaire est
     * toujours localisé au pays, jamais emprunté au marché britannique.
     *
     * Le marché reste BE dans les quatre cas : une locale n'est pas un marché. `en-BE` ne
     * transforme pas la Belgique en Royaume-Uni, pas plus que `fr-CH` ne fait de la Suisse la
     * France.
     *
     * Aucun catalogue à produire : `fr-BE` → `fr`, `nl-BE` → `nl`, `de-BE` → `de`, `en-BE` → `en`,
     * tous livrés au lot F5b.
     */
    locales: ['fr-BE', 'nl-BE', 'de-BE', 'en-BE'],
    localeParDefaut: 'fr-BE',
    /** `pays` : un marché où le candidat filtre utilement par territoire. */
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue', 'pays'],
    libellesSite: {
      pays: 'Pays · Land',
      secteur: 'Secteur · Sector',
      ville: 'Ville · Stad',
      maison: 'Maison · Huis',
      groupe: 'Groupe · Groep',
      langue: 'Langue · Taal',
    },
    libelles: {
      contrat: 'Type de contrat · Contracttype',
      temps: 'Temps de travail · Dienstverband',
      programme: 'Type de programme · Type programma',
      metier: 'Métier · Vakgebied',
    },
    offresMesurees: 671,
    couverture: {
      contrat: 0.4307,
      temps: 0.81371,
      programme: 0.22355,
      saisonnier: 0.02683,
      metier: 0.45902,
    },
  },

  /**
   * ══════════════════════════════════════════════════════════════════════════
   *  CHINE — le marché qui prouve que LE SEUIL NE SUFFIT PAS.
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Mesurée le 2026-09-15 : 1 224 offres actives. Elle était écartée non par
   * manque de mesure — le registre le disait lui-même — mais parce que
   * l'ouverture d'un marché appartient au CEO.
   *
   * ── LE FAIT CENTRAL : `contrat` ET `temps` N'EN FONT QU'UNE ICI ──────────
   *
   * C'est la découverte de ce lot, et elle est établie par DEUX méthodes
   * indépendantes qui ne pouvaient pas se contaminer :
   *
   *  1. LE RELEVÉ DES LIBELLÉS. Les sites d'emploi chinois (zhaopin.com, dont
   *     la barre de filtres rend exactement « 地区 · 薪资 · 学历 · 经验 ·
   *     公司性质 · 融资阶段 · 公司人数 · 工作性质 · 职位类别 · 公司行业 », et
   *     Indeed CN) n'exposent AUCUNE facette « type de contrat ». Ils servent
   *     UNE facette, `工作性质`, dont les valeurs mélangent ce que le français
   *     sépare : 全职 / 兼职 (le rythme) y voisine avec 合同工 / 临时工 /
   *     外包 (la durée). Le droit chinois connaît pourtant le contrat à durée
   *     déterminée (固定期限劳动合同) — c'est une formalité de signature, pas
   *     un critère de recherche. Aucun site d'emploi relevé n'en fait un filtre ;
   *
   *  2. LA MESURE DE NOTRE CATALOGUE. Le croisement des deux colonnes est
   *     DÉGÉNÉRÉ : sur les 498 offres chinoises où les deux sont renseignées,
   *     99,6 % tombent dans UNE SEULE case (PERMANENT × FULL_TIME). La
   *     contre-épreuve française, sur 5 032 offres, rend 54,4 % — un croisement
   *     réellement croisé. `temps` seul le dit aussi : 1 000 FULL_TIME contre
   *     3 PART_TIME, soit 99,7 % d'une seule valeur, quand les onze marchés
   *     ouverts s'étagent entre 52 % et 77 %. La Chine est hors de cette plage
   *     de vingt-trois points.
   *
   * Le relevé dit POURQUOI, la mesure dit COMBIEN. Aucune des deux seule
   * n'aurait suffi : un relevé de sites est un témoignage sur le marché, pas
   * une preuve sur notre catalogue, et une concentration mesurée aurait pu
   * n'être qu'un défaut de notre normalisation.
   *
   * ── CE QUE LE SEUIL SEUL AURAIT FAIT, ET POURQUOI C'ÉTAIT FAUX ───────────
   *
   * `temps` couvre 81,944 % — très au-dessus des 20 %. Le seuil, appliqué
   * mécaniquement, aurait donc EXPOSÉ un filtre dont 99,7 % des valeurs sont
   * identiques : le candidat coche « 全职 », le catalogue ne bouge pas, et il
   * conclut que le filtre est cassé. Un filtre qui ne filtre rien est pire
   * qu'un filtre absent — il consomme l'attention et détruit la confiance.
   *
   * Le registre savait déjà que le taux ne suffit pas : c'est l'argument qui
   * écarte `engagementType` (« le nombre de valeurs compte autant que le taux
   * de remplissage »). La Chine est le premier marché où cette règle mord sur
   * une dimension qui passe pourtant le seuil.
   *
   * ── LE MÉCANISME UTILISÉ : PAS DE LIBELLÉ, DONC PAS DE FACETTE ───────────
   *
   * `contrat` et `temps` n'ont volontairement PAS de libellé ici, et c'est le
   * registre lui-même qui en tire la conséquence : `facettesDuMarche` exige
   * DEUX conditions cumulatives — le seuil ET un libellé natif. La règle
   * existait déjà, écrite pour éviter d'afficher un libellé anglais au milieu
   * d'une page allemande ; elle exprime exactement ce qu'il faut ici.
   *
   * Aucune exception n'est donc ajoutée au moteur pour la Chine. Une clé
   * absente est un choix documenté, jamais un oubli — et graver `工作性质`
   * sans savoir la remplir aurait été pire : on aurait affiché un filtre chinois
   * authentique branché sur une donnée qui ne le porte pas.
   *
   * ⚠️ CE QUI RESTE OUVERT ET APPARTIENT AU CEO : fusionner `contrat` et
   * `temps` en une dimension `工作性质` conforme à l'usage chinois demanderait
   * un modèle canonique nouveau, sur tous les marchés. C'est une décision
   * produit, pas un réglage de registre — elle n'est pas prise ici.
   *
   * ── CE QUI EST GRAVÉ ICI : LE MÉTIER, ET LUI SEUL ───────────────────────
   *
   * `metier` — 33,088 %, et c'est l'UNIQUE facette du marché chinois. Elle est
   * réellement servie : `CORRESPONDANCE_FACETTE` la mappe vers `occupations`,
   * que `job-search-query.ts:167` agrège depuis `occupationCode`.
   *
   * ⚠️ 88,807 % ÉTAIT LE TAUX DE `jobFunction`, pas celui de la facette servie.
   * Ce bloc affirmait que la Chine « porte le besoin réel du candidat au
   * premier clic » sur la foi de ce chiffre. La mesure sur la bonne colonne dit
   * 33,088 % : les deux tiers du catalogue chinois ressortent « Métier à
   * préciser ». C'est au-dessus du seuil d'affichage, donc la facette reste —
   * mais c'est le marché le plus fragile du registre, avec la Suisse.
   *
   * ── `seniorite` A ÉTÉ RETIRÉE DU REGISTRE (2026-09-15) ───────────────────
   *
   * Ce bloc portait déjà le diagnostic — « elle N'EST SERVIE NULLE PART, ET
   * SUR AUCUN MARCHÉ », « le trou est ANTÉRIEUR à la Chine » — et concluait
   * qu'il fallait CÂBLER la dimension, par arbitrage CEO.
   *
   * La mesure de la donnée elle-même a renversé la conclusion : 99,97 % des
   * séniorités sont déduites par regex sur l'intitulé, et elles contredisent le
   * niveau déclaré par l'employeur dans 80 % des cas confrontables. Il ne
   * fallait donc pas câbler la promesse, il fallait la retirer du registre en
   * attendant une donnée sourcée. Le libellé `经验` relevé sur zhaopin reste
   * dans l'historique de ce fichier, prêt pour le jour où elle renaîtra.
   *
   * `programme` (17,075 %) et `saisonnier` (0 %) restent dehors : le seuil
   * s'applique sans exception.
   *
   * ── LA DENSITÉ : 33,088 %, SOUS LA CIBLE ET SOUS LE PLANCHER ────────────
   *
   * La Chine n'a AUCUNE facette dense, et elle n'est plus seule : depuis la
   * re-mesure du métier sur la bonne colonne, aucun marché du registre n'atteint
   * le plancher de 77 %. Elle reste le cas extrême — son unique facette est
   * aussi la plus creuse de toutes celles qui sont servies.
   *
   * ── LE CONTENU DES ANNONCES RESTE EN CHINOIS ─────────────────────────────
   *
   * Seuls les LIBELLÉS D'INTERFACE ci-dessous sont traduits. Les titres, les
   * descriptions et les noms d'entreprise ne le sont JAMAIS : 592 annonces
   * chinoises sont en `zh`, 398 en `en`, 223 sans langue déclarée, et elles
   * doivent sortir telles qu'elles sont entrées.
   *
   * ── LA COLLISION `CN`, VÉRIFIÉE PLUTÔT QUE SUPPOSÉE ─────────────────────
   *
   * `CA` (Canada/Californie) et `IN` (Inde/Indiana) imposent la garde D-435.
   * `CN` n'est PAS un code d'État américain, et ce n'est pas une lecture mais
   * une exécution : « Shanghai, CN », « Shanghai, SH, CN » et « Shenzhen, GD,
   * CN » rendent tous `CN`, pendant que « Louisville, KY » et « Indianapolis,
   * IN » s'abstiennent toujours. La sonde en base rend 0 offre chinoise portant
   * une ville non chinoise, avec une contre-épreuve à 8 912 sur les mêmes
   * villes sous leurs pays réels — la sonde sait donc trouver ce qu'elle
   * cherche. Le stock est propre : Shanghai (493), Pékin (64), Guangzhou (60).
   */
  CN: {
    code: 'CN',
    nom: '中国',
    pays: ['CN'],
    locales: ['zh-CN'],
    localeParDefaut: 'zh-CN',
    /** `langue` compte plus ici qu'ailleurs : un tiers du catalogue chinois est anglophone. */
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'],
    libellesSite: { pays: '国家', secteur: '行业', ville: '城市', maison: '品牌', groupe: '集团', langue: '语言' },
    /*
     * `contrat` et `temps` sont ABSENTS À DESSEIN — voir le bloc ci-dessus.
     * Leur absence est ce qui les retire des facettes, par la règle générale
     * du registre et sans exception dans le moteur.
     */
    libelles: {
      metier: '职位类别',
    },
    offresMesurees: 1_224,
    couverture: {
      contrat: 0.47141,
      temps: 0.81944,
      programme: 0.17075,
      saisonnier: 0,
      metier: 0.33088,
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

/**
 * LE PÉRIMÈTRE D'UNE RECHERCHE — un ensemble de pays, jamais « le monde ».
 *
 * Un marché mesuré porte son périmètre et ses facettes natives. Tout autre code
 * ISO 3166-1 connu (JP, PT, IN… 8 905 offres publiables hors des douze marchés
 * mesurées le 16/09/2026) reste un périmètre d'un seul pays, sans facettes
 * natives : le stock hors marchés n'est ni invisible ni fondu dans le monde.
 * Un code absent, mal formé ou inconnu ne rend rien — c'est à l'appelant de
 * refuser, jamais de dégrader en recherche mondiale.
 */
export type Perimetre = {
  readonly code: string;
  readonly pays: readonly string[];
  /** Le marché mesuré, ou `undefined` pour un pays servi sans registre. */
  readonly marche: Marche | undefined;
};

export function perimetreDeRecherche(code: string | undefined, paysConnus: ReadonlySet<string>): Perimetre | undefined {
  if (typeof code !== 'string') return undefined;
  const normalise = code.trim().toUpperCase();
  const mesure = marche(normalise);
  if (mesure) return { code: mesure.code, pays: mesure.pays, marche: mesure };
  if (!/^[A-Z]{2}$/.test(normalise) || !paysConnus.has(normalise)) return undefined;
  return { code: normalise, pays: [normalise], marche: undefined };
}

/**
 * Les libellés servis hors marché mesuré : le français source, la langue de ce
 * dépôt. Un pays sans registre lit ses facettes en français tant que son marché
 * n'est pas ouvert ; l'ouvrir relève d'une décision, pas d'une traduction.
 */
export const LIBELLES_GENERIQUES: Readonly<Record<CleFacette, string>> = {
  pays: 'Pays',
  metier: 'Métier',
  secteur: 'Secteur',
  contrat: 'Type de contrat',
  temps: 'Temps de travail',
  programme: 'Type de programme',
  ville: 'Ville',
  maison: 'Maison',
  groupe: 'Groupe',
  langue: 'Langue',
};

/** Une facette du contrat : sa clé d'URL et son libellé, dans l'ordre d'affichage. */
export type FacetteContrat = { readonly cle: CleFacette; readonly libelle: string };

/**
 * Les facettes servies pour un périmètre, dans l'ordre du contrat.
 *
 * Sur un marché mesuré : les dimensions dont la couverture et le libellé le
 * justifient (`facettesDuMarche`), plus les facettes propres au site. Hors
 * marché mesuré : les facettes du site seulement, `pays` compris quand le
 * périmètre s'y prête, sans dimension contractuelle — rien n'est mesuré, rien
 * n'est proposé.
 */
export function facettesContrat(perimetre: Perimetre): readonly FacetteContrat[] {
  const m = perimetre.marche;
  const dimensions = m ? new Set(facettesDuMarche(m.code)) : new Set<DimensionFacette>();
  const site = new Set<CleFacetteSite>(m ? m.facettesSite : ['secteur', 'ville', 'maison', 'groupe', 'langue']);
  return CLES_FACETTE.flatMap((cle) => {
    const dimension = DIMENSION_PAR_CLE[cle];
    if (dimension) {
      if (!m || !dimensions.has(dimension)) return [];
      return [{ cle, libelle: m.libelles[dimension] ?? LIBELLES_GENERIQUES[cle] }];
    }
    const siteCle = cle as CleFacetteSite;
    if (!site.has(siteCle)) return [];
    return [{ cle, libelle: m ? m.libellesSite[siteCle] : LIBELLES_GENERIQUES[cle] }];
  });
}
