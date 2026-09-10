# LOT P2 — le périmètre initial, dossier par dossier (2026-09-10, 21:37–21:40 UTC)

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

**État exact** : cause corrigée et déployable ; **les 102 offres existantes ne sont pas encore réparées**. **Prochaine action** : réparation hors ligne depuis le RAW archivé (les catégories y sont), sous sauvegarde et répétition sur clone — aucune recollecte nécessaire.

## 3. Ulta — l'unique écart base/API

**Résultat** : deux sociétés actives distinctes nourries par la **même** source `ulta-jibe` :

| Société | Clé canonique | Offres actives |
|---|---|---:|
| Ulta Beauty | `ULTA_BEAUTY` | 10 289 |
| Ulta Beauty, Inc. | `ULTA_BEAUTY_INC` | **1** |

**Cause** : « Ulta Beauty, Inc. » est la forme **juridique** de la même Maison. D37 a gravé que les suffixes juridiques sortent de l'identité de Maison (« Ulta Beauty, Inc. », « Coach Stores Canada Corporation » → Coach) ; cette ligne a échappé au traitement.

**Traitement retenu** : **fusion d'identité** vers `ULTA_BEAUTY`, mécanisme existant (comme les 209 fusions de D45 : id, URL et `firstSeenAt` conservés, seul le préfixe de clé de cluster change). Ce n'est pas une suppression : l'offre est conservée, elle change de rattachement.

**État exact** : non réparé dans ce lot. **Prochaine action** : fusion sous protocole (dump frais → clone → production → rejeu 0), avec la vérification de parité avant/après. C'est la seule ligne de parité en écart des 441.

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

| Cause | URLs | Offres en excès | Nature |
|---|---:|---:|---|
| `psycho-bunny` | 12 | 12 | `externalId` en **hash instable** entre runs : la même offre entre deux fois |
| `hermes` / `wttj-sector` | 42 | 42 → en fait 1 par URL | même offre sous la source **PAUSED** et sous le balayage sectoriel |
| `alberto`, `kastner-ohler` | 4 | 5 | identifiant instable côté adaptateur |
| `fashionjobs` (Aroma-Zone) | 1 | 1 | **deux identifiants FashionJobs** pour la même offre |
| `lvmh`, `tiffany-oracle` | 8 | 8 | à instruire |

**Traitement retenu, différencié** :
- Les doublons `hermes` / `wttj-sector` **se résorbent par le dossier PAUSED** (§ 6) : c'est le même fait vu deux fois, pas un défaut d'adaptateur.
- Les doublons `fashionjobs` **se résorbent par le dossier FashionJobs** (§ 7).
- Restent **~25 offres** sur identifiant instable (`psycho-bunny`, `alberto`, `kastner-ohler`, `lvmh`, `tiffany-oracle`) : un `externalId` doit être **stable entre runs**, c'est la condition de la déduplication (D26).

**État exact** : mesuré, non corrigé. **Prochaine action** : corriger la dérivation d'`externalId` de ces adaptateurs (cause), puis `reconcile` sur les offres concernées (données) — dans cet ordre.

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

**Prochaine action** : détacher d'abord les **172** (sans effet visible, aucune décision requise), puis appliquer aux 585 la décision du propriétaire.

---

## Ce qui reste ouvert après P2, explicitement

| Dossier | État | Volume | Prochaine action | Reporté vers |
|---|---|---:|---|---|
| Talentsoft — réparation des données | cause corrigée + testée, données non réparées | 102 offres | réparation hors ligne depuis le RAW, sous protocole | **P3** |
| UNIQLO — réparation des données | cause corrigée + testée (test vérifié en échec sur l'ancien code), données non réparées | 2 offres | rejeu de la source, sous protocole | **P3** |
| Ulta — fusion d'identité | mesuré, non réparé | 1 offre | fusion sous protocole, parité avant/après | **P3** |
| Doublons sur identifiant instable | mesuré, non corrigé | ~25 offres | corriger l'`externalId` des 5 adaptateurs, puis `reconcile` | **P3** |
| Refus d'identité sur libellés actifs | mesuré | 20 libellés | revue d'alias, avec la famille G | **P3** |
| WTTJ sous PAUSED | qualifié, sous contrôle | 52 offres | trancher au premier run complet après reprise des crons | dépend d'une **décision propriétaire** |
| FashionJobs — 172 détachables | instruit | 172 offres | détachement, sans effet visible | **P3** |
| FashionJobs — 585 dépendantes | instruit, **bloqué** | 585 offres (583 FR) | retrait administratif | **décision propriétaire** |
| Ralph Lauren — egress | sonde écrite, **bloquée** (jeton en lecture seule, HTTP 403) | 1 103 offres | rejouer la sonde avec un jeton autorisé | **P3** |
| Ralph Lauren — offre datée unique | caractérisée (seul `externalId` à 4 chiffres), inexpliquée | 1 offre | sans objet tant que l'egress n'est pas vérifié | **P3** |
| Offres sans `postedAt` restantes | qualifiées par source | 306 indécidables + 5 RAW vides | voir § dédié du dossier Ralph Lauren | **P3** |
