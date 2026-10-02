# D-511 : candidatures spontanées, mesure et passage à blanc (02/10/2026)

Lecture seule de la production (`db.py readonly`, psql, aucune écriture), le 02/10/2026 vers 07:45 UTC.
Règle relue après l'audit adverse du même jour (pluriel après séparateur, fonction après le libellé) : même liste de 62.

| Fichier | Contenu |
|---|---|
| `decouverte.sql` | offres publiques dont l'intitulé contient un libellé voisin n'importe où (193 lignes), pour voir aussi les vrais postes qui le contiennent |
| `champs-natifs.sql` | clés natives d'éditeur dans le RAW des 90 735 publications publiques : seul TalentRecruiter (`ProjectType`) en porte une |
| `export.sql` | export JSON des publications publiques, entrée du passage à blanc (non versionné : 90 735 lignes) |
| `a-blanc.json`, `retraits-a-blanc.csv` | sortie (avec les cas voisins hors règle) de `apps/aggregator/scripts/ops/mesures/d511-spontanees-a-blanc.mts` : la règle de la collecte appliquée à chaque publication |

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

Une source ne publie que des candidatures spontanées : `lerros` (« Initiativbewerbung »). Sa collecte, qui ne qualifiait
aucune publication, était refusée avant d'atteindre le retrait ; elle est désormais validée pour cette seule raison
(`connectors/sourceValidation.ts`), et le retrait a lieu.

## Hors de la liste, nommément

- **Manqués par la règle** (libellé ni en tête ni en tête de segment) : adidas « SALES ASSISTANT (M/F/D)
  TEILZEIT/VOLLZEIT INITIATIVBEWERBUNG - FACTORY OUTLET, SALZBURG », H&M « Pattern Maker- H&M Open Application ».
- **Hors règle, à arbitrer** : 124 offres « Talent Pool / Community / Network » (31), « Future Opportunities » (65),
  « Expression of Interest » (20), « Vivier » (6), « Register your interest » (2), comptées par le même script
  (`voisinsHorsRegle` dans `a-blanc.json` ; LVMH 18, Mejuri 18, MECCA 14, Sephora 11…). Elles ne portent pas le
  libellé d'une candidature spontanée, mais beaucoup ne nomment aucun poste : Mejuri 16 sur 18 (« Future
  Opportunities - (Boston) »), Brown Thomas 7 (une équipe), Brioni 2 (une région), des inscriptions « Talent
  Community » (PVH, Arc'teryx, Nutrafol…). Leur sort est une question ouverte sous D-511 : rien ne les retire.
- **Vrais postes qui contiennent un mot voisin**, gardés : « Manager, Retail Operations, Initiatives - APAC »,
  « Initiative Management Team Leader », « Roger Vivier » (Bloomingdale's), « Women's Initiative » (Richemont)…
