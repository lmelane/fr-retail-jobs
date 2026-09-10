# Catwalks — reprise du LOT 4

**Arrêt demandé par le propriétaire le 9 septembre 2026, vers 18 h à Paris, pour préserver son quota. Le LOT 4 n’est PAS terminé.**

Ce document est le point de reprise pour une autre IA. Il distingue les observations, le code local, les livraisons et les réparations réellement effectuées. Ne pas interpréter les anciens checkpoints comme l’état actuel : plusieurs ont été suivis de livraisons supplémentaires.

## 1. Commencer ici

- Projet local : `/Users/lmelane/Downloads/catwalks-job-aggregator`.
- Remote : `https://github.com/lmelane/fr-retail-jobs.git`.
- Branche : `codex/lot4-market-coverage`.
- HEAD local : `d3ab692` — documentation des preuves GANNI et du verrou de migration, **non mergée**.
- Dernier `origin/main` vérifié : `459da3ad486f8aa71d9660e36ef40d05f8fb6bd0` — PR 53.
- Des changements applicatifs **non commités** existent : EasyCruit et extension du référentiel pays. Les conserver et les relire ; ne pas faire de reset/checkout destructif.
- Dernière production vérifiée : quatre services Railway SUCCESS sur `459da3a` ; **77 406 offres conservées, 74 164 actives, 10 957 France**. C’est une photographie datée, pas une promesse de compteur permanent.
- Ingestion mondiale, refresh et reconcile restent volontairement sous **`PIPELINE_PAUSED=1`**. Ne pas réactiver avant la qualification restante.
- Dernier travail effectué : migration EasyCruit appliquée **uniquement aux bases de test et de copie locale** ; retrait des sept faux contenus Lindex testé **uniquement sur la copie locale**. **Aucune modification Lindex en production.**
- À l’arrêt : investigation réseau stoppée ; résultats partiels conservés et fichier de reprise préparé. Pas de nouveau correctif ni déploiement lancé après la demande d’arrêt.

Lire ensuite :

1. `audits/2026-09-09/lot4-world-coverage/brief.md` — brief complet, prioritaire.
2. Le présent document, notamment §§ 4–10.
3. `audits/2026-09-09/lot4-world-coverage/README.md` — historique, certains chiffres sont anciens.
4. `talent-recruiter-ganni.md`, `harri-ashby-homonyms.md`, `withdrawal-lifecycle.md`, `schema-deployment-incident.md` dans le même dossier.
5. Instructions locales applicables (`CLAUDE.md` notamment). Les anciennes restrictions France seulement / pas de production ont été explicitement remplacées par les autorisations ultérieures du propriétaire.

## 2. Mission et règles à préserver

Le LOT 4 fusionne discovery mondiale, audit des **1 653 entrées FashionJobs / 1 670 libellés RAW**, recherche des sources officielles, qualification des ATS, corrections universelles, ingestion complète et contrôle de qualité réel.

Le marché ne se limite pas à FashionJobs : Mode, Maroquinerie, Chaussures, Joaillerie, Horlogerie, Beauté, Parfumerie, Lunetterie, Maison & Lifestyle, Vins & Spiritueux, Hospitality, Automobile & Mobilité de luxe, Art & Design, Retail, Luxury Tech & Services. Les quinze verticales ne sont pas une whitelist interdisant des acteurs pertinents.

Autorisations déjà données : correction du code, migrations nécessaires, réparations de production prouvées, commits, merge main, déploiement. Ne pas redemander une autorisation de principe. En revanche, l’utilisateur vient de demander l’arrêt : reprendre seulement dans sa nouvelle session.

Invariants :

- FashionJobs sert à la **découverte des acteurs**, jamais à collecter ses offres.
- Collecter les offres mondiales ; le front filtre ensuite la France.
- Aucune fusion sur simple ressemblance de nom ; conserver les distinctions métier, groupes, marques, enseignes, entités légales, sources et ATS.
- Identité : RAW → règle → canonique → preuve → confiance. Alias et taxonomies en données autant que possible.
- Préserver tous les identifiants, RAW et événements historiques. Un retrait du catalogue n’est pas une fermeture employeur.
- Aucune date inventée pour Google Jobs. `created`, `modified`, date de début de campagne et date de première collecte ne sont pas automatiquement `datePosted`.
- Une valeur non canonisée ne doit pas supprimer une offre. Un statut non résolu doit porter cause, preuve, investigations et prochaine action.
- Pas de load test ni simulation de charge. Tests unitaires de protocole + données réelles / copie de production.
- Pour chaque lot : avant → cause → correction → témoin → diff → tests → commit → main → déploiement → preuve de production.
- Une liste complète d’un tenant ne prouve ni l’identité employeur, ni tous les portails mondiaux, ni la qualité des champs.
- Ne pas lancer de sous-agents sans demande explicite ; aucun sous-agent n’est actif.

## 3. Ce qui est réellement livré

| Sujet | Code / main / déploiement | Réparation de production | Preuve |
|---|---|---|---|
| Registre commun ingestion/validation ; Workable, Recruitee, Personio ; pagination, compteurs et session SAP ; discovery multilingue | PR 49, merge `b09c942ff6d71e43fca263d591f1458339e19a4e` | Réingestion mondiale NON faite ; Coty/Puig seulement | `production-remediation-proof.json`, `feed-qualification-checkpoint.json` |
| Portails Coty/Puig attribués à une seule marque | PR 49, déployé | **386 offres**, dont 377 actives, réattribuées ; 776 corrections ; 8 nouvelles offres par run réel ; anciennes marques non fusionnées | `production-remediation-proof.json` |
| Retrait administratif assimilé à une fermeture | PR 50 ; app `146e6b0`, merge `1ccf8cbe6fef5dc25c16f5f73a69a1cb62db80e5` | **371 offres** réparées ; RAW/IDs/historiques conservés ; rejeu zéro | `withdrawal-production-proof.json` |
| Harri, Ashby et homonymie Saltrock | PR 51 ; app `9fac7d1926cc4fad213705bd6d7bdf0790c2bc69`, merge `aa2d819509a54e5b2a71ac603e6061f6cfa24fea` | SaltRock GmbH séparé de Saltrock britannique : 5 réattributions, 3 retraits, 2 vraies fermetures conservées ; 30 nouvelles offres britanniques via Harri | `harri-production-proof.json`, `harri-ashby-homonyms.md` |
| Talent Recruiter, GANNI, candidatures spontanées, retrait générique d’une source invalide, validation stricte du scope CLI | PR 52 ; app `49dbb5a4de10b76bb6fe587dfe7606f82fa4ce43`, merge `bd2f88221e69a508ef2320d1f3e8f48a6c360ee3` | **11 contenus GANNI de démonstration retirés**, **16 entrées natives ingérées**, dont une candidature spontanée ; ID/RAW/historique préservés | `ganni-production-preservation-proof.json`, `ganni-public-production-proof.json`, `ganni-production-delivery-proof.json` |
| Migration avant démarrage web + health lié à la liste exacte des migrations du build | PR 53 ; app `29d8d2d` + `a0eda8f`, merge `459da3ad486f8aa71d9660e36ef40d05f8fb6bd0` | Migration 39 appliquée ; hook Railway et health validés en production | `schema-production-deployment-proof.json`, `schema-deployment-image-proof.json` |
| EasyCruit / Lindex | **LOCAL non commité, non mergé, non déployé** | **NON**. Retrait de 7 fausses annonces testé sur clone uniquement ; aucune offre EasyCruit encore ingérée dans le pipeline | Voir § 4 |
| CLDR pays v2, variantes officielles | **LOCAL non commité, non déployé** | **NON**. Comparaison hors ligne du corpus seulement | `backups/lot4-20260909/country-variants-corpus-proof.json` |

Les JSON cités sans préfixe sont dans `audits/2026-09-09/lot4-world-coverage/`.

### Production GANNI — détails utiles pour ne pas refaire le travail

- Entreprise `cmtlygvke02kaqf5kzt18xou4`, BRAND, FASHION.
- Ancienne source `ganni` RETIRED ; nouvelle `ganni-talentrecruiter` ACTIVE.
- Source officielle : `https://www.ganni.com/fr-fr/careers.html` → customer `ganni` sur Talent Recruiter.
- Alias source-scopé `GANNI A/S` → marque GANNI, sans fusion juridique ni parent supposé.
- Run réel `444686d1-7e9a-4913-9c04-e3ee07727ad5`, 15:44:17–15:44:23 UTC : 16 créations, 0 fusion, 0 erreur, 17 requêtes HTTP, 11 événements durables, 12 lignes Railway, pic 6/sec, aucune perte rapportée.
- API : monde 16, France 5, GB 1, FASHION 16 ; identifiants conformes.
- Candidature spontanée `cmtu9r2vs002lq6016sgybbuq` : visible, sans `JobPosting`.
- Ancien témoin `cmtlygvkj02kcqf5k6g949wds` : HTTP 410, sans `JobPosting`.
- Six nouvelles offres ont des coordonnées mais pas encore de pays canonique ; une candidature spontanée sans géographie. Ne pas utiliser le pays du département corporate.

## 4. Reprise immédiate : EasyCruit / Lindex / pays

### 4.1 Code local à conserver

Fichiers modifiés :

- `apps/aggregator/src/ats/adapters/easycruit.ts` — nouveau.
- `apps/aggregator/src/ats/adapters/easycruit.test.ts` — nouveau.
- `apps/aggregator/src/ats/catalogKinds.ts`.
- `apps/aggregator/src/ats/detect.ts`, `detect.test.ts`.
- `apps/aggregator/src/ats/index.ts`.
- `apps/aggregator/src/connectors/sourceCatalog.ts`.
- `packages/db/prisma/schema.prisma`.
- `packages/db/prisma/migrations/20260909234000_easycruit/migration.sql` — ajout de `EASYCRUIT` à `AtsType`.
- `apps/aggregator/data/country-labels.json`.
- `apps/aggregator/scripts/generate-country-labels.mts`.
- `apps/aggregator/src/normalize/country.test.ts`.

`prisma generate` effectué. Migration 40 appliquée aux bases **test et clone**, pas à la production.

### 4.2 Protocole réellement étudié

Officiel : `https://about.lindex.com/career/open-positions/`.

- Archive `backups/lot4-20260909/lindex-official-career.html`.
- Métadonnées `lindex-official-career-proof.json`.
- SHA256 officiel : `d5b87f8a8705975dcb0a49bffb35c4d8da277aa52c5757b8c3531039b98172de`.
- Le JS officiel `https://about.lindex.com/main.js?1788443121500` utilise le XML EasyCruit ; archive `lindex-career-assets.txt` (minifiée : ne pas la dumper dans la conversation).
- Flux public sans filtre : `https://lindex.easycruit.com/export/xml/vacancy/list.xml`.
- Détail : `/export/xml/vacancy/<id>.xml` ; page publique native `/vacancy/<id>/<department>`.
- Robots archivé `lindex-easycruit-robots.txt` : pages publiques autorisées, `/intranet/` exclu. Ne pas accéder aux interfaces internes.
- Documentation éditeur : `https://community.visma.com/t5/Kennisbank-Youforce-Werving/Opbouw-XML-datafeed/tac-p/660657/highlight/true` ; schémas `https://www.easycruit.com/dtd/vacancy-list.xsd` et `vacancy.xsd`.

Adaptateur : tenant validé, XML strict, refus DOCTYPE/ENTITY, identifiants/URLs natifs, toutes langues conservées, préférence linguistique d’affichage seulement, doublons/rejets explicités, erreurs de détail conservant l’offre listée avec statut incomplet, coordonnées du département jamais transformées en pays de l’offre, contacts non nécessaires exclus du RAW normal.

**Pas de compteur indépendant publié par le flux.** `declaredTotal` reste absent ; la preuve décrit une énumération complète du document XML, pas une comparaison à un compteur tiers inventé.

### 4.3 Mesures réelles et tests déjà faits

- `lindex-easycruit-real-result.json`, `lindex-easycruit-real-proof.json` : **41 IDs uniques, 41 descriptions, 0 rejet, 0 erreur, complete=true**, huit langues.
- **0 date de publication explicite trouvée** dans le XML ou les pages testées. `date_start`, `date_end`, `date_modified` restent RAW. Les notes éditeur distinguent les dates de campagne de celles de publication. Ne pas les renommer arbitrairement pour Google.
- Pays avant nouvelle référence : GB 1, NO 20, SE 4, SK 2, LT 4, LV 5, EE 1, DK 1, non reconnu 3.
- Les trois inconnus sont explicitement `Česká republika` ; la référence CLDR v2 les résout en CZ. Ne pas déduire le pays d’une ville.
- Tests : **1 598 unitaires passés** (`easycruit-unit.log`), **249 intégration passés** (`easycruit-integration.log`) sur base dédiée.
- Typecheck agrégateur passé avant la toute dernière extension CLDR (`easycruit-typecheck.log`) ; à refaire sur le diff final.
- **Pas encore** : tests web du diff final, build/CI, ingestion EasyCruit dans le clone, rejeu pipeline, publication front, données de production.

### 4.4 CLDR v2 — correction universelle, déjà mesurée hors ligne

Cause : `Intl.DisplayNames` fournit le nom préféré, pas toutes les variantes officielles (`Česko` vs `Česká republika`).

- Référence `country-labels-20260909-v2` : **5 925 → 6 232 libellés**, 38 langues ; 1 ambiguïté toujours préservée (`Kongo`).
- Package éditeur `cldr-localenames-full@48.0.0`, sources officielles CLDR ; pas de dépendance runtime ajoutée.
- Archive package SHA256 `b79db910fe2ba45ef20ca2f34ee5c269920a232a43e9af47676b79dfa6c03ac7`.
- Référence générée et provenance versionnées, hashes des 38 fichiers + hash d’ensemble. Reproduction exige les mêmes versions ICU/CLDR.
- **72 139 offres de 426 sources archivées**, 59 313 pays RAW, 270 libellés distincts : 59 297 → 59 304 reconnus, **0 pays auparavant reconnu modifié**, 7 gains (4 Oniverse, 3 Lindex).
- Comparaison : `compare-country-variants.mts`, sortie `country-variants-corpus-proof.json`.
- Ancienne référence conservée : `country-labels-before-variants.json`, `country-before-variants.ts`.

Reproduction depuis la racine :

```sh
npx tsx apps/aggregator/scripts/generate-country-labels.mts --cldr-dir backups/lot4-20260909/cldr-localenames-full/package
npx tsx backups/lot4-20260909/compare-country-variants.mts
```

Attention : les **251 codes opérationnels** conservés ne sont pas à présenter comme une liste ISO officielle de 249 pays. La whitelist historique de `country.ts` semble encore contenir d’autres codes anciens (ex. HV) ; audit référentiel à faire séparément, sans changement opportuniste de données.

### 4.5 Lindex : vérité de production et retrait local déjà testé

**Correction d’une lecture intermédiaire : ce sont SEPT anciennes annonces, toutes de la source `lindex`, pas cinq plus deux autres sources.** Le snapshot détaillé du 9 septembre a levé cette confusion.

- Entreprise `cmtlyg3ew01h7qf5ky32oq9vd`, canonicalKey LINDEX, domaine lindex.com, actuellement kind UNKNOWN / secteur historique RETAIL / sectorCodes vides.
- Source `lindex`, Teamtailor, config `origin=https://lindex.teamtailor.com`.
- Hash source `89da0aa183daba786a4be64f6f30ca54ee1b488b4ff87632df2b51b38b0c8689`.
- Sept annonces actives, publications affichées 2022/2024 : trois descriptions Teamtailor SaaS, deux consignes de rédaction, deux placeholders OurCompany/Example Client.
- Snapshot privé complet : `lindex-production-before.json` ; script read-only `lindex-state.mts` ; résumé `lindex-state.log`.
- Plan local : `lindex-withdrawal-review.json`, `lindex-withdrawal-clone-plan.json` ; script `lindex-withdrawal-clone.mts`.
- **Exécuté sur clone seulement** à 15:57:54 UTC : 15 écritures, 7 offres retirées, source retirée, 77 406 IDs conservés, RAW/historiques/employeurs inchangés, zéro violation lifecycle, rejeu zéro.
- Hash du plan clone : `c9cb911e05425d43578a7bf77b7452618d49f696596805f1eec7d8477d33a545`.
- Preuve : `lindex-withdrawal-clone-proof.json`.
- Le clone compte donc, après ce retrait, **77 406 offres conservées / 74 157 actives** (actives déduites du retrait de sept ; remesurer avant ingestion). La production n’a pas subi ce retrait.

### 4.6 Ce qu’il reste exactement à faire pour livrer Lindex

1. Revue finale de l’adaptateur et de ses limites. Examiner notamment les variantes linguistiques, les listes XML vides et les détails invalides ; ne pas confondre complétude d’énumération et qualité des champs.
2. Qualifier les sept noms natifs : `Lindex`, `Lindex AS`, `Lindex Central Europe`, `Lindex Lithuania`, `Lindex Latvia`, `Lindex Eesti OÜ`, `Lindex Denmark`.
3. Ils sont publiés par le tenant explicitement relié au site officiel. Préparer des alias **source-scopés de marque de recrutement**, sans affirmer qu’il s’agit de la même société légale ou que toute franchise appartient au groupe.
4. Source documentaire complémentaire : `https://about.lindex.com/files/documents/lindex-group-annual-report-2024.pdf` (filiales) ; `https://www.lindexgroup.com/en/careers/` distingue Lindex et Stockmann. La structure juridique actuelle et les franchises doivent rester distinctes. Pas de parent créé/attribué à ce stade.
5. Créer sur clone un candidat EasyCruit, par exemple clé `lindex-easycruit`, config `{host:"lindex.easycruit.com"}` ; utiliser les procédures existantes `registerSourceCandidate`, revue identité, `promoteSource`. **Cette étape n’a pas été faite.**
6. Enregistrer revue métier/secteurs selon preuves officielles, sans attribuer tous les secteurs possibles par intuition.
7. Ingestion réelle strictement limitée à cette clé, clone seulement ; 41 IDs attendus au reçu actuel, pas un invariant figé si la source évolue. Mesurer normalisation, rejets, associations employeur, dates, pays, RAW, opportunités, déduplication et front. Rejouer ; preuve qu’aucun ID préexistant n’est perdu.
8. Refaire typecheck final, tests pertinents web/build/CI, inspecter le diff. Ne pas appeler les tests destructifs sur production.
9. Commit, PR, merge main ; vérifier les quatre déploiements et la migration 40 **via le nouveau predeploy**, avant exposition web.
10. Refaire un plan de retrait Lindex sur production, comparer les patches au clone, pas les timestamps/ordre seuls. Vérifier source inchangée et absence de représentation concurrente. Appliquer avec hash, puis rejeu zéro.
11. Qualifier/activer le candidat officiel en production, alias revus, puis run Railway ciblé seulement. Restaurer commande normale + pause globale.
12. Comparer IDs source → JobSource → Job → API → front ; ancien contenu HTTP 410 sans JobPosting ; aucun pays forcé ni date inventée. Produire commit/main/déploiement/preuve et métriques avant/après.

Les scripts GANNI/Harri dans `backups/lot4-20260909` illustrent le protocole, **mais ne pas les rejouer aveuglément ni faire un remplacement de nom sans relire chaque assertion**. Les preuves et signatures sont propres à chaque plan.

## 5. Discovery FashionJobs et mondiale — état précis

### Acquis, sans surévaluer la qualification

- Première passe automatique : **1 653/1 653 entrées visitées/investiguées**. Cela ne signifie PAS 1 653 identités résolues ni 1 653 portails qualifiés.
- Référentiel mondial FashionJobs archivé : 87 éditions, 81 parsées, 6 vides ; 3 971 profils, dont 906 hors France. Ce sont des observations, pas autant de Maisons uniques.
- Rapprochement initial : 630 candidats nom/alias, 695 sites candidats, 511 candidats avec sources BDD. Pas des certifications.
- Dernier tracker composé AVANT la passe arrêtée : 1 096 `PROFILE_ONLY_WEBSITE_SEARCH_REQUIRED`, 181 `OFFICIAL_PORTAL_SEARCH_REQUIRED`, 278 `ATS_CANDIDATES_TO_QUALIFY`, 98 `CAREER_LINKS_TO_QUALIFY`.
- Ces chiffres sont anciens de quelques passes : recomposer avant de publier un bilan.

Répertoires privés à conserver :

| Répertoire sous `backups/lot4-20260909/` | Périmètre |
|---|---:|
| `portal-research` | 1 653 entrées, première passe |
| `portal-extra-domains` | 236 entrées |
| `portal-proactive` | 418 entrées |
| `portal-multilingual` | 244 entrées |
| `portal-extra-portfolios` | 68 entrées |
| `identity-official` | 7 investigations |
| `portal-unvisited` | passe de 354 acteurs / 415 URLs déjà inventoriées mais jamais lues, stoppée à la demande |

### Passe arrêtée et reprise sans refaire les requêtes

- **239 acteurs terminés**, **2 interrompus**, **113 non commencés** : **115 à reprendre**.
- Parmi les 239 terminés : 113 résultats ATS candidats, 43 recherche site à poursuivre, 31 liens carrière à qualifier, 52 pages sans lien carrière observé. Ce ne sont pas des sources nouvellement certifiées.
- Reçus et pages conservés dans `portal-unvisited/research.jsonl` et `artifacts/`.
- État : `handoff-research-progress.json`.
- Entrée prête : **`portal-unvisited-remaining-input.json`**, inclut les deux interrompus.
- Processus de cette recherche explicitement arrêté ; ne pas compter sur les anciens session IDs d’outils.

Commande de reprise (quand le propriétaire relance) :

```sh
npx tsx apps/aggregator/src/coverage/research-portals.mts backups/lot4-20260909/portal-unvisited-remaining-input.json backups/lot4-20260909/portal-unvisited-resume known > backups/lot4-20260909/portal-unvisited-resume.log 2>&1
```

Le mode `known` ne lit pas les offres FashionJobs. Concurrence 2, budget par acteur, traces datées. Cette passe corrige une insuffisance de recherche de la v1 : certains acteurs avaient plusieurs URLs connues mais seule la première avait été essayée. Exemple : échec certificat sur un apex Adidas sans essai de son URL www pourtant connue.

### Défaut du tracker À CORRIGER avant bilan final

`apps/aggregator/src/coverage/compose-inventory.py` remet `identityConfirmed:false` et `newSourceActivated:false` pour toutes les lignes ; `build-inventory.py` exporte déjà `identityReviewId`, mais le statut de recherche ne représente pas la qualification antérieure. Cela peut donner l’impression fausse que Sandro/Maje/etc. ne sont pas attestées.

Séparer explicitement :

1. Correspondance FashionJobs → entreprise : candidature ou décision attestée.
2. Identité canonique déjà revue en BDD, preuve et date.
3. Recherche de portail : avancement, échecs, URLs non encore visitées.
4. Certification de la configuration source actuelle : dernière revue, hash exact, tenant, sujet, validité, éventuelle contradiction ultérieure.
5. Activation réelle de la source, distincte de sa certification.
6. Complétude du flux testé, date, compteurs/IDs.
7. Couverture mondiale de tous les portails : non prouvée tant que non investiguée.

Réutiliser `assertIdentityReview` / les règles de `sourceIdentity.ts` ; ne pas compter toutes les anciennes lignes VERIFIED sans comparer la configuration actuelle. Ne pas perdre les anciennes preuves parce qu’aucun domaine propre n’est renseigné.

Le snapshot actuel `coverage/snapshot.mts` exporte les revues mais pas tous les champs nécessaires à cette validation (contenu/reviewer notamment). Faire la vérification dans le snapshot read-only et exporter un verdict justifié, sans dupliquer des documents sensibles dans le CSV public.

### Portefeuilles et discovery au-delà de FashionJobs

Déjà archivés : **275 observations dans 8 groupes** : LVMH 86, Richemont 23, Swatch 46, OTB 10, Coty 42, L’Oréal 54, Tapestry 2, Kering 12. Ces nombres sont des observations de page, pas des nombres certifiés de marques détenues.

Nouvelles observations privées, pas encore intégrées au référentiel final :

- Shiseido : 34.
- Estée Lauder Companies : 25.
- Prada Group : 7.
- Soit **66 observations supplémentaires / 3 groupes**, pas 66 entreprises nouvelles confirmées.
- Puig : 17 cartes archivées, intégration restante.

Fichiers : `portfolio-expansion-selectors.json`, `portfolio-expansion-observations.json`, `portfolio-expansion-input.json`, `portfolios-expanded/`, `group-witnesses.json`.

Pièges démontrés :

- Shiseido : les 34 logos sont des images avec `alt`, pas des liens. Un extracteur limité aux ancres les manque.
- ELC : client Node 403, accès HTTPS curl ordinaire 200. Un échec technique ne démontre pas l’absence de site.
- Prada : timeout Node, curl ordinaire 200. Le site officiel actuel présente **Versace dans Prada Group** ; ne pas recopier un ancien rattachement à Capri.
- Les listes de portefeuille peuvent mêler propriété, licence et activités. `Prada Beauty`/L’Oréal ne prouve pas propriété juridique de Prada.
- La sélection générique du libellé le plus court peut choisir « View Brand Page » au lieu de la marque : qualifier les sélecteurs en données, garder le RAW.

À faire : intégrer les sélecteurs revus, comparer aux identités BDD, prouver les relations, examiner les portails communs et régionaux, élargir aux fédérations/salons/annuaires et aux quinze verticales, France prioritaire puis couverture mondiale. Aucun lancement massif non qualifié.

## 6. Sources incomplètes — travail encore nécessaire

Baseline : 423 sources actives toutes réellement interrogées. 305 complètes / 118 partielles initialement. Après corrections et passes : **385/423 flux configurés complets, 38 restants** (Polène Ashby 79/79 inclus). Baseline figée : ne pas changer le dénominateur en ajoutant silencieusement Harri/GANNI/Lindex.

Les 38 dossiers encore partiels ou non prouvés, avec comptes observés lorsque disponibles :

| Source / dossier | Dernière observation à investiguer |
|---|---|
| Alberto | 8, moteur générique |
| Pandora | 904 |
| Swatch | 257 / 259 |
| PVH | 1 367 |
| Element6 / Magnet | 388 |
| Attaquer | 3 |
| Oniverse | 18 |
| Zegna | 60 |
| Lacoste | DigitalRecruiters, voir ci-dessous |
| Foot Locker | 2 810 / 2 842 |
| Oska | 0 |
| Gant | 108 |
| The Kooples | 69 |
| NARS | 53 |
| Eram | 83 |
| END | 20 |
| Aéropostale | 18 |
| Luxe Talent | 478 |
| LuxExperience | 53 |
| Psycho Bunny | 10 |
| URBN hub | 1 353 |
| Brown Thomas | 69 |
| URBN stores | 928 |
| Kastner | 4 |
| Nocibé | 293 |
| Bevilles | 23 |
| Beiersdorf | 104 |
| Nordstrom | 1 291 / 1 293 |
| Lumentee | 5 |
| Rituals | 1 127 / 1 254 |
| Boots | 1 489 |
| Marc O’Polo | 15 |
| Capri / Michael Kors | 511 / 512 |
| Mango | 1 616 / 1 618 |
| Globus | 22 |
| Aigle | 108 |
| Kering | 1 029 / 1 030 |
| Lagardère | 129 / 109 |

Ces nombres ne sont ni des objectifs figés ni des erreurs toutes expliquées. Reprendre les reçus pour les clés exactes, URLs, dates et causes. Les variations naturelles de la source doivent être distinguées des défauts de pagination/dédoublonnage.

Archives : `source-probes`, `source-probes-after-all`, `source-probes-personio-employer`, `source-probes-sap-final`, `source-probes-sap-counters`, `source-probes-sap-session`, `source-probes-ashby`. Reçus `.receipt.json`, réponses `.json.gz` ; ne pas dumper les gros fichiers.

### Lacoste / DigitalRecruiters — cause concrète non corrigée

- Endpoint public `.../public/v1/careers-site/job-ads?domainName=careers.lacoste.com&limit=100&page=N&locale=fr_FR`, POST corps `{}`.
- Cinq pages : **460 lignes**, **453 `job_ad_id` uniques**, **460 `item.id` uniques**.
- Sept variantes de diffusion/localisation sont actuellement écrasées par le dédoublonnage sur `job_ad_id`.
- `fr_FR` expose le catalogue mondial ; `en_US` retourne 400, ce n’est pas un filtre France.
- Archives `dr-lacoste-fr_FR-{1..5}.json`, `dr-lacoste-enumeration-before.json`.
- À faire : conserver les représentations et localisations multiples, compter séparément annonces/diffusions/offres, prouver la pagination et les IDs ; ne pas maquiller 460/453 en bug de compteur sans analyser le modèle natif.

## 7. Identités et contenus encore à réparer

Priorité avant ingestion mondiale :

- Source `maison-margiela` : flux OTB de groupe, environ 137 actives / 153 représentations. Revoir propriétaire et marques, sans fusionner Maison Margiela et OTB.
- Source `aptar-beauty` : flux Aptar Group, environ 217 actives / 221 représentations. Même protocole que Coty/Puig, preuves à réunir.
- Personio : Mateo (9, immobilier/SaaS), Hades (7, mining), Piña (2, carbone), Samson (1, brevet/avocats), Giga (2, recherche), Atlantis (3, logistique) — revue des correspondances et retrait/réattribution appropriée à prouver.
- Ne pas transformer les **230 observations Personio à revoir** en « 230 offres fausses » : elles comprennent des variantes légales légitimes (Aeyde, Alpha Industries, Closed, Pepco, Thomas Sabo / TSJ).
- KENT : 13 offres, tenant KENT Deutschland et domaine officiel kenteurope.com ; l’identité historiquement voulue n’est pas démontrée. Ne pas décider qu’il s’agit de Kent Brushes ni retirer par analogie.
- Jako : ancien contenu de test, 20 observations ; un portail officiel paraît exposer 16 postes + candidature spontanée. Qualifier avant mutation.
- Lindex : voir § 4 ; **sept**, pas cinq, contenus de démonstration.

### Sport 1 — véritable portail trouvé, zéro offre observée

- Entreprise `cmtlygxyn02pfqf5kej297efs`, canonicalKey SPORT_1, domaine sport1.no.
- Ancienne source `sport-1`, Teamtailor, **11 contenus de démonstration** : pas encore retirés en production.
- Officiel `https://www.sport1.no/` → `https://karriere.sport1.no/`.
- `/jobs` affiche en navigateur zéro offre et « Vi har for tiden ingen ledige stillinger. »
- ReachMee tenant 1899/site 12/web103 repéré ; URL et preuve dans les archives `sport1-*`.
- Pas d’adaptateur ReachMee livré, pas de certification/retrait de production effectués.
- Zéro sur le portail officiel ne prouve pas zéro dans toutes les franchises.
- La promotion actuelle exige au moins une offre validée : garder un candidat documenté à zéro en DRAFT plutôt qu’activer artificiellement. Le retrait de la fausse ancienne source est un traitement indépendant.

## 8. Géographie, qualité, front et Google — restant non corrigé

### Préfixes de ville : bug de normalisation prouvé

`normalize/location.ts`, `CODE_PREFIX_RE=/^([A-Za-z]{2})-(\S.*)$/` : suppression du préfixe si la partie droite est assez longue ou connue. Résultat : **ST-ETIENNE → Etienne**, **LA-TESTE-DE-BUCH → Teste-de-Buch**.

`ST` et `LA` sont aussi des codes pays : une simple whitelist ISO ne suffit pas. Corriger en fonction des preuves/contexte/référentiels, pas par quatre exceptions de villes. `analyseSegment` a déjà un countryHint ; revoir les chemins où il manque. Témoins : `location-prefix-witness.mts/.json`.

### Pays absents et coordonnées

Avant GANNI : 4 866 pays absents sur 74 159 actives ; 20 lignes avec coordonnées, dont 2 sentinelles `(0,0)` Phenom, donc 18 coordonnées potentiellement exploitables. Dossiers `geography-coordinate-inventory.json`, `coordinate-witnesses.json`.

GANNI ajoute six postes avec coordonnées natives mais pays absent : IDs 144687 Boston, 144680/144664/144682 New York, 144681 Londres Beak Street, 144689 Stockholm. Une candidature spontanée n’a pas de géographie.

Une carte publique a fourni une adresse explicite pour Boston ; cela ne constitue pas encore une solution générale. Les fichiers de cartes peuvent contenir une clé embed publique : ne pas l’afficher, la commiter ou la réutiliser comme notre clé.

À étudier : preuve d’adresse native ou référentiel géospatial approprié, frontières/territoires/ambiguïtés ; pas de pays forcé par bbox grossière ou ville seule. Aucun backfill correspondant fait.

### Multi-localisation

Audit de 71 522 offres / 72 082 dernières représentations : 171 témoins schema.org multi-localisations sur 167 offres ; cinq candidats France supplémentaires, dont **quatre faux contenus GANNI désormais retirés**, un Horace candidature spontanée. Ne pas gonfler le compteur France avec des démonstrations.

Autres cas réels : Saffron GB+ES, PVH IN+US, Oh My Cream FR+BE, URBN 143 pays primaires absents. Modèle `JobLocation` / appartenance à plusieurs pays, filtres communs avec DISTINCT et JSON-LD multi-lieux : **non implémenté**.

### Front et Google Jobs

- Front réellement relié à la BDD auditée : **`https://modecareers.com`**.
- `/emplois`, `/api/jobs`, `/entreprises`, `/entreprise/[slug]`, `/offre/[title-id]`.
- `/offre/<id>` seul redirige 308 vers l’URL canonique : suivre la redirection avant de conclure à une panne.
- `catwalks.io/maisons` est une autre surface éditoriale ; la homepage ne teste pas les filtres des offres.
- Le traitement OPEN_APPLICATION est livré : affichage distinct, pas de JobPosting pour GANNI.
- **Reste** : audit global de l’éligibilité JSON-LD quand description/pays/date manquent ; possibilité d’émettre encore des objets incomplets historiques.
- Ne pas inventer de date pour promettre publication de toutes les offres sur Google.
- Cohérence BDD/API/agrégats/filtres principaux pays après nouvelles réparations ; multisécteurs et pays secondaires ; matching/recherche sans exclusion des non canonisés.
- Homepage : affirmations « texte complet, sans doublon » à justifier/rectifier ; « Maisons » peut compter des groupes (ancien témoin 1 043).
- MarketSnapshots historiques approximatifs, audit global des anciens événements CLOSED et coût de duplication RAW : non terminés.
- Identifiants Google Indexing : différés par l’utilisateur, pas un prérequis à l’audit des données.

## 9. Production, migrations et exécution sûre

### Incident de migration résolu, règle à ne pas contourner

PR 52 avait livré le client Prisma avec `Job.opportunityType` avant application de la migration. L’ancien health ne lisait pas ce nouveau champ, donc ne bloquait pas les requêtes applicatives en erreur. Incident détecté vers 15:22 UTC, migration 39 appliquée immédiatement, API de nouveau 200 vers 15:23. Ne pas inventer durée totale/impact utilisateurs ; seules les preuves archivées sont établies.

PR 53 corrige la cause :

- CLI Prisma runtime embarquée dans l’image web, schéma et migrations sous `/migration`.
- `next.config.mjs` embarque la liste exacte `{name, checksum}` des migrations dans le build.
- `/api/health` exige leur application achevée avec bon hash ; migration manquante/échouée/drift → 503.
- Predeploy : `node /migration/node_modules/prisma/build/index.js migrate deploy --schema /migration/prisma/schema.prisma`.
- Railway health `/api/health`, timeout 120 s.
- Contrat versionné `apps/web/deployment-contract.json`, **appliqué via API Railway** ; ce JSON n’est pas lu automatiquement par Railway.
- Railway a refusé l’ancien chemin `railwayConfigFile` car Config-as-Code déprécié ; pas de migration globale opportuniste d’infrastructure.
- Image réelle testée sur base isolée : 38 migrations → 503 ; CLI embarquée → 39 migrations → 200 ; rejeu sans mutation.
- Production : hook terminé 15:40:02 avant serveur Ready 15:40:16 ; preuve archivée.

La prochaine migration EasyCruit doit démontrer ce même ordre par déploiement normal. Conserver migrations backward-compatible ; ce garde-fou ne rend pas magiquement une migration destructive sûre.

### Railway

Projet `0eae47d0-598d-4cf0-bb3f-b38921eafa7e`, environnement `e66b019c-d280-41dc-85d8-25ed86bdd101`.

| Service | Service ID | Dernier déploiement prouvé |
|---|---|---|
| aggregator | `203613c5-701f-4013-a2c0-66c8de147c34` | `9a21754f-730e-4598-88b6-e689464d52d3` |
| refresh | `ddc5dece-7865-4cfa-b71e-8d139e2e1ea5` | `96ea6fba-3331-497a-9336-eb3e37e6ebe9` |
| reconcile | `85d0e5ba-992a-467e-9ddd-0dc25be1d74c` | `46e82eb1-6e49-4b23-8baa-2cb1dc03a2b7` |
| web | `a2280bb1-36be-4e6a-8250-2acc2aef0a47` | `f07adaa6-3fb8-44c6-be6e-c41c02d8dea4` |

Tous SUCCESS sur `459da3a` au dernier contrôle. `railway-state.json` conserve commandes et pauses. Aggregator commande normale `sh apps/aggregator/start.sh`. Autodeploy main fonctionne : ne pas provoquer quatre déploiements redondants.

API privée locale : `python3 backups/observability-20260909/railway-api.py`, entrée stdin JSON `{query, variables}`. Ne jamais imprimer ses credentials.

Scripts existants de run ciblé : `validate-ganni-railway.py`, précédents Harri/Coty. Ils modifient/restaurent la commande et capturent le run réel ; relire et adapter les assertions. Une commande CLI avec argument inconnu est désormais refusée avant réseau/BDD. **Toujours vérifier le scope explicitement** ; un run global involontaire a eu lieu sur une copie locale dans ce chantier, raison du garde-fou livré.

### Bases et wrappers

```sh
# Mesures production, imposer aussi une transaction SQL READ ONLY dans le script
python3 backups/remediation-20260908/run.py readonly COMMANDE...
# Mutations production autorisées, seulement après preuves/revue
python3 backups/remediation-20260908/run.py prod COMMANDE...
# Tests destructifs : base de test dédiée UNIQUEMENT
python3 backups/remediation-20260908/run.py test COMMANDE...
# Copie locale de production
python3 backups/lot4-20260909/run-local.py COMMANDE...
```

Les wrappers sont privés/ignorés. Ne pas les copier dans un rapport public ; ne pas afficher DATABASE_URL ou tokens. Ne jamais supposer que le nom `readonly` remplace `SET TRANSACTION READ ONLY`.

Clone : conteneur `catwalks-lot4-replay-pg18`, PG18, boucle locale port 32768 ; BDD `catwalks_lot4_replay_20260909`, utilisateur `catwalks_lot4`. Les accès sont dans les fichiers privés `local-access.json`, `local-pg.env`.

- Ce clone inclut réparations GANNI et retrait Lindex local. Les nouveaux IDs GANNI y diffèrent de ceux en production.
- BDD forensique `catwalks_lot4_replay_scope_interrupted` conservée ; ne pas la supprimer.
- Base isolée `catwalks_schema_gate_test` pour la preuve migration, 39 migrations.
- Conteneur web test `catwalks-schema-gate-web`, image `catwalks-web-schema-gate`, prouve PR 53, **ne contient pas EasyCruit**.
- Des services Docker d’autres projets sont présents. Ne pas faire de `docker system prune`, suppression de volumes ou arrêt global.
- Node local 26.7, CI/prod 22 ; vérifier CI avant livraison. `rg` absent, employer `git grep` ou Python ciblé.
- Les traces peuvent être volumineuses ; lire des résumés/agrégats. Certains HTML bruts contiennent contacts ou clés embed publiques, à garder privés.

### Sauvegardes

Sous `backups/lot4-20260909/`, ne pas écraser :

| Sauvegarde | Octets | SHA256 |
|---|---:|---|
| `before-lot4-production.dump` | 382946199 | `ff67432261c9f120c34a6bc2a41a406bcb323ce90f25d78f2c87a6a0bdca53f1` |
| `before-withdrawal-production.dump` | 383990724 | `69a93e30f992a2c5fb6df2ee9bbddf7a9882390b2fab373d3f8488082a089ade` |
| `before-harri-production.dump` | 385199683 | `75089884d3b384cb62d92caa203bcf5ab566f186d2210bd6109161ccbf70c6f5` |
| `before-ganni-production.dump` | 385549483 | `94e0e38602e18a1798b61c8543a71375b34a1e9ca553aa592e8cdce54a5d0a7f` |

Une sauvegarde **before-lindex-production.dump** a été lancée avant la demande d’arrêt. Son état final est indiqué dans l’addendum de fin et dans `lindex-backup-proof.json` / `lindex-backup.log`. Ne pas considérer un dump partiel comme valide ; vérifier fin du processus, hash et lisibilité avant mutation.

Les preuves privées et copies BDD ne sont **pas dans Git**. Une autre IA sur ce même Mac peut les utiliser ; si la reprise se fait ailleurs, transférer les artefacts nécessaires par un canal approprié. Le seul dépôt Git ne contient pas les RAW et wrappers privés. Ce document ne contient aucun secret d’accès.

## 10. Ordre recommandé pour terminer le LOT 4

1. **Relever l’état de reprise**, préserver le working tree, vérifier main/Railway/pause et sauvegardes. Lire les preuves avant de réexécuter une mutation.
2. **Terminer EasyCruit/Lindex**, procédure détaillée § 4, avec métriques jusqu’au front en production. Valider CLDR v2 dans le même lot cohérent.
3. **Corriger le tracker de qualification** : ne plus confondre recherche incomplète, identité déjà prouvée, source active et complétude mondiale. Recomposer toutes les passes, intégrer reçus Harri/GANNI/EasyCruit.
4. **Résoudre les sources d’identité erronée / faux contenus** : Sport 1, OTB, Aptar, Personio/Jako/KENT avec preuves propres à chaque cas, sans fusions arbitraires.
5. **Finir les 115 investigations arrêtées**, puis les dossiers toujours sans site/portail : moteur de recherche, pages officielles, portfolios, pays/langues et portails régionaux. Un simple échec HTTP ou homepage sans lien ne suffit pas.
6. **Terminer les 38 dossiers de complétude** avec adaptation de protocole lorsque nécessaire, détails/RAW et comparaison indépendante des IDs ; ne pas valider sur quelques exemples.
7. **Traiter multi-localisations, préfixes géographiques et qualité SEO/dates**, sans sacrifier la visibilité des données encore ambiguës.
8. **Intégrer/qualifier la discovery proactive** au-delà des 1 653, portefeuilles et acteurs des quinze verticales ; relations parent/licence/franchise exactes ; France et monde.
9. **Lancer seulement alors la passe complète sur les sources validées**, sous observabilité durable ; mesurer découvertes, parsées, rejetées, normalisées, enregistrées, actives, visibles. Ne pas simplement enlever PIPELINE_PAUSED pour « voir ».
10. **Audit final réel** : employeur, métier, contrats, secteurs, pays/villes, dates, statut, doublons/reposts, source/front, comptes par pays, pertes de pipeline, erreurs et offre fantôme.
11. **Livrable final** : tracker acteur par acteur, bilan des seize critères de sortie du brief, métriques chiffrées datées, écarts expliqués, `Finding | Fixé ? | Commit | Main ? | Déployé ? | Données réparées ? | Preuve prod`.

**NO-GO actuel pour clôture du LOT 4 et reprise mondiale aveugle.** Les corrections livrées sont réelles et prouvées, mais la qualification exhaustive des acteurs/sources et la passe globale contrôlée restent à faire. Ne pas présenter un taux de flux complets comme un taux de couverture mondiale du marché.

## 11. Prompt de reprise prêt à transmettre

> Reprends le chantier Catwalks dans `/Users/lmelane/Downloads/catwalks-job-aggregator`. Lis `HANDOFF_LOT4_2026-09-09.md` puis `audits/2026-09-09/lot4-world-coverage/brief.md`. Le LOT 4 est incomplet. Le working tree contient EasyCruit et CLDR v2 non commités ; ne les écrase pas. La production est prouvée sur main 459da3a, les workers mondiaux restent pausés. Lindex a seulement été retiré sur la copie locale : aucune réparation Lindex en production ni ingestion EasyCruit n’a été faite. Termine la qualification et le cycle de preuves de ce lot, puis poursuis les priorités du handoff. FashionJobs sert uniquement à découvrir les acteurs, jamais à collecter ses offres. Préserve RAW/IDs/historiques, ne force ni dates ni identité ni pays, et distingue code local, main, déploiement et données réparées. Tu as l’autorisation de corriger, tester, merger et déployer selon la procédure prouvée, sans réactiver l’ingestion mondiale avant qualification.

## 12. Addendum de fin — arrêt confirmé

- Vérification finale : 2026-09-09T16:02:13.036812+00:00 (UTC).
- La recherche `portal-unvisited` est arrêtée ; aucun processus de cette passe ne reste actif. Les 115 entrées à reprendre sont enregistrées, dont les deux interrompues.
- La sauvegarde lancée avant l’arrêt est **terminée** : `before-lindex-production.dump`, **385839634 octets**, SHA256 **`7d7a64e8603ae9c83012749a22cb196e4e3e6eb8b6325cbcc2fbfe3f46263bb7`**. `pg_restore --list` réussit ; inventaire dans `lindex-backup-contents.txt`. Cela valide sa lisibilité, pas encore une restauration complète de ce dernier dump.
- Aucun run mondial, nouveau déploiement, merge ou mutation Lindex de production n’a été lancé à l’arrêt. Les workers Railway restent dans l’état de pause indiqué plus haut.
- Les bases et conteneurs locaux de validation sont conservés pour la reprise ; ils ne constituent pas une ingestion en cours. Les services d’autres projets n’ont pas été touchés.
- Ce handoff est un **fichier local non commité**. Le commit local antérieur `d3ab692` et les modifications EasyCruit/CLDR sont laissés en place.

## 13. Addendum de reprise — Lindex / EasyCruit livré en production (2026-09-09, 16:05–16:40 UTC)

- **Code mergé** : PR 54 → `origin/main` = `68cbc4a15474f770a28928ae884bffe023157aa9` (app `acab2ba`). Quatre services Railway SUCCESS sur ce commit ; **migration 40 (`20260909234000_easycruit`) appliquée par le predeploy**, `/api/health` 200. Commande normale de l'aggregator restaurée ; **`PIPELINE_PAUSED=1` toujours en place sur les trois workers**.
- **Production réparée** : `lindex` RETIRED (15 opérations, rejeu 0, patches = clone) ; `lindex-easycruit` ACTIVE (41 ids, 7 alias source-scopés, identité `OFFICIAL_LINK`, secteur FASHION, société Lindex → BRAND) ; run borné `3cda97b7-0ef3-4c5b-91ca-5579ea8daa66` : 41 créées, 0 erreur. **Après : 77 447 offres, 74 198 actives, 10 957 France, 77 406 ids conservés.** Preuves publiques dans `audits/2026-09-09/lot4-world-coverage/easycruit-lindex.md` + `lindex-*.json` ; privées dans `backups/lot4-20260909/lindex-*`.
- **Corrections universelles livrées avec ce lot** : CLDR v2 (variantes officielles de pays) ; vocabulaire d'emploi nordique/balte/tchèque dans `normalize/employment.ts` (26 tests). 1 630 unitaires, 249 intégration, 98 web, typecheck 0.
- **Commit docs `docs(audit): prove Lindex…` poussé sur la branche, PR 55 ouverte et volontairement NON mergée** (docs seuls : éviter quatre redéploiements). À merger avec le prochain lot applicatif.
- **Le clone `catwalks_lot4_replay_20260909` a divergé de la production** : il contient trois passes d'ingestion Lindex locales (ids différents de la prod) ; restaurer `before-lindex-production.dump` ou faire un nouveau dump avant tout prochain chantier de mutation.
- Observations à reprendre dans les lots suivants (pas corrigées ici) : `Location` EasyCruit porte parfois un comté norvégien ou un centre commercial → `city` ; une offre « Vikariat »/« Fast » sans `employmentTerm` (contradiction, D54) ; aucune date de publication native → pas de `JobPosting` Lindex.
- Prochaine étape recommandée : § 10, point 3 (tracker) puis point 4 (Sport 1 : retrait du faux tenant + candidat ReachMee documenté à zéro en DRAFT ; OTB ; Aptar ; Personio/Jako/KENT).

## 14. Addendum — tracker v3 et Sport 1 livrés (2026-09-09, 16:42–17:12 UTC)

- **Tracker v3** (`apps/aggregator/src/coverage/qualify-tracker.py`, PR 55 mergée → `main 743f51d`) : sept verdicts séparés par acteur et par source ; note `tracker-qualification.md`, CSV publics dans `audits/…/tracker-v3/`. Mesuré : 14 identités attestées (0 affichées avant), 6 portails confirmés, 238 acteurs à source active, 2 614 URLs non visitées sur 137 acteurs, 10 configurations de source certifiées vs 413 actives héritées sans revue, 357/423 complets au dernier reçu vs 383 « un jour » (26 régressées, listées).
- **Sport 1** : sauvegarde fraîche `before-sport1-production.dump` (386 262 256 o, SHA `469c90f1…73bf`) restaurée dans `catwalks_lot4_replay_20260909c` (wrapper `run-local-c.py`), retrait répété puis appliqué en prod (23 opérations, rejeu 0, 0 `closedAt`), portail ReachMee documenté sur la société sans activation. **Prod après : 77 447 offres, 74 187 actives, 10 957 France.** Note `sport1-reachmee.md`.
- **Backlog qualité** : `backlog-data-quality.md` (Lindex L1–L4, Sport 1 S1–S2) avec témoins et critères.
- **Web non redéployé sur `743f51d`** (watch paths ; diff vide sur `apps/web`/`packages/db`) : normal. Les scripts de prod acceptent désormais un service resté sur un ancêtre si son périmètre n'a pas changé.
- Restent : OTB (`maison-margiela`), Aptar, Personio/Jako/KENT, 115 investigations interrompues, 38 dossiers de complétude (+ les 26 régressées à instruire), discovery portefeuilles. Workers toujours `PIPELINE_PAUSED=1`.

## 15. Addendum — OTB/Aptar, Personio/Jako/KENT, réconciliation complétude (2026-09-09, 17:20–17:50 UTC)

- **Code mergé** : PR 56 → `main 772ee8d` (adaptateur SuccessFactors : propriétés du site carrière archivées + `brandProperty` opt-in ; plan propriétaire de portail : attribution par offre `postings`, `configPatch`, invariant par offre, `SourceObservation` ; CI web durcie contre le « Hash Sum mismatch » du dépôt apt Chrome). Workers SUCCESS sur `772ee8d` ; **web volontairement non redéployé** (watch paths ; diff vide sur `apps/web`, `packages/db`, `package.json`, `package-lock.json` — contrôle codé dans les scripts de prod).
- **OTB / Aptar en prod** : sauvegarde `before-otb-aptar-production.dump` (386 430 658 o, SHA `190d01e5…9ef198`) restaurée dans `catwalks_lot4_replay_20260909d` (`run-local-d.py`) ; plan 735 opérations, rejeu 0 ; alias, identités, promotion, secteur ; run borné `3c2306b5…` : 153 + 215 lues, 8 + 7 créées, 0 erreur. Employeurs après run : Diesel 85, Maison Margiela 25, OTB 17, Marni 14, Jil Sander 11, Staff International 4, Brave Kid 1, Aptar Group 224 ; parité API = base pour les huit.
- **Personio en prod** : 5 homonymes séparés (`REVIEWED_` : Mateo Estate GmbH, Pina Technologies GmbH, Samson & Partner, KENT Europe GmbH, Hades Resources GmbH) + 3 retraits revus (giga, atlantis, jako) ; 57 offres retirées, 0 fermeture ; 57 témoins en 410. 14 variantes juridiques classées, aucune mutation.
- **Complétude** : 385 → 357 = 2 sources retirées (ganni, lindex) + **26 faux positifs** (reçu le plus récent à l'horloge issu d'une révision de code plus ancienne) ; tracker corrigé (ordre par révision puis date) → 0 régression ; liste unique = **les 38 dossiers précédents**, 2 résolus (capri-jimmy-choo, lagardere-duty-free). `tracker-v3/completeness-to-investigate.csv`.
- **Prod après** (photographie 17:5x UTC) : 77 462 offres, 74 157 actives, 10 961 France ; 414 sources ACTIVE, 12 certifiées pour leur configuration courante ; tracker v4 : 20 identités attestées, 12 portails confirmés.
- **Discovery** : reprise des 115 investigations lancée (`portal-unvisited-resume`, mode known, en cours) ; 2 614 URLs non visitées = 2 302 distinctes, 177 hôtes, 1 191 clés hôte+chemin — 31 hôtes partagés par plusieurs acteurs (lvmh.com 142 URLs / 3 acteurs, welcometothejungle.com 92 / 11, careers.richemont.com 72 / 5…). À dédupliquer par hôte en gardant la provenance avant toute passe.
- Clone d à considérer comme divergé après les rehearsals (OTB/Aptar + Personio + 2 ingestions).

## 16. Addendum — exécution parallèle, persistante et reprenable (2026-09-09, 18:00–18:15 UTC)

- **Outils** (`apps/aggregator/src/coverage/`) : `orchestrate.py` (plan JSON → étapes sondes/recherches en parallèle, état après chaque tâche, reprise `--resume`, requêtes évitées quand l'adaptateur du kind n'a pas changé depuis la révision du reçu, métriques par étape) ; `dedup-unvisited.py` (2 614 URLs → 177 hôtes, provenance) ; `compose-portfolio-input.py` (341 observations de portefeuilles → 113 sujets avec domaine connu, 212 « site officiel à trouver », 16 en base sans domaine) ; `qualify-candidates.mts` (chaque tenant ATS détecté est sondé une fois par le vrai adaptateur : 283 tenants distincts, 54 déjà au catalogue, 229 nouveaux ; état `candidates-qualification/candidates.jsonl`) ; `candidates-review-sheet.py` (fiche de revue métier) ; `metrics-summary.py` (temps par étape depuis les artefacts).
- **Corrections communes livrées** : DigitalRecruiters (PR 58, 4 sources, prod ré-attestée), Talentsoft ids RSS + iCIMS nombre de pages (PR 59, mergée `main`, run prod à faire après reçu à la révision mergée : sondes en cours `source-probes-current`).
- **Recherches** : 115 reprises terminées ; 177 hôtes dédupliqués terminés (145 ATS candidats, 21 liens, 6 sans lien, 3 sites à chercher, 2 interrompus) ; 113 portefeuilles en cours ; re-sondage des 38 dossiers 30/38 puis orchestration par famille d'ATS (`orchestration-plan-probes.json`).
- **Règle** : les activations et mutations de production restent conditionnées aux preuves (revue d'identité, énumération native, plan comparé au clone).

## 17. Addendum — corrections communes par famille et automatisation (2026-09-09, 18:15–18:35 UTC)

- **Mergé sur `main`** : PR 58 (DigitalRecruiters), PR 59 (Talentsoft ids RSS + iCIMS pages + orchestrateur), PR 60 (Rituals union des locales, Phenom lecture jusqu'au total, connecteur générique avec preuve sur ses trois chemins, tracker v5, qualification des candidats). Chaque merge redéploie les workers ; le web reste sur `68cbc4a` (diff vide sur son périmètre, contrôlé).
- **Production** : run borné DigitalRecruiters fait (4 sources, 0 erreur, diffusions en RAW) ; run borné Talentsoft/iCIMS (`lagardere-travel-retail`, `lagardere-duty-free`, `urbn-hub`, `urbn-stores`, `aeropostale`) en cours à l'arrêt de cet addendum — la restauration de la commande normale n'est déclenchée qu'à la fin réelle du run (`ts-icims-wait-restore.log`).
- **Complétude** : 394 / 423 prouvées, 27 dossiers restants (16 generic-listing dont 9 en page de départ sans listing ni sitemap, Nordstrom 1 307/1 309, Swatch 248/249, magnet ×2, taleo, wordpress, radancy, eqwa, altamira) ; Rituals et Foot Locker corrigés dans le code, à confirmer par reçu après la PR 60 (orchestrateur relancé automatiquement après le merge : `orchestration-probes-2.log`).
- **Discovery** : 283 tenants ATS distincts détectés ; **126 nouveaux lisibles avec 20 162 offres**, 26 vides, 77 échecs (404 = fausses détections surtout), 54 déjà au catalogue — fiche de revue métier `tracker-v5/candidates-review.csv` (identité, groupe/marque/franchise et périmètre restent à décider par revue ; aucune activation faite). Portefeuilles : 113 recherchés (38 ATS candidats, 55 sites à chercher) ; 212 marques de portefeuilles sans domaine officiel connu restent à trouver (recherche web nominative, pas de gabarit d'URL).
- **Lagardère L5** : 21 représentations fantômes actives (URLs hors board) en prod avant le run corrigé ; `postingMerges` les refuse par construction (deux externalId d'une même source) ; sortie par le refresh à sa reprise, ou plan de retrait au niveau offre à concevoir.

## 18. Addendum — incident de run, URBN, garde de déploiement (2026-09-09, 18:35–19:25 UTC)

- **Incident** : le merge de la PR 60 a déployé l'aggregator pendant le run borné Talentsoft/iCIMS → conteneur arrêté 18:35:11 UTC, `urbn-hub` interrompu en écriture (563/1 449), run resté `RUNNING`. Talentsoft prouvé avant l'arrêt (Lagardère 109/109, duty-free 9/9, Aéropostale 20). **Règle** : jamais de merge pendant un run borné — `deploy-guard.py` en tête de `merge-and-deploy.sh` ; SIGTERM → `INTERRUPTED` (PR 61).
- **URBN (PR 61 `c95327e` + application prod 19:20 UTC)** : `urbn-stores` ⊂ `urbn-hub` (970/970) → route retirée, 36 doublons fusionnés (redirection, témoins RAW) ; marques créditées d'après le JSON-LD `hiringOrganization` de chaque page (opt-in `employerFromJobPosting`) : Anthropologie 465, Free People 392, Urban Outfitters 325, URBN 153, Terrain 41, Menus and Venues 38, Nuuly 35 ; 11 alias, certification `OFFICIAL_DOMAIN`, promotion, secteurs, parité publique OK. Décisions laissées à Loïc : FP Movement / Anthro Weddings / Maeve rattachés à la marque mère (réversible par alias) ; Reclectic (16) et Menus and Venues (38) : identité/périmètre ; 1 offre tenue sous URBN car aussi attestée par la collecte FashionJobs héritée.
- **Complétude après PR 60** : 395/423, 26 restants (Foot Locker 2 839/2 850 board épuisé avant le total ; PVH 1 374/1 440 ; Workday −1 Nordstrom/Swatch ; générique 15 ; magnet ×2 ; taleo, wordpress, radancy, eqwa, altamira). Prochaine correction commune candidate : preuves d'énumération Workday (34 sources actives, aucune preuve de page aujourd'hui).
- **En cours à la rédaction** : run borné `urbn-hub` (`validate-urbn-hub-railway.py`, chaîne `urbn-hub-run-chain.log`) avec la commande normale restaurée à la fin réelle du run.
- **Run borné `urbn-hub` (19:24 → 19:35 UTC, commit `c95327e`)** : `SourceRun` OK, 1 374/1 374 complet, 0 erreur, 0 refus d'écriture, 10 créées / 1 364 ré-attestées ; commande normale restaurée (`143e6fd2`). Preuves : PR 62 (`audits/…/urbn/`). Périmètre actif : 422 sources après le retrait de `urbn-stores`.
- **PR 62** (preuves URBN, docs) et **PR 63** (preuve d'énumération Workday : pages, ids répétés, lignes sans chemin) mergées et déployées ; **PR 64** ouverte (lignes sans `externalPath` = `rejectedRows`, Nordstrom 1 312/1 312 lignes, 3 rejetées, 1 309 offres) — **à merger seulement après la fin du run borné en cours** (garde).
- **Run borné « familles corrigées » en cours** (commit `c3f2014`, `lot4-families-production-validation`) : `rituals`, `kering`, `mango`, `capri-michael-kors`, `capri-jimmy-choo`, `nordstrom`, `swatch-group` — preuve en production des correctifs Rituals (union des locales), connecteur générique/Eightfold (Kering), Workday (Mango, Capri, Nordstrom). Chaîne `families-run-chain.log`, restauration de la commande normale à la fin réelle du run.
- Swatch (265/267) : adaptateur `swatchgroup`, 2 détails non parsés → dossier ouvert (critère : rejets explicités).
- **Run borné familles (19:47 → 19:55 UTC, `c3f2014`)** : Rituals **1 123/1 123 complet, 0 erreur** ; Capri MK 512 complet ; Mango 1 627/1 628 ; Nordstrom 1 303/1 312 ; Kering 1 030/1 031 ; Swatch 61 (effondrement : pager arrêté tôt, purge refusée par la garde d'attestation). **178 refus d'écriture, tous `EmployerIdentityReviewRequired` sur des annonces NOUVELLES à libellé d'entité juridique** (Nordstrom Inc 107, Mango ×9 entités 57, Michael Kors ×4 7, J Choo 1) + 6 Kering (libellé maison → groupe refusé, voulu). Constat : les sources non certifiées ne peuvent plus créer d'offres → lot suivant = alias source-scopés dérivés des décisions D45 (entités RATTACHÉES) + règle « nom de marque + forme juridique = la marque », mesure d'ampleur dans `review-required-scale.json`. Dossier `families-bounded-run.md`.
- **PR 64** (Workday lignes sans chemin rejetées, Phenom ids répétés nommés, Swatch détails rejetés) mergée `f10c989`, déploiement en cours ; ensuite re-sondage local nordstrom / foot-locker-france / swatch-group / pvh / boots / nars / end-clothing puis réconciliation (tracker v6).
- **Sitemaps trouvés pour 5 sources génériques en page de départ** (oniverse 735 URLs, psycho-bunny 153, oska 35, bevilles 23, alberto 6) : qualification locale en cours (`generic-sitemap-qualification.json`) → patch de config `sitemapUrl` + run borné à prévoir ; attaquer, lumentee, kastner-oehler, marc-o-polo : pas de sitemap d'offres exploitable (page unique / boutique).
- **PR 66 mergée `3e44e4b`** : lignes rejetées = témoins (PVH/Boots/NARS/End complets), `<loc>` décodés (Oniverse 483 offres au lieu de 21 en local), preuve Eightfold (Kering 1 033/1 033). **Réconciliation : 399/423**, 22 restants (Foot Locker : 11 ids répétés nommés ; Swatch : 1 fiche rejetée ; Nordstrom re-sondage en cours ; génériques en page de départ ; magnet ×2, taleo, wordpress, eqwa, altamira, pandora).
- **Lot alias d'entités juridiques** (`legal-entity-aliases-review.json`) : 16/17 paires décidables sans nouvelle décision (règle A clé canonique = marque : Nordstrom Inc, MANGO FRANCE…, Michael Kors Retail Inc ; règle B lignes du référentiel D45 de Loïc rattachées au domaine officiel : MANGO MNG, MNG-MANGO U.K., Michael Kors (USA)/(Canada)/(Bucharest), J Choo) ; **Kering (6, libellé maison → groupe) reste en revue propriétaire**. Sauvegarde fraîche `before-aliases-production.dump` prise ; clone d en restauration ; application `legal-entity-aliases-apply.mts` clone → prod, puis run borné nordstrom/mango/capri.
- **Patch sitemap** (`sitemap-config-patch.mts`) pour oniverse, psycho-bunny, oska, bevilles, alberto : même cycle clone → prod → run borné.

- **20:22 UTC — instruction de Loïc : « kill le CRON à la production tant que l'application n'est pas production-ready »** → les trois crons (aggregator `0 22 * * *`, refresh `0 2 * * *`, reconcile `0 3 * * 1`) sont gelés sur `0 0 29 2 *` (mutation relue, `crons-frozen-20260909.json`), `PIPELINE_PAUSED=1` conservé. Seuls les runs bornés manuels du protocole de preuve continuent.
- **Run borné alias + sitemaps (20:26 → 20:36 UTC)** : Nordstrom **+108 créées, 0 refus d'identité** ; Mango +56 ; Capri +8 ; Oniverse 20 → 522 actives ; Psycho Bunny 10 → 165 ; Oska 7 → 35 ; Bevilles 23/23 ; Alberto complet. Actives **74 255 → 75 010**. Défaut trouvé : les lignes rejetées comptées comme erreurs (statut DEGRADED + droit d'attester retiré) → corrigé (`pipeline/rejectedRows.ts`, PR 67). Restes : Oniverse 14 pages en échec ; Mango 27 / Nordstrom 2 annonces retenues sans employeur dans le détail (backlog M1, décision de modèle) ; Kering K1.
- **Tracker v6** (`tracker-v6/`) : 75 010 actives, identités attestées 21, portails confirmés 13, flux tous complets 170 acteurs / 73 partiels, couverture mondiale `NOT_PROVEN` partout, 400/423 sources prouvées, 400 actives `LEGACY_UNCERTIFIED`.
- **Estimation d'avancement communiquée à Loïc : ~65 % du LOT 4** (complétude technique ~95 %, réparations 9 lots, certification d'identité ~5 %, discovery ~60 %, passe complète + audit final 0 %).
- **Dimensionnement du lot alias (lecture seule, `legacy-labels-sizing.json`)** : les observations d'employeur n'existent que pour les sources passées en run borné depuis la porte (5 sources : kering, mango, capri ×2, swatch) → **l'ampleur sur les 400 sources legacy ne se mesure qu'en les faisant tourner**. Boucle à industrialiser, famille ATS par famille : run borné de la famille → observations `REVIEW_REQUIRED` → dérivation règles A/B (`legal-entity-aliases-review.mts`) → application (clone → prod) → re-run de preuve ; les libellés hors règles (marques distinctes d'un portail groupe, homonymes) vont en revue propriétaire.

## 19. Addendum — cadrage du soir (Loïc) : qualification sur preuves archivées, crons gelés, aucune ingestion

- **Cinq dimensions séparées** (`proof-dimensions.py`, `proof-dimensions.md`, `tracker-v7/`) : identité certifiée 13 · énumération démontrée 385 · **collecte complète 377** (une ligne rejetée reste dans l'écart) · détails complets 243 · ingestion en phase 162 · visibilité prouvée 1 → les cinq : 0. Déficits non expliqués : aigle, gant, lacoste (DR, reçus anciens).
- **PR 68** (`feat(identity)`) : libellé de groupe → Maison conservée (`GROUP_LABEL_KEPT_HOUSE`) ; `SourceIdentityReview.portalScope` + employeur déduit du périmètre certifié `SINGLE_BRAND` (provenance distincte, jamais multimarque) ; sous-libellés distincts avec relation attestée enregistrée (le parent en base reste un GROUPE canonique) ; alt « Logo » Workday nettoyé.
- **Rejeu hors ligne** (`offline-identity-replay.mts`, 410 charges archivées, lecture seule) : 83 libellés / 55 sources / 13 959 annonces refusés pour une nouvelle annonce ; classement `refused-labels-classified.json` + fiche `tracker-v7/refused-labels-review.csv` (A 16, A-qualificatif, B 3, Logo 7, marque distincte 14, revue propriétaire 24).
- **Lots de données** (sauvegarde `before-qualification-production.dump`, clone d) : URBN v2 (FP Movement / Anthro Weddings / Maeve distincts, 174 offres, alias re-pointés), alias v2 (règles A/A-qualificatif/B). Aptar mesuré (Beauty 88 / Pharma 85 / indéterminé 47), Reclectic non qualifié officiellement, Menus & Venues officiel.
- **Liste des contrôles nécessitant une lecture actuelle ou une ingestion bornée** : `final-validation-controls.md` (A1–A6 lectures, B1–B6 ingestions bornées dont la passe complète, C1–C3 contrôles publics, D décisions).
- **PR 69** (`supersedesAliasId`, photographie d'identité allégée — Ulta 10 289 offres débordait le moteur) et **PR 70** (la Maison est conservée même sans observation antérieure ; Kering : 5/6 gardent leur Maison hors ligne, « Kering Corporate » sans groupe enregistré → K1). Répétition sur clone d des lots : URBN v2 (206 opérations, 3 alias supplantés, re-certification MULTI_BRAND, actif) et alias v2 (27 alias, 12 pages officielles, 5 libellés sans page lisible restent en revue). Application production après le déploiement de la PR 70 (`qualification-production-apply.sh <horodatage sauvegarde>`).
- **Production (21:38 UTC, commit `8c29b96`)** : URBN v2 appliqué (206 opérations, rejeu 0 ; FP Movement 143 · Anthro Weddings 25 · Maeve 6 en sociétés distinctes, alias supplantés, re-certification `MULTI_BRAND`, source active, secteurs posés) ; alias v2 : **27 alias écrits** (Ulta Beauty, Inc. 9 990 offres bloquées à la création, NIKE ×7, NORMAL ×10, The RealReal, UNIQLO, Vlisco, Brunello Cucinelli, Stella McCartney, Passage du désir, Intersport, Kicks, ELC), rejeu 0 ; 5 libellés sans page officielle lisible (New Balance, Swarovski ×3, Versace) restent en revue. Offres actives inchangées : 75 010. Preuves : `qualification-evening/`.
- **Pré-tri des 152 tenants candidats lisibles** (`tracker-v7/candidates-prescreen.csv`, artefacts archivés) : 32 tenants avec lien réciproque depuis une page de l'acteur (12 031 offres), 120 avec pages d'acteur lues sans lien (8 131) — revue nominative.

## 20. 2026-09-10 — qualification A1–A6 et corrections prouvées (sans ingestion)

- **Lu** : `audits/2026-09-09/lot4-world-coverage/qualification-2026-09-10.md` (tout y est, avec les preuves `qualification-0910/` et les tableaux `tracker-v8/`).
- **État prod (07:03 UTC)** : 74 853 offres actives, 407 sources ACTIVE / 8 PAUSED / 88 RETIRED, 137 alias, périmètres certifiés mango SINGLE_BRAND, urbn-hub / drunk-elephant-2 / dr-pierre-ricaud MULTI_BRAND ; crons gelés ; aucun run.
- **Scripts du jour** (`backups/lot4-20260909/`) : `mango-certify.mts`, `kering-corporate-apply.mts`, `urbn-reclectic-{review,apply,aliases}.mts`, `group-portals-{review,apply}.mts`, `misbound-withdrawal.mts`, `aliases-v3-apply.mts`, `aliases-v3b-vca.mts`, `recertify-0910.mts`, `alias-evidence-research.mts` + `alias-evidence-portal-render.mts`, `portfolio-official-sites.mts`, `aptar-perimeter-sheet.mts`, `refused-labels-status.mts`, chaînes `qualification-0910-{clone-rehearsal,production-apply,production-chain}.sh`, sauvegarde `backup-0910.py` / `restore-0910-clone.py` (clone d = état d'avant la passe, renommé `_pre_0910`).
- **Pièges rencontrés** : `$P` non découpé en zsh (127) → commandes explicites ; comparaison clone/prod des plans de retrait : neutraliser `withdrawnAt` et l'horodatage des notes ; `recordSourceIdentityReview` exige une page de preuve sur le domaine officiel (Mango : `jobs.mango.com`, pas mangofashiongroup.com) ; les revues propriétaire mettent la source en PAUSED → re-certifier + promouvoir (`recertify-0910.mts`) ; `configHash` des reçus = `JSON.stringify(config)` (ordre d'insertion), aligné dans `proof-dimensions.py`.
- **Prochain** : décisions de Loïc (§11 du dossier), correctifs pagers/Workday répétés, puis runs bornés B1–B5, B6, C1–C3.

## 21. 2026-09-10 (second brief) — pagers/Workday, lots bornés B1–B5 + L6/L7, certifications, Tapestry partitionné

- **Lu** : `audits/2026-09-09/lot4-world-coverage/qualification-2026-09-10-b.md` (§1–§3 les trois vérifications, §4 correctifs pagers, §5 décisions de périmètre appliquées, §5 bis candidats + périmètre B6 hors ligne, §6 contenu B5, §7 résultats lot par lot) et les preuves `qualification-0910b/`.
- **Code (main, déployé)** : PR 74 (logo alt), **PR 75** (règle de porte `CERTIFIED_SINGLE_BRAND_PORTAL` ; Workday lignes sans chemin dédoublonnées par contenu ; **preuve employeur = marque nettoyée** `LOGO_ALT_WORD_REMOVED` ; **règle de convergence** : une nouvelle orthographe égale au nom canonique du détenteur n'est pas un changement d'identité), **PR 76** (`partitionFacet` Workday : un tableau par valeur de facette + résiduel, marque = valeur de facette `PARTITION_FACET_VALUE`, plafond `PUBLISHER_TOTAL_CAPPED`, tests sur fixtures réelles Tapestry). Tests unitaires 1 692 verts.
- **Production, dans l'ordre** : lot 2 de périmètre 07:47 (Tricoci, retraits MaryRuth's/Çalık, Printful, L'Occitane GROUP, Beiersdorf, 21 certifications + scope-fix 11) → **L1** mango/kering/urbn-hub 07:50 (0 échec) → **L2** 18 petits portails 08:05 (215 refus instruits) → **L3** 7 portails de groupe 08:18 (136 refus « Logo » + 46 Tapestry) → **lot 3** 08:42 (Mango 26 fusions / 353 offres, alias v4, Tricoci fidèle) → PR 75 → **L4** B5 08:53 (0 échec d'écriture, oniverse non prouvée : 16 pages illisibles depuis la prod) → **L5** recheck 09:04 (COMPLETED, 0 refus, Mango 1 627/1 628 complet) → certifications seconde passe 09:09 (7 : etam, loccitane-fr, l-occitane-en-provence-2, luhta, typology SINGLE via CGV « Good Brands SAS », new-balance, showroomprive ; versace/swarovski exclues) → PR 76 → `partitionFacet=Brand` + re-certification Tapestry 09:11 → **L6** 09:12 (sources « Logo » 0 refus ; Tapestry 2 091 lues, 1 769 refus attendus = changement d'identité Tapestry, Inc. → Coach/Kate Spade) → **alias v6** Tapestry (Coach / Kate Spade / Tapestry par facette, kinds GROUP/BRAND) → **L7** tapestry.
- **Pièges du jour** : `deploy-guard` refuse pendant les ~60 s où la restauration de la commande normale redéploie (lot 3 avorté sans mutation, chaîne post-L5 idem) → boucle d'attente de garde verte avant tout merge ; `beforeEach(() => mock.mockReset())` renvoie le mock, que vitest **appelle comme hook de nettoyage** (`{ … }`) ; une copie non suivie d'un fichier qui arrive par `origin/main` bloque le fast-forward (`merge-and-deploy` a fusionné la PR mais pas avancé le tree local) ; le `total` Workday peut être un plafond (2 000) et une page servie au-delà **n'est pas** une preuve de plafond (mêmes lignes resservies) — seule la partition le prouve ; l'empreinte de source couvre la config → toute modification de config ré-émet la certification.
- **Reste** (décisions Loïc) : Menus & Venues, Aptar par offre (mécanisme d'exclusion à l'ingestion avant B6), Saks Global / NMG, versace & swarovski (capture officielle), périmètre B6 (33 tenants avec lien réciproque archivé, 5 340 offres ; New Balance Phenom global), coquilles d'entités Coach/Tapestry après L7, Eightfold second balayage (Kering 1 025/1 026), pandora détails, dfs/damiani pays.
