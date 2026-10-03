# D-523 — zéro offre : vérification du code et mesure à blanc (03/10/2026)

Production en lecture seule (`db.py readonly`, psql, requêtes légères), le 03/10/2026 vers 07:00 UTC, pendant le RUN
d'acceptation de la release r6 (commencé à 06:47:49 UTC) : seules les collectes complètes **antérieures** à ce RUN sont
lues. Rejouable depuis la racine du checkout de référence :

```
python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F"|" -f audits/2026-10-03/d523-zero/mesure-zero.sql'
```

Sortie : `mesure-zero-20261003.out`. Rien n'est écrit en production.

## Sources ACTIVE dont la dernière collecte complète n'a rien publié (412 ACTIVE)

| Classe | Sources | Avant (code `ed333f2`) | Après |
|---|---|---|---|
| Zéro prouvé, total annoncé à 0 | bernadette, chrome, cuyana (Greenhouse) ; cove, fjallraven, klattermusen, loplabbet, margaret-howell (Teamtailor) : **8** | NORMALE, validation VALIDATED ; lues au seul RUN quotidien (aucune nouvelle offre en 7 jours) | NORMALE ; lues aussi à chaque passe de découverte (une requête de liste chacune) |
| Zéro prouvé, liste complète vide sans total | 0 | serait BROKEN « ne rend aucune offre », volume anormal, puis à réparer | NORMALE si rien au dernier run productif ; sinon zéro non prouvé (cas indistinguable, voir plus bas) |
| Zéro non prouvé (lecteur ne voit rien, source muette) | 0 | volume anormal (ANOMALIE_VOLUME), en attente puis à réparer ; sur un lecteur autre qu'Ashby, Teamtailor ou Greenhouse, validation REJETÉE avant même la collecte (qualification refusée, comptée « de notre côté ») | LECTEUR, à réparer côté lecteur, intention et cadence inchangées ; 10 dans un même RUN = panne de lecture |
| Tout ce qui est lu est retenu | lerros (une candidature spontanée, D-511) | EN_ATTENTE, volume anormal | inchangé par ce lot : traité par le lot D-522 §6 en cours (`0bc811c`, non poussé) |
| Échec de collecte | l-oreal-professionnel (HTTP 406, échec connu D-480) | inchangé | inchangé |

Les 8 zéros annoncés sont tous sur Greenhouse ou Teamtailor, deux des trois lecteurs dont la validation savait prouver un
flux vide. Sur tout autre lecteur (Workday, SmartRecruiters, Personio, Lever…), le même zéro annoncé était REJETÉ à la
validation avant la collecte : qualification refusée, escalade à réparer, comptée dans la panne « de notre côté ».

Aucune source ACTIVE n'est aujourd'hui dans un cas que la correction change d'état : la correction est préventive pour les
sources actives, et effective pour la cadence des 8 sources vides.

## Sources en pause ou retirées pour volume nul

Validations natives REJETÉES pour flux vide (`EMPTY_FEED_NOT_NATIVELY_PROVEN`), toutes lecteur générique, du 23/09 :

| Source | Statut | Motif au registre | Pour seul volume nul ? |
|---|---|---|---|
| ghost | PAUSED | la page annonce l'absence d'offres ; pas de protocole de zéro HTML | **oui** |
| sioux | PAUSED | idem ; 19 offres servies non revues depuis le 19/09 | **oui** (le CEO distingue la vraie Sioux, à garder si valide, et une fausse « Sioux Technologies », à retirer : à instruire par le lot D-522 §6) |
| minimalist | PAUSED | candidature spontanée seule, pas de liste | non (pas de liste) |
| nimble, rotate | PAUSED | offres visibles en HTML, le lecteur ne les lit pas | non : défaut du lecteur, précisément le faux zéro que la distinction protège |

Avec la correction, une nouvelle validation de ces cinq sources serait VALIDÉE (flux vide nommé, non prouvé), ce qui ne
retire plus la qualification d'une source déjà ACTIVE. Leur RÉACTIVATION, elle, exige une preuve qu'on sait les lire
(arbitrage du CTO sur la lecture technique) : une offre réellement lue par une qualification de la révision courante, ou
un zéro natif prouvé. Ghost et Sioux n'ont aujourd'hui ni l'un ni l'autre (lecteur générique sans protocole de zéro
HTML) : la campagne rendrait `LECTEUR_A_VERIFIER` et la source resterait en qualification. Leur suite est le protocole de
zéro natif du lecteur générique (lot D-522 §6). La réactivation est une écriture de production, hors de ce lot.

Aucune source n'est RETIRED pour seul volume nul (`le-slip-francais` : canal WTTJ ; `luxe-talent` : job board, D-477).
