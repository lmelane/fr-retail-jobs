#!/bin/sh
set -eu

if [ "${PIPELINE_PAUSED:-0}" = "1" ]; then
  echo 'Pipeline paused for maintenance.'
  exit 0
fi

case "${PIPELINE_CMD:-ingest-all}" in
  ingest-all|refresh|reconcile|health-report) ;;
  *) echo 'Unsupported PIPELINE_CMD.' >&2; exit 1 ;;
esac

# A pending or failed migration stops the worker. Never baseline an unknown
# schema or apply DDL from a daily cron.
node_modules/.bin/prisma migrate status --schema packages/db/prisma/schema.prisma
exec node --import tsx apps/aggregator/src/cli.ts "${PIPELINE_CMD:-ingest-all}"
