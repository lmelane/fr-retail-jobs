# L1 — accès d'audit en lecture seule : procédure de provisionnement et de vérification

**Statut : EXÉCUTÉE ET VÉRIFIÉE EN PRODUCTION (2026-09-22).**

Le rôle `catwalks_audit` existe et sert désormais toute lecture de production. État mesuré, pas
déclaré :

| contrôle | valeur observée |
|---|---|
| attributs du rôle | `rolsuper=f` · `rolcreatedb=f` · `rolcreaterole=f` · `rolbypassrls=f` |
| réglages du rôle | `default_transaction_read_only=on` · `statement_timeout=60s` · `idle_in_transaction_session_timeout=30s` |
| privilèges effectifs | **43 tables lisibles, 0 inscriptible** |
| verrou éprouvé | `CREATE TABLE` → `cannot execute CREATE TABLE in a read-only transaction`, **sans rien demander** |
| lecture témoin | 537 sources lues sous `current_user = catwalks_audit` |

Le mot de passe a été **rotaté le 2026-09-22** et vit hors dépôt : `~/.catwalks/audit-access.json`
(permissions `600`). L'URL s'assemble avec `scripts/ops/mesures/url-audit.sh`, qui refuse tout
fichier ne portant pas le rôle `catwalks_audit`.

> **INTERDIT : auditer avec `postgres`.** Il est SUPERUTILISATEUR. Le 2026-09-21, un
> `CREATE TEMP TABLE` est passé en production **malgré** `SET ROLE catwalks_audit` **et**
> `default_transaction_read_only = on` : aucun `GRANT` ne contraint un superutilisateur, et un
> réglage de session se remet à `off`. `BEGIN READ ONLY` bloque bien l'écriture, mais reste une
> discipline d'appel — le rayon d'action en cas d'erreur humaine demeure total. `catwalks_audit`
> porte la protection dans le compte lui-même. Aucune connexion superutilisateur pour un audit
> applicatif, sans exception.

L'historique ci-dessous décrit la procédure telle qu'elle a été conçue puis appliquée ; elle reste
la référence pour un nouveau provisionnement ou une rotation.

## 1. Pourquoi cet accès est nécessaire

Le seul accès production configuré (`backups/remediation-20260908/postgres-access.json`) est le
rôle **`postgres`, superutilisateur**. `db.py readonly` et `db.py production` lisent le **même**
fichier d'identifiants : `readonly` n'est qu'un habillage d'environnement par-dessus un accès en
écriture.

Trois défauts cumulés, tous vérifiés le 2026-09-20 :

1. `PGOPTIONS` est lu par `libpq` (`psql`) et **jamais** par le moteur Rust de Prisma — or 143
   scripts d'audit passent par Prisma. Un `CREATE TEMP TABLE` a **réussi** en production.
2. Un `SET default_transaction_read_only = on` de session ne verrouille que la connexion qui le
   reçoit : mesuré sur 8 requêtes concurrentes, **1 connexion verrouillée, 7 ouvertes**.
3. `default_transaction_read_only` est un **réglage par défaut**, pas un privilège : toute session
   peut le remettre à `off`, et un superutilisateur n'est contraint par aucun `GRANT`.

**Seul un rôle aux privilèges réellement limités ferme ces trois voies à la fois.**

## 2. Provisionnement — à exécuter par une intervention autorisée

À jouer une fois, sur la base de production. Chaque ordre est réversible (§5).

```sql
-- 1. Un rôle de connexion sans aucun privilège hérité.
CREATE ROLE catwalks_audit LOGIN PASSWORD '<mot de passe fort, hors dépôt>' NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;

-- 2. Lecture seule sur le schéma applicatif, et rien d'autre.
GRANT CONNECT ON DATABASE railway TO catwalks_audit;
GRANT USAGE ON SCHEMA public TO catwalks_audit;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO catwalks_audit;

-- 3. Les tables créées plus tard sont couvertes sans nouvelle intervention.
--    ATTENTION : `FOR ROLE` doit nommer le ou les rôles qui CRÉERONT les futurs objets — pas
--    seulement le propriétaire actuel des tables. Les deux peuvent différer : les migrations
--    Prisma s'exécutent avec le rôle de `DIRECT_URL`, qui n'est pas nécessairement celui qui
--    possède les tables aujourd'hui. Lire C0 ET C0bis avant d'exécuter, et répéter cet ordre
--    pour CHAQUE rôle créateur identifié — un objet créé par un rôle non listé restera
--    illisible, en silence.
ALTER DEFAULT PRIVILEGES FOR ROLE <chaque rôle créateur identifié par C0bis> IN SCHEMA public
  GRANT SELECT ON TABLES TO catwalks_audit;

-- 4. Ceinture ET bretelles : même si un privilège d'écriture était accordé par erreur, les
--    transactions de ce rôle démarrent en lecture seule.
ALTER ROLE catwalks_audit SET default_transaction_read_only = on;

-- 5. Une requête d'audit ne doit jamais tenir une connexion indéfiniment.
ALTER ROLE catwalks_audit SET statement_timeout = '60s';
ALTER ROLE catwalks_audit SET idle_in_transaction_session_timeout = '30s';
```

**Ce que la procédure ne fait PAS, volontairement** : aucun `GRANT` sur les séquences, les
fonctions ou les autres schémas ; aucune appartenance à un rôle existant (`NOINHERIT` + aucun
`GRANT role TO role`) ; aucune modification du rôle `postgres`.

## 3. Vérification — par LECTURE des privilèges effectifs

À jouer **avec les identifiants `catwalks_audit`**, avant toute mesure. Le nom du compte ne prouve
rien : ce sont les privilèges effectifs qui comptent.

> **Un privilège peut venir d'ailleurs que d'un `GRANT` nominatif.** Quatre vecteurs échappent à
> une lecture naïve de `information_schema.table_privileges`, et chacun suffit à rendre l'accès
> inscriptible : l'héritage de rôles, les droits accordés à **`PUBLIC`** (donc à tout rôle, y
> compris celui qu'on vient de créer), les **fonctions `SECURITY DEFINER`** exécutables (qui
> s'exécutent avec les droits de leur propriétaire, souvent le superutilisateur), et le privilège
> **`TEMPORARY`** sur la base. Les contrôles ci-dessous les couvrent explicitement.
>
> **« Aucun `GRANT` explicite » n'est jamais une preuve d'absence de droit effectif.**

```sql
-- C0 : le propriétaire réel des tables (à lire AVANT le §2, pour l'ordre 3).
SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public';

-- C0bis : QUI CRÉERA les futurs objets — c'est ce rôle que `ALTER DEFAULT PRIVILEGES FOR ROLE`
-- doit nommer, et il n'est pas forcément le propriétaire actuel des tables (C0).
--   · les migrations Prisma s'exécutent avec le rôle de `DIRECT_URL` ;
--   · un objet créé par un autre rôle ne sera PAS couvert, et la table restera illisible en
--     silence — l'audit rendra alors des mesures muettes sans erreur.
-- Lire les deux, et passer À CHACUN un `ALTER DEFAULT PRIVILEGES` s'ils diffèrent.
SELECT r.rolname AS createur_potentiel, count(c.oid) AS objets_possedes
  FROM pg_roles r
  LEFT JOIN pg_class c ON c.relowner = r.oid
   AND c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
 WHERE r.rolcanlogin OR c.oid IS NOT NULL
 GROUP BY r.rolname ORDER BY objets_possedes DESC;

-- C0ter : les défauts DÉJÀ posés, pour ne pas en ajouter un contradictoire.
SELECT pg_get_userbyid(defaclrole) AS pose_par, defaclobjtype AS type_objet, defaclacl AS droits
  FROM pg_default_acl WHERE defaclnamespace = 'public'::regnamespace;

-- C1 : identité et attributs. Attendu : rolsuper = false, et les trois autres false.
SELECT current_user, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
  FROM pg_roles WHERE rolname = current_user;

-- C2 : privilèges d'écriture EFFECTIFS, héritage compris. Attendu : 0.
SELECT count(*) AS tables_inscriptibles
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r','p') AND n.nspname = 'public'
   AND (has_table_privilege(current_user, c.oid, 'INSERT')
     OR has_table_privilege(current_user, c.oid, 'UPDATE')
     OR has_table_privilege(current_user, c.oid, 'DELETE')
     OR has_table_privilege(current_user, c.oid, 'TRUNCATE'));

-- C3 : couverture de lecture. Attendu : lisibles = total (sinon des mesures seront muettes).
SELECT count(*) FILTER (WHERE has_table_privilege(current_user, c.oid, 'SELECT')) AS lisibles,
       count(*) AS total
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r','p') AND n.nspname = 'public';

-- C4 : paramètres effectifs de la session. Attendu : on / 60s / 30s.
SELECT current_setting('default_transaction_read_only') AS lecture_seule,
       current_setting('statement_timeout')             AS delai_requete,
       current_setting('idle_in_transaction_session_timeout') AS delai_transaction;

-- C5 : création de schéma, de table, et TABLES TEMPORAIRES. Attendu : false partout.
-- `TEMPORARY` est accordé à PUBLIC par défaut sur toute base PostgreSQL : c'est exactement
-- ce qui a permis au `CREATE TEMP TABLE` de réussir en production le 2026-09-20.
SELECT has_database_privilege(current_user, current_database(), 'CREATE')    AS peut_creer_base,
       has_schema_privilege(current_user, 'public', 'CREATE')                AS peut_creer_schema,
       has_database_privilege(current_user, current_database(), 'TEMPORARY') AS peut_creer_temporaire;

-- C6 : les droits accordés à PUBLIC — donc hérités par TOUT rôle, sans GRANT nominatif.
-- Une table dont l'ACL contient `=arwd/...` est inscriptible par catwalks_audit sans que
-- le moindre GRANT ne le nomme.
SELECT n.nspname, c.relname, c.relacl
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r','p') AND n.nspname = 'public'
   AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a
                WHERE a.grantee = 0 AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE'));

-- C7 : les FONCTIONS SECURITY DEFINER exécutables par ce rôle.
-- Elles s'exécutent avec les droits de LEUR PROPRIÉTAIRE : une seule fonction de ce type,
-- exécutable et écrivant en base, annule tout le reste de la procédure.
SELECT n.nspname, p.proname, pg_get_userbyid(p.proowner) AS proprietaire,
       has_function_privilege(current_user, p.oid, 'EXECUTE') AS executable
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.prosecdef
   AND has_function_privilege(current_user, p.oid, 'EXECUTE')
   AND n.nspname NOT IN ('pg_catalog', 'information_schema');

-- C8 : appartenance à d'autres rôles (héritage de privilèges). Attendu : aucune ligne.
SELECT r.rolname AS role_herite, m.admin_option
  FROM pg_auth_members m
  JOIN pg_roles r ON r.oid = m.roleid
 WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user);
```

### RÉSULTAT MESURÉ DU §2 SEUL — C5 ÉCHOUE, ET C'EST ATTENDU

**Mesuré le 2026-09-21 sur base jetable, en n'exécutant QUE les ordres autorisés du §2** (sans
aucun `REVOKE` sur `PUBLIC`) :

```
✓ C1 ✓ C2 ✓ C3 ✓ C4   ✗ C5 base=false schema=false temporaire=TRUE   ✓ C6 ✓ C7 ✓ C8
```

`TEMPORARY` est accordé à `PUBLIC` par défaut sur toute base PostgreSQL. **L'intervention
autorisée ne peut pas le retirer** — ce serait une modification de droit partagé, hors périmètre.

**Ce que cela permet, et ne permet pas — mesuré, pas supposé :**

| Tentative | Résultat |
|---|---|
| `CREATE TEMP TABLE` sous le réglage du rôle | **REFUSÉ** — « cannot execute CREATE TABLE in a read-only transaction » |
| `SET default_transaction_read_only = off` puis `CREATE TEMP TABLE` + `INSERT` | **RÉUSSI** — le réglage est contournable par la session |
| `INSERT` sur une table applicative, même après ce contournement | **REFUSÉ** — `permission denied for table "Source"` |

**La conclusion est nette : les données métier sont protégées par un PRIVILÈGE (`GRANT SELECT`
seul), qui n'est pas contournable. Le `default_transaction_read_only` n'est qu'une ceinture
supplémentaire, et elle, l'est.** Le risque résiduel de `TEMPORARY` se limite donc à créer des
tables temporaires dans la session — ce qui ne touche aucune donnée métier et disparaît à la
déconnexion.

### DÉCISION DU 2026-09-21 — exception accordée, limitée au seul privilège TEMPORARY

Le CEO a tranché : **le compte d'audit conserve `TEMPORARY`**, hérité de `PUBLIC`.

**Aucun `REVOKE` sur `PUBLIC` ne sera exécuté.** Le contrôle a donc été scindé en deux, pour que
l'exception ne déborde pas :

| Contrôle | Portée | Statut |
|---|---|---|
| **C5** | `CREATE` sur la base et sur le schéma — objets **PERMANENTS**, qui survivent à la session | **BLOQUANT, sans exception** |
| **C5bis** | `TEMPORARY` — objets de session, détruits à la déconnexion | **consigné, jamais bloquant** |

Les fusionner aurait fait échouer l'ensemble pour le seul privilège dont le risque est borné, et
poussé à désactiver C5 en bloc — donc à autoriser silencieusement la création d'objets permanents.

**Éprouvé sur base jetable** : avec les seuls ordres autorisés du §2, les contrôles passent ; en
accordant `CREATE` sur le schéma, C5 bloque (code 1) **alors que l'exception TEMPORARY reste
accordée**. Elle ne couvre rien d'autre.

**L'exception ne couvre AUCUN autre échec.** Tous les autres contrôles restent bloquants :
privilèges d'écriture applicatifs (C2), attributs du rôle (C1), héritage et élévation (C7, C8),
droits de lecture (C3), paramètres de session (C4). Une **erreur d'inspection** n'est jamais
assimilée à un succès : `ouvrirAccesAudit` lève et ferme la connexion.

### RISQUE RÉSIDUEL — énoncé honnêtement

**Cet accès n'est pas une garantie absolue d'impossibilité d'écrire.** Ce qui est garanti :

- **les données métier sont protégées par un PRIVILÈGE** (`GRANT SELECT` seul), qui n'est pas
  contournable — mesuré : `permission denied for table "Source"` même après avoir levé la lecture
  seule ;
- **ce qui reste possible** : une session peut exécuter `SET default_transaction_read_only = off`,
  puis créer des tables temporaires et y écrire.

**Conséquence opérationnelle à ne pas minimiser** : ces objets consomment des **ressources
serveur** — mémoire de travail et espace disque temporaire. Un volume important pourrait gêner la
production, même sans toucher une seule donnée métier. Ils disparaissent à la déconnexion.

Ce risque est **imprimé à chaque exécution** du contrôle d'accès, pas seulement écrit ici.

**Critère d'acceptation** — les huit doivent passer :

| Contrôle | Attendu |
|---|---|
| C1 | `rolsuper = false`, et `rolcreatedb` / `rolcreaterole` / `rolbypassrls` à `false` |
| C2 | **0** table inscriptible |
| C3 | `lisibles = total` (sinon des mesures seront muettes sans erreur) |
| C4 | `on` · `60s` · `30s` |
| C5 | `false` · `false` · **`false`** (y compris `TEMPORARY`) |
| C6 | **aucune ligne** — rien d'inscriptible via `PUBLIC` |
| C7 | **aucune ligne** — aucune fonction `SECURITY DEFINER` exécutable |
| C8 | **aucune ligne** — aucun rôle hérité |

Si C5 rend `peut_creer_temporaire = true`, il faut **`REVOKE TEMPORARY ON DATABASE railway FROM
PUBLIC`** — mais c'est une modification de **droit partagé**, qui affecte tous les rôles de la
base : elle ne peut pas être décidée ici et doit faire l'objet d'une autorisation distincte
(§6). Si C6 ou C7 rendent des lignes, la procédure **ne suffit pas** en l'état : il faut
instruire chaque objet nommé avant de déclarer l'accès sûr.

**Aucune de ces vérifications n'écrit.** Les tests de refus d'écriture, la réintroduction
volontaire de défauts et les épreuves de pool restent **exclusivement sur la base de test isolée**
(`db.py test`), jamais sur la production.

## 4. Règle d'exploitation

1. `inspecterAcces()` (`apps/aggregator/scripts/ops/lot0-v2-db.ts`) exécute déjà C1, C2 et C4 par
   lecture. Les scripts de mesure l'appellent avec `exigerLectureSeule: true`.
2. **Aucun repli vers `postgres` si l'accès d'audit manque ou si une vérification échoue.** Le
   script s'arrête ; il ne se rabat sur rien.
3. Une fois L1 exécuté, la cible `db.py readonly` doit être **rebranchée** sur ce rôle — ou
   retirée, puisqu'elle annonce aujourd'hui une garantie qu'elle ne fournit pas.
4. Pour le travail en development : produire un **export ou une copie de référence** depuis cet
   accès, et travailler dessus. Le corpus de travail est alors daté et rejouable, et la production
   n'est plus sollicitée par les itérations d'audit.

## 5. Retour arrière

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM catwalks_audit;
REVOKE ALL ON SCHEMA public FROM catwalks_audit;
REVOKE ALL ON DATABASE railway FROM catwalks_audit;
ALTER DEFAULT PRIVILEGES FOR ROLE <propriétaire> IN SCHEMA public
  REVOKE SELECT ON TABLES FROM catwalks_audit;
DROP ROLE catwalks_audit;
```

Ce rôle ne possède aucun objet : sa suppression ne peut entraîner aucune perte de données.

---

## 6. L'opération exacte restant à autoriser

**Ce qui est demandé** : exécuter le §2 (création du rôle `catwalks_audit`), puis le §3
(vérification par lecture). Rien d'autre.

| | |
|---|---|
| **Portée** | création d'**un rôle nouveau**, sans aucun objet ; `GRANT SELECT` sur le schéma `public` ; réglages de session propres à ce rôle |
| **Ce qui n'est PAS touché** | le rôle `postgres` · les rôles existants · les droits de `PUBLIC` · les données · le schéma · les migrations |
| **Réversibilité** | totale, §5. Le rôle ne possède aucun objet : sa suppression ne peut entraîner aucune perte |
| **Durée** | quelques minutes |
| **Qui exécute** | un opérateur autorisé, avec les identifiants d'administration. **Pas l'assistant** |

**Une opération distincte, à autoriser séparément si C5 l'exige** :

```sql
REVOKE TEMPORARY ON DATABASE railway FROM PUBLIC;
```

Elle **modifie un droit partagé** : elle retire la création de tables temporaires à **tous** les
rôles de la base, y compris applicatifs. Si un composant s'appuie sur des tables temporaires, il
cesserait de fonctionner. Elle ne doit donc être envisagée qu'après inventaire de ces usages, et
ne fait **pas** partie de la demande ci-dessus.

**Après exécution** : rejouer les huit contrôles du §3 avec les identifiants `catwalks_audit`, et
consigner leurs sorties. Tant que les huit ne sont pas verts, aucune mesure ne démarre et aucun
repli vers `postgres` n'est admis.
