# Lot F5g — Ba&sh : qualification des travaux du propriétaire sur les dates

Date : 2026-09-17. Source : `BASH_TALENTS`, portail maison `talents.ba-sh.com`.

La passation désignait ce chantier : « Ba&sh : travaux utilisateur sur dates et
expérience à qualifier, notamment repli sur date de listing en cas d'échec du
détail » (`PASSATION-CLAUDE-FABLE-2026-09-16.md`, §11.2). Les trois fichiers
étaient préservés à l'octet, non qualifiés. Ce lot les qualifie, corrige ce que
l'audit a trouvé, et rend le verdict daté demandé.

## Le défaut d'origine, mesuré

Le listing `/fr-FR/offres` sert `datePosted` = **la date du jour, sur les 50
offres à la fois** : un horodatage de rafraîchissement, pas une date de
publication. Les fiches `/fr-FR/offre/BASH_xxx` portent la vraie date.

Mesure contre la source le 2026-09-17 (`npm run verif:bash-live`) :

| | valeur |
|---|---|
| offres annoncées / lues | 50 / 50 |
| lieu, contrat, lien, description, date | 100 % |
| **dates distinctes** | **7** (une seule sans le correctif) |

## Ce que ça coûtait — pas un défaut d'affichage

R-83 / D-415 classe le matching candidat « du plus récent au plus ancien, au jour
calendaire parisien près », les préférences de R-82 ne départageant qu'à jour
égal. Une source dont les 50 offres portent le même jour **neutralise le critère
principal de son propre tier**. La date n'étant plus affichée en liste depuis
D-415, l'erreur pilotait l'ordre des offres sans être visible à l'écran.

Le seul écran qui la montre encore est la fiche, en relatif : une offre du 01/09
y annonçait « aujourd'hui ».

## Findings de l'audit défensif, et leur traitement

Trois lectures adverses (technique, métier/UX, réconciliation). Chaque finding a
été re-vérifié dans le code ou par exécution avant correction.

### 🔴 Commentaire invoquant un garde-fou inexistant — CORRIGÉ

Le commentaire justifiait le correctif par `cannotBeSameOpening` et
`MAX_DAYS_APART` (45 j) dans `dedup/match.ts`. **Ces deux identifiants n'existent
nulle part dans le dépôt** : seule occurrence, le commentaire lui-même.
`match.ts` documente l'inverse — « Titles, job families, cities, dates and
missing values never establish equivalence ». Vérifié : `postedAt` n'est pas lu
par le rapprochement. L'« effet de bord assumé » et le « risque de doublon »
décrits étaient donc entièrement fictifs. Paragraphe supprimé et remplacé par la
portée réelle, vérifiée.

### 🟠 `Date.UTC` reportait les dates impossibles — CORRIGÉ

Prouvé par exécution, pas par lecture :

| entrée | ancien résultat |
|---|---|
| `31/06/2026` | `2026-07-01` |
| `29/02/2026` (2026 non bissextile) | `2026-03-01` |
| `00/00/2026` | `2025-11-30` |

`plausiblePostedAt` ne rattrape pas ces valeurs : il n'écarte que `NaN` et le
futur lointain. Le lot corrigeait une date fausse pendant qu'une autre pouvait
entrer par ce chemin. `parseDayMonthYear` valide désormais par aller-retour.

### 🟠 Regex prenant la première occurrence du document — CORRIGÉ

`String.match` sans drapeau global rend la **première** occurrence. Mesuré sur
quatre fiches réelles le 2026-09-17 : une seule occurrence de `datePosted`
chacune, donc le risque n'est pas matérialisé aujourd'hui. Mais le portail sert
déjà des microdonnées `JobPosting` sur son listing : un bloc « offres
similaires » placerait une date étrangère devant, silencieusement. Regex ancrée
sur le libellé « Date de publication ». Contre-épreuve : la mesure live rend les
mêmes 7 dates distinctes après ancrage.

### 🟠 Le repli écrasait une vraie date par une fausse — CORRIGÉ

C'est le point que la passation demandait de qualifier. Le repli conservait la
date du listing, et `upsert.ts` pose `postedAt: candidate.postedAt ?? null`
**sans condition** : chaque échec de fiche réécrivait la vraie date déjà en base
par « aujourd'hui ». L'offre rajeunissait à chaque incident réseau.

Le référencement ne justifiait pas ce repli : le sitemap exige `postedAt IS NOT
NULL` **et** 100 caractères de description (`sitemap-emplois.ts`), or 49 de ces
50 offres n'ont aucune description au listing — elles en sont déjà exclues en run
dégradé, quelle que soit la date.

Décision retenue : **partir sans date**. La fiche n'affiche alors rien
(`dateRelative` rend une chaîne vide, vérifié), l'offre reste servie, cliquable
et candidatable — un incident réseau ne retire pas du catalogue un poste
réellement ouvert. Le classement la relègue au lieu de la faire remonter à tort.

### 🔵 Réconciliation

- **Cohérence transverse : conforme.** `detail.postedAt ?? job.postedAt` est la
  convention du dépôt — `avature.ts`, `taleo.ts`, `personio.ts`, `harri.ts`,
  `workday.ts` appliquent la même priorité détail-sur-listing. Le correctif
  aligne Ba&sh, il ne crée pas d'exception.
- **`verif:couverture`** était signalé comme pointant vers un fichier absent.
  Vérifié le 2026-09-17 : `verif-couverture-registre.mts` existe et est suivi. La
  référence n'est plus cassée ; rien à réparer.
- Aucune règle de `REGLES-PRODUIT.md` n'a été modifiée pour coller au code.

## Preuves d'exécution

- **Témoins : 10/10**, dont trois ajoutés par ce lot. Chacun **prouvé par
  réintroduction du défaut** : date du listing prioritaire → 1 rouge ; contrôle
  d'aller-retour retiré → 1 rouge ; regex désancrée → 1 rouge ; repli renvoyant
  l'offre nue → 1 rouge. À chaque fois les 9 autres restent verts, donc les
  témoins sont spécifiques.
- **Suite adaptateurs complète : 652 témoins sur 69 fichiers, verts.** Aucune
  régression.
- **Types : verts**, code de sortie vérifié.
- **Source réelle : conforme**, 50/50 et 7 dates distinctes après correctifs.

## Effet sur le stock — non traité ici

Le correctif agit à l'ingestion. Les représentations Ba&sh déjà en base gardent
leur date fausse jusqu'à leur prochaine attestation, qui dépend du CRON —
actuellement gelé (`PIPELINE_PAUSED=1` sur les trois workers, vérifié le
2026-09-17 après la bascule). Même nature que la collision `CA` de D-435 : un
correctif d'ingestion ne réécrit pas le stock.

## Verdict daté

**Ba&sh — QUALIFIÉE pour la date de publication et l'expérience, le 2026-09-17.**
Les travaux du propriétaire sont intégrés après correction de quatre défauts, le
repli dégradé compris. La qualification porte sur cette révision et cette mesure ;
elle ne préjuge pas d'une refonte du portail, que `npm run verif:bash-live`
détecterait.
