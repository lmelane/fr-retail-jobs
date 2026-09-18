#!/bin/sh
# LA CAMPAGNE DE QUALIFICATION, DEPUIS L'EGRESS DE PRODUCTION.
#
# Ce script est la COMMANDE DE DÉMARRAGE d'un déploiement borné du service `catwalks-aggregator`.
# Il ne se lance pas depuis un poste : il s'exécute DANS le conteneur, là où l'adresse de sortie
# est celle qui a déjà collecté le catalogue.
#
# ── POURQUOI UN SCRIPT VERSIONNÉ PLUTÔT QU'UNE COMMANDE ASSEMBLÉE ───────────────────────────────
#
# `bounded-command.py` le dit pour l'ingestion, et la raison vaut ici : une commande qui contient
# du JavaScript avec guillemets et `$`, composée dans un shell puis passée à une API, se casse
# SILENCIEUSEMENT — et une commande cassée qui se déploie quand même remplace la commande normale
# par un conteneur qui échoue. Un fichier du dépôt n'a pas ce problème : il est relu tel quel.
#
# ── CE QU'IL FAIT, DANS CET ORDRE ───────────────────────────────────────────────────────────────
#
#   1. produit les candidats DEPUIS LA BASE (`source-campaign-candidates.sql`, lecture seule) —
#      aucun fichier à transférer, et la liste décrit le registre réel, pas une copie datée ;
#   2. lance `source-campaign.mts` sur les clés demandées.
#
# La campagne fait des appels réseau réels vers les sites des Maisons : page officielle, robots.txt,
# portail. C'est précisément ce qui exige l'egress de production — une page qui répond depuis un
# poste local peut refuser depuis ailleurs, et l'inverse.
#
# ── CE QU'IL NE FAIT PAS ────────────────────────────────────────────────────────────────────────
#
# Il ne touche ni `PIPELINE_PAUSED`, ni les CRON, ni la commande normale du service : la
# restauration appartient à l'appelant, après lecture des verdicts. Il n'invente aucune décision —
# `source-campaign.mts` rend un verdict PROUVÉ par source, ou refuse.
#
# ── USAGE ───────────────────────────────────────────────────────────────────────────────────────
#
#   CAMPAGNE_KEYS="cle1,cle2"   les sources à qualifier ; vide = toutes les candidates
#   CAMPAGNE_INGEST=1           enchaîne une ingestion après qualification (défaut : non)
set -eu

SORTIE=/tmp/campagne
mkdir -p "$SORTIE"

echo "[campagne] production des candidats depuis le registre"
node --import tsx apps/aggregator/scripts/ops/campagne-candidats.mts "$SORTIE/candidats.json"

echo "[campagne] qualification${CAMPAGNE_KEYS:+ — clés : $CAMPAGNE_KEYS}"
node --import tsx apps/aggregator/scripts/ops/source-campaign.mts \
  --candidates="$SORTIE/candidats.json" \
  --out-dir="$SORTIE/out" \
  ${CAMPAGNE_KEYS:+--keys="$CAMPAGNE_KEYS"} \
  ${CAMPAGNE_INGEST:+--ingest}

echo "[campagne] verdicts :"
node -e 'const v=require("/tmp/campagne/out/verdicts.json");
for (const x of v) console.log("   "+x.key.padEnd(24)+x.kind.padEnd(14)+x.verdict+(x.raisons?.length?"  ← "+x.raisons.join(" | ").slice(0,160):""));'
