# Lot 4A — identité native et suppression des rapprochements par similarité

**Sous-lot validé localement le 15 septembre 2026. Le lot 4 complet reste en cours : reprise, séparation historique et réversibilité à terminer. Aucune bascule de production.**

## Résultat

Le parcours d’écriture ne regroupe plus des annonces en fonction de leur titre, ville, famille métier ou proximité de date. Une publication garde son identité source / identifiant externe. Un rapprochement automatique entre sources nécessite une identité de candidature qualifiée, corroborée par les champs du RAW de chacune des publications. Le [contrat maintenu](../../docs/architecture/publication-identity.md) décrit les chemins lus et les limites.

Une traduction ou un changement de ville n’empêche plus un rapprochement prouvé. À l’inverse, deux titres identiques ou Sales Advisor / Beauty Advisor restent distincts sans preuve native. Plusieurs groupes candidats ne déclenchent pas le choix arbitraire du premier. Les témoins manquants et les groupes ambigus demandent une revue.

La réattestation vérifie à nouveau la cohérence d’un groupe, y compris les chemins d’une décision manuelle. Si la preuve change, l’écriture du groupe est refusée et la capture reçue reste conservée. Cette garde impose de reprendre les groupes historiques avant le déploiement du parcours complet.

## Modèle et nettoyage

- PostgreSQL interdit de modifier `JobSource.id`, `sourceKey` et `externalId`.
- Le journal `PublicationIdentityDecision` garde les rapprochements et déplacements, leurs empreintes et références de preuve. Il est immuable ; il prépare les corrections compensatrices de la suite du lot.
- Le rapprochement manuel exige un témoin de chaque publication impliquée, même lorsqu’elle appartient déjà à un groupe. Des identités contradictoires ne peuvent converger vers le même groupe cible.
- Une réparation d’employeur conserve les annonces de deux tenants portant le même ID ATS. L’ancienne collision sur famille ATS / identifiant a été supprimée.
- Les clés de regroupement ne dépendent plus d’un nom d’employeur ou d’une ville. Les corrections d’employeur ne réécrivent plus ces clés par substitution de préfixe.
- Les écritures rattachées à une capture vérifient aussi le RAW et l’URL contre la sortie archivée, au-delà du contrôle des seuls identifiants de capture.
- Suppression de Jaccard, des concepts de rôle utilisés pour fusionner, du seuil de 45 jours et des helpers de clustering sans appelant.
- Suppression de `applyDomainSheet`, `separateFused`, de leurs tests devenus obsolètes et de leurs commandes CLI. Les corrections revues d’employeurs restent disponibles ; le nouveau parcours de séparation historique est la suite du lot 4.

Trois anciens tests exigeaient une fusion à partir de titres proches sans aucune identité native commune. Leurs attentes ont été corrigées : ils vérifient désormais la conservation des deux publications. Les tests positifs de rapprochement utilisent une identité explicite et son RAW.

Le scénario de relais après expiration crée également ses deux publications par l’ingestion avec une preuve RAW commune. Il n’insère plus directement un groupe sans preuve pour contourner le parcours testé.

## Mesure du stock historique

| Mesure sur le snapshot conservé | Résultat |
|---|---:|
| Représentations actives examinées dans le stock | 85 327 |
| Groupes avec plusieurs sources | 1 888 |
| Groupes existants dont toutes les publications ont une preuve RAW compatible dans les formats qualifiés | 455 |
| Groupes nécessitant encore une revue | 1 433 |
| Représentations dans ces groupes à revoir | 2 874 |
| Identités d’URL qualifiées communes à plusieurs sources | 461 |
| Représentations de ces 461 identités | 922 |
| Dont identifiant ou URL retrouvé dans le RAW conservé | 920 |
| Ensembles sans preuve RAW complète pour leurs deux côtés | 2 |
| Identités qualifiées encore réparties sur plusieurs Job | 4 |

Les formats mesurés sont Oracle HCM / copies LVMH et JobAffinity. Les 1 433 groupes restants ne sont pas déclarés faux : le stock conservé et les lecteurs qualifiés ne suffisent pas à prouver leur équivalence. Une nouvelle collecte ou une revue de champs natifs peut apporter cette preuve. L’identité de l’employeur reste à vérifier avant chaque reprise historique.

## Validation et audit défensif

La validation complète applique les 53 migrations depuis une base PostgreSQL neuve et exécute les suites unitaires, d’intégration, API et Python. Les compteurs et empreintes exacts sont dans la [preuve de validation](preuves/lot-4a-validation.json). Les contrôles TypeScript, le build API et la comparaison du schéma sont également exécutés.

Huit contre-épreuves retirent successivement la qualification d’identité, la corroboration RAW, la distinction de deux IDs d’une même source, le contrôle de chaque membre, la vérification du groupe à la réattestation, le journal de rapprochement, la liaison RAW/URL à la capture et le témoin obligatoire de chaque publication en réparation manuelle. Chaque défaut fait échouer une assertion ciblée. Les fichiers sont restaurés exactement et les suites concernées repassent.

Les tests couvrent aussi les arrivées concurrentes, les changements de ville, les tenants distincts, les groupes ambigus, les domaines ressemblants, les décisions immuables, la conservation des IDs et le refus d’une ancienne approbation lorsque son RAW change.

## Suite obligatoire du lot 4

Les groupes historiques n’ont pas été séparés en production. Les anciennes clés n’ont pas été recalculées à distance. Le moteur de réparation doit encore produire des plans bornés, reconstruire chaque présentation depuis sa publication propre, préserver les anciennes URLs et permettre une séparation ou restauration journalisée. Le filtre par marché et les deux origines de recherche restent les lots suivants.

Les 86 fichiers de travail préexistants restent préservés. Website, backend et media restent locaux. Aucun push, déploiement ou changement de cron n’a été exécuté pendant ce sous-lot.

## Preuves

- [Validation, schéma et journaux](preuves/lot-4a-validation.json)
- [Groupes du corpus et exemples d’identités natives](preuves/lot-4a-corpus.json)
- [Corroboration dans les chemins RAW](preuves/lot-4a-native-corroboration.json)
- [Contre-épreuves](preuves/lot-4a-counterproofs.json)
- [Préservation des travaux préexistants](preuves/lot-4a-preservation.json)
