# ghost : requalification préparée le 03/10/2026 (D-522 §6). À BLANC : rien n'a été écrit en production.
# Prérequis : l'image du worker porte le commit c53a704 (lecteur générique + relecture de validation du zéro natif) ;
# sans lui, la collecte reste non prouvée et la validation refuse EMPTY_FEED_NOT_NATIVELY_PROVEN.

# 0. Révision lue en base le 03/10/2026 (lecture seule) ; la relire juste avant, elle doit être inchangée :
#      eaedf779-8e01-411d-a69a-f693552263a3  (v3, config {"startUrl": ...})
python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -XAt -c "select \"currentRevisionId\", config::text from \"Source\" where key='"'"'ghost'"'"'"'

# 1. Configuration relue (aperçu gardé dans inspection-corriger-sources-relues.txt), puis application, GO requis :
python3 apps/aggregator/scripts/ops/db.py readonly npx tsx apps/aggregator/scripts/ops/corriger-sources-relues.mts audits/2026-10-03/stock-exceptions/ghost/registre-relu-ghost.csv
python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/scripts/ops/corriger-sources-relues.mts audits/2026-10-03/stock-exceptions/ghost/registre-relu-ghost.csv --ecrire

# 2. La révision à requalifier (v4), relue après l'écriture, jamais devinée : sa configuration porte la phrase relue.
python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -XAt -c "select id, version, payload->'"'"'config'"'"'->>'"'"'emptyListingText'"'"' from \"SourceRevision\" where \"sourceKey\"='"'"'ghost'"'"' order by version desc limit 1"'
#      attendu : <UUID_V4> | 4 | Although we do not have current openings

# 3. Réouverture (qualification native, décision d'accès, promotion, ingestion), mode `reouvrir` de release.py :
#    source-add --key=ghost --registered-revision=<UUID_V4> --official-domain=ghostfashion.com --reviewer=<relecteur>
# Attendu : validation VALIDATED, report.nativeEmpty = true, observed 0 ; collecte OK « éditeur : zéro annoncé » ;
# aucune offre servie, rien à fermer.
