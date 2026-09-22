#!/bin/sh
set -eu

exec node --import tsx apps/aggregator/src/worker.ts "$@"
