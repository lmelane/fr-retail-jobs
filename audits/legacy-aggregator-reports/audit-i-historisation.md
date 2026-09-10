# Audit I — Axe 2 : historisation (pipeline)

Date : 2026-09-06, 15:48–15:52 UTC. Base : `catwalks_test` uniquement (Postgres Docker `catwalks-audit-pg`, TimeZone `UTC`, 7 migrations appliquées dont `20260906170000_intelligence_history`). Aucune correction de code, aucun commit, aucune écriture en prod ni sur la base de démo `catwalks`. Le rapport `data/a-intelligence-rapport.md` a servi de piste ; chaque point ci-dessous a été rejoué par une exécution propre.

**Méthode** : un script `tsx` temporaire (supprimé après exécution) posé dans `apps/aggregator/`, qui appelle `upsertDeduplicated` / `runReconcile` par Prisma et lance la vraie CLI (`npx tsx src/cli.ts refresh | snapshot | retire-source`) en sous-processus avec `DATABASE_URL=…/catwalks_test`, puis relit `Job`, `JobEvent`, `MarketSnapshot` par Prisma ET par SQL brut indépendant (`$queryRawUnsafe`, `percentile_cont`). Sortie complète : `scratchpad/axe2-run1.log` (900 lignes). La base de test est vide à la fin ; la table `MarketSnapshot`, renommée le temps du test 10, est bien revenue (vérifié : 1 table `MarketSnapshot%`).

## Verdict en une phrase

**Le cycle de vie (closedAt, reopenedCount, JobEvent), l'idempotence du snapshot, la médiane, l'enchaînement refresh → snapshot et l'exit 1 sur échec sont CONFIRMÉS conformes.** Ce qui ne tient pas, c'est la **reconstruction** : un jour passé rejoué (`--backfill-from`, ou un simple re-`snapshot` du jour) est calculé sur l'état ACTUEL de `Job`, jamais sur `JobEvent` — donc une ré-ouverture, un `retire-source`, un changement de société ou une fusion `reconcile` **ré-écrivent l'histoire**, et rien dans la table ne distingue une ligne vécue d'une ligne reconstruite.

## Constats classés

| # | Constat | Statut | Gravité |
|---|---|---|---|
| 1 | Le scénario complet (création → fermeture par refresh → ré-ouverture → changement de titre) écrit exactement ce qu'il doit : `closedAt`, `reopenedCount`, OPENED/CLOSED/REOPENED/CHANGED(title) | CONFIRMÉ conforme | — |
| 2 | `snapshot` ×2 le même jour : 0 doublon, 9 lignes → 9 lignes | CONFIRMÉ conforme | — |
| 3 | Médiane `percentile_cont` : {2,5,20} → 5 ; {2,5,20,30} → 12,5 (= SQL indépendant) | CONFIRMÉ conforme | — |
| 4 | Snapshot en échec → exit 1, résultat du refresh visible, fermetures persistées | CONFIRMÉ conforme | — |
| 5 | `ingest-all` ne prend pas de snapshot ; `PIPELINE_CMD=refresh` (lu sur Railway) → CMD Docker → `refresh` → `runRefresh` puis `runSnapshot` | CONFIRMÉ conforme | — |
| 6 | **Rejouer un jour ré-écrit l'histoire** : la table `MarketSnapshot` n'a pas de colonne `mode` ; une ligne reconstruite est indistinguable d'une ligne vécue, et la reconstruction ignore `JobEvent` | CONFIRMÉ | **HAUT** |
| 7 | Une offre ré-ouverte perd sa fermeture (`closedAt: null`) → re-snapshot du jour : `closedJobs` 1 → 0, médiane perdue | CONFIRMÉ | MOYEN (sous-cas de 6) |
| 8 | `retire-source` : la photographie d'hier reste intacte **tant qu'on ne la rejoue pas** ; le backfill rejoué la ré-écrit (2 → 1) ; les `JobEvent` de l'offre disparaissent (cascade) | CONFIRMÉ | MOYEN (sous-cas de 6) |
| 9 | Changement de société : J-1 (vécu) = Gucci, J (vécu) = Balenciaga, cohérent ; **mais** J-1 rejoué en backfill = Balenciaga, la ligne Gucci disparaît, malgré le `CHANGED(companyId)` en base | CONFIRMÉ | MOYEN (sous-cas de 6) |
| 10 | Une ligne héritée `isActive=false, closedAt NULL` sort des actives (repli `lastSeenAt`) sans jamais être comptée fermée : `active(J-1)+new(J)−closed(J) ≠ active(J)` (3+1−0 = 4 ≠ 3) et médiane `null` | CONFIRMÉ | MOYEN |
| 11 | Le rapport A affirme « seuls deux écrivains de `Job.isActive` » : **faux** — `reconcile.ts:92` ferme le perdant d'une fusion sans `closedAt` ni événement ; `discovery/ops-close-stale-source.mts` (commité, 487074f) idem | CONFIRMÉ | MOYEN |
| 12 | Un doublon fusionné par `reconcile` reste compté dans `newJobs` (2 nouvelles pour 1 poste, en live comme en backfill) | CONFIRMÉ | MOYEN |
| 13 | Refresh refusé par la garde de fermeture massive : le snapshot est **quand même** écrit (`activeJobs` 70 dont 60 périmées, `closedJobs` 0), sans marque | CONFIRMÉ | BAS |
| 14 | Le jour du snapshot est le jour **UTC** de l'instant du run (`dayBounds`) : un run manuel à 01:30 Paris écrit la veille | CONFIRMÉ (lecture code + 2d) | BAS |
| 15 | Ordre de déploiement : les crons sont gelés, donc `migrate deploy` (CMD Docker) ne s'exécute pas ; si le web lit `MarketSnapshot`/`jobFunction` avant que la migration soit appliquée à la main en prod → 503 (cf. mémoire « migrer avant de déployer le web ») | PROBABLE (prod non consultée, interdit par le brief) | HAUT (à vérifier avant tout push) |

---

## Preuves

### 1. Cycle de vie — CONFIRMÉ conforme

**1a. Ingest simulé** (`upsertDeduplicated`, candidat `kering/G1` « Vendeur ») → `outcome: CREATED` ; Job `isActive: true, closedAt: null, reopenedCount: 0` ; JobSource `kering` active ; événements : `[OPENED]` (`at` = `lastSeenAt` = 15:48:38.739Z, passé explicitement — pas le `CURRENT_TIMESTAMP` par défaut).

**1b. Refresh CLI** `REFRESH_STALE_HOURS=0 npx tsx src/cli.ts refresh` → exit 0, JSON `{ checked: 1, closedSources: 1, closedJobs: 1, reopened: 0, refused: false, snapshot: { days: [{ date: "2026-09-06", mode: "live", rows: 8 }] }, snapshotError: null }`. Job : `isActive: false, closedAt: 2026-09-06T15:48:39.295Z, reopenedCount: 0` ; JobSource inactive ; événements `[OPENED, CLOSED]`, `CLOSED.at` = `closedAt` à la milliseconde.

**1c. Snapshot écrit par la branche refresh** (global, 2026-09-06) : `activeJobs 0, newJobs 1, closedJobs 1, hiringCompanies 0, medianLifespanDays 0.0000062 (≈ 0,5 s), reopenedJobs 0`. Date stockée `2026-09-06` = `(now() AT TIME ZONE 'UTC')::date` (colonne `DATE`, pas de dérive de fuseau).

**1d. Ré-attestation** (même candidat) → `outcome: UPDATED` ; Job `isActive: true, closedAt: null, reopenedCount: 1` ; JobSource ré-activée ; événements `[OPENED, CLOSED, REOPENED]`.

**1e. Changement de titre** (« Conseiller de vente ») → événements `[…, CHANGED(title, before: "Vendeur", after: "Conseiller de vente")]` ; `reopenedCount` reste 1 ; aucun événement pour la description.

### 2. Idempotence — CONFIRMÉ conforme

`snapshot` deux fois de suite : run 1 = 9 lignes (global 1, country 1, company 1, group 1, sector 1, function 1, family 1, seniority 1, contract 1), run 2 = 9 lignes ; `SELECT date, scope, key, count(*) … HAVING count(*) > 1` → **0 ligne** ; `count(*)` total = 9. L'index unique `(date, scope, key)` existe en plus du `deleteMany` (migration lue).

### 3. Médiane — CONFIRMÉ conforme

Trois offres fermées aujourd'hui, durées 2, 5, 20 jours → `medianLifespanDays: 5`. Une quatrième à 30 jours → `12.5` (interpolation `percentile_cont`), identique au SQL indépendant `percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("closedAt"-"firstSeenAt"))/86400)` → `12.5`. Note d'affichage pour l'axe 1 : sur un nombre pair, la « médiane » est une interpolation, pas une valeur observée.

### 4. Snapshot en échec — CONFIRMÉ conforme

`ALTER TABLE "MarketSnapshot" RENAME TO …` puis `refresh` (1 offre périmée) → **exit 1** ; stdout JSON `{ ok: false, closedJobs: 1, …, snapshot: null, snapshotError: "…The table public.MarketSnapshot does not exist…" }` ; stderr `[snapshot] failed after refresh`. En base : le job est bien `isActive: false`, `closedAt` posé, `CLOSED` écrit — le refresh n'est pas annulé par l'échec du snapshot. Table renommée en retour, vérifié.

### 5. `ingest-all` sans snapshot ; enchaînement Docker — CONFIRMÉ conforme

- `grep -n runSnapshot src/cli.ts` → deux appels seulement : ligne 143 (branche `refresh`) et 174 (branche `snapshot`). La branche `ingest-all` (lignes 84–131) appelle `ingestAllBySource`, `runGeocode`, `sendHealthAlert`, `submitOfferChanges`, `pingHeartbeat` — pas de snapshot. `grep runSnapshot\|snapshot src/pipeline/ingestOrchestrator.ts src/pipeline/ingest.ts` → vide.
- `Dockerfile` CMD : `… && npm run ${PIPELINE_CMD:-ingest-all} -w @catwalks/aggregator` ; `package.json` : `"refresh": "tsx src/cli.ts refresh"` ; `railway variables --service catwalks-refresh --json` → `"PIPELINE_CMD": "refresh"` ; `catwalks-aggregator` → `"ingest-all"` (lecture seule). Preuve d'exécution de l'enchaînement : test 1b (la CLI `refresh` a écrit 8 lignes `MarketSnapshot`).

### 6. Rejouer un jour ré-écrit l'histoire — CONFIRMÉ, HAUT

Fait de structure : `MarketSnapshot` a les colonnes `id, date, scope, key, activeJobs, newJobs, closedJobs, hiringCompanies, medianLifespanDays, reopenedJobs, createdAt` (migration lue) — **pas de `mode`**. `snapshotDay` fait `deleteMany({date})` puis `createMany`, quel que soit le mode. Et `baseCte` ne lit `JobEvent` que pour `REOPENED` ; « actif à J », « fermé à J », « société », « ville » viennent des colonnes ACTUELLES de `Job` (`closedAt`, `lastSeenAt`, `companyId`, `city`…), jamais des événements CLOSED/CHANGED pourtant écrits pour ça.

Conséquence : toute exécution de `snapshot --backfill-from=<passé>` (celle que le rapport A recommande à Loïc pour la prod, depuis le 2026-09-04), ou tout re-run de `snapshot`/`refresh` le même jour, remplace des lignes vécues par des lignes reconstruites, et la page web (axe 1) ne peut ni le savoir ni l'afficher (« reconstruit », « approximatif »). Les trois sous-cas suivants le mesurent.

**6a (constat 7) — ré-ouverture.** Après 1d, `snapshot` du même jour : global passe de `{activeJobs 0, closedJobs 1, medianLifespanDays ≈ 0}` (1c) à `{activeJobs 1, closedJobs 0, medianLifespanDays null, reopenedJobs 1}`. La fermeture existe toujours dans `JobEvent` (`CLOSED` à 15:48:39) mais `closedAt` est `null` → `is_closed` faux. En prod, avec un ingest à 01:00 et un refresh à 04:00, le jour vécu n'est pas rejoué spontanément ; il l'est au premier backfill ou au premier re-run manuel.

**6b (constat 8) — retire-source.** Deux offres nées J-2 (`kering/K1`, `retire-me/R1`), snapshot J-1 + J → global `activeJobs 2` les deux jours, 2 `JobEvent`. `retire-source retire-me` → `{ jobSourcesRemoved 1, jobsDeleted 1 }` ; `Job R1` = `null`, événements de R1 = 0 (cascade `ON DELETE CASCADE`, total 2 → 1). Lignes `MarketSnapshot` J-1 et J : **intactes** (`activeJobs 2`). Puis `snapshot --backfill-from=J-1` : J-1 et J → `activeJobs 1`. La trace d'hier ne survit donc qu'à condition de ne jamais rejouer hier.

**6c (constat 9) — changement de société.** `C1` créé chez Gucci (firstSeenAt J-1), `snapshot --date=J-1` → ligne `company` J-1 clé = id Gucci, `{activeJobs 1, newJobs 1}`. Ré-attestation par la même source sous « Balenciaga » → `companyId` changé + `CHANGED(companyId, before: <Gucci>, after: <Balenciaga>)`. `snapshot` (J, live) → ligne J clé = id Balenciaga ; la ligne J-1 reste Gucci : **cohérent**. `snapshot --backfill-from=J-1` → J-1 devient Balenciaga `{activeJobs 1, newJobs 1}`, la ligne Gucci n'existe plus : l'événement `CHANGED(companyId)` n'est pas consulté.

### 10. Lignes héritées sans `closedAt` — CONFIRMÉ, MOYEN

Fixtures : B1 né J-3 actif · B2 né J-2 fermé J-1 (`closedAt`) · **B3 né J-5, `isActive=false`, `closedAt NULL`, `lastSeenAt` J-2** · B4 né J-1 actif · B5 né J-6 fermé J 01:00. `snapshot --backfill-from=J-3` → 4 jours (3 `reconstructed` + 1 `live`), global :

| jour | activeJobs | newJobs | closedJobs | médiane |
|---|---|---|---|---|
| J-3 | 3 (B1, B3, B5) | 1 | 0 | null |
| J-2 | 3 (B1, B2, B5) | 1 | 0 | null |
| J-1 | 3 (B1, B4, B5) | 1 | 1 (B2) | 1 |
| J | 2 (B1, B4) | 0 | 1 (B5) | 5,625 |

Chaque ligne recalculée à la main et par un SQL indépendant (6e du log) : identiques. Mais entre J-3 et J-2, B3 sort des actives (repli `lastSeenAt`) sans être comptée fermée : `3 + 1 − 0 = 4 ≠ 3`. Sur la prod, toute offre fermée AVANT le déploiement de D38 (toutes celles `isActive=false` d'aujourd'hui : `closedAt` n'existe pas encore en prod) est dans ce cas — et `medianLifespanDays` de tous les jours reconstruits avant ce déploiement sera `null` par construction. Le module le documente en tête ; la page web (axe 1) doit le refléter, ce que l'absence de `mode` empêche (constat 6). Base de démo locale `catwalks` (lecture seule) : 1 997 offres, 1 inactive, 0 `closedAt`, 0 `JobEvent`, 208 `MarketSnapshot` (celles laissées par le rapport A) — trop petite pour chiffrer la prod.

### 11–12. `reconcile` ferme sans trace et gonfle `newJobs` — CONFIRMÉ, MOYEN

Deux « Sales Associate » Paris chez Acme, sources `src-a` / `src-b`, `runReconcile` → `{ jobsMerged 1, sourcesMoved 1 }`. Perdant : `isActive: false, closedAt: null, sources: []`, événements `[OPENED]` seulement (pas de CLOSED, pas de rattachement de son histoire au gardien). `grep -rn "isActive: false"` hors tests : `refresh.ts:169,183`, `reconcile.ts:92` (`data: { isActive: false }`), `discovery/ops-close-stale-source.mts:25` (commité). Le rapport A a filtré ces lignes par erreur (le `grep -v where` masque `reconcile.ts:92` qui contient `where`).

Effet mesuré : deux doublons nés aujourd'hui, fusionnés, `snapshot` live → global `{activeJobs 1, newJobs 2}` — un poste, deux « nouvelles offres », en live comme en backfill (J-2 rejoué : `newJobs 2`). Sémantiquement un doublon fusionné n'est pas une fermeture, mais il ne devrait pas non plus être une naissance ; et sans `closedAt` il compte actif en reconstruction jusqu'à son `lastSeenAt` (perdant fusionné aujourd'hui → actif dans tout backfill des jours précédents).

### 13. Refresh refusé → snapshot écrit — CONFIRMÉ, BAS

70 offres actives dont 60 avec sources périmées (72 h) : `refresh` → stderr `REFUSED: would close 60 of 70 live offers (> 50%)`, exit 1, `refused: true`, **et** `snapshot: { rows: 11 }`. Base : 70 actives, 0 `closedAt`, 0 événement ; `MarketSnapshot` global `{activeJobs 70, closedJobs 0}`. C'est la vérité affichée par le site ce jour-là (D1) et l'incident est visible (exit 1), mais la ligne ne porte aucune marque ; le jour où la garde se lève, les 60 fermetures tomberont d'un bloc sur un autre jour (pic artificiel de `closedJobs` et de la médiane). À décider : ne pas photographier un jour refusé, ou le marquer.

### 14. Jour UTC — CONFIRMÉ, BAS

`dayBounds(options.now ?? new Date())` → jour UTC. Cron refresh prévu `0 4 * * *` UTC : sans effet. Un run manuel depuis Paris entre 00:00 et 02:00 heure locale écrase la veille UTC (et, combiné à 6, ré-écrit la ligne vécue de la veille).

### 15. Ordre de déploiement — PROBABLE, HAUT

Le CMD Docker applique `migrate deploy` au démarrage d'un cron ; les trois crons sont gelés (`0 0 29 2 *`). Un push de `main` déploie le web immédiatement (Railway) : s'il lit `MarketSnapshot`, `Job.closedAt`, `jobFunction`… avant que `20260906170000_intelligence_history` soit appliquée à la main en prod, il rend 503 (cas déjà vécu : `Company.domain`, D36). Non vérifié en prod (interdit par le brief) — à vérifier par `railway ssh` avant tout push.

## Ce que le rapport A dit et que cette passe contredit ou nuance

- « Seuls deux écrivains de `Job.isActive` […] le cycle de vie est couvert en entier » → **faux** (constat 11).
- « Idempotent : rejouer un jour ré-écrit ses lignes » → vrai, et c'est précisément le problème : ré-écrire = perdre la ligne vécue (constat 6).
- « `JobEvent` et cascade : à trancher » → confirmé ; s'y ajoute que les événements existants ne sont pas lus par la reconstruction, ce qui rend la question moins théorique : même conservés, ils ne serviraient pas au snapshot aujourd'hui.
- « Backfill en prod depuis le 2026-09-04 » → à ne lancer qu'une fois, AVANT le premier refresh de reprise, et jamais rejoué ensuite ; sinon les jours vécus sont remplacés (constat 6). Et les lignes produites porteront `medianLifespanDays null` et des sorties d'actives non comptées fermées (constat 10).

## Recommandations (pas de correction faite, par consigne)

1. Ajouter `mode` (`live`/`reconstructed`) à `MarketSnapshot` et **refuser d'écraser une ligne `live` par une reconstruction** (ou exiger `--force`). L'axe 1 pourra alors afficher « reconstruit » et ne fonder aucune tendance sur deux lignes de modes différents.
2. Faire lire `JobEvent` par la reconstruction (CLOSED/REOPENED pour l'état, CHANGED(companyId/city/country) pour les dimensions), ou renoncer explicitement au backfill au-delà du premier jour de D38.
3. `reconcile` : marquer le perdant (`mergedIntoId` ou événement `MERGED`) et l'exclure de `newJobs` ; déplacer ou lier ses événements au gardien.
4. Jour refusé par la garde : ne pas écrire de snapshot, ou le marquer.
5. Avant tout push : appliquer la migration Intelligence en prod à la main, puis vérifier `SELECT count(*) FROM "MarketSnapshot"` et les colonnes `Job` via `railway ssh`.
