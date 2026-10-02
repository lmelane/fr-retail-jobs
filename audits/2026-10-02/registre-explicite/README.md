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

Trajectoires : le vocabulaire unique de `apps/aggregator/src/pipeline/sourceState.ts` (AUTO, A_REPARER, REVUE_HUMAINE,
DECISION). Le fondement est un champ distinct : DECISION (CEO ou Loïc, datée), REGLE (règle validée ou cadrage de Loïc :
R-142, R-143 §4, D58), PREUVE (aucune décision : l'état repose sur une preuve seule). Une exclusion exclut une source,
jamais une Maison.

| Intention | Trajectoire | Sources | Fondement |
|---|---|---:|---|
| COLLECTER | A_REPARER | 16 | 2 décisions (Ralph Lauren D-483 et D-516 ; Versace D-506 §1) ; 2 règles (miu-miu, army-logic) ; 12 sans décision |
| COUVERTE_AILLEURS | DECISION (source exclue, doublon) | 39 | règle R-143 §4 (35 collecteurs WTTJ, urbn-stores, bizzbee, dr-jart-13) ou D58 (b2) |
| NE_PAS_COLLECTER | DECISION (source exclue) | 76 | 17 décisions (D37, D38, D-453, D-477, Loïc 08 et 10/09) ; 55 règles (D58, R-142 §1) ; 4 sans décision (démonstrations) |
| A_TRANCHER | REVUE_HUMAINE | 0 | |

**Sans décision qui justifie l'état (fondement PREUVE, 16)** : 11 pauses de la revue du 23/09 (sioux, ghost, nimble,
rotate, minimalist, cotton-on, de-beers-london, dim, fastrack, markham, oniverse), le-slip-francais, et 4 portails de
démonstration (ganni, jako, lindex, sport-1).

**Masquage des pauses (R-143 §2)** : seule une pause posée par une décision (fondement DECISION) garde ses offres
servies hors du plafond de 72 h ; une pause sans décision le suit. À blanc le 02/10 (`pauses-masquage-2026-10-02.json`) :
Sioux 19 et Fastrack 15 offres non revues depuis le 18-19/09 sortiraient ; Versace (pause décidée, D-506 §1) garde ses
49 offres ; miu-miu (7) sort par son retrait.

**Changements d'état** : un seul, `miu-miu` (PAUSED → RETIRED). Sa capture native du 24/09 identifie une université
égyptienne (MIU), dont 7 offres sont servies sous « Miu Miu ». `retire-source` ne détruit aucune donnée (R-142 §2).

**Les 10 Maisons WTTJ de 3 offres ou moins** (sous le plancher de l'alerte de couverture) sont toutes servies par
`wttj-sector` le 02/10 (`wttj-petites-maisons-2026-10-02.json`) ; réexamen à la main le 16/10.

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
