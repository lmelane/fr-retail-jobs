# Décisions d'architecture du cadrage du 2026-09-09 (soir) — ce qui est appliqué, avec quelles preuves

Contexte : crons gelés (D57), **aucune ingestion** ; tout repose sur les réponses archivées (charges utiles des sondes, RAW en base, observations d'employeur) et sur des lectures seules de la production.

## 1. Les cinq dimensions de « prouvé »

Voir `proof-dimensions.md` et `tracker-v7/`. Identité certifiée 13 · énumération démontrée 385 · **collecte complète 377** (une ligne rejetée reste dans l'écart) · détails complets 243 · ingestion en phase 162 · visibilité prouvée 1 · les cinq réunies : 0.

## 2. URBN — sous-libellés distincts

- **Décision** : FP Movement (143 offres), Anthro Weddings (25), Maeve (6) restent des libellés d'employeur **distincts et traçables** ; leur relation à Free People / Anthropologie est **attestée** par la page native (`sameAs` = chemin du site de la marque mère) et **enregistrée**, pas transformée en fusion.
- **Vérification des rattachements déjà appliqués (lot v1, 19:20 UTC)** : les 174 offres avaient été créditées à la marque mère (alias v1 `FP Movement → Free People`, `Anthro Weddings → Anthropologie`, `Maeve → Anthropologie`) ; dernière observation par offre relue en prod : 143 / 25 / 6, toutes actives, toutes avec page et empreinte archivées.
- **Correction (revue `…URBN-SUBLABELS-v2` + alias `…URBN-SUBLABEL-ALIASES-v2`)** : trois sociétés `BRAND` distinctes, groupe = URBN (la base n'accepte qu'un GROUPE canonique comme parent — trigger `Parent … must be a canonical GROUP`), relation attestée écrite dans l'observation (`attestedRelatedBrand`) et la raison de la correction ; alias v1 remplacés (`legacyAliasId`). Répétition sur clone puis production : voir §7.
- **Reclectic (16)** : `reclectic.com` existe mais ne mentionne ni URBN ni une marque du groupe ; `urbn.com/our-brands` ne le liste pas ; seul le hub le nomme comme organisation recruteuse (`sameAs` « UNAVAILABLE »). **Identité non qualifiée officiellement** : reste sous URBN, alias `Reclectic → URBN` conservé comme décision provisoire tracée, à confirmer par une preuve officielle (page URBN ou mention légale sur reclectic.com).
- **Menus and Venues (38)** : `urbnmenusandvenues.com` nomme URBN 16 fois et `urbn.com/our-brands` présente « Menus & Venues » : **marque officielle du groupe**, société distincte conservée ; son secteur (restauration) reste non classé — périmètre à décider.

## 3. Kering — omission de la Maison

- **Règle livrée (PR 68, `identity/resolve.ts`)** : quand une nouvelle réponse omet la Maison et porte le **groupe enregistré pour cette Maison**, l'offre garde la Maison attestée pour le même identifiant source ; la nouvelle observation enregistre le libellé de groupe (règle `GROUP_LABEL_KEPT_HOUSE`) — l'absence reste traçable ; la résolution rend la Maison, donc l'upsert met à jour tous les autres champs. Tout autre libellé reste un changement d'identité soumis à revue. Test d'intégration (`identity-gate.test.ts`).
- **Vérifié hors ligne** (`kering-rule-check.mts`, lecture seule, après PR 70 : la règle vaut aussi sans observation antérieure — la porte est plus récente que la plupart des sources) : **5 des 6 offres gardent leur Maison** (Saint Laurent ×3, Boucheron, Kering Eyewear → `GROUP_LABEL_KEPT_HOUSE`) ; **« Kering Corporate »** n'a pas de groupe enregistré → reste une revue (K1 : enregistrer la relation Kering Corporate → Kering sur preuve, ou confirmer le groupe comme employeur).

## 4. Workday sans employeur explicite

- **Règle livrée (PR 68)** : `SourceIdentityReview.portalScope` (`SINGLE_BRAND` | `MULTI_BRAND`), **valable pour la configuration certifiée seulement**. Une annonce retenue pour absence d'employeur (`WORKDAY_EMPLOYER_ABSENT_IN_DETAIL`) ne prend le propriétaire du portail que si le portail est certifié `SINGLE_BRAND` pour la configuration courante ; provenance distincte `portal.certifiedScope` / `EMPLOYER_INFERRED_FROM_CERTIFIED_SINGLE_BRAND_PORTAL`. Jamais sur un portail multimarque ou non revu : l'annonce reste retenue.
- **État** : aucune source n'est encore certifiée avec un périmètre (Mango 27 et Nordstrom 2 annonces restent retenues). La certification `SINGLE_BRAND` de Mango (`mango.wd3`) demande la preuve officielle (mango.com → portail) ; Nordstrom porte les bannières Nordstrom / Nordstrom Rack : périmètre à qualifier avant toute certification.

## 5. Alias juridiques — preuve par alias

Les 15 alias du lot v1 (`legal-entity-aliases.md`) : 7 par **règle A** (clé canonique = marque, page officielle ou portail carrière de la marque archivé), 8 par **règle B** — chacun correspond à une ligne **`RATTACHÉ`** du référentiel D45 (`Statut` lu dans le fichier : « Entité juridique / pays rattachée à Mango / Michael Kors / Jimmy Choo »), donc à une décision explicite du propriétaire, plus la page officielle. « Nordstrom Inc » et « MANGO SUISSE SA » sont absents du référentiel : règle A seule (clé canonique).

**Rejeu hors ligne des 410 charges archivées** (`offline-identity-replay.json`, lecture seule) : 83 libellés sur 55 sources, 13 959 annonces, seraient refusés pour une **nouvelle** annonce. Classement (`refused-labels-classified.json`, fiche `tracker-v7/refused-labels-review.csv`) : règle A 16 libellés / 10 752 offres (Ulta Beauty, Inc. 9 990) · A avec qualificatif (code d'entité, pays, forme juridique) · règle B 3 / 99 (Nike) · artefact « Logo » Workday 7 / 1 341 (corrigé par l'adaptateur) · marque distincte existante 14 / 1 117 (VanCleef-Aprels, Maison 123, Undiz, Le Bon Marché… : alias vers la marque que la page nomme) · **revue propriétaire 24 / 418** (homonymes, cabinets, groupes : JM Huber, Tricoci, Mascot, Eurofragance, Showroomprive.com, Damiani…). Lot v2 (`legacy-aliases-v2-apply.mts`) : règles A / A-qualificatif / B seulement, preuve archivée par employeur.

## 6. Aptar — mesure du périmètre (lecture seule, `aptar-perimeter.json`)

Sociétés : **Aptar Group** (`GROUP`, 228 offres actives, `aptar.com`) et **Aptar Beauty** (0 offre, identité distincte conservée) ; aucune société « Aptar Pharma » n'existe. Répartition des 224 offres actives par segment, sur titre + service + description : **Beauty 88 · Pharma 85 · indéterminé 47 · Closures/Food/Home 4** ; 62 offres citent les deux mots (sites mixtes). Fonctions : production/qualité 63, supply chain 20, R&D 15. Pays : US 94, DE 67, FR 31, CZ 10. **Conclusion** : l'appartenance au groupe ne qualifie pas toutes les offres ; le périmètre sectoriel de Mode Careers correspond au segment Beauty (~88, plus une part des 47 indéterminées). Aucune mutation faite ; options pour Loïc : (a) garder Aptar Group entier hors secteur d'affichage (`sectorCodes` vides, comme aujourd'hui) ; (b) reclasser les offres du segment Beauty vers Aptar Beauty sur preuve par offre (titre/service nommant Beauty) ; (c) retirer la source.

## 7. Exécution

**Code** : PR 68 (règles), PR 69 (`supersedesAliasId` — un alias revu n'est remplacé que par une nouvelle décision revue, l'ancienne liaison archivée en `DataCorrection` ; photographie d'identité allégée — Ulta 10 289 offres débordait le moteur).

**Répétition sur clone d** (sauvegarde `before-qualification-production.dump`, sha256 `3a42678d…edb5`, 21:13 UTC ; migration `portalScope` appliquée au clone) :
- URBN v2 : plan de 206 opérations (201 offres : 174 vers FP Movement 143 / Anthro Weddings 25 / Maeve 6 ; 27 offres dont la dernière page nomme URBN ou aucune organisation reviennent à URBN — dernière preuve par offre), 4 sociétés, rejeu 0 ; 3 alias v1 supplantés ; re-certification `OFFICIAL_DOMAIN` avec `portalScope = MULTI_BRAND`, promotion `PAUSED → ACTIVE` ; secteurs FASHION+RETAIL sur les trois sous-libellés (page « Our Brands »). Après : Anthropologie 427 · Urban Outfitters 324 · Free People 245 · URBN 175 · FP Movement 143 · Terrain 41 · Menus and Venues 38 · Nuuly 35 · Anthro Weddings 25 · Maeve 6.
- Alias v2 : **27 alias écrits** (Ulta Beauty, Inc. 9 990 ; NIKE ×7 ; NORMAL ×10 ; The RealReal, UNIQLO, Vlisco, Brunello Cucinelli, Stella McCartney, Passage du désir, Intersport, Kicks, ELC), rejeu 0 ; 12 pages officielles archivées ; **5 libellés non appliqués faute de page officielle lisible** (new-balance « New Balance Europe B.V. » (10), swarovski « 1570 Swarovski UK Ltd. » (41), swarovski « 1530 Swarovski (Deutschland) GmbH » (30), swarovski « 0780 Swarovski Malaysia » (2), versace « Versace Deutschland GmbH » (6)) — restent pour la revue.

**Production (21:38 UTC, commit `8c29b96`, garde de déploiement passée, fraîcheur de la sauvegarde vérifiée : aucune écriture depuis 20:36 UTC)** :
- URBN v2 : 206 opérations écrites, rejeu 0, formes identiques au clone ; 3 alias supplantés (`FP Movement → FP Movement`, `Anthro Weddings → Anthro Weddings`, `Maeve → Maeve`, liaison v1 archivée en correction) ; re-certification `VERIFIED` / `OFFICIAL_DOMAIN` / `portalScope = MULTI_BRAND`, `urbn-hub` `PAUSED → ACTIVE` ; secteurs posés sur les trois sous-libellés. **Avant → après** : Anthropologie 468 → 427 · Free People 393 → 245 · Urban Outfitters 330 → 324 · URBN 153 → 175 · **FP Movement 143 · Anthro Weddings 25 · Maeve 6** · Terrain 41 · Menus and Venues 39 → 38 · Nuuly 35 ; offres actives 75 010 inchangées ; ids, URL, `firstSeenAt`, RAW conservés (contrôle de conservation du plan).
- Alias v2 : **27 alias écrits**, rejeu 0 ; 12 pages officielles archivées ; 5 libellés non appliqués (New Balance Europe B.V., Swarovski ×3, Versace Deutschland GmbH — sites illisibles automatiquement) : revue.
- **Parité publique** (`qualification-evening/urbn-public-parity-v2.json`) : `/api/jobs?maison=` = base pour les 10 sociétés URBN, dont FP Movement 143, Anthro Weddings 25, Maeve 6 (sans domaine propre → monogramme, aucun logo deviné).

**Ce que ce lot ne fait pas** : aucune ingestion ; les alias n'auront d'effet sur la création d'annonces qu'au prochain run borné (contrôles B1–B3 de `final-validation-controls.md`).
