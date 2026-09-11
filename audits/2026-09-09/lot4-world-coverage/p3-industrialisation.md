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

| Constat | Libellés |
|---|---:|
| Crédit **cohérent** avec le libellé natif | **38** |
| Libellé de **groupe** crédité à une Maison | **5** |
| **Offres mal attribuées** | **0** |

Les 5 « incohérents » sont conformes aux règles gravées, vérifié offre par offre : « J Choo Germany GmbH » → **Jimmy Choo** (entité juridique → Maison, D37) ; « Kering » → **Kering Eyewear** sur une offre dont le titre porte « KERING EYEWEAR » (D11 : une offre de groupe est créditée à la marque de tête). « Coach » → Coach, « Nordstrom Inc » → Nordstrom, « NORMAL Butikker Danmark » → Normal.

**Conclusion : le refus porte sur le libellé natif rencontré à la validation, jamais sur l'attribution finale.** Ce sont des observations à solder par la revue d'alias, **pas des offres mal attribuées** — ce que j'avais avancé sans preuve le 10 septembre, et qui est désormais établi sur les 43.

## Livrable 3 — un dossier fermé par la preuve, sans réparation possible

**`element-6`, 5 offres non datées** : le RAW est **`null`**, pas un objet vide. Rien n'est rejouable hors ligne, et les offres sont par ailleurs complètes (ville, pays, description). Aucune réparation n'est possible **sans recollecte**, exclue du périmètre.

**État : bloqué sur une recollecte, pas sur une analyse.** Condition de résolution : un run de la source qui réarchive son RAW.

## Ce que P3 n'a pas encore

La procédure commune est écrite et vérifiée statiquement, mais **elle n'a pas encore piloté une mutation de bout en bout** — les deux dossiers instruits ce jour n'en demandaient aucune. Sa validation en conditions réelles reste à faire, sur le premier dossier P2 qui exigera une écriture.
