# Lot 5G3B2A — provenance privée des requêtes natives

Date : **16 septembre 2026**. Validation locale, migration sur clone isolé et stockage Railway de test. Aucune bascule de production, activation de source ou CRON.

## Défaut reproduit et décision

Une requête POST suivie d’une redirection GET produisait deux appels réseau mais un seul reçu, sous l’URL logique initiale. Sa clé conservait les paramètres du lecteur, avant ajout des en-têtes par le transport. Le User-Agent réellement envoyé et les requêtes intermédiaires n’étaient pas retrouvables dans cette capture. La [reproduction avant correction](preuves/lot-5g3b2a-baseline.json) conserve ce constat.

La clé historique `requestHash` reste inchangée pour préserver le rejeu. Une nouvelle référence `requestDataHash` lie chaque nouveau reçu à un bloc privé immuable, vérifié par empreinte : requête logique, URL exacte, méthode, hash du corps, collecteur et négociation de contenu observés à la frontière du transport, statuts et redirections. Les corps de requête et les en-têtes Cookie/Authorization ne sont pas copiés. Les paramètres d’URL demeurent privés.

Le transport explicite ses valeurs par défaut et garde la transformation POST → GET, y compris la disparition du corps. Une redirection HEAD reste HEAD même si le lecteur a fourni la méthode en minuscules. L’observation réutilise la porte de concurrence déjà détenue par l’extraction. Une dernière contre-épreuve a reproduit deux erreurs de frontière : annulation en file avant appel au transport pourtant enregistrée comme tentative, et corps mutable haché avant la sortie de file. Le relevé est désormais réalisé immédiatement avant fetch, et seules les requêtes effectivement appelées produisent une observation de transport. Les captures de pages d’identité/d’accès continuent à enregistrer chaque corps de redirection.

Le navigateur relève ses en-têtes avec Playwright sous délai borné. Les origines HTTP, navigateur, DOM dérivé et transport non observé sont distinctes. Un échec de lecture des en-têtes ne fabrique pas une identité et empêche d’exposer un DOM exploitable. Le schéma privé est fermé et borné à 512 000 octets ; ses redirections, méthodes, corps et liaison au reçu sont vérifiés.

## Défaut supplémentaire corrigé

Les tests ont révélé qu’une recapture identique pouvait ne pas rétablir les octets chauds d’un bloc archivé auparavant. Un nouveau lecteur sans accès à cette ancienne archive échouait alors malgré sa collecte fraîche.

`ensureBlob` rétablit maintenant les octets fraîchement observés sous le verrou du bloc, à condition que les identités native et gzip correspondent. Les anciennes attestations, métadonnées et localisations distantes restent immuables. Une représentation gzip différente est refusée explicitement ; sa compatibilité doit être vérifiée lors d’un changement de runtime. Les références récentes de provenance protègent désormais ces blocs dans le plan de rétention et lors du contrôle final de purge.

## Migration et conservation historique

La migration **66** ajoute la référence privée, son index et sa clé étrangère. Un contrôle SQL exige une provenance explicite pour chaque nouvelle ligne ; les lignes historiques restent nulles. Le journal immuable protège aussi ce nouveau champ.

La [répétition sur une capture synthétique historique](preuves/lot-5g3b2a-historical.json) crée une vraie ligne sous le schéma 65, applique la migration 66, compare toutes ses anciennes colonnes puis rejoue les octets sans appel au portail. `requestDataHash` reste NULL et le lecteur restitue une provenance inconnue. Les manifestes de page v1 gardent leur projection d’origine ; les nouveaux manifestes v2 référencent la provenance et exigent une observation HTTP par reçu.

La [migration du clone de stock](preuves/lot-5g3b2a-stock-migration.json) compare les empreintes complètes de six tables avant/après : 87 607 Job, 90 764 JobSource, 141 933 SourceObservation, 536 Source, 536 SourceRevision et 112 SourceIdentityReview. Toutes leurs anciennes lignes et colonnes restent identiques. Ce clone ne contient aucune capture native historique ; la répétition synthétique précédente couvre ce cas séparément.

Le dump complet restauré lors du lot 5D reste la base de reprise, avec les migrations 61 à 66 à appliquer. Ce lot ne prétend pas avoir répété une nouvelle restauration complète du stock.

## Tests et audit défensif

**3 502 tests réussis** : 2 538 unitaires, 694 d’intégration agrégateur, 259 API et 11 Python. Deux tests API facultatifs restent ignorés. Les types, le build API et les 66 migrations depuis une base vide passent. Les **95 tests ciblés** couvrent le transport, le navigateur, les captures, manifestes, lectures privées et rétention.

Les [contre-épreuves](preuves/lot-5g3b2a-counterproofs.json) réintroduisent quatorze défauts applicatifs : annulation en file marquée comme requête envoyée, hash de corps figé avant la sortie de file, trace tronquée, collecteur supposé, clé ou première cible/corps non liés, origine trompeuse, en-tête d’authentification enregistré, provenance ignorée au rejeu, périmètre ou protection de rétention manquant, absence de réchauffement des octets frais et provenance absente du manifeste. Trois mutations SQL retirent séparément l’obligation de provenance, la clé étrangère et l’immutabilité. Toutes sont détectées. Les 57 tests de ce groupe repassent après restauration. Le plafond global de l’enveloppe est également testé.

La [validation finale](preuves/lot-5g3b2a-validation.json) distingue ces contrôles du périmètre encore ouvert. La suite complète, les contre-épreuves et les captures S3 portent sur le runtime final après correction du point de relevé HTTP. L’[empreinte du runtime](preuves/lot-5g3b2a-runtime-match.json) couvre 277 fichiers identiques dans le travail courant et la copie vérifiée.

## Preuve native et archive Railway

Deux nouvelles captures `SOURCE_ACCESS` lisent `api.lever.co/robots.txt` et `jobs.lever.co/robots.txt` sous une source DRAFT isolée. Les réponses sont HTTP 200, text/plain UTF-8, 38 octets chacune. Leur corps partagé porte l’empreinte `6aa3556bd611889c4480a143bb6186f9d0c5e919c6b4c9901f3a6a8141549a1b`.

Cette fois, l’identité `CatwalksBot/1.0 (+https://catwalks.io/bot)` et la négociation sont **relues dans le bloc privé archivé** et comparées aux arguments réellement observés au transport. La [preuve native](preuves/lot-5g3b2a-live-robots.json) contient les identifiants et cette égalité.

Cinq blocs uniques sont vérifiés sur S3 : un corps, deux manifestes et deux provenances. Les trois blocs de chaque capture sont retirés du stockage chaud après relecture distante ; le corps partagé est fraîchement recapturé entre les deux opérations, soit six retraits chauds au total. Chaque capture est relue deux fois depuis l’archive, avec les appels aux portails bloqués : zéro appel portail pendant les quatre lectures, mêmes octets, identité et observation. Le SDK accède bien au stockage S3 ; ce n’est pas un essai sans réseau.

La source reste DRAFT et inchangée. Aucune offre, revue d’identité ou autorisation n’est créée. Deux lectures robots ne certifient pas tout un portail.

## Nettoyage et limites avant release

La primitive SHA-256 est partagée pour éviter une dépendance circulaire et la duplication de la clé de requête. Les commentaires et documents de capture, accès, rétention et onboarding ont été actualisés, notamment l’ancienne affirmation selon laquelle les blocs recapturés restaient uniquement froids. La lecture des anciens formats reste un consommateur nécessaire des preuves conservées ; elle ne sert pas de certification de remplacement.

La trace décrit les appels du transport instrumenté, pas les octets TLS. Le chemin HTTP ordinaire conserve le corps final et la trace des sauts ; les captures de pages officielles gardent chaque corps. Les sous-ressources navigateur, les requêtes navigateur échouées sans réponse et l’amorçage WAF ne sont pas couverts intégralement. La décision d’accès immuable doit encore remplacer les champs mutables, couvrir toutes les cibles réelles et être revérifiée lors des ingestions actives. Les autorisations déjà obtenues restent des décisions distinctes et conservées.

La [preuve de conservation](preuves/lot-5g3b2a-preservation.json) vérifie les 86 fichiers utilisateur initiaux : 82 identiques, quatre exceptions antérieures documentées, 83 configurations conservées. La sauvegarde privée du lot est `backups/reprise-20260916-lot5g3b2a`. Les changements Ba&sh et scripts utilisateur déjà présents restent hors de ce commit ; le runtime local testé les inclut. Ce constat ne certifie donc pas une release construite depuis le seul HEAD Git. Le projet complet n’est pas déclaré prêt pour la production.
