# sioux : requalification préparée le 03/10/2026 (D-522 §6). À BLANC : rien n'a été écrit en production.
# Prérequis : l'image du worker porte le commit c53a704 (lecteur générique + relecture de validation du zéro natif) ;
# sans lui, la collecte reste non prouvée et la validation refuse EMPTY_FEED_NOT_NATIVELY_PROVEN.

# 0. Révision lue en base le 03/10/2026 (lecture seule) ; la relire juste avant, elle doit être inchangée :
#      17436def-b126-41d9-a7ff-c226a279a2bf  (v3, config {"startUrl": ...})
python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -XAt -c "select \"currentRevisionId\", config::text from \"Source\" where key='"'"'sioux'"'"'"'

# 1. Configuration relue (aperçu gardé dans inspection-corriger-sources-relues.txt), puis application, GO requis :
python3 apps/aggregator/scripts/ops/db.py readonly npx tsx apps/aggregator/scripts/ops/corriger-sources-relues.mts audits/2026-10-03/stock-exceptions/sioux/registre-relu-sioux.csv
python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/scripts/ops/corriger-sources-relues.mts audits/2026-10-03/stock-exceptions/sioux/registre-relu-sioux.csv --ecrire

# 2. La révision à requalifier (v4), relue après l'écriture, jamais devinée : sa configuration porte la phrase relue.
python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -XAt -c "select id, version, payload->'"'"'config'"'"'->>'"'"'emptyListingText'"'"' from \"SourceRevision\" where \"sourceKey\"='"'"'sioux'"'"' order by version desc limit 1"'
#      attendu : <UUID_V4> | 4 | Derzeit haben wir keine offenen Stellen.

# 3. AVANT la réouverture, retrait des 19 offres homonymes (Sioux Technologies, révision v1 Recruitee) : arbitrage du CTO,
#    D-522 §6. Plan relu, tout ou rien, sans suppression : JobSource inactives, Job retirées IDENTITY_CONTRADICTED (événement
#    WITHDRAWN, aucune fermeture d'employeur), source et Société de la Maison intactes. Le plan se RÉGÉNÈRE juste avant
#    d'appliquer (images avant à jour) ; inspection du 03/10/2026 : 38 opérations (19 JobSource + 19 Job), une Société
#    (cmtlyhz0u04bgqf5kswsphz11, Sioux, sioux.de) seulement verrouillée, inspection-retrait-homonyme.txt.
python3 apps/aggregator/scripts/ops/db.py readonly npx tsx apps/aggregator/src/remediation/cli.ts plan-homonym-representations \
  --spec audits/2026-10-03/stock-exceptions/sioux/retrait-homonyme-spec.json --out /tmp/plan-sioux-homonyme.json
#    puis, GO requis, depuis le checkout committé et ancêtre d'origin/main (garde de `cli.ts apply`) :
# python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/src/remediation/cli.ts apply \
#   --plan /tmp/plan-sioux-homonyme.json --sha <hash imprimé à la génération> --commit <SHA du checkout>
python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -XAt -c "select count(*) filter (where js.\"isActive\"), count(*) from \"JobSource\" js where js.\"sourceKey\"='"'"'sioux'"'"' and js.url like '"'"'https://jobs.sioux.asia/%'"'"'"'
#      attendu avant : 19|19 ; après : 0|19

# 4. Réouverture en ACTIVE sur le zéro prouvé (D-523 : zéro offre est un état normal), mode `reouvrir` de release.py :
#    source-add --key=sioux --registered-revision=<UUID_V4> --official-domain=sioux.de --reviewer=<relecteur>
# Attendu : validation VALIDATED, report.nativeEmpty = true, observed 0 ; collecte OK « éditeur : zéro annoncé ».
