#!/bin/sh
# R-143 §1 — chaque témoin de la passe légère passe au rouge quand son défaut est réintroduit.
# Rejouer depuis la racine du dépôt, avec DATABASE_URL vers une base de test migrée : sh audits/2026-10-02/cadence-r143/mutations.sh
# Chaque mutation est appliquée sur une copie de sauvegarde puis le fichier est restauré à l'octet près (jamais git checkout).
set -u
F=apps/aggregator/src/pipeline/lightPass.ts R=packages/runtime/index.mjs
H=apps/aggregator/src/pipeline/health.ts A=apps/aggregator/src/pipeline/attestingCapture.ts
for f in "$F" "$R" "$H" "$A"; do cp "$f" "$f.orig"; done
run() { echo "--- $1"; (cd apps/aggregator && npx vitest run src/pipeline/lightPass.test.ts 2>&1 | grep -E '×|Tests ' ); for f in "$F" "$H" "$A"; do cp "$f.orig" "$f"; done; }
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
python3 - "$H" "$A" <<'P'
import sys
h, a = sys.argv[1:3]
s = open(h).read(); s = s.replace("    if (row.runId && lightPasses.has(row.runId)) continue;\n", ""); open(h, 'w').write(s)
s = open(a).read(); s = s.replace("batch: { sourceKey, OR: [{ runId: null }, { runId: { notIn: lightPasses } }] }", "batch: { sourceKey }"); open(a, 'w').write(s)
P
run 'e. la collecte d’une passe redevient la référence des gardes du RUN'
sed -i.tmp 's/LIGHT_PASS_HOURS_UTC = Object.freeze(\[4, 10, 22\])/LIGHT_PASS_HOURS_UTC = Object.freeze([4, 10, 16, 22])/' "$R"
echo '--- d. une heure de passe à 16 UTC (pendant le RUN)'; node --test packages/runtime/test.mjs 2>&1 | grep -E '^ℹ (pass|fail)'
cp "$R.orig" "$R"
cmp "$F" "$F.orig" && cmp "$R" "$R.orig" && cmp "$H" "$H.orig" && cmp "$A" "$A.orig" && rm -f "$F.orig" "$R.orig" "$H.orig" "$A.orig" "$R.tmp" && echo 'fichiers restaurés à l’identique'
