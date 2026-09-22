# `/emplois` V1 : validation locale du 22 septembre 2026

## Verdict

Lot multilingue validé localement. Aucun déploiement, aucun push main. `/offres`, matching et onboarding gelés.

## Corrections

- Locale d’affichage indépendante de la recherche, propagée à la liste, pagination et fiche. Libellés des dimensions, options, métiers et secteurs traduits ; contenu natif des offres conservé.
- Navigation et pied de page traduits par la locale explicitement fournie par `/emplois`. Les autres pages gardent le défaut français.
- Sélecteur : langues visibles avant les 41 marchés dans le contexte du moteur.
- Suppression du second composant de recherche non stylé. Un composant Catwalks reçoit le type de l’API : FACETTE affiche les options, RECHERCHE affiche un champ et 12 suggestions au maximum. Aucun seuil local ne décide du type.
- Suppression des scripts ponctuels E2E et des comparaisons par regex RSC/totaux figés. Lanceur strict de répétition, lecture seule, test de non-fuite sur secrets factices.
- Réparation du typecheck des scripts de mesure : indexation `as never` incorrecte et rootDir incompatible avec les imports réels du paquet DB.

## Preuves

Chaîne finale démarrée pour cette validation : website `localhost:3021` → API `localhost:3011` → `catwalks_consolide_rehearsal`, lanceur en lecture seule. La chaîne préexistante 3020/3010 est restée disponible.

Référence SQL du 22/09 à 18:25 UTC : CA 1 087, CH 507, BE 318 offres publiables. Constats datés, pas des constantes à recopier dans les tests.

- 8 E2E verts, toutes les pages API comparées aux identifiants SQL, sans doublon.
- CA : en/fr ; CH : fr/de/it ; BE : fr/nl/de/en. Neuf locales déclarées par le registre actuel.
- Sélecteur réel, retour, critères non vides et vides, locale HTML hydratée, libellés traduits, données natives conservées ; marché inconnu refusé.
- Recherche de ville avec accents, navigation vers Genève, fermeture Échap ; FACETTE sans champ ; mobile sans débordement.
- Website : 824 tests unitaires verts, typecheck et build verts.
- API : 173 tests verts ; 87 tests réservés à une base d’intégration dédiée non exécutés dans cette commande. E2E réel séparé en lecture seule.
- Agrégateur : typecheck source et scripts vert.
- Lanceur : 7 tests sans vrais identifiants, refus des mauvaises destinations et transmission du code de sortie.
- Audit défensif indépendant : aucune modification du plan SQL ou de l’empreinte des curseurs par la locale. Les lacunes relevées (options traduites et filtre non vide) ont été corrigées.
- Vérification visuelle Chromium 1440 et 390 px. Empreintes des fichiers `/offres` et matching inchangées.

## Limites et suite

Le layout racine statique porte toujours `html lang=fr` avant hydratation ; le `main` de `/emplois` porte sa locale dès le serveur. Les traductions de concepts nouvellement ajoutés ou renommés restent à fournir ; les libellés natifs restent disponibles.

Ces vérifications ne qualifient pas la production et ne débloquent ni CRON ni matching. Suite : Golden Path d’une source dans une base locale neuve, sans effacer les données existantes.

Procédure : [guide E2E](../../docs/architecture/emplois-e2e.md).
