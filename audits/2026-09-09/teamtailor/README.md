# Teamtailor : preuve de terminaison des flux publics

## Mesure avant

Le run normal du 9 septembre à minuit a classé les **122 sources Teamtailor** DEGRADED : aucune erreur technique, mais `complete=false`. La cause est démontrée : l'adaptateur retourne un tableau nu ; le dispatcher ne peut pas savoir si le curseur est réellement arrivé au bout. Le Health Score ne doit pas confondre cette absence de preuve avec un portail cassé.

Deux autres chemins étaient dangereux : une page répétée arrêtait silencieusement le parcours malgré `next_url`, et MAX_PAGES pouvait être atteint sans signaler de troncature. Une réponse sans `items` était assimilée à un tableau vide. Les nouveaux témoins échouent avec l'ancien adaptateur.

## Correctif

L'adaptateur retourne un AdapterResult. `complete=true` exige une chaîne terminée de JSON Feeds valides, des IDs distincts, des annonces exploitables et aucun lien suivant. Un plafond de pages atteint produit `truncated=true, complete=false`. Erreur réseau, page invalide, doublon, cycle, URL étrangère ou continuation filtrée échouent explicitement. Le point d'entrée est un domaine HTTPS sans filtre pays, langue ou département.

Les RAW, normalisations des champs et réhébergements de liens déjà configurés restent inchangés. Aucun `declaredTotal` n'est fabriqué à partir du nombre collecté : c'est la terminaison du curseur, pas un compteur supposé source, qui constitue la preuve.

Le contrat de pagination est défini par [JSON Feed 1.1](https://www.jsonfeed.org/version/1.1/). Teamtailor distingue les flux publics, internes, filtrés et de groupe dans [sa documentation des widgets](https://support.teamtailor.com/en/articles/129677-integrate-a-job-list-widget) : la preuve vaut pour le flux public demandé, pas pour tous les postes internes ni tous les sites internationaux de l'employeur.

## Validation sur le réel

Lecture du 8 septembre 22:25 UTC / 9 septembre 00:25 Paris, avec le code corrigé et les configurations réellement actives, normalisées par le même résolveur que l'ingestion. Trois portails au maximum en parallèle, budget de 60 secondes par portail, contrôle HTTP commun. Aucune écriture en base, aucun load test.

**122/122 parcours complets ; 5 180 représentations ; zéro erreur ; aucun flux vide.** Les compteurs et empreintes RAW par source sont dans `live-validation.json`. Les charges complètes restent privées. Il ne faut pas additionner ces représentations pour annoncer un nombre d'offres canoniques distinctes.

15 tests ciblés passent, dont parcours multipage, conservation des RAW réels Galeries Lafayette, limite de pages, réponse mal formée, ID manquant, doublon, cycle, redirection de périmètre et HTTP 403. Total de cette branche : 1 413 tests unitaires ; typecheck des deux applications réussi.

## État de livraison

Correctif validé localement. Fusion et déploiement attendent la fin du run en cours. Pas de backfill de Job nécessaire : le correctif produit la preuve au prochain parcours réel. Il ne faut pas réécrire a posteriori les anciens SourceRun pour les déclarer complets. Les garde-fous de clôture existants restent applicables ; une collecte complète ne certifie pas le pays, l'employeur ou l'accessibilité individuelle de chaque candidature.
