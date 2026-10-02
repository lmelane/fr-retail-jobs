#!/usr/bin/env bash
# D-520 §4 a : chaque contrôle de facetProof retiré seul, puis l'adoption sans vérification ; chaque témoin doit passer
# au rouge. Le fichier est restauré à l'identique après chaque mutant (empreinte vérifiée en fin).
#   bash audits/2026-10-02/preuve-facette-limite-knitwell/mutants.sh > audits/2026-10-02/preuve-facette-limite-knitwell/mutants.out
set -u
cd "$(dirname "$0")/../../../apps/aggregator"
F=src/ats/adapters/workday.ts; ORIG=$(mktemp); cp "$F" "$ORIG"; H=$(shasum "$F" | cut -c1-12)
mut() {
  FROM="$2" TO="$3" perl -0pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/ or die "absent\n"' "$F" || { echo "== $1 : motif absent"; return; }
  echo "== $1"; npx vitest run src/ats/adapters/workday.covering.test.ts 2>&1 | grep -E "^ +×|Tests " | sed 's/ [0-9]*ms$//'
  cp "$ORIG" "$F"
}
mut "adopte sans vérifier" "return { adopted: failures.length === 0, failures," "return { adopted: true, failures,"
mut "sans recouvrement" '...(overlap ? [`COVERING_FACET_OVERLAP=${overlap}`] : []),' ''
mut "sans offre du site manquée" '...(input.sitePostingsMissed ? [`COVERING_FACET_MISSES_SITE_POSTINGS=${input.sitePostingsMissed}`] : []),' ''
mut "sans accord des facettes" "...(cover.agreeing < 2 || cover.exceeded ? ['COVERING_FACET_WITHOUT_AGREEMENT'] : [])," ''
mut "sans tableau prouvé" "...(boards.some((r) => !r.complete) ? ['COVERING_BOARD_UNPROVEN'] : [])," ''
mut "sans plafond par tableau" '...atCap.map((r) => `COVERING_BOARD_AT_CAP=${r.scope}`),' ''
mut "sans somme des totaux" '...(boardsTotal !== cover.sum ? [`COVERING_FACET_VALUES_MISMATCH=${boardsTotal}/${cover.sum}`] : []),' ''
mut "sans union" 'const union = input.unionIds + withoutPath !== cover.sum ?' 'const union = false ?'
echo "empreinte avant $H, après $(shasum "$F" | cut -c1-12)"; rm -f "$ORIG"
