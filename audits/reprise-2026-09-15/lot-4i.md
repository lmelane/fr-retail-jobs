# Lot 4I : périmètre de qualification restant

Lecture seule du clone le 16 septembre 2026, après le lot 4H3. Aucun changement de runtime ou de données.

Les 55 125 publications que les lecteurs actuels reconstruisent ont un cache. Les **35 639 autres publications**, y compris les 294 mises en quarantaine, ne sont pas déclarées qualifiées. Le relevé distingue activité native, état de la Job, RAW absent, fermeture et retrait. Les compteurs par famille ne doivent pas être additionnés pour annoncer un nombre de recrutements distincts.

## Défauts confirmés dans le code et les données

- Eightfold : `fetchEightfoldJobs` lit le détail et remplit les colonnes dérivées, sans conserver ce détail dans `raw`. Parmi les 2 908 publications restantes, 93 n'ont aucun RAW ; les 2 815 autres n'ont aucun des champs racine de description ou de détail recensés. Les deux plus gros RAW sont des lignes de liste. Une description dérivée présente dans Job ne peut pas devenir une preuve native rétroactive.
- WTTJ : le RAW contient 713 résumés et 116 profils pour la famille par employeur, 1 973 résumés et 1 045 profils pour le flux sectoriel. Le lecteur de détail remplace la description dérivée mais ne conserve pas cette réponse dans le RAW. Ces résumés et profils sont de vrais éléments publiés ; leur présence ne prouve pas que le descriptif complet a été conservé. La politique de présentation de contenus partiels devra être explicite, sans compléter depuis une autre offre.
- Les autres familles restent à examiner selon leurs chemins natifs. Le recensement de clés JSON ne constitue ni une preuve d'absence dans toutes les structures imbriquées, ni une qualification de l'identité ou de la totalité du contenu.

## Décision de suite

La récupération historiquement prouvée est conservée. Aucun texte manquant n'est reconstitué depuis une ancienne projection. Le lot sources doit garantir la conservation native et certifier la configuration, l'exécution, l'énumération et le rejeu avant activation. Les familles encore insuffisantes passeront ce même contrôle ; aucune exception fondée sur un compteur saisi manuellement.

Un défaut préalable est vérifié dans `capture/batch.ts` : le résultat immuable conserve le nombre et l'empreinte des offres, mais perd les métadonnées d'énumération du résultat d'adaptateur. Le rejeu ne refuse pas encore les réponses enregistrées qu'il n'a pas consommées. Ces deux trous sont le premier sous-lot de la certification des sources. Ce relevé ne clôture pas la qualification du stock et n'autorise pas une bascule de production.

## Vérification

Les deux relevés exigent `default_transaction_read_only=on` sur le clone local. Les données de détail restent dans un fichier privé ; seules les mesures agrégées sont versionnées. Les conditions trouvées dans les documents précédents ont été vérifiées dans `eightfold.ts`, `wttj.ts`, `capture/batch.ts`, `sourceStore.ts` et les commandes d'intégration. Aucun test logiciel supplémentaire pour ce relevé sans modification de code.

[État par famille](preuves/lot-4i-scope.json), [recensement des champs de contenu](preuves/lot-4i-content.json).
