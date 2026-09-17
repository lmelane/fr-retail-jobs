# Lot 0 — base de reprise et architecture

**Validé localement le 15 septembre 2026.** Cette validation clôt la préparation et les correctifs d’outillage décrits ici. Les défauts métier recensés dans l’audit restent à corriger dans les lots suivants. Aucun déploiement effectué.

## Résultat

- Sauvegarde privée des **86 fichiers de travail** des cinq dépôts ; bundles vérifiés des 8 commits locaux de l’agrégateur et 14 du website. Les autres dépôts n’ont pas été modifiés.
- Récupération en lecture seule des trois fichiers du Journal dans le conteneur `console-article`. Le moteur diffère du local ; la console déployée n’appelle pas encore la traduction après publication. Les différences exactes sont sauvegardées, sans remplacer les fichiers locaux.
- Test de villes corrigé : CN est un marché connu. Fixtures positives CN/BE et exclusions croisées, au lieu d’une assertion qui ne vérifie qu’une liste vide.
- Contrôle Railway corrigé pour `catwalks-api`, sans alias `web`. Transport partagé versionné ; les lecteurs de crons et gardes de déploiement n’utilisent plus le client privé. Le préflight inclut aussi les dépendances partagées dans la comparaison des révisions et réutilise le programme de sauvegarde maintenu.
- `npm run test:local` crée sa propre base PostgreSQL, applique les migrations et exécute les validations. Image figée par digest, port local attribué par Docker, aucune URL de base héritée. Le conteneur est retiré après succès, échec ou interruption contrôlée.
- Vitest **3.2.6 → 5.0.1**, configuration de workers actualisée et typage d’un mock corrigé. L’audit npm détecté à l’installation propre est désormais à zéro vulnérabilité.
- Architecture maintenue réécrite ; README racine, README agrégateur, documentation ops et plan actualisés ; ancien document `docs/migration-modecareers/architecture-actuelle.md` supprimé. Son historique reste accessible dans Git.

## Décisions d’architecture

Voir [l’architecture maintenue](../../docs/architecture/production-foundations.md).

1. Publications originales et captures RAW comme preuves ; projection de recherche reconstruisible, rapprochements réversibles et concepts locaux.
2. Deux producteurs d’offres et une recherche commune ; priorité Catwalks après éligibilité, avant pagination. Candidature native conservée ; redirection externe explicite pour l’agrégateur.
3. Sous-domaines recommandés par pays ; le changement manuel de pays actualise ensemble langue par défaut, marché, filtres et suggestions. Pays et langue sont deux données distinctes pour les pays multilingues.
4. Deux inputs centraux ; aucun pays dans la localisation. Suggestions d’intitulés tirées du stock du pays, localisations structurées et géographiquement bornées.
5. Un seul parcours cible de source : dossier, capture, validation, certification liée à la configuration/au code/aux preuves, puis activation. Les sources historiques suivront les mêmes règles.
6. Catalogues UI versionnés et migration prévue vers `next-intl` avec messages ICU, contexte de langue cohérent dès le serveur et retrait du moteur maison après migration. Toute traduction d’annonce reste distincte de l’original. Ni le moteur interne ni le fournisseur de traduction d’Indeed n’ont été établis ; aucun service n’est sélectionné sur cette supposition.

## Vérifications

| Contrôle | Résultat |
|---|---:|
| Installation propre dans un checkout distinct | Réussie |
| Migrations sur base neuve | Réussies |
| Typecheck agrégateur, scripts et API | Réussi |
| Tests unitaires agrégateur | 2 223 réussis |
| Tests d’intégration agrégateur | 397 réussis |
| Tests API | 242 réussis ; 2 réservés au corpus réel |
| Tests Python des outils Railway | 5 réussis |
| Build API | Réussi |
| Audit npm | 0 vulnérabilité signalée |
| Réintroduction du défaut CN | Rouge attendu ; restauration verte |
| Réintroduction du nom Railway obsolète | Rouge attendu ; restauration verte |
| Interruption après démarrage de la base | Échec explicite et conteneur supprimé |
| Contexte Docker distant avec variable de socket local contradictoire | Refus avant connexion ; commandes attachées au socket validé |
| Contrôle des modifications utilisateur | Préservées ; seul ajout sur un fichier déjà modifié : version Vitest |
| Liens des documents maintenus et `git diff --check` | Valides |

[Résultats et empreintes](preuves/lot0-validation.json), [contre-épreuves](preuves/lot0-counterproof.json), [interruption](preuves/lot0-interruption.json), [contexte Docker](preuves/lot0-docker-guard.json), [préservation](preuves/lot0-preservation.json), [état lu des crons](preuves/lot0-crons.json).

La répétition a utilisé la base de code `9504c9f` et le patch de travail sauvegardé sur la branche `codex/production-foundations-20260915`, dans `/tmp/catwalks-lot0-verification-20260915`. Les bundles, patches, fichiers runtime et journaux complets restent dans les sauvegardes privées locales. Ce n’est pas encore une révision de production.

## Audit défensif et limites

- Les modifications précédentes sont conservées ; aucun cherry-pick/merge automatique des PR #168/#160. Les 8 commits locaux agrégateur et les divergences des autres dépôts restent rattachés à leurs preuves Git et sauvegardes. Leur assemblage en release suivra les lots concernés.
- Les droits de mutation Railway restent bornés à l’aggregator. Les tests de transport sont hors ligne ; les lectures réelles contrôlent le service API et les trois workers. Aucun test de mutation n’a visé la production.
- Les trois workers restent gelés ; aucune variable d’allowlist résiduelle lors du contrôle. Les productions website/backend/media et le DNS ne sont pas modifiés.
- Le préflight complet de mutation n’est pas certifié pour exploitation par ces tests ciblés. Les lots cycle de vie et sources doivent encore démontrer la répétition métier complète.
- Le script local ne remplace pas les deux tests réservés au corpus réel, les validations de données, la charge ni les tests UX. Le build API et une suite verte ne suffisent pas à déclarer tout le produit prêt pour la production.
- Les contrats de recherche commune, synchronisation des offres directes, domaines/langues, sources et traduction sont **définis, pas encore implémentés**.

Prochain lot : sécuriser le cycle de vie, ses périmètres de mutation et l’expiration déclarée. CRON, matching et nouvelle promesse de `/offres` restent après la phase actuelle.
