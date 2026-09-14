# P9 · contrôles terminaux — méthode et mesures

> En cours de constitution. Chaque nombre est lu là où il est écrit ; aucun n'est déduit d'un autre.

## 1. Le verdict complet d'ingestion (`scripts/ops/p9-verdict.mts`)

Onze grandeurs distinctes, parce qu'elles ne mesurent pas la même chose :

| Colonne | Lue dans | Ce qu'elle dit |
|---|---|---|
| annoncé | `SourceRun.declaredTotal` | ce que le publieur DIT avoir — `null` chez Phenom, qui n'annonce pas de total |
| servies | `SourceRun.fetched` | lignes rendues, **doublons inter-pages compris** |
| uniques observées | `PipelineEvent.source.enumeration_observed` → `enumeration.pageEvidence[].ids`, dédupliqués | le vrai ensemble parcouru |
| acceptées | `SourceRun.accepted` | passées les portes d'identité et de périmètre |
| persistées | `JobSource` de la source | présentes en base, actives ou non |
| nouvelles | `firstSeenAt` **dans la fenêtre du run** | ajouts réels |
| ré-attestées | `lastSeenAt` dans la fenêtre, sans y être nées | re-vues, pas ajoutées |
| tenues | `PipelineEvent job.publication_held` | collectées, non publiées |
| refusées identité | `EmployerObservation REVIEW_REQUIRED` | la porte a mordu |
| erreurs d'écriture | `PipelineEvent job.write_failed` | doit valoir 0 |
| publiquement visibles | `JobSource` actives à `Job` actif | ce que le site peut montrer |

**Deux pièges corrigés dans l'outil lui-même, et ils changeaient le résultat :**

1. **`servies ≠ uniques`.** Phenom repagine à chaque appel et resert des lignes déjà vues : 1 656 servies pour
   **1 509 uniques** chez Skechers, 784 pour **663** chez Hugo Boss. Présenter le total servi comme un nombre
   d'offres serait faux de 147 et 121 lignes. *L'écart n'est pas un défaut : c'est la mesure de l'instabilité
   du publieur, et c'est exactement ce qui interdit d'y lire une absence (P7).*
2. **La fenêtre du run était un recul arbitraire de 6 h** — elle avalait le run de 06:00 et affichait
   `nouvelles = 784` et `nouvelles = 1 651`, c'est-à-dire les mêmes offres annoncées une seconde fois. Bornée
   au run précédent de la même source, elle rend **0** et **73**. *Une fenêtre trop large recompte comme
   ajout ce qui n'est qu'une ré-attestation ; c'est le mécanisme même du double comptage interdit.*

## 2. L'idempotence, correctement définie (`scripts/ops/p9-idempotence.mts`)

Exiger deux ensembles observés **identiques** serait un faux critère ici : le publieur sert un sous-ensemble
différent à chaque passage. Ce qui est exigé, et qui ne souffre aucune exception :

- `0` doublon `JobSource` pour un même identifiant ;
- `0` identifiant porté par deux `Job` ;
- `0` offre fermée parce que le second passage ne l'a pas revue.

Un identifiant non revu est **conservé**, jamais fermé : l'énumération n'étant pas prouvée, son absence ne
prouve rien.

## 3. Résultats mesurés — second passage, `runId f307cbe4-9000-4e36-927e-19234bd5ebde`

Commit déployé `bc384ad`, `PipelineRun` **COMPLETED**, code de sortie 0, commande normale restaurée,
**aucun 429** (la garde `--stop-on-first-429` voyageait dans la commande déployée).

| | Hugo Boss | Skechers |
|---|--:|--:|
| annoncé par le publieur | — | — |
| servies | 663 | 1 559 |
| **uniques observées** | **663** | **1 559** |
| doublons inter-pages | 121 | 97 |
| acceptées | 663 | 1 559 |
| persistées | 784 | 1 656 |
| **nouvelles** | **0** | **5** |
| ré-attestées | 663 | 1 554 |
| tenues · refusées · err. écriture | 0 · 0 · 0 | 0 · 0 · 0 |
| **publiquement visibles** | **784** | **1 656** |
| taux description · URL | 1 · 1 | 1 · 1 |
| `complete` · `canAttestAbsence` | false · false | false · false |

`complete = false` est **exact et voulu** : la pagination du publieur étant instable, ces runs ne prouvent
aucune énumération, donc n'autorisent aucune conclusion d'absence.

## 4. Idempotence — les trois invariants tiennent

| | Hugo Boss | Skechers |
|---|--:|--:|
| avant → après | 784 → 784 | 1 651 → 1 656 |
| revus au second passage | 663 | 1 559 |
| apparus au second | 0 | 5 |
| **non revus mais CONSERVÉS** | **121** | **97** |
| disparus de la base | **0** | **0** |
| doublons `JobSource` | **0** | **0** |
| identifiants sur plusieurs `Job` | **0** | **0** |
| **fermetures causées par une absence** | **0** | **0** |

Les 121 et 97 identifiants non re-servis sont **conservés**, jamais fermés.

## 5. URLs publiques — 40/40, après une réparation que le contrôle a rendue nécessaire

Première passe de preuve : **39/40**, une offre Hugo Boss en HTTP 200 **sans porter son identifiant**.
Diagnostic : `careers.hugoboss.com/job/144302/...` — la forme fautive d'origine, **sans segment de locale**,
que le publieur sert en 200 puis redirige vers `/global/en`. *Un contrôle de statut seul l'aurait déclarée
bonne.*

Balayage : **79 lignes** portaient encore cette forme (65 Hugo Boss, 14 Skechers), toutes à `lastSeenAt`
06:00–06:01 — le résidu que le publieur n'a jamais re-servi en deux passages. Réparées hors ligne
(`p9-repair-locale-urls.mts`) : l'URL correcte se **dérive** de la ligne, on n'invente rien. Chaque URL
réparée a été suivie avant écriture — **79 vérifiées, 0 refusée**.

Après réparation : **0 URL sans locale**, et la preuve rejouée donne **20/20 et 20/20 conformes**
(200 + identifiant porté + 0 page de recherche).

## 6. Teaser contre description complète — 0 teaser restant

| | avant le correctif | après 2 passages | après réparation |
|---|--:|--:|--:|
| médiane Hugo Boss | 313 | 3 005 | **3 090** |
| médiane Skechers | 287 | 4 811 | **4 815** |
| offres sous 400 caractères | — | 91 | **0** |

**Une hypothèse réfutée par la mesure, et c'est ce qui a évité de laisser le défaut** : j'ai d'abord attribué
les 12 descriptions courtes encore présentes après re-service à une source avare. La fiche lue dit l'inverse
— elle publie **7 646 caractères** de description JSON-LD là où nous en stockions **202**. Ce n'était pas la
source, c'était notre lecture.

Cause : `enrichFromJobPosting` est appelé sous un `catch` qui **garde délibérément le teaser** quand la fiche
est illisible (*jamais d'offre perdue pour un détail*). Bon arbitrage à la collecte ; il laisse en revanche
des lignes au teaser quand l'échec est passager. Rejoué hors ligne sur la vraie fiche, avec la concordance
d'identifiant comme garde et l'écriture conditionnée à une description **plus longue** :
**91 réparées, 0 illisible, 0 inchangée.** Minimum désormais 1 800 (Hugo Boss) et 448 (Skechers).

## 7. Identité du crawler — l'écart nommé

`CatwalksBot/1.0 (+https://catwalks.io/bot)` est déployé sur les 17 adaptateurs et présenté à chaque requête.
**`https://catwalks.io/bot` rend 404** (mesuré le 2026-09-14), alors que D62 en fait un *préalable bloquant à
l'activation*. L'identité annoncée ne mène donc nulle part : un éditeur qui la lit dans ses journaux ne peut
pas nous joindre.

Ce qui a été fait ici, et ce qui ne peut pas l'être : le contenu de la page est **rédigé et versionné**
(`apps/web/app/bot/page.tsx` — opérateur, périmètre, ce qui n'est jamais collecté, cadence, retrait par
courriel ou `robots.txt`), et `botInfoUrlIsServed()` permet de **vérifier** le préalable au lieu de le
supposer. Mais `catwalks.io` est un autre dépôt, que celui-ci ne déploie pas : **la mise en ligne reste à
faire hors de ce périmètre.**

*Déplacer l'URL sur `modecareers.com` a été essayé puis abandonné* : un test existant interdit au User-Agent
de nommer le produit plutôt que l'opérateur, et il avait raison — cela aurait troqué une violation de D62
contre une autre. Le test affirmait jusqu'ici la chaîne littérale ; il affirme désormais la propriété.
