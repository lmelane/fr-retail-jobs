#!/usr/bin/env bash
# L'URL DE LECTURE PRODUCTION — `catwalks_audit`, jamais `postgres`.
#
# Le secret vit hors dépôt (`~/.catwalks/audit-access.json`, permissions 600) et n'est JAMAIS
# affiché : ce script l'assemble et l'exporte, rien de plus.
#
# Pourquoi pas `postgres` : il est SUPERUTILISATEUR. Mesuré le 2026-09-21, un `CREATE TEMP TABLE`
# est passé en production malgré `SET ROLE catwalks_audit` et `default_transaction_read_only=on`.
# `catwalks_audit` porte la protection dans le compte lui-même (0 table inscriptible,
# lecture seule d'office), donc une erreur d'appel ne peut plus écrire.
#
#   source .../url-audit.sh && npx tsx <mesure>.mts …
set -euo pipefail

FICHIER="${CATWALKS_AUDIT_FILE:-$HOME/.catwalks/audit-access.json}"
[ -r "$FICHIER" ] || { echo "Identifiants d'audit introuvables : $FICHIER" >&2; return 1 2>/dev/null || exit 1; }

PROD_DATABASE_URL="$(python3 -c "
import json, urllib.parse, sys
a = json.load(open(sys.argv[1]))
if a.get('PGUSER') != 'catwalks_audit':
    sys.exit('Ce fichier ne porte pas le rôle catwalks_audit : refus.')
pw = urllib.parse.quote(a['PGPASSWORD'], safe='')
print(f\"postgresql://{a['PGUSER']}:{pw}@{a['PGHOST']}:{a['PGPORT']}/{a['PGDATABASE']}?sslmode=require\")
" "$FICHIER")"
export PROD_DATABASE_URL
