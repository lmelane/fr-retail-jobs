# P10 — BILAN TERMINAL

> 2026-09-14. Crons gelés du début à la fin. Aucune mutation hors protocole.

## A. État du moteur

| | |
|---|---|
| Commit déployé | `0aee3875` (aggregator, refresh, reconcile — **3 services SUCCESS**) |
| Tests | **2 090 verts** (137 fichiers) · typecheck **0 erreur** |
| Concurrence | **4** (décision P8, inchangée) |
| Limites par tenant | `rateLimitKey` par tenant réel, `Retry-After` respecté |
| **429 sur les deux cycles** | **0** |
| Capacité mesurée | 12 sources, 12 min d'exécution par cycle |
| Borne de capacité | **stockage** (P8) — chaîne de rétention prouvée, fournisseur non provisionné |

## B. État du catalogue

| | Départ | Fin |
|---|--:|--:|
| Offres actives | 82 114 | **83 431** |
| Sources ACTIVE | 435 | **437** |
| Sources certifiées | 93 | **95** |
| Représentations actives | 84 010 | — |
| Offres sans source vivante | 0 | **0** |

**Régimes opérationnels — 444 / 444 sources décidées, 0 sans prochaine action :**

| Mode | Sources | Offres |
|---|--:|--:|
| `FULL_AUTOMATION` | **46** | 9 888 |
| `PUBLISH_NO_CLOSE` | **46** | 39 757 |
| `EVIDENCE_ONLY` | **345** | 34 926 |
| `PAUSED_BLOCKED` | **7** | 756 |

*Le registre est **vivant** : 4 sources ont perdu le droit de fermer après les cycles (lvmh, hm-group,
estee-lauder-companies : énumération non prouvée ; motel : run BROKEN). C'est ce qu'un registre dérivé doit
faire — il suit la preuve, il ne la fige pas.*

## C. Extension réalisée

| | |
|---|--:|
| Nouvelles Maisons / enseignes | **2** — Claire's (Workday), Goyard (SuccessFactors) |
| Nouvelles sources actives | **2** |
| Nouveaux groupes | 0 |
| Portails régionaux | 0 |
| **Offres uniques ajoutées (vague A)** | **31** |
| Offres ajoutées pendant les deux cycles | **1 286** (1 271 + 15) |

**Dossiers bloqués, avec cause :**

| Dossier | Verdict | Cause |
|---|---|---|
| EssilorLuxottica | `OFFICIAL_PORTAL_NOT_PROVEN` | rendu JS, aucun board nommé en statique, 0 offre |
| **C&A** | `NEW_ADAPTER_REQUIRED` | **831 offres réelles**, structure `JobsFeed`, mais pagination côté client |
| Skechers `/fr/fr` | `ALREADY_COVERED_BY_SOURCE` | **1 539 / 1 542 identifiants déjà publiés** |
| Percassi, CWF | pas un flux d'offres | le `feedUrl` sert des **articles de blog** |
| Sunglass Hut, Modelor | 0 offre | l'adaptateur ne rend rien |
| Galderma, KSI Mode | décisions propriétaires antérieures | non rouvertes |

## D. Stockage

| | |
|---|--:|
| Politique | 14 j chaud · archive 12 mois · purge fail-closed en 7 étapes |
| **Chaîne prouvée contre un vrai serveur S3** | 523 partitions, **107 095 observations archivées et purgées** |
| Second passage | **0 éligible, 0 supprimée — idempotent** |
| Compression | **6,21 ×** · 71,6 Mo / 100 000 observations |
| Déduplication `contentHash` | **0,14 %** — ce n'est pas le levier |
| Restauration | échantillon **300/300** identifiants, 0 ligne purgée encore en chaud |
| Croissance projetée | chaud plafonné **~1,0 Go** · archives **~0,36 Go/mois** |
| **Fournisseur durable** | **NON PROVISIONNÉ** |

## E. Automatisation

| | |
|---|---|
| Horaires normaux | `0 22 * * *` · `0 2 * * *` · `0 3 * * 1` — **retrouvés dans D40 (`CLAUDE.md`) et l'audit, jamais inventés** |
| Deux cycles manuels | **exécutés sur le code final déployé** |
| Fermetures | **0 sur les deux cycles** |
| Runs orphelins · variables résiduelles | **0 · 0** |
| Alertes testées **en réel** | `brevo: SENT_201` · `heartbeat: PINGED_200` |
| **Crons** | **TOUJOURS GELÉS** (`0 0 29 2 *`, `PIPELINE_PAUSED=1` ×3) |

**Le dégel n'a pas eu lieu**, et c'est conforme : le brief le subordonne au stockage objet réel validé,
qui ne l'est pas.

## F. Industrialisation — la propriété est démontrée

Pour Claire's et Goyard, sur deux familles ATS déjà supportées :

```
UNE NOUVELLE MAISON = CONFIGURATION + PREUVE + VALIDATION + INGESTION BORNÉE
```

**Aucun script par Maison n'a été écrit.** Mesuré par dossier : détection de l'ATS ~2 s, preuve D60
(archivage + hachage + concordance) ~30 s, configuration = 3 champs JSON, validation sur clone ~1 min,
ingestion bornée ~12 min dont 4 de préflight. **Modification de code nécessaire : aucune.**

Le seul dossier exigeant du code est **C&A**, et c'est le brief qui l'autorise : protocole réellement
spécifique, adaptateur à écrire **générique** (`jobsfeed`), jamais nommé d'après une Maison.

## Les défauts trouvés, tous par l'exécution

| Défaut | Comment il est apparu |
|---|---|
| Le registre bloquait **56 sources actives** | il lisait la porte de promotion écrite **avant D62** |
| **CLAIRE'S** bloquée par `myworkdayjobs.com` | un domaine d'**éditeur** partagé par tous les tenants Workday |
| `cycle-sets` : arcteryx **0 publiée / 299 fermées** | alias SQL non cités — **D56**, aucune erreur levée |
| Mon verdict comptait `servies` comme offres | Phenom repagine ; **`servies ≠ uniques`** |
| 21 `job.write_failed` lus comme des pannes | **tous** des refus d'identité — une garde saine |
| Préflight refusé pour **4,8 Gio libres** | chaque run laissait un clone de 2,7 Go — **21 Go** dormants |
| Conclusion « C&A non prouvé » | portait sur une URL **que j'avais fabriquée** (D33) |

*Chacun rendait un résultat qui paraissait bon. Aucun n'aurait été vu par un contrôle de statut, de total ou
de code de sortie.*
