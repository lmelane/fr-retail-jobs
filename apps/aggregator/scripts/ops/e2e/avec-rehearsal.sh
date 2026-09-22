#!/usr/bin/env bash
# Accès E2E en lecture seule, via un tunnel local vers la répétition désignée.
# Aucun secret dans les arguments ou les variables du shell, y compris sous bash -x.
set -euo pipefail
exec node --input-type=module -e '
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
const refus = (message) => { console.error(`REFUS : ${message}`); process.exit(3); };
let acces;
try { acces = JSON.parse(readFileSync(process.env.CW_REHEARSAL_ACCESS ?? `${process.env.HOME}/.catwalks/rehearsal-access.json`, "utf8")); }
catch { refus("fichier accès répétition absent ou invalide"); }
const { PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD } = acces;
if (!["127.0.0.1", "localhost"].includes(PGHOST)) refus("tunnel local requis");
if (PGDATABASE !== "catwalks_consolide_rehearsal") refus("base répétition attendue");
if (!/^\d+$/.test(String(PGPORT)) || Number(PGPORT) < 1 || Number(PGPORT) > 65535) refus("port invalide");
if (typeof PGUSER !== "string" || !PGUSER || typeof PGPASSWORD !== "string" || !PGPASSWORD) refus("identifiants incomplets");
const args = process.argv.slice(1);
if (!args.length) refus("commande requise");
const url = new URL(`postgresql://${PGHOST}:${PGPORT}/${PGDATABASE}`);
url.username = PGUSER; url.password = PGPASSWORD;
url.searchParams.set("options", "-c default_transaction_read_only=on");
const child = spawn(args[0], args.slice(1), { stdio: "inherit", env: { ...process.env, PGHOST, PGPORT: String(PGPORT), PGUSER, PGDATABASE, PGPASSWORD, PGOPTIONS: "-c default_transaction_read_only=on", DATABASE_URL: url.href, DIRECT_URL: url.href } });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { console.error("Échec du lancement de la commande E2E"); process.exit(1); });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
' "$@"
