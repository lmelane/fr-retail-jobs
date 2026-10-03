# D-522 §6 — gestes de production, dans l'ordre (rien n'est exécuté ; après le RUN d'acceptation de r6)

Préalable : la release qui porte ce lot est livrée (code, puis images). Chaque écriture : aperçu ou inspection sous
`db.py readonly`, relecture, puis application du seul fichier relu sous `db.py production`. Jamais pendant le RUN de 18 h.
Réviseur : `assistant-d522` (arbitrages du CTO). Les plans de remédiation se régénèrent le jour de l'application
(leur empreinte change à chaque génération) et `apply` exige un commit présent sur `origin/main`.

1. **Registre explicite** : `registry-review --decisions=registre-explicite-2026-10-03.json --output=<aperçu>`, relire
   (`refused` vide, 0 retrait), puis `--apply --plan=<aperçu>`. Avant toute réouverture : une source rouverte devient
   ACTIVE et serait ensuite refusée par ce fichier (ACTIVE_SOURCE).
2. **Configurations** (`corriger-sources-relues.mts … --ecrire` après inspection) : `prada-group/registre-relu-prada-group.csv`,
   `sephora-france/registre-relu-sephora-france.csv`, `kastner-ohler/registre-relu-kastner-ohler.csv`,
   `ghost/registre-relu-ghost.csv`, `sioux/registre-relu-sioux.csv`, `fastrack/registre-relu-fastrack.csv` (fastrack : la configuration peut précéder le retrait de l'étape 4,
   qui porte sur l'ancienne révision ; la réouverture, elle, vient après le retrait).
3. **Portails** (après la configuration de prada-group, `brandProperty`) : `importer-registre-csv.mts workday-marques/registre-relu-portails.csv` (inspection : 18 portalScope,
   0 refus ; SINGLE_BRAND × 11, MULTI_BRAND × 7 dont l-oreal-professionnel et prada-group), puis `--ecrire`.
4. **Retraits de mauvais employeurs** (`cli.ts plan-homonym-representations --spec …` puis `apply`) :
   `sioux/retrait-homonyme-spec.json` (19), `picard/retrait-homonyme-spec.json` (6), `fastrack/retrait-homonyme-spec.json` (15) ;
   `cli.ts plan-anchor-duplicates --spec lumentee/retrait-copies-ancres-spec.json` (4).
5. **Alias relus** : `record-employer-alias.mts --spec=prada-group/alias-prada-groupe-japonais.json --phase=production` (aperçu, puis `--apply`).
6. **Réouvertures** (`start.sh source-add --key=<clé> --registered-revision=<révision relue en base APRÈS l'étape 2>
   --official-domain=<domaine> --reviewer=assistant-d522`), une à une, chacune jugée par sa collecte :
   ghost (ghostfashion.com), sioux (sioux.de), markham (`efe81032-e274-4511-9187-5c0e817c3032`, tfglimited.co.za),
   fastrack (titancompany.in), ralph-lauren-avature (`de332ddf-b45d-42fa-a89e-9ab1106e0d62`, ralphlauren.com ;
   critères de D-483 et `source.capture_adopted`).
7. **Nouvelle source** Fjällräven sur Fenix Outdoor : `fjallraven/preparation.md` (source-add, puis alias
   `fjallraven/alias-fjallraven-north-america.json` si l'identité retient les offres).
8. **Après la première collecte sous la nouvelle configuration** de kastner-ohler : régénérer et appliquer
   `cli.ts plan-replaced-identity --spec kastner-ohler/retrait-identite-remplacee-spec.json` (12 remplacées + 5 non listées attendues).
9. **Surveiller** au RUN qui suit la release : aucune attestation des familles en mise en route (lvmh, wttj, wttj-sector,
   SmartRecruiters) ; au RUN suivant, environ 2 153 fermetures, puis 2 292 ; la garde globale du refresh ne doit pas se déclencher.
