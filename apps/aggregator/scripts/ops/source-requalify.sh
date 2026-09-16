#!/bin/zsh
# Requalifie une source déjà revue sous le LECTEUR COURANT : les captures et décisions sont liées à l'empreinte
# du lecteur (captureReaderRevision), donc toute modification du code de l'agrégateur les périme. Ce script
# rejoue les étapes de preuve avec les dossiers DÉJÀ ÉCRITS par le réviseur (identité, accès), en les reliant
# aux nouvelles captures ; il n'invente aucune décision. Il s'exécute dans l'environnement voulu (par exemple
# `npm run stack:exec -- zsh apps/aggregator/scripts/ops/source-requalify.sh …` pour la stack locale).
#
#   source-requalify.sh <clé> --revision=<révision> --official-url=<URL page officielle> --official-domain=<domaine>
#                       --robots-url=<URL robots.txt> --identity=<dossier identité.json> --access=<dossier accès.json>
#                       --out-dir=<dossier privé des rapports> [--ingest] [--no-geocode]
set -eu
setopt shwordsplit
typeset -A opt; key=""
for arg in "$@"; do
  if [[ "$arg" == --*=* ]]; then opt[${${arg#--}%%=*}]="${arg#*=}"; elif [[ "$arg" == --* ]]; then opt[${arg#--}]=1; else key="$arg"; fi
done
for required in revision official-url official-domain robots-url identity access out-dir; do
  [[ -n "${opt[$required]:-}" ]] || { echo "source-requalify : --$required manquant" >&2; exit 2; }
done
[[ -n "$key" ]] || { echo "source-requalify : clé de source manquante" >&2; exit 2; }
ONBOARD="node --import tsx apps/aggregator/scripts/ops/source-onboard.mts"
OUT="${opt[out-dir]}"; mkdir -p -m 700 "$OUT"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
id() { python3 -c "import json;print(json.load(open('$1'))['$2'])"; }

echo "[1/8] captures : page officielle, robots, collecte de qualification"
$ONBOARD evidence "$key" --purpose=identity --url="${opt[official-url]}" --revision="${opt[revision]}" --apply --out="$OUT/$stamp-1-evidence-identity.json" >/dev/null
$ONBOARD evidence "$key" --purpose=access --url="${opt[robots-url]}" --revision="${opt[revision]}" --apply --out="$OUT/$stamp-2-evidence-robots.json" >/dev/null
$ONBOARD collect "$key" --apply --deadline-ms="${opt[deadline-ms]:-120000}" --out="$OUT/$stamp-3-collect.json" >/dev/null
IDENT=$(id "$OUT/$stamp-1-evidence-identity.json" captureBatchId); ROBOTS=$(id "$OUT/$stamp-2-evidence-robots.json" captureBatchId); JOBS=$(id "$OUT/$stamp-3-collect.json" captureBatchId)
echo "      identité=$IDENT robots=$ROBOTS collecte=$JOBS verdict=$(id "$OUT/$stamp-3-collect.json" verdict)"

echo "[2/8] dossiers reliés aux nouvelles captures (checkedAt à la milliseconde)"
python3 - "${opt[identity]}" "${opt[access]}" "$IDENT" "$ROBOTS" "$JOBS" <<'PY'
import json, sys, datetime
identite, acces, ident, robots, jobs = sys.argv[1:6]
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
d = json.load(open(identite, encoding='utf-8')); d['captureBatchId'] = ident; d['checkedAt'] = now()
open(identite, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
d = json.load(open(acces, encoding='utf-8'))
if d['verdict'] == 'ALLOWED': d['captureBatchId'] = jobs; d['robotsCaptureIds'] = [robots]
d['checkedAt'] = now()
open(acces, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
PY

echo "[3/8] relation page officielle → portail"
$ONBOARD relation "$key" --capture="$IDENT" --official-domain="${opt[official-domain]}" --out="$OUT/$stamp-4-relation.json" | grep -E '"(verdict|reason)"' | tr -d '\n'; echo
echo "[4/8] décision d'identité"; $ONBOARD identity "${opt[identity]}" --apply --out="$OUT/$stamp-5-identity.json" | grep -E '"(verdict|written|isLatestDecision)"' | tr -d '\n'; echo
echo "[5/8] décision d'accès"; $ONBOARD access "${opt[access]}" --apply --out="$OUT/$stamp-6-access.json" | grep -E '"(verdict|written|validUntil)"' | tr -d '\n'; echo
echo "[6/8] portes"; $ONBOARD status "$key" --out="$OUT/$stamp-7-status.json" | grep -E '"(status|passed|code|promotionGatesPass)"' | head -8 | tr -d '\n'; echo
echo "[7/8] promotion (revérification sous verrou)"; $ONBOARD promote "$key" --revision="${opt[revision]}" --apply --out="$OUT/$stamp-8-promote.json" | tr -d '\n'; echo
if [[ -n "${opt[ingest]:-}" ]]; then
  echo "[8/8] ingestion sous admission puis prévisualisation du refresh"
  npx --no-install tsx apps/aggregator/src/cli.ts ingest --source="$key" ${opt[no-geocode]:+--no-geocode} > "$OUT/$stamp-9-ingest.log" 2>&1 || echo "      ingestion : code $? (journal $OUT/$stamp-9-ingest.log)"
  grep -oE '"message":"\[ingest\][^"]*"' "$OUT/$stamp-9-ingest.log" | tail -1
  node --import tsx apps/aggregator/scripts/ops/refresh-preview.mts --keys="$key" --out="$OUT/$stamp-10-refresh-preview.json" | python3 -c "import json,sys; t=sys.stdin.read(); j=json.loads(t[t.index('{'):]); print(json.dumps({k: j.get(k) for k in ['eligible','eligibility','representationStates','perimeterLiveJobs','plannedDeactivations']}, ensure_ascii=False)[:800])"
else
  echo "[8/8] ingestion non demandée (--ingest)"
fi
