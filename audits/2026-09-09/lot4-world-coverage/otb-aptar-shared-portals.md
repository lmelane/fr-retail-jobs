# OTB et Aptar — portails partagés : l'employeur de chaque offre, pas le portail

État au 9 septembre 2026 (reprise du LOT 4, soir). Deux sources SuccessFactors créditaient toutes leurs offres à une seule marque. Le périmètre réel des portails et l'employeur de **chaque** offre ont été lus sur les pages natives avant toute correction.

## État avant, vérifié à la source

| Source | Portail configuré | Attribué à | Actives / représentations | Ce que disent les 374 pages natives (lues le 2026-09-09, 0 erreur) |
|---|---|---|---:|---|
| `maison-margiela` | `careers.otb.net` | Maison Margiela (100 %) | 137 / 153 | `hiringOrganization` = **« OTB Spa »** sur 145 pages (8 sans microdonnée) ; propriété du site carrière **`dept`** = Diesel 79 · Margiela 23 · Marni 14 · Jil Sander 11 · Staff International 4 · Brave Kid 1 · OTB 13 · absente 8 |
| `aptar-beauty` | `jobs.aptar.com` | Aptar Beauty (100 %) | 217 / 221 | `hiringOrganization` = **« Aptar Group »** sur 208 pages (13 sans microdonnée) ; **aucune** propriété de marque ou de segment |

Le site officiel `otb.net` (archivé, SHA `04a897f0…`) présente Diesel, Jil Sander, Maison Margiela, Marni, Viktor&Rolf, Staff International et Brave Kid comme les sociétés du groupe et lie `careers.otb.net`. Le site `aptar.com` (SHA `d6d73574…`) présente Aptar Beauty et Aptar Pharma comme segments d'Aptar Group.

**Cause racine** : le RAW SuccessFactors ne conservait que le slug ; l'adaptateur lisait bien `hiringOrganization` (« OTB Spa ») mais, sans alias revu, la résolution retombait sur la Maison de la ligne de catalogue. Un portail de groupe n'a jamais eu de mécanisme pour attribuer par offre.

## Correction universelle (code)

- **Adaptateur SuccessFactors** : toutes les propriétés `data-careersite-propertyid` d'une page sont archivées dans `raw.postingEvidence.careersiteProperties` (tous les tenants SAP en bénéficient). Une option **`brandProperty`** par tenant, posée par plan revu, désigne la propriété qui nomme la marque employeuse ; quand elle est absente ou vide, l'offre reste au propriétaire du portail. **Rien n'est déduit d'un titre** (« Junior Area Manager MM6 » reste à OTB).
- **Plan « propriétaire de portail »** : `postings` attribue chaque offre dont la page nomme explicitement une marque à cette marque (société créée avec le groupe comme parent, ou marque existante conservée telle quelle) ; tout le reste va au propriétaire ; `configPatch` inscrit le réglage d'adaptateur dans le même plan ; l'invariant `source-owners` vérifie l'employeur **par offre** ; une `SourceObservation` par offre conserve la preuve (URL, SHA-256 de la page, propriété, valeur).
- Tests : 5 unitaires adaptateur (propriétés archivées, `brandProperty`, retour au propriétaire, validation), 2 d'intégration plan (attribution par marque + rejeu, refus d'une marque égale au propriétaire / preuve hors domaine / offre répétée). Suites complètes : 1 635 unitaires, 251 intégration, typecheck 0.

## Décisions de revue

- OTB : propriétaire **OTB** (GROUP, `otb.net`) ; marques attestées par `dept` → **Diesel, Maison Margiela, Marni, Jil Sander** (BRAND, parent OTB), **Staff International** (SUPPLIER : société de production du groupe), **Brave Kid** (OTHER : société de licences enfant). `dept = OTB` (13) et pages sans propriété (8) → OTB. Maison Margiela **n'est pas fusionnée** : elle garde ses 23 offres attestées et reçoit OTB comme groupe parent.
- Aptar : propriétaire **Aptar Group** (GROUP, `aptar.com`) pour les 221 offres ; « Aptar Beauty » reste une société existante, sans offre, non fusionnée. Les mentions « Aptar Pharma » (14 descriptions) ne sont pas des attestations d'employeur ; la question du périmètre (fournisseur d'emballage, segment pharma) est remontée au propriétaire, pas tranchée ici.
- Alias source-scopés : `OTB Spa`, `OTB`, `Diesel`, `Margiela`, `Marni`, `Jil Sander`, `Staff International`, `Brave Kid` → sociétés ci-dessus ; `Aptar Group` → Aptar Group. Revues d'identité `OFFICIAL_DOMAIN` (`otb.net`, `aptar.com`, page d'offre comme preuve), promotion des deux sources, secteur FASHION attesté par `otb.net` pour OTB, Diesel, Marni, Jil Sander, Maison Margiela.

## Preuves sur copie fraîche de production

Sauvegarde `before-otb-aptar-production.dump` (386 430 658 octets, SHA-256 `190d01e5cb98fc9b396a78f04f5cc35790bf9919147a005a33f95edbd49ef198`), restaurée dans une base neuve identique à la production (77 447 offres, 74 187 actives, 10 957 France).

| Mesure | Avant | Après sur copie |
|---|---:|---:|
| Identifiants · RAW · cycle de vie | 77 447 | inchangés (vérifié ligne à ligne sur les 374 représentations) |
| Opérations · rejeu | — | 735 (351 Job, 374 JobSource, 8 Company, 2 Source) · 0 |
| OTB actives : Diesel · Maison Margiela · Marni · Jil Sander · Staff Int. · Brave Kid · OTB | 0 · 137 · 0 · 0 · 0 · 0 · 0 | **73 · 23 · 11 · 10 · 3 · 1 · 16** |
| Aptar actives : Aptar Group · Aptar Beauty | 0 · 217 | **217 · 0** |
| Observations de marque (preuve par offre) | 0 | 132 |
| Ingestion réelle des deux sources après correction (2 passes) | — | 153 + 215 lues, complètes, 0 erreur ; **0 erreur d'identité, 0 changement d'attribution** entre les passes, `firstSeenAt` conservé ; 8 + 7 offres nouvelles attribuées par la page |

## Preuve après production (17:42–17:46 UTC)

Ordre : PR 56 mergée (`772ee8d`, app `cf61376`) → workers SUCCESS dessus ; **web non redéployé et justifié** : diff vide entre `68cbc4a` et `772ee8d` sur `apps/web`, `packages/db`, `package.json`, `package-lock.json` (watch paths du service) → plan produit sur la production, **patches identiques aux témoins du clone** (contrôle bloquant) → application → certification → run borné → preuves.

- **Plan** `b1f4bda436842c61…` : 735 opérations (351 Job, 374 JobSource, 8 Company, 2 Source), rejeu 0, 0 contradiction d'invariant, 77 447 identifiants, RAW et cycle de vie conservés (`otb-aptar-owner-production-proof.json`). 132 observations de marque écrites.
- **Certification** (`otb-aptar-certification-production-proof.json`) : 9 alias source-scopés, revues d'identité `OFFICIAL_DOMAIN` (`otb.net`, `aptar.com`), sources promues PAUSED → ACTIVE, secteur FASHION sur OTB, Diesel, Marni, Jil Sander, Maison Margiela (5 sociétés, 133 offres actives concernées, rejeu 0).
- **Run Railway borné** `3c2306b5-9052-4f1c-a11e-08a4da1edc96` (déploiement `3407e4b9…`, `INGEST_ONLY_KEYS=maison-margiela,aptar-beauty`, 17:45:10 → 17:45:5x UTC) : OTB 153 lues / 153 déclarées, **8 créées, 145 mises à jour, 0 erreur** ; Aptar 215 / 215, **7 créées, 208 mises à jour, 0 erreur** ; 16 lignes Railway, pic 6/s, 15 événements durables, 0 perte (`otb-aptar-production-delivery-proof.json`). Commande normale restaurée ensuite ; workers toujours `PIPELINE_PAUSED=1`.

| Employeur affiché | Avant | Après plan | Après run réel |
|---|---:|---:|---:|
| Maison Margiela | 137 | 23 | 25 |
| Diesel | 0 | 73 | **85** |
| OTB (groupe) | 0 | 16 | 17 |
| Marni | 0 | 11 | 14 |
| Jil Sander | 0 | 10 | 11 |
| Staff International | 0 | 3 | 4 |
| Brave Kid | 0 | 1 | 1 |
| Aptar Beauty | 217 | 0 | 0 |
| Aptar Group | 0 | 217 | **224** |

Les 15 offres créées par le run ont été attribuées par la page native (propriété `dept` ou `hiringOrganization`), sans aucune erreur d'identité : le chemin vivant reproduit la décision revue.

Public (`otb-aptar-public-production-proof.json`) : pour chacune des huit marques, **identifiants API = identifiants base** (Diesel 85, Aptar Group 224, Maison Margiela 25, OTB 17, Marni 14, Jil Sander 11, Staff International 4, Brave Kid 1), une page d'offre par marque en 200 avec `JobPosting` ; « Aptar Beauty » : 0.

| Finding | Fixé ? | Commit / merge | Main ? | Déployé ? | Données réparées ? | Preuve prod |
|---|---|---|---|---|---|---|
| OTB : 137 offres du portail groupe créditées à Maison Margiela | Oui | `cf61376` / `772ee8d` | Oui | Oui | 351 offres réattribuées (marque nommée par la page, sinon groupe) | `otb-aptar-owner-production-proof.json` |
| Aptar : 217 offres du portail groupe créditées à Aptar Beauty | Oui | `cf61376` / `772ee8d` | Oui | Oui | 221 offres → Aptar Group | idem |
| SuccessFactors : propriétés du site carrière non archivées | Oui | `cf61376` / `772ee8d` | Oui | Oui | RAW enrichi au prochain passage de chaque tenant | `otb-aptar-production-delivery-proof.json` |
| Aptar Pharma dans le périmètre ? | Non tranché (propriétaire) | — | — | — | — | 14 descriptions |
