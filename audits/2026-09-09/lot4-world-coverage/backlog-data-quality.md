# Backlog qualité des champs — points ouverts avec témoins et critères de résolution

Règles communes : aucune valeur n'est forcée, aucune date technique (`date_start`, `date_modified`, première collecte) ne devient une date de publication, aucune correction n'est faite par exception nominative. Un point sort du backlog quand son critère est prouvé sur les données réelles, avant → après.

## Lindex / EasyCruit (source `lindex-easycruit`, 41 offres, livrée le 2026-09-09)

| # | Point ouvert | Témoins (production) | Cause mesurée | Critère de résolution | Ce qu'on ne fera pas |
|---|---|---|---|---|---|
| L1 | **Aucune date de publication** : 0/41 `postedAt`, donc 0 `JobPosting` émis | toutes les offres `lindex-easycruit`, ex. `cmtub8dmq0003o20115yajcz4` | Le flux XML ne publie que `date_start` / `date_end` / `date_modified` (dates de campagne, gardées en RAW) ; la page publique native n'a pas de `datePosted` | Une surface officielle (page native, sitemap daté, en-tête) publie une date de **première publication** pour l'offre, lue et prouvée sur ≥ 3 offres ; ou l'éditeur documente que `date_start` est la publication | Utiliser `date_start` ou la première collecte comme `datePosted` |
| L2 | **Comtés et centres commerciaux dans `city`** | « Rogaland » ×5, « Nordland » ×2, « Akershus », « Innlandet », « Vestland », « Vestfold », « Troms », « Trøndelag », « Møre Og Romsdal » (comtés norvégiens) ; « Maxi Sandnes », « Bluewater », « Manglerud » (centres commerciaux) ; 1 offre sans lieu (`3655529`) | `Location` EasyCruit est un texte libre par offre ; la Norvège n'a pas de table de subdivisions, donc `adminArea1` reste vide (D53) et le libellé tombe dans `city` | Table de subdivisions NO/SE/DK reconnue (porte unique `resolveSubdivision`) : les comtés migrent vers `adminArea1` et `city` redevient nulle quand la source ne nomme pas de ville ; les centres commerciaux restent en `location` brute, jamais en `city` | Déduire une ville d'un centre commercial ou d'un titre (« Lindex Moss Amfi » → Moss) |
| L3 | **Contradiction titre / champ** : 1 offre sans `employmentTerm` | `3656567` « Assisterende butikksjef for Lindex Kilden - Vikariat », champ `duration=Fast` | TITLE_EXPLICIT (FIXED_TERM) ≠ STRUCTURED (PERMANENT) ; la source est nouvelle, `sourceFieldTrust` n'a pas 30 observations comparables → la chaîne refuse de trancher (D54) | Le verdict `sourceFieldTrust` pour (`lindex-easycruit`, `duration`, `employmentTerm`) atteint `MIN_EVIDENCE` sur plusieurs runs et décide selon la règle générale ; ou la source corrige l'annonce | Ajouter une règle « si Lindex alors le titre gagne » |
| L4 | Valeurs sans équivalent canonique : 12 durées (« Ekstrahjelp » ×7, « Na smlouvu » ×5), 8 rythmes (« Ved behov » ×4, « Příležitostná práce » ×2, « VPP », 1 vide) | ex. `3652617`, `3654815`, `3656629` | La source n'exprime pas une valeur de la taxonomie mondiale (extra / à la demande / emploi secondaire) | Décision de modèle (Loïc) : une dimension « on-call / casual » est-elle légitime dans le modèle mondial ? Mesurer d'abord le volume sur toutes les sources | Ranger « Ekstrahjelp » dans TEMPORARY ou PART_TIME par approximation |

## Sport 1 (source `sport-1` retirée, portail officiel à zéro offre)

| # | Point ouvert | Témoins | Critère de résolution |
|---|---|---|---|
| S1 | Portail officiel ReachMee sans offre le 2026-09-09 ; aucun adaptateur ReachMee | `sport1-browser-proof.json` (« Vi har for tiden ingen ledige stillinger »), `Company.atsConfig` de `cmtlygxyn02pfqf5kej297efs` | Dès qu'une offre réelle apparaît sur `karriere.sport1.no/jobs`, construire et valider l'adaptateur ReachMee sur elle, puis candidat → revue → promotion |
| S2 | Franchises : zéro sur le portail central ne prouve pas zéro offre chez les franchisés | — | Recherche des canaux de recrutement des magasins franchisés (portails régionaux, annonces locales) avant toute affirmation d'absence |

## Lagardère Travel Retail (source `lagardere-travel-retail`, Talentsoft)

| # | Point ouvert | Témoins | Cause mesurée | Critère de résolution |
|---|---|---|---|---|
| L5 | **20 offres fantômes** aux URLs mortes (redirigées vers `lagardere.com`), doublons des 20 offres les plus récentes du listing | représentations `lagardere-travel-retail` dont `externalId` est une URL `lagardere.com/nous-rejoindre/postuler/offre-…` | identifiant RSS = lien entier (pas d'`idOffre`), donc jamais rapproché de la carte `_<id>.aspx` ; corrigé dans l'adaptateur (PR 59) | après le run corrigé, ces 20 représentations ne sont plus ré-attestées ; `postingMerges` les refuse par construction (deux `externalId` distincts d'une même source ne sont jamais fusionnés), donc leur sortie passe par le **refresh** à sa reprise (fermeture après 48 h sans ré-attestation). Critère : 0 offre active de cette source dont l'URL quitte le board ; à défaut, un plan revu de retrait au niveau offre reste à concevoir |

## Capri (Workday `capri-jimmy-choo`, `capri-michael-kors`) — entités juridiques affichées comme Maisons

| # | Point ouvert | Témoins (production, 2026-09-09 19:50 UTC) | Cause | Critère de résolution |
|---|---|---|---|---|
| C1 | La marque Workday (`brandFromWorkdayDetail`, logo puis entité légale) rend des **entités juridiques** comme employeurs : « J Choo » 36, « Franchoo » 4, « Jimmy Choo Tokyo » 3, « Jimmy Choo (Shanghai) Trading Co. » 2, « Itachoo », « J Choo (Switzerland) », « Jimmy Choo Hungary KFT » ; « Michael Kors Stores California » 54, « Michael Kors (USA) » 37, « Michael Kors (Canada) » 37 | `byCompany` de `families-production-before-run.json` | Le repli sur l'entité légale (D45 : ligne « RATTACHÉ », pas une Maison) n'est pas passé par une revue d'identité pour ces tenants | Revue d'identité source-scopée (alias entité → marque, preuve = la page Workday nomme la marque et le site officiel), même mécanisme que D45 ; **aucune fusion par le nom** ; à traiter en lot Capri après le run des familles |

## Kering (Eightfold `kering`) — libellé Maison absent sur 6 offres

| # | Point ouvert | Témoins | Cause | Critère de résolution |
|---|---|---|---|---|
| K1 | 6 offres existantes (Saint Laurent ×2, Boucheron, Kering Corporate, Kering Eyewear…) dont le flux ne porte plus la propriété Maison au run du 2026-09-09 19:55 UTC : libellé « Kering » → la porte d'identité refuse le changement Maison → groupe, l'offre garde sa Maison | `families/families-production-failures.json` (`kering`, `EmployerIdentityReviewRequired`, proposed « Kering ») | Propriété `efcustomTextHouse` vide sur ces positions à ce run | Si la propriété revient, rien à faire (ré-attestation normale) ; si elle reste vide sur plusieurs runs, revue nominative : Maison confirmée par la page native ou rattachement au groupe — **jamais par le nom** |

## Workday mono-marque — annonces retenues sans employeur dans le détail

| # | Point ouvert | Témoins (run `a32c515d`, 2026-09-09 20:26 UTC) | Cause | Critère de résolution |
|---|---|---|---|---|
| M1 | `mango` : **27 annonces retenues** (`WORKDAY_EMPLOYER_ABSENT_IN_DETAIL`, non résolues → source « non complète ») ; `nordstrom` : 2 | événements `job.publication_held`, archivées en `SourceObservation`, ex. `STORE-MANAGER---MADRID-CENTRO_JR141415-1` | Le détail Workday ne porte ni logo ni entité légale ; la disposition de publication ne connaît pas de règle pour ce motif | Décision de modèle (Loïc) : sur un tenant Workday **mono-marque** (libellé de catalogue = la marque, aucune propriété de marque), une annonce sans employeur dans le détail peut-elle prendre le libellé de catalogue (règle universelle, jamais « si Mango ») ? Jusque-là : retenues, non publiées, non comptées comme erreurs |
