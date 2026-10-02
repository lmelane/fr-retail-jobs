#!/bin/sh
# R-143 §1 — chaque témoin de la passe légère passe au rouge quand son défaut est réintroduit.
# Rejouer depuis la racine du dépôt, avec DATABASE_URL vers une base de test migrée : sh audits/2026-10-02/cadence-r143/mutations.sh
# Chaque mutation est appliquée sur une copie de sauvegarde puis le fichier est restauré à l'octet près (jamais git checkout).
set -u
F=apps/aggregator/src/pipeline/lightPass.ts R=packages/runtime/index.mjs
cp "$F" "$F.orig"; cp "$R" "$R.orig"
run() { echo "--- $1"; (cd apps/aggregator && npx vitest run src/pipeline/lightPass.test.ts 2>&1 | grep -E '×|Tests ' ); cp "$F.orig" "$F"; }
python3 - "$F" <<'P'
import sys; p=sys.argv[1]; s=open(p).read()
s=s.replace("  const created = await prisma.job.findMany(","  await (await import('./availability.js')).runAvailabilityReview(prisma); await (await import('./refresh.js')).runRefresh(prisma);\n  const created = await prisma.job.findMany(",1)
open(p,'w').write(s)
P
run 'a. revue de disponibilité et refresh appelés par la passe'
python3 - "$F" <<'P'
import sys; p=sys.argv[1]; s=open(p).read()
s=s.replace("  if (running.some(run => run.command === 'ingest-all')) return 'RUN_IN_PROGRESS';\n","")
open(p,'w').write(s)
P
run 'b. verrou du RUN retiré'
python3 - "$F" <<'P'
import sys; p=sys.argv[1]; s=open(p).read()
s=s.replace("lightPassRefusal(at, await runningRuns(prisma, options.runId))","lightPassRefusal(at, [])")
open(p,'w').write(s)
P
run 'c. pas de revérification avant chaque source'
sed -i.tmp 's/LIGHT_PASS_HOURS_UTC = Object.freeze(\[4, 10, 22\])/LIGHT_PASS_HOURS_UTC = Object.freeze([4, 10, 16, 22])/' "$R"
echo '--- d. une heure de passe à 16 UTC (pendant le RUN)'; node --test packages/runtime/test.mjs 2>&1 | grep -E '^ℹ (pass|fail)'
cp "$R.orig" "$R"
cmp "$F" "$F.orig" && cmp "$R" "$R.orig" && rm -f "$F.orig" "$R.orig" "$R.tmp" && echo 'fichiers restaurés à l’identique'
