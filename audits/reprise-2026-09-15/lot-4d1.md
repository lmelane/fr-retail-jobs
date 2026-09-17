# Lot 4D1 — reprendre le RAW historique sans fabriquer une capture

**Validé localement. Ce sous-lot ne clôture pas la reprise du stock ni le lot 4. Aucun déploiement ni changement de stock distant.**

## Architecture livrée

Le plan de réparation de groupes accepte deux preuves distinctes : une sortie de capture immuable, ou le RAW conservé de la publication lorsque son lecteur est qualifié. La présence d’une référence de capture impose sa vérification ; une capture contradictoire ne peut pas être remplacée silencieusement par un rejeu historique.

La version 2 du plan indique, pour chaque publication, l’origine de l’entrée, son empreinte RAW, l’empreinte de sortie et la valeur `sourceLastSeenAt` conservée. Cette dernière n’est pas une nouvelle attestation. Le plan est recalculé sous verrou avant écriture et le relevé immuable `DataCorrection` conserve les publications avant/après, dont leurs RAW. Aucun faux objet `CaptureBatch`, aucune requête employeur et aucune actualisation de `lastSeenAt` ne sont nécessaires à cette récupération.

Les parseurs de collecte sont réutilisés ; les mappings Ashby, Lever, Workday, Greenhouse, Recruitee, LVMH, WordPress, Workable et JSON-LD ont été isolés en fonctions partagées. L’ancien alias `lvmhLanguage`, qui déléguait déjà au lecteur commun, et ses tests redondants ont été retirés. Les autres familles réutilisent leurs fonctions existantes.

Les 19 familles examinées sont : Ashby, Lever, Jibe, Phenom (format `/api/jobs`), LVMH Algolia, Teamtailor, Workday, Greenhouse, Recruitee, Generic Listing (JSON-LD avec URL), Magnet, Rituals, WordPress, GeoDirectory, Talentsoft (RSS), Typesense, Workable, Oracle HCM et JobAffinity WordPress. Cela ne qualifie pas tous les formats de chacune de ces familles : chaque publication doit satisfaire les gardes de son lecteur.

## Gardes

- Identifiant natif, URL et contenu de cette publication obligatoires ; aucun repli sur `Job.title` ou `Job.description`.
- Publication retenue ou retirée par l’éditeur refusée ; une description perdue n’est pas un poste fermé.
- Workday : URL du détail concordante ; une date relative historique reste sans date absolue si le détail ne donne pas `startDate`.
- Oracle : identifiant du détail concordant avec la liste, site et URL compatibles avec le catalogue.
- JobAffinity : correspondance liste/post/application, formulaire ouvert de la bonne annonce et config de tableau identique.
- La réparation conserve les gardes de partition, de disponibilité, de taille et de transaction des lots 4B–4C. Elle ne réactive pas une publication inactive.

## Correction de contenu Lever

Le lecteur récupère le HTML lorsque la variante en texte brut est vide, puis les rubriques nommées, le texte de rémunération et le contenu de fin. Il utilise le champ combinant introduction et corps sans recopier séparément ces deux parties. Ces champs sont distincts dans la [documentation officielle Lever](https://github.com/lever/postings-api#get-a-list-of-job-postings). Cette correction sert aussi les nouvelles collectes.

## Limites et suite

Le snapshot examiné date du 15 septembre 2026. Un rejeu réussi indique que la présentation peut être reconstruite depuis les données conservées ; il ne prouve ni l’ouverture actuelle du poste, ni la disponibilité actuelle de la source, ni l’identité correcte de l’employeur historique.

Le rejeu suit les formats de contenu des lecteurs actuels. La qualification source par source doit encore contrôler les dates de publication, notamment les anciens replis vers des dates de création ou de mise à jour et les dates locales sans fuseau ; la recherche par pays doit remplacer les anciennes normalisations de lieux et de contrats. Ces contrôles restent des conditions de release.

Le format CareerConnect de Phenom, les descriptions de détail absentes de certains anciens RAW et les autres formats non encore qualifiés restent à traiter. Les différences d’URL et d’identifiant ne sont pas ignorées pour faire monter le compteur. La qualification suivante devra distinguer une récupération possible avec un autre chemin natif, une correction d’identité prouvée et une recollecte indispensable.

La sortie de capture immuable reste le chemin des publications déjà liées à une capture. Le rejeu d’une capture ancienne avec un nouveau lecteur et la reprise du stock distant restent des opérations distinctes à valider avant release.

## Validation et audit défensif

- **2 900 tests réussis** : 2 183 unitaires agrégateur, 458 d’intégration, 254 API et 5 Python ; deux tests optionnels de corpus ignorés. TypeScript et build API réussis. Les 55 migrations passent sur base vierge, sans dérive du schéma. [Validation](preuves/lot-4d1-validation.json).
- Huit contre-épreuves : identifiant non lié, contenu manquant accepté, date relative historique transformée en date absolue, détail étranger, capture fictive, plan falsifié, réattestation silencieuse et perte des rubriques Lever. Toutes rendent les témoins rouges ; la restauration rend la suite verte. [Contre-épreuves](preuves/lot-4d1-counterproofs.json).
- Rejeu hors ligne des **85 327 représentations** : **49 075** récupérables, toutes capables de produire une présentation valide avec les faits RAW, le catalogue de métiers de référence et la confiance par défaut. Aucune écriture DB. Ce contrôle de format ne qualifie pas les anciens choix sémantiques restant listés plus haut. [Corpus](preuves/lot-4d1-corpus.json).
- **57 publications réelles issues des 19 familles** reconstruites et relues par l’API dans PostgreSQL local, sans emprunt à l’ancien groupe ; aucune différence constatée. Réapplication idempotente, `lastSeenAt` inchangé, aucun `CaptureBatch` créé. Les groupes corrompus et les sources de ce scénario sont des témoins locaux, pas une description du stock de production. [Répétition en base](preuves/lot-4d1-shadow.json).
- CLI réelle : préparation, application, seconde application sans mutation et fichier de plan `0600`. [CLI](preuves/lot-4d1-cli-smoke.json).

Les **36 252 cas restants** sont répartis par motif dans le corpus. Un motif technique d’identité ne prouve pas une fausse annonce : les 8 152 refus Workday comprennent 6 727 détails sans URL conservée et 1 425 différences de préfixe de site avec un même chemin de poste. Aucun de ces cas n’est forcé dans le résultat. Les 21 615 formats non encore qualifiés ne sont pas déclarés irrécupérables.

La suite complète a détecté un témoin instable de télémétrie, sans lien avec une offre : le temps de vie d’un worker peut être arrondi à `0.0` seconde juste après son démarrage. Le test utilise maintenant une durée contrôlée et vérifie cette valeur exacte, ainsi que l’absence d’invention d’un état OOM. La validation complète a été relancée après correction.

Les 86 fichiers de travail initiaux sont contrôlés : 85 identiques ; le manifeste npm conserve les trois scripts utilisateur, avec les seuls changements des lots précédents. [Préservation](preuves/lot-4d1-preservation.json).
