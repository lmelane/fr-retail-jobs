# prada-group : attribuer chaque offre à la marque que le portail nomme, sans pause (D-522 §6, 03/10/2026)

**Constat mesuré.** `jobs.pradagroup.com` nomme la marque de chaque offre dans la colonne « Brand » de sa liste
(`td.colFacility`) ; la fiche ne la porte pas et son `hiringOrganization` dit « Prada Group ». En base, les 303 offres
actives de `prada-group` sont attribuées à « Prada Group ». Cassette du 03/10 (243 offres listées) : Prada 125,
Prada Group 50, Miu Miu 35, Versace 13, Marchesi 1824 10, Church's 4, ミュウミュウ 3, プラダ・グループ 2, プラダ 1.

**Arbitrage du CTO (D-522 §6).** On ne met jamais en pause une source ACTIVE. Le groupe Prada suit la règle R-142 §3
des portails relus MULTI_BRAND, sur le modèle de L'Oréal : liste fermée `groupBrands.ts` (Prada, Miu Miu, Church's,
Versace, Maison au registre et marque du groupe depuis décembre 2025) ; sans marque, « Prada Group ». **Marchesi 1824**
(pâtisserie) : question de périmètre soumise au CEO ; en attendant, ses offres sont **retenues**
(`GROUP_BRAND_OUT_OF_PERIMETER`, décision d'équipe non bloquante, retrait daté de la collecte), la source n'est pas
pausée et **aucune Maison Marchesi n'est créée**.

**Code.**
- `successfactors.ts` (commit b3a43d7) : `brandProperty: "facility"` lit la colonne ; la relecture hors réseau rend la même marque.
- `identity/groupBrands.ts` (liste du groupe Prada), `identity/portalEmployer.ts` (marque prouvée, entité « Prada Group »,
  écritures japonaises, Marchesi retenue), `identity/resolve.ts` + `identity/existingMaison.ts` (Maisons existantes :
  PRADA, Miu Miu, Versace, Prada Group ; Church's créée), `capture/publicationPolicy.ts` (la retenue Marchesi se recalcule
  sur la sortie native sous le périmètre courant), `corriger-sources-relues.mts` (SuccessFactors `brandProperty`).
  Témoins : `identity/groupBrands.test.ts` (groupe Prada), `pipeline/group-brand.ingest.test.ts` (Marchesi retenue,
  aucune Maison créée, refus si le portail n'est plus relu).

**Gestes (à appliquer par le CEO après le RUN d'acceptation de r6 et le déploiement du code ci-dessus), sans pause.**
1. Configuration relue : `corriger-sources-relues.mts registre-relu-prada-group.csv` (aperçu :
   `inspection-corriger-sources-relues.txt`, 1 correction, config `{"origin":"https://jobs.pradagroup.com","brandProperty":"facility"}`,
   `tenantKey` inchangé). Crée une nouvelle révision de source ; ne touche pas au statut.
2. Alias relu, APRÈS le geste 1 (l'alias porte l'empreinte de la configuration) : `record-employer-alias.mts
   --spec=alias-prada-groupe-japonais.json --phase=production` (`プラダ・グループ` → Prada Group ; aperçu :
   `inspection-alias-prada.txt`). Les écritures « プラダ » et « ミュウミュウ » sont lues par la liste, sans alias.
3. Périmètre : ligne `prada-group;MULTI_BRAND` de `../workday-marques/registre-relu-portails.csv`, par
   `importer-registre-csv.mts` (aperçu : `../workday-marques/inspection-importer-registre-csv.txt`). N'écrit pas de révision.

Le plan `plan-portal-owners` précédent (198 opérations, passage en PAUSED, création de Maisons Marchesi 1824 et
Church's par réattribution) est **abandonné** : `inspection-plan-portail-2026-10-03.json` et
`revue-portail-prada-group.json` restent comme trace de la mesure, ils ne sont plus à appliquer.

**Effet attendu au premier RUN après les gestes** (mesure sur la cassette, `mesure-prada-cassette.json`) : voir le README
de `../workday-marques/`.

**Point de périmètre soumis au CEO.** Marchesi 1824 (pâtisserie du groupe, 10 offres) : la collecter comme une Maison
du luxe, ou la laisser hors périmètre ? Jusqu'à la réponse, ses offres sont retenues et retirées du site.
