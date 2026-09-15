"""Lire et piloter les services Railway du projet, par NOM, depuis le dépôt.

Pourquoi versionné : le pilotage d'un run borné faisait partie des scripts privés (`validate-lot-railway.py`),
qui ne connaissaient QUE l'aggregator. Le web y était absent — d'où l'erreur récurrente consistant à lire le
SUCCESS de l'aggregator comme si le site était déployé. Ici les deux services sont des citoyens de première
classe, adressés par leur nom.

Transport partagé : railway_api.py. Les secrets viennent de l'environnement ou de la connexion CLI Railway.

usage:
  railway-service.py status <service>            état du dernier déploiement (statut, commit, commande)
  railway-service.py set-command <service> <cmd> pose la commande de démarrage ET redéploie le commit DEPLOY_COMMIT
  railway-service.py execute <service>           déclenche une exécution sur l'instance déployée
  railway-service.py variable-names <service>    les NOMS de toutes les variables posées (jamais les valeurs)
  railway-service.py variables <service>         les variables de périmètre et de pause, telles qu'elles sont
"""
import json
import os
import re
import sys
from railway_api import api

ENV = 'e66b019c-d280-41dc-85d8-25ed86bdd101'
PROJECT = '0eae47d0-598d-4cf0-bb3f-b38921eafa7e'

# Les services du projet, par nom. `instance` n'est nécessaire que pour déclencher une exécution.
SERVICES = {
    'aggregator': {
        'id': '203613c5-701f-4013-a2c0-66c8de147c34',
        'instance': 'b4f28077-95f1-4dd5-ba21-83398a616c99',
        'normalCommand': 'sh apps/aggregator/start.sh',
    },
    # Les deux crons secondaires : pas d'exécution bornée ici (elle passe par l'aggregator), mais leurs
    # variables doivent être lisibles — « aucune variable résiduelle » porte sur les TROIS services.
    'refresh': {'id': 'ddc5dece-7865-4cfa-b71e-8d139e2e1ea5', 'instance': None, 'normalCommand': None},
    'reconcile': {'id': '85d0e5ba-992a-467e-9ddd-0dc25be1d74c', 'instance': None, 'normalCommand': None},
    'api': {
        'id': None,  # résolu depuis le nom courant catwalks-api
        'instance': None,
        'normalCommand': None,
    },
}


def service_config(service):
    if service not in SERVICES:
        raise RuntimeError(f'service inconnu : {service}; attendu : {", ".join(SERVICES)}')
    config = SERVICES[service]
    if config['id']:
        return config
    q = 'query($env:String!){environment(id:$env){serviceInstances{edges{node{serviceName serviceId}}}}}'
    matches = [edge['node'] for edge in api(q, {'env': ENV})['environment']['serviceInstances']['edges']
               if edge['node']['serviceName'] == f'catwalks-{service}']
    if len(matches) != 1 or not matches[0].get('serviceId'):
        raise RuntimeError(f'service catwalks-{service} absent ou ambigu dans cet environnement')
    return {**config, 'id': matches[0]['serviceId']}


def status(service):
    s = service_config(service)
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
    s = service_config(service)
    q = ('query($project:String!,$env:String!,$service:String!)'
         '{variables(projectId:$project,environmentId:$env,serviceId:$service)}')
    v = api(q, {'project': PROJECT, 'env': ENV, 'service': s['id']})['variables']
    watched = ['INGEST_ONLY_KEYS', 'REFRESH_ONLY_KEYS', 'PIPELINE_PAUSED', 'PIPELINE_CMD']
    return {k: v.get(k) for k in watched}


def variable_names(service):
    """
    Les NOMS des variables posées sur un service — JAMAIS leurs valeurs.

    `variables()` ne projette que les quatre qui pilotent périmètre et pause : utile pour décider, inutile
    pour constater. Or « aucune variable résiduelle » et « les credentials de stockage sont-ils posés »
    portent sur l'ENSEMBLE des clés, pas sur une liste écrite à l'avance.

    Les valeurs ne sortent jamais d'ici : une preuve d'exploitation ne doit pas pouvoir devenir une fuite de
    secret parce qu'on a voulu vérifier qu'un secret existait.
    """
    s = service_config(service)
    q = ('query($project:String!,$env:String!,$service:String!)'
         '{variables(projectId:$project,environmentId:$env,serviceId:$service)}')
    v = api(q, {'project': PROJECT, 'env': ENV, 'service': s['id']})['variables']
    return sorted(v.keys())


def set_command(service, command):
    """Pose la commande de démarrage puis redéploie le commit attendu. Les deux, jamais l'une sans l'autre."""
    if service != 'aggregator':
        raise RuntimeError('les commandes bornées sont réservées au service aggregator')
    commit = os.environ['DEPLOY_COMMIT']
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
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
    if service != 'aggregator':
        raise RuntimeError('les exécutions bornées sont réservées au service aggregator')
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
    elif mode == 'variable-names':
        print(json.dumps(variable_names(service), indent=1))
    elif mode == 'set-command':
        print(json.dumps(set_command(service, sys.argv[3]), indent=1))
    elif mode == 'execute':
        print(json.dumps(execute(service), indent=1))
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
