# BLOC 3 — un seul point d'entrée pour ajouter une Maison, un groupe ou une URL

> `apps/aggregator/scripts/ops/source-onboard.mts`. Mode par défaut : **DRY-RUN**.

## Ce qu'il remplace

Intégrer une source demandait d'enchaîner à la main une demi-douzaine de programmes datés, dont l'ordre et
les gardes n'existaient que dans la tête de celui qui les lançait. C'est ainsi qu'une vague a failli dupliquer
un portail déjà catalogué (D34), et qu'une revue d'identité périmée est passée inaperçue (D59).

```
source-onboard inspect  <url>        ce que l'URL révèle, et si le catalogue la couvre déjà
source-onboard prepare  <dossier>    rapprochement + détection + verdict, sans rien écrire
source-onboard validate <manifest>   exerce les portes réelles
source-onboard apply    <manifest>   register → certify → promote → ingestion bornée  (exige --apply)
source-onboard batch    <csv|json>   plusieurs dossiers, et fige une vague
```

`apply` exige `--apply` **en plus du verbe** : un verbe qui écrit parce qu'on l'a mal orthographié est un
accident qui attend son tour.

**Il ne réimplémente aucune étape** : il appelle la chaîne maintenue (`onboard-source.mts` → `registerSourceCandidate`,
`recordSourceIdentityReview`, `promoteSource`, `ingestAllBySource`). *Une seconde implémentation d'une étape
finit toujours par diverger de la première.*

## Les onze verdicts

`READY_CONFIG_ONLY` · `READY_PUBLIC_HTML` · `ALREADY_COVERED_BY_GROUP` · `ALREADY_COVERED_BY_SOURCE` ·
`REGIONAL_SOURCE_CANDIDATE` · `IDENTITY_AMBIGUOUS` · `OFFICIAL_PORTAL_NOT_PROVEN` · `NEW_ADAPTER_REQUIRED` ·
`OUT_OF_SECTOR` · `BLOCKED_TECHNICAL` · `INTEGRATED`

## Ce que la mise au point a trouvé, et qui aurait faussé chaque vague

**1. La couverture par un groupe ne se lit pas sur les sociétés créditées.** Mesuré : la source `oniverse`
publie **524 offres sous la seule société « ONIVERSE »** — Calzedonia, Intimissimi et Tezenis n'y sont
créditées **nulle part**. Sur ce seul signal, un dossier « CALZEDONIA » passerait pour une lacune et
dupliquerait un portail déjà catalogué.

Le rapprochement lit donc **deux signaux** : les sociétés réellement créditées **et** le `portalScope =
MULTI_BRAND` de la revue d'identité (45 sources). *Un portail de groupe couvre ses marques, que nous
sachions déjà les nommer ou non.* Vérifié : Coach et Kate Spade ressortent `ALREADY_COVERED_BY_GROUP` sous
`tapestry`.

**2. Le domaine ne doit pas bloquer un portail régional.** `careers.skechers.com/fr/fr` et `/us/en`
partagent le domaine enregistrable sans servir le même périmètre. Bloquer dessus interdirait toute extension
régionale d'un acteur présent — la catégorie même que le Bloc 4 doit démontrer. La garde qui demeure est le
**doublon de tenant**, refusé avant écriture quel que soit le type de dossier.

**3. `ADAPTERS` est indexé par `AtsType` en MAJUSCULES.** Ma recherche en minuscules faisait répondre
« pas d'adaptateur » pour PHENOM, une famille parfaitement supportée — donc `NEW_ADAPTER_REQUIRED` sur des
dossiers intégrables par simple configuration.

## Vérifications exécutées

| Cas | Attendu | Obtenu |
|---|---|---|
| `inspect` Hugo Boss | PHENOM, adaptateur existant, déjà catalogué | **conforme** |
| Coach / Kate Spade | `ALREADY_COVERED_BY_GROUP` via `tapestry` | **conforme** |
| Hugo Boss en MAISON | `ALREADY_COVERED_BY_SOURCE` | **conforme** |
| Skechers en PORTAIL_REGIONAL | non bloqué par le domaine | **conforme** |

17 tests de rapprochement ; suite complète verte.
