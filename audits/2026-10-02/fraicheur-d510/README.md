# D-510 : les offres triées par fraîcheur (mesures du 02/10/2026)

*Statut : construit sur `development`, non livré. Code : `apps/api/lib/fraicheur.ts` (la clé),
`apps/api/lib/job-search-query.ts` (recherche, curseur, examen des alertes), `apps/api/lib/jobs.ts` (empreinte du
curseur, offres similaires), `apps/api/lib/contrat-client.ts` (servi au seul client `x-catwalks-client: 2`). Témoins :
`apps/api/lib/__tests__/fraicheur-d510.test.ts`.*

Toutes les lectures de production sont des `SELECT`, cible `readonly` de `db.py` (`psql`), ou une session Prisma en
lecture seule (`default_transaction_read_only` posé dans l'URL, prouvé sur base jetable : un `CREATE TEMP TABLE` y est
refusé, code 25006). Aucune écriture en production.

| Mesure | Script | Résultat |
|---|---|---|
| Que vaut `postedAt` sur les offres servies ? | `mesure-postedat.sql` | 89 766 offres agrégées publiques : 3 166 sans date (3,5 %), dont 2 024 sans pays, jamais servies (deux sources n'en donnent aucune : Boots, 1 985 offres, et Pandora, 1 024) ; 0 date future (l'ingestion écarte une date à plus d'un jour, `plausiblePostedAt`) ; 2 928 dates postérieures de plus d'un jour à la première observation (republications : Sephora 475, LVMH 276…) ; 4 100 de plus d'un an ; servies sans date : FR 197 sur 13 534, US 122 sur 40 626, entrées du 23/09 au 01/10 ; 59 offres Catwalks, toutes datées, aucune incohérente ; `resultats/mesure-postedat-production-2026-10-02.txt` |
| Latence de la requête servie au contrat 2, avant (code de `development` 9711ae0, qui trie par distance et pertinence) et après, 152 recherches (les 137 de D-488 et les 15 de proximité de D-496), 7 tours alternés, rejouée en production | `capture-servie.mts`, `../../2026-10-01/localisation/bilan-rejeu.py` | somme des médianes 9 875 → 7 831 ms (-20,7 %) : la pertinence n'est plus calculée ; grille D-488 7 970 → 6 215 ms, proximité D-496 1 905 → 1 616 ms ; aucun cas plus lent de plus de 30 ms ; mêmes totaux dans les 152 cas ; `resultats/latences-avant-apres-production-7-tours-2026-10-02.txt` |
| Les intitulés de la première page (25 offres) : combien portent les mots de la requête, avant (distance puis pertinence) et après (fraîcheur) | `intitules-premiere-page.sql` (texte capturé) | « conseiller de vente » FR 25 → 25 ; « responsable de boutique » FR 25 → 21 ; « sales advisor » US 24 → 25 ; « Verkaufsberater » DE 7 → 8 (mesure par mots de l'intitulé, approchée) ; `resultats/intitules-premiere-page-production-2026-10-02.txt` |
| La première page sans critère : Maisons distinctes et la plus présente, avant et après | `premiere-page.sql` | FR : 25 offres Catwalks avant et après ; DE : H&M Group 12 → 17 sur 25 ; GB : White Stuff 12 → 13 ; US : Sephora 23 (ses republications) → Ulta Beauty 19 ; `resultats/premiere-page-production-2026-10-02.txt` |
| La requête du contrat 1 (catwalks.io en production, sans l'en-tête) ne change pas | `capture-servie.mts` (`CONTRAT=1`), `comparer-contrat1.py` | 152 requêtes identiques aux différences de forme près (instant de la requête, espaces, alias `pri AS pri`) ; `resultats/contrat1-requete-identique-2026-10-02.txt` |

## La clé retenue

`LEAST(postedAt, firstSeenAt)` (`receivedAt` pour une offre Catwalks) : la date de publication de la source, sauf
quand elle manque, qu'elle est future ou qu'elle est postérieure à notre première observation (l'offre était en ligne
avant la date qu'elle annonce). Une seule expression, sans seuil arbitraire.

## Limites connues

- Les offres sans date du stock initial (entrées au catalogue du 23 au 24/09) sont datées de leur entrée : FR 197 offres
  servies, US 122. Les offres sans date entrées depuis sont datées à un jour près (RUN quotidien).
- La fiche affiche « Publiée il y a… » depuis la date de la publication ; une offre republiée (3,3 %) est rangée à sa
  première observation, plus ancienne que la date affichée. La liste n'affiche pas de date (D-415).
- Le rejeu par `psql` envoie un texte littéral (plan personnalisé) ; le rôle de l'API force le plan personnalisé
  (`plan_cache_mode = force_custom_plan`, D-496).
