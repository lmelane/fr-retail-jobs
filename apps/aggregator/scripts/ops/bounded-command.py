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
    déploiement verrait un run éternellement en vol ;
  · `INGEST_SOURCE_CONCURRENCY=<n>` — OPTIONNEL, pour un passage A/B. Porté par la commande et non par une
    variable de service : une variable de service est invisible dans le manifeste (donc invérifiable par la
    garde d'exécution) et surtout PERSISTANTE — oubliée après le passage, elle s'appliquerait en silence à
    tous les runs suivants. Portée par la commande, elle disparaît avec la restauration.
    Absente, on n'écrit RIEN : le défaut appartient au code (`ingestOrchestrator.ts`), et un « 4 » explicite
    masquerait un futur changement de ce défaut.

usage: bounded-command.py <run-name> <keys,comma> [concurrence]
"""
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


def bounded_command(run_name: str, keys: str, concurrency: str | None = None) -> str:
    body = SCRIPT.format(run_name=run_name)
    return (
        'env -u BREVO_API_KEY -u GOOGLE_INDEXING_CREDENTIALS -u HEALTHCHECK_PING_URL '
        f'EGRESS_PROBE=0 INGEST_ONLY_KEYS={keys} ' + concurrency_clause(concurrency) +
        'node --import tsx --input-type=module -e ' + shlex.quote(body)
    )


if __name__ == '__main__':
    if len(sys.argv) not in (3, 4):
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    print(bounded_command(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) == 4 else None), end='')
