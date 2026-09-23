# Audit post-RUN — 23 septembre 2026

## État de livraison

**Corrections locales testées ; CI, livraison et replays production encore à effectuer.** Ce document sera complété avec les reçus effectifs. Aucun nouveau RUN complet lancé pour cet audit.

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
| Lecteurs de RAW incomplets | WTTJ 2 085, Bash 50, Taleo 75, EQWA 274 | Contenu natif détail conservé et lecteur partagé entre collecte et relecture. |
| Zéro natif mal interprété | 2 Greenhouse, 4 Teamtailor | Reconnaître uniquement le zéro terminal natif prouvé. |
| Hub iCIMS mal configuré | 1 475 offres URBN retenues | Sept domaines régionaux exacts observés dans les liens natifs ; aucun joker réseau. |
| Donnée réellement pauvre / incohérente | On : 122 descriptions « - » ; autres contenus/identités insuffisants | Défauts conservés et isolés, aucune valeur inventée. |
| Source externe | Lindex robots challenge, Ralph Lauren chaîne TLS, L’Oréal Pro HTTP 406 | Refus individuels maintenus ; aucun contournement TLS ou accès. |

Autres défauts structurels corrigés : renouvellement de la qualification native après 24 h même si l’accès reste valable 30 jours ; appel du refresh existant dans le RUN quotidien ; suppression des règles concurrentes du rapport opérationnel au profit des véritables contrôles de production.

La tolérance v3 ne publie jamais une annonce refusée, ne supprime pas le contrôle d’accès, ne transforme pas une capture partielle en preuve d’absence et ne réécrit aucune capture historique. Les fortes proportions d’annonces non qualifiées restent bloquantes pour leur source.

## Catalogue

[153 sources hors exploitation examinées une par une](post-run-source-review.json) : 43 PAUSED, 109 RETIRED, 1 DRAFT. Réponses publiques archivées, URL/date/empreinte et incertitudes présentes par source. 41 retraits d’homonymes, 4 démonstrations et 2 doublons confirmés sont conservés ; aucune suppression physique d’historique. Les 32 sources WTTJ retirées ne sont pas réputées couvertes tant que le flux sectoriel n’en fournit pas la preuve.

[Plan de corrections du registre](post-run-registry-plan.json) : compare chaque révision avant écriture, préserve les statuts et ne crée aucune décision d’accès. Les candidats réparables passent ensuite par les outils de qualification existants. Caudalie a un lecteur explicite de son AJAX public et de ses fiches HTML, avec RAW natif, sans pays/date/employeur inventés.

## Déduplication et cycle de vie

Les **63 décisions de rapprochement du RUN sont vérifiées 63/63** : contenu RAW lié à sa capture, même preuve native reconstruite et empreinte des pairs concordante. L’identité d’une publication repose sur la source et l’identifiant natif ; un changement de texte actualise la publication. Les rapprochements entre sources exigent une preuve qualifiée de la même réquisition ; le titre similaire ne suffit pas. Une republication avec nouvel identifiant sans preuve commune reste distincte.

L’API écarte déjà les expirations natives échues. 129 publications ACTIVE étaient expirées dans le registre ; 40 publications appartenaient à des sources PAUSED. Le RUN quotidien appelle désormais le refresh existant sur ACTIVE : expiration, fermeture explicite et absence restent distinctes, avec ingestion scellée et garde de fermeture massive. Un échec ou une capture partielle ne ferme pas les offres précédentes. PAUSED conserve le corpus ; RETIRED ne portait aucune publication active dans ce relevé.

## Nettoyage et configuration

26 brouillons sans appel/import/processus actif retirés après archive et vérification SHA-256 ; trois copies inactives supprimées après restauration vérifiée. Les copies actives, changements uniques, bases et conteneurs préexistants sont conservés. Les JSON historiques utiles restent inchangés. Le script de correction d’ATS refuse désormais un kind invalide, maintient domaine/tenant ensemble et protège la révision contre une écriture concurrente.

Cible CRON : **18 h Europe/Paris une fois par jour**, été/hiver. Railway déclenche aux deux heures UTC possibles ; `scheduled` sort avant DB/réseau au créneau qui ne correspond pas. Le calendrier chargé et les variables seront attestés dans le reçu de livraison. Aucun nouveau dashboard/service/outil d’observabilité.

## Validation acquise avant CI

- Suite unitaire agrégateur : 2 837 tests au premier passage complet ; les ajouts récents sont couverts par tests ciblés et seront repris par la CI.
- Intégration sur base de tests jetable : **575 tests**, dont identité légale, qualification quotidienne, accès refusé, lecture réelle du mode opérationnel et absence impossible sur collecte partielle.
- Derniers tests lecteurs : 76 tests ; raccord Caudalie et WTTJ/WTTJ-sector : 29 tests.
- Types application/scripts, contrat runtime et DST : verts.
- Preuves de production : 63 rapprochements reconstruits, erreurs/captures réelles conservées. Les anciens exports ne sont jamais réécrits pour obtenir un PASS.

Le déploiement et les replays ciblés restent requis avant le GO final. `/offres`, matching, Direct Offers, onboarding, marchés et filtres sont inchangés.
