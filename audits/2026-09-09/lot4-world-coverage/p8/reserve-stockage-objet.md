# RÉSERVE OPÉRATIONNELLE — le stockage objet distant n'est pas provisionné

> Enregistrée à la réception de P8 (2026-09-13, décision propriétaire). **P8 est clos ; ce document ne le
> rouvre pas.** Il porte une réserve qui survit au lot parce qu'elle conditionne des opérations futures.

## L'état exact

La politique de rétention (D61-a) est **implémentée, testée et prouvée fail-closed**. Sa validation a écrit sur
**système de fichiers local**, ce qui exerce la totalité de la chaîne — compression, sha256, manifeste,
comptage, restauration, comparaison par identifiants, purge — **sauf la durabilité distante**.

Le fournisseur de stockage objet n'est pas provisionné.

## Ce que cette réserve NE bloque PAS

Le démarrage de **P9**.

## Ce qu'elle BLOQUE, jusqu'à démonstration

1. **Toute réactivation automatique des crons** ;
2. **Toute extension massive en production** ;
3. **Toute purge réelle d'observations**.

## La démonstration exigée — une fois, sur le fournisseur RÉEL

```
archive → upload → manifeste → SHA-256 → comptage des lignes
       → restauration → comparaison → purge des SEULES lignes éligibles
```

**En cas d'échec à n'importe quelle étape : AUCUNE purge.**

C'est la même séquence que celle déjà prouvée en local par six contre-exemples ; ce qui reste à établir est
que le **transport distant** ne l'invalide pas. Une archive qu'on a écrite chez un fournisseur mais jamais
relue depuis ce fournisseur n'est pas une archive : c'est une intention — la leçon de D26, appliquée au
stockage objet.

## Pourquoi ce fichier existe

Une réserve énoncée en conversation disparaît avec la session. Celle-ci gate trois opérations dont deux
(reprise des crons, purge) sont **irréversibles ou lourdes de conséquences**. Elle est donc écrite là où la
prochaine session la trouvera, à côté des mesures qui la motivent.

Rappel du gel en vigueur : les trois crons restent sur `0 0 29 2 *` (D57), et leur reprise demande une
autorisation explicite du propriétaire — indépendante de cette réserve, et cumulative avec elle.
