# Identité employeur : audit approfondi et remédiation prouvée

8 septembre 2026, production relue entre 20 h 01 et 20 h 06, heure de Paris. Application vérifiée : **modecareers.com**. Le répertoire de ce dépôt est `/entreprises` ; `catwalks.io/maisons` est un autre site cité dans la demande.

**Le problème était structurel.** Un nom de marque pouvait conduire à un portail ATS homonyme, être accepté comme preuve d’identité, puis contaminer toutes les offres et leur domaine. L’erreur de mon rapport sur les marques SMCP était distincte : un domaine propre manquant ne remet pas en cause une marque explicitement nommée par son groupe. Voir [les huit causes et leurs chemins de code](AUDIT-IDENTITE-RACINE.md).

Les cinq cohortes de réparation sont maintenant corrigées en production. **La certification de l’ensemble du catalogue reste ouverte.** Ce document ne déclare pas Catwalks prêt à l’échelle mondiale.

## 1. Statut exact : audit, code, main, déploiement, données

Code : [`18b66ee`](https://github.com/lmelane/fr-retail-jobs/commit/18b66ee554a8644c0305d55a7d2af36e4c53cfe3). Fusion : [PR #20](https://github.com/lmelane/fr-retail-jobs/pull/20), commit main **`758cd7518a5fedbf388b61b9b47eb3f11ea06be2`**. Les quatre services Railway portent ce commit. Le web est en service ; aggregator, refresh et reconcile sont construits et prêts pour leurs prochains crons. Cela ne signifie pas qu’un nouveau parcours de tous les ATS a déjà été exécuté.

| Finding | Fixé ? | Commit | Main ? | Déployé ? | Données réparées ? | Preuve prod |
|---|---|---|---|---|---|---|
| Tiffany / 38 conflits Oracle | Oui, cohorte démontrée et prévention des refusions | 18b66ee | Oui, 758cd75 | Oui | Oui, 85 opérations | 0 conflit Oracle ; fiches Paris FR et Gold Coast AU, HTTP 200 et JSON-LD correct |
| SMCP : 275 marques explicites mal attribuées | Oui | 18b66ee | Oui | Oui | Oui ; 455 offres réattribuées, dont 180 sans marque vers le groupe | 0 contradiction avec le RAW ; Maje 148, Claudie Pierlot 69, Fursac 35, Sandro 102, SMCP 203 |
| VIA / ASHOKA | Oui, exclusion des employeurs hors secteur | 18b66ee | Oui | Oui | Oui, 161 offres exclues, sans suppression | Sources RETIRED ; 0 représentation active |
| 18 autres employeurs homonymes | Oui, cohorte démontrée | 18b66ee | Oui | Oui | Oui, 210 offres exclues, sans suppression | Sources RETIRED ; 0 représentation active |
| Chanel / L’Oréal / Lovisa / portail Farfetch | Oui, périmètre documenté | 18b66ee | Oui | Oui | Oui, 3 790 offres réattribuées | 0 contradiction avec les règles de propriétaire/marque revues ; compteurs API identiques aux cohortes DB |
| Activation acceptée sur un nom et un compteur | Oui, chemin `promoteSource` protégé | 18b66ee | Oui | Oui | Certification rétroactive non réalisée | Registre de preuves installé ; assertion en lecture seule refuse Coast sans revue ; témoin avant/après sur base isolée |
| Conservation RAW / IDs / premières dates / historique | Oui pour ces cinq lots | 18b66ee | Oui | Oui | Vérifiée | 0 ID perdu, 0 firstSeenAt changé, 0 ancien événement perdu ; 5 128 entrées de correction |
| Qualification abusive des quatre marques SMCP dans le rapport | Rectifiée dans l’audit | 7adc117 | Oui | Sans objet | Sans objet : qualification documentaire | Preuve officielle SMCP ; état de collecte séparé de l’identité commerciale |
| Sources historiques non requalifiées | Non, inventaire et méthode disponibles | — | — | — | Non | 178 sources encore actives de la population `validated-name`, 7 178 offres à examiner ; ce ne sont pas 7 178 erreurs prouvées |
| P1 géographie / fraîcheur / Douglas / séniorité / provenance | Non dans ce lot | — | — | — | Non | Anomalies conservées et datées dans l’audit initial et les lectures après correction |

## 2. Chiffres réels après réparation

| Mesure | Avant | Après |
|---|---:|---:|
| Offres actives | 71 636 | **71 263** |
| Offres conservées, actives ou non | 73 645 | **73 645** |
| JobSources conservées | 76 562 | **76 562** |
| Événements | 8 037 | **12 695**, dont tous les 8 037 anciens |
| Sources ACTIVE | 440 | **420** |
| Familles d’adaptateurs actives | 38 | **38** |
| Fiches Company | 1 556 | **1 563** |
| Fiches avec offres actives | 1 054 | **1 039** |
| Fiches sans empreinte d’une source ACTIVE | 343 | **364** |
| Company.kind UNKNOWN | 1 556 | **1 531** |

La baisse de 373 offres actives correspond à **371 exclusions hors secteur et deux représentations Oracle redondantes**. Les sept fiches employeurs créées servent aux réattributions ; elles ne correspondent pas à sept nouveaux portails collectés.

**Le nombre de Maisons / groupes / enseignes certifiés reste non établi.** Les 1 563 Company ne peuvent pas être présentées comme 1 563 Maisons validées. Le nouveau registre SourceIdentityReview contient zéro décision : des preuves ciblées existent dans les dossiers de correction, mais leur reprise et la revue des autres sources selon le protocole restent à réaliser. L’absence d’une décision dans ce nouveau registre ne signifie pas qu’une marque n’existe pas.

La cohorte SMCP conserve 557 offres. Les 203 rattachées au groupe correspondent à 23 RAW explicitement SMCP et 180 sans marque exploitable. Aucune marque n’a été inventée pour ces 180 offres.

Autres cohortes vérifiées : Chanel 1 117 ; L’Oréal 1 804 ; Lovisa 841 ; portail Farfetch 65, réparties entre Farfetch 52, Luxclusif 7, Stadium Goods 3 et Browns 3. Partager un portail ne prouve pas une relation de groupe juridique.

## 3. Front et pays : résultats et limites

| Pays | `countryCode` stocké | API / filtre |
|---|---:|---:|
| États-Unis | 30 286 US | 30 286 |
| France | 9 637 FR | **9 634**, via `isFrance` |
| Royaume-Uni | 2 806 GB + 20 UK | **2 826**, alias UK normalisé |
| Allemagne | 2 681 | 2 681 |
| Canada | 2 630 | 2 630 |
| Italie | 2 312 | 2 312 |
| Espagne | 2 022 | 2 022 |
| Australie | 1 162 | 1 162 |

4 647 offres actives n’ont pas de `countryCode`. Les facettes et l’API publiques donnent le même total pour les filtres contrôlés. Cela ne suffit pas à certifier le pays de chaque offre.

Les trois divergences France restent ouvertes : une offre localisée « Bruxelles, Belgique » et deux offres « Tourcoing » ont `countryCode=FR` mais `isFrance=false`. Leurs IDs figurent dans [production-readout.json](production-readout.json). Il faut reprendre leurs preuves de localisation avant correction ; le filtre France n’est pas simplement à augmenter de trois.

Le premier contrôle comparant strictement GB à l’API a signalé +20 ; la lecture des valeurs UK et de la règle d’alias explique cet écart. Cette sortie initiale est conservée. `/maisons` renvoie 404 sur modecareers.com ; le répertoire implémenté `/entreprises` répond 200 avec l’agent de lecture nommé. Un appel avec l’agent Python par défaut a renvoyé 403 : ce n’est pas une preuve de panne du serveur applicatif. Accueil, santé API, page intelligence France et les deux fiches Tiffany contrôlées répondent 200.

## 4. Ce qui manque encore

**P0 — terminer la qualification des identités existantes.** Revoir en priorité les 178 sources encore actives issues d’une admission par nom, puis les autres sources selon le risque. Pour chacune : identité commerciale, propriétaire du tenant, marques publiées, attribution des offres, preuve officielle datée et décision explicite. Les pistes ambiguës restent non résolues ; ne pas les retirer sur une simple absence de preuve dans une archive.

**P1 — séparer les concepts dans le modèle.** Maison, enseigne, groupe, employeur juridique et propriétaire ATS doivent avoir des relations qualifiées. Une preuve de marque ne valide ni le connecteur, ni toutes les offres d’un portail de groupe. Les scores historiques 0,9 ne sont pas des probabilités calibrées. Le registre de revue protège l’activation ; la découverte et la reprise de l’historique restent à refondre autour de ces distinctions.

**P1 — corriger les autres dimensions avec leurs témoins.** Pays et `isFrance`, ambiguïtés géographiques, fraîcheur et fantômes, dates Douglas, séniorité MID par défaut, provenance par champ et compteurs. Les exclusions hors secteur utilisent encore le modèle historique `isActive/closedAt` : elles sont journalisées CORRECTED, pas CLOSED, mais les pages et métriques de fermeture doivent distinguer une exclusion éditoriale d’une fermeture chez l’employeur. La réparation Oracle ne certifie pas la fraîcheur de toutes les offres Tiffany.

**P2 — extension après validation.** L’inventaire comprend 38 dossiers : 30 identités d’extension non retrouvées par nom/clé/alias au moment du relevé, quatre fiches existantes à enrichir, et quatre corrections SMCP. **Zéro nouveau portail de cet inventaire activé.** [Le tableau de qualification](couverture-qualifiee.csv) est daté avant réparation ; la présence réelle après correction se lit dans les preuves de production. Les décisions documentaires sont désormais explicites dans un fichier séparé : ajouter une ligne ou renseigner un domaine ne suffit plus à générer automatiquement « identité documentée ».

## 5. Chaîne de preuve et revue Git

- Backup réel restauré sans erreur deux fois ; cinq plans rejoués sur la seconde copie ; aucune simulation de charge.
- Validation du code : 1 359 tests unitaires agrégateur, 196 intégrations sur une base isolée, 102 tests web ; deux anciens tests web conditionnels restent ignorés. Typechecks réussis. [CI de la PR #20](https://github.com/lmelane/fr-retail-jobs/actions/runs/34259780317) verte.
- [Préconditions de production](production-preflight.json) : 5 128 états avant contrôlés, zéro état périmé.
- [Migrations](production-migrations.json), [déploiements Railway](production-deployments.json), [reçus des cinq lots](production-receipts.json), [conservation exhaustive](production-preservation.json).
- [Deuxième exécution en production](production-idempotence.json) : cinq lots déjà appliqués, **zéro écriture supplémentaire**, invariants toujours valides.
- [Lecture DB](production-readout.json), [preuves HTTP/API](production-public-proof.json), [interprétation des écarts observés](production-public-assessment.json), [sources restant à requalifier](production-residual-identity.json).
- Les anciennes PR #1 et #10 ont été fermées comme remplacées : le code actuel utilise déjà le pays réel dans `job-posting-schema.ts`, des liens d’offres dans `jobs-view.tsx`, et `getSimilarJobs` avec liens rendus côté serveur. Leurs anciennes implémentations n’ont pas été fusionnées à nouveau.

Les plans, RAW et sauvegardes complets restent privés sous `backups/remediation-20260908/`. Le journal DataCorrection conserve les images avant/après, empreintes, preuves et commit d’exécution ; il interdit UPDATE/DELETE. Une correction ultérieure doit être compensatrice et traçable.
