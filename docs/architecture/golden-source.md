# Golden Path : ajouter une source depuis zéro

Ce témoin exerce le parcours maintenu, avec de vraies captures. Il ne réutilise ni la qualification ni les offres d’une source déjà présente. Il ne modifie aucune base existante.

## Prérequis

- Dépendances installées, client Prisma généré et services PostgreSQL/MinIO de la [stack locale](../stack-locale.md) démarrés.
- Révision de code identifiée et stable. Pour une preuve de release, exécuter depuis une archive de cette révision ; les fichiers locaux non suivis ne doivent pas faire partie du lecteur.
- Dossier candidat privé, obtenu en inspectant le portail officiel. Pour la campagne, c’est un objet de la forme ci-dessous. Les champs `domain` et `domainSource` décrivent la provenance à vérifier ; ils ne valent pas certification.

```json
{
  "key": "oh-my-cream",
  "maison": "Oh My Cream",
  "kind": "teamtailor",
  "config": { "origin": "https://careers.ohmycream.com" },
  "careersDomain": "careers.ohmycream.com",
  "tier": "EMPLOYER_DIRECT",
  "domain": "ohmycream.com",
  "domainSource": "Portail carrière sur le sous-domaine officiel ; relation à vérifier par la nouvelle capture",
  "portalScope": null
}
```

Le palier décrit ici le portail employeur sur son propre domaine. La famille technique reste Teamtailor. Ne pas transformer les filtres géographiques de l’URL de découverte en périmètre de collecte implicite.

## Commande

Depuis la racine du dépôt, choisir un dossier de preuve qui n’existe pas encore :

```sh
npm run stack:exec -- node --import tsx apps/aggregator/scripts/ops/golden-source.mts \
  --candidate=/chemin/prive/candidate.json \
  --out-dir=/chemin/prive/golden-source-nouvelle-execution \
  --reviewer=IDENTIFIANT_DU_REVISEUR
```

Le lanceur refuse toute base parente autre que `catwalks_stack_catalogue` sur loopback, tout stockage distant et tout dossier de preuve déjà existant. Il crée sa propre base `catwalks_golden_source_test_*` et son préfixe MinIO. Les journaux et JSON restent privés, hors Git. Aucun secret n’est nécessaire dans la commande.

## Ce que PASS prouve

1. Toutes les migrations s’appliquent sur une base vide, sans semer une source fictive.
2. Le candidat est réellement créé, puis qualifié par `source-campaign` et les fonctions de `source-onboard` : identité VERIFIED, accès ALLOWED, collecte native et rejeu exact.
3. Une première ingestion publie toutes ses sorties : admission, fin immuable, zéro retenue/échec/exclusion, et liens offre → capture → sortie.
4. Le rejeu hors réseau de cette ingestion est validé.
5. Réenregistrer le même candidat conserve sa source et sa révision.
6. Une deuxième ingestion conserve exactement les identifiants et le nombre d’offres, sans création supplémentaire ; ses propres captures et sa fin sont vérifiées puis rejouées.
7. `getJobs(parseFilters(...))`, utilisé par l’API `/emplois`, rend exactement les identifiants SQL du périmètre demandé, avec pagination. Les marchés composés utilisent le périmètre du moteur (GB + IE, DE + AT).
8. Le plan de refresh est lu sans appliquer de fermeture ; l’éligibilité à prouver une absence reste explicitement mesurée dans le rapport.

Le test d’idempotence suppose un portail stable entre ses deux collectes rapprochées. Si le portail change réellement, examiner les captures et relancer : ne pas masquer la différence pour produire un PASS. Ce témoin strict ne convient pas tel quel à une source dont l’exclusion sectorielle est intentionnelle.

## Lecture et limites

`proof.json` contient le lecteur, les identifiants d’admission/fin, les compteurs, la lecture API et le verdict d’absence. `environment.json` identifie la base et le préfixe d’archive sans mot de passe. Chaque étape conserve son journal ; une erreur interrompt le parcours et laisse les preuves inspectables. Après conservation du bilan, supprimer uniquement les bases temporaires identifiées de cette exécution, jamais une base existante de la stack ou de répétition.

Une première collecte ne prouve aucune absence. Une seconde collecte complète peut devenir attestante sans constater de disparition. Le témoin ne force pas une fermeture et ne simule pas une disparition sur le portail réel. Un pays absent du RAW reste inconnu : l’annonce n’entre pas artificiellement dans un marché localisé.

Le Golden Path exige une identité VERIFIED en supplément des portes obligatoires de F5. Il valide ce parcours pour la source examinée et la révision testée ; il ne débloque ni CRON, ni déploiement global, ni `/offres` et matching.

Contrôles rapides des refus avant écriture :

```sh
node --test apps/aggregator/scripts/ops/golden-source.test.mjs
npm run typecheck -w @catwalks/aggregator
```

Résultat daté : [Oh My Cream, 22 septembre 2026](../../audits/2026-09-22/golden-source.md).
