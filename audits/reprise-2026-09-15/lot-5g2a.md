# Lot 5G2A — inspection des liens officiels depuis les octets archivés

Validé localement le 16 septembre 2026 : **3 386 tests passent**, build API réussi et onze mutations détectées. Une page officielle réelle est inspectée depuis l’archive Railway de test, sans nouveau contact avec le portail. Aucune migration supplémentaire, aucune écriture en production, aucun déploiement ni changement de cron.

## Résultat

La commande en lecture seule `source-onboard.mts relation CLÉ --capture=CAPTURE --official-domain=DOMAINE` analyse les références d’un document HTML archivé vers le portail natif configuré. Le [guide maintenu](../../docs/architecture/source-onboarding.md) précise ses arguments et limites.

La capture doit être de type `SOURCE_IDENTITY`, complète, récente et liée à la révision courante. Les pages initiale, finale et intermédiaires doivent appartenir au domaine officiellement examiné, en HTTPS. Les suffixes publics et les domaines ATS connus ne valent pas domaine d’employeur. Une erreur de stockage ou d’intégrité reste une erreur d’opération ; elle n’est pas présentée comme une simple absence de lien.

| Contrat initial | Identité vérifiée dans la référence |
|---|---|
| Ashby | Hôte public et board exact, casse du chemin conservée |
| Recruitee | Sous-domaine natif et page racine ou page de langue |
| Workday | Hôte configuré, tenant et site exacts, avec éventuel préfixe de langue |

Les trois collecteurs et l’inspecteur utilisent les mêmes fonctions de lecture des paramètres natifs. Leurs requêtes d’extraction restent inchangées. Les domaines personnalisés, autres familles, formats et paramètres non qualifiés rendent un résultat non prouvé ; aucun rapprochement par nom ou sous-chaîne ne remplit ces lacunes.

## Témoin et sens du résultat

L’analyse utilise le HTML et son encodage déclaré, résout les références relatives et le premier élément `base`, puis recherche un véritable lien ou une iframe. Les commentaires, chaînes JavaScript, templates, texte libre et iframes dont `srcdoc` remplace le contenu sont exclus. Un domaine ressemblant, un autre board, un autre site Workday ou un chemin de détail ne suffisent pas. Un changement du registre pendant la lecture invalide le résultat.

Le rapport conserve l’identifiant de la réponse, l’empreinte du corps, la position du témoin, les empreintes de référence, les noms de paramètres, la politique et l’empreinte de l’inspecteur. Les valeurs des paramètres ne sont pas recopiées dans le rapport. Les octets sources et leur manifeste restent inchangés.

**`LINK_MATCHED` établit une référence au portail configuré. Il n’approuve ni l’identité de l’employeur, ni l’accès, ni l’exhaustivité des offres.** Le rapport porte toujours `identityApproved: false` et `coverageAttested: false`. Une référence Workday peut sélectionner un sous-ensemble avec `jobFamily` ou `locations` ; ces paramètres à identifiants natifs hexadécimaux ont été observés dans la page réelle conservée. Ils ne changent pas le tenant et le site identifiés. Les autres paramètres de routage non qualifiés sont refusés.

Le domaine déclaré reste une information examinée par le réviseur, sans déduction depuis le nom de marque. Le rattachement obligatoire de la revue d’identité à cette preuve constitue le lot 5G2B. L’ancien dossier textuel n’est pas automatiquement converti en capture HTTP ou en approbation issue de cet inspecteur.

## Validation et contre-épreuves

| Contrôle | Résultat |
|---|---:|
| Tests unitaires agrégateur | 2 451 |
| Tests PostgreSQL | 665 |
| Tests API | 259, plus 2 tests de corpus séparés |
| Tests Python | 11 |
| Tests ciblés | 282 |
| Types et build API | PASS |
| Migrations depuis zéro | 64 |
| Mutations détectées | 11 sur 11 |
| Tests restaurés après mutations | 30 |

Les contre-épreuves réintroduisent la preuve par sous-chaîne, l’acceptation du seul fournisseur ATS, l’ignorance de la révision, des statuts de refus, du type de document, du domaine officiel, de `srcdoc`, des challenges et d’un changement concurrent. Elles retirent aussi le contrat de facettes réellement observé et le code de sortie d’échec de la commande. Chaque mutation rend les tests rouges ; la restauration les remet au vert. Le témoin de révision utilise un aller-retour de configuration : retrouver les mêmes paramètres ne réautorise pas une ancienne capture.

La commande réelle est exécutée dans le parcours synthétique complet : capture, inspection positive, inspection du mauvais domaine et vérification qu’aucune requête supplémentaire ni modification du registre n’est produite. Seul le transport des fixtures est remplacé ; PostgreSQL, la capture, l’archive, les parseurs et la CLI sont réels.

Preuves : [validation](preuves/lot-5g2a-validation.json), [contre-épreuves](preuves/lot-5g2a-counterproofs.json) et [runtime testé](preuves/lot-5g2a-runtime-match.json).

## Vérifications réelles

La [page officielle Levi Strauss & Co.](https://www.levistrauss.com/work-with-us/) a répondu HTTP 200. Les **64 432 octets** reçus et leur manifeste ont été archivés sur Railway, puis retirés du stockage local. Le nouvel inspecteur retrouve depuis ces archives un lien vers `levistraussandco.wd5.myworkdayjobs.com/External`, avec des filtres `jobFamily`. Deux inspections à froid donnent le même rapport, sans requête vers le portail. Le rapport distingue la version ayant capturé la page de la version ayant examiné ses octets. La source isolée reste DRAFT et aucune revue d’identité n’est créée. Voir le [reçu de lecture à froid](preuves/lot-5g2a-reinspected-relation.json).

La [page d’aide officielle de Polène](https://support.polene-paris.com/hc/fr/articles/33008461392402-Partenariats-et-Carri%C3%A8res), trouvée par recherche documentaire, renvoie 403 à notre collecteur. L’accueil du site répond 200 après une redirection. Ces réponses distinctes restent archivées ; le résultat du moteur de recherche n’est pas substitué aux octets obtenus par Catwalks et aucune approbation n’en est déduite. Les [reçus HTTP](preuves/lot-5g2a-polene-captures.json) décrivent uniquement ces captures.

## Préservation et suite

Le schéma reste à 64 migrations ; le clone de stock n’a pas été modifié dans ce lot. Les 86 fichiers utilisateur sont contrôlés : 82 identiques et les quatre exceptions des lots précédents conservées. Voir le [rapport de préservation](preuves/lot-5g2a-preservation.json). Les fichiers du lot sont sauvegardés sous `backups/reprise-20260916-lot5g2a/`. La sauvegarde complète au schéma 60 reste la référence de restauration, suivie des migrations 61 à 64 ; aucune nouvelle restauration complète n’est revendiquée.

La prochaine étape rend obligatoire cette provenance dans l’enregistrement et la lecture des revues d’identité, avec conservation des preuves historiques. Les 112 artefacts historiques du clone ont été relus en lecture seule : tous sont présents et leur empreinte correspond à leur texte ; le plus grand pèse 1 974 791 octets. Cet inventaire prépare leur traitement sans leur inventer une provenance HTTP. Les autres familles ATS, les décisions d’accès, les rôles de source et les ingestions déjà actives restent à qualifier avant release.
