# prada-group : attribuer chaque offre à la marque que le portail nomme (D-522 §6, 03/10/2026)

**Constat mesuré.** `jobs.pradagroup.com` nomme la marque de chaque offre dans la colonne « Brand » de sa liste
(`td.colFacility`) ; la fiche ne la porte pas et son `hiringOrganization` dit « Prada Group ». En base, les 303 offres
actives de `prada-group` sont attribuées à « Prada Group », dont 35 + 3 offres Miu Miu et 13 offres Versace.

**Code (branche d522-6-portails, commit « fix(successfactors): lire la marque de la ligne de liste HTML »).**
`brandProperty: "facility"` fait lire la colonne ; la relecture hors réseau rend la même marque. Sans ce réglage,
rien ne change pour les autres tenants.

**Données (à appliquer par le CEO après le RUN d'acceptation de r6 et le déploiement du code ci-dessus).**
1. Rejouer la construction de la revue sur une cassette fraîche (les empreintes et `expectedSourceHash` datent du
   03/10) :
   `record-cassette.mts --key=prada-group --dir=<cassette>` puis
   `construire-revue-portail.mts <cassette> revue-portail-prada-group.json` (lecture seule).
2. Inspection : `npx tsx apps/aggregator/src/remediation/cli.ts plan-portal-owners --spec revue-portail-prada-group.json --out <plan>`
   (transaction READ ONLY). Résultat du 03/10 : 198 opérations (191 Job, 6 Company, 1 Source), 191 observations ;
   offres déplacées : PRADA 126, Miu Miu 38, Versace 13, Marchesi 1824 10 (créée), Church's 4 (créée) ; les 50 + 2
   offres « Prada Group » et les 60 actives non vues ce jour restent au groupe. Voir `inspection-plan-portail-2026-10-03.json`.
3. `cli.ts apply --plan … --sha … --commit …` : la source passe PAUSED (règle du plan), config `brandProperty: facility`.
4. Certification comme pour OTB (09/09) : alias source-scopés `Prada`, `プラダ` → PRADA ; `Miu Miu`, `ミュウミュウ` →
   Miu Miu ; `Versace` → Versace ; `Church's` ; `Marchesi 1824` ; `Prada Group`, `プラダ・グループ` → Prada Group ;
   revue d'identité OFFICIAL_DOMAIN `pradagroup.com`, `portalScope = MULTI_BRAND`, puis réouverture.

**Point de périmètre signalé, non tranché ici.** Marchesi 1824 (pâtisserie du groupe, 10 offres) est aujourd'hui
servie sous « Prada Group » ; la revue l'attribue à sa marque, ce qui la fait apparaître comme Maison.
