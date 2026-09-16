# Données contrôlées de l’agrégateur

Point d’entrée et procédures : [README de l’agrégateur](../README.md).

- `reference/` : référentiels réellement lus par le code (pays, villes, Maisons, signaux carrière) et licence CLDR.
- `imports/` : entrées historiques encore utilisées par les outils de rapprochement ou un import explicite. Elles ne prouvent pas l’identité d’un acteur.
- `seeds/` : catalogue initial destiné à une commande d’import explicite. Le catalogue actif est la table PostgreSQL `Source`.

Aucun résultat de recherche, reçu de run, export, rapport ou sauvegarde dans ce dossier. Les sorties de travail vont dans un dossier explicite de `backups/` ; les preuves partageables, datées et sans secret vont dans `audits/`.

Le seed `sources.csv` contient six colonnes : `maison`, `careers_domain`, `kind`, `entry_url`, `job_url_pattern`, `robots_verdict`. Les anciens champs `job_count` et `verified` ont été supprimés ; ils ne constituaient pas des preuves. Le verdict d’accès du seed reste un indice historique sans date : l’import crée une DRAFT et ne lui accorde aucune qualification.
