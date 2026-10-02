# D-512 : viviers, mesure et passage à blanc (02/10/2026)

Lecture seule de la production (`db.py readonly`, psql, aucune écriture), le 02/10/2026 entre 08:28 et 08:53 UTC, hors
de la fenêtre 15:30-18:30 UTC du RUN. Requêtes légères : la base filtre les intitulés avant l'export.

| Fichier | Contenu |
|---|---|
| `decouverte.sql` | formes voisines d'un vivier dans les intitulés publics, toutes langues qu'on sait nommer, comptées par forme : la prémisse de la règle (quels libellés existent vraiment) |
| `export.sql` | export JSON des publications publiques dont un intitulé contient talent, futur, interest, vivier ou bolsa (sur-ensemble des libellés de la règle), entrée du passage à blanc avec le lieu, la ville, le pays et la Maison de l'offre (391 lignes, non versionné) |
| `denominateur.sql` | publications publiques disponibles et offres distinctes : 90 735 publications, 89 766 offres |
| `garde-de-masse.sql` | publications par source des sources concernées, pour calibrer la garde de masse |
| `maisons.sql` | offres publiques des Maisons touchées : aucune n'est vidée (Brioni 24, HUGO BOSS Textile 8, Mejuri 172, Nutrafol 13, PVH 133, retraits compris) |
| `rejeu-d511.json` | le passage à blanc de D-511 rejoué avec la règle de ce lot sur son export (`../d511-candidatures-spontanees/export.sql`) : 62 retraits avant, 62 après, aucun perdu ni nouveau |
| `a-blanc.json` | sortie de `apps/aggregator/scripts/ops/mesures/d512-viviers-a-blanc.mts` : la règle de la collecte appliquée à chaque publication, retirés et conservés avec leur motif, leur source et ce qui reste de l'intitulé hors libellé |

Rejouer (depuis la racine du dépôt ; `CATWALKS_DB_ACCESS` si les accès ne sont pas sous `backups/` de ce dossier) :

```sh
python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F "|" -v ON_ERROR_STOP=1 -f audits/2026-10-02/d512-viviers/decouverte.sql'
python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -At -v ON_ERROR_STOP=1 -f audits/2026-10-02/d512-viviers/export.sql' > viviers.jsonl
npx tsx apps/aggregator/scripts/ops/mesures/d512-viviers-a-blanc.mts viviers.jsonl > a-blanc.json
```

## La règle mesurée

`apps/aggregator/src/pipeline/spontaneousApplication.ts`. Un intitulé porte un libellé de vivier : les cinq de la
décision (« Talent Pool », « Future Opportunities », « Expression of Interest », « Register your interest », « Vivier »)
et les variantes que la découverte a trouvées en production (« Talent Community / Network », « Talentpool »,
« Expressions of Interest », « Express Interest », « Opportunités futures », « Bolsa de Talentos »). Jamais « Roger
Vivier » (ni « Roger-Vivier »), jamais suivi d'un mot de fonction (« Talent Pool Coordinator »).

L'offre est retirée seulement si le reste de l'intitulé, hors libellé, ne nomme que :
- le lieu, la ville, le pays ou la Maison de l'offre elle-même (ses champs `location`, `city`, `country`, `company`) ;
- un nom de pays ou de langue (noms ISO de la plateforme, `Intl.DisplayNames`, en cinq langues) ;
- des nombres ou des mots vides d'une liste courte et fermée (« Join our », « Apply here to », « APAC », « EMEA »,
  « UK », « Greater … Area »…).

Tout autre mot, connu ou inconnu de tout vocabulaire (un poste, une famille, une équipe, un contrat, un public), garde
l'offre publiée. « Sans poste » est une déduction, pas une preuve native : elle est prudente par construction, un
vocabulaire inconnu ne retire jamais. Le catalogue des métiers n'est donc pas lu : il ne ferait que garder des offres
que tout mot inconnu garde déjà.

L'intitulé lu est celui que l'adaptateur rend (`rawTitle`), tronqué puis nettoyé comme à l'écriture (`cleanTitle`) :
Beiersdorf rend « D&#233;l&#233;gu&#233; Pharmaceutique ». Le même nettoyage vaut pour D-511. Aucune divergence entre
l'intitulé brut, celui de la source et celui publié.

## Résultat

**21 offres publiques seraient retirées** (21 publications, aucune portée par une autre source, toutes sur des sources
ACTIVE), sur 5 sources. 119 publications de viviers (116 offres) restent publiées.

| Motif | Retirées | Conservées (publications) |
|---|---:|---:|
| Future Opportunities | 16 | 49 |
| Talent Pool / Community / Network | 3 | 29 |
| Expression(s) of Interest / Express Interest | 2 | 31 |
| Vivier | 0 | 6 |
| Register your interest | 0 | 2 |
| Bolsa de Talentos | 0 | 2 |
| **Total** | **21** | **119** |

Retirées par source : Mejuri 16 (« Future Opportunities - (Boston) »… ; ses 2 « Store Manager » restent), Kering 2
(Brioni APAC, EMEA), HUGO BOSS 1 (« IZMIR TALENT NETWORK »), Nutrafol 1, PVH 1 (inscriptions « Talent Community »).
Aucune Maison n'est vidée : chacune garde au moins 7 autres offres (`maisons.sql`). Le retrait a lieu à la prochaine
collecte admise de chaque source (RUN de 18 h). Il n'est pas défait automatiquement : une offre retirée `OUT_OF_SCOPE`
n'est jamais republiée par une collecte, même si la source renomme ensuite son intitulé vers un poste.

Le rejeu du passage à blanc de D-511 avec cette règle (nettoyage compris) rend les mêmes 62 retraits (`rejeu-d511.json`).

## Garde de masse

La retenue partagée (`NATIVE_SPONTANEOUS_APPLICATION`) entre dans `MASS_GUARDED_RETENTIONS` : au-delà de max(20, 25 %)
des fiches collectées d'une source, la source bloque le RUN. Calibrage (`garde-de-masse.sql`) : Mejuri, le plus lourd,
retient 16 viviers sur 188 fiches (sous le plancher absolu de 20) ; lerros 1 sur 1 ; aucune source de D-511 plus de 4.
Le seuil vaut à chaque RUN : les viviers restent listés et retenus à chaque collecte. La garde alerte, elle n'empêche
pas le retrait.

## Relecture

Les 21 retirés (la liste entière : moins que les 30 demandés) et les 119 conservés ont été relus un par un.

- **Retirés : aucune erreur.** Chacun ne nomme que son lieu (ville, zone, centre commercial que l'offre porte dans son
  champ lieu), sa Maison et une zone (« APAC », « EMEA ») ou une invitation (« Join the PVH Talent Community »).
- **Conservés : aucun ne retire un poste.** Cinq viviers sans poste restent publiés, parce qu'un mot n'y est expliqué
  par rien : « Student » (Tricoci), « UAE National » (Ounass), « Ru'ya … (Emiratisation) » (Chalhoub), « #Squadonamission »
  (Breitling), « キャリア登録 » (Arc'teryx). L'erreur va dans le sens prudent.
- Brown Thomas (7 équipes), Sephora et LVMH « Management » (5), MECCA « Store Management », Honey Birdette « Design »
  restent publiés : ils nomment une famille ou une fonction (lecture D-492 sous D-512).

## Hors de la règle, nommément

- « Join Our Team, Dana Park Village Square » (1) : un vivier sans poste que la décision ne nomme pas ; reste publié.
- « Evergreen » (9 : « Evergreen - Senior Client Advisor - Dallas »…) : recrutement permanent qui nomme toujours un
  poste ; reste publié.
