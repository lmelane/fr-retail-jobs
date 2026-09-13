# P8 · l'enveloppe opérationnelle — ce que le pipeline soutient, et ce qu'il ne soutient pas

> Établie sur **quatre passages bornés** de production, commit `85ce223`, crons gelés, 2026-09-13.
> Aucune valeur n'est extrapolée sans être annoncée comme telle.

## Les quatre passages, mesurés

| Passage | Sources | Offres | Mur | Débit | 429 | RSS pic |
|---|--:|--:|--:|--:|--:|--:|
| T1 corrigé, passe 1 | 9 | 1 976 | 580,8 s | 3,40 off/s | 0 | 651 Mo |
| T1 corrigé, passe 2 | 9 | 1 977 | 401,6 s | 4,92 off/s | 0 | 599 Mo |
| T2, passe 1 | 18 | 10 281 | 1 379,8 s | 7,45 off/s | 82 | 758 Mo |
| T2, passe 2 | 18 | 10 281 | 675,5 s | 15,22 off/s | 39 | 951 Mo |

**Deux régimes distincts, et il faut les garder distincts** : un *premier passage* écrit des identités
(591 créations en T2 p1) ; un *passage idempotent* ne fait que ré-attester (1 création en T2 p2). Le second
va deux fois plus vite. Aucun des deux n'est « la » durée du corpus.

Le débit **croît avec la taille du corpus** : 3,40 → 15,22 offres/s. Avec 4 sources en parallèle, 18 sources
remplissent mieux les créneaux que 9, dont une dominante monopolise le mur.

## Extrapolation à la production complète

Production : **433 sources actives, 86 429 représentations**, soit **8,4 ×** le corpus T2 en offres.

| | Estimation |
|---|--:|
| Premier passage complet (régime p1) | **~3 h 15** |
| Passage idempotent complet (régime p2) | **~1 h 35** |
| Stockage par passage complet | **~441 Mo** |
| Stockage sur un mois quotidien | **~13,2 Go** |

*Extrapolations linéaires depuis 12 % de la production. Elles donnent un ordre de grandeur, pas une
prévision : ni la taille des descriptions ni la latence des 415 sources non mesurées ne sont supposées
identiques.*

Point de repère indépendant : le dernier run global réel de production (2026-09-06) a duré **1 h 02** pour
492 sources. L'estimation idempotente de 1 h 35 est du même ordre, légèrement plus prudente — cohérence
rassurante entre deux méthodes indépendantes.

## Ce qui est SOUTENABLE, mesuré

| Grandeur | Pire valeur observée | Limite | Marge |
|---|--:|--:|---|
| Mémoire (RSS) | 951 Mo | 24 Go | **96 %** |
| CPU | 20 % d'un cœur-seconde | — | large |
| Connexions PostgreSQL | 17, dont 3 en attente | pool | large |
| Requête la plus longue | 4,56 s | — | dispersée ¹ |
| Échecs de persistance | **0** sur 4 passages | 0 | — |
| Erreurs réseau finales | **0** sur 4 passages | 0 | — |
| Timeouts | **0** sur 4 passages | 0 | — |
| Front public sous charge | **6/6 conforme** | 6/6 | médiane 728 ms |

¹ 0,72 → 2,85 → 0,047 → 4,56 → 2,96 s selon les passages. **Trop dispersée pour conclure**, et jamais associée
à un échec. Signalée, non tranchée.

## Ce qui n'est PAS soutenable

**Le stockage.** `SourceObservation` croît d'une ligne par offre et par passage, sans aucune purge : ~13,2 Go
par mois de passages quotidiens sur une base de 3,35 Go. C'est la **seule** borne rencontrée, et elle est
franche.

Elle appelle une **décision produit** — combien de jours d'observation faut-il conserver pour que la preuve
d'absence (P7) garde sa valeur ? — et non un réglage technique. Hors périmètre P8, remontée telle quelle.

## La politesse réseau : freinés, jamais rejetés

**121 réponses 429 au total** sur les quatre passages, **toutes absorbées** par un retry réussi.
0 erreur finale, 0 offre perdue.

Elles sont **exclusivement Workday** (0,96 % de ses requêtes), et à l'intérieur de Workday **exclusivement les
tenants au-delà de ~780 requêtes** — `deckers`, `fastretailing` et `mecca` restent à zéro sur les deux passes.
Le seuil est **par tenant**, reproductible, et le regroupement par clé de tenant le respecte : 28 hôtes
observés, 21 clés, un seul regroupement (les 8 sous-domaines URBN).

**Aucun portail n'a été maltraité.** Cette conclusion est établie *a posteriori* par la télémétrie ; sur les
trois premiers passages elle ne l'était pas par une garde active — défaut de procédure corrigé (la garde
d'arrêt voyage désormais dans la commande déployée).

## Robustesse — les trois scénarios d'arrêt brutal

| Scénario | Preuve | Reprise |
|---|---|---|
| A — pendant la collecte | `SIGTERM` réel en production, `INTERRUPTED` enregistré | — |
| B — pendant le pool de détails | code 137 dans le pool iCIMS, 0 persistance | **17/17 identifiants** |
| C — pendant l'écriture | code 137 après 1 transaction commitée | conforme |

Dans les trois cas : **0 run orphelin, 0 réservation pendante, 0 doublon**, reprise par le **chemin normal**.

**Conséquence : la file distribuée est écartée** — ni le débit (orchestration à 0,2 % du mur) ni la reprise ne
la justifient. Écartée par la mesure et par l'exercice, pas par opinion.

## Les gardes qui ont réellement mordu pendant P8

Une garde qui n'a jamais refusé n'est pas prouvée. Celles-ci l'ont fait, sur des cas réels :

| Garde | Ce qu'elle a refusé |
|---|---|
| Verdict terminal de capacité | les deux passes T2 (`validForCapacity: false`, 4 échecs d'écriture) |
| Porte d'identité employeur | 4 offres, **à l'identique sur les deux passes** — déterministe |
| `canAttestAbsence` | `saks` et `knitwell` : un run incomplet ne ferme aucune offre |
| Préflight | une relance T2 (`déploiement BUILDING`) |
| Propagation du code de sortie | un SHA à 7 caractères (code 3) |
| Garde d'attribution des écritures | une contamination d'**une seule ligne** entre deux passes T1 |
| Garde de fusion | aucune fusion pendant un passage borné |
| **Arrêt sur premier 429** | `mango` à concurrence 6 — *« passage de mesure arrêté : 429 de `tenant:mango.workday` »* |

## Recommandation d'exploitation

| Paramètre | Valeur mesurée comme sûre |
|---|---|
| Concurrence de sources | **4** (défaut) — **tranché par l'A/B** : à 6, `mango` est coupée par sa propre limite de tenant et **1 656 offres ne sont pas collectées** |
| Cadence | une passe quotidienne tient largement dans la fenêtre |
| Ordre à la reprise | ingest complet **puis** refresh (D36), jamais l'inverse |
| Préalable **bloquant** | une politique de rétention sur `SourceObservation` |

**La reprise des crons reste une décision du propriétaire** (D57), et P8 ne la prend pas. Ce que P8 apporte,
c'est que la contrainte à traiter avant cette reprise n'est pas le temps d'exécution : c'est la rétention.
