# D-520 §3 — explicabilité des offres : état d'exposition et `pourquoi-offre`

Mesures en **lecture seule** de la production, le 02/10/2026 entre 14:16 et 14:32 UTC (hors fenêtre du RUN), par
`apps/aggregator/scripts/ops/db.py readonly`. Les commandes `pourquoi-offre` lisent dans une transaction `READ ONLY` :
Postgres refuse toute écriture de la session, et aucune `PipelineRun` n'est ouverte.

**Schéma de production** : révision `9534573` (r5). Ni `JobSource.availabilityHold` ni `publisherClosedAt` (migration
`20261002140000`, livrée avec r6). Le lecteur les lit comme absents : aucune offre masquée par R-143 §2, aucune fin par
autorité, exactement ce que sert aujourd'hui la recherche de production. Les états MASQUEE, ABSORBEE (0 fusion en
production) et PAR_AUTORITE n'existent donc pas encore en production : ils sont prouvés sur la base de test
(`src/pipeline/offerExposure.operational.test.ts`).

## Fichiers

| Fichier | Contenu |
|---|---|
| `01-premisses.sql` / `.out` | Prémisses : 95 779 offres, 0 fusion, 0 publication en quarantaine, 93 offres actives sans représentation disponible (échues), 3 retraits OUT_OF_SCOPE. |
| `02-fermees.sql` / `.out` | Les 5 883 fermées : 806 portent une échéance atteinte, 5 077 non ; aucune n'a de représentation encore active (pas de fin par autorité). |
| `03-echantillon-20-par-etat.txt` | `pourquoi-offre --echantillon=20` (graine 20261002) : 103 parcours complets, 20 par état et cause présents (3 pour la retenue). |
| `04-repartition-production.txt` / `.json` | `pourquoi-offre --repartition --par-marche` (le JSON est celui que lirait le back-office). |
| `05-maison-marche.txt` | Hermès, France, Swatch Group. |
| `06-sans-pays.sql` / `.out` | Les offres servies sans pays, par source. |
| `verifier-exposition-production.mts` | L'état EXPOSEE contre le prédicat que la recherche de production exécute (copié de `9534573:packages/db/availability.ts`). Après r6 : `pourquoi-offre --verifier`. |

## Répartition (production, 14:23 UTC)

| État / cause | Offres |
|---|---:|
| EXPOSEE / CONFIRMEE | 85 223 |
| FERMEE / PAR_LA_SOURCE | 5 077 |
| FERMEE / PAR_ECHEANCE | 899 (806 fermées + 93 actives échues, que le prochain refresh fermera) |
| HORS_MARCHE / SANS_PAYS | 3 217 |
| HORS_MARCHE / PAYS_HORS_MARCHE | 1 360 |
| RETENUE_PAR_REGLE / CANDIDATURE_SPONTANEE | 3 |
| **INEXPLIQUEE / SANS_CAUSE** | **0** |
| Total | 95 779 |

## Exposée = ce que sert la recherche

`verifier-exposition-production.mts` à 14:23:39 UTC : 85 223 offres EXPOSEE, 85 223 servies par le prédicat de la
recherche de production dans un pays de marché ouvert, **0 exposée non servie, 0 servie non exposée**. L'API de
production n'a pas été interrogée (clé d'accès) : la comparaison porte sur le prédicat exact qu'elle exécute
(`job-search-query.ts`, `compterPerimetre` et `sqlBase` : `publicJobSql` et `countryCode IN` les pays du marché).

## Relecture à la main (103 parcours, `03-echantillon-20-par-etat.txt`)

- **EXPOSEE (20)** : chacune a une représentation active, non échue, un pays de marché ; 1 offre à deux représentations
  (`lvmh` et `tiffany-oracle`, même identifiant 62808), regroupée à l'écriture. Juste.
- **FERMEE / PAR_LA_SOURCE (20)** : toutes les représentations inactives, aucune échéance ; la source a été relue après
  la dernière observation (fermeture par absence de la liste prouvée). Juste.
- **FERMEE / PAR_ECHEANCE (20)** : échéance déclarée atteinte, avant ou au plus à la date de fermeture ; une échue est
  encore active en base (`2 stages - Visual Merchandising`, échéance 02/10 12:00) : la recherche ne la sert plus, le
  refresh la fermera. Juste.
- **HORS_MARCHE / PAYS_HORS_MARCHE (20)** : Inde, Lituanie, Kazakhstan, Macao, Bulgarie, Kenya, Indonésie, Colombie.
  Juste.
- **HORS_MARCHE / SANS_PAYS (20)** : juste au sens de l'état (aucun pays en base), mais **20 sur 20 nomment une ville
  dont le pays est certain** (Wakefield, Manchester, Nashville, Vanves, Misterbianco, Rio de Janeiro, Arnotts à Dublin).
  Voir l'écart 1.
- **RETENUE_PAR_REGLE (3)** : « Initiativbewerbung Deutschland », « WIR SUCHEN DICH! - Initiativbewerbung Ausbildung »,
  « Unsolicited application Headquarters » (Swatch Group et Marc O'Polo), retenue `NATIVE_SPONTANEOUS_APPLICATION`.
  Juste.

Aucune offre classée à tort sur les 103.

## Écarts trouvés

1. **3 217 offres servies sans pays**, atteignables par leur seul lien, jamais par une recherche de marché : Boots
   1 973 (villes britanniques), On Running 199, Brown Thomas 99, Lagardère Travel Retail 79, Brilliant Earth 76… C'est
   un défaut de canonisation du lieu (le pays n'est pas lu alors que la ville le donne), antérieur à ce lot, que
   l'explicabilité rend visible ; non corrigé ici.
2. Les 93 offres actives échues restent actives en base jusqu'au refresh : l'état les dit fermées (la recherche ne les
   sert plus).
3. Les offres directes Catwalks (`DirectOffer`) ont leur propre cycle et ne sont pas classées par cet état.
