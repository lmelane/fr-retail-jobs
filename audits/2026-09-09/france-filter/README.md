# Filtre France : projection du pays canonique

## Mesure avant réparation

Le 9 septembre 2026 à 05:08 UTC, deux offres actives de Vestiaire Collective à Tourcoing ont `countryCode=FR` et `isFrance=false` : voir `measurement.json`. La base contient 10 936 offres avec un pays canonique FR ; le filtre France en retourne 10 934. La requête API France + Tourcoing + « Quality Control Associated » donne 0 résultat, contre 2 sans filtre pays (`front-before.json`). Le volume mondial reste 74 113.

Le défaut concerne le drapeau dérivé, pas une nouvelle inférence sur la ville. La réattestation ne le recalculait que si la nouvelle observation portait un pays. Une observation limitée à la ville préservait le pays canonique déjà connu et le drapeau erroné.

## Correctif et garanties

`reattestationFields` rétablit désormais la cohérence du drapeau avec le pays canonique retenu, même si le candidat ne renseigne pas de pays. L'autorité de la source reste appliquée : une source secondaire ne peut pas changer la géographie primaire. Une géographie inconnue n'est pas transformée en assertion pays.

Le plan ne modifie que `Job.isFrance` sur les deux IDs mesurés. Les verrous source/entreprise, avant-images complètes, journal DataCorrection immuable et événements CORRECTED sont ceux du framework existant. Un nouvel invariant vérifie toute la population active ayant un pays renseigné, y compris les lignes hors lot. Une incohérence fait échouer la transaction avec l'ID fautif.

Tests : 204 tests d'intégration réussis, dont les témoins de réattestation sans pays et une ligne contradictoire hors lot qui provoque le rollback. Typecheck des deux applications réussi. La première répétition sur une ancienne copie a été bloquée par une incohérence hors lot ; cette copie n'a reçu aucune écriture du lot. Une restauration récente indépendante est utilisée pour la répétition finale.

Ce lot ne prétend pas résoudre les pays manquants ou ambigus, ni prouver que toute offre française possible est collectée. Il traite exclusivement la divergence constatée entre pays canonique et filtre.

## Répétition réussie sur sauvegarde récente

La sauvegarde complète de production du 9 septembre 04:55 UTC (`../rmk-dates/production-backup.json`, SHA-256 `cb3ddd9727dc7ae3b56013383c366d3529feef296568f939e49b5533e6046761`) a été restaurée dans une nouvelle base locale isolée. Deux écritures, deux événements CORRECTED et deux lignes DataCorrection ; aucune représentation, donnée RAW, géographie ou ancien événement modifié. Seconde application : zéro écriture. Les compteurs de cette copie passent à 10 936 France pour 10 936 pays canoniques FR, et la vérification de population entière trouve zéro contradiction. Voir `rehearsal-*.json`.

La réparation de production sera appliquée exclusivement depuis le commit propre mergé sur main, après construction de son image, avec le plan/hash revalidé ; les preuves seront ajoutées après exécution.

## Production réparée — 9 septembre 05:19 UTC

PR [#34](https://github.com/lmelane/fr-retail-jobs/pull/34) : commit `67aef77`, merge main `8513d7428cc917c69e7511016139f6fa2cc2c607`, CI aggregator et web réussies. Image Railway `f1f6963d-c084-4629-823a-8366714c5c1d` SUCCESS. Le plan `2dc4fa11a72f302d9269c1460037d260cb3340c6e8b29fd2dbbe46226f6e2abd` a été appliqué depuis ce checkout propre : **2 écritures, 2 événements CORRECTED, 2 lignes DataCorrection**. RAW, représentations, géographie et historique original préservés. Seconde application : zéro écriture.

La production et l'API France comptent maintenant **10 936 offres**, toujours 74 113 au total. Les deux offres de Tourcoing apparaissent désormais avec le filtre France : **0 → 2** pour la requête témoin. Les preuves SQL, d'idempotence et API sont dans `production-*.json` et `front-after.json`. Aucun run global n'a été relancé.
