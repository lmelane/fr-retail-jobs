# Lindex / EasyCruit — correction livrée et prouvée

État au 9 septembre 2026 (reprise du LOT 4 après l'arrêt de 18 h). Ce point de contrôle ne clôture pas le Lot 4 : il livre une source officielle de plus, retire un faux contenu, et corrige deux défauts universels trouvés en la mesurant.

## État avant et cause racine

La production conserve 77 406 offres, dont 74 164 actives et 10 957 classées France (photographie lecture seule du 9 septembre, 16:18 UTC, hash d'identifiants `637f03442f2896b223f823a89a6e9ce7`). La source `lindex` (Teamtailor, `lindex.teamtailor.com`) porte **sept annonces actives datées 2022/2024** : trois descriptions commerciales du logiciel Teamtailor, deux consignes de rédaction d'annonces, deux gabarits « OurCompany / Example Client ». Un tenant répondant sous un nom de marque avait été pris pour une source sans que sa relation avec le recrutement réel de la marque soit établie — le même défaut que GANNI.

La [page officielle des postes ouverts de Lindex](https://about.lindex.com/career/open-positions/) (archivée, SHA `d5b87f8a…72de`) rend ses offres depuis le tenant **EasyCruit `lindex.easycruit.com`** : son propre script `main.js` lit `https://lindex.easycruit.com/export/xml/vacancy/list.xml`, et la page lie `lindex.easycruit.com/career-center`. Le flux public expose **41 postes** en huit langues, publiés sous sept libellés d'employeur (Lindex, Lindex AS, Lindex Central Europe, Lindex Lithuania, Lindex Latvia, Lindex Eesti OÜ, Lindex Denmark). Aucun n'est en France.

## Correction générale

- Nouvel adaptateur **EasyCruit**, enregistré dans le registre commun (détection d'URL, catalogue, ingestion). Protocole documenté par l'éditeur : liste XML complète sans filtre, détail XML par poste, page publique native. XML strict (DOCTYPE/ENTITY refusés), identifiants et URLs natifs contrôlés dans le tenant, toutes les versions linguistiques conservées (une préférence de langue choisit l'affichage, jamais l'appartenance), coordonnées de département jamais transformées en pays d'offre, contacts inutiles exclus du RAW, doublons et détails invalides explicités sans perdre le poste listé.
- **Aucun compteur éditeur n'existe** : `declaredTotal` reste absent, la preuve décrit l'énumération complète du document XML (41 vacances, 41 identifiants uniques), pas une comparaison à un compteur inventé.
- **Aucune date de publication inventée** : le flux ne publie que des dates de campagne (`date_start`, `date_end`, `date_modified`), conservées en RAW. Conséquence assumée : aucun `JobPosting` n'est émis pour ces offres tant qu'aucune date de publication réelle n'existe (règle Google Jobs déjà en place).
- **Référentiel pays v2** : `Intl.DisplayNames` ne connaît que le nom préféré d'un pays, pas ses variantes officielles (`Česko` vs `Česká republika`). Les libellés alternatifs CLDR (`cldr-localenames-full@48.0.0`, épinglé et haché) sont importés comme données : 5 925 → 6 232 libellés, 38 langues, l'ambiguïté `Kongo` toujours préservée. Rejoué sur 72 139 offres archivées de 426 sources : **0 pays précédemment reconnu modifié**, 7 gains (dont les trois `Česká republika` de Lindex).
- **Vocabulaire d'emploi mondial** : 40 des 41 offres publiaient un contrat et un rythme structurés en norvégien, suédois, danois, tchèque, letton, lituanien ou estonien (« Fast », « Vikariat », « Tillsvidareanställning », « Nuolatinis », « Pastāvīgs darbs », « Tähtajatu », « Heltid », « Deltid », « Fuldtid », « Täiskoht », « Visas etatas », « Nepilna laika », « Plný úvazek », « HPP »…) et repartaient à `null`. Le dictionnaire du normaliseur est mondial (D53) : les mots sont ajoutés, jamais une règle par source. Les valeurs ambiguës (« Ekstrahjelp », « Ved behov », « Na smlouvu », « VPP ») restent `null` ; « fast » en anglais n'est pas un CDI. 26 tests ajoutés (RED puis GREEN).
- Les sept libellés natifs sont des **alias de marque de recrutement, source-scopés**, vers la société Lindex existante (classée BRAND sur preuve officielle) : la revue n'affirme ni identité juridique entre ces entités, ni groupe parent, ni propriété des franchises.
- Retrait de l'ancienne source par le **plan générique de retrait sur preuves** : la source passe RETIRED, les sept représentations et offres sont retirées (`WITHDRAWN`, jamais `CLOSED`), employeur, identifiants, RAW et événements conservés.

## Preuves sur copie de production

| Mesure | Avant | Après sur copie |
|---|---:|---:|
| Identifiants conservés | 77 406 | 77 406 anciens + 41 nouveaux |
| Entrées actives | 74 164 | 74 198 |
| Entrées France | 10 957 | 10 957 |
| Annonces Lindex de démonstration actives | 7 | 0 |
| Postes Lindex natifs | 0 | 41 |
| Pays explicite reconnu | — | 41 / 41 (NO 20, LV 5, SE 4, LT 4, CZ 3, SK 2, GB 1, EE 1, DK 1) |
| Description native | — | 41 / 41 |
| Date de publication | — | 0 / 41 (non publiée par la source) |
| `employmentTerm` renseigné | — | 28 / 41 après vocabulaire (1 avant) |
| `workTime` renseigné | — | 33 / 41 après vocabulaire (1 avant) |
| Erreurs / fusions du nouveau flux | — | 0 / 0 |

Trois ingestions ciblées sur la copie : la première crée 41 entrées, la deuxième les réatteste sans création et sans changer `firstSeenAt`, la troisième (après le vocabulaire) réécrit contrat et rythme à la ré-attestation. 83 requêtes HTTP par run, 10 événements durables, 0 échec de persistance. Le retrait sur copie compte 15 opérations, rejeu zéro. Front local sur la copie : fiche `/entreprise/lindex` à 41 offres, ancienne annonce en HTTP 410, nouvelle annonce en 200 sans `JobPosting`.

Une offre reste sans `employmentTerm` par contradiction réelle : son titre dit « Vikariat », son champ structuré dit « Fast » ; sans mesure de fiabilité pour cette source nouvelle, la chaîne ne tranche pas (D54). C'est le comportement voulu.

## Validation

1 630 tests unitaires, 249 tests d'intégration sur base dédiée, 98 tests web, typecheck des deux applications à zéro erreur, `next build` contre la copie. Les tests de charge sont exclus.

## Preuve après production

Ordre suivi : sauvegarde complète (`before-lindex-production.dump`, 385 839 634 octets, SHA-256 `7d7a64e8603ae9c83012749a22cb196e4e3e6eb8b6325cbcc2fbfe3f46263bb7`, `pg_restore --list` vérifié) → PR 54 mergée (`68cbc4a`), quatre déploiements SUCCESS, **migration 40 appliquée par le predeploy** avant le serveur web (`/api/health` 200) → retrait → qualification → run borné → preuves.

- **Retrait** : plan produit sur la production, patches identiques aux témoins du clone (`patchesEqualClone: true`), hash `9dfa326cf0bbb676…` ; 15 opérations écrites, rejeu 0, 0 violation de cycle de vie. Source `lindex` RETIRED ; sept représentations et offres retirées (`WITHDRAWN`), RAW, identifiants, événements et employeur conservés (`lindex-production-preservation-proof.json`).
- **Qualification** : candidat `lindex-easycruit` créé, énumération native 41/41 (liste XML SHA `fa14a3d5…6fca3` au run), 7 alias source-scopés, revue d'identité `OFFICIAL_LINK` (`lindex.com` → `lindex.easycruit.com`), robots relu (`Disallow: /intranet/` seulement), promotion DRAFT → ACTIVE, secteur FASHION revu (`lindex-easycruit-production-qualification-proof.json`, `lindex-sector-production-proof.json`).
- **Run Railway borné** `3cda97b7-0ef3-4c5b-91ca-5579ea8daa66`, déploiement `23437347-535a-4446-81a4-11224c01cdce`, révision `68cbc4a`, `INGEST_ONLY_KEYS=lindex-easycruit`, 16:25:35 → 16:25:51 UTC : **41 collectées, 41 créées, 0 fusion, 0 erreur**, identifiants natifs strictement égaux à ceux enregistrés. Observabilité : 12 lignes Railway, pic 7 lignes/s, 11 événements durables, 0 perte, 0 échec de persistance (`lindex-production-delivery-proof.json`). Commande normale `sh apps/aggregator/start.sh` restaurée ensuite ; les trois workers restent `PIPELINE_PAUSED=1`.

| Mesure | Avant (16:18 UTC) | Après (16:32 UTC) |
|---|---:|---:|
| Offres conservées | 77 406 | **77 447** (77 406 anciennes + 41) |
| Actives | 74 164 | **74 198** |
| France | 10 957 | 10 957 |
| Lindex : démonstration active / natives | 7 / 0 | **0 / 41** |
| Pays reconnu · description · date | — | 41 · 41 · 0 |
| `employmentTerm` · `workTime` renseignés | — | 28 · 33 |

Public (`lindex-public-production-proof.json`) : `/api/jobs?maison=Lindex` monde 41 (2 pages), NO 20, CZ 3, FR 0, FASHION 41, identifiants strictement égaux à la base ; `/entreprise/lindex` 200 avec 41 offres ; offre neuve 200 **sans** `JobPosting` (aucune date de publication native) ; témoin retiré `cmtlyg3f101h9qf5k5xixoyd8` en **410** sans `JobPosting`.

## Limites encore ouvertes

Suivies avec témoins et critères de résolution dans [backlog-data-quality.md](backlog-data-quality.md) (L1 à L4).

- **Aucune date de publication** n'est publiée par le flux EasyCruit : ces 41 offres ne sont pas balisées pour Google Jobs, par choix (pas de date inventée). Une date native ne pourrait venir que d'une autre surface officielle, non observée.
- **Lieux** : le champ `Location` d'EasyCruit porte parfois un comté norvégien (« Rogaland », « Vestland »), un centre commercial (« Maxi Sandnes », « Bluewater ») ou rien (une offre). Ils sont conservés tels quels dans `city` ; la Norvège n'a pas de table de subdivisions, donc `adminArea1` reste vide (D53). À traiter dans le lot géographie, pas par exception.
- Une offre reste sans `employmentTerm` (titre « Vikariat », champ « Fast ») : contradiction réelle, non tranchée faute de mesure de fiabilité (D54). Les autres `null` (13 durées, 8 rythmes) correspondent à des valeurs que la source n'exprime pas canoniquement (« Ekstrahjelp », « Ved behov », « Na smlouvu », « VPP », « Příležitostná práce »).
- Le référentiel `country.ts` conserve 251 codes opérationnels : ce n'est pas la liste ISO officielle ; audit référentiel à faire séparément.

| Finding | Fixé ? | Commit / merge | Main ? | Déployé ? | Données réparées ? | Preuve prod |
|---|---|---|---|---|---|---|
| Lindex : faux tenant Teamtailor, 7 annonces de démonstration | Oui | `acab2ba` / `68cbc4a` | Oui | Oui | 7 retraits, RAW/historique conservés | `lindex-production-preservation-proof.json` |
| Lindex : portail officiel EasyCruit absent | Oui | `acab2ba` / `68cbc4a` | Oui | Oui | 41 entrées natives, 0 FR | `lindex-production-delivery-proof.json` |
| Variantes officielles de pays (CLDR) | Oui | `acab2ba` / `68cbc4a` | Oui | Oui | 3 pays Lindex reconnus (CZ) ; 0 régression sur le corpus | `country-variants-corpus-proof.json` (privé) |
| Vocabulaire d'emploi nordique/balte/tchèque | Oui | `acab2ba` / `68cbc4a` | Oui | Oui | 28/41 et 33/41 renseignés | `lindex-production-preservation-proof.json` |
| Dates de publication Lindex | Non (non publiées) | — | — | — | Non | `lindex-public-production-proof.json` |

**GO pour maintenir la source Lindex qualifiée ; NO-GO pour déclarer le Lot 4 terminé ou relancer tous les workers.**
