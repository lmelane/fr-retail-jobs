# D-488 : la recherche par métier limitée aux langues du marché (mesures du 30/09/2026)

*Statut : **construit sur la branche `perf/d488-variantes-langues-marche`, non déployé.** Code :
`apps/api/lib/search-langues.ts` (quelles variantes), `apps/api/lib/search-chemin.ts` (quel chemin), `search-sql.ts`,
`search-model.ts`, `job-search-query.ts`, `suggestions.ts`. Témoins : `lib/__tests__/langues-marche-d488.test.ts`,
`lib/jobs-database.test.ts` (« D-488 »).*

## Ce qui change

1. **Les variantes.** Une clause de métier ne garde, pour un marché, que les libellés des langues du marché (locales, plus
   l'anglais), les libellés d'autres langues écrits avec les seuls mots de ces langues (« Sales Assistant », libellé
   italien), les variantes sans langue écrites dans les écritures du marché, et ce que la personne a tapé.
   « conseiller de vente » en France : 80 expressions → 50. L'anglais est présent dans chaque marché mesuré (offres
   actives en anglais : France 7 %, Allemagne 19 %, Italie 31 %, Chine 40 %, Japon 64 %, Hong Kong 96 %).
2. **Le chemin.** Restreinte, la requête paraissait assez courte au planificateur pour qu'il passe par l'index plein texte,
   dont les mots très fréquents (« de », « sales ») coûtent ~200 ms à parcourir : l'Allemagne passait de 133 à 307 ms.
   Une clause de métier est donc vérifiée offre par offre dans le marché quand le marché compte au plus 5 000 offres
   actives ou que le métier en porte au moins 20 % ; sinon l'index reste disponible. Le chemin ne change aucun résultat.

## Mesures

Toutes les lectures de production sont des `SELECT` par `psql`, transaction en lecture seule par défaut, délai borné
(même construction d'URL que `apps/aggregator/scripts/ops/db.py readonly`). Aucune écriture en production.

| Mesure | Script | Résultat |
|---|---|---|
| Mêmes résultats pour le marché : 15 marchés × 12 métiers, tous les documents de `search-5` du marché, requête entière contre restreinte | `requetes.mts` | 177 cas sur 180 identiques (mêmes offres, mêmes scores) ; `resultats/comparaison-180-production.txt` |
| Les 3 écarts | `ecarts.mts` | France « Hôte de caisse » : 8 faux résultats retirés (le libellé roumain « Casier » trouvait le mot français « casier » dans des offres d'opérateur de production) ; États-Unis et Allemagne « Store manager » : 1 offre au titre français (« Responsable de boutique Parfums New York ») toujours trouvée, score plus bas |
| Requête servie (`getJobs`), capturée sur base jetable puis rejouée en production, 137 recherches, 12 marchés | `capture-sql.mts`, `choisir-chemin.py`, `bilan-servie.py` | 14,4 s → 8,5 s (-41 %) ; « conseiller de vente » FR 402 → 307 ms, « sales advisor » US 882 → 618 ms, « Responsable de boutique » FR 222 → 127 ms ; un seul cas plus lent de plus de 30 ms (« Watchmaker » GB 29 → 98 ms) ; `resultats/grille-137-regle-finale-production.txt` |
| « conseiller de vente » FR seul, requête servie avant/après alternées, 9 tours (01/10/2026 04:30 UTC) | `capture-sql.mts` | médiane 419 → 284 ms (-32 %), mêmes offres et même page ; `resultats/conseiller-de-vente-fr-9-tours-production.txt`. Temps SQL seul : la référence de 531 ms citée pour search-5 est mesurée à l'API (réseau, page, fiche compris) ; l'API n'étant pas déployée, l'après de bout en bout se mesure au déploiement |
| Pourquoi la règle de chemin | idem, trois variantes | restriction seule 13,0 s (14 cas plus lents, Allemagne 133 → 307 ms) ; relecture partout 13,0 s (26 cas plus lents, « Visual merchandiser » US 48 → 355 ms) ; `resultats/grille-137-trois-chemins-production.txt` |
| Latence locale, base jetable (jeu de la répétition 2C : 91 336 offres de l'export du 29/09, descriptions courtes, v3 activée par l'outillage, search-5 construite) | `seed.mts`, `latence.mts`, `bilan.py` | restriction seule : 15 recherches, mêmes offres et même première page, métiers 32 à 59 % plus rapides ; règle finale : idem sauf « sales advisor » GB et « Verkaufsberater » DE plus lents en local (-27 %, -30 %), plus rapides ou égaux en production (178 contre 162 ms, 96 contre 128 ms) : les plans dépendent de la taille réelle des documents (4,4 Ko de description en production) ; `resultats/latence-locale-*.txt` |

| Suggestions d'intitulés (`/api/suggest`, une recherche EXISTS par candidat, même restriction et même chemin que la recherche), 11 frappes, capturées puis rejouées | `capture-sql.mts` (`SUGGESTIONS=1`) | mêmes suggestions partout ; « conseil » FR 730 → 123 ms, « sales » US 1 580 → 215 ms, « verk » DE 729 → 75 ms ; `resultats/suggestions-11-production*.txt` |

La base locale (conteneur `cw-d488-mesure`, volume anonyme) est supprimée après la mesure.

## Limites connues

- Une variante sans langue en écriture latine reste dans tous les marchés latins (« Sprzedawca » en France) : le
  manifeste v3 ne dit pas la langue de ses variantes relevées. Le champ « variantes par langue » prévu au plan (§3.1)
  lèverait cette limite.
- La répartition qui choisit le chemin est relue au plus toutes les 10 minutes par instance (120 à 145 ms à froid pour
  les États-Unis) ; elle ne compte que les offres agrégées actives.
- Les familles et les secteurs gardent toutes leurs variantes : la décision porte sur la recherche par métier, et une
  famille se trouve aussi par ses seuls mots (la restreindre pourrait retirer des offres).
- **Défaut connu, antérieur à D-488 : les suggestions d'intitulés restent lentes pour certaines frappes** (« vend » FR
  7,4 s avant, 3,2 s après ; « store » US 4,3 → 1,7 s ; « sales » GB 3,0 → 1,9 s). La requête évalue les 24 candidats
  (`UNION ALL` d'EXISTS) avant de trier et de garder les 8 premiers ; un candidat sans offre dans le marché coûte une
  relecture complète. Correctif proposé, hors de ce lot : évaluer les candidats dans l'ordre et s'arrêter au huitième
  trouvé. Les temps d'une même requête varient beaucoup d'un tour à l'autre (« coiff » FR : 139 ms puis 1 583 ms pour
  le même SQL).
- Les requêtes à plusieurs clauses de la grille « trois chemins » (2 cas sur 137) comparent la forme « une condition par
  clause » à la forme d'origine ; toutes les autres comparent les requêtes exactes du code.
