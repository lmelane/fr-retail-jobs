# D-520 §2 — registre explicite des sources (02/10/2026)

Mesures en lecture seule de la production (`db.py readonly`, 14:12-14:20 UTC), rejouables : `mesure-registre.sql`,
`mesure-preuves-hors-service.sql`, `mesure-recouvrements.sql`, `mesure-maisons-servies.sql`. Le fichier relu
`registre-explicite-2026-10-02.json` (et son `.csv`) est construit hors réseau par `construire-registre.py`.

## Combien de sources avons-nous réellement ?

| Lecture | Nombre |
|---|---:|
| Lignes du registre (toute clé jamais créée ; un retrait ne supprime rien) | 543 |
| Sources collectées (ACTIVE) | 412 |
| dont WTTJ (`wttj-sector`, `madame-figaro`), seul job board admis (R-142 §1) | 2 |
| dont portails d'employeurs ou de groupes | 410 |
| ACTIVE qui servent au moins une offre (89 803 offres, 1 051 sociétés) | 407 |
| ACTIVE sans offre servie (cove, loplabbet, fjallraven, margaret-howell à 0 lue ; l-oreal-professionnel BROKEN) | 5 |
| DRAFT ou VALIDATED | 0 |
| Non ACTIVE (14 PAUSED, 117 RETIRED) | 131 |
| dont canaux couverts par une autre source active (35 collecteurs WTTJ, urbn-stores, b2, bizzbee, dr-jart-13) | 39 |

**Doublons de tenant.** Aucun au sens strict (`tenantKey` est unique). 30 sources ACTIVE se partagent 6 tenants
Workday (sites distincts : Fast Retailing 18, Knitwell 4, Capri, VF, Nike, Richemont 2 chacun). Le recouvrement
mesuré sur les offres servies isole **un doublon de fait** : `richemont` (site `broadbean_external`) porte 466 de ses
523 offres aussi sur `richemont-workday` (89 %). Deux autres recouvrements sont des portails distincts qui listent les
mêmes postes : `lvmh` / `tiffany-oracle` (443 sur 473) et `intersport-france` / `blackstore` (42 sur 61). Le
dédoublonnage les sert une seule fois.

**Maisons servies par plusieurs sources** : 49 sociétés, surtout un groupe et sa marque (Richemont 15 Maisons,
Knitwell 8) ou WTTJ et le portail direct (13). Ce n'est pas un doublon : une offre n'est servie qu'une fois.

**Lecture juste** : 412 sources collectées, dont 1 doublon de fait à instruire (`richemont`), 5 qui ne servent
rien ; 131 sources hors service, dont 39 sont des doublons déjà couverts.

## Les 131 sources non ACTIVE, par intention et trajectoire

| Intention | Trajectoire | Sources | Fondement |
|---|---|---:|---|
| COLLECTER | A_REPARER | 13 | 1 décision (Ralph Lauren, D-483, D-516) ; 12 sans décision |
| COLLECTER | REVIENT_SEULE | 1 | Versace, D-506 §1 |
| COUVERTE_AILLEURS | EXCLUE_PAR_DECISION | 39 | 35 D39 et R-142 §1 (WTTJ) ; 4 R-143 §4 (doublons prouvés) |
| NE_PAS_COLLECTER | EXCLUE_PAR_DECISION | 68 | 8 décisions (D-453, D-477, R-142, décisions de Loïc des 08 et 10/09, D-481) ; 60 sur preuve seule |
| A_TRANCHER | REVUE_HUMAINE | 10 | sans décision, question écrite |

Une seule source change d'état : `miu-miu` (PAUSED → RETIRED). Sa capture native du 24/09 identifie une université
égyptienne (MIU), dont 7 offres sont servies sous « Miu Miu ».

## Application

```
python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/src/cli.ts registry-review \
  --decisions=audits/2026-10-02/registre-explicite/registre-explicite-2026-10-02.json --output=<aperçu.json>
# relire l'aperçu (refused doit être vide), puis :
python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/src/cli.ts registry-review --apply --plan=<aperçu.json>
```

Avec la release, après la migration `20261002200000_registre_explicite` et jamais pendant le RUN de 18 h.
L'application refuse si l'aperçu a changé (REVIEWED_PLAN_MISMATCH) ou si une source non ACTIVE manque au fichier
(REVIEWED_PLAN_REFUSED, NOT_IN_PLAN).
