# P8 — bilan final

> Lot exécuté le 2026-09-13. Crons gelés (`0 0 29 2 *`, `PIPELINE_PAUSED=1`) du début à la fin.
> **Cinq passages bornés** de production, aucun cron réactivé, aucune mutation hors protocole.

## L'objectif, et la réponse

P8 devait *déterminer et augmenter la capacité réellement soutenable du pipeline sur les sources existantes*,
sans dégrader la qualité, perdre d'identifiants, créer de doublons, surcharger les portails, saturer Railway
ou PostgreSQL, ralentir le site public, ni introduire une architecture disproportionnée.

**La réponse tient en une phrase : la capacité en temps, en mémoire et en politesse réseau est soutenable ; la
capacité en stockage ne l'est pas, faute de rétention.**

Et le levier qu'on attendait — augmenter la concurrence — **ne fonctionne pas** : la mesure montre que le
pipeline n'est pas limité par le nombre de sources traitées en parallèle, mais par ce que les tenants
acceptent de servir.

## Les cinq passages

| Passage | Sources | Offres | Mur | 429 | Verdict |
|---|--:|--:|--:|--:|---|
| T0 (validation de la chaîne) | 3 | 227 | 34,0 s | 0 | `validForCapacity: true` |
| T1 corrigé, passe 1 | 9 | 1 976 | 580,8 s | 0 | `true` |
| T1 corrigé, passe 2 | 9 | 1 977 | 401,6 s | 0 | `true` |
| T2, passe 1 | 18 | 10 281 | 1 379,8 s | 82 | `false` — 4 refus d'identité |
| T2, passe 2 | 18 | 10 281 | 675,5 s | 39 | `false` — les 4 mêmes |
| A/B concurrence 6 | 18 | **8 625** | 441,6 s | 25 | `false` — arrêt 429 volontaire |

## La portée exacte des deux passages T2 — à ne pas confondre

Les deux T2 fournissent **deux choses de statut différent**, et les mélanger reviendrait à présenter un
passage non recevable comme une validation end-to-end.

### A. Ce qui est exploitable comme mesure

Temps, HTTP, 429, CPU, mémoire, connexions DB, stockage, front, **volumes observés** : ces grandeurs sont
mesurées sur un parcours complet du corpus — 18/18 sources `complete = true`, 0 tronquée, 0 rejet,
`fetched = accepted = declaredTotal`. Elles sont valides et utilisées comme telles.

### B. Ce qui n'est PAS recevable : la validation end-to-end

**Les deux passages T2 portent `validForCapacity = false`.**

Cause : **quatre `EmployerIdentityReviewRequired` déterministes** — les mêmes quatre offres, aux mêmes
libellés, sur les deux passes (`saks` : Neiman Marcus ×2, Bergdorf Goodman ; `knitwell-us-retail` : A00
Premium Brands Services LLC).

**La porte d'identité a fonctionné : aucune identité n'a été inventée.** Et le pipeline en tire lui-même la
conséquence — `saks` et `knitwell-us-retail` passent `canAttestAbsence = false` : **ces sources ne peuvent pas
attester une absence pendant ces runs**, donc aucune offre ne peut être fermée sur leur foi.

*Les deux T2 ne sont donc pas deux passages entièrement valides. Ce sont deux passages dont les mesures de
ressources et de comportement sont exploitables, et dont la recevabilité end-to-end est refusée — à raison.*

## Ce qui est PROUVÉ

| Fait | Preuve |
|---|---|
| Les seuils de plusieurs tenants Workday ont été **rencontrés** ; les retries ont évité toute erreur finale et toute perte | 121 × 429 sur quatre passages, tous absorbés ; 0 erreur finale, 0 timeout. **La concurrence 6 est refusée, et 4 reste le maximum complet démontré.** |
| Le seuil 429 est **par tenant** et reproductible | `deckers`, `fastretailing`, `mecca` à **0** sur toutes les passes ; `mango` à 35 |
| Aucune perte de données | 18/18 sources `complete`, 0 tronquée, 0 rejet, `fetched = accepted = declaredTotal` |
| Reproductibilité du corpus | **16/18** volumes identiques entre deux passes T2 |
| Idempotence | 1 seule création d'identité à la seconde passe T2 |
| Protection par tenant effective | 28 hôtes → 21 clés ; les 8 sous-domaines URBN sous une clé |
| Tenants Workday séparés à raison | `mango` 35 refus / `mecca` 0, même plateforme |
| Robustesse aux arrêts brutaux | 3 scénarios exercés, reprise **17/17 identifiants**, 0 orphelin, 0 doublon |
| File distribuée **écartée** | orchestration à 0,2 % du mur **et** reprise saine sur les 3 scénarios |
| Site public non dégradé | **6/6 conforme** sous charge, médiane 728 ms, 410 correct |
| Concurrence 4 est le bon palier | à 6, 1 656 offres non collectées |

## Ce qui est NON ÉTABLI, et assumé comme tel

| Question | Statut |
|---|---|
| Coût en temps de la protection par tenant | **non établi** — étendue de 44,6 % entre deux passes, hors de portée de deux mesures |
| Requête la plus longue (0,047 → 4,56 s) | **trop dispersée** pour conclure ; jamais associée à un échec |
| Débit des 415 sources non mesurées | extrapolé, jamais prétendu mesuré |

## Les erreurs commises pendant P8, et ce qu'elles ont produit

Elles sont listées parce qu'elles ont chacune produit un correctif durable.

| Erreur | Conséquence | Correctif |
|---|---|---|
| **La garde d'arrêt 429 n'était pas armée** sur trois passages (`export` local, run en conteneur) | T2 a encaissé 82 refus en étant annoncé protégé | le drapeau voyage dans la commande déployée ; `record.json` porte la posture |
| **« +28 % de coût » conclu après une seule passe** | conclusion fausse, réfutée par la passe 2 (401,6 s < 452,7 s) | la variance est mesurée avant de conclure |
| **« Signature de budget partagé »** tirée de `requestsPerSecond` | artefact : la grandeur dérive du mur | une grandeur dérivée du mur ne peut pas expliquer le mur |
| **Scénario B « impossible »** pendant deux tentatives | la cause était la SOURCE (Teamtailor n'a aucun pool de détails), pas l'injection | injection câblée dans le pool iCIMS réel, testée comme telle |
| **Faux négatif du crash** (code 0) | l'injection était sur la branche, le run sur `main` | une injection absente du tree exécuté est indiscernable d'une injection inerte |

## L'état de la production à la clôture

| | |
|---|---|
| Crons | **gelés** — `0 0 29 2 *` sur les trois services |
| `INGEST_ONLY_KEYS` · `REFRESH_ONLY_KEYS` | **null** |
| Variables `CRASH` / `STOP` | **aucune** |
| Commande de l'aggregator | `sh apps/aggregator/start.sh` (normale) |
| Dernier déploiement | SUCCESS |

## La rétention — décidée par le propriétaire, implémentée, validée

La seule décision que P8 avait remontée a été **tranchée le 2026-09-13** : chaud 14 jours, archive 12 mois,
compressée, partitionnée date × runId × sourceKey, manifeste immuable, purge fail-closed.

**Implémentée et validée sur périmètre borné** (`retention-observations.md`) :

| | |
|---|---|
| Purge fail-closed | **6 contre-exemples, 6 refus** — archive absente, sha256 divergent, manifeste incomplet, restauration vide, restauration étrangère, pointeurs absents |
| Restauration complète | **3/3 lignes, identifiants identiques**, RAW intact, sha256 recalculé concordant |
| Purge | 107 735 → 107 732, **0 ligne récente touchée** |
| Idempotence | 2e passage : **0 éligible, 0 supprimée** |
| Dry-run | **inerte** : aucun fichier, aucune ligne, aucun pointeur |

**Mesuré** : 4,63 Mo par 1 000 observations · **déduplication des RAW 0,12 %** (le contenu change réellement
d'un passage à l'autre — la déduplication n'est pas le levier, il fallait le mesurer pour ne pas construire
dessus) · compression **9,3 ×**.

### La croissance, avant et après

| | Croissance |
|---|---|
| Sans rétention | **illimitée** — ~12 Go/mois en base, sans plafond |
| **Avec rétention** | base **plafonnée à ~5,61 Go** (14 j × 86 429 représentations) + **~1,29 Go/mois** d'archives froides |

*Coût en unités monétaires : non disponible — aucun tarif de stockage objet n'est configuré. Le volume est
donné, la conversion appartient au contrat d'hébergement.*

**Réserve nommée** : le stockage objet n'est pas provisionné ; la validation a écrit sur système de fichiers
local, ce qui exerce toute la chaîne (compression, sha256, manifeste, restauration, purge) mais pas la
durabilité distante.

## La capacité NON testée

| | |
|---|---|
| Concurrence 8 et au-delà | **non testée, délibérément** — 6 franchit déjà une limite de tenant ; monter serait chercher le point de rupture, ce que P8 interdit |
| Les 415 sources hors corpus | **non mesurées** — l'enveloppe les extrapole, elle ne les observe pas |
| Coût en temps de la protection par tenant | **non établi** — variance de 44,6 % entre deux passes |
| Durabilité distante des archives | **non exercée** — pas de bucket provisionné |

## Décision sur P9

**P8 est clos.** Tout ce que le lot devait établir l'est : la capacité soutenable est mesurée, sa borne est
nommée, la décision qu'elle appelait est prise et implémentée, et les gardes ont été prouvées en refusant des
cas réels.

**Préalable explicite et non levé par P8** : la reprise automatique des crons reste subordonnée à
l'autorisation séparée du propriétaire (D57). Les trois crons sont gelés (`0 0 29 2 *`) et le restent.

**Concurrence recommandée : 4.** Capacité temporelle démontrée : ~1 h 35 pour une passe idempotente complète,
~3 h 15 pour un premier passage. Limite de tenant démontrée : au-delà de la concurrence 4, un tenant Workday
coupe et le corpus devient incomplet.
