# BLOC 0 — photographie terminale de départ

> 2026-09-14, **une seule transaction `REPEATABLE READ, READ ONLY`**. Aucune mutation pendant ce bloc.
> Données machine : `bloc0-photographie.json`.

## Pourquoi une transaction, et pourquoi ce niveau d'isolation

En `READ COMMITTED` — le défaut — chaque requête voit un instantané **différent** (mesuré en P2). Compter
les offres puis les sources dans deux instantanés produirait un état qui n'a jamais existé. Comme tout écart
ultérieur sera comparé à cette photographie, elle doit être cohérente avec elle-même. `READ ONLY` est
déclaré au moteur : la garantie ne repose pas sur l'intention de l'appelant.

## L'état de référence attendu — confirmé sans écart

| Grandeur attendue | Mesurée | Écart |
|---|--:|---|
| Offres actives | **82 114** | aucun |
| Sources ACTIVE | **435** | aucun |
| Sources certifiées | **93** | aucun |
| Tests verts | **2 042** | aucun |
| Services Railway SUCCESS | **3 / 3** | aucun |
| Crons gelés | `0 0 29 2 *` ×3 | aucun |
| `PIPELINE_PAUSED` | `1` ×3 | aucun |
| Run borné en vol | **0** | aucun |

**Aucun écart à expliquer.** Rien n'a été ajusté pour retrouver ces nombres.

## L'état complet

| | |
|---|--:|
| Sources : total / ACTIVE / PAUSED / RETIRED | 534 / **435** / 7 / 92 |
| Certifiées / non certifiées (sur ACTIVE) | **93** / 342 |
| Offres : total / actives / fermées | 86 268 / **82 114** / 4 154 |
| Offres actives portant un `closedAt` | **0** (invariant de cycle de vie) |
| **Offres actives sans source vivante** | **0** |
| Représentations : total / actives | 89 452 / 84 010 |
| Offres retenues (historique `job.publication_held`) | 996 |
| `PipelineRun` en cours | **0** |
| Sources ayant déjà collecté | 537 · dont 58 à plus de 7 jours |
| Collecte la plus récente / la plus ancienne | 1 h 22 / 8 j 02 h |
| `SourceObservation` | **133 249 lignes**, 457 sources, 133 094 empreintes |
| Fenêtre d'observation | 2026-09-06 → 2026-09-14 |
| **Pointeurs d'archive distante** | **0** — le stockage objet n'est pas provisionné |

### Taille réelle

Base **3 236 Mo**. `Job` 1 699 Mo · **`SourceObservation` 586 Mo** · `JobSource` 477 Mo ·
`OccupationObservation` 188 Mo · `DataCorrection` 173 Mo.

*`SourceObservation` est la deuxième table de la base alors que la fenêtre ne couvre que 8 jours : c'est
exactement la borne de capacité identifiée en P8, et l'objet du Bloc 1.*

## Services, commandes déployées, variables résiduelles

| Service | Cron | `PIPELINE_PAUSED` | `PIPELINE_CMD` | Déploiement | `INGEST_ONLY_KEYS` |
|---|---|---|---|---|---|
| aggregator | `0 0 29 2 *` | `1` | `ingest-all` | SUCCESS | **aucune** |
| refresh | `0 0 29 2 *` | `1` | `refresh` | SUCCESS | **aucune** |
| reconcile | `0 0 29 2 *` | `1` | `reconcile` | SUCCESS | **aucune** |

Commande de démarrage : `sh apps/aggregator/start.sh`. Aucune variable résiduelle, 0 problème.

## Sauvegarde fraîche, et sa restauration PROUVÉE

| | |
|---|---|
| Dump | `backups/p10-20260914/bloc0-production.dump` |
| Taille | 530 889 258 o (531 Mo) en 137,6 s |
| **sha256** | `c6705e1b428d23497cf3a547f3f052e71b9e23faeefc5b76ac7df1f228a78e0c` |
| Restauration | clone `catwalks_lot4_replay_20260909d`, sha vérifié **avant** restauration |
| Comparaison | 7 grandeurs, mêmes noms, même ordre — **différence nulle** |

*Une sauvegarde n'existe que si sa restauration a été démontrée (D26) : le champ `restoreProven` du fichier
de preuve ne passe à `true` qu'après ce rejeu constaté.*

## État public de référence

| Surface | Mesure |
|---|---|
| API `/api/jobs` | **total 82 114** — égal à la base, 3 285 pages de 25 |
| Facettes | 842 Maisons · 118 pays · 59 métiers · 36 groupes · 16 secteurs · 40 sources |
| Sitemaps | index `/sitemap.xml` → **18 tranches `/sitemaps/0..17`**, toutes en 200 (83 812 URLs) |
| Pages clés | `/`, `/emplois`, `/entreprises`, `/bot` → **200** |

*Le chemin `/sitemap-offres.xml` testé au passage rend 404 : il vient du `robots.txt` de **catwalks.io**, pas
de ce site. Ce n'est pas un défaut, c'est un mauvais chemin de ma part — le vrai découpage est `/sitemaps/N`.*

**Parité base ↔ API confirmée à l'instant de référence : 82 114 = 82 114.**
