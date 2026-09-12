"""La COMMANDE DE DÉMARRAGE bornée d'une ingestion de production, construite une seule fois, ici.

Pourquoi un programme et pas une chaîne dans le script shell : la commande contient du JavaScript avec des
guillemets et des `$`, passé à `node -e`. Assemblée en shell, elle se casse silencieusement — et une commande
cassée qui se déploie quand même produirait un conteneur qui échoue APRÈS avoir remplacé la commande normale.
`shlex.quote` fait le travail une fois, correctement.

Ce que la commande garantit, et qui n'est pas cosmétique :
  · `INGEST_ONLY_KEYS=<clés>` — le périmètre, porté par la commande elle-même, donc visible dans le manifeste
    du déploiement, donc vérifiable par la garde d'exécution avant tout lancement ;
  · `env -u BREVO_API_KEY -u HEALTHCHECK_PING_URL -u GOOGLE_INDEXING_CREDENTIALS` — les canaux d'alerte sont
    retirés de l'exécution : ils ont été TESTÉS au préflight, et un digest émis par un run de 9 sources
    annoncerait faussement l'état des 431 autres. L'indexation Google est retirée pour la même raison ;
  · `ingestAllBySource` appelé directement — le même point d'entrée que la production, sans le refresh, sans
    le snapshot, sans le geocode final : une ingestion, et rien d'autre ;
  · un `PipelineRun` nommé, ouvert et FERMÉ dans tous les cas, y compris en erreur — sans quoi la garde de
    déploiement verrait un run éternellement en vol.

usage: bounded-command.py <run-name> <keys,comma>
"""
import shlex
import sys

SCRIPT = (
    'import {{PrismaClient}} from "@prisma/client"; '
    'import {{startObservability}} from "./apps/aggregator/src/observability/runtime.ts"; '
    'import {{log}} from "./apps/aggregator/src/observability/logger.ts"; '
    'import {{ingestAllBySource}} from "./apps/aggregator/src/pipeline/ingestOrchestrator.ts"; '
    'import {{closeBrowser}} from "./apps/aggregator/src/lib/browser.ts"; '
    'const p=new PrismaClient({{log:[]}}); '
    'const run=await startObservability(p,"{run_name}"); '
    'try {{'
    'const result=await ingestAllBySource(p); '
    'await log.info("ingest.completed",result); '
    'await run.finish(result.failed||result.timedOut?"COMPLETED_WITH_ERRORS":"COMPLETED");'
    '}} catch(error) {{'
    'process.exitCode=1; await log.error("command.failed",{{error}}); await run.finish("FAILED");'
    '}} finally {{await closeBrowser(); await p.$disconnect();}}'
)


def bounded_command(run_name: str, keys: str) -> str:
    body = SCRIPT.format(run_name=run_name)
    return (
        'env -u BREVO_API_KEY -u GOOGLE_INDEXING_CREDENTIALS -u HEALTHCHECK_PING_URL '
        f'EGRESS_PROBE=0 INGEST_ONLY_KEYS={keys} '
        'node --import tsx --input-type=module -e ' + shlex.quote(body)
    )


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    print(bounded_command(sys.argv[1], sys.argv[2]), end='')
