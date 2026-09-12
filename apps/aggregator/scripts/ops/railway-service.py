"""Lire et piloter les services Railway du projet, par NOM, depuis le dépôt.

Pourquoi versionné : le pilotage d'un run borné faisait partie des scripts privés (`validate-lot-railway.py`),
qui ne connaissaient QUE l'aggregator. Le web y était absent — d'où l'erreur récurrente consistant à lire le
SUCCESS de l'aggregator comme si le site était déployé. Ici les deux services sont des citoyens de première
classe, adressés par leur nom.

Les SECRETS restent dehors : ce programme n'appelle l'API que via `backups/observability-20260909/railway-api.py`,
qui porte le jeton. Aucun identifiant n'est écrit ici.

usage:
  railway-service.py status <service>            état du dernier déploiement (statut, commit, commande)
  railway-service.py set-command <service> <cmd> pose la commande de démarrage ET redéploie le commit DEPLOY_COMMIT
  railway-service.py execute <service>           déclenche une exécution sur l'instance déployée
  railway-service.py variables <service>         les variables de périmètre et de pause, telles qu'elles sont
"""
import json
import os
import subprocess
import sys

API = ['python3', 'backups/observability-20260909/railway-api.py']
ENV = 'e66b019c-d280-41dc-85d8-25ed86bdd101'
PROJECT = '0eae47d0-598d-4cf0-bb3f-b38921eafa7e'

# Les services du projet, par nom. `instance` n'est nécessaire que pour déclencher une exécution.
SERVICES = {
    'aggregator': {
        'id': '203613c5-701f-4013-a2c0-66c8de147c34',
        'instance': 'b4f28077-95f1-4dd5-ba21-83398a616c99',
        'normalCommand': 'sh apps/aggregator/start.sh',
    },
    'web': {
        'id': None,  # résolu par nom : le service web n'a pas d'exécution bornée, seulement un état à lire
        'instance': None,
        'normalCommand': None,
    },
}


def api(query, variables=None):
    r = subprocess.run(API, input=json.dumps({'query': query, 'variables': variables or {}}),
                       text=True, capture_output=True, check=True)
    payload = json.loads(r.stdout)
    if 'errors' in payload:
        raise RuntimeError(f'Railway API: {payload["errors"]}')
    return payload


def web_deployment():
    """Le déploiement du service `catwalks-web`, trouvé par NOM plutôt que par un identifiant recopié."""
    q = ('query($env:String!){environment(id:$env){serviceInstances{edges{node{serviceName serviceId '
         'latestDeployment{id status meta}}}}}}')
    for edge in api(q, {'env': ENV})['environment']['serviceInstances']['edges']:
        node = edge['node']
        if node['serviceName'] == 'catwalks-web':
            return node
    raise RuntimeError('service catwalks-web introuvable dans cet environnement')


def status(service):
    if service == 'web':
        node = web_deployment()
        d = node['latestDeployment'] or {}
        return {'service': 'catwalks-web', 'status': d.get('status'),
                'commit': (d.get('meta') or {}).get('commitHash'), 'deploymentId': d.get('id')}
    s = SERVICES[service]
    q = ('query($env:String!,$service:String!){serviceInstance(environmentId:$env,serviceId:$service)'
         '{id startCommand latestDeployment{id status meta}}}')
    si = api(q, {'env': ENV, 'service': s['id']})['serviceInstance']
    d = si['latestDeployment'] or {}
    meta = d.get('meta') or {}
    return {
        'service': f'catwalks-{service}', 'status': d.get('status'), 'commit': meta.get('commitHash'),
        'deploymentId': d.get('id'), 'startCommand': si.get('startCommand'),
        'manifestCommand': (meta.get('serviceManifest') or {}).get('deploy', {}).get('startCommand'),
    }


def variables(service):
    """Les variables qui décident du périmètre et de la pause. Lues, jamais devinées."""
    s = SERVICES[service]
    q = ('query($project:String!,$env:String!,$service:String!)'
         '{variables(projectId:$project,environmentId:$env,serviceId:$service)}')
    v = api(q, {'project': PROJECT, 'env': ENV, 'service': s['id']})['variables']
    watched = ['INGEST_ONLY_KEYS', 'REFRESH_ONLY_KEYS', 'PIPELINE_PAUSED', 'PIPELINE_CMD']
    return {k: v.get(k) for k in watched}


def set_command(service, command):
    """Pose la commande de démarrage puis redéploie le commit attendu. Les deux, jamais l'une sans l'autre."""
    commit = os.environ['DEPLOY_COMMIT']
    if len(commit) != 40:
        raise RuntimeError('DEPLOY_COMMIT doit être un SHA complet de 40 caractères')
    s = SERVICES[service]
    api('mutation($env:String!,$service:String!,$input:ServiceInstanceUpdateInput!)'
        '{serviceInstanceUpdate(environmentId:$env,serviceId:$service,input:$input)}',
        {'env': ENV, 'service': s['id'], 'input': {'startCommand': command}})
    return api('mutation($env:String!,$service:String!,$commit:String!)'
               '{serviceInstanceDeployV2(environmentId:$env,serviceId:$service,commitSha:$commit)}',
               {'env': ENV, 'service': s['id'], 'commit': commit})


def execute(service):
    """
    Déclenche l'exécution — mais seulement si l'image déployée EST la commande bornée attendue.

    La garde est celle du protocole existant : statut SUCCESS, commit exact, et la commande du manifeste
    identique à celle posée et différente de la commande normale. Sans elle, un `execute` lancé après un
    redéploiement automatique relancerait le pipeline COMPLET.
    """
    commit = os.environ['DEPLOY_COMMIT']
    expected_keys = os.environ['INGEST_KEYS']
    s = SERVICES[service]
    st = status(service)
    manifest = st['manifestCommand']
    if st['status'] != 'SUCCESS':
        raise RuntimeError(f'refus : déploiement {st["status"]}, attendu SUCCESS')
    if st['commit'] != commit:
        raise RuntimeError(f'refus : commit déployé {st["commit"]} ≠ attendu {commit}')
    if manifest != st['startCommand'] or manifest == s['normalCommand']:
        raise RuntimeError('refus : la commande déployée n\'est pas la commande bornée posée')
    # Le périmètre est porté par INGEST_ONLY_KEYS pour une ingestion, par REFRESH_ONLY_KEYS pour un refresh —
    # un refresh ne collecte rien, il ne peut donc pas porter la variable d'ingestion. Exiger le nom de
    # l'ingestion refusait TOUT refresh conforme : la garde n'avait jamais été exercée sur ce chemin.
    # Ce qui compte n'est pas le nom de la variable, c'est que le périmètre déployé soit EXACTEMENT l'attendu ;
    # on accepte donc l'un ou l'autre, et un seul à la fois — porter les deux serait un état incohérent.
    bounds = [v for v in ('INGEST_ONLY_KEYS', 'REFRESH_ONLY_KEYS') if f'{v}={expected_keys} ' in (manifest or '')]
    if not bounds:
        raise RuntimeError('refus : la commande déployée ne porte pas exactement l\'allowlist attendue '
                           f'({expected_keys}) via INGEST_ONLY_KEYS ou REFRESH_ONLY_KEYS')
    if len(bounds) > 1:
        raise RuntimeError('refus : la commande déployée porte À LA FOIS INGEST_ONLY_KEYS et REFRESH_ONLY_KEYS')
    return api('mutation($input:DeploymentInstanceExecutionCreateInput!)'
               '{deploymentInstanceExecutionCreate(input:$input)}',
               {'input': {'serviceInstanceId': s['instance']}})


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    service = sys.argv[2] if len(sys.argv) > 2 else ''
    if mode == 'status':
        print(json.dumps(status(service), indent=1))
    elif mode == 'variables':
        print(json.dumps(variables(service), indent=1))
    elif mode == 'set-command':
        print(json.dumps(set_command(service, sys.argv[3]), indent=1))
    elif mode == 'execute':
        print(json.dumps(execute(service), indent=1))
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
