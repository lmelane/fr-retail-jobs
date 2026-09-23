"""La COMMANDE DE DÉMARRAGE bornée d'une ingestion de production, construite une seule fois, ici.

Pourquoi un programme et pas une chaîne dans le script shell : la commande contient du JavaScript avec des
guillemets et des `$`, passé à `node -e`. Assemblée en shell, elle se casse silencieusement — et une commande
cassée qui se déploie quand même produirait un conteneur qui échoue APRÈS avoir remplacé la commande normale.
`shlex.quote` fait le travail une fois, correctement.

Ce que la commande garantit, et qui n'est pas cosmétique :
  · `INGEST_ONLY_KEYS=<clés>` — le périmètre, porté par la commande elle-même, donc visible dans le manifeste
    du déploiement, donc vérifiable par la garde d'exécution avant tout lancement ;
  · `PIPELINE_PAUSED` est vérifié avant la base et l'observabilité, comme pour toute collecte ;
  · les canaux d'alerte restent disponibles. Le heartbeat annonce le résultat terminal de ce passage ;
    aucun digest global n'est calculé. Seule l'indexation Google est désactivée ;
  · `ingestAllBySource` appelé directement — le même point d'entrée que la production, sans le refresh, sans
    le snapshot, sans le geocode final : une ingestion, et rien d'autre ;
  · un `PipelineRun` nommé, ouvert et FERMÉ dans tous les cas, y compris en erreur — sans quoi la garde de
    déploiement verrait un run éternellement en vol ;
  · `INGEST_SOURCE_CONCURRENCY=<n>` — OPTIONNEL, pour un passage A/B. Porté par la commande et non par une
    variable de service : une variable de service est invisible dans le manifeste (donc invérifiable par la
    garde d'exécution) et surtout PERSISTANTE — oubliée après le passage, elle s'appliquerait en silence à
    tous les runs suivants. Portée par la commande, elle disparaît avec la restauration.
    Absente, on n'écrit RIEN : le défaut appartient au code (`ingestOrchestrator.ts`), et un « 4 » explicite
    masquerait un futur changement de ce défaut ;
  · `P8_STOP_ON_FIRST_429=1` — OPTIONNEL (`--stop-on-first-429`), l'arrêt franc du passage à la première
    réponse 429. Même raison que ci-dessus, apprise à la dure : `export P8_STOP_ON_FIRST_429=1` dans le shell
    LOCAL n'atteint jamais le conteneur Railway, où le run s'exécute. Le 2026-09-13, trois passages ont été
    conduits en croyant la garde armée ; elle ne l'était pas, et T2 a encaissé 82 réponses 429 sans s'arrêter.
    **Une garde qu'on croit armée est pire qu'une garde absente : elle fait relire un run comme sûr.**

usage: bounded-command.py <run-name> <keys,comma> [concurrence] [--stop-on-first-429]
"""
import json
import shlex
import sys

# P8 interdit de monter la concurrence dans le seul but de trouver le point de rupture : les portails ATS sont
# des services de tiers. La borne haute est une protection, pas un confort — et elle est franche, pas un
# avertissement qu'on ignore.
MAX_CONCURRENCY = 16

SCRIPT = (
    'import {{PrismaClient}} from "@prisma/client"; '
    'import {{startObservability}} from "./apps/aggregator/src/observability/runtime.ts"; '
    'import {{log}} from "./apps/aggregator/src/observability/logger.ts"; '
    'import {{ingestAllBySource}} from "./apps/aggregator/src/pipeline/ingestOrchestrator.ts"; '
    'import {{closeBrowser}} from "./apps/aggregator/src/lib/browser.ts"; '
    'import {{exitIfPipelinePaused}} from "./apps/aggregator/src/lib/pipelinePause.ts"; '
    'import {{pingHeartbeat}} from "./apps/aggregator/src/pipeline/heartbeat.ts"; '
    'exitIfPipelinePaused({run_name}); '
    'const p=new PrismaClient({{log:[]}}); '
    'let run; let ok=false; '
    'try {{'
    'run=await startObservability(p,{run_name}); '
    'const result=await ingestAllBySource(p); '
    'await log.info("ingest.completed",result); '
    'const failed=Boolean(result.failed||result.timedOut); if(failed)process.exitCode=1; '
    'await run.finish(failed?"COMPLETED_WITH_ERRORS":"COMPLETED"); ok=!failed;'
    '}} catch(error) {{'
    'process.exitCode=1; await log.error("command.failed",{{error}}); if(run)await run.finish("FAILED");'
    '}} finally {{try {{const heartbeat=await pingHeartbeat(ok); '
    'await log.info("heartbeat.completed",{{ok,heartbeat}}); '
    '}} finally {{try {{await closeBrowser();}} finally {{await p.$disconnect();}}}}}}'
)


def concurrency_clause(concurrency: str | None) -> str:
    """`INGEST_SOURCE_CONCURRENCY=<n> `, ou la chaîne vide si aucune consigne.

    Le refus est FRANC : une valeur non entière, nulle, négative ou au-delà de la borne arrête le programme
    plutôt que de retomber sur un défaut. Un A/B piloté par une valeur silencieusement ignorée mesurerait deux
    fois la même chose en croyant comparer.
    """
    if concurrency is None:
        return ''
    if not concurrency.isdigit():  # refuse le vide, le signe, le point décimal et toute injection.
        raise SystemExit(f'concurrence invalide : {concurrency!r} — entier positif attendu')
    value = int(concurrency)
    if not 1 <= value <= MAX_CONCURRENCY:
        raise SystemExit(f'concurrence hors bornes : {value} — attendu entre 1 et {MAX_CONCURRENCY}')
    return f'INGEST_SOURCE_CONCURRENCY={value} '


def bounded_command(run_name: str, keys: str, concurrency: str | None = None,
                    stop_on_first_429: bool = False) -> str:
    if not keys.strip() or any(not key.strip() for key in keys.split(',')):
        raise ValueError('At least one non-empty source key is required')
    body = SCRIPT.format(run_name=json.dumps(run_name))
    return (
        'env -u GOOGLE_INDEXING_CREDENTIALS '
        f'INGEST_ONLY_KEYS={shlex.quote(keys)} ' + concurrency_clause(concurrency) +
        ('P8_STOP_ON_FIRST_429=1 ' if stop_on_first_429 else '') +
        'node --import tsx --input-type=module -e ' + shlex.quote(body)
    )


if __name__ == '__main__':
    args = sys.argv[1:]
    stop429 = '--stop-on-first-429' in args
    args = [a for a in args if a != '--stop-on-first-429']
    if len(args) not in (2, 3):
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    # Une concurrence ABSENTE vaut « aucune consigne » ; une concurrence VIDE reste une erreur. Le drapeau
    # `--stop-on-first-429` étant positionnel-indépendant, on n'a jamais besoin d'un argument creux pour
    # l'atteindre — donc pas de sentinelle silencieuse qui avalerait une valeur mal formée.
    print(bounded_command(args[0], args[1], args[2] if len(args) == 3 else None, stop429), end='')
