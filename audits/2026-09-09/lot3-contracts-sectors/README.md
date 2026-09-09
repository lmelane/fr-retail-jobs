# Lot 3 — audit et remédiation (livraison en cours)

## État avant

Instant de mesure : 2026-09-09 10:54 UTC. 77 352 lignes Job, 74 124 actives, 10 947 actives France. 1 567 identités non fusionnées. Les données de production et leurs preuves n'ont pas été corrigées pendant cette mesure.

Durée : 16 294 PERMANENT, 7 656 FIXED_TERM, 139 TEMPORARY, 50 035 absentes. Rythme : 25 269 FULL_TIME, 26 566 PART_TIME, 22 289 absents. Programme : 3 398 stages, 691 alternances, 184 programmes jeunes diplômés, 16 VIE. Statut : 110 freelance, 100 indépendants.

Secteurs historiques, volumes d'offres : Retail 36 068 ; Beauté 16 635 ; Mode 13 071 ; Joaillerie/horlogerie combinées 5 841 ; Luxe 1 685 ; cabinets 531 ; fournisseurs 240 ; médias 44 ; autres 9. Ces chiffres décrivent le classement stocké, pas une validation métier.

## Causes racines

- Le filtre Contrat ne recevait aucun dictionnaire de localisation. Les fiches Maison utilisaient encore CDI/CDD comme clés, les cartes comparaient le rythme aux anciens codes TEMPS_PLEIN/TEMPS_PARTIEL.
- La base possédait déjà des dimensions d'emploi indépendantes ; les réunir aurait détruit de l'information. Des champs de source manquaient à la lecture commune : notamment contractFilter (640 durées LVMH absentes malgré une valeur déclarée).
- La réduction de confiance initialisée à TRUSTED pouvait qualifier à tort une preuve non évaluée de fiable. En cas de contradiction explicite et sans verdict suffisant, la résolution s'abstient désormais ; les verdicts effectivement évalués conservent leur priorité.
- Company.sector était un enum scalaire. Joaillerie et horlogerie étaient indissociables. Le catalogue pouvait inventer Retail pour un employeur dont il ne connaissait pas le secteur.
- Plusieurs surfaces possédaient des dictionnaires divergents. Les statistiques supposaient que les secteurs formaient une partition.

## Modifications

Référentiel sectoriel en BDD, 15 verticales, appartenances multiples documentées, revue atomique avec empreinte de l'état avant, historique immuable, index GIN, protection lors des fusions. Ajouter une appartenance, une verticale ou sa traduction passe par des données revues, sans changement du front ni déploiement.

Les compteurs/filtres des offres, annuaire, fiches et intelligence lisent ces appartenances. Les secteurs se recouvrent ; leurs comptes ne doivent pas s'additionner. Les périodes historiques antérieures au changement de définition restent conservées et ne servent pas de comparaison de croissance.

Contrats, rythmes, programmes et statuts ont des libellés français communs et des filtres distincts. Les clés internes restent indépendantes de la langue. Les chemins de lecture d'emploi sont partagés entre observatoire, ingestion et replay. Les entrées normalisées par l'adapter et les décisions sont dorénavant capturées ; les entrées historiques non capturées ne sont pas inventées.

## Preuves documentaires

[Hermès : métiers de la Maison](https://www.hermes.com/fr/fr/content/333134-la-liberte-de-creation/) documente vêtements, cuir, chaussures, bijoux, montres, parfum, beauté et maison. [Cartier : présentation](https://www.cartier.com/fr-fr/maison) documente notamment joaillerie, horlogerie, parfum et maroquinerie. [Rolex](https://www.rolex.com/fr) documente l'horlogerie. [Kering](https://www.kering.com/fr/maisons/) et [Richemont](https://www.richemont.com/news-media/press-releases-news/richemont-maintained-strong-momentum-with-sales-up-11-at-constant-rates-for-its-third-quarter-ended-31-december-2025/) distinguent les activités de leurs Maisons.

Le manifeste joint attribue des secteurs à 218 identités, représentant 21 008 offres actives : 13 identités ont une vérification officielle nouvelle ; les autres s'appuient sur le référentiel historique documenté, explicitement qualifié MEDIUM/REFERENCE_LIST. Ce ne sont pas 218 vérifications officielles nouvelles ni un inventaire exhaustif de toutes leurs activités. Aucune entreprise simplement ressemblante n'est fusionnée.

## Validation locale sur copie réelle

Sauvegarde complète restaurée : 380 386 100 octets, SHA-256 `20457d22faa09ac92445d5fd26cd5e60dc536655aabca03444fec0f795e2d41f`.

1 195 offres corrigées sur des champs d'emploi, dont 1 166 actives. 128 offres comportent au moins un conflit explicite mis en attente. Le second passage écrit zéro ligne. Les images avant/après et les événements CORRECTED sont conservés ; aucune date ou identité d'offre n'est inventée. Le replay applique seulement les différences causées par la correction, pas une réinterprétation globale de champs historiques dont certaines entrées d'adapter n'ont pas été conservées.

Les 77 352 IDs, les 74 124 offres actives et les 10 947 offres France sont conservés. Empreinte des champs hors périmètre identique : `abc30980f9104c6db91938f35e475bd3`. Géographie, occupations, identités, dates et raw sont inchangés. Invariants géographie/cycle de vie verts. Le rapport de preuve finale distinguera explicitement code, main, déploiement et données réparées.

## Restant à faire / qualification

53 116 offres actives n'ont pas encore d'appartenance sectorielle documentée par ce manifeste ; elles restent consultables, avec un filtre « Secteur à vérifier ». Ce chiffre ne signifie ni hors secteur, ni absence de site officiel. Le classement historique est conservé pour guider l'investigation. Les 15 verticales existent, mais certaines ont zéro appartenance validée à ce stade.

Un replay intégral à partir du seul raw historique révèle aussi des écarts dus aux entrées d'adapter non capturées ou aux chemins encore non étudiés. Ils ne doivent pas être transformés en suppressions massives de champs. La capture corrige la traçabilité des nouvelles ingestions ; la preuve d'exhaustivité historique demande de reconstituer/revoir ces entrées source. Aucun « 100 % canonisé » n'est revendiqué.

**Le lot n'est pas déclaré clos sur la seule réussite du déploiement.** La clôture data et le GO du lot suivant demandent la qualification du reliquat sectoriel et des écarts historiques ; ne pas les confondre avec la livraison du socle technique.
