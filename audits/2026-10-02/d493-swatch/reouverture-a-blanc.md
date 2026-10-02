# Réouverture de `swatch-group` — préparée à blanc

**Rien de ce fichier n'a été exécuté.** Chaque étape attend le GO explicite de Loïc. La pause (D-493,
`audits/2026-09-30/pause-swatch-group-d493.csv`) reste en vigueur jusque-là.

## Pourquoi pas le registre CSV

`importer-registre-csv.mts` n'importe que `RETIRED` et `PAUSED` (depuis ACTIVE) ; un `statut` ACTIVE y est refusé
(« non importable »). La sortie de pause passe par la **promotion** de `source-add --registered-revision`, avec ses
contrôles (runbook `docs/architecture/canary-operations.md`, « Requalifier une configuration déjà revue dans le
registre »). Le fichier [reouverture-swatch-group-d493.csv](reouverture-swatch-group-d493.csv) consigne cette revue ;
il **ne se passe pas** à l'importeur.

## Étapes

1. **Livrer le lecteur.** Loïc pousse `d493-swatch-lecteur` sur `development` ; promotion sur `main` par le contrôle de
   release de l'agrégateur (révision, migrations : aucune dans ce lot, retour arrière), jamais autour du RUN de 18 h.
   Vérifier que l'image du worker porte le SHA qui contient `a6c5e7c` : l'identité du lecteur est celle de l'image.

2. **Lire la révision à requalifier** (lecture seule) :

   ```sh
   python3 apps/aggregator/scripts/ops/db.py readonly psql -f audits/2026-10-02/d493-swatch/reouverture-revision.sql
   ```

   Attendu : `status = PAUSED`, `kind = swatchgroup`, `config` limitée à `origin` / `lang`. Noter `revision` (UUID).
   La configuration n'a pas à changer : le lecteur D-493 ne lit plus `reconcileLangs`.

3. **Requalifier et rouvrir** (worker de production, même chemin que les requalifications précédentes) :

   ```sh
   sh apps/aggregator/start.sh source-add \
     --key=swatch-group --registered-revision=UUID_LU_A_L_ETAPE_2 \
     --official-domain=swatchgroup.com --reviewer=IDENTIFIANT_DU_REVISEUR
   ```

   Le domaine officiel `swatchgroup.com` est celui du portail lu (`www.swatchgroup.com`) ; le relire contre la Maison
   avant la commande. Le Golden Path refait la capture native, la décision d'accès (le périmètre change : nouveaux
   paramètres de formulaire, `time` et `page` variables, voir le témoin de périmètre) et la validation ; la promotion
   rend la source ACTIVE seulement si tout passe.

4. **Vérifier, sans se fier au code de sortie seul** : verdict `source-add`, décision d'accès ALLOWED,
   `enumeration.complete = true`, terminaison `PARTITIONS_RECONCILED`, `declaredTotal` égal au total en ligne du jour
   (331 le 02/10), aucune ligne rejetée ; puis RAW, catalogue et API. Mesurer ce que deviennent les offres actives
   absentes du listing (380 au catalogue selon la mission, 331 en ligne le 02/10) : ce lot ne l'a pas vérifié.

## Retour arrière

Remettre la source en pause avec le registre existant (depuis ACTIVE seulement), inspection d'abord :

```sh
python3 apps/aggregator/scripts/ops/db.py readonly npx tsx apps/aggregator/scripts/ops/importer-registre-csv.mts audits/2026-09-30/pause-swatch-group-d493.csv
python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/scripts/ops/importer-registre-csv.mts audits/2026-09-30/pause-swatch-group-d493.csv --ecrire
```

puis revenir à l'image précédente par le contrôle de release.
