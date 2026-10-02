# Suites du classement (R-143 §6, §7, §10 ; D-513, D-515) — mesures du 02/10/2026

*Statut : construit sur `development`, non livré. Lecture de l'assistant ([[D-492]]).*

## 1. Secteur, langue, programme : l'inconnu n'est pas un désaccord, et ne noie pas la liste (D-515 §1)

Au contrat 2, un filtre `secteur`, `langue` ou `programme` garde la liste des offres reconnues (liste, facettes, compte :
le filtre strict d'avant, à l'offre près) ; les offres dont la donnée est inconnue (Maison sans secteur, langue du texte
absente ou vide) forment une section à part (`section=inconnues`), `NON_CONFIRMEE` avec leurs dimensions, que le site
annonce sous le compte (« + N sans secteur précisé ») et borne (trois offres, puis « Voir les N autres ») ; une valeur
connue et contraire n'est dans aucune des deux ; l'option « Non classé » demande les offres sans secteur, qui y sont
reconnues. L'examen d'une alerte ne les envoie, à part, que si l'alerte correspond fortement (requête, métier, lieu ou
ville : `alerteForte`) ; une alerte sur un seul secteur n'envoie que des confirmées. Le programme n'est servi par aucun
marché aujourd'hui (filtre refusé, `FACETTE_NON_SERVIE`) : il suit le contrat unifié. Code : `apps/api/lib/job-search-query.ts`
(`precise`, `nonPreciseesFiltrees`, `sectionSql`), `search-plan.ts` (`DIMENSIONS_A_PART`, `alerteForte`). Témoins :
`apps/api/lib/__tests__/inconnu-pas-negatif-d515.test.ts` (6 sur 10 échouent sur le code d'avant).

| Mesure | Script | Résultat |
|---|---|---|
| Par marché et par valeur proposée, avant / après (440 recherches, 41 marchés, production en lecture seule) | `mesure-inconnu.mts` (code d'avant `43e9b66`, puis code d'après avec `SECTION=1`), `bilan-inconnu.py` | `resultats/bilan-inconnu-2026-10-02.txt` : dans les 440 cas, la liste d'après (total et confirmées) est le filtre strict d'avant ; sections à part : secteur 326 988, langue 5 198 (sommes sur les valeurs). « Lunetterie » aux États-Unis : liste 6, section 15 382 ; Horlogerie US : 131 et 15 382 ; Beauté US : 13 087 et 15 382 ; Joaillerie FR : 1 304 et 3 968. Secteur inconnu sur 33 907 des 85 282 offres servies des marchés, langue sur 1 392 |
| Offres Catwalks publiables sans secteur, langue, contrat ou temps de travail | `offres-catwalks-inconnues.sql` | `resultats/offres-catwalks-inconnues-2026-10-02.txt` : 59 publiables ; 0 sans secteur, 9 sans langue (section à part), 0 sans contrat, 0 sans temps |
| Le contrat 1 ne change pas : les 152 recherches de D-510, plus 12 qui portent secteur et langue | `capture-contrat1.mts` (`CONTRAT=1`), `../fraicheur-d510/comparer-contrat1.py`, puis `psql` (lecture seule) et `comparer-executions.py` | `resultats/contrat1-identique-2026-10-02.txt` : 164 requêtes identiques aux différences de forme près ; exécutées, 164 réponses (total, md5 de la page) identiques |

Adaptation de lecture, à l'identique des deux côtés : la production n'a pas encore `JobSource.availabilityHold` ; son
prédicat, vrai pour toute ligne sans retenue, est remplacé par `true` (comme `../classement-r143/`).

## 2. Les préférences ne voyagent plus dans une adresse

Le salaire, les villes, les contrats et les métiers de l'inscrit allaient en `pref_*` dans l'adresse du relais du site
(`/api/emplois/recherche`) puis de l'API (`/api/jobs`), que les journaux de Vercel et de Railway conservent. Ils voyagent
désormais dans l'en-tête `x-catwalks-preferences` (même encodage) ; l'API et le relais ne lisent plus aucun `pref_*`
d'adresse ; une réponse classée porte `cache-control: private, no-store` ; l'appel amont du site n'entre pas dans le cache
de données de Next. Témoins : `classement-r143.test.ts` (API : la route, l'adresse ignorée, aucun journal), site
`src/lib/preferences/__tests__/classement-r143.test.ts` et `src/app/api/emplois/recherche/__tests__/compte-alerte-r143.test.ts`.

## 3. La première page d'une recherche d'inscrit

Site : `VoletClasse` relit la première page avec les préférences et la substitue en une fois ; la liste du serveur reste
masquée jusque-là. Témoin de navigateur : `src/components/emplois/__tests__/classement-inscrit.e2e.ts` (Chromium,
375 et 1 280 px ; la liste du serveur n'est jamais vue, la page suivante part avec le curseur classé et l'en-tête).
