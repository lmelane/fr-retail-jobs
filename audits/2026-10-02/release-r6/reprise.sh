#!/bin/sh
# Reprise documentée au RUNBOOK, sur la base JETABLE : `migrate resolve --rolled-back <migration>` puis `migrate deploy`.
set -u
S=<scratchpad>
G=$S/r6-gel; P=$S/preuve-verrou; U=$(cat $P/url.private)
case "$U" in postgresql://postgres:*@127.0.0.1:32910/postgres) ;; *) echo "cible refusée"; exit 1;; esac
cd $G
DATABASE_URL=$U DIRECT_URL=$U npx prisma migrate resolve --rolled-back "$1" --schema $P/prisma/schema.prisma 2>&1 | grep -iE "marked|error" | head -3
t0=$(date +%s)
DATABASE_URL=$U DIRECT_URL=$U npx prisma migrate deploy --schema $P/prisma/schema.prisma > $P/reprise-$1.out 2>&1
echo "deploy sans verrou : code=$? duree=$(( $(date +%s) - t0 ))s"
grep -iE "applied|error" $P/reprise-$1.out | head -3
