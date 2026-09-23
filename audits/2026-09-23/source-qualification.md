# Qualification et couverture de sources — 23 septembre 2026

## État livré

Code `92c2bb16913f82875b86ee6cb1bf9a5290a7bb72`, promu de `development` vers `main`. CI développement [35919428187](https://github.com/lmelane/fr-retail-jobs/actions/runs/35919428187) et main [35920144449](https://github.com/lmelane/fr-retail-jobs/actions/runs/35920144449) vertes. Les deux images ont été vérifiées hors réseau puis attestées dans les processus Railway. Les versions exactes, commandes chargées et CRON sont dans le [reçu de release](../../docs/operations/railway/runtime-release.json).

Le bilan distingue les réponses HTTP archivées (`RAW`), les sorties d'adaptateur (`extractions`) et les offres effectivement publiées. Les captures de qualification et celles d'ingestion sont distinctes ; leurs volumes ne représentent pas des postes uniques.

Pas de migration, reset ou réparation historique. PostgreSQL et les volumes sont conservés. `/offres`, matching, Direct Offers et marchés/filtres ne sont pas modifiés. Aucun RUN global supplémentaire : uniquement les sources nommées ci-dessous.

## Corrections livrées

- Accès : lecture de règles robots dans une réponse HTML ordinaire, avec anomalie de format conservée ; un échec technique ne devient plus une révocation permanente. Les challenges, murs de connexion, 429, 5xx et réponses non interprétables restent bloquants. Aucune règle `Disallow` n'est retirée.
- DigitalRecruiters : usage du `career_domain` natif lorsque `careers_site_url` manque ; lecture revue de l'employeur déclaré dans chaque `JobPosting`, partagée avec le rejeu. Les 43 offres Naturalia du portail Monoprix conservent Naturalia comme employeur.
- Géographie : `ST-LO` n'est plus interprété comme le code pays ST. Un pays sans preuve reste inconnu ; aucune imputation depuis le nom de l'employeur.
- SAP HTML : `allLocales=true` énumère les langues effectivement publiées par le portail, conserve pagination et compteurs par langue, puis réunit les identifiants natifs. Une langue inaccessible ou un compteur instable interdit une preuve d'absence. Aucun total de langues n'est additionné comme s'il s'agissait de postes uniques.
- Avature : `employerFromDataLayer=true` lit `jobBrand` et `jobCountry` dans les métadonnées publiques d'une fiche, à condition que `jobIDATS` corresponde à cette offre. Aucun JavaScript n'est exécuté. `N/A`, `Multi Brand`, champs absents/ambigus et métadonnées d'une autre offre ne fournissent aucun employeur. RAW et rejeu utilisent le même lecteur, sans règle spécifique Aesop ni attribution globale au groupe L'Oréal.

Validation ciblée : 79 tests SAP ; 50 tests Avature/recovery et typecheck. La CI a ensuite validé les suites du dépôt, le build et les deux images. Le rejeu hors réseau de 1 666 fiches L'Oréal capturées retrouve les mêmes employeurs et pays sans divergence : 914 marques explicites, 752 fiches sans employeur exploitable.

## Aesop : une marque, plusieurs canaux

La [page officielle française](https://www.aesop.fr/careers.html) référence Luxury of Retail, Workday et L'Oréal. La [page américaine](https://www.aesop.com/careers.html) référence L'Oréal et Workday. Ces observations externes établissent les pistes ; elles ne remplacent pas les captures natives exigées par l'admission.

| Canal | Périmètre observé | Traitement |
|---|---|---|
| L'Oréal Careers | La requête fournie comporte un filtre États-Unis : 70 offres. Sans ce filtre, 180 fiches portent explicitement `jobBrand=Aesop`, dans 14 pays | Réutilisation de `l-oreal-professionnel`, qui lit déjà le portail global ; aucune seconde source filtrée Aesop |
| Luxury of Retail | 19 offres du portail, dont deux postes Aesop à Paris (CDI et CDD) | Source distincte `luxury-of-retail` ; employeur natif Luxury Of Retail conservé |
| Aesop Workday | Cinq fiches lisibles : Italie 2, Royaume-Uni 1, Pays-Bas 1, Espagne 1 | Candidate non activée en production : preuve officielle impossible à capturer actuellement |

Depuis Railway, les pages `aesop.com/careers.html` et `aesop.fr/careers.html` renvoient un vrai HTTP 403, `cf-mitigated: challenge`, titre `Just a moment...`, sans liens carrière. Ce n'est ni une confusion avec un message JavaScript décoratif, ni un rejet fondé sur le nom du domaine. Aucun contournement ni décision SQL de certification.

Les cinq Workday ne peuvent pas être ajoutées aux 180 L'Oréal comme autant de postes uniques. Le poste Workday Milan `R1026253` ressemble au poste L'Oréal `250112` ; aucune identité commune de réquisition n'est encore prouvée. Le dédoublonnage ne doit pas fusionner sur un titre et une ville. La marque, l'employeur déclaré et le canal de publication restent distincts.

## Sephora : couverture multilingue réelle

La racine SAP avec sa seule langue par défaut ne représentait qu'une partie du catalogue. Le passage aux langues publiées a produit une capture locale complète de **2 273 identifiants natifs**, 28 pays et 169 offres localisées en France, contre environ 1 894 fiches dans la première ingestion de production en langue par défaut. Capture de référence `5dcf596d-a3b0-4981-964a-6aee59de0db3` : 15 locales, 101 pages, 2 376 réponses HTTP, chaque compteur atteint. Les exemples français `295928` et espagnol `292248` signalés depuis Inside Sephora sont retrouvés.

Une capture suivante a observé un compteur mobile ; elle reste correctement marquée partielle. L'exhaustivité s'apprécie sur une capture et son périmètre, pas sur un nombre figé attendu à chaque exécution. La clé existante `sephora-france` est conservée pour ne pas rompre l'identité des publications ; son portail configuré est mondial.

Inside Sephora affiche 2 186 offres sur la requête fournie, mais son endpoint répond 403 au collecteur. Les compteurs de deux canaux ne prouvent pas à eux seuls leur équivalence. SAP China renvoie vers WeChat ; le canal LVMH fournit déjà 207 offres Sephora en Chine dans l'état lu. La couverture mondiale exige donc l'union des canaux officiels.

**Recouvrement SAP/LVMH : numéro de réquisition concordant sur un exemple, rapprochement non implémenté.** LVMH publie aussi des URL SAP (`company=SephoraUS&jobId=…`). Le poste « Stage Assistant(e) Category Manager France Sephora Collection » est servi sous deux identifiants Catwalks : `cmuduzyld1xm8oa345l7ko92q` (LVMH, lien SAP `company=SephoraUS&jobId=296471`) et `cmuely1ob065zr66fzq6l6g1k` (SAP, page `1369251555`, métadonnée native `data-company-job-code=296471-fr_FR`). Le lecteur d'identité actuel ne rapproche pas ces deux représentations de la même réquisition. Les comptes par canal ne sont donc pas un nombre de postes uniques garanti. Aucune fusion ou réparation historique n'est appliquée dans ce lot. La couverture a été élargie ; l'exhaustivité mondiale et l'absence de doublons entre canaux ne sont pas déclarées acquises.

## Résultats production

| Source / exécution | Collectées | Créées | Mises à jour | Erreurs | Durée ingestion |
|---|---:|---:|---:|---:|---:|
| nocibe-eqwa | 274 | 274 | 0 | 0 | 44.1 s |
| sephora-france (langue par défaut) | 1894 | 1871 | 21 | 2 | 323.3 s |
| monoprix | 738 | 738 | 0 | 0 | 205.2 s |
| bonsoirs | 1 | 1 | 0 | 0 | 1.1 s |
| puma | 652 | 641 | 0 | 0 | 233.2 s |
| gemmyo | 6 | 6 | 0 | 0 | 4.2 s |
| luxury-of-retail | 19 | 19 | 0 | 0 | 3.3 s |
| sephora-france (multilingue) | 2276 | 383 | 1891 | 2 | 400.0 s |
| l-oreal-professionnel | 0 | 0 | 0 | 1 | 2.3 s |

Au total de ces exécutions : **53 lots de capture, 14 005 réponses RAW, 13 385 extractions, 3 933 créations, 1 912 mises à jour, 5 erreurs de collecte/écriture, 11 fiches retenues par le garde employeur, 0 fusion**. Les deux passages Sephora revisitent les mêmes publications : ces compteurs ne mesurent pas des postes uniques. Qualification et ingestion sont incluses dans les captures ; les durées de la table portent uniquement sur l'ingestion. La somme des durées d'ingestion est 1 216,7 s ; les durées parents/enfants ne doivent pas être additionnées comme temps écoulé.

**L'Oréal : qualification obtenue, publication échouée.** La capture native `eb45ec7d-a2f8-406d-8959-186941151b65` contient 1 667 offres, 1 752 réponses RAW et un rejeu exact. La collecte suivante, run `310e7987-eeef-43ee-bc15-9c3392a07b2f`, reçoit trois HTTP 406 sur la première page et publie zéro offre. Aucun import direct de la capture ne contourne le chemin normal. Les 180 Aesop observées localement ne sont donc pas déclarées livrées ; la recherche Aesop US reste vide. L'erreur est isolée à cette source, conservée pour traitement.

**Sephora multilingue :** 2 276 identifiants collectés, `complete=true`, `truncated=false`, 170 FR. Deux pages sans employeur natif sont refusées (`1362963955`, `1362619755`) ; les autres publications sont écrites. Le parent termine en erreur contrôlée, l'ingestion en `COMPLETED_WITH_ERRORS` : aucun PASS sans réserve ni crash mémoire déclaré.

**État final :** 415 sources ACTIVE, 11 PAUSED, 116 RETIRED ; aucun run encore ouvert dans le périmètre et zéro référence de capture manquante parmi les publications actives des sources vérifiées. Le worker `scheduled`, `PIPELINE_PAUSED=0`, CRON `0 16,17 * * *` est chargé sur l'image `92c2bb1`. Son démarrage hors horaire produit `worker.schedule_skipped`. Le prochain passage prévu est le 24 septembre à 18 h Europe/Paris.

Smoke public : health 200, accès sans clé 401, accès autorisé/fiches/filtres/marchés FR et US 200. Périmètres observés : 11 565 offres FR, 35 605 US. Contrat API PASS ; disponibilité Aesop US FAIL (0), distinguée du fonctionnement de l'API. Le site local utilise l'API de production ; les parcours Nocibé et Sephora ont été relus dans `/emplois`, y compris une fiche et son lien natif. Aucun déploiement du site.


Les résultats complets, identifiants de runs, captures, fins d'ingestion, compteurs et état du registre figurent dans [source-qualification-results.json](source-qualification-results.json). Les recherches API peuvent aussi trouver une marque mentionnée dans une description : elles ne servent pas à compter les seules offres de cette marque.

## Limites restantes

- Workday Aesop : capture de provenance bloquée par le site officiel ; aucune activation forcée.
- L'Oréal : HTTP 406 bloque actuellement la publication après qualification. En outre, le groupe et la division ne remplacent pas un employeur absent. Les fiches sans marque exploitable restent refusées individuellement et conservées dans les captures.
- SAP : certaines pages ne contiennent qu'un titre sans description ni employeur ; aucun `SINGLE_BRAND` arbitraire ne les publie.
- Puma : onze fiches sans employeur natif retenues par le garde existant.
- Gemmyo : six fiches accessibles pour un compteur de sept ; aucune fermeture par absence permise sur cette énumération partielle.
- Nocibé : 274 offres publiées, dont 230 FR et 44 sans pays suffisamment prouvé. Ces dernières ne sont pas inventées dans le marché FR.
- Bonsoirs : une offre publiée ; `complete=null` ne constitue pas une preuve d'absence.
- Identité entre canaux : recouvrement SAP/LVMH et possible recouvrement Aesop Workday/L'Oréal non résolus. Ne pas sommer ces flux comme autant de postes uniques.

## Incident Railway `8d8c59aa`

RUN `8b13d1f0-ced1-4380-8ad5-89e33a74587d` du 23 septembre : 409 sources tentées, 375 réussies, 34 en erreur, zéro timeout. Statut DB `COMPLETED_WITH_ERRORS`, sortie volontaire 1 après le bilan, puis arrêt du conteneur. Pic RSS observé 3,23 Go pour une limite de 24 Go ; aucun signal OOM dans les preuves examinées. Le SIGTERM postérieur n'a pas interrompu le RUN. Les indicateurs de santé (349 OK, 33 partielles, 27 en échec) mesurent autre chose que le succès des commandes ; ils ne sont pas interchangeables.

Plusieurs sources ont depuis été rejouées avec succès. L'ensemble des 34 incidents n'est pas déclaré corrigé et le code de sortie n'a pas été changé pour masquer les erreurs.
