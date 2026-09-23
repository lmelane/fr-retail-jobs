# Audit post-RUN — 23 septembre 2026

## État de livraison

**Suite en cours, 16:25 UTC.** Le RUN quotidien `8b13d1f0-ced1-4380-8ad5-89e33a74587d` a démarré automatiquement à 16:01:58 UTC (18:01 Paris), sur `a532165`. Aucun redémarrage ni changement de registre pendant ce RUN. Correctifs testés localement, pas encore livrés : résumé de source atomique lors d'un échec ; aperçus JSON-LD écartés uniquement si leur fiche native est lue dans la même capture ; RAW RSS/Atom complet et relecture partagée. Validation ciblée : 25 tests accès/santé, 39 tests JSON-LD, 65 tests qualification/relecture/rejets ; typecheck vert.

**Correctifs livrés et mesures immédiates terminées.** Code de production `a532165`, API et worker sur leurs images immuables attestées, CI verte. 39 sources rejouées explicitement avant le RUN quotidien : 24 réussies, 3 partielles, 12 bloquées individuellement. Ce bilan ne prétend pas que toutes les sources ACTIVE ont été rejouées ou sont sans erreur. Aucun nouveau RUN global n’a été lancé pour l’audit. Le calendrier quotidien est rétabli à **18 h Europe/Paris** ; [configuration effectivement chargée](../../docs/operations/railway/runtime-release.json).

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

[153 sources hors exploitation examinées une par une](post-run-source-review.json) : au début de cet audit, 43 PAUSED, 109 RETIRED, 1 DRAFT. Ce relevé daté précède les corrections et qualifications ; le premier relevé après corrections comptait **385 ACTIVE, 43 PAUSED, 109 RETIRED, zéro DRAFT**. Le registre mesuré après les qualifications complémentaires compte **409 ACTIVE, 12 PAUSED, 116 RETIRED**. Caudalie et URBN sont ACTIVE après leurs qualifications explicites ; les décisions complémentaires et leur effet réel figurent dans `followUp` de la revue du catalogue. Réponses publiques archivées, URL/date/empreinte et incertitudes présentes par source. 41 retraits d’homonymes, 4 démonstrations et 2 doublons confirmés sont conservés ; aucune suppression physique d’historique. Le complément WTTJ ci-dessous mesure les organisations réellement présentes et les publications liées à leur capture, sans extrapoler les absences ni la couverture future.

[Plan de corrections du registre](post-run-registry-plan.json) : compare chaque révision avant écriture, préserve les statuts et ne crée aucune décision d’accès. Les 24 corrections ont été appliquées par comparaison atomique des révisions. La DB a automatiquement mis URBN en pause lors du changement de configuration ; les 23 autres statuts sont conservés. Les candidats réparables passent ensuite par les outils de qualification existants. Caudalie a un lecteur explicite de son AJAX public et de ses fiches HTML, avec RAW natif, sans pays/date/employeur inventés.

## Déduplication et cycle de vie

Les **63 décisions de rapprochement du RUN sont vérifiées 63/63** : contenu RAW lié à sa capture, même preuve native reconstruite et empreinte des pairs concordante. L’identité d’une publication repose sur la source et l’identifiant natif ; un changement de texte actualise la publication. Les rapprochements entre sources exigent une preuve qualifiée de la même réquisition ; le titre similaire ne suffit pas. Une republication avec nouvel identifiant sans preuve commune reste distincte.

Limite vérifiée sur deux publications Etam/Undiz : UUID et identifiant Teamtailor identiques, mais le domaine groupe `career.groupeetam.com` diffère de l’émetteur natif `career.undiz.com`. Le lecteur sait attester le domaine natif Teamtailor et le domaine déclaré ; il ne certifie pas un autre domaine personnalisé. Ces deux publications restent distinctes. Cela ne rend pas les 63 rapprochements existants incorrects ; la couverture des alias groupe/marque reste à étendre avec une preuve native de l’alias, sans fusion manuelle sur le titre.

L’API écarte déjà les expirations natives échues. 129 publications ACTIVE étaient expirées dans le registre ; 40 publications appartenaient à des sources PAUSED. Le RUN quotidien appelle désormais le refresh existant sur ACTIVE : expiration, fermeture explicite et absence restent distinctes, avec ingestion scellée et garde de fermeture massive. Un échec ou une capture partielle ne ferme pas les offres précédentes. PAUSED conserve le corpus ; RETIRED ne portait aucune publication active dans ce relevé.

### Incidents de la première série de replays (historique)

- Brown Thomas / Taleo : les 79 contenus de détail passent désormais la qualification ; les 79 publications restent refusées faute d’identité employeur certifiée (`PORTAL_OWNER_NOT_CERTIFIED`). Ne pas assimiler un portail de groupe/concessions à une marque unique.
- Nocibé / EQWA : 274 extractions qualifiées, puis refus d’accès individuel : la réponse `robots.txt` est une page HTML, sans preuve de permission exploitable. Aucun contournement.
- NARS / Radancy : la nouvelle capture est rejouable, mais le sitemap mêle les fiches aux pages de navigation dont plusieurs chemins sont doublement encodés (`%2520`, `%2526`). Le contrôle de périmètre refuse ces URL ambiguës ; il reste inchangé.
- URBN : la configuration des sept origines de détail déclenche correctement la pause de la source. La requalification explicite de cette révision passe le Golden Path, puis l’ingestion refuse les anciens alias liés à l’ancienne empreinte (`ALIAS_SOURCE_OR_TENANT_CHANGED`). Les 11 libellés sont vérifiés indépendamment dans 11 HTML natifs de production ; le seul changement de configuration est la liste des origines régionales. Le mécanisme existant renouvelle ces 11 preuves en conservant les identifiants et sociétés cibles : zéro fusion, zéro déplacement de publication, aucune réécriture d’historique. [Preuves et reçu de requalification](urbn-alias-requalification.json). Le replay normal `3ea19630-b6cb-4167-8fa9-67f52894f184` est COMPLETED : 1476 offres natives, 1476 créations, 0 mises à jour, zéro fusion/erreur.
- WTTJ : premier replay refusé par un défaut de comparaison UUID/référence commerciale ; correction `753645b`, puis replay production `4f7b3ade-b801-4a09-a027-002cd56a2cbd` COMPLETED, 12 créations et zéro erreur.

Caudalie : le premier contrôle produit après 45 créations a révélé que la zone native « Europe (sauf France) » devenait faussement France/Sauf. Correction limitée au lecteur : seules les 14 lignes de zone « France » transmettent ce lieu ; les 31 macro-régions restent intégralement dans le RAW, sans pays ni ville inventés. Les 45 RAW de production sont relus hors réseau, descriptions inchangées. Le replay normal `307b28a2-7f2a-42d6-a469-eb4ea62ed91d` a mis à jour les 45 publications, zéro création/fusion/erreur. La DB confirme 14 FR, 31 pays NULL et zéro ville « Sauf » ; `/emplois` affiche les 14 FR et la fiche native avec son lien de candidature externe. Aucune réparation SQL ni réécriture de l’historique.

## Première série de replays en production (historique)

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

- CI de la première livraison : **2 858 tests unitaires agrégateur**, 260 tests API ; types, build et audit des dépendances verts.
- Intégration sur base de tests jetable : **575 tests**, dont identité légale, qualification quotidienne, accès refusé, lecture réelle du mode opérationnel et absence impossible sur collecte partielle.
- Tests ciblés : 23 cas Caudalie (dont macro-régions), 22 cas de lancement/reprise, 41 cas de révision et accès sur base de tests jetable. Relecture hors réseau des 12 RAW WTTJ et 45 RAW Caudalie de production, empreintes vérifiées.
- Contrat runtime/DST et pause des entrypoints : 41 cas, dont 40 PASS et une variante non applicable ignorée ; aucun accès métier sous pause.
- Preuves de production : 63 rapprochements reconstruits, erreurs/captures réelles conservées. Les anciens exports ne sont jamais réécrits pour obtenir un PASS.

La première livraison s’appuyait sur les replays ciblés, les lectures API et le contrôle produit local. La mesure complémentaire ci-dessous couvre les corrections et qualifications suivantes. Le RUN quotidien complet ne doit pas être présenté comme déjà observé. `/offres`, matching, Direct Offers, onboarding, marchés et filtres sont inchangés.

## Mesure immédiate avant le RUN quotidien

Départ du complément : **12:59:04 UTC**, registre 385 ACTIVE / 43 PAUSED / 109 RETIRED, aucun RUN ouvert. Les états de santé alors enregistrés (264 OK, 34 DEGRADED, 87 BROKEN parmi les ACTIVE) venaient de dates différentes ; ils ne constituent pas un nouveau RUN.

La [mesure complète](post-run-immediate-results.json) conserve toutes les tentatives, captures, RAW, extractions, erreurs et preuves d’ingestion. `latestBySource` isole la dernière tentative ; `total` conserve aussi les échecs antérieurs aux corrections.

| Mesure | Dernière tentative des 39 sources | Toutes les tentatives du complément |
|---|---:|---:|
| Captures | 199 | 265 |
| RAW | 9593 | 15710 |
| Extractions | 9279 | 15529 |
| Créations | 2073 | 4222 |
| Mises à jour | 2148 | 2148 |
| Fusions | 0 | 0 |
| Erreurs d’écriture | 193 | 1169 |

Dernières tentatives : **24 PASS, 3 partielles, 12 bloquées**. Durée cumulée des qualifications et ingestions DB : **2455.3 secondes**, hors attente Railway entre déploiements de configuration. Les refus avant ingestion restent comptés séparément des erreurs d’écriture. Aucun taux de réussite global des ACTIVE n’est déduit de cet échantillon ciblé.

La fenêtre de la première à la dernière exécution mesure **6504.8 secondes**, reprises et attentes de configuration comprises. Les 193 erreurs restantes se répartissent entre Brown Thomas (12 identités non prouvées) et TFG (181 employeurs non certifiés). Les **74 runs** possèdent leurs compteurs de fin persistés : zéro échec de persistance, zéro run ouvert à la sortie. Les qualifications refusées sont des résultats de source, pas des erreurs d’écriture de l’observabilité.

### Défauts corrigés et validés

- **Taleo / Brown Thomas** : le lecteur perdait le `JobPosting.hiringOrganization` natif. Lecture désormais partagée entre réseau et replay, limitée au JSON-LD de la même URL/réquisition : 67 créations sur 79 offres ; 12 identités toujours non prouvées. Descriptions inchangées sur les 79 RAW. Aucune marque unique attribuée artificiellement au portail de groupe/concessions.
- **Radancy / Shiseido Americas** : 38 fiches `/job/`, 84 liens de navigation écartés par le filtre de chemin existant. Révision qualifiée, 38 créations, zéro erreur. La clé historique `nars` demeure stable ; le libellé décrit maintenant le groupe réellement collecté. Garde HTTP inchangé.
- **Expérience fractionnaire** : WTTJ fournit nativement `0.5` année sur 144 offres. Migration `20260923133000_fractional_experience` : `Job.experienceYears` devient décimal, bornes antérieures conservées. Les **50 724 lignes et 6 087 valeurs renseignées** ont exactement la même empreinte ordonnée avant/après (`fd25cad1213d980225ff447b5794ac46`). Aucune réparation historique ni arrondi. Le retour arrière doit conserver le champ décimal et un runtime compatible ; ne pas réutiliser directement une ancienne image au modèle entier après publication des fractions. 34 tests ciblés sur base jetable, création/mise à jour 0.5 puis 1.25, types API/agrégateur verts. 88 migrations appliquées en production.
- **Identités déjà revues** : les alias exacts Showroomprive.com, Promod, Promod - magasin et les quatre marques SMCP sont renouvelés par le mécanisme existant, avec les mêmes identifiants et sociétés cibles. Chaque libellé est prouvé dans le RAW natif courant. Zéro fusion de sociétés, zéro déplacement de publication. Les portails dédiés Polène, APIVITA, APM Monaco, AMI, AMIRI, Iris van Herpen, Siebel et YAYA portent leur portée mono-marque seulement après lecture de leur preuve officielle.

WTTJ après correction : **2 074 offres natives publiées depuis la capture**, dont **144/144 valeurs d’expérience à 0.5 préservées** ; 147 créations, 1 927 mises à jour, zéro erreur/fusion. Une fiche publique authentifiée restitue bien 0.5. La lecture des identifiants WTTJ communs aux canaux encore ACTIVE ne trouve aucun recouvrement au moment de la mesure ; elle ne prouve pas l’absence de doublons portant des identifiants différents.

### Décisions de catalogue

La revue initiale des 153 sources est conservée comme photographie datée ; chaque entrée porte maintenant un `followUp` et le registre effectif. Les qualifications utilisent le Golden Path existant, sans passage forcé en ACTIVE. NYX est repris sur le portail officiel de CSP Cosmetics après revue de cette relation ; son verdict d’ingestion figure dans le relevé.

Le flux sectoriel WTTJ est confronté aux **39 canaux individuels** de la revue : identifiants natifs et publications de la même capture, sans déduction par titre. Les homonymes Bedrock (streaming), FRAME (conseil) et CORUM (finance) restent retirés. Un canal non observé n’est pas déclaré vide. Les retraits de collecteurs doublons ne prouvent jamais la fermeture d’un employeur ; aucune publication historique n’est supprimée. URBN est couvert par son hub à sept canaux, dont 960 offres natives du canal stores-na lors de la mesure.

Les autres identités non établies restent explicitement hors ingestion. Egon Zehnder est retiré comme cabinet de recrutement multisectoriel sans canal sectoriel qualifié ni publication. Les refus individuels restants ne sont pas qualifiés de panne systémique.

Sept collecteurs WTTJ individuels sans publication historique sont retirés après preuve de présence dans le flux sectoriel : A.P.C., Clarins, le canal L’Oréal anciennement libellé Helena Rubinstein, Hermès, Monsieur TSHIRT, Pied de Biche et Sessùn. Zéro offre fermée ou supprimée par ces retraits. Les libellés des portails groupe sont corrigés en TFG, Max Mara Fashion Group, Anglo American / De Beers Group et Titan ; leurs clés restent stables. Max Mara est requalifié après le changement de révision ; De Beers et Titan restent en pause avec leur incident individuel.

### Sources encore partielles ou bloquées

- **brown-thomas-taleo — PARTIAL** : 12 erreurs de collecte ou d’écriture · desc 100% date 81% pays 0% url 100%
- **cotton-on — BLOCKED** : validation native : REJECTED (CONTENT_MISSING); le portail ou le site officiel du registre est servi sous un autre domaine d'employeur (cottonongroup.com.au, registre : cottonongroup.com) : relation à instruire (groupe, distributeur, franchise ou registre)
- **de-beers-london — BLOCKED** : pages officielles inaccessibles à la campagne (403/429/5xx ou capture impossible) : blocage externe, identité ni prouvée ni contredite
- **dim — BLOCKED** : pages officielles inaccessibles à la campagne (403/429/5xx ou capture impossible) : blocage externe, identité ni prouvée ni contredite
- **douglas-sf — PARTIAL** : troncature : 306 collectées, total inconnu · desc 100% date 100% pays 100% url 100%
- **fastrack — BLOCKED** : collecte : HTTP 500 for https://careers.titan.in/api/jobs?…
- **ghost — BLOCKED** : validation native : REJECTED (ENUMERATION_INCOMPLETE, EMPTY_FEED_NOT_NATIVELY_PROVEN)
- **markham — BLOCKED** : 181 erreurs de collecte ou d’écriture · desc 100% date 100% pays 100% url 100%
- **minimalist — BLOCKED** : validation native : REJECTED (ENUMERATION_INCOMPLETE, EMPTY_FEED_NOT_NATIVELY_PROVEN)
- **nimble — BLOCKED** : validation native : REJECTED (ENUMERATION_INCOMPLETE, EMPTY_FEED_NOT_NATIVELY_PROVEN)
- **picard — BLOCKED** : validation native : REJECTED (ENUMERATION_INCOMPLETE, EMPTY_FEED_NOT_NATIVELY_PROVEN)
- **rotate — BLOCKED** : validation native : REJECTED (ENUMERATION_INCOMPLETE, EMPTY_FEED_NOT_NATIVELY_PROVEN)
- **sioux — BLOCKED** : validation native : REJECTED (ENUMERATION_INCOMPLETE, EMPTY_FEED_NOT_NATIVELY_PROVEN)
- **alberto — PARTIAL** : 2 annonces non publiables archivées (2 non résolues) ; énumération prouvée · desc 0% date 100% pays 100% url 100%
- **oniverse — BLOCKED** : validation native : REJECTED (CONTENT_MISSING, REJECTED_NATIVE_ROWS, ENUMERATION_INCOMPLETE)

TFG (clé stable `markham`) : 181/181 réponses natives sans LegalEmployer, BusinessUnit ni Organization nommés ; les textes décrivent plusieurs marques. Le libellé et le niveau du registre sont corrigés en groupe TFG, puis ce canal est remis en PAUSED. Zéro publication historique, zéro retrait d’offre. Aucun employeur déduit du texte libre.

Nocibé reste un incident d’accès externe déjà diagnostiqué : capture `81abadd7-e757-4fc2-b4cc-4b8a8ac1e4bf`, `/robots.txt` → 301 `/` → 302 `/front-jobs.html` → HTML de listing. Ce n’est ni un robots exploitable ni une preuve de challenge anti-bot ; aucune permission inventée. Cotton On expose neuf détails dont description, responsabilités, qualifications et résumé sont réellement vides ; empreintes des neuf extractions vérifiées. Le plafond de rejet n’est pas modifié pour les faire passer.

### État de sortie

API et worker exécutent `a532165`, via les digests CI immuables ; configuration cible, Railway et processus comparés hors secrets. PostgreSQL, son service et son volume sont préservés. Le worker normal est programmé à 18 h Europe/Paris ; lancement de configuration hors créneau attesté sans ingestion globale. Healthcheck, authentification, FR, US, filtre Paris, Caudalie FR et fiche offre vérifiés. Les données natives incomplètes et les identités non établies restent des incidents isolés et visibles ; aucune preuve acquise n’est effacée pour produire un PASS.

### Complément de diagnostic depuis les RAW, 16:10–16:25 UTC

- **Résumé de santé** : 23 écarts entre `Source.lastRunStatus` et le dernier `SourceRun` au relevé de 16:09 ; le chemin d'erreur écrivait le second sans actualiser le premier. Le correctif rend ces écritures atomiques, sans réparation SQL. `NEW` signifie première collecte productive sans run antérieur : ce statut n'est pas une panne.
- **ALBERTO** : capture `fb8275a0-9ca8-4921-b952-1d51794120fe`. Les deux listes portent chacune deux JobPosting pointant vers leurs fiches, également dans le sitemap. Les refus employeur concernent ces aperçus à organisation référencée ; les quatre fiches nomment déjà ALBERTO. Le correctif conserve leurs identifiants, archive les aperçus écartés et ne supprime rien lorsque la fiche manque ou échoue. Les collisions d'identifiants restantes sont signalées à la qualification.
- **Douglas** : capture `fea7e3b4-ee64-44e8-9f58-24fb9c4d95ce`. de_DE annonce constamment 308 offres. Trois parcours de 31 pages donnent 288, 302 puis 302 identifiants cumulés : 924 lignes, six identifiants annoncés non atteints. Pagination externe instable ; augmenter le budget sans preuve n'est pas un correctif. Les 306 offres de l'union des locales restent publiables individuellement, sans preuve d'absence.
- **Oniverse** : capture `d6033526-8a05-4530-9013-9a02db12bd0e`. 734 URL distinctes (722 en-GB, 12 fr-FR), 146 réponses 404 archivées. Les 16 extractions sans contenu portent des noms de pays ; leur description native est vide, et leur page visible ne décrit aucun poste. Aucun texte ni statut d'offre inventé pour passer la qualification.
- **Ghost / Sioux** : les pages annoncent explicitement l'absence d'offres. Le lecteur générique ne possède pas de protocole de zéro HTML qualifié : pause distincte d'une panne ou fermeture d'employeur. Aucun ancien poste fermé sur cette seule interprétation.
- **Nimble / ROTATE** : offres visibles en HTML (Product Developer / E-Commerce Intern), sans publication JSON-LD récupérée. Limite du lecteur, pas un catalogue vide. Aucun adapter particulier ajouté pour forcer la couverture.
- **Minimalist** : rubrique Careers avec candidature spontanée, sans liste structurée identifiée ; pas de zéro natif attesté ni remplacement par un homonyme.
- **Picard** : le HTML RAW publie le lien Atom `https://picard-fashion.com/blogs/karriere.atom`. Lecture publique complémentaire du 16:22 UTC : six annonces intégrales, empreinte `47e37f8204c274a970531720d5d607c073b2b71bf882e606ba854bba1268b045`. Le lecteur RSS existant tronquait le RAW à 2000 caractères et la relecture ne reconnaissait pas ce format. Correctif partagé, sans nouvelle famille d'adapter ; qualification Railway à effectuer après livraison. Cette lecture locale ne vaut pas preuve d'exploitation Railway.
