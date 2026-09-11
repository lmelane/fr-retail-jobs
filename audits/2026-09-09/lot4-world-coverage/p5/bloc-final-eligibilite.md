# P5 — bloc final : qualification réelle de l'éligibilité Google Jobs

Mesures du 2026-09-11, **production en lecture seule** (base par `db.py readonly`, site par requêtes GET).
Aucune écriture de production, crons gelés, catalogue inchangé.

## 1. Avant — la mesure était mal nommée, et la porte trop permissive

Les **77 482** publiés dans le bilan précédent étaient `active AND postedAt IS NOT NULL`, présentés comme
« éligibles au balisage JobPosting ». C'était faux : la date de publication n'est **qu'une** des conditions
requises, et `jobPostingSchema` ne testait que celle-là.

Conséquence mesurée sur les pages réellement servies : une offre **sans description**, **sans lieu exploitable**,
ou dont **l'échéance était dépassée**, recevait quand même un `JobPosting`.

## 2. Causes établies

| Cause | Constat |
|---|---|
| La porte ne testait qu'une condition | `if (!datePosted) return null;` — rien sur la description, le lieu, l'échéance, l'organisation ou le chemin de candidature |
| « visible » et « éligible » étaient confondus dans un seul chiffre | d'où un compte qui ne représentait ni l'un ni l'autre |
| « multilocalisation » mesurait autre chose | le contrôle comptait des `JobSource` (1 889) et affirmait démontrer les lieux multiples et le télétravail |
| `Job.city` agrège les énumérations | « Hong Kong; Shanghai…; Shenzhen Shi… » devient **« China Hong Kong Shanghai »**, qui n'est pas une ville — la publier comme `addressLocality` annonce à Google un lieu inexistant |

## 3. Modifications

| Fichier | Changement |
|---|---|
| `apps/web/lib/job-posting-schema.ts` | `markupIneligibility()` : **huit motifs nommés**. `jobPostingSchema` appelle cette même fonction — la mesure et le rendu ne peuvent pas diverger |
| idem | `physicalPlaces()` : plusieurs lieux → **tableau** de `Place` construit depuis l'énumération de la source, jamais depuis l'agrégat de `city` |
| idem | `locationProperties()` : `jobLocationType: TELECOMMUTE` + `applicantLocationRequirements` **quand le pays est connu**, rien d'inventé sinon |
| idem | les segments nommant le télétravail (`Remote`, `Virtual`, `Anywhere`, `Télétravail`) ne sont **jamais** publiés comme lieu |
| `apps/aggregator/scripts/coverage/public-pages.mts` | quatre mesures renommées, motifs avec identifiants, terminologie séparée, quatre nouveaux états de fiche |

**Les motifs d'inéligibilité** : `OPEN_APPLICATION`, `NO_REAL_POSTED_DATE`, `NO_TITLE`, `DESCRIPTION_TOO_THIN`
(< 100 caractères), `NO_HIRING_ORGANIZATION`, `NO_USABLE_LOCATION`, `VALID_THROUGH_EXPIRED`, `NO_APPLY_PATH`.

## 4. Tests ajoutés — les quatre scénarios exigés, plus trois

| Scénario | Attendu | Résultat |
|---|---|---|
| **1.** datée mais description incomplète | visible, **aucun** JobPosting | `DESCRIPTION_TOO_THIN`, schéma `null` sur 4 variantes (nulle, vide, 11 et 16 caractères) |
| **2.** active, `validThrough` passé | visible si voulu, **aucun** JobPosting | `VALID_THROUGH_EXPIRED`, schéma `null`, **et la date de la source inchangée** |
| **3.** plusieurs lieux physiques | tableau `jobLocation` cohérent | 3 lieux depuis « Hong Kong; Shanghai…; Shenzhen Shi… », et l'agrégat « China Hong Kong Shanghai » **absent du balisage** |
| **4.** 100 % distante | `TELECOMMUTE` + restriction si connue | `jobLocationType: TELECOMMUTE`, `applicantLocationRequirements: {Country, US}` |
| 4b. distante **sans** pays connu | pas de restriction inventée | `NO_USABLE_LOCATION` → aucun balisage |
| chaque motif nommé séparément | pas de cumul à tort | un défaut → un motif ; deux défauts → deux motifs |
| « Remote » jamais un lieu | segment écarté | `"Remote"` absent du balisage ; un seul lieu restant redevient un objet |

**111 tests web verts** (dont 11 nouveaux), typecheck 0 erreur sur les deux workspaces.

## 5. Après — les nouveaux dénominateurs

### Les quatre mesures, nommées pour ce qu'elles sont

| Mesure | Offres | Ce qu'elle signifie |
|---|---:|---|
| `visibleOnModeCareers` | **78 932** | la page est servie |
| `markupEmitted` | **15 / 33** | balisage réellement émis sur les fiches contrôlées *(échantillon borné, déclaré)* |
| `googleEligible` | **75 853** | **toutes** les conditions requises réunies |
| `googleIneligible` | **3 079** | visible, sans balisage |
| `googlePresence` | **non mesurée** | ne se déduit pas du balisage, et aucun script ne peut l'établir d'ici |

### `googleIneligibleByReason` — avec identifiants dans `public-pages.json`

| Motif | Offres |
|---|---:|
| `NO_REAL_POSTED_DATE` | **1 450** |
| `NO_USABLE_LOCATION` | **939** |
| `DESCRIPTION_TOO_THIN` | **477** |
| `VALID_THROUGH_EXPIRED` | **257** |
| `OPEN_APPLICATION` | 1 |

*(La somme des motifs, 3 124, dépasse les 3 079 offres inéligibles : 45 offres cumulent plusieurs motifs. Les
motifs sont comptés par condition, pas par offre — c'est voulu, et chaque offre est nommée dans le fichier.)*

### Preuve avant / après, sur les pages servies

| | Avant déploiement | Après déploiement |
|---|---:|---:|
| Fiches conformes | **27 / 33** | **33 / 33** |
| Balisage émis sur l'échantillon | 21 | **15** |
| `« Remote »` publié comme lieu | **oui** | **non** |

Les 6 échecs d'avant étaient exactement les descriptions de 0 et 86 caractères et les trois échéances au
2026-09-06 qui portaient encore un balisage. **C'est la preuve du défaut, mesurée avant puis après.**

### Terminologie corrigée — trois notions, trois mesures

| Notion | Définition | Offres |
|---|---|---:|
| **multi-sources** | plusieurs `JobSource` actives pour une offre canonique | **1 889** |
| **multilocalisation** | plusieurs **lieux physiques** réellement énumérés | **51** |
| **télétravail** | `workplaceType = 'REMOTE'` | **362** (dont **339** avec pays connu) |

*59 libellés énumèrent des lieux ; 8 n'en contiennent qu'un une fois le télétravail écarté, d'où 51. 9 offres
cumulent énumération et télétravail.*

**Scénario 3 vérifié sur les pages servies** : 8, 4 et 3 `jobLocation` respectivement, cohérents avec le libellé
de la source. **Scénario 4 vérifié** : `TELECOMMUTE` + `{Country, US}`, et **aucune `addressLocality` émise** quand
la source n'en donne pas.

## 6. Restant

| Point | État |
|---|---|
| **257 échéances dépassées** | **traité** : plus aucun balisage, date de la source **ni réécrite ni prolongée**, aucune mutation d'historique. La page reste visible. Aucun run n'est supposé remplacer la date |
| Segments de lieu conservés tels quels | `"or San Diego, CA"`, `"Scotland"`, `"United States"` apparaissent comme `addressLocality` : c'est **l'énumération de la source rendue verbatim**. En extraire une ville serait deviner. Ouvert, sans correction — on préfère le libellé exact de la source à une ville inventée |
| Filtre public télétravail | **décision produit**, ne bloque pas P5 (arbitré) |
| 939 offres sans lieu exploitable | ni ville ni pays : inéligibles, visibles. Amélioration de la donnée géographique, hors périmètre P5 |
| `whereClause` code mort | signalé au bilan P5, hors périmètre |

## Piège d'exploitation rencontré, à conserver

`deploy-guard.py` ne surveille que le service **aggregator** (`SERVICE = 203613c5…`). J'ai lu son `SUCCESS`
comme si le site était déployé, puis conclu à tort que le correctif ne prenait pas effet — `catwalks-web` était
encore en `BUILDING`. **Un changement sous `apps/web` exige de vérifier le statut de `catwalks-web`**, pas celui
de l'aggregator. Vérificateur ajouté : `backups/lot4-20260909/p5b-webstatus.py`.

Et : un push direct sur `main` a été **refusé par la protection de branche** — comportement voulu (mis en place
après la PR 96 fusionnée avec CI rouge). Le correctif est passé par la PR 107.
