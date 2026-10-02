#!/bin/sh
# Preuve d'exécution du lock_timeout des migrations r6, sur une base JETABLE (conteneur docker preuve-verrou-r6,
# 127.0.0.1 seulement). Refuse toute autre cible. Étape : $1 = 140 | 210.
set -u
S=<scratchpad>
G=$S/r6-gel; P=$S/preuve-verrou; U=$(cat $P/url.private)
case "$U" in postgresql://postgres:*@127.0.0.1:32910/postgres) ;; *) echo "cible refusée"; exit 1;; esac
M=$G/packages/db/prisma/migrations
if [ "$1" = 140 ]; then
  for d in 20261002140000_r143_disponibilite_autorite 20261002180000_couverture_photographie 20261002190000_lecture_unique_adoption 20261002200000_registre_explicite 20261002203000_etat_operationnel_sources; do cp -R $M/$d $P/prisma/migrations/; done
  TABLE='"JobSource"'; MODE='ACCESS SHARE'
else
  cp -R $M/20261002210000_file_identite_employeur $P/prisma/migrations/
  TABLE='"EmployerObservation"'; MODE='ROW EXCLUSIVE'
fi
psql "$U" -XAtc "BEGIN; LOCK TABLE $TABLE IN $MODE MODE; SELECT pg_sleep(30); COMMIT;" > $P/verrou-$1.out 2>&1 &
sleep 2
cd $G
t0=$(date +%s)
DATABASE_URL=$U DIRECT_URL=$U npx prisma migrate deploy --schema $P/prisma/schema.prisma > $P/essai-$1.out 2>&1
echo "deploy sous verrou : code=$? duree=$(( $(date +%s) - t0 ))s"
grep -iE "lock timeout|canceling|error:|P3018|applied" $P/essai-$1.out | head -5
psql "$U" -XAtc "select migration_name, finished_at is not null as fini, rolled_back_at is not null as annule from _prisma_migrations where migration_name >= '20261002140000' order by 1"
wait
