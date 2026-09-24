# Vérifier `/emplois` en local

Périmètre : recherche publique, marché et langue. `/offres`, matching et onboarding restent gelés. Publication sur `development` uniquement.

## Chaîne réelle

Le site local appelle l’API locale, qui lit la base PostgreSQL `catwalks_consolide_rehearsal` par un tunnel local. Les identifiants restent dans `~/.catwalks/rehearsal-access.json`, hors Git. Ne jamais lancer ces commandes avec une URL de production.

Depuis la racine de l’agrégateur, vérifier le lanceur et produire une référence indépendante des réponses HTTP :

```sh
node --test apps/aggregator/scripts/ops/e2e/avec-rehearsal.test.mjs
bash apps/aggregator/scripts/ops/e2e/avec-rehearsal.sh node --import tsx apps/aggregator/scripts/ops/e2e/ancres-e2e.mts "$HOME/.catwalks/emplois-e2e-baseline.json"
```

Le lanceur impose le nom exact de la base, un hôte local et des connexions en lecture seule. Le contrôle en base vérifie également `current_database()` et `transaction_read_only`. La référence contient les identifiants publiables des offres agrégées **et** directes, sans secret. Elle expire après une heure pour les tests. La régénérer après une ingestion ou une expiration ; ne pas modifier les attentes à la main.

Démarrer l’API dans un terminal dédié :

```sh
NEXT_DIST_DIR=.next-stack bash apps/aggregator/scripts/ops/e2e/avec-rehearsal.sh npm run dev -w @catwalks/api -- --port 3010
```

Depuis le dépôt `catwalks-website`, dans un second terminal :

```sh
npm ci
npx playwright install chromium
EMPLOIS_API_URL=http://localhost:3010 NEXT_DIST_DIR=.next-stack npm run dev -- --port 3020
```

Si une clé `CATALOGUE_API_KEY` est configurée, la fournir aux deux processus et au test via l’environnement privé. Ne pas la placer dans l’URL ou Git. Les ports peuvent changer ; les variables ci-dessous doivent désigner les serveurs locaux correspondants.

Depuis `catwalks-website`, lancer :

```sh
CW_E2E_BASE=http://localhost:3020 CW_E2E_API=http://localhost:3010 \
CW_E2E_BASELINE="$HOME/.catwalks/emplois-e2e-baseline.json" npm run test:e2e
```

## Ce qui est vérifié

- Toutes les locales réellement déclarées par les marchés CA, CH et BE. Aucune locale supplémentaire n’est inventée par le test.
- Toutes les pages API : mêmes identifiants que la référence SQL, pas de doublon, mêmes critères, pays, comptes et curseurs entre locales.
- Navigateur Chromium : changement depuis le sélecteur et retour ; locale du contenu et du document hydraté ; titres, navigation, filtres et pied de page traduits.
- Conservation d’une recherche filtrée non vide et d’une recherche vide contenant des chiffres.
- Marché inconnu observable ; champ `RECHERCHE` réel avec accents, limite des suggestions, sélection et fermeture au clavier ; rendu `FACETTE` distinct.
- Absence de débordement horizontal sur mobile et d’erreurs JavaScript dans le parcours multilingue.

Les tests unitaires restent séparés : un E2E ne se saute pas silencieusement si la chaîne ou la référence manque.

## Contrat de présentation

`locale` est un paramètre d’affichage de `/api/jobs`, `/api/companies` et `/api/offres/:id`. Il est distinct de `langue`, filtre sur la langue native des annonces. Il n’entre ni dans le plan de recherche ni dans l’empreinte du curseur. Le proxy du site le transmet aussi lors de la pagination et de l’ouverture d’une fiche.

Le registre garde la décision sur les dimensions, l’ordre et les types d’interaction. L’API traduit les libellés, jamais le texte de l’annonce. Les traductions complémentaires des métiers et secteurs vivent dans `apps/api/lib/data/taxonomy-labels.json`, séparées des règles de classification. Une traduction native du concept prime ; une traduction complémentaire n’est utilisée que si son libellé anglais de référence n’a pas changé. Un concept nouveau ou renommé conserve son libellé natif jusqu’à traduction.

Limite explicite : le layout racine historique porte encore `html lang="fr"` dans le HTML brut. Le contenu `/emplois` porte sa locale côté serveur et le document est aligné après hydratation. Modifier le layout global est un chantier distinct, susceptible d’affecter les parcours gelés.

## Vérification différentielle du 24 septembre 2026

La branche de travail couvre le contrat français unifié et les filtres stricts :
fixtures PostgreSQL locales pour CDI, CDD, stage, alternance en CDI, freelance et
valeur absente, avec les deux origines d’offres. La locale de l’annuaire ne change
ni ses identifiants, ni ses comptes, ni ses critères de pagination. Les catalogues
front sont contrôlés sans fusion avec le français. Ces preuves ciblées ne clôturent
ni la revue produit de tous les pays ni la traduction de toutes les pages du site.
