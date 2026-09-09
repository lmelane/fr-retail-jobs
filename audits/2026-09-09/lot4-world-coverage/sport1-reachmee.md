# Sport 1 — faux tenant retiré, portail officiel documenté à zéro offre

État au 9 septembre 2026 (reprise du LOT 4, soir). Aucune source n'est activée par ce lot : il retire un contenu invalide et enregistre, sans l'activer, le portail officiel réellement trouvé.

## État avant et vérification, à la source

- Société `cmtlygxyn02pfqf5kej297efs` « Sport 1 », `canonicalKey SPORT_1`, domaine `sport1.no`, kind UNKNOWN, aucun alias, `careersUrl` vide, `discoveryStatus PENDING`.
- Source `sport-1` ACTIVE, Teamtailor `sport1.teamtailor.com`, « promu par validation-volume (11 offres, 8 avec lieu) », dernier run DEGRADED le 2026-09-08.
- **Les onze annonces relues en base** (photographie lecture seule du 2026-09-09 16:50 UTC) sont toutes datées du **28 septembre 2023** et portent le texte de démonstration de l'éditeur : « Join a team of superheroes! Teamtailor is an Employer Branding & ATS SaaS platform… » (iOS developer, Key Account Manager, Sales Development Manager, Backend developer, Intern, Social Media Manager) et « A job description is not a job ad. I cannot stress this enough… » (Team Lead CSM, Customer Success Manager, UX Designer, Software Engineer, QA Engineer). Aucune ne concerne Sport 1.
- **Le tenant relu en direct** le 2026-09-09 16:51 UTC (`sport1-teamtailor-live.html`, SHA `1871e024…5382e`) sert exactement ces onze identifiants `3215761` à `3215771`. `robots.txt` du tenant : `/jobs` autorisé.
- **Identité du portail officiel** : la page d'accueil `https://www.sport1.no/` (archivée, SHA `665343ba…f25`) lie `karriere.sport1.no` ; ce portail (SHA `ee54fe20…0ec`) est hébergé par **ReachMee** (`web103.reachmee.com/ext/I021/1899`, site 12) et sa page « Ledige stillinger », rendue en navigateur le 2026-09-09 15:18 UTC, affiche **0 offre** (« Vi har for tiden ingen ledige stillinger »). Le sous-domaine `karriere.sport1.no` appartient au domaine officiel : la relation site → portail est établie par lien officiel.

## Décisions

1. **Retrait administratif de `sport-1`** par le plan générique de retrait sur preuves : source RETIRED, onze représentations et offres `WITHDRAWN`. Aucune `CLOSED` n'est écrite : ce n'est pas une fermeture employeur. Identifiants, RAW, employeur et historiques conservés.
2. **Portail officiel documenté, pas activé** : aucun adaptateur ReachMee n'existe et le portail ne liste aucune offre ; la porte de promotion exige au moins une offre réellement lue. Le candidat est enregistré sur la société (`careersUrl`, `atsConfig` avec tenant, preuves hachées, 0 offre observée, `discoveryStatus NEEDS_REVIEW`), sans nouvelle valeur d'`AtsType` ni source DRAFT fictive.
3. **Franchises** : zéro offre sur le portail central **ne prouve pas** l'absence d'offres dans les magasins franchisés Sport 1 ; ce point reste ouvert dans `backlog-data-quality.md` (S2), avec la couverture mondiale à `NOT_PROVEN` dans le tracker.

## Preuves sur copie fraîche de production

Sauvegarde complète prise avant toute mutation : `before-sport1-production.dump`, **386 262 256 octets**, SHA-256 `469c90f10af0a373e3f6745a7ad2447efeec5cbd45311cd50d6c0f3123dc73bf`, `pg_restore --list` 217 entrées, **restaurée dans une base neuve** (`catwalks_lot4_replay_20260909c`) et vérifiée identique à la production : 77 447 offres, 74 198 actives, 10 957 France, hash d'identifiants `e88d2de651669a8941e42e410ae028a2`. L'ancienne copie, divergente depuis les ingestions Lindex locales, n'a pas servi.

| Mesure | Avant | Après sur copie |
|---|---:|---:|
| Identifiants conservés | 77 447 | 77 447 |
| Annonces Sport 1 de démonstration actives | 11 | **0** (WITHDRAWN, aucune CLOSED) |
| Opérations du plan · rejeu | — | 23 · 0 |
| RAW, événements, employeur des 11 lignes | — | inchangés |
| `Company.careersUrl` / `discoveryStatus` | vide / PENDING | `https://karriere.sport1.no/` / NEEDS_REVIEW (1 écriture, rejeu 0 ; `atsType` inchangé UNKNOWN) |

Plan de retrait `3eeafaa891abb5f9…` (`sport1-withdrawal-clone-proof.json`) ; enregistrement du portail `sport1-portal-record-clone-proof.json`.

## Preuve après production

_Complété après application._
