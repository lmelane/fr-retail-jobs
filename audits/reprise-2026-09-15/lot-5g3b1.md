# Lot 5G3B1 — lire les règles robots pour le véritable collecteur

Date : **16 septembre 2026**. Code validé localement ; stockage de validation Railway uniquement. Aucun déploiement, activation, CRON, écriture de stock ou nouvelle autorisation d’accès.

## Défaut établi dans le code

Le transport annonçait CatwalksBot, tandis que `robotsVerdictFor` ne lisait que le premier groupe `*`. Les groupes nommant notre robot, les groupes répétés et certaines formes encodées de chemin pouvaient donc produire une observation incorrecte. Le constructeur de regex depuis une règle arbitraire n’avait pas de plafond de calcul.

Le lecteur partage maintenant le produit `CatwalksBot` avec l’identité HTTP, qui reste inchangée. Il combine les groupes applicables, conserve la casse des chemins et leurs paramètres, rapproche les octets UTF-8 équivalents et garde distincts les échappements réservés. Les jokers sont évalués sans regex dynamique. Les limites portent sur le document complet, le chemin et un budget de comparaisons partagé.

Une erreur ou un dépassement ne devient pas `ALLOWED`. `robotsReading` garde alors `UNREACHABLE`, le statut, la taille et l’empreinte du corps reçu. Cette observation reste distincte de toute autorisation. Le [contrat maintenu](../../docs/architecture/source-access.md) précise la politique, ses références et ses limites.

## Nettoyage

- Suppression de la fonction inutilisée `botInfoUrlIsServed`, après recherche dans les fichiers suivis et non suivis du dépôt : seuls sa définition et des commentaires de test la nommaient.
- Suppression des commentaires contradictoires 404/200 concernant la page du robot et du renvoi à `apps/web`, supprimé auparavant.
- Suppression de l’import inutilisé `existsSync` et correction du titre de test qui prétendait vérifier une disponibilité réseau.
- Les diagnostics de similarité de nom et de première cible sont décrits comme tels ; ils ne sont plus présentés comme des preuves complètes de certification.
- Le titre d’un ancien test de règles Lever est remplacé par une description des cas exercés. Ses anciennes chaînes ne prétendent plus décrire les réponses actuelles.

## Validation et audit défensif

**3 464 tests réussis** : 2 513 unitaires, 681 d’intégration agrégateur, 259 API et 11 Python. Deux tests API facultatifs restent ignorés. Contrôles de types, build API et parcours des 65 migrations depuis une base isolée vide réussis. Aucun changement de schéma dans ce lot.

Les **71 tests ciblés** couvrent les règles, les observations HTTP, l’identité de collecteur et la séparation d’une observation avec une décision d’autorisation. Les variantes comprennent un groupe nommé vide, plusieurs groupes nommés ou génériques, une exception pour LinkedInBot, BOM et CR, commentaires, chemin avec query, caractères UTF-8, octets réservés, jokers, ancres et limites de ressources.

Les [treize contre-épreuves](preuves/lot-5g3b1-counterproofs.json) réintroduisent chacune une erreur : ignorer notre produit, ne lire qu’un groupe nommé ou générique, mélanger les groupes génériques avec un groupe nommé, laisser Sitemap couper un groupe, omettre la query, mal décoder les octets réservés ou non réservés, perdre l’UTF-8, ignorer la casse du chemin, retirer les limites de document/calcul, ou rendre ALLOWED après une évaluation partielle. Toutes sont détectées. Les 71 tests repassent après restauration.

La [validation finale](preuves/lot-5g3b1-validation.json) et l’[empreinte de runtime](preuves/lot-5g3b1-runtime-match.json) distinguent les fichiers vérifiés et les journaux. Après la suite complète et les preuves natives, seul un titre de test a changé ; les tests ciblés et les types ont été relancés. Le runtime vérifié est identique à celui des preuves ; aucun déploiement n’est réalisé.

## Réponses natives et rejeu S3

La [preuve réelle](preuves/lot-5g3b1-live-robots.json) porte sur deux captures `SOURCE_ACCESS` effectuées sous une source DRAFT isolée dans `catwalks_lifecycle_test` :

| Surface observée | Statut et corps | Chemin évalué | Observation |
|---|---|---|---|
| `https://api.lever.co/robots.txt` | 200, text/plain UTF-8, 38 octets | `/v0/postings/arcteryx.com` | ALLOWED |
| `https://jobs.lever.co/robots.txt` | 200, text/plain UTF-8, 38 octets | `/arcteryx.com` | ALLOWED |

Les deux corps sont identiques, empreinte `6aa3556bd611889c4480a143bb6186f9d0c5e919c6b4c9901f3a6a8141549a1b`. Ils partagent donc un blob ; deux manifestes distincts gardent leur provenance. Les trois blobs uniques sont archivés et leur copie chaude supprimée.

Chaque capture est relue deux fois depuis S3. Les octets et observations restent identiques, avec **zéro requête vers les portails pendant ces quatre lectures**. Le SDK continue à joindre le stockage S3 : ce n’est pas une exécution sans réseau. Les requêtes sortantes du transport sont instrumentées pour vérifier le `User-Agent` effectif de cet essai.

La source reste DRAFT et inchangée. Aucune revue d’identité, aucune publication et aucune autorisation ne sont créées. Cette mesure sur deux chemins ne prouve pas l’accès à tout un portail ni la relation entre un employeur et le site configuré.

## Limite découverte pour le lot suivant

Le fingerprint actuel d’une requête comprend les en-têtes de négociation, mais **pas son User-Agent** ; l’URL du journal est expurgée des valeurs de paramètres. La preuve ci-dessus mesure le collecteur au transport, mais ne prétend pas retrouver cette identité dans les anciennes lignes SQL. Il faut conserver une provenance native suffisante pour les nouvelles captures avant de bâtir la décision d’accès immuable. Aucune migration ne doit inventer ces valeurs pour l’historique.

Les champs mutables `robotsVerdict`/`robotsCheckedAt`, le diagnostic de première cible, la qualification MIME/challenge/fraîcheur et la revérification de l’accès lors des ingestions actives restent ouverts. Les autorisations déjà obtenues sont conservées comme décisions distinctes. L’ensemble du projet n’est pas déclaré prêt pour la production.

## Conservation

La [preuve de conservation](preuves/lot-5g3b1-preservation.json) retrouve les 86 fichiers utilisateur initiaux : 82 restent exactement identiques et les quatre exceptions sont celles déjà documentées. Les 83 configurations initiales restent préservées. La sauvegarde privée `backups/reprise-20260916-lot5g3b1` contient le lot et le matériel de validation. Aucun autre dépôt n’est modifié ou poussé par ce lot.
