# Validation finale — contrôles qui exigent une lecture actuelle des sources ou une ingestion bornée

Tout le reste du LOT 4 se traite sur les preuves archivées. Les contrôles ci-dessous sont les **seuls** à nécessiter le réseau ou une exécution en production ; ils sont regroupés pour être joués en un nombre minimal de passes, jamais en relances exploratoires. Crons gelés jusque-là (D57).

## A. Lectures actuelles (sondes locales, lecture seule, sans base) — une passe par famille

| # | Contrôle | Sources | Pourquoi une lecture actuelle | Critère |
|---|---|---|---|---|
| A1 | Re-sonder les sources dont la configuration a changé depuis le dernier reçu | 69 sources sans reçu pour la configuration courante (`tracker-v7`, `receiptForCurrentConfig = false`), dont `aptar-beauty`, `maison-margiela`, les 5 sitemaps | le reçu de preuve est lié à l'empreinte de configuration | reçu complet à la révision courante |
| A2 | Déficits non expliqués DigitalRecruiters | `aigle` 109/110, `gant` 108/112, `lacoste` 452/459 | reçus antérieurs à la preuve de diffusion (PR 58) | écart nul ou cause nommée |
| A3 | Workday après le correctif « Logo » | `richemont-workday`, `richemont`, `a-derma-4`, `deckers` | le libellé nettoyé n'est observable qu'en relisant le détail | plus aucun refus « X Logo » au rejeu hors ligne |
| A4 | Oniverse : 14 pages en échec de lecture | `oniverse` | échecs réseau ponctuels (hôte lent) | 734 pages lues, rejets expliqués seulement |
| A5 | Sitemaps trouvés mais non prouvés en prod | `alberto`, `bevilles-jewellers`, `oska`, `psycho-bunny` | reçu de sonde manquant pour la configuration sitemap (le run de prod du 20:26 est le seul témoin) | reçu complet |
| A6 | Portails candidats retenus par la revue métier | parmi les 126 tenants lisibles, ceux que Loïc valide | qualification technique déjà faite ; une relecture avant activation seulement | reçu complet + identité certifiée |

## B. Ingestions bornées (egress de la prod, protocole : commande bornée → exécution → attente de la fin réelle → restauration ; jamais pendant un merge)

| # | Contrôle | Sources | Ce qu'on prouve | Préalable |
|---|---|---|---|---|
| B1 | Création débloquée après le lot d'alias v2 | `ulta-jibe`, `nike`, `nike-nke2`, `normal`, `therealreal`, `swarovski`, `uniqlo-stores`, … (sources des règles A/B) | 0 refus d'identité, nouvelles annonces créées | lot v2 appliqué |
| B2 | Kering : Maison conservée quand le flux omet la Maison | `kering` | 0 refus, observations `GROUP_LABEL_KEPT_HOUSE`, autres champs mis à jour | PR 68 déployée |
| B3 | URBN sous-libellés | `urbn-hub` | 174 offres créditées à FP Movement / Anthro Weddings / Maeve, 0 refus | revue v2 appliquée |
| B4 | Workday périmètre certifié | `mango` (si certifié `SINGLE_BRAND`) | 27 annonces retenues publiées avec provenance `portal.certifiedScope` | certification avec périmètre |
| B5 | Lignes rejetées ≠ erreurs | `alberto`, `nordstrom`, `mango`, `oniverse` | statuts OK / droit d'attester rétabli, purge possible | PR 67 (déployée) |
| B6 | **Passe complète contrôlée** (toutes les sources actives, une fois) | 413 sources | réconciliation source → pipeline → base → API → front ; ferme les 85 + n représentations non ré-attestées via le refresh **après** la passe | tous les lots ci-dessus, tracker à jour, feu vert de Loïc |

## C. Contrôles publics (site, cache contourné) — après B6

| # | Contrôle | Périmètre |
|---|---|---|
| C1 | Parité base ↔ `/api/jobs` ↔ page par Maison | toutes les Maisons touchées par les lots (URBN ×10, Lindex, OTB/Aptar, Personio, Capri, Mango, Nordstrom, Oniverse, Psycho Bunny, Oska, Bevilles, Alberto) puis échantillon aléatoire de 50 Maisons |
| C2 | 410 des offres fermées par le refresh, 200 des actives, 404 des inexistantes | échantillon de 30 offres par état |
| C3 | Logos des nouvelles Maisons (route `/api/logo`) | 6 marques URBN + 3 sous-libellés + Oniverse, Psycho Bunny, Oska, Bevilles |

## D. Hors réseau, à faire avant B6

- Décisions de Loïc : URBN Reclectic / Menus & Venues (périmètre), Kering K1 (si la propriété reste absente), Mango `SINGLE_BRAND` (certification), Aptar (options §6 du dossier décisions), revue des 24 libellés `OWNER_REVIEW`, revue des 126 tenants candidats, 212 marques de portefeuille.
- Certification d'identité des sources legacy par famille, à partir des observations existantes et des pages officielles archivées (sans réseau quand la page est déjà archivée).
