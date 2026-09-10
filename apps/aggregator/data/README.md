# Données contrôlées de l’agrégateur

Point d’entrée et procédures : [README de l’agrégateur](../README.md).

- `reference/` : référentiels réellement lus par le code (pays, villes, Maisons, signaux carrière) et licence CLDR.
- `imports/` : entrées historiques encore utilisées par les outils de rapprochement ou un import explicite. Elles ne prouvent pas l’identité d’un acteur.
- `seeds/` : catalogue initial destiné à une commande d’import explicite. Le catalogue actif est la table PostgreSQL `Source`.

Aucun résultat de recherche, reçu de run, export, rapport ou sauvegarde dans ce dossier. Les sorties de travail vont dans un dossier explicite de `backups/` ; les preuves partageables, datées et sans secret vont dans `audits/`.
