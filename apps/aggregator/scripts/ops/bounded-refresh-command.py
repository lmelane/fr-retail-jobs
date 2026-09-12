"""La COMMANDE DE DÉMARRAGE d'un refresh borné, construite une seule fois, ici.

Comme pour l'ingestion : la commande contient du JavaScript avec guillemets et `$`, et assemblée en shell elle
se casse en silence. `shlex.quote` fait le travail une fois, correctement.

Ce que la commande garantit :
  · `REFRESH_ONLY_KEYS=<clés>` porté par la commande, donc visible dans le manifeste du déploiement et
    vérifiable par la garde d'exécution avant tout lancement ;
  · le MANIFESTE FIGÉ passé en clair : le refresh applique cette liste et rien d'autre. Il ne cherche pas les
    lignes à fermer, il applique celles qui ont été revues ;
  · `runRefresh` appelé directement — pas de snapshot, pas de geocode, pas d'ingestion : un refresh et rien
    d'autre ;
  · un `PipelineRun` nommé, ouvert et FERMÉ dans tous les cas, y compris en erreur.

usage: bounded-refresh-command.py <run-name> <keys,comma> <manifest.json>
"""
import json
import pathlib
import shlex
import sys

SCRIPT = (
    'import {{PrismaClient}} from "@prisma/client"; '
    'import {{startObservability}} from "./apps/aggregator/src/observability/runtime.ts"; '
    'import {{log}} from "./apps/aggregator/src/observability/logger.ts"; '
    'import {{runRefresh}} from "./apps/aggregator/src/pipeline/refresh.ts"; '
    'const p=new PrismaClient({{log:[]}}); '
    'const run=await startObservability(p,"{run_name}"); '
    'const manifest={manifest}; '
    'const keys={keys}; '
    'try {{'
    'const result=await runRefresh(p,{{onlyKeys:keys,manifestJobSourceIds:manifest}}); '
    'await log.info("refresh.completed",{{...result,manifestSize:manifest.length}}); '
    'await run.finish(result.refused?"COMPLETED_WITH_ERRORS":"COMPLETED");'
    '}} catch(error) {{'
    'process.exitCode=1; await log.error("command.failed",{{error}}); await run.finish("FAILED");'
    '}} finally {{await p.$disconnect();}}'
)


def bounded_refresh_command(run_name: str, keys: str, manifest_path: str) -> str:
    manifest = json.loads(pathlib.Path(manifest_path).read_text())
    ids = [e['jobSourceId'] for e in manifest['entries']]
    body = SCRIPT.format(
        run_name=run_name,
        manifest=json.dumps(ids),
        keys=json.dumps([k.strip() for k in keys.split(',') if k.strip()]),
    )
    return (
        'env -u BREVO_API_KEY -u GOOGLE_INDEXING_CREDENTIALS -u HEALTHCHECK_PING_URL '
        f'EGRESS_PROBE=0 REFRESH_ONLY_KEYS={keys} '
        'node --import tsx --input-type=module -e ' + shlex.quote(body)
    )


if __name__ == '__main__':
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    print(bounded_refresh_command(sys.argv[1], sys.argv[2], sys.argv[3]), end='')
