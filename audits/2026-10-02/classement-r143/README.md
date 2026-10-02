# R-143 §7 : le classement pertinent (mesures du 02/10/2026)

*Statut : construit sur `development`, non livré. Code : `apps/api/lib/classement.ts` (la formule), `search-plan.ts`
(`pertinenceDe` : quand l'ordre devient pertinent), `job-search-query.ts` (`pageClassee`, examen d'une alerte),
`search-sql.ts` (`intituleSql`), `jobs.ts` (préférences `pref_*`, curseur à six termes, `classement` de chaque offre).
Témoins : `apps/api/lib/__tests__/classement-r143.test.ts`.*

## La formule

`score = (5 + intitulé + lieu + contrat + télétravail + salaire) × ½ ^ (âge en jours / 14)`, au contrat 2, dès qu'il y a
une requête tapée, un métier choisi (filtre `metier`) ou des préférences transmises. Points : intitulé 40 (il porte chaque mot de
la requête, écriture inclusive comprise, ou le métier tapé ou choisi est son métier principal) / 25 (métier cherché lu dans l'intitulé) / 0 ; lieu 20 (≤ 15 km ou
dans la ville) / 13 (≤ 30 km) / 7 (≤ 50 km) / 0, ou 20 dans une ville des préférences ; contrat 30 accord / 15 inconnu ou
neutre / 0 désaccord ; télétravail et salaire 10 / 5 / 0, aux règles des pastilles du site (`coches.ts`). Ordre :
origine (Catwalks d'abord), offres reconnues d'un filtre d'emploi, score, fraîcheur, identifiant.

## Lecture seule

Toutes les lectures de production passent par `mesure-servie.mts` : session Prisma `default_transaction_read_only=on`
(vérifiée avant la mesure), `$executeRaw`, `$queryRawUnsafe` et `$transaction` refusés, toute requête autre qu'un
`SELECT`/`WITH` refusée. **Une adaptation** : la production n'a pas encore `JobSource.availabilityHold` (migration
`20261002140000`, release r6) ; le prédicat `… "availabilityHold" IS NULL`, vrai pour toute ligne sans retenue, est
remplacé par `true`, à l'identique avant et après. Les profils viennent du backend (`scripts/mesure-profils-classement-r143-2026-10-02.mts`,
transaction `READ ONLY`) : la table des préférences n'existe pas encore en production, ce sont les préférences que la
conversion des profils (R-136) donnera, critères seuls, sans personne.

| Mesure | Script | Résultat |
|---|---|---|
| Première page, 10 requêtes de D-488 et l'accueil de 5 profils réels, avant (D-510) et après | `mesure-servie.mts` (`MODE=page`), `bilan-premiere-page.py` | `resultats/bilan-premiere-page-2026-10-02.txt` |
| Latence de la requête servie au contrat 2, 152 recherches de D-510, 7 tours alternés, deux rejeux (code corrigé après l'audit) | `mesure-servie.mts` (`MODE=capture`), `../../2026-10-01/localisation/bilan-rejeu.py` | somme des médianes 7 959 → 8 344 ms (+4,8 %) et 7 936 → 8 153 ms (+2,7 %) ; plus forte régression présente aux deux rejeux : US Sales advisor +40 ms (302 → 354 et 310 → 350 ms, 10 300 offres) ; un seul cas plus lent de plus de 30 ms aux deux, aucun de plus de 50 ; mêmes totaux dans les 152 cas ; `resultats/latences-*` |
| La requête et la réponse du contrat 1 (sans l'en-tête) ne changent pas | `mesure-servie.mts` (`MODE=capture CONTRAT=1`), `../fraicheur-d510/comparer-contrat1.py` | 152 requêtes identiques aux différences de forme près, puis exécutées : 152 réponses identiques (total, md5 de la page) ; `resultats/contrat1-requete-identique-2026-10-02.txt` |

Régression maximale tolérée (seuil de l’assistant, lecture D-492) : 50 ms par cas, présente aux deux rejeux, et 10 % sur la somme des
médianes.
