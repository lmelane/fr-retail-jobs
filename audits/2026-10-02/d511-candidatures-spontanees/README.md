# D-511 : candidatures spontanées, mesure et passage à blanc (02/10/2026)

Lecture seule de la production (`db.py readonly`, psql, aucune écriture), le 02/10/2026 vers 07:45 UTC.

| Fichier | Contenu |
|---|---|
| `decouverte.sql` | offres publiques dont l'intitulé contient un libellé voisin n'importe où (193 lignes), pour voir aussi les vrais postes qui le contiennent |
| `champs-natifs.sql` | clés natives d'éditeur dans le RAW des 90 735 publications publiques : seul TalentRecruiter (`ProjectType`) en porte une |
| `export.sql` | export JSON des publications publiques, entrée du passage à blanc (non versionné : 90 735 lignes) |
| `a-blanc.json`, `retraits-a-blanc.csv` | sortie de `apps/aggregator/scripts/ops/mesures/d511-spontanees-a-blanc.mts` : la règle de la collecte appliquée à chaque publication |

Rejouer :

```sh
python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -At -v ON_ERROR_STOP=1 -f audits/2026-10-02/d511-candidatures-spontanees/export.sql' > publiques.jsonl
npx tsx apps/aggregator/scripts/ops/mesures/d511-spontanees-a-blanc.mts publiques.jsonl > a-blanc.json
```

## Résultat

**62 offres publiques** seraient retirées, une publication chacune, aucune portée par une autre source, sur **40 sources**
(59 sur des sources ACTIVE ; 3 sur des sources en pause : Marc O'Polo 2, Swatch 1). Preuve : le champ natif pour 2
(GANNI « Unsolicited applications », Funky Buddha « Εκδήλωση Ενδιαφέροντος »), le libellé pour 60. Aucune divergence
entre l'intitulé de la source, l'intitulé brut et l'intitulé publié.

Le retrait n'a lieu qu'à la prochaine collecte admise de chaque source (RUN de 18 h) ; une source en pause ne retire rien
tant qu'elle n'est pas rouverte.

## Hors de la liste, nommément

- **Manqués par la règle** (libellé ni en tête ni en tête de segment) : adidas « SALES ASSISTANT (M/F/D)
  TEILZEIT/VOLLZEIT INITIATIVBEWERBUNG - FACTORY OUTLET, SALZBURG », H&M « Pattern Maker- H&M Open Application ».
- **Hors règle** (lecture D-492 sous D-511) : 115 « Talent Pool », « Future Opportunities », « Expression of
  Interest », « Vivier », « Register your interest » (Mejuri 18, MECCA 14, LVMH et Sephora UK, Kering, H&M…), dont
  **8 inscriptions sans poste** (« Join the PVH Talent Community », Arc'teryx, Nutrafol, Nutrire, Hugo Boss Izmir,
  Chalhoub, Ounass, Breitling « Talent Pool #Squadonamission ») : voir `decouverte.sql`.
- **Vrais postes qui contiennent un mot voisin**, gardés : « Manager, Retail Operations, Initiatives - APAC »,
  « Initiative Management Team Leader », « Roger Vivier » (Bloomingdale's), « Women's Initiative » (Richemont)…
