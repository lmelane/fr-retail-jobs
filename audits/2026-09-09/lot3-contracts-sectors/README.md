# Lot 3 — contrats et secteurs : livraison en production, clôture data ouverte

Le socle est livré en production. Les contrats sont localisés en français, les dimensions d'emploi restent distinctes et les secteurs sont désormais un référentiel de données à appartenances multiples. La qualification du corpus n'est pas exhaustive : **47 016 / 74 124 offres actives (63,43 %) ont au moins un secteur documenté**. Les 27 108 autres restent visibles et sont dans une file de revue explicite.

**Périmètre front de cette livraison : `modecareers.com`, application web de ce dépôt et du service Railway contrôlé.** La page [Catwalks / Maisons](https://catwalks.io/maisons) est une autre surface : elle affiche 61 Maisons et 14 offres lors de la vérification. Ses chiffres ne sont pas présentés comme ceux de la base agrégateur, et ce rapport ne revendique pas son alignement avec les 74 124 offres.

## ÉTAT AVANT

Mesure du 9 septembre 2026 à 10:54 UTC, avant réparation : **77 352 offres stockées, 74 124 actives, 10 947 actives France**, 1 567 identités non fusionnées.

Le classement historique était scalaire : Retail 36 068 offres, Beauté 16 635, Mode 13 071, Joaillerie/Horlogerie combinées 5 841, Luxe 1 685, cabinets 531, fournisseurs 240, médias 44, autres 9. Il ne constituait pas une validation métier.

## CAUSE RACINE

- Le filtre Contrat ne recevait pas de dictionnaire de localisation. Certaines fiches utilisaient encore CDI/CDD comme clés et les cartes comparaient le rythme aux anciens codes TEMPS_PLEIN/TEMPS_PARTIEL.
- Les dimensions d'emploi existaient déjà séparément en base. Les regrouper aurait perdu de l'information. En revanche, certains champs déclarés par les ATS n'étaient pas lus par le résolveur commun : notamment `contractFilter`, avec 640 durées LVMH absentes malgré une valeur structurée.
- La réduction de confiance initialisée à TRUSTED pouvait qualifier à tort une preuve non évaluée de fiable. Une contradiction explicite entre titre et champ structuré non évalué n'était pas suffisamment distinguée d'une donnée attestée.
- `Company.sector` était un enum scalaire : impossible de distinguer Joaillerie et Horlogerie, ou de représenter les activités multiples d'une Maison. Le catalogue pouvait attribuer Retail par défaut.
- Les surfaces possédaient plusieurs dictionnaires et certaines agrégations supposaient que les secteurs formaient une partition.

## MODIFICATIONS

**Contrats.** Un dictionnaire commun sépare clés internes et présentation française : PERMANENT → CDI, FIXED_TERM → CDD, TEMPORARY → Intérim / Temporaire ; FULL_TIME → Temps plein, PART_TIME → Temps partiel ; INTERNSHIP → Stage, APPRENTICESHIP → Alternance ; FREELANCE → Freelance. Les filtres durée, rythme, programme et statut restent indépendants. Un CDI peut aussi être à temps partiel.

Les chemins de lecture des champs d'emploi sont définis comme données et partagés entre ingestion, observatoire et replay. Les nouvelles ingestions conservent `rawContract`, `rawWorkingTime`, les entrées du résolveur et ses décisions. Une contradiction explicite sans confiance suffisante déclenche une abstention traçable. Les verdicts effectivement évalués conservent leur priorité. L'offre reste active et consultable.

**Secteurs.** Quinze concepts existent en BDD, avec codes stables, définitions et traductions : Mode, Maroquinerie, Chaussures, Joaillerie, Horlogerie, Beauté, Parfumerie, Lunetterie, Maison & Lifestyle, Vins & Spiritueux, Hospitality, Automobile & Mobilité de luxe, Art & Design, Retail, Luxury Tech & Services.

Chaque Maison peut porter plusieurs appartenances, chacune documentée. Une revue atomique conserve manifeste, état avant, provenance et empreinte ; l'historique est immuable. Une fusion ne peut pas perdre silencieusement une appartenance validée. L'ancien classement reste conservé pour l'investigation. Un ajout de concept, une traduction ou une appartenance passent par des données revues, sans modification du front ni déploiement. [Procédure opérationnelle](../../../apps/aggregator/src/sectors/README.md).

L'annuaire, les fiches, filtres et agrégations lisent le nouveau référentiel. Retail comme activité d'entreprise reste indépendant de la famille métier. Les appartenances se recouvrent : **la somme des secteurs n'est pas le total des offres**. Les résultats ne dupliquent pas les IDs. Une absence de secteur ne retire aucune offre de la recherche générale. Un code de filtre invalide ne supprime pas silencieusement la restriction.

L'historique statistique antérieur aux revues reste conservé ; il n'est pas présenté comme une croissance comparable après changement du classement.

## PREUVES ET REVUES MÉTIER

Le [manifeste initial](sector-manifest.json) concerne 218 identités et 21 008 offres actives. Le [complément officiel](sector-manifest-official-extension.json) concerne 12 identités supplémentaires et 26 008 offres actives. Au total : **230 identités, dont 25 nouvelles revues officielles et 205 reprises du référentiel historique qualifiées MEDIUM/REFERENCE_LIST**. Ce ne sont pas 230 nouvelles vérifications officielles ni des inventaires exhaustifs de toutes leurs activités.

[Hermès](https://www.hermes.com/fr/fr/content/333134-la-liberte-de-creation/) documente vêtements, cuir, chaussures, bijoux, montres, parfum, beauté et maison. [Cartier](https://www.cartier.com/fr-fr/maison) documente notamment joaillerie, horlogerie, parfum et maroquinerie. [Rolex](https://www.rolex.com/fr) documente l'horlogerie. Les présentations de [Kering](https://www.kering.com/fr/maisons/) et [Richemont](https://www.richemont.com/news-media/press-releases-news/richemont-maintained-strong-momentum-with-sales-up-11-at-constant-rates-for-its-third-quarter-ended-31-december-2025/) distinguent les activités des Maisons.

Les compléments s'appuient notamment sur les présentations officielles d'[Ulta Beauty](https://www.ulta.com/investor/company-information), [Boots](https://www.boots-uk.com/about-boots-uk/our-purpose-and-values/), [H&M Group](https://hmgroup.com/about-us/business-idea/), [Tapestry](https://investors.tapestry.com/), [Pandora](https://www.pandoragroup.com/about-us), [Rituals](https://www.rituals.com/newsroom/en-WW/about/) et [Ralph Lauren](https://investor.ralphlauren.com/). Les sources des douze revues sont conservées dans le manifeste. Une activité du groupe n'est pas propagée automatiquement à chacune de ses marques.

## TESTS

- 1 491 tests unitaires, 232 tests d'intégration, 109 tests web réussis ; deux tests réservés au corpus réel explicitement ignorés dans la suite web courante.
- Quatre contrôles sur le corpus réel et 18 tests end-to-end réussis. Typechecks et build réussis. CI des PR 46 et 47 verte.
- Sauvegarde complète de production restaurée avant réparation : 380 386 100 octets ; SHA-256 `20457d22faa09ac92445d5fd26cd5e60dc536655aabca03444fec0f795e2d41f`.
- Réparation rejouée sur la copie réelle avant la production. Les 1 195 opérations produites par le plan de production sont identiques aux opérations validées sur la copie.
- Aucun test de charge ni simulation de volume.

## ÉTAT APRÈS ET MÉTRIQUES

Réparation en production : **1 195 offres**, dont **1 166 actives**. Parmi elles, 128 comportent au moins une contradiction explicite mise en attente. La réparation ne remplace pas les informations manquantes par une certitude inventée.

| Dimension / valeur | Avant, actives | Après réparation, actives |
|---|---:|---:|
| Durée PERMANENT | 16 294 | 16 796 |
| Durée FIXED_TERM | 7 656 | 7 761 |
| Durée TEMPORARY | 139 | 136 |
| Durée absente | 50 035 | 49 431 |
| Temps plein | 25 269 | 25 356 |
| Temps partiel | 26 566 | 26 639 |
| Rythme absent | 22 289 | 22 129 |
| Stage | 3 398 | 3 548 |
| Alternance | 691 | 684 |
| Programme jeunes diplômés | 184 | 183 |
| VIE | 16 | 15 |
| Freelance | 110 | 110 |
| Indépendant | 100 | 100 |

**Aucune offre perdue lors des réparations** : mêmes 77 352 IDs, 74 124 actives et 10 947 France. L'empreinte des champs hors périmètre reste `abc30980f9104c6db91938f35e475bd3`. Ce contrôle précède l'ingestion réelle de validation, qui actualise normalement les preuves source.

1 195 images avant/après dans DataCorrection et 1 195 événements CORRECTED ajoutés. JobSource reste à 80 380, SourceObservation à 72 222, OccupationObservation à 77 347 au terme de la réparation. Deuxième application en production : **zéro écriture**, invariants géographie et cycle de vie à zéro violation.

Secteurs documentés : Mode 18 562 offres, Maroquinerie 2 504, Chaussures 9 182, Joaillerie 3 329, **Horlogerie 1 091**, Beauté 22 019, Parfumerie 13 417, Lunetterie 71, Maison & Lifestyle 7 098, Hospitality 1 105, Retail 22 294. Les quatre autres concepts existent mais n'ont pas encore d'appartenance revue dans cette livraison. Les chiffres se recouvrent.

## RÉGRESSIONS VÉRIFIÉES EN PRODUCTION

**35 contrôles base/API réussis** : monde, France, États-Unis, Royaume-Uni, Allemagne, Italie ; les 15 secteurs ; secteur à vérifier et code invalide ; contrats, rythmes, programmes et statut ; filtres combinés et recherche métier. Les agrégations sectorielles d'intelligence correspondent aux comptes des filtres. Les requêtes textuelles conservent leurs résultats littéraux et l'élargissement canonique du lot 2. Aucun ID dupliqué dans les pages vérifiées.

Contrôle visuel desktop 1 440 px et mobile 390 px : HTTP 200, libellés français, Horlogerie visible, menus dans le viewport, aucune erreur JavaScript ni débordement horizontal.

**Ingestion native Railway BZB**, run `10ac5a5c-6602-4590-9e2a-2f598e687725`, révision `26bb4313d44026d6dc51a220cf2ffcede549b69f` : COMPLETED, 18 récupérées, 18 acceptées, zéro erreur, 18 preuves d'emploi capturées, zéro divergence des décisions au replay, identifiants et appartenances sectorielles conservés. Cette preuve porte sur une source réelle ; elle ne certifie pas tous les ATS.

## LIVRAISON

| Finding | Fixé ? | Commit | Main ? | Déployé ? | Données réparées ? | Preuve prod |
|---|---|---|---|---|---|---|
| Contrats anglais et dimensions mal présentées | Oui | 7927024 | 26bb431 | Oui | Présentation ; valeurs conservées | UI desktop/mobile + API |
| Champs d'emploi structurés ignorés / confiance indue | Oui pour les causes mesurées | 7927024 | 26bb431 | Oui | 1 195 offres, historique conservé | Batch lot3-employment-paths-v2-20260909 ; second passage 0 |
| Secteur scalaire / Horlogerie absente | Oui | 7927024 | 26bb431 | Oui | 218 identités initiales | Horlogerie 1 091 ; Cartier et Hermès multi-secteurs |
| Qualification complémentaire officielle | Oui, périmètre de 12 identités | 19539ba | 9639eb1 | Données, sans déploiement applicatif | 12 identités / 26 008 actives | Revue 3d05c5d3580db2e4cd8ff29a4ecbc4567722d13452d9e176f594502c78076355 |
| Préservation au prochain run / capture des entrées | Oui, témoin réel validé | 7927024 | 26bb431 | Oui | 18 offres réattestées | Run BZB ci-dessus |
| Qualification sectorielle exhaustive | Non | — | — | — | 1 337 identités / 27 108 actives à traiter | File de revue conservée |
| Replay intégral du raw historique | Non démontré | — | — | Capture future livrée | Réparation limitée aux différences causales prouvées | Entrées historiques absentes ou chemins à étudier |

Les [preuves chiffrées exportées](production-proof.json) distinguent réparation et ingestion. Les sauvegardes, plans contenant les images complètes, journaux et captures sont conservés dans `backups/lot3-20260909/` hors Git.

## RESTANT À FAIRE ET GO / NO-GO

1. Qualifier les 1 337 identités restantes par leurs activités effectives, avec provenance ; compléter aussi les activités encore non documentées des identités déjà rattachées. Les 205 reprises du référentiel ne valent pas nouvelle vérification officielle. Aucun automatisme de ressemblance ou de propagation du groupe ne doit remplir ce manque.
2. Reconstituer ou réétudier les entrées historiques des adapters avant de revendiquer un replay intégral. Le premier comparatif fondé sur le seul raw présentait 21 707 différences : il n'a pas été appliqué aveuglément. La réparation livrée isole les changements causés par les chemins et règles corrigés. Une valeur absente ne prouve ni absence d'information à la source ni erreur de parsing ; cela doit être investigué.
3. Étendre les témoins réels aux autres ATS et aux formes linguistiques ambiguës. Un test BZB et des replays ne prouvent pas l'exhaustivité de tous les ATS. La résolution de toutes les ambiguïtés internes d'un libellé libre n'est pas revendiquée.

**GO : socle technique livré et validations décrites ci-dessus acquises. NO-GO : clôture exhaustive du lot 3 et passage aveugle au lot 4.** Aucun « 100 % production-ready » n'est revendiqué. Les crons restent en pause ; seul le témoin BZB borné a été exécuté.
