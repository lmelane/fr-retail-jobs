# LOT P2 — le périmètre initial, dossier par dossier (2026-09-10, 21:37–21:40 UTC)

> **STATUT : réparations instruites EXÉCUTÉES et vérifiées en production le 2026-09-10 à 22:11–22:14 UTC.**
> Talentsoft **102**, UNIQLO **2**, Ulta **1** — sous protocole complet : sauvegarde fraîche (494 Mo, sha256 `e0737aa4…6660`) → restauration sur clone (la restauration EST la preuve) → répétition sur clone neuf → application ciblée en production → contrôles avant/après → **rejeu à 0**.
> **Résultat vérifié** : 0 `location` pollué (101 avant), 0 offre UNIQLO non datée **et 0 sans description** (2 et 2 avant), parité Ulta **10 290 = 10 290**, offres actives **79 516 inchangées**, **740 retenues réelles inchangées** (état par identifiant et motif, pas un compteur d'événements), **aucune date inventée** (chaque `postedAt` écrit égale exactement son `raw_date`). Publication vérifiée : **441/441**, plus aucun écart.
> Traçabilité complète — script appliqué, empreinte, identifiants, avant/après : **`p2-repairs-proof/`**.
> **Restent ouverts dans P2** : doublons sur identifiant instable (cause à instruire), FashionJobs 172 détachables, et les dossiers bloqués par une décision ou un jeton.

Toutes les mesures ci-dessous sont prises en **REPEATABLE READ**, niveau lu dans la transaction et asserté. Crons gelés, catalogue non étendu.

Chaque dossier porte : **résultat · preuve · traitement appliqué ou explicitement retenu · état exact · prochaine action**. « Non réparé » n'y signifie jamais « résolu ».

---

## 1. Contradictions d'identité documentées

**Résultat : aucune contradiction ouverte.** `SourceIdentityReview` ne contient **0 ligne** de verdict `CONTRADICTED` ou `UNRESOLVED`.

En revanche, **20 libellés font encore l'objet d'un refus d'identité sur des offres actives** (`EmployerObservation.rule = REVIEW_REQUIRED`), dominés par Tapestry (« Coach » 1 253, « Kate Spade » 482), Nordstrom (104), Normal (98 + 61), Tricoci (55).

**Nuance mesurée, à ne pas confondre** : ces libellés sont refusés *par la porte d'identité* tout en étant **publiés** sous leur bonne Maison — Coach et Kate Spade sont bien crédités (revue alias v6, passe B6). Le refus porte sur le libellé natif rencontré à la validation, pas sur l'attribution finale. Ce sont donc des **observations à solder**, pas des offres mal attribuées.

**Traitement retenu** : aucun changement de données. Ces libellés relèvent de la revue d'alias, mécanisme existant (`b6-aliases.mts`). **Prochaine action** : les inclure dans la certification des 30 portails de groupe (famille G), où ils seront couverts par lot.

## 2. Talentsoft — corrigé à la cause, réparation des données à faire

**Résultat mesuré, qui corrige mon propre constat de fin de passe B6** (« ~350 offres, 6 sources, villes cassées » — faux sur les trois points) :

| Mesure réelle | Valeur |
|---|---:|
| Offres dont `location` est pollué par le contrat | **102** |
| Sources concernées | **5** (lagardere-travel-retail 41, groupe-printemps 22, balmain 20, lagardere-travel-retail-de 10, lagardere-duty-free 9) |
| Villes canoniques réellement fausses | **2** (« Cdi », « Apprentissage ») sur 73 villes distinctes |

**La ville était donc déjà bonne** (Nice, Paris, Francfort) : le canonicaliseur de villes faisait son travail. Seul `location`, champ d'affichage, restait pollué.

**Cause prouvée sur le RAW de production** : le chemin RSS supposait « première catégorie = contrat ». Le vrai flux Lagardère publie `["Commerce / Vente / Relations Clients", "Stage", "Malakoff"]` — la première est le **métier**. Le contrat glissait donc dans le lieu.

**Correctif appliqué** (`talentsoft.ts`) : chaque catégorie est triée par **ce qu'elle est**, la règle que le chemin HTML suivait déjà ; ce chemin reçoit la même garde. **Tests** : cartes réelles FR et DE, gabarit Longchamp (où le contrat est bien premier), et une ville dont les lettres ressemblent à un contrat (« Stagira »). 17 tests verts.

**État exact : RÉPARÉ ET VÉRIFIÉ** (2026-09-10 22:11 UTC). 102 offres traitées sous protocole complet, rejeu à 0, **0 `location` pollué** en production (101 avant). Cas limite trouvé par la répétition sur clone : `location = "Stage"` sans virgule n'a aucun lieu à extraire → la valeur est **vidée** (effacer une valeur fausse est légitime, en inventer une ne l'est pas).

## 3. Ulta — l'unique écart base/API

**Résultat** : deux sociétés actives distinctes nourries par la **même** source `ulta-jibe` :

| Société | Clé canonique | Offres actives |
|---|---|---:|
| Ulta Beauty | `ULTA_BEAUTY` | 10 289 |
| Ulta Beauty, Inc. | `ULTA_BEAUTY_INC` | **1** |

**Cause** : « Ulta Beauty, Inc. » est la forme **juridique** de la même Maison. D37 a gravé que les suffixes juridiques sortent de l'identité de Maison (« Ulta Beauty, Inc. », « Coach Stores Canada Corporation » → Coach) ; cette ligne a échappé au traitement.

**Traitement retenu** : **fusion d'identité** vers `ULTA_BEAUTY`, mécanisme existant (comme les 209 fusions de D45 : id, URL et `firstSeenAt` conservés, seul le préfixe de clé de cluster change). Ce n'est pas une suppression : l'offre est conservée, elle change de rattachement.

**État exact : RÉPARÉ ET VÉRIFIÉ** (2026-09-10 22:11 UTC). Fusion appliquée par le mécanisme de **revue d'identité** (`buildEmployerRepair`/`applyEmployerRepair`), avec preuve officielle archivée (page `ulta.com` portant « © Ulta Beauty, Inc. », sha256 `1a06e23a…a903`). Rejeu `alreadyApplied: true`, 0 changement.
**Parité rétablie et mesurée : base 10 290 = API 10 290.** Le tableau final passe à **441/441 sans aucun écart**.

> **La répétition sur clone a prouvé son utilité ici.** Ma première version écrivait `mergedIntoId` directement : la base l'a **refusée** (`Company_identity_relationship_review`), car une fusion exige un `identityReviewId` — une décision revue et tracée. La garde a fonctionné exactement comme prévu, et le correctif a été de passer par le mécanisme de revue, pas de contourner la contrainte.

## 4. isFrance / countryCode — cohérence vérifiée, dossier clos

**Résultat : 0 incohérence, dans les deux sens.**

| Contrôle | Valeur |
|---|---:|
| `isFrance = true` mais `countryCode ≠ 'FR'` | **0** |
| `countryCode = 'FR'` mais `isFrance = false` | **0** |
| Offres marquées France | 11 413 |
| Offres `countryCode = 'FR'` | 11 413 |
| Offres sans pays (tous pays) | 4 885 |

**Traitement** : **aucun** — il n'y a rien à corriger. Les règles d'écriture posées par D38 (« un lieu reconnu français sans pays → FR ») tiennent. Dossier **clos**.

Reste distinct et non traité ici : **4 885 offres sans `countryCode`** (6,1 %), qui n'est pas une incohérence mais une absence. Rattaché au chantier de complétude, pas à celui-ci.

## 5. Doublons et redirections

**Résultat : 44 URLs portent plusieurs offres canoniques actives, soit 47 offres en excès** — visibles par le candidat (même page, plusieurs cartes).

| Cause (agrégat complet, sans LIMIT) | URLs | Offres | Excès |
|---|---:|---:|---:|
| **Même source, plusieurs `externalId` sur la MÊME url** — identifiant instable, défaut chez nous | **19** | 41 | **22** |
| Plusieurs sources attestant la même page — attestation multi-sources, normale | **25** | 50 | 25 |
| **Total** | **44** | **91** | **47** |

Sources réellement porteuses de l'identifiant instable, par URL : `psycho-bunny` 12 · `alberto` 3 · `hermes` 2 · `kastner-ohler` 1 · `fashionjobs` 1.

> **Deux erreurs de ma première passe, corrigées par cette réconciliation.** (a) Je citais « ~25 offres » depuis un listing tronqué par `LIMIT 15` : un extrait n'est pas un total, le chiffre exact est **22**. (b) J'accusais `lvmh` et `tiffany-oracle` d'identifiants instables : la mesure discriminante (même source, plusieurs `externalId` pour une même URL) les innocente — elles sont `instable=false`, leurs doublons viennent d'une attestation multi-sources. **Une URL dupliquée ne prouve pas un identifiant instable.**

**Traitement retenu, différencié — et les 44 groupes restent TOUS dans le périmètre d'investigation** :
- Les **25 groupes multi-sources ne sont PAS classés « normaux »**. Ils contiennent **50 lignes `Job`**, c'est-à-dire des offres canoniques distinctes partageant une URL — pas simplement plusieurs attestations d'un même `Job`. Tant que l'identité des annonces n'est pas établie (même poste ? mêmes boutiques ? une page qui couvre plusieurs postes ?), **aucune fusion**. À instruire au même titre que les 19 autres.
- Les 19 groupes « même source, plusieurs `externalId` » **ne prouvent pas non plus une instabilité entre runs** : ils prouvent que la source a produit deux identifiants pour une même URL, ce qui peut venir d'un identifiant recalculé, mais aussi d'une page couvrant deux postes réels, ou d'une pagination qui sert deux fois la même offre. La cause reste à établir.

**État exact : les 44 groupes (91 lignes `Job`, 47 en excès) restent DANS le périmètre d'investigation, cause NON INSTRUITE, aucune fusion.** La réconciliation a séparé deux *formes* — même source avec plusieurs identifiants (19 groupes) et plusieurs sources sur une page (25 groupes) — mais une forme n'est pas une cause, et aucune des deux ne justifie une fusion sans avoir établi l'identité des annonces.
### `psycho-bunny` instruit (12 groupes) — une hypothèse réfutée, la cause pas encore close

Mesuré sur le RAW archivé des 12 groupes : **même URL, même titre, même ville, même structure JSON-LD**, mais **deux dates de première vue** (3 puis 9 septembre) et deux `externalId` distincts. La description diffère entre les deux lignes.

**Ce qui est établi** : l'adaptateur dérive `externalId = sha1(pageUrl)` (`genericJsonLd.ts` : « Stable, compact identity for the (source, externalId) unique key »). C'est **stable par construction** — deux identifiants pour une même URL sont donc impossibles par ce chemin. Vérifié : le premier id, `5e8d21cd821683e4`, **est exactement** `sha1('https://careers.psychobunny.com/job/3539/sales_associate')`.

**Donc mon hypothèse « identifiant instable recalculé sur un contenu qui bouge » est RÉFUTÉE.** Le second identifiant (`9b574617adbfece0`) vient d'une **URL différente** de celle finalement stockée. Six variantes plausibles ont été testées (paramètres UTM, `http`, casse, ancre, slash final, page de recherche) : **aucune ne produit ce hash**. Je n'ai pas identifié cette URL et je ne la devine pas.

**État exact : cause partiellement établie, dossier ouvert.** **Prochaine action** : retrouver l'URL source du second identifiant en relisant le sitemap archivé de la source (`jobs-sitemap.xml`) et les pages effectivement visitées lors du run du 9 septembre — hors ligne si les archives le permettent, sinon par une lecture bornée du sitemap. Aucune fusion avant d'avoir identifié cette URL : si elle désigne une **autre** annonce, les deux lignes sont légitimes. Puis appliquer la même lecture aux 25 groupes multi-sources. **Ce dossier reste dans P2.**

## 6. Les 52 offres WTTJ sous source PAUSED — qualifiées sans réactiver les crons

**Résultat** : 7 sources WTTJ (Hermès 39, a.p.c 4, Helena Rubinstein 3, Monsieur Tshirt 3, Sessùn 2, Clarins 1, Pied de Biche 1) portent **52 offres** dont la **seule attestation vivante** est une source PAUSED.

**Situation exacte, selon les preuves disponibles** : ces sources ont été mises en PAUSED le 2026-09-06 (D39) parce que `wttj-sector` les couvre. La note de catalogue dit : « PAUSED le temps que le refresh les ferme, puis retire-source ». Le refresh est **gelé depuis cette date**. Les 52 offres ne sont donc **ni ré-attestées ni fermées** : elles sont figées dans l'état où le gel les a laissées, et publiées.

**Ce que les preuves ne permettent PAS de dire** : qu'elles sont périmées. Aucune collecte ne les a re-listées depuis le 6 septembre ; leur absence du balayage sectoriel est **compatible** avec une fermeture chez l'employeur comme avec une lacune de couverture du balayage. Seul un run complet et fiable peut attester une absence (D51).

**Traitement retenu : aucune action, et surtout pas de réactivation des crons** — la réactivation est une décision distincte, et solder 52 offres ne la justifie pas. Les fermer à la main inventerait une fermeture non observée ; les supprimer perdrait des offres possiblement valides.

**État exact : dossier ouvert, sous contrôle, borné à 52 offres (0,065 % du catalogue).** **Prochaine action** : au premier ingest complet après reprise des crons, le refresh tranchera — soit `wttj-sector` les re-liste (elles vivent), soit non (elles se ferment normalement, avec la preuve d'un run complet). D'ici là, elles restent publiées avec leur provenance, ce qui est le comportement voulu par D51.

## 7. FashionJobs — découverte d'acteurs uniquement, traitement préparé

**La règle ne change pas** : FashionJobs sert à **découvrir des acteurs**, jamais de source d'offres.

**Résultat** (`reference/fashionjobs-postings.csv`, 757 lignes, par identifiant) :

| Catégorie | Offres | Traitement |
|---|---:|---|
| Aussi attestées par une source officielle **ACTIVE** | **172** | détacher la représentation FashionJobs : le candidat ne voit **aucun** changement, l'offre garde son attestation officielle |
| Dépendant de **FashionJobs seul** | **585** (186 sociétés, dont **583 en France**) | **retrait administratif** — décision de périmètre |

**Le point de méthode, vérifié dans le code et non seulement affirmé** : un retrait par `retire-source` est déjà, structurellement, un retrait administratif. `retireSource.ts` porte le commentaire *« Retirement withdraws attestations; it never proves employer closure »*, émet un événement `kind: 'WITHDRAWN'` (jamais `CLOSED`), et `deactivateSources.ts` compte `jobsWithdrawn` et `jobsClosed` **séparément**. RAW, identifiants et historique sont préservés (D27). **Aucune fermeture employeur ne sera enregistrée.**

**État exact** : les 585 offres sont **actuellement publiées** sur la foi d'une source qui ne doit pas fournir d'offres. C'est un écart à la règle, ouvert, chiffré et tracé par identifiant.

**Ce qui est bloquant** : retirer 583 offres françaises est une décision de périmètre produit (~5 % du catalogue France), pas un choix technique. Je ne la prends pas seul.

**Les 172 sont DÉTACHÉES** (production, 2026-09-10 22:44 UTC) — `p2-repairs-proof/p3-fj-prod.json` :

| Résultat de `deactivateSources` | Valeur |
|---|---:|
| Attestations détachées | **172** |
| `jobsClosed` | **0** |
| `jobsWithdrawn` | **0** |
| `jobsKept` | **172** |
| URLs canoniques réassignées | 15 |

Aucune fermeture employeur, aucun retrait d'offre : les 172 gardent leur source officielle et restent publiées. Vérifié après : attestations FashionJobs **757 → 585**, doublement attestées **172 → 0**, offres actives **79 516 inchangées**, **0 offre orpheline**, **0 fermeture**, **0 offre sans URL**, retenues réelles **740 inchangées**, parité **0 écart**. Rejeu : **0 offre à traiter**.

**Effet de bord mesuré et déclaré** : les URLs dupliquées passent de **44 à 45**. La réassignation d'URL canonique a fait pointer une URL WTTJ vers une autre offre Hermès du même lot — deux postes de titres différents (« Conseiller de Ventes », « Chargé(e) Service Après-Vente ») partagent désormais une URL. Ce groupe rejoint le dossier des doublons, il ne le clôt pas.

**Prochaine action** : appliquer aux 585 la décision du propriétaire.

---

## Retenues de publication — l'état, pas le compteur

Un `COUNT(*)` d'événements `job.publication_held` **ne peut que croître** : il serait resté identique même si toutes les offres retenues avaient été publiées. Il ne prouvait donc rien. La preuve est désormais l'**état courant** de chaque représentation retenue (`scripts/coverage/holds-state.mts`, `reference/holds-state.csv` par identifiant) :

| Motif | Retenues réelles | Source |
|---|---:|---|
| `WORKDAY_EMPLOYER_ABSENT_IN_DETAIL` | 695 | vf-corporation |
| `SCOPE_OUT_OF_PERIMETER` | 38 | aptar-beauty |
| `APPLICATION_EXPLICITLY_CLOSED` | 6 | blackstore |
| `WORKDAY_DETAIL_FETCH_FAILED` | 1 | knitwell-us-retail |
| **Total retenu aujourd'hui** | **740** | |

Conforme aux décisions gravées : les **695 VF** restent tenues et jamais créditées, Aptar 38 hors périmètre. **UNIQLO n'apparaît dans aucune retenue** — les réparations n'ont donc levé aucune retenue, et c'est vérifiable par identifiant, non déduit d'un total.

**Ce que la mesure d'état a révélé et que le compteur cachait** : **35 représentations sont publiées malgré une retenue passée** (Mango 27, Tapestry 5, Nordstrom 3), toutes `WORKDAY_EMPLOYER_ABSENT_IN_DETAIL` ou `WORKDAY_DETAIL_FETCH_FAILED`. Elles sont créditées à des Maisons cohérentes avec leur source, et 28 portent une observation d'identité — la retenue a donc été levée par un run ultérieur ayant trouvé l'employeur, ce qui est le comportement voulu. **Les 7 sans observation (Tapestry 5, Nordstrom 2) sont un point à instruire, pas une anomalie prouvée.**

## Ce qui reste ouvert — état exact, opération restante, blocage

**Exécuté et vérifié en production (2026-09-10 22:11–22:14 UTC)** : Talentsoft 102 · UNIQLO 2 · Ulta 1. Sauvegarde `e0737aa4…6660` restaurée sur clone (preuve), répétition sur clone neuf, application ciblée, contrôles avant/après, **rejeu à 0**. Offres actives **79 516 inchangées**, retenues **820 intactes**, parité **441/441**.

| Dossier | État exact | Volume | Opération restante | Blocage | Lot |
|---|---|---:|---|---|---|
| Doublons — identifiant instable | réconcilié (19 URLs / 22 offres, 5 sources), **cause non instruite** | 22 | instruire la dérivation d'`externalId` de `psycho-bunny` sur son RAW, puis corriger la cause, puis `reconcile` | aucun | **P2** |
| FashionJobs — 172 détachables | instruit, non exécuté | 172 | détachement via `deactivateSources` (`WITHDRAWN`), sans effet visible | aucun | **P2** |
| FashionJobs — 585 dépendantes | instruit | 585 (583 FR) | retrait administratif | **décision propriétaire** | **P2** |
| Ralph Lauren — vérification egress | sonde écrite, non exécutée | 1 103 | rejouer la sonde bornée depuis l'egress | **jeton Railway en lecture seule (HTTP 403)** | **P2** |
| Ralph Lauren — offre datée unique | caractérisée (seul `externalId` à 4 chiffres), inexpliquée | 1 | dépend de la vérification egress | idem | **P2** |
| Fenwick — 31/31 non datées | qualifié (gabarit, pas résidu) | 31 | observation ciblée du board Volcanic | aucun | **P2** |
| `element-6` — RAW vides | qualifié | 5 | rejeu ciblé de ces 5 identifiants | aucun | **P2** |
| 301 sans champ de date | qualifié | 301 | comparer un RAW daté et un non daté par source, hors ligne | aucun | **P2** |
| Refus d'identité sur libellés actifs | mesuré | 20 libellés | revue d'alias | aucun | **P2** |
| Retenues levées sans observation | mesuré | 7 (Tapestry 5, Nordstrom 2) | vérifier l'attribution de ces 7 représentations | aucun | **P2** |
| WTTJ sous PAUSED | qualifié, sous contrôle | 52 | trancher au premier run complet | **décision de reprise des crons** | **P2** |

**Aucun de ces dossiers n'est reclassé en P3.** Les blocages sont propres à leur dossier : le refus du jeton Railway n'empêche ni l'observation Fenwick, ni l'instruction des doublons, ni le détachement des 172 ; l'arbitrage FashionJobs n'empêche rien d'autre que les 585.
