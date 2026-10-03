# Release r6 — borne d'attente du verrou des migrations `20261002140000` et `20261002210000` (02/10/2026)

**Pourquoi.** `20261002140000_r143_disponibilite_autorite` ajoute des colonnes et des CHECK sur `JobSource` (98 869
lignes, 1,4 Go en production le 02/10 à 19:34 UTC) et rattrape `publisherClosedAt` (7 065 lignes) dans une transaction :
verrou exclusif tenu jusqu'au COMMIT. `20261002210000_file_identite_employeur` construit un index non concurrent sur
`EmployerObservation` (493 778 lignes, 301 Mo) : verrou SHARE. Sans borne, une lecture longue devant le verrou mettrait
toutes les requêtes de l'API en file derrière la migration (`PGOPTIONS` n'est pas lu par Prisma : `db.py` ne peut pas
poser la borne). `SET LOCAL lock_timeout = '10s'` (dans la transaction de 140000) et `SET lock_timeout = '10s'` (en tête
de 210000) bornent l'ATTENTE, pas le travail.

**Permis seulement parce qu'aucune des deux n'est appliquée** : `_prisma_migrations` de production lu à 19:37 UTC
(lecture seule) : seule `20261002100000_waf_bootstrap_access` parmi les migrations du 02/10 ; `CoverageSnapshot`,
`EmployerIdentityQueue` et `JobSource.publisherClosedAt` absents. Le checksum change : aucune base de production ne
porte l'ancien.

**Témoin statique** : `apps/aggregator/src/lib/migrationLockTimeout.test.ts` (la borne précède le premier verrou, dans
la même transaction) ; rouge sur les deux fichiers d'avant (2 échecs sur 2), vert après.

**Preuve d'exécution, base jetable** (conteneur postgres de `validate-local`, 127.0.0.1, migrations jusqu'à
`20261002100000` puis celles de r6, par `prisma migrate deploy` — le vrai exécuteur) :

| Essai | Verrou concurrent tenu 30 s | Résultat |
|---|---|---|
| `essai-140.out` | `ACCESS SHARE` sur `JobSource` | échec en 11 s, `availabilityHold` et `publisherClosedAt` absents (rien d'écrit) |
| `reprise-20261002140000…out` | aucun | `migrate resolve --rolled-back` puis `deploy` : appliquées en 1 s |
| `essai-210.out` | `ROW EXCLUSIVE` sur `EmployerObservation` | échec en 10 s, `canceling statement due to lock timeout` (55P03), `EmployerIdentityQueue` absente : Prisma exécute le fichier comme une seule transaction implicite |
| `reprise-20261002210000…out` | aucun | `resolve --rolled-back` puis `deploy` : table et index créés |

Scripts : `preuve.sh`, `reprise.sh` (refusent toute cible autre que la base jetable).

**Conséquence pour la release** (RUNBOOK r6 §2) : si `migrate` échoue sur la borne, rien n'est écrit ; relire
`pg_stat_activity`, marquer la migration `prisma migrate resolve --rolled-back <nom>` et relancer `migrate`. Tant
qu'une migration est marquée en échec, `migrate status` est rouge et le worker refuse de démarrer.

## Contraintes de `JobSource` : `NOT VALID`, puis `VALIDATE` séparé (audit d'intégration, F5)

Les deux CHECK de `20261002140000` sont posées `NOT VALID` : elles valent pour toute écriture dès le COMMIT, sans
parcourir les 98 869 lignes sous le verrou exclusif. `20261002140100_r143_valider_contraintes` les valide ensuite sous un
verrou SHARE UPDATE EXCLUSIVE (lectures et écritures continuent), `lock_timeout` 10 s. Témoin :
`migrationLockTimeout.test.ts` (rouge sur la migration d'avant). Exécuté sur base jetable par `prisma migrate deploy` :
les deux contraintes `convalidated = true` après `20261002140100`.
