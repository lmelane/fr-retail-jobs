# Remédiation P0 et audit de l’identité

Lire d’abord [l’audit des causes](AUDIT-IDENTITE-RACINE.md), puis les tableaux de preuves. Le rapport initial dans `../reaudit` reste une photographie avant correction ; ses qualifications trop larges sont rectifiées explicitement ici.

**Mise à jour : les cinq lots sont fusionnés, déployés et appliqués en production.** Voir [l’état exact et les preuves après](ETAT-PRODUCTION.md). Les nouvelles questions de couverture France et FashionJobs sont mesurées séparément dans [la comparaison FashionJobs](FRANCE-FASHIONJOBS.md).

## Périmètre préparé

| Lot | Réparation répétée sur copie restaurée | Plan SHA-256 |
|---|---|---|
| Oracle | 38 conflits, 40 réquisitions, 42 Jobs conservés ; 85 lignes corrigées | ee8210da8eddbb9c7fa2d5e919cc7b20987de160328a1743cf02ea5bd3a39efe |
| SMCP | 275 attributions explicites + 180 offres sans marque prouvée rattachées au groupe ; 461 lignes | 7cd262437689be9f69a6aa964e3f378e23b4c8378c945484dd4b1f70216401f6 |
| VIA / ASHOKA | 161 offres exclues du secteur, sans suppression ; 326 lignes | d4c61b846b3113b8486fece377378443fb6f41cba66abcb9eaefbbb607057c1d |
| 18 autres homonymes | 210 offres exclues du secteur, sans suppression ; 456 lignes | f7eb921a0b5cdeae37da618f345b595f8210cf0d2ae13447cf0ddc5989aa208e |
| Propriétaires et marques de portail | Chanel, L’Oréal, Lovisa et Farfetch : 3 790 Jobs réattribués ; 3 800 lignes | aab76370e1bf7143ce44a438de58709d7b38bc42d86dc7fa884c8ce93ee9493d |

Le contrôle d’activation exige désormais une décision `SourceIdentityReview` VERIFIED, avec le propriétaire canonique, le tenant, l’empreinte de configuration, une URL officielle, une preuve UTF-8 conservée en base et son SHA-256, un auteur de revue et une date de moins de 30 jours. Une nouvelle décision contradictoire supplante une ancienne validation. Un simple nom identique, un hôte ATS et un compteur ne suffisent plus. Les sources déjà ACTIVE ne sont pas retirées en bloc ; leur requalification reste un travail distinct.

Un dossier de preuve doit établir explicitement le lien propriétaire ↔ portail. Les méthodes admises sont OFFICIAL_LINK, OFFICIAL_DOMAIN et GROUP_DOCUMENT ; ces noms ne remplacent pas la revue de la pièce. Le programme vérifie l’intégrité et l’adéquation de la décision au périmètre ; il ne prétend pas prouver sémantiquement une identité à partir d’une ressemblance de texte.

## Preuves et exécution

- Backup réel PostgreSQL restauré sans erreur sur PostgreSQL 18.6, dans deux bases isolées. Aucun test d’intégration ne tourne sur ces bases ; les tests destructifs ont leur base `catwalks_remediation_test`.
- `promotion-witness.json` : les métadonnées réelles Coast sont acceptées par le code b7aa6da sans preuve employeur dans une base de test ; le correctif les refuse.
- Témoin Oracle : deux vraies réquisitions Wailea 63681 / 63683 fusionnent avec b7aa6da ; les tests du correctif les séparent et empêchent leur refusion par reconcile.
- Chaque plan vérifie tous ses états initiaux avant écriture, prend les verrous des sources et employeurs, enregistre avant/après dans DataCorrection et ajoute des événements CORRECTED. Aucun ID, firstSeenAt ou ancien événement n’est supprimé.
- Les invariants contrôlent le résultat global, y compris les lignes non modifiées. Une erreur annule la transaction. Un plan déjà appliqué écrit zéro ligne.
- `verify-production.mts` compare tous les IDs de Jobs, JobSources, JobEvents et les firstSeenAt avec la sauvegarde, pas seulement les nombres de lignes.

Les plans complets et snapshots contiennent du RAW de production et restent privés sous `backups/remediation-20260908/`. Ne pas les publier dans Git. Leurs empreintes ci-dessus identifient exactement le contenu exécuté. Les sorties avant/après et identifiants de déploiement doivent être ajoutés au compte rendu après exécution ; la répétition locale ne vaut jamais preuve de production.

Exécution depuis la racine, avec DATABASE_URL fourni par l’environnement de confiance :

```sh
node --import tsx apps/aggregator/src/remediation/cli.ts apply --plan <plan-prive.json> --sha <empreinte-ci-dessus> --commit <SHA-complet-sur-main>
```

La commande refuse une connexion distante depuis un checkout applicatif modifié ou un commit absent de `origin/main`. Appliquer les lots dans l’ordre du tableau et vérifier chaque résultat. Si un état initial a changé, reconstruire et revoir le plan ; ne pas contourner le refus.

Qualification d’une source, après revue des preuves officielles :

```sh
node --import tsx apps/aggregator/src/cli.ts identity-profile <sourceKey>
node --import tsx apps/aggregator/src/cli.ts review-source-identity --record=<decision.json> --artifact=<preuve-utf8.html>
node --import tsx apps/aggregator/src/cli.ts review-source-identity --record=<decision.json> --artifact=<preuve-utf8.html> --apply
node --import tsx apps/aggregator/src/cli.ts promote <sourceKey>
```

La décision reprend les quatre identifiants du profil et renseigne verdict, method, officialDomain, proofUrl, portalUrl, statement, artifactHash, reviewer et checkedAt. Le contenu de l’artefact est enregistré par la commande ; un document absent ou altéré bloque l’écriture. Les statuts CONTRADICTED et UNRESOLVED sont conservables mais n’autorisent aucune promotion.

## Fichiers de recherche préexistants

Les exports `apps/aggregator/data/A-TROUVER-loic.csv`, `GROSSES-ENSEIGNES-MANQUANTES.csv`, `a5-probe-*.json`, `baseline-2026-09-06*.json`, `tenants.detection.progress.tsv`, `w1-wttj-sector-flbl.json` et les lignes ajoutées à `deadhost.rescue.tsv` sont des archives de recherche. Leur conservation ne valide ni les identités, ni la fraîcheur des URLs, ni une activation. Les notes et compteurs anciens doivent rester datés et ne remplacent pas la production du 8 septembre.

## Reste à traiter

La certification individuelle des sources restantes, le modèle complet groupe / marque / employeur juridique, les P1 fraîcheur, géographie, dates, séniorité, compteurs et provenance restent ouverts. Aucune nouvelle source de la liste des 38 dossiers n’est activée par cette livraison.
