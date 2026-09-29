# Données contrôlées de l’agrégateur

Point d’entrée et procédures : [README de l’agrégateur](../README.md).

- `reference/` : référentiels réellement lus par le code (pays, villes, Maisons, signaux carrière, frontières) et licence CLDR. **Chaque fichier a au moins un appelant** — vérifié le 2026-09-17 : `maisons.csv` 6, `country-labels.json` 2, `villes-exonymes.csv` 2, `discovery-career-signals.json` 1, `villes-non-lieux.csv` 1 ; le 2026-09-25 : `frontieres-ne10m.json.gz` 1 (`src/geo/frontieres.ts`, pays d'une offre Catwalks par ses coordonnées, D-444).
- `reference/frontieres-ne10m.json.gz` : Natural Earth, « Admin 0 – Countries », 1:10 000 000, version 5.1.1, **domaine public** (<https://www.naturalearthdata.com/about/terms-of-use/>). Dérivé, sans autre changement que la quantification au millionième de degré, de l'archive officielle épinglée par son empreinte SHA-256 ; reproduit et vérifié par `scripts/generate-frontieres.mts`. Le code refuse de classer une offre avec un contenu dont l'empreinte diffère de celle revue (`FRONTIERES_CONTENU_SHA256`).

- `reference/esco-v1.2.1.json.gz` : la classification européenne ESCO, version publiée v1.2.1 (3 039 métiers, 603 groupes ISCO, libellés et synonymes en 28 langues, descriptions en français et en anglais), téléchargée le 2026-09-28 depuis l'API officielle (`selectedVersion=v1.2.1`), complétude vérifiée contre le total annoncé. **ESCO © Union européenne, réutilisation autorisée avec mention de la source** (décision 2011/833/UE). Produite par `scripts/taxonomie/esco-reference.mts` ; lue par la passe de curation de la taxonomie v3 (`scripts/taxonomie/curation/commun.mts`, D-475 lot 2). Référence de la machine, jamais affichée telle quelle (D-475 §29). Empreinte SHA-256 : `48e9008f736372c6acb22eb653bcef4be9998f47b287204725fecbe2f20cc0a4`.

Le dossier `imports/` a été supprimé le 2026-09-17 : ses trois fichiers (1,5 Mo) n'avaient **aucun
appelant** dans le code. Ils restent dans l'historique git si un rapprochement les redemande.

Aucun résultat de recherche, reçu de run, export, rapport ou sauvegarde dans ce dossier. Les sorties de travail vont dans un dossier explicite de `backups/` ; les preuves partageables, datées et sans secret vont dans `audits/`.

## Le seed CSV a été supprimé le 2026-09-17

`seeds/sources.csv` et sa commande `import-sources` n’existent plus. Mesuré avant suppression : le
CSV portait **83 lignes** quand la table `Source` en portait **536**, sans statut, sans révision,
avec des configurations périmées. Sur une base vide il aurait recréé 83 sources en `DRAFT` sans
rapport avec le registre réel, en conflit de `tenantKey` avec les vraies.

Le catalogue actif est la table `Source`, et il se restaure depuis lui-même :

```bash
# export (lecture seule)
python3 scripts/ops/db.py readonly npx tsx scripts/ops/exporter-registre-sources.mts <fichier.json>
# réimport après un reset
python3 scripts/ops/db.py production npx tsx scripts/ops/reimporter-registre-sources.mts <fichier.json> --ecrire
```

Le réimport restaure les statuts **tels quels** : il ne promeut ni ne rétrograde aucune source, et
n’en invente aucune. Une source en `DRAFT` reste en attente de validation et ne peut pas être
ingérée — `ingest.ts` exige un verdict `VALIDATED` issu d’une capture native.
