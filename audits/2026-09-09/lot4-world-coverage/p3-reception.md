# P3 — essais de réparation sur archives (réception NON obtenue)

> **STATUT CORRIGÉ (2026-09-11).** Ce document présentait cinq critères « conformes ». **Ils ne le sont pas** : les scénarios ont exercé `replay-integration.mts`, un **outil parallèle écrit pour la réception**, et non le processus d'intégration que P3 doit industrialiser.
>
> `replay-integration.mts` sélectionne des offres **déjà présentes**, reconstruit des champs depuis sa **propre table `PATHS`**, et écrit directement par `p.job.update`. Il n'appelle **ni les adaptateurs ATS, ni les contrôles d'identité, de configuration et de périmètre, ni le mécanisme d'écriture du pipeline**. Réutiliser `cleanPlace` et `cleanTitle` ne revient pas à réutiliser le pipeline.
>
> La duplication s'est manifestée d'elle-même : sur Flatchr, j'ai dû **ouvrir l'adaptateur pour recopier ses choix** dans ma table — preuve que j'avais réimplémenté la transformation au lieu de l'appeler.
>
> **Ce qui est démontré : une réparation de champs sur archives.** Ce qui ne l'est pas : configuration d'une source → validation → certification → promotion → ingestion → offres créées ou rapprochées.

## Portée réelle des cinq essais

| Critère P3 | Ce qui a été exercé | Portée |
|---|---|---|
| Parcours nominal d'intégration | champs d'offres existantes restaurés sur 2 familles | réparation testée ; **intégration non démontrée** |
| Interruption et reprise | un **autre script** prépare un état partiel, puis le réparateur complète | état partiel testé ; **le vrai parcours n'est jamais interrompu** |
| Changement de configuration | **un commentaire ajouté dans `gate.mts`** | sensibilité de l'empreinte testée ; **aucune configuration de source modifiée** |
| Correction d'un validateur | chemins modifiés dans ma table `PATHS` parallèle | correction de mon outil ; **pas des contrôles partagés du pipeline** |
| Absence de double écriture | mon remplissage ne réécrit pas ce qu'il a rempli | idempotence de ce remplissage ; **pas celle de l'ingestion** |

## Ce qui reste acquis, à ne pas refaire

- Les **deux contre-exemples de la porte** sont corrigés et verrouillés par des tests : un rejeu sans `touchedIds` est `UNVERIFIABLE`, des identifiants hors périmètre sont bloqués par comparaison d'**ensembles**.
- Les **restaurations de champs sur clone** sont de vrais essais avec de vraies écritures — conservés sous leur intitulé exact : *test de réparation sur archives*.
- **Ne pas avoir écrit en production n'est pas un défaut** de cette réception.

## Tableau initial (conservé pour mémoire, verdicts invalidés)

| Critère attendu | Résultat obtenu | Preuve | Conforme |
|---|---|---|---|
| ~~Parcours nominal~~ (invalidé : outil parallèle) | `recruitee` **20/20** champs restaurés à la valeur exacte (lieu + date) ; `flatchr` **20/20** (lieu). Une seule table `PATHS` ; ajouter une famille = **une ligne**, jamais un script | `replay-integration.mts`, exécutions sur clone | **oui** |
| **Interruption et reprise** après écriture partielle | 10 réparées, interruption, reprise traitant **uniquement les 10 restantes** (aucune ré-écriture), résultat final **20/20** exact | `p8-partial.mts` puis rejeu | **oui** |
| **Changement de configuration** : les étapes dépendantes sont invalidées, les résultats valides réutilisables | Sans modification : **8 étapes `skip`** (2 s). Après modification du validateur : **8 étapes `redo (inputs changed)`** | `mutation.sh`, empreinte couvrant mutation + état + procédure + **`gate.mts`** | **oui** |
| **Correction d'un validateur** rejouée hors ligne ; une ancienne validation n'est pas acceptée par erreur | Chemins Flatchr corrigés (`formatted_address`, `flatchr.ts:81`) et rejoués sur les **mêmes archives** → lieu exact. L'empreinte incluant `gate.mts`, toute validation antérieure est invalidée | exécutions successives sur clone | **oui** |
| **Absence de double écriture** : identifiants, champs, historique — pas un compteur | 2ᵉ passage du **vrai chemin** : `planned 0`, `applied 0`, `touchedIds []`, et **40 valeurs toujours exactes** sur les deux familles | vérification champ par champ contre les valeurs d'origine | **oui** |

## Les deux contre-exemples signalés, corrigés

Tous deux **reproduits** (`CLEARED`, `exit=0`), puis corrigés et transformés en tests de non-régression :

| Situation | Avant | Après |
|---|---|---|
| Rejeu `{}` sans aucun compteur | `CLEARED` | **`UNVERIFIABLE`** — « a missing declaration is not zero » |
| Manifeste `A,B`, traitement `C,D`, même nombre | `CLEARED` | **`BLOCK`** — « 2 identifier(s) touched outside the declared perimeter: C, D » |

La porte compare désormais des **ensembles d'identifiants**, plus des nombres, et exige de la mutation qu'elle **déclare** ce qu'elle a écrit (`touchedIds`). Une preuve absente n'est jamais un succès.

## Défauts trouvés en exécutant, non en relisant

1. **Le validateur ne faisait pas partie de l'empreinte** — modifier `gate.mts` laissait toutes les preuves « valides ». Corrigé : l'empreinte couvre mutation + état + procédure + validateur.
2. **`recruitee` : j'allais réécrire 300 dates justes** en préférant `published_at` alors que l'adaptateur mappe `created_at` (ligne 28). Le rejeu doit **reproduire** le choix de production, pas en faire un autre.
3. **Comparer les valeurs au lieu des absences** proposait 300 réécritures par famille qui n'étaient que du rendu de fuseau. Le rejeu ne remplit désormais que les champs **manquants**.
4. **Le fuseau rendait le rejeu non déterministe** : `new Date("2026-08-27T09:28:42")` donne `09:28:42Z` sous `TZ=UTC` et `07:28:42Z` sous `Europe/Paris`. La procédure fixe le fuseau du pipeline et le script refuse de tourner sans.
5. **Mon vérificateur mesurait des champs volontairement exclus** — il jugeait un échec là où le rejeu s'abstenait à raison.

## Limites d'archive, constatées et non forcées

| Famille | Champ | Constat | Décision |
|---|---|---|---|
| `flatchr` | date | l'adaptateur préfère `publish_date` (ligne 93), **absent du RAW** (`has_pub: false`) ; `created_at` est à ~61 s | **exclue du rejeu** — écrire dégraderait une valeur correcte |
| `wordpress` | date | RAW sans fuseau, valeur stockée à 2 h de tout ce que cet hôte reproduit | **exclue du rejeu** |
| `talentsoft` | tous | le RAW n'archive que `path` | **non rejouable**, pas de table de champs |

Ces familles ne sont pas « en échec » : leur archive ne porte pas de quoi rejouer ces champs, et le rejeu s'en abstient plutôt que d'inventer.

## Ce qui n'est pas démontré

`mutation.sh` n'a **jamais écrit en production** — par choix : la production n'est pas le terrain de validation d'un processus. Les écritures réelles ont eu lieu sur clone, ce que les cinq scénarios exigeaient. La première exécution en production restera une étape d'exploitation surveillée.
