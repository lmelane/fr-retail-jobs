#!/bin/sh
# D-517 — chaque garde a un témoin qui ÉCHOUE quand on retire la garde. Réintroduit chaque défaut par un sed aller-retour
# (jamais `git checkout --`), lance les témoins, restaure, et vérifie que l'arbre est revenu à l'identique.
# Rejouer depuis apps/aggregator, avec DATABASE_URL et DIRECT_URL sur une base de test migrée (nom contenant « test ») :
#   sh ../../audits/2026-10-02/fraicheur-d517/mutations.sh > ../../audits/2026-10-02/fraicheur-d517/mutations.out
set -u
TESTS="src/pipeline/lightPass.test.ts src/ats/incrementalReading.test.ts"
FILES="src/capture/batch.ts src/pipeline/attestingCapture.ts src/lib/incrementalReading.ts src/ats/adapters/workday.ts src/ats/adapters/smartrecruiters.ts
  src/ats/adapters/oraclehcm.ts src/connectors/sourceValidation.ts src/pipeline/ingestOrchestrator.ts src/pipeline/healthReport.ts src/pipeline/lightPass.ts src/pipeline/ingest.ts
  src/coverage/coverageReading.ts src/pipeline/knownPostings.ts src/ats/index.ts"
before=$(cat $FILES | shasum)

mutate() { # nom, fichier, motif sed (aller), motif sed (retour)
  name=$1 file=$2 forward=$3 back=$4
  cp "$file" "$file.orig"
  sed -i '' "$forward" "$file"
  if cmp -s "$file" "$file.orig"; then echo "$name : MUTATION SANS EFFET (motif introuvable)"; mv "$file.orig" "$file"; return; fi
  out=$(npx vitest run $TESTS 2>&1 | grep -E "Tests +[0-9]")
  sed -i '' "$back" "$file"
  cmp -s "$file" "$file.orig" || { echo "$name : RESTAURATION ÉCHOUÉE"; mv "$file.orig" "$file"; exit 1; }
  rm "$file.orig"
  echo "$name : $out"
}

mutate "1. rejeu sans l'ensemble scellé" src/capture/batch.ts \
  's/return withIncrementalReading(sealed.knownSkipped, replay);/return withoutIncrementalReading(replay); \/\/ MUTANT/' \
  's/return withoutIncrementalReading(replay); \/\/ MUTANT/return withIncrementalReading(sealed.knownSkipped, replay);/'
mutate "2. capture incrémentale attestante" src/pipeline/attestingCapture.ts \
  's/  if (isIncrementalResult(manifest.metadata)) return/  if (false \&\& isIncrementalResult(manifest.metadata)) return/' \
  's/  if (false \&\& isIncrementalResult(manifest.metadata)) return/  if (isIncrementalResult(manifest.metadata)) return/'
mutate "3. filtre commun retiré (tout rendu)" src/lib/incrementalReading.ts \
  's/const jobs = result.jobs.filter(job => !isKnownPosting(job.externalId));/const jobs = result.jobs; \/\/ MUTANT/' \
  's/const jobs = result.jobs; \/\/ MUTANT/const jobs = result.jobs.filter(job => !isKnownPosting(job.externalId));/'
mutate "4. Workday lit toutes les fiches" src/ats/adapters/workday.ts \
  's/      out.filter(job => !isKnownPosting(job.externalId)),/      out, \/\/ MUTANT/' \
  's/      out, \/\/ MUTANT/      out.filter(job => !isKnownPosting(job.externalId)),/'
mutate "5. SmartRecruiters lit toutes les annonces" src/ats/adapters/smartrecruiters.ts \
  's/    out.filter(job => !isKnownPosting(job.externalId)).map((job) =>/    out.map((job) => \/\/ MUTANT/' \
  's/    out.map((job) => \/\/ MUTANT/    out.filter(job => !isKnownPosting(job.externalId)).map((job) =>/'
mutate "6. Oracle lit toutes les réquisitions" src/ats/adapters/oraclehcm.ts \
  's/    jobs.filter(job => !isKnownPosting(job.externalId)).map((job) =>/    jobs.map((job) => \/\/ MUTANT/' \
  's/    jobs.map((job) => \/\/ MUTANT/    jobs.filter(job => !isKnownPosting(job.externalId)).map((job) =>/'
mutate "7. « rien de neuf » rejeté comme flux vide" src/connectors/sourceValidation.ts \
  's/if (recognized > 0 \&\& report.qualified === 0 \&\& report.rejected === 0) report.incrementalNothingNew = recognized;/if (false) report.incrementalNothingNew = recognized;/' \
  's/if (false) report.incrementalNothingNew = recognized;/if (recognized > 0 \&\& report.qualified === 0 \&\& report.rejected === 0) report.incrementalNothingNew = recognized;/'
mutate "8. santé de passe comparée au RUN et résumé réécrit" src/pipeline/ingestOrchestrator.ts \
  's/const health = incrementalPassActive() ? await recordIncrementalRun/const health = false ? await recordIncrementalRun/' \
  's/const health = false ? await recordIncrementalRun/const health = incrementalPassActive() ? await recordIncrementalRun/'
mutate "9. échec de passe dans le résumé du catalogue" src/pipeline/ingestOrchestrator.ts \
  's/if (!incrementalPassActive()) await recordSourceRunSummary/if (true) await recordSourceRunSummary/' \
  's/if (true) await recordSourceRunSummary/if (!incrementalPassActive()) await recordSourceRunSummary/'
mutate "10. rapport de santé lu à la passe" src/pipeline/healthReport.ts \
  's/WHERE NOT EXISTS (SELECT 1 FROM "PipelineRun" p WHERE p.id = sr."runId" AND p.command = /WHERE true OR NOT EXISTS (SELECT 1 FROM "PipelineRun" p WHERE p.id = sr."runId" AND p.command = /' \
  's/WHERE true OR NOT EXISTS (SELECT 1 FROM "PipelineRun" p WHERE p.id = sr."runId" AND p.command = /WHERE NOT EXISTS (SELECT 1 FROM "PipelineRun" p WHERE p.id = sr."runId" AND p.command = /'
mutate "11. qualification expirante lue quand même" src/pipeline/lightPass.ts \
  's/    const due = await qualificationDue(prisma, key);/    const due = null as string | null; \/\/ MUTANT/' \
  's/    const due = null as string | null; \/\/ MUTANT/    const due = await qualificationDue(prisma, key);/'
mutate "12. le stock d'une source nouvelle compté comme flux" src/pipeline/lightPass.ts \
  "s/greatest(bornes.since, min(js.\"firstSeenAt\") + interval '1 day')/bornes.since/" \
  "s/SELECT js.\"sourceKey\", bornes.since AS d/SELECT js.\"sourceKey\", greatest(bornes.since, min(js.\"firstSeenAt\") + interval '1 day') AS d/"
mutate "13. passe en lecture complète (incrémentale désactivée)" src/pipeline/ingest.ts \
  's/  const extraction = adopted ?? (incrementalPassActive()$/  const extraction = adopted ?? (false/' \
  's/  const extraction = adopted ?? (false$/  const extraction = adopted ?? (incrementalPassActive()/'

mutate "14. tolérance des lignes illisibles calculée sur le seul neuf" src/connectors/sourceValidation.ts \
  's/unqualifiedAllowanceFor(report.observed + (report.incrementalKnown ?? 0) + /unqualifiedAllowanceFor(report.observed + /' \
  's/unqualifiedAllowanceFor(report.observed + (report.inputUnqualified/unqualifiedAllowanceFor(report.observed + (report.incrementalKnown ?? 0) + (report.inputUnqualified/'
mutate "15. alerte de couverture : qualification de référence prise à une passe" src/coverage/coverageReading.ts \
  "s/ AND \${notLightPass(Prisma.raw('cb'))}\$/ AND true -- MUTANT/" \
  "s/ AND true -- MUTANT\$/ AND \${notLightPass(Prisma.raw('cb'))}/"
mutate "16. une sortie retenue d'une passe tenue pour connue" src/pipeline/knownPostings.ts \
  's/      AND NOT EXISTS (SELECT 1 FROM "PipelineRun" pass WHERE pass.id = cb."runId" AND pass.command = /      AND true OR NOT EXISTS (SELECT 1 FROM "PipelineRun" pass WHERE pass.id = cb."runId" AND pass.command = /' \
  's/      AND true OR NOT EXISTS (SELECT 1 FROM "PipelineRun" pass WHERE pass.id = cb."runId" AND pass.command = /      AND NOT EXISTS (SELECT 1 FROM "PipelineRun" pass WHERE pass.id = cb."runId" AND pass.command = /'
mutate "17. source à amorçage anti-robot lue par la passe" src/pipeline/lightPass.ts \
  's/ \&\& !leftToRun.has(row.key))/ \&\& !!leftToRun) \/\/ MUTANT/' \
  's/ \&\& !!leftToRun) \/\/ MUTANT/ \&\& !leftToRun.has(row.key))/'
mutate "18. connues laissées de côté hors du contrat canonique" src/ats/index.ts \
  's/, ...incrementalSkippedIds()\],/], \/\/ MUTANT/' \
  's/\], \/\/ MUTANT/, ...incrementalSkippedIds()],/'

after=$(cat $FILES | shasum)
[ "$before" = "$after" ] && echo "arbre restauré à l'identique" || { echo "ARBRE MODIFIÉ"; exit 1; }
