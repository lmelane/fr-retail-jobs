# D-522 §6 — groupe workday : les 2 245 annonces Workday retenues faute d'employeur

Mesure de référence : RUN `9022fc4b-1b96-431d-bee9-86ed244ef4f1` (02/10/2026). 18 sources (le brief en citait 17 : la 18e est
`tapestry`, 2 retenues). Total vérifié dans les rapports scellés de fin d'ingestion : **2 245** (`extraction-retenues.json`).

## Cause vérifiée
`mergeWorkdayDetail` (`apps/aggregator/src/ats/adapters/workday.ts`) pose `WORKDAY_EMPLOYER_ABSENT_IN_DETAIL` quand la fiche n'a ni
logo ni `hiringOrganization`. `employerFromCertifiedScope` (`identity/portalEmployer.ts`) ne levait la retenue que sur un portail
SINGLE_BRAND. Or aucune des 18 sources n'avait de `portalScope` (lu en base le 03/10), et sur un portail MULTI_BRAND la retenue
n'était jamais levée : **défaut du code** au regard de R-142 §3 (« l'offre qui ne nomme pas son enseigne publie sous le groupe ;
celle qui nomme sa Maison la garde »), que le résolveur appliquait déjà aux offres sans libellé des autres lecteurs.

## Correctif (branche `d522-6-workday`)
- `identity/groupBrands.ts` : liste fermée et relue des marques de 6 portails de groupe (Levi Strauss, Nike ×2, VF, Movado,
  L'Oréal), licences et marques cédées exclues ; correspondance par mots entiers sur l'intitulé et le lieu, sans casse ni accents ;
  deux marques = le groupe. Le mécanisme du registre (`Company.parentGroupId`) ne rattache aucune Maison à ces groupes.
- `identity/portalEmployer.ts` : MULTI_BRAND lève la retenue vers la marque prouvée, sinon le groupe ; une entité juridique du
  groupe (« VF Outdoor, LLC ») cède devant la marque prouvée ; offre sans employeur ni retenue (L'Oréal, dataLayer « Multi Brand »)
  prend la marque prouvée ; une candidature spontanée détectée n'est jamais levée (D-511). Provenances à part :
  `portal.groupBrand:BRAND_NAMED_ON_REVIEWED_MULTI_BRAND_PORTAL`, `portal.certifiedScope:GROUP_INFERRED_FROM_REVIEWED_MULTI_BRAND_PORTAL`.
- `identity/resolve.ts` : la marque est relue sur l'offre contre la liste du portail relu (sinon refus) ; publiée sous la Maison
  `resolved:<clé resolveCompany>` (créée si absente, comme un propriétaire de portail) ; une offre déjà publiée sous le groupe
  rejoint sa marque, une offre publiée sous une autre Maison n'est jamais déplacée.
- Appelants alignés : ingestion, politique de publication, validation, reprise, `validation-a-blanc.mts`.

## Fichier relu prêt (non appliqué)
`registre-relu-portails.csv` : 11 SINGLE_BRAND + 6 MULTI_BRAND. Inspection : `inspection-importer-registre-csv.txt`
(17 `portalScope` à écrire, 0 refus). Preuves SINGLE_BRAND : `libelles-natifs.md` (aucune source ne montre un libellé d'une autre
Maison). `jansport` : non certifié (`jansport.md`). `tapestry` : hors arbitrage.

## Mesure à blanc (`mesure-a-blanc.json`, script `mesure-a-blanc.mts`)
2 245 retenues → **2 240 libérées**, 5 restent (jansport 3, tapestry 2), 0 bloquée par un employeur déjà attribué.
Hors stock retenu : 750 des 847 offres VF publiées sous une entité juridique (dont 712 « VF Outdoor, LLC ») passeraient de
« VF Corporation » à leur marque ; L'Oréal : 1 099 offres sans employeur → 1 063 groupe, 36 marques.
Relecture de 30 annonces : `relecture-30.md` (27 justes, 2 réserves sur le nom du groupe, 1 fausse : candidature spontanée).
