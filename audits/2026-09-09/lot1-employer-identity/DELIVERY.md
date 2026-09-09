# Lot 1 — livraison, logique métier et limites vérifiées

Le lot reste **ouvert**. Le socle, quatre consolidations d’employeurs prouvées et la déduplication Bizzbee/BZB sont livrés. La dernière version applicative est `606be144240452abf67825688002abbcf9f22ad2`, fusionnée sur main et déployée sur les quatre services Railway. La commande normale de l’agrégateur est restaurée ; les crons massifs restent en pause.

## La bonne organisation, sans objectif de fusion

La référence est l’organisation métier de l’employeur. Une marque, une enseigne, un groupe, une société employeuse et une unité opérationnelle ne sont pas interchangeables. Un domaine, un nom proche ou un ATS commun ne justifie pas une fusion. Une différence de raison sociale ne justifie pas non plus, à elle seule, la création de deux marques publiques.

Une revue peut confirmer des alias d’une même identité, maintenir des identités distinctes et documenter leur relation, ou préciser les preuves qui manquent. Les preuves et leur date restent conservées pour permettre une nouvelle décision en cas de réorganisation. L’égalité de deux offres est une question indépendante de l’identité de leur employeur.

Après BZB, l’audit mesure **414 paires candidates, dont 47 avec des offres actives des deux côtés**. Ce ne sont ni 414 doublons avérés, ni 414 fusions à réaliser. Le détecteur ne consomme pas encore un registre de décisions « entités distinctes, vérifiées » : ce manque reste à traiter pour éviter une revue répétitive de cas légitimes. La clôture ne doit pas exiger zéro paire de noms similaires.

## Mesures réelles

| Mesure | Avant Lot 1 | Après Promod et avant BZB | Après BZB et sa collecte réelle |
|---|---:|---:|---:|
| Fiches Company conservées | 1 571 | 1 571 | 1 571 |
| Racines du catalogue | 1 571 | 1 568 | 1 567 |
| Racines avec offres actives | 1 047 | 1 044 | 1 043 |
| Alias | 6 historiques non consommés | 20 revus | 24 revus |
| Offres, tous états, IDs conservés | 77 322 | 77 352 | 77 352 |
| Offres actives | 74 113 | 74 146 | 74 124 |
| Représentations JobSource | 80 348 | 80 380 | 80 380 |
| Événements JobEvent | 21 718 | 21 790 | 21 839 |
| Observations RAW SourceObservation | 72 178 | 72 222 | 72 222 |
| Lignes Job réattribuées par réparation, cumul | — | 33 | 56 |
| Paires d’offres consolidées avec preuve native | — | 0 | 23 |
| Doublons actifs retirés des comptes | — | 0 | 22 |

Les collectes Promod ont créé 30 offres et rouvert trois offres. La baisse ultérieure de 22 actives correspond aux seuls doublons BZB prouvés ; aucune offre n’a été supprimée. Les 56 lignes réattribuées ne représentent pas 56 recrutements distincts : elles incluent les 23 anciens IDs Bizzbee conservés comme redirections.

L’inventaire RAW mesure **716 libellés distincts sur dix chemins explicites, dans 201 sources**. Ce périmètre est documenté et non exhaustif. Le catalogue contient 500 sources : 423 ACTIVE, 69 RETIRED, 8 PAUSED. ACTIVE est un statut de catalogue, pas une attestation indépendante de fiabilité de chaque source ni une indication que les crons tournent.

Preuves : [inventaire après BZB](production-after-bzb-inventory.json), [métriques détaillées](production-bzb-final-metrics.json), [paires actives restantes](remaining-active-candidates-after-bzb.json).

## Correctifs et état de livraison

| Finding | Fixé ? | Commit | Main ? | Déployé ? | Données réparées ? | Preuve prod |
|---|---|---|---|---|---|---|
| Promod / PROMOD - MAGASIN | Oui, identité prouvée | 7643171 | Oui | Oui | 2 offres réattribuées | `production-repair-proof.json` ; compteur 54 après collectes |
| AUBADE / Aubade Paris | Oui, identité prouvée | 7643171 | Oui | Oui | 29 offres réattribuées | `production-repair-proof.json` ; compteur 29 |
| Créations Fusalp / Fusalp | Oui, identité prouvée | 7643171 | Oui | Oui | 2 offres réattribuées | `production-fusalp-proof.json` ; compteur 21 |
| Six alias historiques non consommés | Oui | 7643171 | Oui | Oui | Six IDs migrés, cinq preuves officielles | `production-legacy-alias-plan.json` |
| Relations SMCP | Quatre Maisons prouvées | 7643171 | Oui | Oui | Quatre FK ; zéro offre déplacée | `production-smcp-plan.json` ; groupe et Maisons distincts |
| Réécriture du nom par ingestion / collision de clé de nom | Garde de résolution livrée | 7643171 | Oui | Oui | Aucune réparation massive implicite | Décisions Promod et BZB en REVIEWED_ALIAS |
| Champs employeur TalentView / Teamtailor ignorés | Oui | 0dbcb2f | Oui | Oui | Décisions natives des collectes Promod et BZB | `production-native-run-proof.json`, `production-bzb-run-proof.json` |
| Détail employeur Workday perdu lors d’un échec | Code corrigé ; validation native prod restante | 7643171 | Oui | Oui | Aucun détail historique inventé | Régression sur RAW réel ; pas de run Workday de validation production |
| Réécriture d’identité par une nouvelle observation d’annuaire | Oui pour les fiches existantes | 35634f2 | Oui | Oui | Pas de renommage manuel | Tests d’import et de rejeu ; pas de collecte FashionJobs massive de validation |
| Bizzbee / BZB | Oui, changement de nom officiel | 606be14 | Oui | Oui | 23 Job réattribués ; quatre alias | `production-bzb-consolidation-proof.json` |
| Offres Bizzbee / BZB en double | Oui, 23 paires natives prouvées | 606be14 | Oui | Oui | 23 redirections, 22 doublons actifs en moins | `production-bzb-front-after.json` ; IDs/historiques conservés |
| Deux portails BZB collectés en parallèle | Oui, même ensemble natif vérifié | 606be14 | Oui | Oui | `bizzbee` RETIRED, `bzb` ACTIVE ; trois liens propriétaires réattribués | `bzb-live-feeds-proof.json`, `production-bzb-retirement-proof.json` |
| Consolidation comptée comme fermeture / agrégat en cache périmé | Oui | 606be14 | Oui | Oui | Pas de dates de fermeture fabriquées ; snapshots historiques conservés | Invariants, tests de statistiques, index de révision mesuré en prod |
| Conservation des témoins natifs avant rafraîchissement RAW | Oui | 606be14 | Oui | Oui | 47 artifacts immuables archivés et vérifiés | `production-bzb-conservation-proof.json` |
| « Promod 53 », etc. dans Company.name | Anomalie non retrouvée dans les quatre noms stockés | — | — | — | Zéro chiffre retiré sans preuve | Nom et compteur séparés ; pas de règle de suppression générale |
| Autres paires, distinctions métier, types et relations historiques | Revue incomplète | — | — | — | Pas de fusion forcée | `remaining-active-candidates-after-bzb.json` |

Les PR applicatives correspondantes sont [#38](https://github.com/lmelane/fr-retail-jobs/pull/38), [#39](https://github.com/lmelane/fr-retail-jobs/pull/39), [#41](https://github.com/lmelane/fr-retail-jobs/pull/41) et [#42](https://github.com/lmelane/fr-retail-jobs/pull/42). Les commits de documentation ultérieurs ne changent pas la version applicative mesurée.

## BZB : preuve avant, réparation, preuve après

Le [site officiel](https://www.b-z-b.com/actu.html) annonce le changement Bizzbee → BZB. Indépendamment, les 23 paires stockées partagent le même émetteur natif `hiringOrganization.sameAs` et le même `identifier.value` Teamtailor. Ni les titres, ni la ressemblance des noms ne déterminent cette déduplication.

La sauvegarde immédiatement préalable (`359 928 365` octets, SHA-256 `846d71a81b28054a15bf36f095dc16bb47714cf07846718daec6b4936606e8d3`) a été restaurée. La répétition finale a appliqué le même plan de consolidation que la production. Les mêmes 26 opérations de retrait de portail ont été répétées avec leurs états initiaux respectifs. Les transactions sont idempotentes ; leur seconde application n’écrit rien.

Les 77 352 IDs Job, 80 380 IDs JobSource et 21 790 événements préexistants sont tous retrouvés après le run, sans événement ancien modifié. La revue archive un document officiel et les 46 représentations natives complètes, avec leurs empreintes, y compris les représentations historiques qui n’avaient pas encore de SourceObservation. Les anciennes Company et Job ne sont pas supprimées.

Le run Railway `cfb6f15f-0b62-4ac7-8a8b-8b3226ee6fa1`, au commit `606be14`, a récupéré **18 offres, mis à jour 18, créé zéro, fusionné zéro, rencontré zéro erreur**. Les 18 décisions utilisent le champ natif `_jobposting.hiringOrganization.name` avec REVIEWED_ALIAS. Le journal conserve cinq événements sur cinq, sans échec de persistance ; pic observé de trois lignes/s, sans avertissement de suppression Railway. Ce run borné ne valide pas toutes les sources ni la charge d’exploitation globale.

Le front renvoie les mêmes 22 IDs actifs pour Bizzbee et BZB, sous le nom canonique BZB. Les 22 anciennes URLs actives redirigent en 308 vers le bon poste ; l’ancienne URL déjà fermée reste en 410. Promod, Aubade et Fusalp conservent leurs résultats, y compris via leurs anciens noms.

Preuves : [restauration](bzb-backup-restoration-proof.json), [répétition finale](final-local-bzb-consolidation-proof.json), [application production](production-bzb-consolidation-proof.json), [retrait du portail](production-bzb-retirement-proof.json), [conservation](production-bzb-conservation-proof.json), [run réel](production-bzb-run-proof.json), [état final Railway](bzb-deployment-after-validation.json).

## Base et API après réparation

| Filtre | Base | API | Écart |
|---|---:|---:|---:|
| Monde | 74 124 | 74 124 | 0 |
| France | 10 947 | 10 947 | 0 |
| États-Unis | 30 943 | 30 943 | 0 |
| Royaume-Uni | 2 872 | 2 872 | 0 |
| Allemagne | 2 739 | 2 739 | 0 |
| Italie | 2 446 | 2 446 | 0 |

Mesure datée dans [production-bzb-country-parity.json](production-bzb-country-parity.json). France utilise le prédicat actuel `isFrance`, les autres pays `countryCode`. Cette égalité valide la transmission des compteurs testés ; elle ne prouve pas l’exactitude de toutes les localisations ni l’exhaustivité de la couverture France.

## Causes et validations encore ouvertes

1. **Distinctions métier durables.** Revoir les 47 paires actives en séparant alias, relations et entités réellement distinctes, puis mémoriser les décisions avec leurs preuves. Un groupe et sa marque ou deux enseignes sœurs ne doivent pas être fusionnés pour faire baisser un compteur. Le détecteur actuel réémet encore ces candidats.
2. **Structure du catalogue.** 1 526 racines ont un type historique non renseigné et 159 relations parent restent textuelles. Ces manques ne signifient pas que les entreprises n’existent pas ou que leur identité publique est invérifiable. Les compléter exige des preuves d’organisation, pas une classification de convenance.
3. **Entrées de découverte.** Une nouvelle URL FashionJobs peut encore créer une fiche Company PENDING. Le correctif des fiches existantes ne prouve pas que toutes les nouvelles entrées sont rapprochées de leur identité officielle. Auditer le parcours découverte → validation → promotion sans fusion par nom ; aucune offre FashionJobs n’est récupérée par ce chantier.
4. **Provenance native.** Étendre les champs explicitement extraits au-delà de Workday, TalentView et Teamtailor. Une unité ou un département ATS n’est pas automatiquement l’employeur. Valider Workday sur une collecte réelle bornée puis un cycle d’exploitation complet avant de lever les réserves du Lot 0.
5. **Fraîcheur observée sur BZB.** Quatre représentations encore actives n’étaient pas dans les 18 offres du dernier feed complet. Leurs IDs, dates et URLs figurent dans les métriques. Elles n’ont pas été fermées à l’occasion d’une correction d’identité ; leur situation relève de la validation du cycle de vie.
6. **Localisation manquante BZB.** Une offre observée n’a pas de pays. Son payload de feed ne contient ni jobLocation, ni jobLocationType, ni applicantLocationRequirements. L’enrichissement par sa page détaillée reste à auditer : cette absence ne démontre pas que l’employeur ne publie la localisation nulle part. Aucun pays n’a été inventé à partir de la nationalité de l’enseigne. Voir [le témoin](bzb-null-country-proof.json).

Validation de la dernière livraison applicative : **1 465 tests unitaires agrégateur, 222 intégrations, 106 tests web réussis et deux tests explicitement conditionnés à un snapshot ignorés**, typechecks, build Next.js et E2E de CI réussis. Les suites seules ne remplacent pas les preuves production ci-dessus et ne clôturent pas les travaux restants.
