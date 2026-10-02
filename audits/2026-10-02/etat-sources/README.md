# D-520 : état opérationnel des sources, mesure du 02/10/2026

Lecture seule de la production, prise à 14:12 UTC (hors fenêtre du RUN) par `instantane.sql`
(`db.py readonly`, psql), conservée dans `instantane-20261002T1412Z.jsonl.gz`. Le calcul est celui du code
(`apps/aggregator/src/pipeline/sourceState.ts`), rejoué hors ligne par
`apps/aggregator/scripts/ops/mesures/d520-etat-sources.mts` ; sortie complète : `mesure-20261002T1412Z.json`.

Rejouer : `npx tsx apps/aggregator/scripts/ops/mesures/d520-etat-sources.mts audits/2026-10-02/etat-sources/instantane-20261002T1412Z.jsonl.gz`.

Population : les 543 sources du registre (412 ACTIVE, 14 PAUSED, 117 RETIRED) ; collectes des 10 jours de
l'instantané (11 RUN `ingest-all`, 158 `ingest` ciblés traités comme vérifications ; aucune passe D-517 en production).

## État actuel (02/10, 14:12 UTC)

| État \ trajectoire | aucune | AUTO | A_REPARER | REVUE_HUMAINE | DECISION | total |
|---|---|---|---|---|---|---|
| NORMALE | 400 | 0 | 0 | 0 | 0 | 400 |
| DEGRADEE | 0 | 2 | 0 | 0 | 7 | 9 |
| EN_ATTENTE | 0 | 1 | 0 | 0 | 0 | 1 |
| BLOQUEE | 0 | 0 | 2 | 0 | 0 | 2 |
| EN_PAUSE | 0 | 0 | 14 | 0 | 0 | 14 |
| EXCLUE | 0 | 0 | 107 | 0 | 10 | 117 |

| Cause | état / trajectoire | sources |
|---|---|---|
| ACCES_REFUSE | BLOQUEE/A_REPARER 1 | 1 |
| CONTENU_INCOMPLET | DEGRADEE/DECISION 1 | 1 |
| DEFAUT_INTERNE | BLOQUEE/A_REPARER 1 | 1 |
| EXCLUSION_DECIDEE | EXCLUE/DECISION 10 | 10 |
| IDENTITE_EMPLOYEUR | DEGRADEE/AUTO 2 | 2 |
| LISTE_NON_PROUVEE | DEGRADEE/DECISION 6 | 6 |
| MOTIF_ABSENT | EXCLUE/A_REPARER 107, EN_PAUSE/A_REPARER 14 | 121 |
| QUALIFICATION_REFUSEE | EN_ATTENTE/AUTO 1 | 1 |

| RUN | verdict rendu | sources bloquantes (ancien verdict) | verdict D-520 | motifs (sources) |

Sources sans cause classable : **aucune** (19 codes observés, tous classés ; le seul `HttpStatusError` sans détail
se lit dans la note de la collecte, `HTTP 406`).

`MOTIF_ABSENT` (121) : pause ou exclusion sans décision référencée. 23 sans note, 98 dont la note n'est qu'une trace
de promotion ou de validation (« promu par validation-volume… »). Seules 10 citent une décision (7 « D39 », FashionJobs
« User decision 2026-09-08 », Çalık Holding et MaryRuth’s « Owner decision 2026-09-10 »). C'est un état réel du registre, pas un défaut du calcul : la
réconciliation du registre (`audits/2026-10-02/registre-explicite/`) doit y écrire la décision de chacune.

## Verdict rejoué, du 24/09 au 01/10

| 2026-09-24 (35ba463f) | FAILED | 60 | ROUGE | MOTIF_ABSENT 119 |
| 2026-09-25 (02ce57f9) | FAILED | 37 | ROUGE | MOTIF_ABSENT 119 |
| 2026-09-26 (966e9549) | FAILED | 37 | ROUGE | MOTIF_ABSENT 119 |
| 2026-09-27 (403eadd0) | FAILED | 36 | ROUGE | MOTIF_ABSENT 119 |
| 2026-09-28 (da0587ac) | FAILED | 41 | ROUGE | MOTIF_ABSENT 118 |
| 2026-09-29 (12f79076) | FAILED | 57 | ROUGE | MOTIF_ABSENT 118; PANNE_SYSTEME 20 |
| 2026-09-30 (0f7fb086) | FAILED | 3 | ROUGE | MOTIF_ABSENT 121 |
| 2026-10-01 (b4e6b708) | FAILED | 11 | ROUGE | MOTIF_ABSENT 122 |
Le RUN du 02/10 n'avait pas tourné à l'instantané. Sans `MOTIF_ABSENT`, seul le 29/09 serait rouge (panne du système :
20 sources laissées bloquées de notre côté, l'incident du périmètre d'accès) ; les 30/09 et 01/10 seraient verts, avec
leurs sources classées au bulletin.

## Réglages (mesurés)

- Seuil de panne du système, 10 sources laissées bloquées de notre côté par un RUN : 0 à 6 hors incident (5 à 6 du
  25 au 28/09, qualifications refusées chroniques), 20 le 29/09.
- Épisodes par classe, en RUN (`episodesInRuns`) : régression de volume 36 sur 40 d'un RUN ; défaut interne 17 sur 17
  d'un RUN ; identité d'employeur 16 sur 29 de 4 RUN ou plus (d'où 48 h, puis revue humaine) ; liste non prouvée 8
  sur 15 d'un RUN hors échecs connus.
- Première occurrence d'une régression de volume, d'une liste non prouvée ou d'une qualification refusée : en attente
  un RUN, à réparer au suivant (lecture D-492 « remédiation automatique » §4).
- Plafond à réparer ou en revue : 14 jours ; aucun épisode mesuré ne l'atteint (8 jours au plus).

## Limites

- L'intention historique se lit dans la sélection de chaque RUN ; une source non sélectionnée prend son statut et sa
  note d'aujourd'hui. « Depuis » d'une pause ou d'une exclusion = première observation par ce calcul.
- La couverture inexpliquée n'est pas rejouée : `CoverageSnapshot` n'existe pas encore en production.
- La reprise dans le RUN (`ordinaryCauses.ts`) n'existait pas : aucune collecte rejouée n'est une reprise.
