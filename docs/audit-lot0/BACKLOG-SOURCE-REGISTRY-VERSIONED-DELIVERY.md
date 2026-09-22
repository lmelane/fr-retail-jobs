# `SOURCE_REGISTRY_VERSIONED_DELIVERY` — les mutations du registre n'ont pas de chemin versionné

**Backlog architecture. PAS maintenant.** Ouvert le 2026-09-22, découvert en cherchant comment
livrer une configuration de source en production.

## Le constat

`Source.config` gouverne la collecte : origine, pagination, champ de marque, tenant. C'est une
colonne de la base de production, et **rien ne la fait voyager avec le code**.

Vérifié le 2026-09-22 :

- `data/seeds/sources.csv` **a été supprimé** (`sourceStore.ts`) ; avant suppression il portait
  **83 lignes quand la base en portait 536**, sans statut, sans `config`, sans révision ;
- `reimporter-registre-sources.mts` l'assume sans détour : *« La table EST devenue la source de
  vérité »* ;
- une configuration nécessaire à la production peut donc n'exister **que** dans une base, sans
  trace Git, sans revue, sans rejouabilité.

Le cas qui l'a révélé : `be586ec` apprend à lire `brandProperty`, mais déployer ce code seul
n'aurait **jamais** ajouté Douglas — le champ se déclare en base. Traité ponctuellement par la
migration `20260922100000_douglas_brand_property`.

## Pourquoi c'est un vrai risque

**Reprise après incident.** Un `DROP` suivi d'un réensemencement depuis le CSV perdrait 453
sources et toutes leurs configurations de collecte. Le seul filet est l'export JSON du registre
réel, produit à la demande — pas un artefact de build.

**Revue.** Une modification de `config` change ce que le pipeline collecte. Aujourd'hui elle
échappe à la revue de code, alors qu'elle a les mêmes conséquences qu'un changement d'adaptateur.

**Traçabilité.** Le déclencheur `Source_record_revision` archive bien chaque révision, donc l'état
*passé* est conservé. Ce qui manque est l'**intention** : pourquoi cette valeur, décidée par qui,
sur quelle preuve.

## Le sujet à instruire

- comment versionner une mutation légitime du registre (migration de données ? fiche revue et
  appliquée par un script d'ops ? export réimportable en artefact de build ?) ;
- comment l'appliquer de façon idempotente et défensive — le modèle de la migration Douglas, qui
  **refuse** d'écraser une valeur divergente, semble une base saine ;
- comment l'auditer : diff entre le registre attendu et le registre réel ;
- comment reconstruire **intégralement** le registre après un sinistre.

## Ce que ce backlog n'est pas

Il ne remet pas en cause la table comme source de vérité d'exécution — c'est un choix assumé et
documenté. Il cherche à lui donner un chemin de livraison et de reconstruction, comme en a le
schéma.

**Ne pas transformer un cas particulier en refonte du registre.** Le besoin immédiat (Douglas) est
couvert par une migration ciblée.
