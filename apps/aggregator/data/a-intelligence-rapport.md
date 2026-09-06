# Rapport — Catwalks Intelligence, lot A (historisation côté pipeline)

Date : 2026-09-06. Périmètre : `apps/aggregator` uniquement. Aucun commit, aucun push, aucune écriture en prod. Chaque chiffre ci-dessous vient d'une exécution (commande citée).

## 1. Ce qui est fait

### Cycle de vie — `closedAt`, `reopenedCount`, `JobEvent`

- `src/pipeline/jobEvents.ts` (nouveau) : `diffStructuralFields(before, after)` (title, city, country, companyId, jobFunction ; un champ absent de `after` = inchangé, `null` = effacement réel ; valeurs tronquées à 200 car.), `changedEvents`, `toEventRow` / `toNestedEventRow`, `recordEvents(prisma, events[])` (createMany par tranches).
- `src/pipeline/refresh.ts` : fermeture (étape 2) → `isActive:false, closedAt: now` + un `CLOSED` par offre, en lot, dans une transaction ; ré-ouverture (étape 3) → `closedAt:null, reopenedCount +1` + `REOPENED`, idem.
- `src/dedup/upsert.ts` : `createJob` écrit `OPENED` dans la même requête que la ligne (nested create) ; `attachToExisting` calcule le diff des champs structurants entre la ligne existante et ce qu'elle va écrire → un `CHANGED` par champ qui change (jamais description/dates/salaire) ; une offre `isActive:false` ré-attestée écrit `REOPENED` + `closedAt:null` + `reopenedCount +1` (avant : `isActive:true` remis en silence). Ligne + événements en UNE requête (`events.createMany` imbriqué), sans transaction interactive sous les workers concurrents.
- Seuls deux écrivains de `Job.isActive` existent hors tests (`grep -rn "isActive: false\|isActive: true" src` : `refresh.ts`, `upsert.ts`) — le cycle de vie est couvert en entier.

### Photographie quotidienne — `src/pipeline/snapshot.ts` + commande `snapshot`

- `runSnapshot(prisma, { date?, backfillFrom?, now? })` : 13 périmètres (global, country, city ≥ 5 actives, company ≥ 1 active, group, sector, function, family, seniority, contract, ai, country-function ≥ 5, country-sector ≥ 5). Tout en SQL agrégé : une CTE `base` (une ligne par offre concernée par le jour : active, née, fermée ou ré-ouverte), puis un `GROUP BY` par périmètre avec `COUNT FILTER`, `COUNT(DISTINCT companyId)`, `percentile_cont(0.5)` pour la médiane, jointure sur les `JobEvent REOPENED` du jour. Aucune ligne `Job` chargée en mémoire.
- `family` : `craft` tranché par `jobFunction in ('atelier-craft','manufacturing-quality')`, puis `isRetail` true → retail, false → corporate, null → `unclassified` (ajouté : `isRetail` null ⇔ `jobFunction` null, « compté comme tel, jamais deviné », comme function/seniority).
- Idempotent : `deleteMany({date})` + `createMany` par tranches dans une transaction. Rejouer un jour ré-écrit ses lignes (test).
- Mode par date : `live` le jour même (`Job.isActive`), `reconstructed` pour un jour passé (`--backfill-from`). Reconstruction : « active à J » = `firstSeenAt` < fin de J et pas fermée avant la fin de J, avec **fermeture effective = `closedAt`, sinon `lastSeenAt` pour une ligne `isActive:false` sans `closedAt`** (0 `closedAt` en base aujourd'hui : sans ce repli, chaque offre fermée avant D38 compterait comme active pour toujours). L'approximation est documentée en tête du module (retire-source, base reconstruite avant le 04/09).
- `src/cli.ts` : commande `snapshot` (`--date=YYYY-MM-DD`, `--backfill-from=YYYY-MM-DD`, sortie JSON) ; la branche `refresh` enchaîne `runRefresh` puis `runSnapshot` ; un échec du snapshot est un incident (exit 1, `snapshotError` dans le JSON) mais n'efface jamais le résultat du refresh. `ingest-all` inchangé. `health.ts` / digest inchangés.
- `src/lib/chunk.ts` (nouveau) : `DB_WRITE_BATCH = 2 000`, utilisé par `recordEvents`, `updateJobsInBatches` (refresh) et l'écriture des snapshots — voir la trouvaille §4.

### Fichiers

Modifiés : `src/pipeline/refresh.ts`, `src/dedup/upsert.ts`, `src/cli.ts`, `package.json` (script `test:unit` : + `src/lib/chunk.test.ts`, `src/pipeline/jobEvents.test.ts`, `src/pipeline/snapshot.keys.test.ts`).
Nouveaux : `src/pipeline/jobEvents.ts`, `src/pipeline/jobEvents.test.ts`, `src/pipeline/snapshot.ts`, `src/pipeline/snapshot.keys.test.ts`, `src/pipeline/snapshot.test.ts`, `src/pipeline/lifecycle-events.test.ts`, `src/lib/chunk.ts`, `src/lib/chunk.test.ts`.
Non touchés (vérifié `git status`) : `src/ats/adapters/wttj*.ts`, `src/normalize/taxonomy.ts`, `src/normalize/skills.ts`, `src/pipeline/classifyJobs.ts`, `packages/db`.

## 2. Tests — sorties réelles

`npx tsc --noEmit -p .` → aucune sortie, exit 0.

`npm run test:unit` :
```
 ✓ src/pipeline/jobEvents.test.ts (7 tests) 1ms
 ✓ src/pipeline/snapshot.keys.test.ts (5 tests) 0ms
 ✓ src/lib/chunk.test.ts (4 tests) 0ms
 Test Files  51 passed (51)
      Tests  914 passed (914)
```
(avant le lot : 48 fichiers / 898 tests.)

`DATABASE_URL=postgresql://catwalks:catwalks@localhost:55440/catwalks_test npm run test:integration -w @catwalks/aggregator` :
```
 ✓ src/pipeline/snapshot.test.ts (5 tests) 328ms
 ✓ src/pipeline/lifecycle.operational.test.ts (7 tests) 184ms
 ✓ src/pipeline/lifecycle-events.test.ts (7 tests) 128ms
 ✓ src/pipeline/dedup-collision.test.ts (7 tests) 94ms
 ✓ src/pipeline/sourceStore.test.ts (13 tests) 663ms
 ✓ src/pipeline/refresh.test.ts (5 tests) 83ms
 ✓ src/pipeline/health.test.ts (8 tests) 49ms
 ✓ src/pipeline/retireSource.test.ts (3 tests) 42ms
 ✓ src/pipeline/resolveDomains.test.ts (3 tests) 54ms
 ✓ src/pipeline/purge.test.ts (4 tests) 40ms
 ✓ src/pipeline/reconcile.test.ts (3 tests) 49ms
 ✓ src/pipeline/jobEvents.test.ts (7 tests) 0ms
 ✓ src/pipeline/separateFused.test.ts (2 tests) 31ms
 ✓ src/pipeline/sourceCursor.test.ts (6 tests) 17ms
 ✓ src/pipeline/snapshot.keys.test.ts (5 tests) 0ms
 ✓ src/pipeline/cadence.test.ts (3 tests) 0ms
 ✓ src/pipeline/kindToAts.test.ts (3 tests) 1ms
 ✓ src/pipeline/onlyRequested.test.ts (3 tests) 0ms
 Test Files  18 passed (18)
      Tests  94 passed (94)
```
`… npx vitest run src/dedup` (upsert.ts modifié ; ces tests ne sont dans AUCUN script npm, voir §4) : 3 fichiers, 19 tests, verts.

Ce que les nouveaux tests prouvent :
- `lifecycle-events.test.ts` : refresh ferme → `closedAt` posé + `CLOSED` ; source revenue → `closedAt` null, `reopenedCount` 1, `REOPENED` ; 3 fermetures → 3 `CLOSED` ; création → `OPENED` ; ré-attestation identique → rien ; titre changé → `CHANGED(title, 'Vendeur' → 'Conseiller de vente')` ; description plus riche seule → rien ; `country 'France' → 'FR'` → `CHANGED(country)` ; offre fermée re-listée par sa source → `REOPENED`, `closedAt` null, `reopenedCount` 1.
- `snapshot.test.ts` : 12 offres, 2 pays, 2 Maisons, 3 fermées aujourd'hui (4, 10, 2 jours), 1 fermée hier, 1 ré-ouverte — chaque ligne attendue calculée à la main : global {8 actives, 1 nouvelle, 3 fermées, 2 Maisons, médiane 4, 1 ré-ouverte}, FR {6,1,2,1,3,1}, IT {2,0,1,2,10,0}, `FR|Paris` seule ville ≥ 5, Lyon/Milan absentes, company/group/sector/function/family/seniority/contract/ai, `country-function` 0 ligne (seuil), `FR|LUXURY` {6,1,1,1,4,1} ; rejouer ne double rien ; jour futur refusé ; backfill 4 jours (3 reconstruits + 1 live) avec J-3 = 10 actives, J-2 = 11 (+1 née), J-1 = 10 avec 1 fermée (médiane 9) ; ligne `isActive:false` sans `closedAt` fermée à son `lastSeenAt`.
- La médiane est calculée en SQL (`percentile_cont`), prouvée par ces tests d'intégration (4, 3, 10, 6, 9), pas par un test unitaire : il n'y a pas de médiane en TypeScript à tester.

## 3. Temps mesurés

- Base locale `catwalks` (copie de démo) — **mesurée : 1 997 offres, 7 sociétés, 0 `jobFunction`, toutes nées le 2026-09-02 ; pas les ~27 k attendues par le brief**. `DATABASE_URL=…/catwalks npx tsx src/cli.ts snapshot` → 208 lignes (country 65, city 26, country-sector 50, country-function 44, contract 8, company 7…), **92 ms** (0,53 s process compris). Les 208 lignes du 2026-09-06 restent écrites dans cette base de démo (écriture tolérée).
- Pour un chiffre à l'échelle de la prod, une base jetable `catwalks_perf` (copie de `catwalks` + 35 copies synthétiques : **71 892 offres, 65 900 actives, 1 007 sociétés, 500 REOPENED**) créée puis **supprimée** après mesure :
  - `snapshot` live : 1 892 lignes en **1 097 ms** ;
  - `snapshot --backfill-from=2026-08-07` : 31 jours, 58 864 lignes, **48 s** (≈ 1,6 s/jour) ;
  - `refresh` CLI complet (33 948 orphelins fermés en tranches + 33 948 `CLOSED` + snapshot 1 809 lignes) : **4,7 s**, exit 0, `closedAt` posé sur les 33 948.
  Objectif « < 60 s sur la base prod » : tenu avec une marge d'un ordre de grandeur.

## 4. Trouvailles pendant l'exécution

1. **Borne Postgres des paramètres liés (réelle, préexistante)** : le premier `refresh` sur la copie à 65 900 orphelins a échoué — `too many bind variables in prepared statement, expected maximum of 32767, received 65903` — sur `updateMany({ id: { in: [...] } })`. L'ancien code avait la même forme ; la garde de fermeture massive ne couvre pas les orphelins (étape 2). Corrigé par `src/lib/chunk.ts` (tranches de 2 000) sur les trois écritures en lot ; rejoué : 33 948 fermetures OK. La transaction avait bien tout annulé (0 `CLOSED`, 0 `closedAt` posé) — atomicité vérifiée en passant.
2. **`createMany` imbriqué refuse `jobId`** (`Unknown argument jobId`) : attrapé par les tests d'intégration, pas par `tsc` (le retour d'une fonction n'a pas de contrôle d'excès de propriétés). D'où `toNestedEventRow` distinct de `toEventRow`, testé.
3. **`src/dedup/*.test.ts` ne tourne dans aucun script npm** (`test:unit` liste des chemins explicites, `test:integration` = `src/pipeline` seul) : `upsert.test.ts` (9 tests d'intégration sur le chemin d'écriture) et `reattestation.test.ts` sont invisibles de `npm test`. Non modifié (hors brief) ; à ajouter à `test:integration`.
4. Base de démo locale : 1 997 offres, pas ~27 k (§3).

## 5. Ce qui reste ouvert

- **Backfill en prod** : à lancer par Loïc (`snapshot --backfill-from=2026-09-04` est le plus honnête : avant, la base était reconstruite à chaque run). Le jour même est toujours pris en `live`.
- **`JobEvent` et `onDelete: Cascade`** : `retire-source`, `reconcile` (fusion) et `separate-fused` suppriment des `Job` → leurs événements disparaissent avec eux. Pour « rejouer le marché dans trois ans », l'histoire des offres supprimées est perdue ; les `MarketSnapshot` du jour, eux, restent. À trancher (conserver les événements orphelins ? les re-rattacher au Job survivant lors d'une fusion ?).
- **Croissance de `JobEvent`** : ~70 k `OPENED` d'un coup au premier ingest après déploiement (chaque offre existante est ré-attestée, pas créée → pas d'`OPENED` rétroactif ; les `CHANGED` de la première nuit dépendront de ce que l'auto-guérison ré-écrit). Aucune rétention prévue — à mesurer après une semaine.
- **Première nuit** : le refresh tourne après l'ingest (D36) ; le premier snapshot prod aura `newJobs` = offres nées ce jour-là, `closedJobs` = fermetures du refresh, `medianLifespanDays` calculée depuis `firstSeenAt` (stable depuis le 04/09 seulement).
- `family = 'unclassified'` et `function/seniority = 'unclassified'`, `contract = 'UNKNOWN'` : clés à connaître côté web.
- Rien n'a été exécuté en prod ; les crons restent gelés (D35/D36).
