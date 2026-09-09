# Tracker de qualification — sept verdicts séparés (2026-09-09, 16:42 UTC)

Le tracker précédent (`compose-inventory.py`) remettait `identityConfirmed:false` et `newSourceActivated:false` sur toutes les lignes et n'exportait qu'un statut de recherche. Il donnait l'impression fausse que Sandro, Maje, Claudie Pierlot ou Coty n'étaient pas attestées, alors que leurs revues d'identité existent en base depuis le lot 1. Il confondait aussi « flux complet » et « couverture ».

`qualify-tracker.py` (dans `apps/aggregator/src/coverage/`) sépare désormais, pour chacun des **1 653 acteurs FashionJobs** et chacune des **503 sources** :

| Dimension | Ce qui la prouve | Ce qui ne la prouve jamais |
|---|---|---|
| Correspondance FashionJobs | alias revu (`CompanyAlias.reviewId`) ou candidat de nom exact | — |
| Identité canonique attestée | `EmployerIdentityReview` de la société, ou `SourceIdentityReview` VERIFIED dont le hash couvre la **configuration courante** (âge ≤ 30 j) | une recherche de portail, complète ou non |
| Portail officiel confirmé | une revue vérifiée par lien/domaine officiel | un candidat ATS détecté sur une page |
| Recherche de portail | passes datées : pages, échecs, URLs non visitées | — (elle produit des candidats, jamais une absence) |
| Certification de la source | hash de revue = hash courant, sujet identique, non périmée | une source ACTIVE héritée du CSV |
| Activation réelle | statut de catalogue + dernier run | une certification |
| Complétude du flux configuré | dernier reçu natif ou dernier run de production | — |
| Couverture mondiale | rien encore : **NOT_PROVEN** partout | un flux complet |

Le `snapshot.mts` calcule `identityHash` et `subjectKey` avec les fonctions de la porte de promotion : la comparaison revue ↔ configuration est la même qu'au moment de promouvoir.

## Avant → après, sur les données réelles

Photographie de production en lecture seule du 2026-09-09 16:42 UTC (77 447 offres, 74 198 actives, 10 957 France, hash d'identifiants `e88d2de6…`).

| Mesure | Tracker précédent (17:02, 9 sept.) | Tracker v3 |
|---|---:|---:|
| Acteurs | 1 653 | 1 653 |
| Identité certifiée affichée | 0 (« Non » partout) | **14 attestées** (Adopt Parfums, Aubade, Blackstore, BZB, Claudie Pierlot, Coty, Fusalp, Fursac, Intersport, Maje, Promod, RIU Paris, Sandro, Toscane) |
| Correspondance par alias revu | non mesurée | 14 · candidats de nom 617 · aucun candidat 1 022 |
| Portail officiel confirmé | non mesuré | **6** · candidats seulement 281 · liens carrière à qualifier 96 · rien observé 1 270 |
| Recherche de portail | 1 096 profil seul · 181 portail à chercher · 278 ATS candidats · 98 liens | 1 247 site à chercher · 128 aucun lien sur les pages lues · 201 ATS candidats · 74 liens · 3 interrompues |
| URLs inventoriées non visitées | non exportées | **2 614 sur 137 acteurs** |
| Acteurs avec échecs documentés | non exportés | 175 |
| Activation | « Non » partout | source active 238 · seulement pausée/retirée 273 · aucune source 1 142 |
| Complétude des flux actifs de l'acteur | non mesurée | tous complets 190 · au moins un partiel 48 |
| Couverture mondiale | confondue avec la recherche | NOT_PROVEN 1 653 |

Les statuts de recherche ne sont pas comparables terme à terme : le v3 lit le statut de la **dernière passe** au lieu d'en dériver un ; la passe `portal-unvisited` (239 acteurs terminés) est intégrée.

## Sources (503)

| Mesure | Valeur |
|---|---:|
| ACTIVE · PAUSED · RETIRED | 423 · 8 · 72 |
| Configuration courante certifiée (`CERTIFIED_CURRENT`) | **10** (adopt-parfums, blackstore, escada-parfums-16, ganni-talentrecruiter, intersport-france, jean-paul-gaultier-5, lindex-easycruit, riu-paris, saltrock-harri, toscane) |
| ACTIVE héritées sans revue (`LEGACY_UNCERTIFIED`) | **413** |
| Revue périmée ou pour une configuration remplacée | 0 |
| Flux configuré énuméré complètement (dernière preuve) | 359 actives · 64 partielles ou non prouvées |
| Avec au moins un reçu natif | 425 |

**Réconciliation avec la baseline « 385/423 »** : ce chiffre comptait une source complète dès qu'**un** reçu l'avait dit un jour. Sur la dernière mesure par source, 383 actives ont eu un reçu complet, mais **357 seulement le sont encore au dernier reçu** : 26 sources ont un reçu plus récent partiel ou non prouvé. La baseline reste le dénominateur convenu ; le tracker expose les deux définitions et la liste des 26 (`progress-summary.json`, `activeRegressedSinceCompleteReceipt`), qui rejoignent les dossiers de complétude à instruire.

## Ce que ce tracker ne fait pas

- Il n'écrit rien en base et ne crée aucune certification : 14 attestées et 10 sources certifiées sont les décisions déjà enregistrées, relues telles quelles.
- « Sandro attestée » ne rend pas la source `sandro` certifiée : la société l'est (revue SMCP du lot 1), la configuration de la source ne l'est pas (`LEGACY_UNCERTIFIED`). Les deux colonnes coexistent volontairement.
- 413 sources actives sans revue de configuration sont l'héritage du catalogue CSV. Les certifier une à une est un chantier distinct, à conduire par la porte `SourceIdentityReview`, pas par une passe automatique.

Fichiers : `tracker-v3/fashionjobs-tracker.csv` (22 colonnes, un acteur par ligne, motifs non résolus et action restante), `tracker-v3/sources-qualification.csv` (503 sources), `tracker-v3/progress-summary.json` (avant/après). Les JSON complets, avec chemins de preuves et configurations, restent privés dans `backups/lot4-20260909/tracker-v3/`.
