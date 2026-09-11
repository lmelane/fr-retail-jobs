# Traçabilité des réparations P2 — où sont les preuves

Ce dossier conserve ce qu'une PR ne remplace pas : la **version exacte du script appliqué**, son **empreinte**, les **identifiants traités** et les **résultats avant/après**.

## Le script appliqué

| Élément | Valeur |
|---|---|
| Version exacte appliquée | `p2-repairs.mts.txt` (copie littérale, extension `.txt` pour ne pas être exécutée par erreur) |
| Empreinte sha256 | `4270b524f0af42bdd0626703d5ce59a8a41a1af2ca7bc77164f710368c41e80c` — également dans `p2-repairs.mts.sha256` |
| Emplacement d'exécution | `backups/lot4-20260909/p2-repairs.mts` (gitignoré : il résout `@prisma/client` depuis la racine du dépôt) |
| Commit du dépôt au moment de l'application | enregistré **dans la décision d'identité elle-même** (`applyEmployerRepair` reçoit `commitHash`) |

## Les sauvegardes

| Étape | Fichier | Empreinte |
|---|---|---|
| Avant les 3 réparations | `before-p2-repairs-220205-production.dump` (494 320 042 o) | `e0737aa47f9601695087c98e57cb81adb73689ddf75af54ff4fbffc70a7c6660` |
| Avant la réparation des descriptions | `before-p3-desc-223047-production.dump` (494 326 610 o) | `253109ae89fd6c447132c9e0f0365bc0f8acced744377efc4f81239f0175084a` |

Les dumps restent dans `backups/` (gitignoré) : ils contiennent des données de production. **La restauration sur clone est la preuve** que chaque sauvegarde existe et est exploitable — les deux ont été restaurées avant application.

## Le détachement FashionJobs (172) — et sa limite de traçabilité

| Élément | Valeur |
|---|---|
| Script appliqué | `p3-fj-detach.mts.txt` · sha256 `3d38f30b2838fc4a89eab8771b92c825d51ba53290e711f5adfcf06c5f270c43` |
| Résultat production | `p3-fj-prod.json` — 172 détachées, `jobsClosed 0`, `jobsWithdrawn 0`, `jobsKept 172`, 15 URLs réassignées |
| Contrôles postérieurs | `p4-url-scoped.mts.txt` (`c81b80a8…9c3d`), `p4-attestation-quality.mts.txt` (`5d1803d4…d7b3`) |
| Périmètre vérifié | `p4-detachment-perimeter-268.json` — **268 identifiants, un SUR-ENSEMBLE** |

> **Limite déclarée** : l'exécution n'a archivé que **5 identifiants sur 172**, et `deactivateSources` n'écrit un `JobEvent` que si l'offre est fermée ou retirée — ici `jobsWithdrawn = 0` par construction. **Aucune trace datée n'existe**, donc les 172 exacts ne sont pas reconstituables. Les contrôles portent sur les 268 offres du prédicat (les 172 + des désactivations antérieures). **Correctif pour les prochaines mutations : archiver la liste complète des identifiants avant application.**

## Les identifiants traités et les résultats

| Fichier | Contenu |
|---|---|
| `p2-prod-apply.json` | application en production des 3 réparations : **102 + 2 + 1**, avec les identifiants Talentsoft, le plan UNIQLO et le plan de fusion Ulta (`beforeHash`, `batchId`, `companyIds`) |
| `p3-prod-apply.json` | application en production des descriptions UNIQLO : **2**, avec les identifiants et le nombre de caractères convertis |
| `p2-clone-apply.json` | la répétition sur clone neuf, à comparer ligne à ligne avec la production |
| `p2-dup-reconcile.json` | la réconciliation des doublons (agrégats **complets**, sans `LIMIT`) |
| `../reference/holds-state.csv` | l'état **courant** des retenues, par identifiant et motif |

## Les résultats avant / après, mesurés

| Mesure | Avant | Après |
|---|---:|---:|
| Talentsoft `location` pollué | 101 | **0** |
| UNIQLO offres non datées | 2 | **0** |
| UNIQLO offres sans description | 2 | **0** |
| Parité Ulta (base / API) | 10 290 / 10 289 | **10 290 / 10 290** |
| Offres actives | 79 516 | **79 516** |
| Retenues **réelles** (écriture refusée, aucune ligne créée) | 702 | **702** |
| *dont écrites puis désactivées, comptées à tort comme retenues* | *38 (Aptar)* | *reclassées cycle de vie* |
| Parité du tableau final | 440/441 | **441/441** |

Le rejeu complet du script ne modifie **aucune ligne**.

## Preuve d'identité pour la fusion Ulta

La fusion n'est pas une écriture directe — la base la refuse (`Company_identity_relationship_review`). Elle passe par `buildEmployerRepair`/`applyEmployerRepair`, avec une **preuve officielle archivée** : la page `https://www.ulta.com/company/about-us/` portant « © Ulta Beauty, Inc. », texte conservé dans `backups/lot4-20260909/p2-ulta-evidence.txt`, sha256 `1a06e23a1f78f9b5bdd88f9436dc1972d6f134c1b0fc79f913aa5b2e9917a903`. Le rejeu rend `alreadyApplied: true`, 0 changement.
