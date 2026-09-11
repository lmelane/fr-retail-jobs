# P3 — industrialisation de l'intégration : premiers livrables

Démarré sur autorisation explicite (2026-09-11), **sans clore P2** et **sans reprendre les crons**. Travail sur archives et clones.

## Le défaut que P3 doit corriger

**53 chaînes d'exécution vivent dans `backups/`**, non versionnées. Chaque lot copiait la précédente : la procédure dérivait, et une chaîne ne pouvait être ni relue, ni comparée, ni rejouée depuis le dépôt. C'est la cause directe de plusieurs incidents de ce lot — notamment les 5 identifiants archivés sur 172.

## Livrable 1 — la procédure commune, versionnée

`apps/aggregator/scripts/ops/mutation.sh` : **un seul point d'entrée** pour toute mutation de production. Un dossier ne fournit plus qu'un script de mutation et un script d'état.

| Étape | Garantie |
|---|---|
| 0 · Gardes | aucun déploiement ni run en vol ; `HEAD == origin/main` |
| 1 · **Périmètre** | la mutation écrit la **liste complète des identifiants** *avant* toute écriture |
| 2 · Sauvegarde | dump frais pris avant la première écriture |
| 3 · Restauration | clone restauré **depuis ce dump** — la restauration **est** la preuve |
| 4 · Répétition | mutation sur clone, **puis rejeu** : le rejeu ne doit rien changer |
| 5 · Avant | état mesuré en production, **par le même script** que l'après |
| 6 · Application | mutation en production |
| 7 · Après + rejeu | état re-mesuré, rejeu sans effet |
| 8 · Archivage | script, sha256, périmètre et résultats avant/après copiés près des preuves |

Trois règles y sont **inscrites dans le code**, chacune née d'une erreur commise :

- **Aucun tube ne masque un code de retour** — la sortie va dans un fichier, le statut est celui de la commande.
- **La reprise ne rejoue que les étapes invalidées** (marqueurs `.ok`, `RESUME=1`).
- **Une incohérence métier vue à l'étape 4 se corrige, s'isole ou s'arbitre AVANT l'étape 6.** La déclarer après ne vaut pas validation.

Vérifié : syntaxe shell valide, `check-layout` conforme.

## Livrable 2 — un dossier réel qualifié sans mutation

**Les 43 libellés en refus d'identité** (2 269 offres actives) sont instruits sur archives, sans aucune écriture.

| Constat | Libellés | Niveau de preuve |
|---|---:|---|
| Crédit dont le nom **ressemble** au libellé natif | 38 | **comparaison de chaînes** — indice, pas preuve |
| Libellé de **groupe** crédité à une Maison | 5 | 3 inspectés offre par offre, conformes D11/D37 |
| **Offres dont l'attribution est démontrée** | **inconnu** | aucune vérification par preuve native sur les 2 269 |

> **Ce que je ne peux PAS affirmer, et que ce document affirmait à tort** : « zéro offre mal attribuée sur les 2 269 ». La ressemblance des noms (« Coach » → Coach) est un **indice de cohérence**, pas une démonstration : elle ne consulte aucune preuve native de l'offre. Et les 5 cas de libellé de groupe n'ont été inspectés qu'à hauteur de **3 offres**, sur 43 libellés et 2 269 offres.
>
> **Ce qui est établi** : sur les cas inspectés, l'attribution suit une règle gravée — « J Choo Germany GmbH » → **Jimmy Choo** (entité juridique → Maison, D37) ; « Kering » → **Kering Eyewear** sur une offre dont le titre porte « KERING EYEWEAR » (D11). Aucune contradiction observée.
>
> **Ce qui reste ouvert** : l'attribution des 2 269 offres n'est pas démontrée. **Aucune réparation ni retrait n'est engagé sur cette seule incertitude.** Condition de résolution : confronter chaque libellé à la preuve native de l'offre (logo, entité juridique, facette du tenant), par la revue d'alias, non par comparaison de noms.

## Livrable 3 — un dossier fermé par la preuve, sans réparation possible

**`element-6`, 5 offres non datées** : le RAW est **`null`**, pas un objet vide. Rien n'est rejouable hors ligne, et les offres sont par ailleurs complètes (ville, pays, description). Aucune réparation n'est possible **sans recollecte**, exclue du périmètre.

**État : bloqué sur une recollecte, pas sur une analyse.** Condition de résolution : un run de la source qui réarchive son RAW.

## Scénarios exécutés, et leurs résultats

`mutation.sh` a été **exercé sur des clones réels**, jamais sur la production. Chaque ligne ci-dessous est une exécution, pas une intention.

| Scénario | Commande | Résultat observé |
|---|---|---|
| **Arrêt sur périmètre non déclaré** | chaîne complète, dossier sans identifiants | **`exit=10`**, `gate BLOCKED`, motif « the perimeter manifest lists no identifier ». **`prod-apply` jamais atteint** |
| **Arrêt sur périmètre dépassé** (données réelles) | mutation touchant 60 lignes pour 20 déclarées | **`exit=10`**, deux motifs : « replay still changed rows: 60 » et « touched 60 rows for 20 declared identifiers » |
| **Invalidation par modification** | script de mutation édité, `RESUME=1` | **8 étapes `redo (inputs changed since its last proof)`** — un marqueur `.ok` aurait réutilisé des preuves périmées |
| **Reprise stable** | `RESUME=1`, rien de modifié | **8 étapes `skip (same inputs, proven at …)`**, 2 s au lieu de ~4 min |
| **Preuves malgré l'échec** | après chaque arrêt | logs et empreintes archivés dans `p2-repairs-proof/`, **aucune empreinte `prod-apply`** |
| **Parcours nominal jusqu'à la porte** | `--dry-run` | 8 étapes vertes, `gate passed, production deliberately not written` |
| **Blocage unitaire des 6 invariants** | `src/ops/gate.test.ts` | **7 tests verts**, chacun vérifiant un `exit 1` : rejeu non vide, périmètre dépassé, fermeture pendant un retrait, perte d'attestation, périmètre absent, contrôle non évaluable |

### Trois défauts de ma propre procédure, trouvés par ces exécutions

L'exécution a corrigé ce que la relecture n'avait pas vu :

1. **Le nom du dump était recalculé à chaque invocation** — `restore-clone` voyait des arguments différents à la reprise et cherchait un dump inexistant. Le scénario « interruption et reprise » **échouait**. Le nom est désormais mémorisé.
2. **Un nom mémorisé était réutilisé même quand la sauvegarde était invalidée** — or `backup-0910.py` refuse (à juste titre) d'écraser un dump existant. La condition exige maintenant que l'empreinte de l'étape `backup` soit elle-même valide, sinon un **nouveau** dump est pris : « la sauvegarde précède toute écriture » reste vrai.
3. **Le test de la porte ne tournait pas en CI** (`vitest.config.ts` ne couvre que `src/**`) et dépendait du répertoire courant. Déplacé dans `src/ops/`, chemins résolus depuis le fichier : **7 tests désormais exécutés à chaque CI**.

## Consolidation des exécutables

`scripts/ops/db.py` remplace les runners qui vivaient dans `backups/` : la **logique** (quelle base, lecture seule imposée par le serveur, construction de l'URL) est versionnée ; **les identifiants restent hors du dépôt**, dans un fichier d'accès local désigné par `CATWALKS_DB_ACCESS`. Vérifié sur les cibles `readonly` et `clone`.

Restent volontairement dehors : les **dumps** (données de production), les **fichiers d'accès** (secrets) et les archives privées.

## La faiblesse CI, corrigée à sa cause

La PR 96 a pu être mergée avec le contrôle `aggregator` en échec parce que **`main` n'avait aucune protection de branche** — rien ne s'y opposait. Corriger l'assertion 83 → 82 ne réglait pas cela.

Posé sur `main` : contrôles requis **`aggregator` et `web`**, `strict` (la révision doit être à jour avec `main`), **`enforce_admins`** (aucun contournement, y compris par moi), force-push et suppression interdits.

## Ce qui reste non démontré

`mutation.sh` **n'a pas encore écrit en production**. Les scénarios ci-dessus couvrent le parcours nominal, la reprise, l'invalidation, l'arrêt bloquant et la conservation des preuves — mais la phase `prod-apply` → `after` → `gate-after` n'a jamais été franchie, faute de mutation légitime à faire. Elle le sera au premier dossier qui en exigera une.

**Statut : prototype exercé, non encore qualifié pour l'exploitation.**
