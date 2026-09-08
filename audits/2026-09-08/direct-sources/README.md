# Sources directes Flatchr — lot du 8 septembre 2026

## Périmètre et preuve avant

FashionJobs reste un annuaire de découverte, sa source d'offres est PAUSED. Le relevé de 749 profils est complet pour la page française observée ; ce n'est pas l'ensemble des employeurs du monde. Les profils non résolus ne sont pas déclarés absents : une erreur technique ou une insuffisance de recherche n'est pas encore exclue pour tous ces dossiers.

Trois enseignes étaient absentes du catalogue direct et des identités correspondantes en production. Les sites officiels lient leurs portails Flatchr :

| Identité canonique | Preuve employeur | Offres portail mondial | France |
|---|---|---:|---:|
| Adopt Parfums | https://www.adopt.com/fr/ | 121 | 82 |
| RIU Paris | https://www.riuparis.fr/fr-fr/recrutement | 15 | 15 |
| Toscane | https://www.toscane-boutique.fr/ | 20 | 20 |
| Total de ce lot, identités distinctes | | 156 | 117 |

Adopt : Italie 28, Belgique 7, Canada 4. Aucune restriction France/locale dans la collecte. Les groupes parents ne sont pas renseignés sans dossier de rattachement ; leur recherche reste à faire. L'identité de marque et le portail, eux, sont établis. Les compteurs FashionJobs ne prouvent pas un recouvrement offre par offre.

## Causes constatées et correctifs

- Flatchr était ramené à GENERIC_JSONLD : le payload structuré Next.js n'était pas exploité par un adaptateur dédié. Nouveau type FLATCHR, dispatch et migration additive.
- Le parcours de découverte écartait les liens carrière externes et acceptait les offres commerciales. Il conserve maintenant les liens recrutement externes explicites ; un résultat de découverte n'autorise jamais seul une activation.
- Un board à la racine comme Toscane doit tirer son chemin du payload réel, sans deviner le slug depuis le nom de marque.
- Les domaines flatchr.io / werecruit.io sont explicitement exclus des domaines employeur et des preuves d'identité.
- 11 métiers non classés sur la répétition initiale : neuf « Responsabile di Negozio », un gestionnaire de référentiel produits, un coordinateur énergie/fluides/bâtiments. Lecture des missions avant correction ; règles de taxonomie v3 accompagnées de témoins. Le département ATS « Commercial conseil » des deux derniers contredit leur métier : il n'est pas repris comme vérité.

## Contrat de lecture et canonicalisation

La page publique non filtrée contient `props.data.items`. La liste complète alimente les filtres, le compteur et les cartes « Voir plus » du frontend Flatchr (runtime archivé). Le nombre d'identifiants uniques est comparé au compteur rendu. Il s'agit de l'exhaustivité de ce portail à l'instant lu, pas d'une preuve que la marque n'utilise aucun autre portail régional.

| RAW Flatchr | Traitement | Destination / limite |
|---|---|---|
| vacancy.company.id + vacancy.id | Identité stable, publication/slug non utilisés comme clé | externalId, pas de doublon sur republication/changement de titre |
| vacancy.company.name | Résolution centrale, alias Adopt explicite | Company canonique ; identité attestée depuis domaine officiel |
| vacancy.address.country/locality/postal_code/coordinates | Champs du filtre public, normaliseur géographique commun | Pays ISO-2, ville, coordonnées ; pas de carte ville→pays improvisée |
| administrative_area_level_1/2 | Niveaux incohérents selon les pays | Conservés RAW, pas de région forcée |
| contract_type / partial | Dimensions d'emploi communes | Contrat/temps de travail ; conserver contradictions source/titre |
| description + mission + profile | Texte complet | Classification métier commune, aucune troncature intentionnelle |
| publication.publish_date, sinon publication.created_at | Date explicite de publication (date carte) | postedAt, jamais updated_at |
| vacancy.end_date | Fin du contrat | RAW seulement, jamais validThrough/fermeture |
| vacancy.language = fr_FR | Locale du board, également présente sur les 28 textes italiens | Pas de langue d'annonce forcée ; détection centrale |
| vacancy.remote / experience | Sémantique non encore certifiée | RAW seulement, pas de valeur canonique inventée |

Les drapeaux show_address/show_contract_type règlent un bloc du template détail, pas l'appartenance aux filtres publics ; les utiliser pour vider le pays aurait créé 25 UNKNOWN artificiels chez Adopt. Témoin ajouté avant activation. Les montants masqués par show_salary ne sont pas publiés comme salaires structurés.

Une réponse bloquée, un payload absent/malformé, un tenant inattendu, des identifiants dupliqués font échouer le parsing. Un compteur absent ou différent refuse l'attestation d'exhaustivité. Zéro sans compteur est inconnu, pas une preuve de fermeture. Le premier run reste NEW et n'atteste pas les absences ; la répétition complète et saine peut le faire selon les garde-fous centraux existants.

## Validation et activation

`prepare-flatchr.mts` capture preuves officielles, robots, payloads, pays, IDs ; archives intégrales privées, empreintes dans `flatchr-certificates.json`. `stage-flatchr.mts` est read-only par défaut. Son mode écriture requiert SHA de manifeste et, en production, checkout propre commité sur main. Transaction atomique : Company + aliases, Source DRAFT, SourceIdentityReview VERIFIED, journal DataCorrection. Aucun Job ni historique existant n'est modifié par la préparation.

La promotion utilise `promoteSource` existant (preuve d'identité liée à la configuration exacte, robots ALLOWED daté, volume attesté). L'ingestion passe par `runIngest`, la normalisation commune et la déduplication normale.

Répétition sur copie restaurée réelle : 156 Jobs / 156 JobSources, 117 FR, 156 RAW intacts face aux archives, zéro erreur, zéro fusion inattendue. Recollecter Adopt crée zéro nouveau Job. Les 11 métiers manquants sont classés après correction ; les preuves avant/après sont distinctes. Vérifications locales : 1 375 tests unitaires, 196 intégration, typecheck des deux apps. CI complète et preuves de production sont consignées après livraison.

## Ce qui reste ouvert

Ce lot ne certifie pas les 419 sources actives antérieures. Il ne résout pas les pays legacy ambigus, la fraîcheur des anciennes offres FashionJobs, la séniorité MID par défaut, la provenance persistée de tous les champs ni la découverte de tous les portails régionaux. Il ne permet donc pas de déclarer Catwalks « 100 % production grade ».

Pour chaque dossier non résolu, distinguer : recherche non terminée, domaine inaccessible (avec erreur et tentative datée), identité non établie, ATS non adapté, schéma non compris, collecte tronquée, conflit source, ou champ non exposé après vérification. « Champ absent de la source » exige une preuve de lecture de la source, pas l'absence du champ dans notre objet normalisé.

## Livraison en production vérifiée

PR #24 fusionnée, main `4f1c0cc1b1b5f150641916514b9aea1a9e5e9801`. Les quatre services applicatifs ont un déploiement SUCCESS de ce commit. Migration appliquée, sauvegarde fraîche 266 785 137 octets, staging rejoué sans nouvelle écriture, puis promotion par le garde existant et ingestion ciblée réellement exécutée sur la base de production.

- 3 nouvelles sources ACTIVE, 3 revues d'identité VERIFIED, 3 fiches employeur ajoutées.
- 156 Jobs / 156 JobSources nouveaux, 156 RAW égaux aux payloads archivés, zéro erreur, zéro fusion, tous pays et métiers renseignés dans cette cohorte.
- Monde : 71 263 → **71 419** actifs. France : 9 634 → **9 751**. Les deux API publiques répondent 200 et ont un écart de **0** avec la base.
- Stock total : 73 801 Jobs, 76 718 représentations ; événements : 12 695 → 12 851, soit 156 ouvertures. Le staging n'a changé aucun Job, aucune représentation ni aucun événement. FashionJobs reste PAUSED.

| Finding | Fixé ? | Commit | Main ? | Déployé ? | Données réparées / ajoutées ? | Preuve prod |
|---|---|---|---|---|---|---|
| Flatchr non intégré | Oui | 6c6ae6b | Oui, 4f1c0cc | Oui | 156 offres directes ajoutées | production-proof.json |
| Adopt / RIU / Toscane sans source directe | Oui pour ces trois dossiers | 6c6ae6b | Oui | Oui | 3 sources, identités et domaines attestés | stage-production-receipt.json |
| 11 métiers absents sur la répétition initiale | Oui pour cette cohorte | 6c6ae6b | Oui | Oui | Les 156 nouvelles offres ont un métier canonique | rehearsal-before-taxonomy.json → production-proof.json |
| Compteurs France / monde après ajout | Vérifiés | 6c6ae6b | Oui | Oui | Pas de divergence mesurée | front-production-proof.json |
| Exhaustivité du catalogue antérieur | Non certifiée globalement | — | — | — | Aucun backfill implicite | existing-source-enumeration.json |

LVMH a été relu indépendamment, sans écriture : **5 648 annoncées / 5 648 IDs uniques récupérés**, dont **1 342 FR**, sans filtre pays ni troncature (`lvmh-world-read.json`). Le relevé des anciennes sources trouvait 416 derniers runs avec `complete = null` (majoritairement du 7 septembre, avant l'instrumentation), et trois avec preuve de complétude rapportée par l'adaptateur. Cela ne démontre pas 416 sources cassées ; leur historique ne permet pas encore la certification exigée. La configuration Condé Nast comporte un filtre pays à examiner ; LVMH porte bien `country: null`.
