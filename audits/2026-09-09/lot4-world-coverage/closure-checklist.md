# LOT 4 — checklist de clôture (état au 2026-09-10, ~12:45 UTC)

Deux fins distinctes : **la fin de la passe B6** (sources admissibles activées, ingérées, visibles) et **la fin du lot complet** (critères du brief `brief.md` : discovery mondiale, qualification, intégration, complétude, audit final). Chaque ligne porte un statut — **terminé** (prouvé en production ou par preuve archivée), **restant** (travail identifié, non bloqué), **bloqué** (dépend d'une décision de Loïc, d'un accès ou d'une information externe) — et le nombre de dossiers concernés.

## A. Fondations (préalables à toute généralisation)

| Critère | Statut | Dossiers | Preuve / prochaine action |
|---|---|---:|---|
| Crons gelés, aucun déploiement pendant un run borné | terminé | 3 services | `final-railway-state.py`, garde de déploiement avant chaque merge |
| Porte d'identité : nouvelle orthographe = revue, sauf convergence sur le nom canonique | terminé (PR 75) | — | test d'intégration `identity-gate.test.ts` |
| Preuve employeur = libellé comparé par la porte (logo alt) | terminé (PR 75, L6 : 0 refus) | 4 sources | `qualification-2026-09-10-b.md` §7.2 |
| Workday : plafond du `total`, partition par facette, attribution native | terminé (PR 76, L6/L7) | 1 tenant (Tapestry) | idem ; à généraliser aux tenants > 2 000 (aucun autre mesuré) |
| Décision de périmètre par offre (collecte ≠ publication) | terminé (PR 78, migration posée) | 224 décisions Aptar écrites | preuve de retrait attendue au run L8 |
| Enseigne Workday par code de lieu | terminé (PR 78) | 1 tenant (Saks) | application par revue propriétaire (PR 80 en cours) |
| Divergence des validateurs de certification (strict / tracker / `certifiedPortalScope`) | terminé (PR 81, en cours de merge) | 3 implémentations → 1 contrat | `portalScopeOf` + verdict strict dans la photographie ; tests |
| `SINGLE_BRAND` : tout libellé natif crédité au propriétaire | terminé (PR 81) | règle de porte | un libellé nommant un employeur canonique distinct est refusé ; test d'intégration |
| Reçus anciens / de configuration différente comptés comme preuves | terminé (PR 81) / **restant** : un run de production postérieur à la certification courante doit valoir reçu (Saks, Tapestry) | 3 sources | tracker v10 : reçu non courant ⇒ NOT_PROVEN ; correctif du repli « run de production » à livrer |
| Attestation d'absence par partition (source partitionnée) | **restant** | 1 source (Tapestry : 97 offres dé-listées non fermables) | `attestation.ts` : scope par partition |

## B. Identités et périmètre (dossiers du second brief)

| Dossier | Statut | Nombre | Détail |
|---|---|---:|---|
| Mango : une identité | terminé | 26 fusions, 1 697 offres | lot 3, L5 complet 1 627/1 628 (1 ligne sans identifiant archivée) |
| Tricoci, Printful, Çalık, MaryRuth's | terminé | 4 décisions | lot 2 de périmètre (07:47 UTC) |
| Tapestry : Coach / Kate Spade / Tapestry | terminé | 2 086 offres attribuées, 27 coquilles fusionnées | alias v6, L7, lot coquilles (7 offres inactives déplacées) |
| Saks Global (Exemplar Luxury Group) : groupe + 4 enseignes | terminé | 835 offres actives (NM 420 · SF 189 · groupe 133 · BG 66 · O5 27) | revue 1 621 opérations, re-certification MULTI_BRAND, L9 742/746 complet, 0 refus, parité 5/5 |
| Aptar : décision par offre | terminé | 8 IN · 40 OUT · 176 indéterminées | L8 : 38 retraits OUT_OF_SCOPE, 0 clôture, collecte intacte ; 2 OUT non relistées se ferment au refresh |
| Menus & Venues | **bloqué** (décision Loïc) | 38 offres | recommandation documentée : hors périmètre (restauration), exclusion de publication sans retrait |
| Certifications B1 + volume | terminé | **56 sources actives certifiées** (16 → 45 → 56 : dix sources majeures = 26 697 offres) | verdict strict, tracker v10 |
| Versace, Swarovski | **bloqué** (sites illisibles) | 2 sources | redirections officielles archivées ; il manque le lien officiel → tenant |
| Coquilles d'entités Coach | terminé | 27 sociétés fusionnées dans Coach | historiques conservés, 0 fermeture |

## C. Passe B6 — fin de passe

| Critère | Statut | Nombre | Détail |
|---|---|---:|---|
| Périmètre admissible explicite | terminé (brouillon), **restant** (validation par tenant) | 33 tenants avec lien réciproque archivé | `b6-candidates-sector.md` : IN 28 (3 592 offres), MULTI 1 (VF, 1 267), doublon 1 (Luxexperience/YNAP), OUT 1 (Galderma), REVIEW 2 (KS Groupe, Lagardère TR) |
| Rapprochement du rapport de découverte web avec la BDD | terminé (outil + première passe) | 65 lignes : déjà couvertes 10 · config/attribution 10 · nouveaux acteurs 21 · nouvelle source d'un acteur existant 3 · investigation 21 | `audits/2026-09-10/discovery-web/reconciliation.md` ; catégories du rapport corrigées (Swarovski, Pandora couverts ; Douglas = même portail sous un autre hôte) |
| Certification d'identité des candidats retenus | **restant** | 0 / 33 | méthode B1 sur la page archivée, périmètre par libellés natifs |
| Enregistrement DRAFT → revue → promotion | **restant** | 0 | `registerSourceCandidate`, `SourceIdentityReview`, `promoteSource` |
| Ingestion bornée + chaîne source → BDD → API → front | **restant** | 0 | `run-lot.sh` + `lot-public-check.mts` par lot |
| Doublons évités | terminé pour les cas connus | Luxexperience/YNAP, Browns/Farfetch, Douglas | à recompter à la fin de la passe |

## D. Lot complet — au-delà de B6

| Critère du brief | Statut | Dossiers | Détail |
|---|---|---:|---|
| Discovery mondiale : candidats rapprochés et classés | partiel | 65 rapprochés / 21 en investigation | Japon/Corée/Chine sans ATS structuré : documentés, non activés |
| Qualification des 405 sources actives (identité) | partiel | 45 certifiées / 360 non | priorité par volume (README §5 : dix sources = 26 697 offres) |
| Collecte complète prouvée | partiel | 384 complètes / 11 non prouvées / 10 expliquées (tracker v9, avec la réserve des reçus non courants) | Oniverse (16 pages), Tapestry (résiduel sous plafond), Eightfold second balayage |
| Visibilité front prouvée | partiel | parités par lot 100 % (L1–L7), 0 consolidée dans le tracker | intégrer les parités ; traiter les 640 offres sans source opérante |
| Audit final C1–C3 consolidé | **restant** | — | après la passe B6 |
| Tableau final Acteur × Source (identité · périmètre · collecte · ingestion · visibilité · commit · déployé · réparé · preuves · restant) | **restant** | 405 sources + nouvelles | généré depuis la BDD + preuves, jamais composé |
| Reprise des crons | **bloqué** (décision Loïc, D57) | 3 crons | après audit final |

## Compteurs réels (production, 2026-09-10)

- Offres actives : **75 461** (74 853 au matin) ; sources ACTIVE 405 / PAUSED 8 / RETIRED 90.
- Sources actives certifiées (contrat strict) : **56** ; sans revue : 349 (dont 2 bloquées par accès, Versace et Swarovski).
- Lots bornés du jour : L1–L9 (8 sources de groupe, 18 petits portails, 3 B5, revérifications), **0 échec d'écriture** sur L1, L4, L5, L7 ; refus instruits et résorbés sur L2, L3, L6.
- Décisions de périmètre par offre : 224 (Aptar) écrites, 38 (Menus & Venues) préparées non appliquées.
- Code : PR 74–81 (76, 78, 81 = mécanismes réutilisables : partition par facette, décision par offre, enseigne par code de lieu, contrat unique de certification).
