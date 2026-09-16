# Agrégateur Catwalks — état vérifié et exploitation

État relu le **16 septembre 2026**. Les anciennes conclusions du 10 septembre ont été remplacées ; leur historique reste dans Git. La référence d’architecture est [production-foundations.md](../../docs/architecture/production-foundations.md).

## État mesuré

L’[audit de reprise](../../audits/reprise-2026-09-15/rapport.md) contient les requêtes, horodatages, résultats et limites de chaque mesure. Ces volumes ne sont pas des constantes du produit.

| Mesure au moment de l’audit | Valeur |
|---|---:|
| Offres conservées / publiques | 87 580 / 83 431 |
| Représentations actives `JobSource` | 85 327 |
| Sources ACTIVE / PAUSED / RETIRED | 437 / 7 / 92 |
| Familles de collecteurs enregistrées | 43 |
| Chemins et types RAW recensés | 3 538 |

La disponibilité publique, la fraîcheur, la complétude de collecte et la certification d’identité sont des mesures différentes. `Source.status=ACTIVE` ne certifie ni une source ni le droit de fermer une annonce absente d’un run.

## Priorités et lots

Le [plan courant](../../audits/reprise-2026-09-15/plan.md) porte les dépendances et critères de sortie. Les défauts établis comprennent le périmètre de refresh, l’expiration, la perte de champs à la réattestation, les salaires décimaux, les négations du télétravail, les rapprochements trop permissifs et le cloisonnement des résultats par pays.

Les lots 0 à 3 corrigent localement la validation, la disponibilité, la capture native et les [faits RAW avec réattestation](../../docs/architecture/source-facts.md). Les [résultats du lot 3](../../audits/reprise-2026-09-15/lot-3.md) distinguent les lectures qualifiées, les absences et les formats encore non interprétés. Ces validations ne constituent pas une bascule du stock de production.

L’architecture cible conserve le RAW avant parsing, puis construit des faits traçables et une projection de recherche commune aux offres directes et externes. Les notions locales ne doivent pas être forcées dans un vocabulaire mondial unique.

Le [lot 4H3](../../audits/reprise-2026-09-15/lot-4h3.md) valide 3 207 tests agrégateur/API et 755 tests du site. Les 55 125 publications reconstructibles ont désormais leur présentation sur le clone ; 294 publications incomplètes restent conservées en quarantaine. Le dernier ID public sans preuve propre devient une fiche retirée, sans fausse fermeture ni redirection supposée. Les formats non qualifiés et la certification des sources restent ouverts. Ces mesures locales ne remplacent pas le tableau initial de production ci-dessus.

Le [lot 5D](../../audits/reprise-2026-09-15/lot-5d.md) remplace le compteur manuel de promotion par une validation native rejouable. Le [lot 5E](../../audits/reprise-2026-09-15/lot-5e.md) lie les revues d’identité à la révision exacte du registre et à un ordre SQL. Les 112 revues historiques du clone sont conservées sans liaison inventée et doivent être réexaminées avant certification. Le [lot 5F](../../audits/reprise-2026-09-15/lot-5f.md) unifie les commandes des sources et supprime les orchestrations anciennes ainsi que la colonne de volume manuel. Les lots [5G2A](../../audits/reprise-2026-09-15/lot-5g2a.md) et [5G2B](../../audits/reprise-2026-09-15/lot-5g2b.md) inspectent les pages natives archivées et rendent cette provenance obligatoire pour toute nouvelle certification. Les contrats positifs couvrent Ashby, Recruitee et les sites Workday qualifiés ; les autres familles, l’accès et le contrôle des ingestions existantes restent ouverts.

Le [lot 5G3A](../../audits/reprise-2026-09-15/lot-5g3a.md) supprime le rattachement automatique de tout nouveau libellé employeur au propriétaire d’un portail SINGLE_BRAND. Les noms natifs gardent leur identité propre à la source ; les alias revus restent applicables. L’inférence d’un employeur absent exige une revue actuelle, dont l’identifiant est conservé. Le lecteur JSON-LD transmet maintenant `hiringOrganization.name` avec sa provenance. Les affectations historiques ne sont pas réécrites par ce lot.

## Commandes de validation

Depuis la racine du monorepo, après `npm ci --workspaces --include-workspace-root` :

```sh
npm run test:local
npm run api:build
npm run build:local -w @catwalks/aggregator
```

`test:local` possède sa base jetable et exécute les migrations puis les suites. Les tests d’intégration écrivent dans leur base : ne jamais leur fournir une base métier ou le corpus conservé comme preuve. `build:local` contrôle l’espace hôte/Docker avant de construire l’image ; il ne déploie pas.

Les [outils d’exploitation](scripts/ops/README.md) décrivent les contrôles maintenus. Les données d’accès restent hors Git. Le transport Railway versionné utilise `CATWALKS_RAILWAY_TOKEN` ou la connexion CLI locale. Exemple de lecture :

```sh
python3 -B apps/aggregator/scripts/ops/railway-service.py status api
python3 -B apps/aggregator/scripts/ops/read-crons.py
```

## Sources et preuves

Le catalogue opérationnel est la table `Source`. `data/seeds/sources.csv` ne remplace pas l’état de production. Le [parcours maintenu des sources](../../docs/architecture/source-onboarding.md) précise l’ajout, les preuves, la validation native et la promotion sous révision explicite. Les inspections de découverte restent distinctes des décisions de qualification.

- Runtime et tests : `src/`.
- Commandes maintenues : `scripts/`.
- Références et entrées explicites : `data/`.
- Mesures datées : `audits/` à la racine.
- RAW volumineux, dumps et secrets : stockage privé, jamais dans les images publiques.

## Déploiement

L’audit a identifié la révision `dd3e24d` sur les services agrégateur, API, refresh et reconcile. Les trois workers étaient gelés (`PIPELINE_PAUSED=1`, sentinelle de calendrier) ; le statut courant doit être relu avant chaque opération. Aucun succès du service API ne prouve celui du worker, ni inversement.

`start.sh` vérifie les migrations et respecte la pause. Les migrations se répètent sur clone avant release ; aucun DDL dans un cron. La livraison requiert révision exacte, migrations, reprise des données et vérification des parcours. Les crons restent gelés durant cette phase ; leur activation est un chantier ultérieur.
