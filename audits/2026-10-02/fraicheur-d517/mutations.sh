#!/bin/sh
# D-517 — chaque garde a un témoin qui ÉCHOUE quand on retire la garde. Réintroduit chaque défaut par un sed aller-retour
# (jamais `git checkout --`), lance les témoins, restaure, et vérifie que l'arbre est revenu à l'identique.
# Rejouer depuis apps/aggregator, avec DATABASE_URL et DIRECT_URL sur une base de test migrée (nom contenant « test ») :
#   sh ../../audits/2026-10-02/fraicheur-d517/mutations.sh > ../../audits/2026-10-02/fraicheur-d517/mutations.out
set -u
TESTS="src/pipeline/lightPass.test.ts src/ats/incrementalReading.test.ts"
FILES="src/capture/batch.ts src/pipeline/attestingCapture.ts src/lib/incrementalReading.ts src/ats/adapters/workday.ts src/ats/adapters/smartrecruiters.ts
  src/ats/adapters/oraclehcm.ts src/connectors/sourceValidation.ts src/pipeline/ingestOrchestrator.ts src/pipeline/healthReport.ts src/pipeline/lightPass.ts src/pipeline/ingest.ts"
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
  's/if (nothingNew > 0) report.incrementalNothingNew = nothingNew;/if (false) report.incrementalNothingNew = nothingNew;/' \
  's/if (false) report.incrementalNothingNew = nothingNew;/if (nothingNew > 0) report.incrementalNothingNew = nothingNew;/'
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
  's/  const extraction = incrementalPassActive() ? await withIncrementalReading/  const extraction = false ? await withIncrementalReading/' \
  's/  const extraction = false ? await withIncrementalReading/  const extraction = incrementalPassActive() ? await withIncrementalReading/'

after=$(cat $FILES | shasum)
[ "$before" = "$after" ] && echo "arbre restauré à l'identique" || { echo "ARBRE MODIFIÉ"; exit 1; }
