# D-520 §3 — explicabilité des offres : état d'exposition et `pourquoi-offre`

Mesures en **lecture seule** de la production, le 02/10/2026 entre 14:16 et 14:56 UTC (hors fenêtre du RUN), par
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
| `03-echantillon-20-par-etat.txt` | `pourquoi-offre --echantillon=20` (graine 20261002) : 124 parcours complets, 20 par cause présente. |
| `04-repartition-production.txt` / `.json` | `pourquoi-offre --repartition --par-marche` (le JSON est celui que lirait le back-office). |
| `05-maison-marche.txt` | Hermès, France, Swatch Group. |
| `06-sans-pays.sql` / `.out` | Les offres servies sans pays, par source. |
| `07-verification-production.json` | Sortie de la vérification ci-dessous. |
| `08-retenues-collecte.out` | Publications retenues dès la collecte, jamais publiées, par motif. |
| `09-exemple-pourquoi-offre.txt` | Un parcours complet. |
| `verifier-exposition-production.mts` | L'état EXPOSEE contre le prédicat que la recherche de production exécute (copié de `9534573:packages/db/availability.ts`). Après r6 : `pourquoi-offre --verifier`. |

## Répartition (production, 14:55 UTC, après les correctifs de l'audit)

| État / cause | Offres |
|---|---:|
| EXPOSEE / CONFIRMEE | 85 147 |
| EXPOSEE / PAYS_SEUL (pays connu sans marché ouvert, que `/emplois` sert seul) | 1 359 |
| EXPOSEE / SOURCE_EN_PAUSE | 76 |
| FERMEE / PAR_LA_SOURCE | 5 077 |
| FERMEE / PAR_ECHEANCE | 899 (806 fermées + 93 actives échues, que le prochain refresh fermera) |
| HORS_MARCHE / SANS_PAYS | 3 217 |
| HORS_MARCHE / PAYS_INCONNU (XK, hors de la liste des pays connus) | 1 |
| RETENUE_PAR_REGLE / CANDIDATURE_SPONTANEE | 3 |
| **INEXPLIQUEE / SANS_CAUSE** | **0** |
| Total | 95 779 |

Publications retenues dès la collecte, jamais devenues des offres (dernière retenue par publication, `08-retenues-collecte.out`) :
identité en revue (Workday, employeur absent de l'annonce) 2 629, fermées par la source 72, preuve de la source
(description vide, test, événement) 45, candidatures spontanées 3, **à instruire 2** (`JSONLD_EMPLOYER_NOT_RESOLVED`,
alberto, 23/09 : motif que le RUN tient aussi pour bloquant).

## Exposée = ce que sert la recherche

`07-verification-production.json` (14:53 UTC) : 86 582 offres EXPOSEE, 86 582 au prédicat de la recherche de production
dans un pays qu'elle atteint (marché ouvert, ou pays connu servi seul par `perimetreDeRecherche`) : **0 exposée non
servie, 0 servie non exposée** ; les 3 218 autres offres au prédicat public sont toutes HORS_MARCHE (sans pays, ou XK).
L'API de production n'a pas été interrogée (clé d'accès) : la comparaison porte sur le prédicat exact qu'elle exécute
(`job-search-query.ts` : `publicJobSql` et `countryCode IN` les pays du périmètre).

## Relecture à la main (`03-echantillon-20-par-etat.txt`, graine 20261002 : 124 parcours, 20 par cause présente)

- **EXPOSEE / CONFIRMEE** : chacune a une représentation active, non échue, un pays de marché ; une offre porte deux
  représentations (`lvmh` et `tiffany-oracle`, identifiant 62808), regroupées à l'écriture. Juste.
- **EXPOSEE / PAYS_SEUL** : Lituanie, Inde, Slovaquie, Argentine, Aruba, Bulgarie, Colombie, Égypte, Croatie, Indonésie, Israël (3 sans ville) ; chacun atteint par la recherche de son seul pays. Juste.
- **EXPOSEE / SOURCE_EN_PAUSE** : Versace 10 (site hors service, D-506), fastrack 6, sioux 4 : servies telles que vues en
  dernier, comme D-485, D-493 et D-506 l'ont décidé. Juste au regard des décisions ; voir l'écart 4.
- **FERMEE / PAR_LA_SOURCE** : toutes les représentations inactives, aucune échéance ; la source a été relue après la
  dernière observation. Juste.
- **FERMEE / PAR_ECHEANCE** : échéance déclarée atteinte, avant ou au plus à la date de fermeture ; une échue encore
  active en base (`2 stages - Visual Merchandising`, échéance 02/10 12:00) : la recherche ne la sert plus. Juste.
- **HORS_MARCHE / SANS_PAYS** : juste au sens de l'état, mais **20 sur 20 nomment une ville dont le pays est certain**
  (Wakefield, Manchester, Nashville, Vanves, Misterbianco, Rio de Janeiro, Arnotts à Dublin). Écart 1.
- **HORS_MARCHE / PAYS_INCONNU** (1) : Pristina (XK), absent de la liste des pays connus. Juste.
- **RETENUE_PAR_REGLE** (3) : « Initiativbewerbung Deutschland », « WIR SUCHEN DICH! - Initiativbewerbung
  Ausbildung », « Unsolicited application Headquarters », retenue `NATIVE_SPONTANEOUS_APPLICATION`. Juste.

Aucune offre classée à tort.

## Audit (un tour, deux lectures adverses : technique, réconciliation)

Corrigés : EXPOSEE ne couvrait pas le pays connu servi seul par la recherche (CRITICAL) et le témoin ne pouvait pas le
voir (HIGH) : la liste des pays connus est partagée (`packages/db/iso-alpha2.ts`), le témoin compare à tout le
prédicat public ; trajectoires fausses (HIGH) : une classe par cause (servie, revient seule, à réparer, sur décision,
rien), vérifiée contre `upsert.ts` et `refresh.ts` (seul ATTESTATION_MISSING se rouvre), la pause et le masquage non
livré sur la base lue en tiennent compte ; la pause rangée en silence (HIGH) : cause SOURCE_EN_PAUSE ; « 0 sans
cause » sur les seules offres (HIGH) : les publications retenues dès la collecte sont classées et comptées.

## Écarts connus

1. **3 217 offres servies sans pays**, atteignables par leur seul lien, jamais par une recherche : Boots 1 973 (villes
   britanniques), On Running 199, Brown Thomas 99, Lagardère Travel Retail 79, Brilliant Earth 76 (`06-sans-pays.out`).
   Défaut de canonisation du lieu, antérieur à ce lot ; trajectoire « à réparer ».
2. Les 93 offres actives échues restent actives en base jusqu'au refresh ; l'état les dit fermées.
3. Les offres directes Catwalks (`DirectOffer`) ont leur propre cycle et ne sont pas classées.
4. Pause : la demande citait « non publiable : source en pause » ; les décisions D-485, D-493, D-506 gardent ces
   offres servies. L'état suit les décisions (EXPOSEE / SOURCE_EN_PAUSE, 76 offres) ; les masquer serait une décision
   produit.
5. MEDIUM et LOW non corrigés : le bulletin de couverture classe ATTESTATION_MISSING, SOURCE_RETIRED et
   IDENTITY_CONTRADICTED sous d'autres noms (une seule table à faire) ; le JSON n'a pas encore de lecteur au
   back-office ni de photographie ; les retenues de collecte d'une offre encore active ne sont pas lues ; la rubrique
   « collecte » montre la dernière écriture, pas la dernière lecture ; `01-premisses.out` garde une requête en erreur
   (refaite dans `02-fermees.sql`).
