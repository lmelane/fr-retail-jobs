# A. Inventaire Git et GitHub

Photographie du 15 septembre 2026, après `git fetch origin` sans prune. Aucune branche changée, aucune fusion ni aucun push. Les listes « non mergées » expriment l’ascendance Git : un squash peut avoir intégré le même patch sous un autre identifiant.

## catwalks-job-aggregator

Dépôt local : `/Users/lmelane/Downloads/catwalks-job-aggregator`.

### État initial détaillé

```text
## mesure-vocabulaire-contrat...origin/mesure-vocabulaire-contrat [ahead 8]
 M apps/aggregator/data/seeds/sources.csv
 M apps/aggregator/package.json
 M apps/aggregator/src/ats/adapters/bashTalents.test.ts
 M apps/aggregator/src/ats/adapters/bashTalents.ts
 M apps/aggregator/src/pipeline/sourceStore.test.ts
?? apps/aggregator/scripts/ops/verif-bash-live.mts
?? apps/aggregator/scripts/ops/verif-ca-californie.mts
?? apps/aggregator/scripts/ops/verif-catalogue-coherence.mts
?? apps/aggregator/scripts/ops/verif-langues-marches.mts
?? audits/mesures-d435-d436/d437-couverture-simulee.mjs
?? audits/mesures-d435-d436/d437-echantillon.mjs
?? audits/mesures-d435-d436/d437-enum-cles-raw.mjs
?? audits/mesures-d435-d436/d437-geo-plausibilite.mjs
?? audits/mesures-d435-d436/lot5-cles-raw-par-ats-2026-09-15.sql
?? audits/mesures-d435-d436/lot5-contradiction-seniorite-2026-09-15.sql
?? audits/mesures-d435-d436/lot5-dimensions-par-ats-2026-09-15.sql
?? audits/mesures-d435-d436/lot5-inventaire-2026-09-15.sql
?? audits/mesures-d435-d436/lot5-part-deduction-2026-09-15.sql
?? audits/mesures-d435-d436/lot5-source-vs-colonne-2026-09-15.sql
?? audits/mesures-d435-d436/mesures.sql
?? audits/mesures-d435-d436/q.mjs
?? audits/mesures-d435-d436/verif-ats-us-au-ch.mjs
?? audits/mesures-d435-d436/verif-cles-raw-experience.mjs
?? audits/mesures-d435-d436/verif-familles-vs-metiers.mjs
?? audits/mesures-d435-d436/verif-filtres-universels.mjs
?? audits/mesures-d435-d436/verif-longue-traine.mjs
?? audits/mesures-d435-d436/verif-raw-4-dimensions.mjs
?? audits/mesures-d435-d436/verif-raw-workday-jibe.mjs
?? audits/mesures-d435-d436/verif-salaire-zeros.mjs
?? audits/mesures-d435-d436/verif-seniorite-declaree.mjs
?? audits/mesures-d435-d436/verif-titres-distincts.mjs
```

### Remotes

```text
origin	https://github.com/lmelane/fr-retail-jobs.git (fetch)
origin	https://github.com/lmelane/fr-retail-jobs.git (push)
```

### Toutes les références : branche | SHA | upstream | divergence

```text
codex/fashionjobs-coverage-20260908|953288e44d215bd5707299463fcddddca9ea502d|origin/codex/fashionjobs-coverage-20260908|
codex/fashionjobs-coverage-proof-20260908|8c009de2ef97adec4196d092ed05d5c48b851491|origin/codex/fashionjobs-coverage-proof-20260908|
codex/flatchr-direct-coverage|6c6ae6bae1eb5ab454d5244faa278c6208d92ee1|origin/codex/flatchr-direct-coverage|
codex/france-derived-flag|67aef77cbf3d51bd4997bab7c47720239b5d6649|origin/codex/france-derived-flag|
codex/jobaffinity-direct-portals|75f0ff56d1434dd513a5c48c63af5cabf831a383|origin/codex/jobaffinity-direct-portals|
codex/jobaffinity-production-proof|ae058f78fb11fea1d184b0a7b5ff1819748a04a7|origin/codex/jobaffinity-production-proof|
codex/lot0-observability|2c3bc9a95b751159aa2645916a04bdf1d3ef9210|origin/codex/lot0-observability|
codex/lot0-production-proof|d809d67a178c0d84369e3b770f1d7a0a21b46bbf|origin/codex/lot0-production-proof|
codex/lot1-employer-identity|a32dbdcaf5addc254ffb3743adfd082379eda66d|origin/codex/lot1-employer-identity|
codex/lot1-native-employer-evidence|43e0216e8ba7cd2dc620edda05113c71e1dcbcbd|origin/codex/lot1-native-employer-evidence|
codex/lot1-production-proof|758672ac76aa838cfb47f5644615cbcf8ecbf049|origin/codex/lot1-production-proof|
codex/lot2-occupation-taxonomy|e87f54c4ba6ea66ae323cdd996cef63fe46b910e|origin/codex/lot2-occupation-taxonomy|
codex/lot2-production-proof|639c9c5e2efc5368f9361349661822224845b774|origin/codex/lot2-production-proof|
codex/lot3-contracts-sectors|7927024511d8f458b5d838b348c643affc8b2901|origin/codex/lot3-contracts-sectors|
codex/lot3-production-proof|d05c41652699888dd8b83f8a339822386ee34a93|origin/codex/lot3-production-proof|
codex/lot3-sector-evidence|19539baf54e88fbd71ffa88caa2cb4446e003a92|origin/codex/lot3-sector-evidence|
codex/lot4-aggregator-cleanup|561dc3f9ebec06f7c9381bdb57d5340b15366a17|origin/codex/lot4-aggregator-cleanup|[ahead 7]
codex/lot4-b6-classifier|5bfb0cf093adde4bce424ebbba2058153df6d3ac|origin/codex/lot4-b6-classifier|
codex/lot4-b6-controls|8f68393ca7446a4df80c8de18d14e707fb74392e|origin/codex/lot4-b6-controls|
codex/lot4-b6-docs|035f66769001f1814a74be1e871cb0b3cb335be3|origin/codex/lot4-b6-docs|
codex/lot4-b6-tooling|8d600c27e38f779d24c056d1e423d88865ab95dc|origin/codex/lot4-b6-tooling|
codex/lot4-docs-20260910|b3426023175543b2cbc1f5cf9e038cd039a3d9cf|origin/codex/lot4-docs-20260910|
codex/lot4-final-docs|6ccbef66cf51be7ca2bd522c8178dd8583ad9809|origin/codex/lot4-final-docs|
codex/lot4-market-coverage|50b8095e240d4221518fee516e0ac0a8a1c045a8|origin/codex/lot4-market-coverage|[ahead 25]
codex/lot4-p1-guard|042bfb4f04e09d9a2f8e0abd1fec0d593cb42c9a|origin/codex/lot4-p1-guard|
codex/lot4-p1-reference|08069c2f37f1456511804d036b9efe7c6351d056|origin/codex/lot4-p1-reference|
codex/lot4-p2-causes|d86590fb3e4af341ed3e13f54638e7859d37cd02|origin/codex/lot4-p2-causes|
codex/lot4-p2-completion|4f79e7b490ca21559fc4637ceb4ae5542a5e085b|origin/codex/lot4-p2-completion|
codex/lot4-p2-reference|6a954dd36b7b79aef22a9d7c58dd0bce47bf2fe5|origin/codex/lot4-p2-reference|
codex/lot4-p2-repairs|ec50d18b7499da30c056d8593e5ccab18e10bdfd|origin/codex/lot4-p2-repairs|
codex/lot4-p3-common-procedure|c54a7f3e398aa70c44a95f9b83f8824466b5b76e|origin/codex/lot4-p3-common-procedure|
codex/lot4-p3-gate|d889549ceaed328b00f7dd022ac7305712de6487|origin/codex/lot4-p3-gate|
codex/lot4-p3-real-integration|89a368ce7ab22234990400e94c9903075c881311|origin/codex/lot4-p3-real-integration|
codex/lot4-p3-reception|96258cada787fcbb89780007284ff75e9f536ab2|origin/codex/lot4-p3-reception|
codex/lot4-p4-detachment-controls|7a28d220c31dc4a0e0540b6cf37b4e48aab19749|origin/codex/lot4-p4-detachment-controls|
codex/lot4-p5-ci-fix|f675104d8d1bdc90e7d5314a45e132b2ae457b2c|origin/codex/lot4-p5-ci-fix|
codex/lot4-p5-fashionjobs|c2ed572e7b0fc9b417d7856829d97ef19259b5b6|origin/codex/lot4-p5-fashionjobs|
codex/production-hardening-20260908|83ad4eb4b4e4a7b4295da2137ed57b8b8b445c52|origin/codex/production-hardening-20260908|[ahead 1]
codex/production-proof-20260908|2752f50541a361ffea9b9b6a0bb9b175e59af7a8|origin/codex/production-proof-20260908|
codex/production-proof-20260909|4387eafeb4e5b696645fd0412c062b0f55cdde82|origin/codex/production-proof-20260909|
codex/readiness-production-proof|825d7be89bcce21cde9ea101e5a65c311f2bd0e6|origin/codex/readiness-production-proof|
codex/remediation-data-20260908|18b66ee554a8644c0305d55a7d2af36e4c53cfe3|origin/codex/remediation-data-20260908|
codex/rmk-publication-dates|97a66614942e173917348a394e3670690e5522a2|origin/codex/rmk-publication-dates|
codex/run-integrity|e53c0a522f351c8d54fe770f9361a47a04a57606|origin/codex/run-integrity|
codex/talentview-pagination|d50443f421c834517d1c083d4d52509ed84e212a|origin/codex/talentview-pagination|
codex/teamtailor-attestation|f49d7a9d830b08a6fe917ac82c65fee40fcfc3de|origin/codex/teamtailor-attestation|
main|05428cbce3424b338d4859c9e2ba7a0de6770846|origin/main|[behind 29]
main-avant-squash-154|c3ea37b4fca0c057df6f38ced562e786b635c47a||
mesure-vocabulaire-contrat|9504c9f0bef635f6841e4db5f7c1e7999ac9938f|origin/mesure-vocabulaire-contrat|[ahead 8]
p10-avant-squash|dfc7cf972e99eb57285d548aa2fe184b104e2a6f||
p10-optique-pharmacie|7cf74cf861bd069ae5f2e88dea0aa4111d9ec4a2|origin/p10-optique-pharmacie|
p9-description|ba3365892dd78397463731ba7965dc2b1e1954c9|origin/p9-description|
origin|dd3e24dabf16775703b286c6c9414f766675c9ea||
origin/aggregator/validation|f9d87b5ce86d6aa41e55b371fa8160740648a702||
origin/audit-bornes-recherche|881728f5496ad1a70c672b67c566965a483dd3f7||
origin/codex/fashionjobs-coverage-20260908|953288e44d215bd5707299463fcddddca9ea502d||
origin/codex/fashionjobs-coverage-proof-20260908|8c009de2ef97adec4196d092ed05d5c48b851491||
origin/codex/flatchr-direct-coverage|6c6ae6bae1eb5ab454d5244faa278c6208d92ee1||
origin/codex/france-derived-flag|67aef77cbf3d51bd4997bab7c47720239b5d6649||
origin/codex/jobaffinity-direct-portals|75f0ff56d1434dd513a5c48c63af5cabf831a383||
origin/codex/jobaffinity-production-proof|ae058f78fb11fea1d184b0a7b5ff1819748a04a7||
origin/codex/lot0-observability|2c3bc9a95b751159aa2645916a04bdf1d3ef9210||
origin/codex/lot0-production-proof|d809d67a178c0d84369e3b770f1d7a0a21b46bbf||
origin/codex/lot1-employer-identity|a32dbdcaf5addc254ffb3743adfd082379eda66d||
origin/codex/lot1-native-employer-evidence|43e0216e8ba7cd2dc620edda05113c71e1dcbcbd||
origin/codex/lot1-production-proof|758672ac76aa838cfb47f5644615cbcf8ecbf049||
origin/codex/lot2-occupation-taxonomy|e87f54c4ba6ea66ae323cdd996cef63fe46b910e||
origin/codex/lot2-production-proof|639c9c5e2efc5368f9361349661822224845b774||
origin/codex/lot3-contracts-sectors|7927024511d8f458b5d838b348c643affc8b2901||
origin/codex/lot3-production-proof|d05c41652699888dd8b83f8a339822386ee34a93||
origin/codex/lot3-sector-evidence|19539baf54e88fbd71ffa88caa2cb4446e003a92||
origin/codex/lot4-aggregator-cleanup|6ac43ec2e641518bca42b381eb36ab40f7cb679b||
origin/codex/lot4-b6-classifier|5bfb0cf093adde4bce424ebbba2058153df6d3ac||
origin/codex/lot4-b6-controls|8f68393ca7446a4df80c8de18d14e707fb74392e||
origin/codex/lot4-b6-docs|035f66769001f1814a74be1e871cb0b3cb335be3||
origin/codex/lot4-b6-preparation|4f6e38dfbe02469fb894a5c39f4caabbabf7ef05||
origin/codex/lot4-b6-tooling|8d600c27e38f779d24c056d1e423d88865ab95dc||
origin/codex/lot4-certification-foundations|b7ee9599247d006c10bdee902c057f4811e48271||
origin/codex/lot4-docs-20260910|b3426023175543b2cbc1f5cf9e038cd039a3d9cf||
origin/codex/lot4-final-docs|6ccbef66cf51be7ca2bd522c8178dd8583ad9809||
origin/codex/lot4-market-coverage|52d58cd9c2722fd4ab3dc417028c4450634ef34f||
origin/codex/lot4-owner-review-ids|25fbc2668805154b9df20ecad73261c25b7c2edf||
origin/codex/lot4-p1-guard|042bfb4f04e09d9a2f8e0abd1fec0d593cb42c9a||
origin/codex/lot4-p1-reference|08069c2f37f1456511804d036b9efe7c6351d056||
origin/codex/lot4-p2-causes|d86590fb3e4af341ed3e13f54638e7859d37cd02||
origin/codex/lot4-p2-completion|4f79e7b490ca21559fc4637ceb4ae5542a5e085b||
origin/codex/lot4-p2-reference|6a954dd36b7b79aef22a9d7c58dd0bce47bf2fe5||
origin/codex/lot4-p2-repairs|ec50d18b7499da30c056d8593e5ccab18e10bdfd||
origin/codex/lot4-p3-common-procedure|c54a7f3e398aa70c44a95f9b83f8824466b5b76e||
origin/codex/lot4-p3-gate|d889549ceaed328b00f7dd022ac7305712de6487||
origin/codex/lot4-p3-real-integration|89a368ce7ab22234990400e94c9903075c881311||
origin/codex/lot4-p3-reception|96258cada787fcbb89780007284ff75e9f536ab2||
origin/codex/lot4-p4-detachment-controls|7a28d220c31dc4a0e0540b6cf37b4e48aab19749||
origin/codex/lot4-p5-ci-fix|f675104d8d1bdc90e7d5314a45e132b2ae457b2c||
origin/codex/lot4-p5-fashionjobs|c2ed572e7b0fc9b417d7856829d97ef19259b5b6||
origin/codex/lot4-workday-partition|cf530bc17f90cef68f68f630a3eb76aca2048ad7||
origin/codex/production-hardening-20260908|ce9d27861368dd37289480d2de588b07ed8bef29||
origin/codex/production-proof-20260908|2752f50541a361ffea9b9b6a0bb9b175e59af7a8||
origin/codex/production-proof-20260909|4387eafeb4e5b696645fd0412c062b0f55cdde82||
origin/codex/readiness-production-proof|825d7be89bcce21cde9ea101e5a65c311f2bd0e6||
origin/codex/remediation-data-20260908|18b66ee554a8644c0305d55a7d2af36e4c53cfe3||
origin/codex/rmk-publication-dates|97a66614942e173917348a394e3670690e5522a2||
origin/codex/run-integrity|e53c0a522f351c8d54fe770f9361a47a04a57606||
origin/codex/talentview-pagination|d50443f421c834517d1c083d4d52509ed84e212a||
origin/codex/teamtailor-attestation|f49d7a9d830b08a6fe917ac82c65fee40fcfc3de||
origin/docs/git-rules|f774f9b9042c5963f91249fe1b54d6ae610d41a3||
origin/docs/suggest-comment-world-scope|081a32706e40f800ecbc1224867c100e50cc53ee||
origin/filtres-cumulables-d426|6f065c812946d7c60e7e73b78ca34402a0303981||
origin/fix-docker-api|76a3fe7121d11a57ee410ed45758965cdc6719ab||
origin/fix/company-names-offer-logos-companies-scroll|07a0731a7b1f6f541daa349ffea22e73dbcbdac0||
origin/fix/css-comment-eats-fontface|db6521ac1dbc8b6fa53f2b6227d19721ef91f5a1||
origin/fix/fonts-ffmodern|9c12803893512b3c3da95bbf010a415375a3a218||
origin/fix/front-qa-gaps|dc351706af0360cfb0ffffe109bd5ebadede6aff||
origin/fix/jsonld-address-country|d35232af282aa6b4daedcdeddc8f918422d654e9||
origin/fix/s01-offer-links|f9523cf6c7654b666317208fa603dd7a96ba7cd7||
origin/front-f1|5f3cac9818cfd582e38e77705c9196948a73ea35||
origin/main|dd3e24dabf16775703b286c6c9414f766675c9ea||
origin/mesure-vocabulaire-contrat|be5c61c6dc60076c629dec32410c867f14ef56ae||
origin/nettoyage-code-mort|8258bac96b8f181308aa96980e7ca54d720665c9||
origin/p10-blocs456|2aa9f88fe28d48d5f50a96746946cfe73dbe80bb||
origin/p10-cycles|bc11fbbd25650e872be00e1cd398dcc6e7e6a9af||
origin/p10-exploitation|94f6e308a51399973a011fffeacffcbc494ce59b||
origin/p10-optique-pharmacie|7cf74cf861bd069ae5f2e88dea0aa4111d9ec4a2||
origin/p8-reserve|f700a54c067b8c46f1f970dfd0e6fdf36a64cb5f||
origin/p9-bot-doc|48554a7ebd222df9f6fd15e35967895f73df72ce||
origin/p9-controles-terminaux|004d68a280d69136d6ffc2dc87aa4adbe12c0a0b||
origin/p9-description|ba3365892dd78397463731ba7965dc2b1e1954c9||
origin/p9-locale|da88a59b5dd029b02cb51250d59387586e64a908||
origin/p9-preuve-bot|0270276da33d1e1ae64c3d9f773491c795ef3db2||
origin/p9-url-identity|b9ff8f7df5de434f53b2ba3a07b4f728c752ef5d||
origin/p9-vague-1|d5ad9b5f3407f44e71e7c0a687763870c0bb0fdd||
origin/refonte/corporate-elegance-ui|301b29dd527363edecb45ddb1bfe7b5396e25ce2||
origin/wip/aggregator-discovery|edd2f6c007d32042b8e9c6deafd07f42756d1972||
```

### HEAD contre origin/main : propres à HEAD / propres à main

```text
9	1
```

### Commits de HEAD absents de toutes les références distantes

```text
9504c9f test(parite): garder les FACETTES des deux cotes, pas seulement les codes
35e2df9 fix(mesure): le recalcul de couverture lit la colonne reellement servie
b33e628 fix: le seuil du metier se mesure sur occupationCode, et la seniorite deduite quitte le registre
9fed10a feat: lire l'expérience et le niveau d'études que les adaptateurs jetaient
3809587 fix(marches): les commentaires rattrapent le code apres l'ouverture CN
959a705 feat(marches): la Chine entre au registre, et elle change une regle
bc785e8 feat(marches): la Belgique entre au registre, et un témoin de parité l'y garde
8c88b43 feat(suggest): cloisonner les villes par marché, avec déduction prudente
```

### Commits locaux absents des références distantes, toutes branches confondues

```text
9504c9f test(parite): garder les FACETTES des deux cotes, pas seulement les codes
35e2df9 fix(mesure): le recalcul de couverture lit la colonne reellement servie
b33e628 fix: le seuil du metier se mesure sur occupationCode, et la seniorite deduite quitte le registre
9fed10a feat: lire l'expérience et le niveau d'études que les adaptateurs jetaient
3809587 fix(marches): les commentaires rattrapent le code apres l'ouverture CN
959a705 feat(marches): la Chine entre au registre, et elle change une regle
bc785e8 feat(marches): la Belgique entre au registre, et un témoin de parité l'y garde
8c88b43 feat(suggest): cloisonner les villes par marché, avec déduction prudente
```

### Branches sans ascendance dans origin/main

```text
main-avant-squash-154
* mesure-vocabulaire-contrat
  p10-avant-squash
+ p10-optique-pharmacie
  p9-description
  remotes/origin/audit-bornes-recherche
  remotes/origin/filtres-cumulables-d426
  remotes/origin/fix-docker-api
  remotes/origin/fix/jsonld-address-country
  remotes/origin/fix/s01-offer-links
  remotes/origin/front-f1
  remotes/origin/mesure-vocabulaire-contrat
  remotes/origin/nettoyage-code-mort
  remotes/origin/p10-blocs456
  remotes/origin/p10-cycles
  remotes/origin/p10-exploitation
  remotes/origin/p10-optique-pharmacie
  remotes/origin/p8-reserve
  remotes/origin/p9-bot-doc
  remotes/origin/p9-controles-terminaux
  remotes/origin/p9-description
  remotes/origin/p9-locale
  remotes/origin/p9-preuve-bot
  remotes/origin/p9-url-identity
  remotes/origin/p9-vague-1
```

### Worktrees enregistrés

```text
worktree /Users/lmelane/Downloads/catwalks-job-aggregator
HEAD 9504c9f0bef635f6841e4db5f7c1e7999ac9938f
branch refs/heads/mesure-vocabulaire-contrat

worktree /private/tmp/catwalks-jobaffinity
HEAD 75f0ff56d1434dd513a5c48c63af5cabf831a383
branch refs/heads/codex/jobaffinity-direct-portals
prunable gitdir file points to non-existent location

worktree /private/tmp/catwalks-remediation-baseline
HEAD b7aa6dafe00c8cc286a43b62332b938de5db7a9f
detached
prunable gitdir file points to non-existent location

worktree /private/tmp/catwalks-run-integrity
HEAD e53c0a522f351c8d54fe770f9361a47a04a57606
branch refs/heads/codex/run-integrity
prunable gitdir file points to non-existent location

worktree /private/tmp/catwalks-talentview-pagination
HEAD d50443f421c834517d1c083d4d52509ed84e212a
branch refs/heads/codex/talentview-pagination
prunable gitdir file points to non-existent location

worktree /private/tmp/catwalks-teamtailor-attestation
HEAD f49d7a9d830b08a6fe917ac82c65fee40fcfc3de
branch refs/heads/codex/teamtailor-attestation
prunable gitdir file points to non-existent location

worktree /Users/lmelane/.codex/worktrees/lot4-source-validation
HEAD b8c153f36dab79227a3dd2ba4a5d449c064b34eb
detached

worktree /Users/lmelane/Downloads/catwalks-docs-worktree
HEAD 6ccbef66cf51be7ca2bd522c8178dd8583ad9809
branch refs/heads/codex/lot4-final-docs

worktree /Users/lmelane/Downloads/catwalks-p10
HEAD 7cf74cf861bd069ae5f2e88dea0aa4111d9ec4a2
branch refs/heads/p10-optique-pharmacie
```

### PR interrogées

| N° | État | Branche | Titre |
|---|---|---|---|
| [168](https://github.com/lmelane/fr-retail-jobs/pull/168) | OPEN | mesure-vocabulaire-contrat → main | chore: code mort retiré, chiffres périmés remplacés par des mesures (lot 4A) |
| [167](https://github.com/lmelane/fr-retail-jobs/pull/167) | MERGED | mesure-vocabulaire-contrat → main | fix(build): le registre des marchés vit dans packages/db |
| [166](https://github.com/lmelane/fr-retail-jobs/pull/166) | MERGED | mesure-vocabulaire-contrat → main | feat: filtres natifs par pays, et la géographie qui les fonde (D-435/D-436) |
| [165](https://github.com/lmelane/fr-retail-jobs/pull/165) | MERGED | audit-bornes-recherche → main | fix(securite): borner la recherche, et réparer le référentiel des groupes |
| [164](https://github.com/lmelane/fr-retail-jobs/pull/164) | MERGED | nettoyage-code-mort → main | chore: supprimer 173 lignes de code mort |
| [163](https://github.com/lmelane/fr-retail-jobs/pull/163) | MERGED | filtres-cumulables-d426 → main | feat(filtres): les filtres du moteur se cumulent (D-426) |
| [162](https://github.com/lmelane/fr-retail-jobs/pull/162) | MERGED | fix-docker-api → main | fix(docker) — le build vise @catwalks/api : deux déploiements en échec depuis la PR 161 |
| [161](https://github.com/lmelane/fr-retail-jobs/pull/161) | MERGED | front-f1 → main | FRONT F1 — Railway devient une API pure ; catwalks.io porte le front (D-417 à D-422) |
| [160](https://github.com/lmelane/fr-retail-jobs/pull/160) | OPEN | p10-optique-pharmacie → main | Taxonomie v2 — optique et pharmacie au périmètre (décision propriétaire) |
| [159](https://github.com/lmelane/fr-retail-jobs/pull/159) | MERGED | p10-cycles → main | P10 — Blocs 5, 7 et 8 : deux cycles complets, contrôle public 18/18, bilan terminal |
| [158](https://github.com/lmelane/fr-retail-jobs/pull/158) | MERGED | p10-blocs456 → main | P10 — Blocs 3 à 6 : onboarding unique, vague A intégrée, observabilité |
| [157](https://github.com/lmelane/fr-retail-jobs/pull/157) | MERGED | p10-exploitation → main | P10 — Blocs 0 à 2 : photographie, stockage objet prouvé, registre opérationnel 442/442 |
| [156](https://github.com/lmelane/fr-retail-jobs/pull/156) | MERGED | p9-preuve-bot → main | P9 — catwalks.io/bot est publié : le préalable D62 est levé |
| [155](https://github.com/lmelane/fr-retail-jobs/pull/155) | MERGED | p9-bot-doc → main | docs(p9): /bot est servi sur modecareers.com ; catwalks.io/bot reste à publier |
| [154](https://github.com/lmelane/fr-retail-jobs/pull/154) | MERGED | p9-controles-terminaux → main | P9 — contrôles terminaux : verdict complet, idempotence, URLs et descriptions réparées |
| [153](https://github.com/lmelane/fr-retail-jobs/pull/153) | MERGED | p9-description → main | P9 — description complète depuis le JSON-LD de la fiche |
| [152](https://github.com/lmelane/fr-retail-jobs/pull/152) | MERGED | p9-locale → main | P9 — poser localePath sur les sources CareerConnect |
| [151](https://github.com/lmelane/fr-retail-jobs/pull/151) | MERGED | p9-url-identity → main | P9 — URLs publiques corrigées, identité D62 réellement appliquée |
| [150](https://github.com/lmelane/fr-retail-jobs/pull/150) | MERGED | p9-vague-1 → main | P9 — chaîne de certification versionnée, outil de preuve D60, dialecte Phenom CareerConnect |
| [149](https://github.com/lmelane/fr-retail-jobs/pull/149) | MERGED | p8-reserve → main | Réserve opérationnelle : stockage objet distant non provisionné |
| [148](https://github.com/lmelane/fr-retail-jobs/pull/148) | MERGED | p8-closure → main | P8 — clôture : D61 gravée (borne de stockage, concurrence 4, rétention 14 j / 12 mois) |
| [147](https://github.com/lmelane/fr-retail-jobs/pull/147) | MERGED | p8-retention → main | P8 addendum — rétention des observations : politique arbitrée, purge fail-closed, validée |
| [146](https://github.com/lmelane/fr-retail-jobs/pull/146) | MERGED | p8-storage-tenants → main | P8 — enveloppe opérationnelle, A/B tranché, et la vraie borne de capacité |
| [145](https://github.com/lmelane/fr-retail-jobs/pull/145) | MERGED | p8-ab-concurrency → main | P8 — A/B de concurrence, scénario B prouvé, garde 429 réellement armée |
| [144](https://github.com/lmelane/fr-retail-jobs/pull/144) | MERGED | p8-tenant-table → main | P8 — la table des clés de tenant effectives |
| [143](https://github.com/lmelane/fr-retail-jobs/pull/143) | MERGED | p8-429-path → main | P8 — chemin 429 réel, cooldown par tenant, identité fail-closed |
| [142](https://github.com/lmelane/fr-retail-jobs/pull/142) | MERGED | p8-runner-verdict → main | P8 — le verdict terminal du runner, la garde de fusion, et les preuves versionnées |
| [141](https://github.com/lmelane/fr-retail-jobs/pull/141) | MERGED | p8-tenant-protection → main | P8 — limiter par TENANT, archiver les 429, arrêter les mesures au premier |
| [140](https://github.com/lmelane/fr-retail-jobs/pull/140) | MERGED | p8-storage-front → main | P8 — mesurer le stockage et surveiller le front pendant la charge |
| [139](https://github.com/lmelane/fr-retail-jobs/pull/139) | MERGED | p8-phase-timing → main | P8 — chronométrer la collecte et l'écriture séparément, et livrer T0 |
| [138](https://github.com/lmelane/fr-retail-jobs/pull/138) | MERGED | p8-exit-code → main | P8 — un refus doit rester un refus jusqu'à l'appelant |
| [137](https://github.com/lmelane/fr-retail-jobs/pull/137) | MERGED | p8-capacity-report → main | P8 — lire ce qu'une passe a coûté, sans compléter ce qui manque |
| [136](https://github.com/lmelane/fr-retail-jobs/pull/136) | MERGED | p8-instrumentation → main | P8 — télémétrie HTTP par hôte, et les trois corpus figés |
| [135](https://github.com/lmelane/fr-retail-jobs/pull/135) | MERGED | p7-cloture-terminale → main | P7 — clôture terminale : ressources mesurées, sitemap réconcilié, tableau corrigé |
| [134](https://github.com/lmelane/fr-retail-jobs/pull/134) | MERGED | p7-public-chain-reconcile → main | P7 — réconcilier les cinq surfaces publiques, par identifiant |
| [133](https://github.com/lmelane/fr-retail-jobs/pull/133) | MERGED | p7-addendum-terminal → main | P7 — addendum terminal : garde des 5 % réelle, ressources mesurées |
| [132](https://github.com/lmelane/fr-retail-jobs/pull/132) | MERGED | p7-bilan-final → main | P7 — bilan final des deux cycles bornés |
| [131](https://github.com/lmelane/fr-retail-jobs/pull/131) | MERGED | p7-audit-manifest-ceiling → main | P7 — l'audit du refresh mourait, puis mesurait le manifeste à l'envers |
| [130](https://github.com/lmelane/fr-retail-jobs/pull/130) | MERGED | p7-perimetre-deux-cycles → main | P7 — figer le périmètre des deux cycles, source par source |
| [129](https://github.com/lmelane/fr-retail-jobs/pull/129) | MERGED | p7-absent-ids-verification → main | P7 — nommer les identifiants absents, pour qu'une absence se VÉRIFIE |
| [128](https://github.com/lmelane/fr-retail-jobs/pull/128) | MERGED | p7-preflight-disk-guard → main | P7 — le préflight refuse AVANT d'écrire quand le disque manque |
| [127](https://github.com/lmelane/fr-retail-jobs/pull/127) | MERGED | p7-absence-vs-vocabulary → main | P7 — une JobSource absente de la preuve est une disparition, pas une violation |
| [126](https://github.com/lmelane/fr-retail-jobs/pull/126) | MERGED | p7-ops-readme → main | docs(ops) — la chaîne d'un cycle P7 borné |
| [125](https://github.com/lmelane/fr-retail-jobs/pull/125) | MERGED | p7-persistence-contract → main | P7 — contrat de persistance opérationnel et manifeste de refresh figé |
| [124](https://github.com/lmelane/fr-retail-jobs/pull/124) | MERGED | p7-canonical-id-contract → main | P7 — contrat canonique bidirectionnel, et parcours complet ≠ preuve d'absence |
| [123](https://github.com/lmelane/fr-retail-jobs/pull/123) | MERGED | p7-refresh-plan → main | P7 — prouver l'absence par l'ensemble observé, pas par un lastSeenAt ancien |
| [122](https://github.com/lmelane/fr-retail-jobs/pull/122) | MERGED | p7-mecca-dossier → main | P7 — dossier MECCA : alias appliqué et vérifié en production |
| [121](https://github.com/lmelane/fr-retail-jobs/pull/121) | MERGED | p7-ganni-mecca → main | P7 — un défaut d'offre ne réfute plus l'énumération d'une source (GANNI), et l'outil d'alias versionné |
| [120](https://github.com/lmelane/fr-retail-jobs/pull/120) | MERGED | p7-preflight-paths → main | P7 — ancrer le préflight sur la racine du dépôt, et le tester |
| [119](https://github.com/lmelane/fr-retail-jobs/pull/119) | MERGED | p7-preflight-code-scope → main | P7 — le préflight vérifie le CODE de chaque service, pas l'égalité des SHA |
| [118](https://github.com/lmelane/fr-retail-jobs/pull/118) | MERGED | p7-runner → main | P7 — runner d'ingestion bornée versionné dans scripts/ops |
| [117](https://github.com/lmelane/fr-retail-jobs/pull/117) | MERGED | p7-phase0-preparation → main | P7 phase 0 — countryIntegrity persisté, refresh borné, vague initiale prouvée sur clone |
| [116](https://github.com/lmelane/fr-retail-jobs/pull/116) | MERGED | p6-source-register → main | feat(p6): un registre où chaque source a une décision, et le sous-ensemble P7 nommé |
| [115](https://github.com/lmelane/fr-retail-jobs/pull/115) | MERGED | h-geo-01-postal-not-proof → main | fix(seo): H-GEO-01 — un format postal compatible n'est pas une preuve du pays |
| [114](https://github.com/lmelane/fr-retail-jobs/pull/114) | MERGED | p5-postal-proof-doc → main | docs(p5): clore P5, et enregistrer que countryIntegrity doit être PERSISTÉE |
| [113](https://github.com/lmelane/fr-retail-jobs/pull/113) | MERGED | p5-postal-must-confirm → main | fix(seo): un code postal ne prouve le pays que si son format le confirme |
| [112](https://github.com/lmelane/fr-retail-jobs/pull/112) | MERGED | p5-independent-proof-doc → main | docs(p5): prouver la règle de preuve indépendante sur les pages servies, et clore P5 |
| [111](https://github.com/lmelane/fr-retail-jobs/pull/111) | MERGED | p5-independent-country-proof → main | fix(seo): un suffixe égal au code pays n'est pas une preuve du pays |
| [110](https://github.com/lmelane/fr-retail-jobs/pull/110) | MERGED | p5-country-coherence-proof → main | docs(p5): prouver le correctif pays/localisation sur les pages servies |
| [109](https://github.com/lmelane/fr-retail-jobs/pull/109) | MERGED | p5-country-coherence → main | fix(seo): addressCountry est un PAYS, et CA n'est pas la Californie |
| [108](https://github.com/lmelane/fr-retail-jobs/pull/108) | MERGED | p5-final-eligibility-proof → main | test(seo): prouver la porte d'éligibilité sur les pages servies, avant et après |
| [107](https://github.com/lmelane/fr-retail-jobs/pull/107) | MERGED | p5-remote-not-a-place → main | fix(seo): « Remote » n'est pas un lieu, et jamais une addressLocality |
| [106](https://github.com/lmelane/fr-retail-jobs/pull/106) | MERGED | p5-google-eligibility → main | fix(seo): n'émettre un JobPosting que si toutes les conditions requises sont réunies |
| [105](https://github.com/lmelane/fr-retail-jobs/pull/105) | MERGED | p5-public-chain → main | test(web): prouver que la chaîne publique concorde, par ensembles d'identifiants |
| [104](https://github.com/lmelane/fr-retail-jobs/pull/104) | MERGED | p4-proven-only-closure → main | fix(lifecycle): seul un parcours démontré peut fermer une offre |
| [103](https://github.com/lmelane/fr-retail-jobs/pull/103) | MERGED | p4-freshness-lifecycle → main | fix(lifecycle): une énumération inconnue n'est pas une incomplétude prouvée |
| [102](https://github.com/lmelane/fr-retail-jobs/pull/102) | MERGED | p3-reception-harness → main | feat(ops): version the integration harness and prove a validator correction |
| [101](https://github.com/lmelane/fr-retail-jobs/pull/101) | MERGED | codex/lot4-p3-real-integration → main | P3 — les cinq scénarios sur le VRAI processus d'intégration (ingestAllBySource) |
| [100](https://github.com/lmelane/fr-retail-jobs/pull/100) | MERGED | codex/lot4-p3-reception → main | P3 — réception : les cinq scénarios passés avec de vraies écritures sur clones |
| [99](https://github.com/lmelane/fr-retail-jobs/pull/99) | MERGED | codex/lot4-p3-gate → main | P3 — la procédure impose ses garanties, démontré par exécution (porte bloquante, reprise par empreintes, CI verrouillée) |
| [98](https://github.com/lmelane/fr-retail-jobs/pull/98) | MERGED | codex/lot4-p3-common-procedure → main | P3 — la procédure commune de mutation, versionnée dans le dépôt |
| [97](https://github.com/lmelane/fr-retail-jobs/pull/97) | MERGED | codex/lot4-p5-ci-fix → main | test: le catalogue seed compte 82 lignes depuis le retrait de FashionJobs |
| [96](https://github.com/lmelane/fr-retail-jobs/pull/96) | MERGED | codex/lot4-p5-fashionjobs → main | FashionJobs sort du circuit des offres — retrait administratif de 584 offres, découverte préservée |
| [95](https://github.com/lmelane/fr-retail-jobs/pull/95) | MERGED | codex/lot4-p4-detachment-controls → main | LOT P2 — sécuriser le détachement FashionJobs : correspondance annonce/URL, qualité d'attestation, vraies retenues |
| [94](https://github.com/lmelane/fr-retail-jobs/pull/94) | MERGED | codex/lot4-p2-completion → main | LOT P2 — 172 FashionJobs détachées, doublons psycho-bunny instruits |
| [93](https://github.com/lmelane/fr-retail-jobs/pull/93) | MERGED | codex/lot4-p2-completion → main | LOT P2 — descriptions UNIQLO réparées, Talentsoft corrigé dans le chemin réel, retenues prouvées par l'état |
| [92](https://github.com/lmelane/fr-retail-jobs/pull/92) | MERGED | codex/lot4-p2-repairs → main | LOT P2 — les trois réparations instruites, exécutées et vérifiées |
| [91](https://github.com/lmelane/fr-retail-jobs/pull/91) | MERGED | codex/lot4-p2-causes → main | LOT P2 — périmètre complet : causes Talentsoft et Workday corrigées, dossiers instruits |
| [90](https://github.com/lmelane/fr-retail-jobs/pull/90) | MERGED | codex/lot4-p2-reference → main | LOT P2 — garantie d'instantané, périmètres explicites, dossier 640 rouvert, 1 452 offres sans date qualifiées |
| [89](https://github.com/lmelane/fr-retail-jobs/pull/89) | MERGED | codex/lot4-p1-guard → main | LOT P1 — la garde de déploiement n'exempte plus un identifiant de run codé en dur |
| [88](https://github.com/lmelane/fr-retail-jobs/pull/88) | MERGED | codex/lot4-p1-reference → main | LOT P1 — référence datée, dénominateurs réels, aucun défaut arrondi à 100 % |
| [87](https://github.com/lmelane/fr-retail-jobs/pull/87) | MERGED | codex/lot4-final-docs → main | docs(lot4): end of the B6 pass — dossiers, offline verifier, five states, uncertified families, ATS knowledge |
| [86](https://github.com/lmelane/fr-retail-jobs/pull/86) | MERGED | codex/lot4-b6-classifier → main | fix(identity): logo-alt artefacts (underscores, dimensions); Maison legal form ignored in label classification |
| [85](https://github.com/lmelane/fr-retail-jobs/pull/85) | MERGED | codex/lot4-b6-docs → main | docs(lot4): secured B6 procedure, retrospective controls, repairs, unique inventory |
| [84](https://github.com/lmelane/fr-retail-jobs/pull/84) | MERGED | codex/lot4-b6-controls → main | fix(identity): certified owner = catalogued Maison; explicit robots/perimeter checks; Greenhouse country |
| [83](https://github.com/lmelane/fr-retail-jobs/pull/83) | MERGED | codex/lot4-b6-tooling → main | feat(coverage): validate-candidate for the DRAFT → review → promote path; Lever country + workplace type |
| [82](https://github.com/lmelane/fr-retail-jobs/pull/82) | MERGED | codex/lot4-docs-20260910 → main | docs(lot4): reprise du 10/09 — README, checklist de clôture, B6, rapprochement découverte, tracker v10, racine rangée |
| [81](https://github.com/lmelane/fr-retail-jobs/pull/81) | MERGED | codex/lot4-certification-foundations → main | fix(identity): one certification contract (ingest, promotion, tracker); SINGLE_BRAND contradiction; stale receipts unproven |
| [80](https://github.com/lmelane/fr-retail-jobs/pull/80) | MERGED | codex/lot4-owner-review-ids → main | fix(remediation): reviewed posting ids up to 200 characters (Workday slugs) |
| [79](https://github.com/lmelane/fr-retail-jobs/pull/79) | MERGED | codex/lot4-aggregator-cleanup → main | chore(aggregator): separate application / references / scripts / archives, Docker preflight, layout check |
| [78](https://github.com/lmelane/fr-retail-jobs/pull/78) | MERGED | codex/lot4-b6-preparation → main | feat(pipeline): sector-perimeter decision per posting + Workday banner from store code (B6 preparation) |
| [77](https://github.com/lmelane/fr-retail-jobs/pull/77) | MERGED | codex/lot4-market-coverage → main | docs(lot4): qualification 2026-09-10 (second brief) — lots L1–L7, Tapestry partition, certifications, tracker v9, D59 |
| [76](https://github.com/lmelane/fr-retail-jobs/pull/76) | MERGED | codex/lot4-workday-partition → main | feat(workday): partition a board by facet (Tapestry: capped total, brand attribution) |
| [75](https://github.com/lmelane/fr-retail-jobs/pull/75) | MERGED | codex/lot4-market-coverage → main | feat(identity): certified SINGLE_BRAND portal → owner; Workday distinct path-less rows |
| [74](https://github.com/lmelane/fr-retail-jobs/pull/74) | MERGED | codex/lot4-market-coverage → main | fix(adapters): enumeration proofs on real boards (publisher count, identical page, language variants, shifted second sweep) |
| [73](https://github.com/lmelane/fr-retail-jobs/pull/73) | MERGED | codex/lot4-market-coverage → main | docs(audit): 2026-09-10 qualification pass — proofs, per-source table, D58 |
| [72](https://github.com/lmelane/fr-retail-jobs/pull/72) | MERGED | codex/lot4-market-coverage → main | feat(coverage): per-source table, diffusion gap rule, Aptar sheet v2, portfolio research |
| [71](https://github.com/lmelane/fr-retail-jobs/pull/71) | MERGED | codex/lot4-market-coverage → main | docs(audit): evening framing applied from archives — proof dimensions, decisions, live-control list |
| [70](https://github.com/lmelane/fr-retail-jobs/pull/70) | MERGED | codex/lot4-market-coverage → main | fix(identity): recorded group label keeps the house even without an earlier observation |
| [69](https://github.com/lmelane/fr-retail-jobs/pull/69) | MERGED | codex/lot4-market-coverage → main | fix(identity): supersede a reviewed alias explicitly; lean identity snapshot |
| [68](https://github.com/lmelane/fr-retail-jobs/pull/68) | MERGED | codex/lot4-market-coverage → main | feat(identity): group label keeps the house; certified single-brand scope; sub-labels distinct; Workday logo alt; proof dimensions |
| [67](https://github.com/lmelane/fr-retail-jobs/pull/67) | MERGED | codex/lot4-market-coverage → main | fix(pipeline): explained rejected rows are not errors; aliases/sitemaps proofs; tracker v6; D57 |
| [66](https://github.com/lmelane/fr-retail-jobs/pull/66) | MERGED | codex/lot4-market-coverage → main | fix(ats): rejected rows are witnesses; sitemap <loc> decoded; Eightfold enumeration proof |
| [65](https://github.com/lmelane/fr-retail-jobs/pull/65) | MERGED | codex/lot4-market-coverage → main | docs(audit): corrected-families bounded run; identity gate blocks new postings on uncertified sources |
| [64](https://github.com/lmelane/fr-retail-jobs/pull/64) | MERGED | codex/lot4-market-coverage → main | fix(ats): named enumeration deficits — Workday path-less rows, Phenom repeated ids, Swatch rejected details |
| [63](https://github.com/lmelane/fr-retail-jobs/pull/63) | MERGED | codex/lot4-market-coverage → main | fix(ats): Workday enumeration proof (pages, repeated ids, path-less rows) |
| [62](https://github.com/lmelane/fr-retail-jobs/pull/62) | MERGED | codex/lot4-market-coverage → main | docs(audit): URBN shared hub — production repair and bounded run proofs |
| [61](https://github.com/lmelane/fr-retail-jobs/pull/61) | MERGED | codex/lot4-market-coverage → main | fix(pipeline): interrupted runs closed, brand credited from the posting page on shared portals (URBN hub) |
| [60](https://github.com/lmelane/fr-retail-jobs/pull/60) | MERGED | codex/lot4-market-coverage → main | fix(ats): enumeration proofs for Rituals, Phenom and the generic connector; tracker v5 |
| [59](https://github.com/lmelane/fr-retail-jobs/pull/59) | MERGED | codex/lot4-market-coverage → main | fix(ats): Talentsoft RSS ids, iCIMS page-count proof, resumable orchestrator |
| [58](https://github.com/lmelane/fr-retail-jobs/pull/58) | MERGED | codex/lot4-market-coverage → main | fix(ats): DigitalRecruiters diffusions vs announcements, proven enumeration |
| [57](https://github.com/lmelane/fr-retail-jobs/pull/57) | MERGED | codex/lot4-market-coverage → main | docs(audit): OTB/Aptar + Personio production proofs; tracker receipt ordering fix |
| [56](https://github.com/lmelane/fr-retail-jobs/pull/56) | MERGED | codex/lot4-market-coverage → main | feat(identity): brand attribution on shared portals (OTB, Aptar) + Sport 1 proofs |
| [55](https://github.com/lmelane/fr-retail-jobs/pull/55) | MERGED | codex/lot4-market-coverage → main | feat(coverage): qualification tracker (seven verdicts), Lindex proofs, Sport 1 rehearsal |
| [54](https://github.com/lmelane/fr-retail-jobs/pull/54) | MERGED | codex/lot4-market-coverage → main | feat(coverage): EasyCruit (Lindex), CLDR territory variants, Nordic employment vocabulary |
| [53](https://github.com/lmelane/fr-retail-jobs/pull/53) | MERGED | codex/lot4-market-coverage → main | Gate web deployment on its complete database migration contract |
| [52](https://github.com/lmelane/fr-retail-jobs/pull/52) | MERGED | codex/lot4-market-coverage → main | Qualify Talent Recruiter and withdraw invalid career-board content |
| [51](https://github.com/lmelane/fr-retail-jobs/pull/51) | MERGED | codex/lot4-market-coverage → main | Qualify Harri coverage and separate proven employer homonyms |
| [50](https://github.com/lmelane/fr-retail-jobs/pull/50) | MERGED | codex/lot4-market-coverage → main | Séparer retrait du catalogue et fermeture employeur |
| [49](https://github.com/lmelane/fr-retail-jobs/pull/49) | MERGED | codex/lot4-market-coverage → main | Lot 4: reliable ATS enumeration and reviewed portal ownership repairs |
| [48](https://github.com/lmelane/fr-retail-jobs/pull/48) | MERGED | codex/lot3-production-proof → main | Lot 3: preuves de réparation et de déploiement en production |
| [47](https://github.com/lmelane/fr-retail-jobs/pull/47) | MERGED | codex/lot3-sector-evidence → main | Lot 3: qualifier 12 employeurs depuis leurs sources officielles |
| [46](https://github.com/lmelane/fr-retail-jobs/pull/46) | MERGED | codex/lot3-contracts-sectors → main | Lot 3: contrats localisés et secteurs multiples documentés |
| [45](https://github.com/lmelane/fr-retail-jobs/pull/45) | MERGED | codex/lot2-production-proof → main | Lot 2: preuves de production et bilan de couverture métier |
| [44](https://github.com/lmelane/fr-retail-jobs/pull/44) | MERGED | codex/lot2-occupation-taxonomy → main | Lot 2: canonisation métier versionnée, traçable et partagée avec le front |
| [43](https://github.com/lmelane/fr-retail-jobs/pull/43) | MERGED | codex/lot1-business-identity-receipts → main | Documenter les distinctions métier et les preuves production du lot BZB |
| [42](https://github.com/lmelane/fr-retail-jobs/pull/42) | MERGED | codex/lot1-canonical-lifecycle → main | Use canonical postings for lifecycle and invalidate corrected aggregates |
| [41](https://github.com/lmelane/fr-retail-jobs/pull/41) | MERGED | codex/lot1-posting-conservation → main | Preserve posting identities across reviewed employer consolidation |
| [40](https://github.com/lmelane/fr-retail-jobs/pull/40) | MERGED | codex/lot1-production-proof → main | Record Lot 1 production proofs and explicit remaining work |
| [39](https://github.com/lmelane/fr-retail-jobs/pull/39) | MERGED | codex/lot1-native-employer-evidence → main | Read native ATS employer evidence and document Lot 1 production repairs |
| [38](https://github.com/lmelane/fr-retail-jobs/pull/38) | MERGED | codex/lot1-employer-identity → main | Employer identity: reviewed aliases, guarded merges and evidence |
| [37](https://github.com/lmelane/fr-retail-jobs/pull/37) | MERGED | codex/lot0-production-proof → main | Record production proof for durable worker observability |
| [36](https://github.com/lmelane/fr-retail-jobs/pull/36) | MERGED | codex/lot0-observability → main | Make worker diagnostics durable and prevent Railway log saturation |
| [35](https://github.com/lmelane/fr-retail-jobs/pull/35) | MERGED | codex/readiness-production-proof → main | Fix archived career discovery and prove production repairs |
| [34](https://github.com/lmelane/fr-retail-jobs/pull/34) | MERGED | codex/france-derived-flag → main | Fix France filter drift when reobservations omit country |
| [33](https://github.com/lmelane/fr-retail-jobs/pull/33) | MERGED | codex/talentview-pagination → main | Fix TalentView first-page truncation across all public websites |
| [32](https://github.com/lmelane/fr-retail-jobs/pull/32) | MERGED | codex/production-proof-20260909 → main | Prove Douglas date repair and track worldwide portal qualification |
| [31](https://github.com/lmelane/fr-retail-jobs/pull/31) | MERGED | codex/run-integrity → main | Make collection failures diagnosable and verify L'Oréal pagination |
| [30](https://github.com/lmelane/fr-retail-jobs/pull/30) | MERGED | codex/teamtailor-attestation → main | Verify Teamtailor feed completion before attesting missing jobs |
| [29](https://github.com/lmelane/fr-retail-jobs/pull/29) | MERGED | codex/rmk-publication-dates → main | Correct Douglas publication dates using the recorded RMK locale |
| [28](https://github.com/lmelane/fr-retail-jobs/pull/28) | MERGED | codex/jobaffinity-production-proof → main | Record verified production results for Intersport and Blackstore |
| [27](https://github.com/lmelane/fr-retail-jobs/pull/27) | MERGED | codex/jobaffinity-direct-portals → main | Verify and integrate Intersport and Blackstore direct recruitment sources |
| [26](https://github.com/lmelane/fr-retail-jobs/pull/26) | MERGED | codex/google-jobs-source-dates → main | Recover original employer publication dates and stop inventing Google dates |
| [25](https://github.com/lmelane/fr-retail-jobs/pull/25) | MERGED | codex/fashionjobs-world-directories → main | Certify worldwide directory parsing and preserve reviewed employer groups |
| [24](https://github.com/lmelane/fr-retail-jobs/pull/24) | MERGED | codex/flatchr-direct-coverage → main | Ingest verified Flatchr employers worldwide with enumeration evidence |
| [23](https://github.com/lmelane/fr-retail-jobs/pull/23) | MERGED | codex/fashionjobs-coverage-proof-20260908 → main | Record FashionJobs discovery delivery evidence |
| [22](https://github.com/lmelane/fr-retail-jobs/pull/22) | MERGED | codex/fashionjobs-coverage-20260908 → main | Audit 749 employers and use FashionJobs for discovery only |
| [21](https://github.com/lmelane/fr-retail-jobs/pull/21) | MERGED | codex/production-proof-20260908 → main | Documenter les réparations prouvées en production et les lacunes France |
| [20](https://github.com/lmelane/fr-retail-jobs/pull/20) | MERGED | codex/remediation-data-20260908 → main | Corriger les identités P0 et exiger une preuve employeur avant activation |
| [19](https://github.com/lmelane/fr-retail-jobs/pull/19) | MERGED | codex/production-hardening-20260908 → main | Record verified production release and remaining readiness gates |
| [18](https://github.com/lmelane/fr-retail-jobs/pull/18) | MERGED | codex/production-hardening-20260908 → main | Patch vulnerable dependencies and gate CI security audits |
| [17](https://github.com/lmelane/fr-retail-jobs/pull/17) | MERGED | codex/production-hardening-20260908 → main | Harden canonical ingestion, lifecycle and production deployment |
| [16](https://github.com/lmelane/fr-retail-jobs/pull/16) | MERGED | aggregator/validation → main | Rebranding Mode Careers (D31) + snapshot données J3 |
| [15](https://github.com/lmelane/fr-retail-jobs/pull/15) | MERGED | aggregator/validation → main | fix sitemap: force-dynamic (404 prérendu au build) |
| [14](https://github.com/lmelane/fr-retail-jobs/pull/14) | MERGED | aggregator/validation → main | Écarts vérification live: sitemap chunké, robots runtime, compteur, liens canoniques |
| [13](https://github.com/lmelane/fr-retail-jobs/pull/13) | MERGED | aggregator/validation → main | Lot 2 (partiel) + domaine modecareers.com |
| [12](https://github.com/lmelane/fr-retail-jobs/pull/12) | MERGED | aggregator/validation → main | Lot 1 (suite): S-01/S-02a/S-02b/DEC-1 — URLs slug+301, JSON-LD, promesse-compteur |
| [11](https://github.com/lmelane/fr-retail-jobs/pull/11) | MERGED | aggregator/validation → main | Chantier aggregator/validation — vague 1 + Lot 0 (DEC-3/DEC-5/DEC-4/L-01/L-02/N-07) |
| [10](https://github.com/lmelane/fr-retail-jobs/pull/10) | CLOSED | fix/s01-offer-links → main | fix(web): S-01 — les fiches offres ne sont plus orphelines (vrais liens + offres similaires) |
| [9](https://github.com/lmelane/fr-retail-jobs/pull/9) | MERGED | fix/css-comment-eats-fontface → main | fix(web): un '*/' piégé dans un commentaire avalait le @font-face FA Display |
| [8](https://github.com/lmelane/fr-retail-jobs/pull/8) | MERGED | fix/fonts-ffmodern → main | fix(web): vraie font FF Modern + reveal au scroll (fidélité corporate.lacoste.com) |
| [7](https://github.com/lmelane/fr-retail-jobs/pull/7) | MERGED | fix/front-qa-gaps → main | fix(web): audit front A→Z — suggestions visibles + container-wide + home autocomplete |
| [4](https://github.com/lmelane/fr-retail-jobs/pull/4) | MERGED | refonte/corporate-elegance-ui → main | Refonte UI — « Corporate Elegance » (Fashion Atlas) |
| [3](https://github.com/lmelane/fr-retail-jobs/pull/3) | MERGED | docs/git-rules → main | docs: règles git multi-sessions dans CLAUDE.md |
| [2](https://github.com/lmelane/fr-retail-jobs/pull/2) | MERGED | docs/suggest-comment-world-scope → main | docs(web): commentaire suggestCities aligné sur D19 (monde, plus D12) |
| [1](https://github.com/lmelane/fr-retail-jobs/pull/1) | CLOSED | fix/jsonld-address-country → main | fix(web): JSON-LD addressCountry = pays réel de l'offre (jamais FR en dur) |

Le fichier de preuve conserve également les empreintes des fichiers déjà modifiés. Aucun de ces fichiers n’a changé pendant l’audit.

## catwalks-website

Dépôt local : `/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-website`.

### État initial détaillé

```text
## front-f1-sauvegarde...origin/front-f1-sauvegarde [ahead 12]
 M next.config.mjs
 M src/app/cgu/page.tsx
 M src/app/confidentialite/page.tsx
 M src/app/mentions-legales/page.tsx
 M src/lib/emplois/__tests__/marches-parite-amont.test.ts
 M src/lib/emplois/__tests__/suggest-villes-marche.test.ts
?? src/components/legal/AvertissementLegal.tsx
?? src/lib/langue/__tests__/legal.test.ts
?? src/lib/langue/legal/en.ts
?? src/lib/langue/legal/fr.ts
?? src/lib/langue/legal/index.ts
```

### Remotes

```text
origin	https://github.com/lmelane/catwalks-front-end.git (fetch)
origin	https://github.com/lmelane/catwalks-front-end.git (push)
```

### Toutes les références : branche | SHA | upstream | divergence

```text
catwalks-front-end|fea44801dcf7f7f558e7354e48fa23ab3e6f97de||
front-f1-sauvegarde|cd25cefe18cd0a553c09bd17a38c0f4bd438c3c6|origin/front-f1-sauvegarde|[ahead 12]
main|ef8e1c63b54ed25a973defc9801fe3bc4f9fbc11|origin/main|[behind 1]
marches-d433|c56a5f7a5e7bd8dcb30d43a443cc5fe6475dd2a4|origin/marches-d433|[gone]
retour-avant-front-f1|bccf5412be32ab87b14974a2033c8f0a42a4ed2d|origin/main|
origin|bccf5412be32ab87b14974a2033c8f0a42a4ed2d||
origin/front-f1-sauvegarde|ef8e1c63b54ed25a973defc9801fe3bc4f9fbc11||
origin/main|bccf5412be32ab87b14974a2033c8f0a42a4ed2d||
```

### HEAD contre origin/main : propres à HEAD / propres à main

```text
12	1
```

### Commits de HEAD absents de toutes les références distantes

```text
cd25cef fix(marches): les facettes affichées REFLÈTENT la couverture amont, elles ne la décident plus
c54b937 feat: libellés de filtres natifs par marché, plus de français en dur
eeccd30 fix(marches): le titre du bloc de temoins nomme aussi la Chine
375ee61 feat(marches): ouvrir le marche CHINE, sans contrat ni rythme
0abad0f feat(marches): ouvrir CA, NL et AU — 6 212 offres redeviennent accessibles
0b55526 feat(suggest): transmettre le marché aux suggestions de ville (D-433)
3bb8265 fix(langue): la marque non validée reste en français, elle ne part pas traduite
3660eb0 fix(langue): brancher la composition langue × marché, qui ne tournait jamais
4138811 chore(langue): retirer next-intl, installé mais jamais importé
41765cc fix(langue): brancher ce qui doit l'être, documenter ce qui ne doit pas
3e8bf69 feat(langue): l'axe LANGUE, distinct du marché, sans redirection
a24e472 feat(marches): le sélecteur de marché, avec ses drapeaux (D-433, option A)
```

### Commits locaux absents des références distantes, toutes branches confondues

```text
cd25cef fix(marches): les facettes affichées REFLÈTENT la couverture amont, elles ne la décident plus
c54b937 feat: libellés de filtres natifs par marché, plus de français en dur
eeccd30 fix(marches): le titre du bloc de temoins nomme aussi la Chine
375ee61 feat(marches): ouvrir le marche CHINE, sans contrat ni rythme
0abad0f feat(marches): ouvrir CA, NL et AU — 6 212 offres redeviennent accessibles
0b55526 feat(suggest): transmettre le marché aux suggestions de ville (D-433)
3bb8265 fix(langue): la marque non validée reste en français, elle ne part pas traduite
3660eb0 fix(langue): brancher la composition langue × marché, qui ne tournait jamais
4138811 chore(langue): retirer next-intl, installé mais jamais importé
41765cc fix(langue): brancher ce qui doit l'être, documenter ce qui ne doit pas
3e8bf69 feat(langue): l'axe LANGUE, distinct du marché, sans redirection
a24e472 feat(marches): le sélecteur de marché, avec ses drapeaux (D-433, option A)
c56a5f7 docs(marches): ne pas affirmer l'origine du vide, seulement la couverture
1b12f0a feat(marches): la couche de marché, sans toucher au catalogue (D-433)
```

### Branches sans ascendance dans origin/main

```text
* front-f1-sauvegarde
  marches-d433
```

### Worktrees enregistrés

```text
worktree /Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-website
HEAD cd25cefe18cd0a553c09bd17a38c0f4bd438c3c6
branch refs/heads/front-f1-sauvegarde
```

### PR interrogées

| N° | État | Branche | Titre |
|---|---|---|---|

Le fichier de preuve conserve également les empreintes des fichiers déjà modifiés. Aucun de ces fichiers n’a changé pendant l’audit.

## catwalks-backend

Dépôt local : `/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-backend`.

### État initial détaillé

```text
## main...origin/main
 M docs/governance/DECISIONS.md
 M prisma/schema.prisma
?? prisma/migrations/20260914135914_anciens_slugs_d425/migration.sql
?? scripts/rattacher-maisons-d424.mjs
```

### Remotes

```text
origin	https://github.com/lmelane/catwalks-back-end.git (fetch)
origin	https://github.com/lmelane/catwalks-back-end.git (push)
```

### Toutes les références : branche | SHA | upstream | divergence

```text
main|63f61fa2cdd0598df8a59c2fe49bed73e8b68a5e|origin/main|
origin|63f61fa2cdd0598df8a59c2fe49bed73e8b68a5e||
origin/main|63f61fa2cdd0598df8a59c2fe49bed73e8b68a5e||
```

### HEAD contre origin/main : propres à HEAD / propres à main

```text
0	0
```

### Commits de HEAD absents de toutes les références distantes

```text
(aucun)
```

### Commits locaux absents des références distantes, toutes branches confondues

```text
(aucun)
```

### Branches sans ascendance dans origin/main

```text
(aucun)
```

### Worktrees enregistrés

```text
worktree /Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-backend
HEAD 63f61fa2cdd0598df8a59c2fe49bed73e8b68a5e
branch refs/heads/main
```

### PR interrogées

| N° | État | Branche | Titre |
|---|---|---|---|

Le fichier de preuve conserve également les empreintes des fichiers déjà modifiés. Aucun de ces fichiers n’a changé pendant l’audit.

## catwalks-back-office

Dépôt local : `/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-back-office`.

### État initial détaillé

```text
## main...origin/main
```

### Remotes

```text
origin	https://github.com/lmelane/catwalks-backoffice.git (fetch)
origin	https://github.com/lmelane/catwalks-backoffice.git (push)
```

### Toutes les références : branche | SHA | upstream | divergence

```text
main|75c594bc444c34fdad0c9b1d3312d99f8f23322c|origin/main|
origin|75c594bc444c34fdad0c9b1d3312d99f8f23322c||
origin/main|75c594bc444c34fdad0c9b1d3312d99f8f23322c||
```

### HEAD contre origin/main : propres à HEAD / propres à main

```text
0	0
```

### Commits de HEAD absents de toutes les références distantes

```text
(aucun)
```

### Commits locaux absents des références distantes, toutes branches confondues

```text
(aucun)
```

### Branches sans ascendance dans origin/main

```text
(aucun)
```

### Worktrees enregistrés

```text
worktree /Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-back-office
HEAD 75c594bc444c34fdad0c9b1d3312d99f8f23322c
branch refs/heads/main
```

### PR interrogées

| N° | État | Branche | Titre |
|---|---|---|---|

Le fichier de preuve conserve également les empreintes des fichiers déjà modifiés. Aucun de ces fichiers n’a changé pendant l’audit.

## catwalksmedia

Dépôt local : `/Users/lmelane/Desktop/catwalksmedia-system/catwalksmedia`.

### État initial détaillé

```text
## main...origin/main
 M newsroom/package.json
 M newsroom/scripts/shadow-search-intent-radar.mjs
 M newsroom/src/console-server.mjs
 M newsroom/src/journal-server.mjs
 M newsroom/src/lib/journal-public.mjs
 M website/src/app/api/revalidate/route.ts
 M website/src/app/layout.tsx
 M website/src/app/sitemap.ts
 M website/src/components/ArticlePage.tsx
 M website/src/lib/article-ou-remplacant.ts
 M website/src/lib/press-api.ts
 M website/src/lib/taxonomy.ts
 M website/src/lib/types.ts
 M website/tests/liens-cibles-vivantes.test.mjs
?? PATRON-ARTICLE-EVENEMENTIEL.md
?? newsroom/migrations/025_article_translations.down.sql
?? newsroom/migrations/025_article_translations.up.sql
?? newsroom/scripts/etat-avant-025.mjs
?? newsroom/scripts/temoin-pfw-publication-anticipee-2026-09-07.mjs
?? newsroom/src/lib/translate-article.mjs
?? newsroom/src/lib/translation-rules.mjs
?? newsroom/src/traduire-stock.mjs
?? newsroom/src/verif-parite-traduction.mjs
?? newsroom/tests/54-traduction-en.test.mjs
?? redactions/2026-09-09-article-diplome-travailler-dans-le-luxe.md
?? redactions/2026-09-09-article-soin-visage-givenchy.md
?? redactions/2026-09-14-article1-calendrier-pfw.md
?? redactions/2026-09-16-article2-maisons-defiles-pfw.md
?? redactions/2026-09-18-article3-donnees-emploi-catwalks.md
?? redactions/article-diplome-luxe-v1-corps.md
?? redactions/article-givenchy-soin-v1-corps.md
?? redactions/article1-v2-corps.md
?? redactions/article1-v3-corps.md
?? redactions/article2-v2-corps.md
?? redactions/article3-v1-corps.md
?? redactions/hero-article3-apercu.png
?? redactions/hero-article3-data-catwalks.svg
?? website/src/app/en/business/[slug]/page.tsx
?? website/src/app/en/career/[slug]/page.tsx
?? website/src/components/LangueDocument.tsx
```

### Remotes

```text
origin	https://github.com/lmelane/catwalksmedia.git (fetch)
origin	https://github.com/lmelane/catwalksmedia.git (push)
```

### Toutes les références : branche | SHA | upstream | divergence

```text
emploi-remonte-2026-08-09|19cf03806acd7dc9f2b51adaf30e0d921e9dea36||
main|086f75c154c7eea619abc424e7323a2bec39d738|origin/main|
refonte-une-2026-08-09|05481bce2576a01d64c897ac7a25640731e9f0d4||
security-audit-2026-08-06|4e1c26a16c238c35506bddc13b66ee630bccdff9||
origin|086f75c154c7eea619abc424e7323a2bec39d738||
origin/main|086f75c154c7eea619abc424e7323a2bec39d738||
```

### HEAD contre origin/main : propres à HEAD / propres à main

```text
0	0
```

### Commits de HEAD absents de toutes les références distantes

```text
(aucun)
```

### Commits locaux absents des références distantes, toutes branches confondues

```text
(aucun)
```

### Branches sans ascendance dans origin/main

```text
(aucun)
```

### Worktrees enregistrés

```text
worktree /Users/lmelane/Desktop/catwalksmedia-system/catwalksmedia
HEAD 086f75c154c7eea619abc424e7323a2bec39d738
branch refs/heads/main
```

### PR interrogées

| N° | État | Branche | Titre |
|---|---|---|---|

Le fichier de preuve conserve également les empreintes des fichiers déjà modifiés. Aucun de ces fichiers n’a changé pendant l’audit.
