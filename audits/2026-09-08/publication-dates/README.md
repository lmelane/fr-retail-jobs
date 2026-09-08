# Dates de publication et Google Jobs — 8 septembre 2026

## Mesure avant correction

Production à 20:26 UTC : 71 419 offres actives, dont 67 098 avec postedAt et 4 321 sans. Le tri principal est postedAt décroissant, dates nulles en dernier, puis firstSeenAt et ID pour départager. Le stock distingue postedAt, firstSeenAt, lastSeenAt et validThrough.

Le témoin Google avant (`google-before.json`) est une page réelle en 200 : postedAt null en base, mais JSON-LD datePosted égal à firstSeenAt. C'est incorrect : Google attend la date originale de publication par l'employeur, et non notre date de découverte. Source primaire : https://developers.google.com/search/docs/appearance/structured-data/job-posting#structured-data-type-definitions (relue le 8 septembre 2026).

Le stock compte aussi cinq dates de publication futures et 79 offres encore actives malgré une échéance passée. Ces deux cohortes restent à analyser ; aucune fermeture ni modification de ces valeurs n'est réalisée par le présent lot.

## Récupérer les dates avant de conclure à une absence

- Magnet : le RAW porte publication_date ; l'adaptateur lisait published_at. Champ corrigé, processing timestamp jamais utilisé comme date de publication.
- Adidas / SuccessFactors : la page affiche une date dans data-careersite-propertyid="date", absente de la microdata recherchée. Lecture du format anglais explicitement observé, sans décoder arbitrairement des dates numériques ambiguës.
- iCIMS : le listing ne suffisait pas. Les détails portent la date et la description intégrale dans un JobPosting ; l'adaptateur lit désormais ce détail avec concurrence bornée.
- Zegna / Altamira : le détail déjà téléchargé portait datePosted dans son JobPosting ; ce champ était ignoré.
- Fenwick / Volcanic : start_date absent de l'API, datePosted présente sur la page détail. Lecture complémentaire si la date manque.
- LVMH : certaines représentations archivées portent publicationTimestamp alors que la date canonique est encore vide ; backfill à partir de cette preuve, pas d'une date inventée.

Un extracteur partagé exige un seul JobPosting sur la page, conserve le nœud source et son empreinte et ignore les dates de WebPage/Blog ainsi que les pages avec plusieurs postes. Les adaptateurs réutilisent cette lecture ; les descriptions iCIMS complètes remplacent l'extrait lors des futures ingestions.

`capture-details.py` lit les URLs réelles exportées en lecture seule, archive les HTML compressés et journalise statut, URL finale, empreinte et heure. Quatre requêtes concurrentes maximum, deux par hôte ; coupe-circuit après erreurs de transport répétées. Un 404/410 individuel ne bloque pas l'hôte entier. Les premières tentatives et les reprises restent dans le journal. Aucun test de charge, aucune création de fausses offres.

`build-evidence.mts` rejoue ces captures et les RAW via les parseurs applicatifs. Dates futures/incohérentes, redirections d'identité non validées, absence dans les formats examinés et blocages de transport restent distincts. Les dates contradictoires d'un même Job ne sont pas arbitrées par un minimum arbitraire.

Premier passage intermédiaire : 1 914 Jobs avec date prouvée, zéro conflit entre les preuves retenues ; la reprise iCIMS continue. Ce chiffre est un résultat de lecture, pas une réparation déjà appliquée.

## Balisage honnête

En attendant une date employeur, la page reste disponible et son lien de candidature fonctionne, mais elle n'émet plus un JobPosting avec une date de découverte faussement présentée comme date de publication. Une date récupérée rétablit automatiquement le balisage. Les dates connues ne sont ni rajeunies ni remplacées. Ceci ne certifie pas à lui seul l'ensemble des exigences Google Jobs : description complète, pays, télétravail, expiration et identité employeur doivent également être justifiés. L'inclusion effective reste une décision de Google.

Validation locale : 1 392 tests unitaires agrégateur, tests du schéma Google et typecheck des deux applications. Les tests de parcours couvrent une offre datée et une offre sans date, avec page et candidature toujours disponibles. Les données de production sont réparées séparément par plans d'avant/après, après fusion et déploiement ; les reçus seront ajoutés après exécution.

## Cohorte finale qualifiée et répétition

Après reprise des URL iCIMS : **2 844 Jobs** avec date prouvée, appuyés par **3 740 représentations**, zéro contradiction entre dates retenues. Douze plans de 250 Jobs maximum, 6 584 opérations au total. Les 1 477 Jobs restants ne sont pas déclarés sans date à la source : des blocages, fermetures, formats à examiner et dates futures restent séparés dans recovery-evidence.json.

Répétition sur copie réelle terminée : 6 584 corrections journalisées et 2 844 événements CORRECTED. 71 419 offres actives et 9 751 France inchangées ; 1 477 dates restent nulles. Tous les RAW, les autres champs métier des Job et les événements d'origine sont identiques aux avant-images. Preuve : rehearsal-proof.json. Aucun de ces chiffres de répétition ne prétend que le backfill a déjà été appliqué en production.

## Production verified after PR26

Main `1b3fe6e13880d413eeaec3016e8dfd41cbcffbed` deployed successfully to the web and all three worker images. The 12 reviewed repair plans applied 6,584 column repairs (2,844 Jobs and 3,740 JobSources). `production-proof.json` verifies every RAW, original observation field and historical event, plus all 2,844 correction events and their ledger. A second application wrote zero rows. Backup SHA-256: `2807b35363c0d812b83d34bae81f4c53c436dba7a1c0d0a9446fab7496e087ab`.

Active jobs remain 71,419; France filter 9,751. Missing publication dates fell from 4,321 to 1,477. `front-production-after.json` proves unchanged API counts and the Adidas witness now emits employer date 2026-08-17. The unresolved L’Oréal witness stays accessible but emits no invented JobPosting date. This proves date repair, not Google indexing or universal eligibility.
