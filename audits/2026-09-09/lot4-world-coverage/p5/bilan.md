# P5 — la chaîne publique de bout en bout

Mesures du 2026-09-11, **production en lecture seule** : la base par `db.py readonly`, le site par des requêtes
**GET** sur `https://modecareers.com`. Aucune écriture, crons gelés, catalogue inchangé.

Scripts : `apps/aggregator/scripts/coverage/public-chain.mts` (ensembles d'identifiants, compteurs, facettes) et
`public-pages.mts` (fiches, rendu, JSON-LD). Sorties : `public-chain.json`, `public-pages.json`.

## 1. Avant

Ce qui était établi au début du lot, et qu'il fallait vérifier plutôt que supposer :

- une seule fonction de sélection publique (`searchSummary`) construit résultats, total et facettes depuis deux
  CTE matérialisées (`base` → `scoped`) — donc en principe **une seule règle** ;
- `whereClause` existe aussi, exporté, mais **n'est appelé par aucun code applicatif** : seuls les tests
  l'utilisent. Deux définitions de la sélection coexistent dans le dépôt, et il fallait s'assurer que celle qui
  sert vraiment est bien la première ;
- `jobPostingSchema` refuse de produire un balisage sans `postedAt` réel, et `safeJsonLd` échappe les valeurs
  externes — mais **aucun test ne couvrait `safeJsonLd`** : la protection n'existait que comme commentaire ;
- 41 548 offres actives (52,6 %) n'ont **aucun code métier** : l'item 5 porte donc sur la majorité du catalogue ;
- `landingStats` est mémorisé 600 s ; le reste de l'API ne l'est pas.

## 2. Causes établies

**Aucun écart de sélection n'a été trouvé.** Les quatre « écarts » de la première exécution venaient tous de mon
propre dispositif de contrôle, et je les nomme parce que chacun aurait pu être présenté comme un défaut du
produit :

| Faux écart initial | Cause réelle | Correction |
|---|---|---|
| `secteur invalide` : base 78 932 vs API 0 | ma spécification attendait qu'un code inconnu soit ignoré. Le code fait mieux : `sectorSql` construit `sectorCodes @> ARRAY['NOT_A_SECTOR']` → **0**. Un filtre qui ne correspond à rien montre rien, jamais tout. | attente corrigée en `false` |
| 4 parcours « champ absent / télétravail / multilocalisation » : base ≠ API | ces cas **n'ont pas de filtre public** (`?sansVille=1` n'existe pas). Les confronter à l'API non filtrée comparait deux questions différentes. | sortis des parcours, traités comme **populations** avec leurs propres contrôles |
| « script injecté » sur **24 fiches sur 24** | mon détecteur cherchait `<script>` dans **toute la page** : ce sont les bundles de Next.js. | détection restreinte au **contenu externe rendu** (description + blocs JSON-LD) |
| « aucune fiche ne porte de balisage », HTTP 308 partout | `redirect: 'manual'` s'arrêtait sur la redirection canonique `/offre/<id>` → `/offre/<slug>-<id>`, donc j'inspectais une page vide. Le 308 est le comportement SEO **voulu**. | la redirection est suivie, et le saut est journalisé |

Deux causes réelles, en revanche, dans le dépôt :

1. **`safeJsonLd` n'était pas testé**, et le corpus de production ne contient **aucune** description hostile
   (0 `<script`, 0 `<iframe`, 0 `javascript:`, 0 `on…=` sur 78 932 offres) — un contrôle en production ne pouvait
   donc rien prouver : il aurait passé même si l'échappement avait été retiré.
2. **`safeJsonLd` vivait dans le fichier de route.** L'exporter pour le tester **casse la compilation Next.js**
   (`OmitWithTag … does not satisfy the constraint` : une page ne peut exporter que ses entrées réservées).

## 3. Modifications

| Fichier | Changement |
|---|---|
| `apps/web/lib/safe-json-ld.ts` **(nouveau)** | `safeJsonLd` extrait du fichier de route vers `lib/`, testable sans casser la compilation des pages |
| `apps/web/app/offre/[id]/page.tsx` | importe la fonction au lieu de la porter |
| `apps/web/lib/__tests__/safe-json-ld.test.ts` **(nouveau)** | 4 tests sur charge hostile réelle |
| `apps/aggregator/scripts/coverage/public-chain.mts` **(nouveau)** | 25 parcours comparés **par ensembles d'identifiants** ; bouclage des facettes ; doublons |
| `apps/aggregator/scripts/coverage/public-pages.mts` **(nouveau)** | 8 états de fiche × 3 : HTTP, JSON-LD, rendu sûr, dates non inventées |

**Aucune modification du chemin de sélection**, des filtres, des compteurs ou du balisage : ils étaient corrects.

## 4. Tests ajoutés

| Test | Ce qu'il verrouille |
|---|---|
| `safe-json-ld.test.ts` (4) | qu'une description contenant `</script><script>alert(1)</script>` **ne peut pas sortir** de son bloc : plus aucun `<` littéral, `<` présent, et la donnée reste intègre après relecture ; que U+2028/U+2029 sont échappés ; qu'un contenu ordinaire n'est pas mutilé |

**À signaler** : `apps/web/lib/jobs-database.test.ts` (14 tests) — dont l'assertion centrale est exactement la
propriété de P5, `getJobs().total === count(whereClause)` — est **sauté par défaut** (il exige un
`DATABASE_URL` local contenant « test »). Exécuté explicitement contre la base de test : **14/14 verts**. Ce
n'est pas le cas D56 (un test conditionné à un environnement que personne n'a) : sa garde est satisfiable, mais
elle est silencieuse, et il faut le savoir.

## 5. Après — résultats mesurés

### Ensembles d'identifiants, 25 parcours : **aucun écart**

Comparaison des **200 premiers identifiants de chaque côté, dans le même ordre** (`postedAt DESC NULLS LAST,
firstSeenAt DESC, id`), plus le total complet. `base-seul` et `api-seul` = 0 partout.

| Dimension | Parcours | Résultat |
|---|---|---|
| **Monde** | aucun filtre | 78 932 = 78 932 · ids identiques |
| **France** | `pays=FR` (via `isFrance`) | 10 831 · compteur OK · **facette OK** |
| **Pays** | IT 2 622 · US 34 509 · GB 3 093 | compteurs OK · facettes OK |
| **Maisons** | Ulta Beauty 10 290 · Sephora 2 474 · Foot Locker 1 933 | compteurs OK · facettes OK |
| **Métiers** | sales-advisor 18 235 · beauty-consultant 5 188 | compteurs OK · facettes OK |
| **Métier non canonisé** | `unclassified` **41 548** | compteur OK · **facette OK** |
| **Contrats** | PERMANENT 17 240 · FIXED_TERM 8 013 | compteurs OK · facettes OK |
| **Rythme** | PART_TIME 29 552 | compteur OK · facette OK |
| **Secteurs** | RETAIL 22 675 · BEAUTY 21 110 | compteurs OK · facettes OK |
| **Villes** | Paris 3 619 · New York 1 919 | compteurs OK |
| **Combinaisons** | France+PERMANENT 5 315 · secteur+maison+pays 0 · non-canonisé+France 5 520 | compteurs OK — **aucun télescopage de filtres** |
| **Frontières** | pays `ZZ` 0 · secteur invalide 0 · métier inexistant 0 · maison inexistante 0 | **un filtre vide rend 0, jamais tout** |

### Résultats, compteurs et facettes partagent la même règle — vérifié arithmétiquement

| Facette | Somme des valeurs | Offres sans valeur | Total actif | Boucle ? |
|---|---:|---:|---:|---|
| `contracts` | 25 345 | 53 587 | 78 932 | **oui (25 345 + 53 587 = 78 932)** |
| `occupations` | 78 932 | 0 | 78 932 | **oui** — `unclassified` **est** une valeur de la facette |
| `cities` | 21 134 | 3 813 | 78 932 | **non, et c'est normal** : facette plafonnée à 60 valeurs |

C'est la preuve que la facette et le résultat lisent le même ensemble : si une partie des offres était rangée
dans une valeur qu'elle ne porte pas, la somme dépasserait le total ; s'il en manquait, elle serait courte.

### Item 5 — le métier non canonisé, explicitement traité

Les **41 548 offres sans code métier** (52,6 % du catalogue actif) sont :

- **accessibles** par la recherche générale et par le filtre `metier=unclassified` (41 548 rendues, ids
  identiques à la base) ;
- **libellées** « Métier à préciser » plutôt que rangées dans un métier réel ;
- **jamais versées** dans une autre facette : la somme de la facette métiers boucle exactement sur le total, donc
  aucune de ces offres n'est attribuée ailleurs ;
- combinables : `unclassified` + `pays=FR` → 5 520, compteur et ids exacts.

### Multilocalisation, télétravail, champs absents

| Population | Offres | Contrôle et résultat |
|---|---:|---|
| Plusieurs sources actives | 1 889 | **0 doublon** dans les 200 identifiants rendus : une offre canonique, N représentations |
| `workplaceType = REMOTE` | 362 | population mesurée ; **aucun filtre public dédié à ce jour** (déclaré, non présenté comme un défaut) |
| Sans ville | 3 813 | absentes de toute valeur de la facette villes |
| Sans contrat | 53 587 | absentes de la facette contrats, et la somme boucle |

### Pagination et caches

| Contrôle | Résultat |
|---|---|
| `page=1` … `page=3157` | 25 offres chacune |
| `page=3158` (dernière) | **7 offres** — et 3 157 × 25 + 7 = **78 932**, exactement le total |
| `page=10000`, `page=10001` | 0 offre, `page` ramené à 10 000 (`MAX_PAGE`) : **borné, jamais d'erreur** |
| Cache de `/api/jobs` | `cf-cache-status: DYNAMIC` — **non mis en cache**, un compteur ne peut pas être servi périmé |
| Cache de la page d'accueil | `landingStats` mémorisé 600 s ; affiche **78 932**, identique à l'API et à la base |
| `robots.txt` | `Allow: /`, `Disallow: /api/`, sitemap déclaré · `sitemap.xml` → 200 |

### Item 6 — les fiches, 8 états × 3 identifiants nommés : **24/24 conformes**

| État | Attendu | Obtenu |
|---|---|---|
| active **avec** date | 200 + JobPosting | 3/3 |
| active **sans** date | 200 + **aucun** JobPosting | 3/3 |
| active sans description | 200 | 3/3 |
| **fermée** (`closedAt`) | **410** + aucun JobPosting | 3/3 |
| **retirée** (`withdrawnAt`) | **410** + aucun JobPosting | 3/3 |
| fusionnée / redirigée | mène à l'offre survivante | 3/3 |
| multi-sources | une seule fiche | 3/3 |
| description portant du HTML | rendu inerte | 3/3 |

Un identifiant nu redirige en **308** vers l'URL canonique portant le slug, puis rend 200 — comportement SEO
voulu. Les liens de candidature pointent vers l'employeur (`directApply: false`, D18).

### Item 7 — rendu sûr

- **0 contenu dangereux** dans le contenu externe rendu des 24 fiches (script actif, iframe, `javascript:`,
  gestionnaire en ligne, object/embed, formulaire injecté) ;
- **0 bloc JSON-LD non échappé** : aucune séquence `</script` à l'intérieur d'un bloc ;
- **0 bloc JSON-LD illisible** ;
- et surtout : le corpus ne contenant **aucune** charge hostile, la preuve vient des **4 tests** sur charge
  hostile réelle, pas de l'absence d'incident en production. *Un détecteur qui ne peut pas mordre ne prouve rien.*

### Item 8 — Google Jobs, trois notions tenues séparées

| Notion | Chiffre | Ce qu'il signifie |
|---|---:|---|
| **Visible sur Mode Careers** | **78 932** | la fiche est servie |
| **Éligible au balisage JobPosting** | **77 482** | une vraie `postedAt` existe |
| **Visible mais NON éligible** | **1 450** | aucune date réelle → page servie, **aucun balisage**, aucune date inventée |
| Avec une échéance réellement fournie | 5 700 | `validThrough` vient de la source |
| **Présence réelle dans Google Jobs** | **non mesurée** | ne peut pas l'être depuis ces scripts, et n'est pas déduite du balisage |

Champs requis vérifiés sur chaque fiche balisée : `title`, `description`, `datePosted`, `hiringOrganization`,
`jobLocation`, `identifier`, `employmentType`, `directApply: false`. **Cohérence JSON-LD / page visible** : le
titre annoncé dans le balisage est retrouvé dans le HTML rendu. **Aucune date inventée** : `dateInvented` et
`expiryInvented` sont faux sur les 24 fiches — le balisage ne porte jamais une date absente de la base.

## 6. Restant — écarts ouverts, avec cause et traitement

| Écart | Mesure | Cause | Traitement |
|---|---:|---|---|
| **257 offres actives dont le `validThrough` est dépassé** | 25 sources, la plus ancienne échéance au **2026-09-06** | Ce sont des dates **réelles** des sources, et le gel des crons (2026-09-09) empêche tout run de rafraîchir l'horizon ou de fermer l'offre. Google lit un `validThrough` passé comme une offre close. | **Ouvert, cause identifiée.** Se résorbe au premier run d'ingestion : la règle existante (D37) rafraîchit l'horizon tant que l'ATS liste l'offre. Rien à corriger dans le code ; ne pas inventer de date pour masquer. Principales : `nike-nke2` 115, `tapestry` 10, `levis` 9 |
| **`whereClause` mort dans `apps/web/lib/jobs.ts`** | 1 fonction exportée, 0 appel applicatif | Deuxième définition de la sélection, conservée pour les tests | **Ouvert, sans conséquence mesurée** : les 25 parcours prouvent que la sélection servie est celle de `searchSummary`. À supprimer ou à documenter comme oracle de test (D5 : zéro legacy) — hors périmètre P5 |
| **`jobs-database.test.ts` sauté par défaut** | 14 tests | garde sur un `DATABASE_URL` local « test » | **Traité** : exécuté explicitement, 14/14 verts. Garde satisfiable, mais silencieuse |
| **Aucun filtre public pour le télétravail** | 362 offres `REMOTE` | dimension livrée en D55 sans facette (volume jugé insuffisant) | **Ouvert, décision produit** : exposer ou non `workplaceType` dans la barre |
| **41 548 offres sans métier canonique** | 52,6 % | couverture de la taxonomie | **Traité pour P5** : accessibles, libellées, jamais mal attribuées. L'amélioration de la couverture est un autre sujet |

## Tableau final

| Parcours | Base | API | Compteur | Facette | Résultat | Fiche | JSON-LD | Écart | Cause | Statut |
|---|---:|---:|---|---|---|---|---|---|---|---|
| Monde | 78 932 | 78 932 | OK | — | ids identiques | 200 | émis si date | **aucun** | — | **conforme** |
| France (`isFrance`) | 10 831 | 10 831 | OK | OK | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| Italie | 2 622 | 2 622 | OK | OK | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| États-Unis | 34 509 | 34 509 | OK | OK | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| Royaume-Uni | 3 093 | 3 093 | OK | OK | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| Maison Ulta Beauty | 10 290 | 10 290 | OK | OK | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| Maison Sephora | 2 474 | 2 474 | OK | OK | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| Maison Foot Locker | 1 933 | 1 933 | OK | OK | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| Métier sales-advisor | 18 235 | 18 235 | OK | OK | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| Métier beauty-consultant | 5 188 | 5 188 | OK | OK | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| **Métier non canonisé** | 41 548 | 41 548 | OK | OK | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| Contrat PERMANENT | 17 240 | 17 240 | OK | OK | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| Contrat FIXED_TERM | 8 013 | 8 013 | OK | OK | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| Rythme PART_TIME | 29 552 | 29 552 | OK | OK | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| Secteur RETAIL | 22 675 | 22 675 | OK | OK | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| Secteur BEAUTY | 21 110 | 21 110 | OK | OK | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| Ville Paris | 3 619 | 3 619 | OK | — | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| Ville New York | 1 919 | 1 919 | OK | — | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| France + PERMANENT | 5 315 | 5 315 | OK | — | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| Secteur + Maison + Pays | 0 | 0 | OK | — | ids identiques | — | — | **aucun** | — | **conforme** |
| Non canonisé + France | 5 520 | 5 520 | OK | — | ids identiques | 200 | idem | **aucun** | — | **conforme** |
| Frontière pays `ZZ` | 0 | 0 | OK | — | vide | — | — | **aucun** | — | **conforme** |
| Frontière secteur invalide | 0 | 0 | OK | — | vide | — | — | **aucun** | attente de contrôle erronée (la mienne) | **conforme** |
| Frontière métier inexistant | 0 | 0 | OK | — | vide | — | — | **aucun** | — | **conforme** |
| Frontière maison inexistante | 0 | 0 | OK | — | vide | — | — | **aucun** | — | **conforme** |
| Pagination (dernière page) | 78 932 | 3 157×25+7 | OK | — | exact | — | — | **aucun** | — | **conforme** |
| Fiche fermée | — | — | — | — | — | **410** | **aucun** | **aucun** | — | **conforme** |
| Fiche retirée | — | — | — | — | — | **410** | **aucun** | **aucun** | — | **conforme** |
| Fiche fusionnée | — | — | — | — | — | 308 → survivante | selon date | **aucun** | — | **conforme** |
| Active sans date | 1 450 | — | — | — | visible | 200 | **aucun** | **aucun** | pas de date réelle, aucune inventée | **conforme, voulu** |
| Multilocalisation | 1 889 | — | — | — | 0 doublon | 200 | selon date | **aucun** | — | **conforme** |
| Télétravail REMOTE | 362 | — | — | **absente** | — | 200 | selon date | facette absente | dimension livrée sans facette (D55) | **ouvert, décision produit** |
| `validThrough` dépassé | 257 | — | — | — | encore visibles | 200 | `validThrough` passé émis | **oui** | dates réelles + crons gelés | **ouvert, cause identifiée** |
| Rendu des descriptions | 317 avec balises | — | — | — | inerte | 200 | échappé | **aucun** | — | **conforme, testé** |

## GO / NO-GO pour P6

**GO.**

- **25 parcours comparés par ensembles d'identifiants**, pas par totaux : `base-seul = 0` et `api-seul = 0`
  partout. Les sept dimensions exigées (monde, France, pays, Maisons, métiers, contrats, secteurs) sont couvertes,
  plus les villes, trois combinaisons et quatre frontières ;
- **résultats, compteurs et facettes prouvés sur la même règle** par bouclage arithmétique, pas par lecture de
  code ;
- **24/24 fiches conformes** sur huit états, dont fermée et retirée en **410 sans balisage** ;
- **les trois notions restent séparées** : visible 78 932, éligible au balisage 77 482, présence dans Google
  **non mesurée et non déduite** ;
- **aucune date inventée** nulle part ; les 1 450 offres sans date sont visibles **sans** balisage, par choix ;
- chaque écart restant a une cause et un traitement ; **aucun échantillon n'est présenté comme exhaustif** — les
  bornes (200 identifiants par parcours, 3 fiches par état) sont écrites dans les sorties.

**Réserves à porter en P6**, sans blocage :

1. les **257 `validThrough` dépassés** se résorberont au premier run d'ingestion ; jusque-là, ces offres
   présentent à Google une échéance passée — conséquence du gel, pas du code ;
2. **`whereClause` est du code mort** dans le chemin public (D5 : zéro legacy) ;
3. le **télétravail** n'a pas de filtre public : décision produit.

Et le prérequis P7 est enregistré : `audits/2026-09-09/lot4-world-coverage/p7-prerequisite.md` — **jamais de
`refresh` seul sur les anciens états persistés**, une ingestion doit d'abord recalculer les preuves d'énumération
et les droits `canAttestAbsence`.
