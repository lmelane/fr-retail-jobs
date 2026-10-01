# D-500 : la recherche comprend-elle la requête ? (mesures du 01/10/2026)

*Statut : **mesures seulement**, aucun code applicatif. Révision mesurée : `development` `ecc2846` (le code de la
recherche et des suggestions y est celui de D-488, `search-5-20260924-v2`, manifeste
`catwalks-occupations-20260929-v3`, empreinte vérifiée contre la version active en production). Le cahier qui s'appuie
sur ces chiffres : `docs/architecture/lot-comprehension-requete.md` du backend.*

## Comment c'est mesuré

- `mesure.mts` charge le **vrai** modèle de recherche (`snapshotModel`, avec les sociétés, alias et secteurs lus en
  production comme `getSearchContext`), le **vrai** SQL (`searchSql`, `publicJobSql`, `directPubliableSql`, chemin de
  D-488 compris) et la **vraie** réduction d'intitulé (`roleKeyword`). Il écrit le SQL en texte et le rejoue par
  `apps/aggregator/scripts/ops/db.py readonly` : `psql`, `SET default_transaction_read_only = on`, délai de 25 s,
  uniquement des `SELECT`. Aucun Prisma vers la production, aucune écriture.
- Les suggestions sont rejouées étape par étape, comme `suggestTitlesDetaillees` (`apps/api/lib/suggestions.ts:169-217`) :
  les 40 intitulés bruts, la réduction `roleKeyword` et le dédoublonnage (copie de `dedupliquer`, non exporté), les
  variantes de la taxonomie, puis la requête `EXISTS` qui valide les 24 candidats. Pour chaque suggestion servie, on
  compte ce que rend son choix : `metier=` quand elle nomme un métier (`ChampSuggestions.tsx:444-450` du site), sinon
  le texte `q`.
- `indeed-autocomplete.sh` relève l'autocomplétion publique d'Indeed (sans cookie).

```sh
# racine d'un arbre de l'agrégateur à la révision mesurée
CATWALKS_DB_ACCESS=<dossier des accès> npx tsx audits/2026-10-01/d500-requete/mesure.mts            # les 4 parties
CATWALKS_DB_ACCESS=<dossier des accès> npx tsx audits/2026-10-01/d500-requete/mesure.mts couverture # une seule
sh audits/2026-10-01/d500-requete/indeed-autocomplete.sh > audits/2026-10-01/d500-requete/resultats/indeed-autocomplete.txt
```

## Résultats (production, 01/10/2026 vers 14:25 UTC)

| Mesure | Fichier | Résultat |
|---|---|---|
| Couverture de la taxonomie v3 | `resultats/taxonomie.txt` | 253 métiers, 33 familles, libellés dans les 25 langues (252 à 253 par langue) ; 839 libellés hors anglais sur 6 069 sont identiques au libellé anglais ; 6 601 variantes, **sans langue** |
| Formes tapées comprises | idem | Masculin, féminin, pluriel, accents, majuscules d'un libellé ou d'une variante : compris. **Non compris** : l'écriture inclusive « conseiller(ère) », « conseiller·ère », « conseiller.e » (4 mots obligatoires, dont « ere »), « conseillère » seul (mot exact), « responsable boutique » sans « de ». Tout mot en plus devient obligatoire : « /NB » → `nb`, « H/F » → `h` et `f`, « CDD », « Toulouse », « expérimentée » |
| Offres qui portent un métier | `resultats/couverture.txt` | FR 61,0 % (13 404 offres), GB 58,2 % (4 171), US 69,6 % (39 911), toutes 63,5 % (88 016) ; famille seule FR 34,3 %, rien FR 4,7 % |
| Suggestions servies, 10 frappes × FR et GB | `resultats/suggestions.txt` | 134 suggestions : 104 viennent d'un intitulé d'offre ; **84 (63 %) ne nomment aucun métier** et lancent une recherche de texte ; 32 portent un marqueur brut (contrat, H/F, « /X », parenthèses, heures), 7 un nom de ville, 15 sont en capitales ; 16 lignes en double pour un même métier ; 1 suggestion mène à **0 offre** (« Directeur Supply Chain », GB : validée par le texte, cherchée par le code). Temps : titres médiane 82 ms ; validation des candidats médiane 1,08 s, **jusqu'à 6,3 s** (GB « directeur »), 3,4 s (FR « vendeu ») |
| Ce que rend un choix | idem | FR « conseill » : « Conseiller de Vente » → 4 541 offres (`metier=`), « Conseiller de Vente CDD » → 1 552 (texte), « Conseillère de Vente Paris » → 915, « Conseiller de vente (stage) » → 161 |
| Texte contre métier, 11 requêtes × FR et GB | `resultats/recouvrement.txt` | Une forme comprise (« conseillère de vente », « vendeuse », « sales advisor », « directrice de magasin », « make-up artist ») rend **toutes** les offres du métier, plus des offres sans métier (FR +129 pour le conseil de vente, +113 pour la direction de boutique). Une forme non comprise en perd : « conseiller(ère) de vente » 80,4 % (FR) et 99,6 % (GB) ; « CONSEILLER DE VENTE /NB » 96,4 % et 100 %. « conseillère de vente luxe » reste précise en France (476 offres), rend 0 au Royaume-Uni (« luxe » n'y est pas écrit). Compte de la condition de texte : 100 à 165 ms en France ; du filtre métier : 30 à 66 ms |

## Limites

- Les durées sont celles des **comptes** (condition seule, `psql \timing`), pas de la requête servie (page, facettes,
  score) : la référence de bout en bout reste la grille de 137 recherches de D-488 (`../d488-langues-marche/`, méthode
  `capture-sql.mts`), à rejouer avant et après la construction.
- Les recherches réellement tapées ne sont enregistrées nulle part de façon agrégée : ni le catalogue ni le site ne
  journalisent `q` dans une table (seules les recherches récentes d'un inscrit, côté backend, par compte) ; le site
  n'envoie aucun événement de recherche, et PostHog réduit la query de chaque adresse aux seuls `utm_*`
  (`PostHogProvider.tsx:78-82` du site, `assainirEvenement`). La popularité des requêtes n'a donc pas pu être mesurée,
  et aucune source ne la porte aujourd'hui.
- Les drapeaux « marqueur brut » et « ville » sont des heuristiques (`BRUIT` dans `mesure.mts`, villes d'au moins
  3 offres du marché) : ils servent à compter, pas à filtrer.
