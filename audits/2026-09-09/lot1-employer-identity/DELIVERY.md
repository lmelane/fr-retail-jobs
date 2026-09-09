# Lot 1 — livraison et limites vérifiées

Le socle de résolution et les trois premières fusions d’employeurs sont en production au commit `7643171aacc4be29039032bd5deb7665b994555d` (PR #38). Le lot global n’est pas clôturé : les identités historiques et les doublons d’offres exposés par cette revue demandent encore des décisions. Aucun nombre de fiches ci-dessous ne signifie que toutes les entreprises sont indépendamment validées.

## Mesures

| Mesure | Avant réparations | Après réparations seules | Après collecte Promod réelle |
|---|---:|---:|---:|
| Fiches Company conservées | 1 571 | 1 571 | 1 571 |
| Racines du catalogue | 1 571 | 1 568 | 1 568 |
| Racines avec offres actives | 1 047 | 1 044 | 1 044 |
| Alias enregistrés | 6 non consommés | 20 revus et liés à leur source | 20 |
| Offres, tous états | 77 322 | 77 322 | 77 351 |
| Offres actives | 74 113 | 74 113 | 74 145 |
| Représentations JobSource | 80 348 | 80 348 | 80 379 |
| Événements JobEvent | 21 718 | 21 751 | 21 789 |
| Observations RAW | 72 178 | 72 178 | 72 221 |
| Offres réattribuées par les réparations | — | 33, dont 28 actives | inchangé |
| Offres perdues par les réparations | — | 0 | — |

Le run Promod a créé **29 offres** et **rouvert 3** : il explique l’augmentation de 32 actives. Il a récupéré 53 offres mondiales, dont 52 identifiées France. Son journal conserve ses cinq événements sur cinq, sans erreur ni échec de persistance. Ce passage borné n’est pas un test de charge ni une validation de toutes les sources.

**716 libellés RAW distincts sur 10 chemins explicites, dans 201 sources**, mesurés sur la copie complète avant la nouvelle collecte. La première mesure de 582 couvrait neuf chemins : l’ajout de `_jobposting.hiringOrganization.name` étend l’observation, ce n’est pas une hausse artificielle des données ni une preuve d’exhaustivité de tous les RAW.

## Décisions et preuves

| Finding | Fixé ? | Commit | Main ? | Déployé ? | Données réparées ? | Preuve production |
|---|---|---|---|---|---|---|
| Fragmentation Promod / PROMOD - MAGASIN | Oui | 7643171 | Oui | Oui | 2 offres réattribuées | Plan `lot1-promod-aubade-20260909-v1`; compteur 21 après réparation, puis 53 après collecte |
| Fragmentation AUBADE / Aubade Paris | Oui | 7643171 | Oui | Oui | 29 offres réattribuées | Même plan ; 29 actives en base/API/annuaire |
| Créations Fusalp / Fusalp | Oui | 7643171 | Oui | Oui | 2 offres réattribuées | Plan `lot1-fusalp-legal-commercial-20260909-v1`; 21 actives |
| Alias historiques non consommés | Oui | 7643171 | Oui | Oui | Six IDs migrés avec cinq preuves officielles | `production-legacy-alias-plan.json`, `production-repair-proof.json` |
| Liens groupe SMCP | Sur quatre Maisons prouvées | 7643171 | Oui | Oui | Quatre FK ; aucune offre déplacée | `production-smcp-plan.json` ; cinq identités restent distinctes |
| Réécriture du nom par ingestion / fusion sur une clé de nom | Oui, garde de résolution | 7643171 | Oui | Oui | Aucune correction massive implicite | Tests + 53 décisions REVIEWED_ALIAS du run Promod |
| Détail employeur Workday perdu ou remplacé lors d’un échec | Code corrigé | 7643171 | Oui | Oui | Aucun détail historique inventé | Tests de régression sur RAW réel ; pas encore de run Workday de validation production |
| Noms avec nombres « Promod 53 », etc. | Anomalie non retrouvée dans Company.name | — | — | — | Zéro nombre retiré sans preuve | Les quatre noms stockés sont propres ; API `name` et `jobCount` séparés |
| Bizzbee / BZB et offres en double | Cause prouvée, réparation non appliquée | — | Non | Non | Non | 23 paires de même identifiant Teamtailor, dont 22 actives ; voir `bzb-overlap-proof.json` |
| Autres candidats / classifications historiques | Audit disponible, revue incomplète | — | — | — | Non | Inventaire de toutes les fiches et paires candidates |

Les réparations sont transactionnelles et idempotentes. Chaque ancienne offre, représentation RAW et événement de leur périmètre est comparé avant/après ; les anciennes Company restent des redirections. Les plans de production ont retrouvé exactement les mêmes empreintes d’état initial que la répétition complète. La sauvegarde préalable restaurée et vérifiée porte le SHA-256 `ab72d8d55f1db6a3c809339cd45d3983766981a21e244f8b0fc87dce4c1ccf3a`.

Les noms historiques et leurs anciennes pages aboutissent aux profils canoniques, en 308 pour les pages, y compris l’intelligence. Les instantanés historiques sont conservés ; une consolidation de périmètres n’est pas présentée comme une croissance des recrutements.

## Causes encore à traiter

**Bizzbee / BZB.** Le site officiel annonce le changement de nom. Les deux feeds archivés portent `hiringOrganization.name=BZB`, le même `sameAs=https://recrutement.b-z-b.com` et 23 identifiants identiques. Le champ employeur était ignoré par Teamtailor au profit du nom configuré. Le blocage actuel vient du **garde applicatif de réparation**, pas d’un index SQL unique : cet index a déjà été remplacé par un index ordinaire. La répétition déclenche ce garde et annule toute écriture. Le traitement requis est une consolidation conjointe des employeurs et des offres prouvées identiques : conserver tous les anciens IDs et événements, toutes les représentations, rediriger les anciennes URLs d’offre et ne compter qu’une fois chaque poste. Ne pas lancer une réconciliation globale non revue pour contourner ce garde.

**Extraction native de l’identité.** TalentView conserve `entity.name` et Teamtailor `_jobposting.hiringOrganization.name`, mais ces champs n’étaient pas transmis au journal d’identité. Un complément de code les transmet maintenant avant la normalisation. Une entité TalentView peut être une unité opérationnelle : elle passe par les alias revus et ne devient pas automatiquement une nouvelle entreprise. Sur les 53 offres Promod relues à l’API officielle, `Promod` et `Promod - magasin` donnent le même ID revu. Le rejeu d’un RAW réel Bizzbee expose BZB et requiert la décision conjointe ci-dessus. Ce complément suit sa propre PR et validation de déploiement.

**Revue du catalogue.** Après les trois fusions : 415 paires candidates, dont 48 avec des actives des deux côtés ; ce ne sont pas 415 doublons prouvés. Foot Locker/Kids Foot Locker, groupe Prada/marque Prada, Dior Couture/Parfums Dior illustrent pourquoi un domaine partagé ne suffit pas. Il reste 1 528 racines au type historique UNKNOWN et 159 relations parent purement textuelles. Douze racines ont une décision directement référencée par le nouveau champ de revue ; ce compteur décrit le registre actuel, pas l’inexistence de preuves publiques pour les autres.

## Priorités pour clôturer ce lot

1. Consolider Bizzbee/BZB avec preuve de chaque poste et conservation des anciennes URLs ; retirer le doublon de portail sans perdre les observations.
2. Examiner les autres paires actives en priorité, puis les anciennes fiches ; enregistrer aussi les décisions « entités distinctes » et leurs preuves.
3. Compléter types et liens de groupe avec les documents officiels. Séparer une Maison, une enseigne, un groupe, une entité légale, un ATS et une source.
4. Étendre l’extraction RAW documentée aux autres adaptateurs, mesurer les décisions d’identité manquantes avant reprise massive.
5. Valider les parcours Workday et un cycle complet d’exploitation ; garder la réserve de validation du Lot 0 sur le cycle complet.

Tests du complément : 1 465 tests unitaires agrégateur, 219 intégrations, vérifications de types des deux applications ; la CI couvre également le build et les E2E web. Les crons massifs restent en pause.
