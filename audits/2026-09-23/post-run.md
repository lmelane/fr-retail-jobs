# Audit post-RUN — 23 septembre 2026

## État de livraison

**Livraison initiale validée, clôture du catalogue encore en cours.** Le code `1db582d` a passé ses replays ciblés. Ce bilan ne vaut pas qualification des 153 dossiers non opérationnels examinés. Le 23 septembre à 12:59 UTC, le CRON quotidien est temporairement suspendu sous pause pour les replays complémentaires autorisés, puis sera rétabli à 18 h Europe/Paris. Aucun nouveau RUN complet lancé pour cet audit.

Source de vérité : RUN production `ca946bd4-c8ba-40f7-ab8f-ddc1a3095bb1`, image worker `653920c`, RAW et captures immuables. Du 07:51:28 au 09:45:28 UTC : 384 ACTIVE, 255 OK, 35 DEGRADED, 60 BROKEN, 34 ERROR. 1 098 captures (734 JOBS, 364 SOURCE_ACCESS), 74 818 réponses RAW, 120 421 extractions comprenant qualification et ingestion ; 11 791 créations, 20 883 mises à jour, 63 rapprochements. Aucun timeout ni échec de persistance.

## Causes et corrections

La [classification exhaustive des 129 sources non OK](post-run-classification.json) conserve les motifs et captures. Les classes peuvent se recouvrir ; ne pas additionner leurs nombres de sources.

| Cause | Mesure du RUN | Décision |
|---|---:|---|
| Identité native confondue avec un nom d’affichage | 2 846 `SOURCE_NEVER_PUBLISHED_FOR_HOUSE`, 504 `EMPLOYER_TARGET_MISMATCH` | Conserver le libellé légal natif dans une identité limitée à la source ; re-attester une publication portant déjà exactement ce libellé. Aucun rapprochement par ressemblance. |
| Employeur absent / portée non certifiée | 5 677 refus | SmartRecruiters lit son `company.name` natif. Portails : corrections uniquement appuyées par des preuves ; groupes et intermédiaires restent bloqués sans employeur natif. |
| Variation d’identité existante | 1 `EMPLOYER_SPELLING_DIVERGED` | Garde conservé. Une ponctuation ressemblante n’est pas un alias relu. |
| Rejeu non déterministe | 5 résultats divergents, 3 exceptions de rejeu | Erreurs transport enregistrées rejouables, sans trafic ni délai/compteur réseau réel ; métadonnées triées, dates natives sans fuseau déterministes, stack exclue des sorties Workday. |
| Publication et absence confondues | 12 énumérations incomplètes, 5 lots avec lignes natives rejetées | Publier le sous-ensemble qualifié, avec le seuil borné existant ; aucune absence attestée par un lot partiel. Migration versionnée du seul garde de politique v3. |
| Lecteurs de RAW incomplets | WTTJ 2 085, Bash 50, Taleo 75, EQWA 274 | Contenu natif détail conservé et lecteur partagé entre collecte et relecture. WTTJ : l’UUID de recherche correspond au `wttj_reference` du détail, pas à sa référence commerciale ; 12 RAW production relus à l’identique après correction. |
| Zéro natif mal interprété | 2 Greenhouse, 4 Teamtailor | Reconnaître uniquement le zéro terminal natif prouvé. |
| Hub iCIMS mal configuré | 1 475 offres URBN retenues | Sept domaines régionaux exacts observés dans les liens natifs ; aucun joker réseau. |
| Donnée réellement pauvre / incohérente | On : 122 descriptions « - » ; autres contenus/identités insuffisants | Défauts conservés et isolés, aucune valeur inventée. |
| Source externe | Lindex robots challenge, Ralph Lauren chaîne TLS, L’Oréal Pro HTTP 406 | Refus individuels maintenus ; aucun contournement TLS ou accès. |

Autres défauts structurels corrigés : renouvellement de la qualification native après 24 h même si l’accès reste valable 30 jours ; appel du refresh existant dans le RUN quotidien ; suppression des règles concurrentes du rapport opérationnel au profit des véritables contrôles de production.

La tolérance v3 ne publie jamais une annonce refusée, ne supprime pas le contrôle d’accès, ne transforme pas une capture partielle en preuve d’absence et ne réécrit aucune capture historique. Les fortes proportions d’annonces non qualifiées restent bloquantes pour leur source.

## Catalogue

[153 sources hors exploitation examinées une par une](post-run-source-review.json) : au début de cet audit, 43 PAUSED, 109 RETIRED, 1 DRAFT. Ce relevé daté précède les corrections et qualifications ; le registre final compte **385 ACTIVE, 43 PAUSED, 109 RETIRED, zéro DRAFT**. Caudalie et URBN sont ACTIVE après leurs qualifications explicites ; les autres pauses/retraits documentés sont conservés. Réponses publiques archivées, URL/date/empreinte et incertitudes présentes par source. 41 retraits d’homonymes, 4 démonstrations et 2 doublons confirmés sont conservés ; aucune suppression physique d’historique. Les 32 sources WTTJ retirées ne sont pas réputées couvertes tant que le flux sectoriel n’en fournit pas la preuve.

[Plan de corrections du registre](post-run-registry-plan.json) : compare chaque révision avant écriture, préserve les statuts et ne crée aucune décision d’accès. Les 24 corrections ont été appliquées par comparaison atomique des révisions. La DB a automatiquement mis URBN en pause lors du changement de configuration ; les 23 autres statuts sont conservés. Les candidats réparables passent ensuite par les outils de qualification existants. Caudalie a un lecteur explicite de son AJAX public et de ses fiches HTML, avec RAW natif, sans pays/date/employeur inventés.

## Déduplication et cycle de vie

Les **63 décisions de rapprochement du RUN sont vérifiées 63/63** : contenu RAW lié à sa capture, même preuve native reconstruite et empreinte des pairs concordante. L’identité d’une publication repose sur la source et l’identifiant natif ; un changement de texte actualise la publication. Les rapprochements entre sources exigent une preuve qualifiée de la même réquisition ; le titre similaire ne suffit pas. Une republication avec nouvel identifiant sans preuve commune reste distincte.

Limite vérifiée sur deux publications Etam/Undiz : UUID et identifiant Teamtailor identiques, mais le domaine groupe `career.groupeetam.com` diffère de l’émetteur natif `career.undiz.com`. Le lecteur sait attester le domaine natif Teamtailor et le domaine déclaré ; il ne certifie pas un autre domaine personnalisé. Ces deux publications restent distinctes. Cela ne rend pas les 63 rapprochements existants incorrects ; la couverture des alias groupe/marque reste à étendre avec une preuve native de l’alias, sans fusion manuelle sur le titre.

L’API écarte déjà les expirations natives échues. 129 publications ACTIVE étaient expirées dans le registre ; 40 publications appartenaient à des sources PAUSED. Le RUN quotidien appelle désormais le refresh existant sur ACTIVE : expiration, fermeture explicite et absence restent distinctes, avec ingestion scellée et garde de fermeture massive. Un échec ou une capture partielle ne ferme pas les offres précédentes. PAUSED conserve le corpus ; RETIRED ne portait aucune publication active dans ce relevé.

### Limites observées pendant les replays

- Brown Thomas / Taleo : les 79 contenus de détail passent désormais la qualification ; les 79 publications restent refusées faute d’identité employeur certifiée (`PORTAL_OWNER_NOT_CERTIFIED`). Ne pas assimiler un portail de groupe/concessions à une marque unique.
- Nocibé / EQWA : 274 extractions qualifiées, puis refus d’accès individuel : la réponse `robots.txt` est une page HTML, sans preuve de permission exploitable. Aucun contournement.
- NARS / Radancy : la nouvelle capture est rejouable, mais le sitemap mêle les fiches aux pages de navigation dont plusieurs chemins sont doublement encodés (`%2520`, `%2526`). Le contrôle de périmètre refuse ces URL ambiguës ; il reste inchangé.
- URBN : la configuration des sept origines de détail déclenche correctement la pause de la source. La requalification explicite de cette révision passe le Golden Path, puis l’ingestion refuse les anciens alias liés à l’ancienne empreinte (`ALIAS_SOURCE_OR_TENANT_CHANGED`). Les 11 libellés sont vérifiés indépendamment dans 11 HTML natifs de production ; le seul changement de configuration est la liste des origines régionales. Le mécanisme existant renouvelle ces 11 preuves en conservant les identifiants et sociétés cibles : zéro fusion, zéro déplacement de publication, aucune réécriture d’historique. [Preuves et reçu de requalification](urbn-alias-requalification.json). Le replay normal `3ea19630-b6cb-4167-8fa9-67f52894f184` est COMPLETED : 1476 offres natives, 1476 créations, 0 mises à jour, zéro fusion/erreur.
- WTTJ : premier replay refusé par un défaut de comparaison UUID/référence commerciale ; correction `753645b`, puis replay production `4f7b3ade-b801-4a09-a027-002cd56a2cbd` COMPLETED, 12 créations et zéro erreur.

Caudalie : le premier contrôle produit après 45 créations a révélé que la zone native « Europe (sauf France) » devenait faussement France/Sauf. Correction limitée au lecteur : seules les 14 lignes de zone « France » transmettent ce lieu ; les 31 macro-régions restent intégralement dans le RAW, sans pays ni ville inventés. Les 45 RAW de production sont relus hors réseau, descriptions inchangées. Le replay normal `307b28a2-7f2a-42d6-a469-eb4ea62ed91d` a mis à jour les 45 publications, zéro création/fusion/erreur. La DB confirme 14 FR, 31 pays NULL et zéro ville « Sauf » ; `/emplois` affiche les 14 FR et la fiche native avec son lien de candidature externe. Aucune réparation SQL ni réécriture de l’historique.

## Replays ciblés en production

Le [relevé des exécutions](post-run-replays.json) conserve chaque tentative, y compris celles corrigées ensuite. Il distingue les captures de qualification des écritures d’ingestion ; ses totaux ne constituent pas un second RUN global. Dernière tentative des **12 sources : 9 COMPLETED, 1 COMPLETED_WITH_ERRORS (Brown Thomas), 2 FAILED (Nocibé et NARS)**. Les deux zéros natifs attestés sont inclus dans les 9 réussites. Ce sous-ensemble ne mesure pas le taux de réussite des 385 ACTIVE du prochain RUN.

| Source / famille | Validation en production |
|---|---|
| ASOS / SmartRecruiters | 61 créations, zéro erreur ; employeur lu dans le contenu natif |
| Versace / Workday | 38 créations, 14 mises à jour, zéro erreur ; identité légale native conservée |
| Bash / WTTJ | 50 créations, zéro erreur ; détails RAW complets et rejouables |
| Madame Figaro / WTTJ | 12 créations, zéro erreur après correction UUID / référence commerciale |
| Bernadette / Greenhouse | Zéro natif terminal attesté ; aucune erreur |
| Tropicfeel / Teamtailor | Zéro natif terminal attesté ; aucune erreur |
| Goyard / SuccessFactors | 21 créations, zéro erreur ; 13 FR, autres pays natifs préservés |
| Caudalie / AJAX natif | 45 publications, puis 45 mises à jour du lecteur géographique ; 14 FR, zéro erreur |
| URBN / iCIMS | 1476 créations, 0 mises à jour, zéro fusion/erreur après renouvellement des preuves natives |
| Brown Thomas / Taleo | 79 contenus qualifiés ; 79 refus employeur, aucune publication forcée |
| Nocibé / EQWA | 274 extractions qualifiées ; robots non exploitable, source individuellement bloquée |
| NARS / Radancy | 38 extractions ; URL de navigation hors périmètre, source individuellement bloquée |

Dernières tentatives par source : 33 lots de capture, 2676 RAW, 2428 extractions ; 1658 créations, 59 mises à jour, 0 fusion. Les 79 erreurs d’écriture restantes appartiennent à Brown Thomas ; les deux refus de qualification/admission sont comptés à part. Toutes tentatives conservées : 63 captures, 5865 RAW, 5526 extractions, 1703 créations et 59 mises à jour. Les 1555 erreurs d’écriture de cet historique comprennent le premier replay URBN refusé ; elles ne sont pas effacées après correction. URBN final : 452.6 secondes. Les durées et heartbeats de chaque run sont dans le relevé.

## Nettoyage et configuration

26 brouillons sans appel/import/processus actif retirés après archive et vérification SHA-256 ; trois copies inactives supprimées après restauration vérifiée. Les copies actives, changements uniques, bases et conteneurs préexistants sont conservés. Les JSON historiques utiles restent inchangés. Deux exports CSV racine, archivés à l’identique, et trois caches Python générés ont aussi été retirés du checkout. Le script de correction d’ATS refuse désormais un kind invalide, maintient domaine/tenant ensemble et protège la révision contre une écriture concurrente.

CRON chargé : **18 h Europe/Paris une fois par jour**, été/hiver. Railway déclenche aux deux heures UTC possibles ; `scheduled` sort avant DB/réseau au créneau qui ne correspond pas. Le [reçu de livraison](../../docs/operations/railway/runtime-release.json) confirme cible = Railway = processus, hors secrets. Le lancement de configuration hors créneau a produit `worker.schedule_skipped`, sans activité DB/réseau. Aucun ancien service de production ne subsiste : PostgreSQL + API + worker. Premier départ prévu : **23 septembre 2026 à 18 h Paris (16 h UTC)**. Les pings Healthchecks fonctionnent ; la réception des alertes et le délai configuré dans le compte ne sont pas prouvés par ces réponses HTTP et restent distincts du calendrier Railway. Aucun nouveau dashboard/service/outil d’observabilité.

## Validation technique

- CI du code livré : **2 858 tests unitaires agrégateur**, 260 tests API ; types, build et audit des dépendances verts.
- Intégration sur base de tests jetable : **575 tests**, dont identité légale, qualification quotidienne, accès refusé, lecture réelle du mode opérationnel et absence impossible sur collecte partielle.
- Tests ciblés : 23 cas Caudalie (dont macro-régions), 22 cas de lancement/reprise, 41 cas de révision et accès sur base de tests jetable. Relecture hors réseau des 12 RAW WTTJ et 45 RAW Caudalie de production, empreintes vérifiées.
- Contrat runtime/DST et pause des entrypoints : 41 cas, dont 40 PASS et une variante non applicable ignorée ; aucun accès métier sous pause.
- Preuves de production : 63 rapprochements reconstruits, erreurs/captures réelles conservées. Les anciens exports ne sont jamais réécrits pour obtenir un PASS.

La livraison initiale s’appuie sur les replays ciblés, les lectures API authentifiées, le contrôle produit local et le reçu du calendrier effectif. La clôture de mission exige encore les qualifications du catalogue corrigé et le traitement des trois investigations ouvertes. Le premier RUN quotidien complet après ces corrections est prévu à 18 h : il ne doit pas être présenté comme déjà observé. `/offres`, matching, Direct Offers, onboarding, marchés et filtres sont inchangés.

## Complément immédiat avant le RUN quotidien

À la demande de Loïc, les mesures complémentaires partent de la production à **12:59:04 UTC** : 385 ACTIVE, 43 PAUSED, 109 RETIRED, aucun RUN ouvert ; santé enregistrée des ACTIVE : 264 OK, 34 DEGRADED, 87 BROKEN. Ces états agrègent des exécutions datées différentes ; ils ne constituent pas un nouveau RUN.

Deux défauts locaux sont confirmés dans les RAW :

- Taleo : sur 79 publications de la capture `171319d5-466e-4284-bb50-7b41d188c774`, 67 portent un `JobPosting.hiringOrganization` exploitable ; le lecteur perdait ce champ. Le correctif ne reprend que le JSON-LD de la même URL et réquisition, partagé entre collecte et relecture. Les 12 autres identités restent non prouvées. Les 79 descriptions sont inchangées au replay hors réseau.
- Radancy : le sitemap de la capture `7c9f0016-c5fa-4369-b46d-1d3b08cb62d4` contient 38 chemins `/job/` et 84 pages de navigation. Le lecteur sitemap réutilise le filtre de chemin littéral déjà disponible pour les listings. La sélection doit être enregistrée dans la révision NARS avant requalification ; la garde HTTP reste inchangée.
- Nocibé : capture d’accès `81abadd7-e757-4fc2-b4cc-4b8a8ac1e4bf` : `/robots.txt` → 301 `/` → 302 `/front-jobs.html` → 200 HTML « Liste des offres @ Nocibé ». C’est une redirection vers le portail, sans robots exploitable, pas une panne du lecteur EQWA ni une preuve de refus anti-bot. Aucun droit n’est déduit de cette réponse.

Tests ciblés du correctif : 66 tests, typecheck agrégateur, et relecture des 79 RAW Taleo avec vérification des empreintes, sans réseau. Publication CI et replays en production à compléter avant de déclarer ces correctifs livrés.

Le replay immédiat WTTJ `990f4ff1-6d2c-4bfd-81b0-9ac8c4207928` révèle un défaut de représentation : le lecteur conserve `experience_level_minimum: 0.5`, mais `Job.experienceYears` est entier. La publication refuse cette valeur native valide. La correction élargit ce seul champ aux fractions et conserve ses anciennes bornes numériques ; aucun arrondi ni remplacement de la donnée native. Une migration non destructive est nécessaire avant livraison des deux runtimes. Tests ciblés sur base jetable : 34 PASS, création et mise à jour des valeurs 0.5 puis 1.25 dans la publication et dans Job ; typechecks API/agrégateur verts. Les preuves de livraison et de replay seront ajoutées après leur exécution.
