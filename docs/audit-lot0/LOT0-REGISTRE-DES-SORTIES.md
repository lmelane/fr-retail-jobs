# LOT 0 — registre des sorties d'audit

Un seul fichier fait référence par question. Ce registre existe parce que deux générations de
mesures ont coexisté sous des noms proches (`lot0-chaine-complete.csv` / `lot0-v2-chaine.csv`),
avec des lecteurs et des taxonomies différents : sans lui, un chiffre cité ne dit pas de quelle
version il vient.

## Statut historique et archive des producteurs

Ce registre décrit l'audit du 20 septembre 2026, pas l'état actuel de la production. Les sorties
et constats historiques sont conservés. Le 23 septembre, les brouillons non suivis cités ici
(`lot0-*.mts`, `lot0-v2-chemins.ts`) ont été retirés du checkout après vérification de leur
archive privée ; leurs noms et numéros de ligne ci-dessous désignent cette version archivée.
Ils ne constituent plus des commandes de mesure disponibles dans le dépôt.

Archive locale privée : `~/.catwalks/postrun-cleanup-20260923/untracked-before-cleanup.tar.gz`.
Le manifeste `drafts-final-removal-manifest.json` et le reçu `drafts-removal-receipt.json`, dans
le même répertoire, identifient les fichiers et leurs empreintes SHA-256. Ils permettent de
retrouver les producteurs pour relire les preuves, sans réintroduire les brouillons dans le
checkout actif. Une nouvelle mesure doit valider son lecteur, sa population et son accès aux
données ; les anciennes instructions d'exécution ne sont pas une procédure de production.

## Réserve qui porte sur TOUTES les sorties ci-dessous

Les sept fichiers mesurent sur **`Job.isActive = true`** (34 883 offres). Le prédicat réel du
catalogue exposé est `publicJobWhere()` — `packages/db/availability.ts:13` :

```ts
{ isActive: true, mergedIntoId: null, sources: { some: availableSourceWhere(at) } }
```

Il exige en plus `mergedIntoId IS NULL` **et** au moins une publication `JobSource` active et non
expirée. La population d'audit inclut donc des offres fusionnées et des offres dont toutes les
publications ont expiré — que le produit n'affiche jamais.

**Conséquence : aucune couverture issue de ces fichiers ne doit être citée comme un taux du
catalogue exposé.** L'écart n'est pas chiffré (accès production suspendu le 2026-09-20).

## Sorties de référence de cet audit historique

| Question | Fichier | Producteur | Lecteurs |
|---|---|---|---|
| Volumes par pays, couverture du registre, routabilité | `lot0-v2-pays.csv` | `lot0-v2-pays.mts` | importe `@catwalks/db/marches` |
| Perte RAW → canonique, par pays × source × dimension | `lot0-v2-chaine.csv` | `lot0-v2-chaine.mts` | `lot0-lecteurs.ts` + `lot0-v2-chemins.ts` |
| Contrat de marché déclaré vs couverture mesurée | `lot0-contrat-vs-reel.csv` | `lot0-contrat-vs-reel.mts` | aucun (colonnes canoniques) |
| Sources actives sans aucune offre active | `lot0-v2-corpus-primaire.csv` | `lot0-v2-corpus.mts` | aucun |

### Réserve propre à `lot0-v2-chaine.csv`

`lot0-v2-chemins.ts` a été modifié **après** la production du CSV. Le fichier ne reflète donc pas
nécessairement les derniers chemins de son producteur archivé : **une nouvelle mesure validée
est nécessaire avant toute conclusion actuelle sur les verdicts**.

Deux verdicts de ce fichier sont contestés et en cours de requalification — ce sont les deux
premiers postes de « perte » :

- `region` — 13 143 PERTE_CONFIRMEE. Le lecteur suppose que la valeur RAW est une subdivision
  administrative ; elle peut être un pays ou un libellé de lieu composite.
- `departement` — 9 305 PERTE_CONFIRMEE. Même nature de soupçon.

Tant que la requalification n'a pas conclu, ces deux chiffres **ne sont pas des constats**.

### Défaut connu : `programme` est une colonne d'ignorance

`lot0-v2-chaine.mts:26` déclare `programme → programType` comme dimension mesurée, mais
`lot0-v2-chemins.ts` ne déclare **aucun chemin** pour elle (vérifié : `grep -c "programme"` → 0).
La ligne du CSV porte donc **34 883 `NON_MESURE` et zéro mesure**.

Lire son « 0 canonisé » comme un défaut produit serait une erreur : rien n'a été cherché. Soit les
chemins sont déclarés, soit la ligne est retirée — c'est un arbitrage, pas un correctif évident.

## Sorties périmées (conservées)

| Fichier | Pourquoi périmé | Ce qu'il reste seul à porter |
|---|---|---|
| `lot0-v2-familles.csv` | **Orphelin** : aucun script ne l'écrit, il n'est pas rejouable. Taxonomie `Source.kind` (17 familles) incompatible avec `Job.source`/`AtsType` (16) de la sortie courante ; ses chiffres sont réfutés par `lot0-v2-chaine.csv` (ex. `secteur.canonise` : 0 contre 18 102). Son vocabulaire de verdicts le rend indistinguable d'une sortie courante — **c'est le plus dangereux des trois**. | rien |
| `lot0-chaine-complete.csv` | Lecteurs *inline* remplacés par `lot0-lecteurs.ts` ; calculait la perte par soustraction d'agrégats, défaut corrigé depuis. | **11 dimensions exclusives** : `ville, localisation, seniorite, devise, periodicite, dates`, les 3 sondes JIBE, la sonde LVMH `workingMode`. Archive à conserver. |
| `lot0-cartographie-pays.csv` | La section `hors-registre` **recopie le registre en dur** (`lot0-cartographie-pays.mts:272`) au lieu de l'importer : toute évolution du registre la fera diverger en silence. | Sections **uniques** : `raw-country-valeur-brute`, `raw-country_code-valeur-brute`, `country-integrity`, `multi-localisation`. |

## Règle de production

1. Une sortie officielle porte le nom de son script producteur. Un CSV sans producteur retrouvable
   est périmé d'office — il n'est pas rejouable, donc pas vérifiable.
2. Deux travaux parallèles n'écrivent jamais le même fichier.
3. Un même nombre total d'offres **ne prouve pas** l'identité de deux mesures : comparer les
   répartitions par dimension et par verdict, jamais le seul total.
