# Identité des employeurs et des sources

Relecture du code : **10 septembre 2026**, révision `6ac43ec` et modifications locales de nettoyage. Documentation technique liée au [README de l’agrégateur](../apps/aggregator/README.md), qui reste l’unique état de pilotage. Les nombres de sources certifiées, alias et offres doivent provenir de mesures datées ; ils ne sont pas figés ici.

## Objets à ne pas confondre

| Objet | Identité et rôle |
|---|---|
| Maison, marque, enseigne ou groupe | `Company.id`, `canonicalKey`, `Company.kind` |
| Parent groupe | `Company.parentGroupId`, relation revue vers une société GROUP ; pas un alias |
| Secteurs | `Company.sectorCodes` et référentiel `SectorConcept` ; indépendants du type d’employeur et des familles métier |
| Source carrière | `Source.key`, configuration et `tenantKey` ; un groupe peut publier plusieurs Maisons sur un même portail |
| ATS | Protocole et adaptateur ; son nom ne prouve pas l’identité de l’employeur |
| Offre native | Représentation `JobSource` identifiée par source et identifiant externe |
| Offre canonique | `Job`, distinct de ses représentations et de l’identité de l’employeur |

L’objectif est une attribution fidèle à l’organisation réelle. Deux noms proches, un domaine partagé ou un ATS commun ne suffisent pas à fusionner des sociétés. Une entité juridique différente ne signifie pas automatiquement une marque publique différente. Garder les libellés natifs permet de préserver ces distinctions.

## Certification d’un portail

[registerSourceCandidate](../apps/aggregator/src/connectors/sourceCandidate.ts) crée un candidat en DRAFT, refuse les collisions de tenant et ne remplace pas une configuration opérationnelle. Son succès n’est pas une preuve officielle.

Dans [sourceIdentity.ts](../apps/aggregator/src/connectors/sourceIdentity.ts) :

- `sourceIdentityHash()` lie clé, propriétaire déclaré, kind, configuration, domaine carrière, tenant et tier.
- `requireSourceIdentity()` sélectionne la dernière revue, y compris une contradiction, puis appelle `assertIdentityReview()`.
- Le validateur strict exige VERIFIED, le bon sujet/source/tenant/hash, une vérification datant de moins de 30 jours, une méthode admise, un auteur, une déclaration et un artefact dont le contenu correspond au SHA-256. Les URLs et le domaine officiel sont également contrôlés.
- Ces validations contrôlent la cohérence du dossier. Elles ne remplacent pas l’examen de la preuve officielle ni une observation actuelle du portail.
- La promotion vérifie aussi la configuration, le verdict d’accès daté et au moins une offre réellement vérifiée. Un portail sans offre peut être documenté sans activation.

**Dette ouverte :** `certifiedPortalScope()` vérifie la dernière revue VERIFIED et son hash mais ne réexécute pas le validateur strict complet. `loadActiveSources()` ne revalide pas les dossiers des sources déjà ACTIVE. Ne pas documenter ces deux chemins comme apportant la même garantie que la promotion.

Depuis la racine, avec des accès explicitement configurés pour l’environnement choisi :

```sh
node --import tsx apps/aggregator/src/cli.ts identity-profile SOURCE_KEY
node --import tsx apps/aggregator/src/cli.ts review-source-identity --record=/chemin/revue.json --artifact=/chemin/preuve.txt
```

La seconde commande valide sans enregistrer. L’enregistrement exige `--apply` ; l’activation est une commande distincte `promote SOURCE_KEY`, après les préconditions et la revue du lot. Aucun de ces exemples ne constitue un feu vert pour une exécution en production.

## Résolution effective d’un employeur

Le pipeline conserve `rawEmployerName`, son origine et le RAW. [normalizedEmployerName](../apps/aggregator/src/normalize/employerName.ts) applique NFKC, espaces et casse ; il ne supprime pas automatiquement les nombres, pays, suffixes juridiques ou mots comme Retail.

[resolveEmployer](../apps/aggregator/src/identity/resolve.ts) applique les chemins suivants, dont certains restent hérités :

| Règle | Comportement du code relu |
|---|---|
| `REVIEWED_ALIAS` | Alias revu dans la portée exacte de la source et lié à son hash. Les conflits de racines ou une liaison modifiée déclenchent une revue. Un alias global ne suffit pas à autoriser l’ingestion. |
| `CERTIFIED_SINGLE_BRAND_PORTAL` | Sans alias prioritaire, un libellé natif peut être rattaché au propriétaire trouvé pour le portail SINGLE_BRAND. **Le chemin actuel couvre aussi des libellés explicites nouveaux, pas seulement un champ employeur absent : limite à corriger.** |
| `GROUP_LABEL_KEPT_HOUSE` | Une offre déjà connue peut garder sa Maison quand le libellé devient celui de son groupe enregistré. L’omission est tracée ; ce n’est pas une autorisation générale de deviner une Maison depuis un groupe. |
| Convergence de libellé | Un nouveau libellé égal au nom canonique de l’employeur déjà attribué peut converger sans être traité comme un changement d’identité. L’ancien document affirmait à tort que toute variation exigeait une nouvelle revue. |
| `REVIEWED_MERGE` / `LEGACY_UNREVIEWED` | Les affectations historiques et redirections restent utilisables sous leurs contrôles. `LEGACY_UNREVIEWED` n’est pas un niveau de confiance attesté. |
| `REVIEW_REQUIRED` | Un conflit non résolu peut lever `EmployerIdentityReviewRequired`. Les preuves de refus sont conservées ; le refus doit rester visible dans la mesure d’ingestion. |

Lorsqu’une nouvelle identité non aliasée est admissible, sa clé peut être construite à partir de la source et du libellé normalisé. Ce mécanisme évite une fusion implicite d’homonymes entre sources ; il ne certifie pas cette identité.

[recordEmployerObservation](../apps/aggregator/src/identity/resolve.ts) enregistre libellé brut, origine, forme normalisée, employeur canonique, règle, IDs de revue/alias et hash RAW. Le hash d’observation permet un rejeu sans créer une nouvelle preuve identique. Une valeur canonique ancienne ne doit pas servir à reconstruire artificiellement un RAW manquant.

Pour Workday, les erreurs de détail et l’absence d’employeur ont des retenues distinctes. Le [pipeline](../apps/aggregator/src/pipeline/ingest.ts) peut lever la retenue spécifique d’employeur absent lorsqu’un périmètre SINGLE_BRAND est disponible. Les autres retenues ne deviennent pas des offres publiables du seul fait de cette exception. La limite du validateur de périmètre ci-dessus s’applique aussi à ce chemin.

## Réparer sans effacer l’historique

Les outils maintenus sont maintenant dans **`scripts/identity/`**, et non `src/identity/*.mts`. Le module métier reste dans [repair.ts](../apps/aggregator/src/identity/repair.ts).

```sh
node --import tsx apps/aggregator/scripts/identity/cli.mts plan /chemin/spec.json /chemin/plan.json
node --import tsx apps/aggregator/scripts/identity/cli.mts apply /chemin/plan.json EXPECTED_SHA256 DEPLOYED_COMMIT
```

Le plan est préparé et revu avant application. La spécification `EmployerRepairSpec` contient `batchId`, déclaration, auteur/date, preuves HTTPS avec texte archivé et SHA-256, fusions explicites d’IDs, alias source-scopés et éventuelles modifications de sociétés. `postingMerges` est une décision distincte, avec ses témoins natifs. Le module applique des verrous, vérifie le hash du plan, l’état avant et les hashes des sources, puis journalise les corrections.

Trois opérations sur alias sont à distinguer :

- création d’un alias prouvé vers une racine canonique ;
- migration explicite d’un alias historique via `legacyAliasId` ;
- remplacement d’une décision précédente via `supersedesAliasId`, avec nouvelle preuve et correction enregistrée.

Une configuration source modifiée impose une revue explicite ; l’ingestion ne doit pas relier silencieusement un ancien alias au nouveau tenant. Un lot déjà appliqué avec le même hash est un rejeu sans modification ; un même identifiant de lot avec un contenu différent est refusé.

**Limite de la preuve avant/après :** le snapshot actuel de réparation omet `description`, `searchText` et les RAW généraux des JobSources. Les RAW des témoins de fusion sont chargés séparément. Ne pas affirmer, comme l’ancien document, que le hash du plan compare à lui seul tous les champs et tous les RAW de toutes les offres. Les contrôles de conservation doivent couvrir les propriétés du lot réellement modifié.

Le paramètre de commit est contrôlé et enregistré par le code ; fournir un hash ne prouve pas que ce commit est réellement déployé. La vérification du déploiement reste une étape opérationnelle indépendante. Sauvegarde fraîche, restauration sur clone, répétition, tests et preuves avant/après restent nécessaires pour une réparation de production.

## Fusions, parentés et limites du modèle

Une fusion d’employeurs conserve les anciens IDs et redirections. Elle n’autorise pas une consolidation de postings : une collision doit être justifiée par `postingMerges` et des témoins du même émetteur/requisition, ou l’opération échoue. `Job.mergedIntoId` conserve l’offre absorbée et son ancienne URL ; une fusion ne doit pas inventer une fermeture employeur.

Le modèle actuel représente un parent **groupe** canonique. Il ne représente pas toute hiérarchie arbitraire marque → sous-marque → concept commercial. Une relation non représentable doit rester explicitement documentée ; ne pas fusionner les entités pour contourner cette limite.

L’[audit d’identité](../apps/aggregator/scripts/identity/audit.mts) est disponible en lecture seule :

```sh
node --import tsx apps/aggregator/scripts/identity/audit.mts /chemin/prive/audit-identite
```

Il produit des candidats de similarité `REVIEW_REQUIRED_NOT_A_MERGE`, pas des fusions approuvées. Sa couverture des chemins RAW est partielle. Il ne consomme pas un registre complet de décisions durables « distinctes » : la non-récurrence de toutes les fausses alertes n’est donc pas démontrée.

## Critères de validation d’un lot

Mesurer les libellés bruts, entreprises canoniques, alias, candidats doublons, fusions réellement prouvées et offres réattribuées. Vérifier les anciennes URLs, les représentations conservées, les événements, les résultats de recherche et les pages employeur. [health.ts](../apps/aggregator/src/identity/health.ts) fournit des indicateurs utiles ; un nombre de racines n’est pas un nombre d’employeurs indépendamment certifiés.

Distinguer systématiquement identité du portail, attribution des offres, complétude du flux, ingestion et visibilité publique. Les preuves et leur date restent dans `audits/`, les RAW et sauvegardes dans `backups/`, et le bilan courant dans le README. Cette documentation ne remplace ni une revue métier ni la preuve après en production.
