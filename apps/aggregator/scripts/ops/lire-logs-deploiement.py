"""Lit les logs du déploiement courant du service aggregator — LECTURE SEULE.

    python3 apps/aggregator/scripts/ops/lire-logs-deploiement.py [<filtre>] [<limite>]

Quand une campagne s'exécute dans le conteneur, ses verdicts ne passent pas par la base : ils sont
écrits sur la sortie standard. Sans eux, on ne peut dire NI pourquoi une source échoue, NI si elle
a seulement été tentée — et toute conclusion tirée des seuls compteurs de la base est une
supposition. Ce script va chercher la source elle-même.
"""
import json
import sys

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import importlib.util  # noqa: E402
from railway_api import api  # noqa: E402

# `railway-service.py` porte un tiret : il n'est pas importable par son nom. On le charge par
# chemin plutôt que d'en recopier la logique de statut — une copie divergerait en silence.
_spec = importlib.util.spec_from_file_location(
    'railway_service', __file__.rsplit('/', 1)[0] + '/railway-service.py')
_rs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_rs)
status = _rs.status

filtre = sys.argv[1] if len(sys.argv) > 1 else ''
limite = int(sys.argv[2]) if len(sys.argv) > 2 else 300

deployment = status('aggregator')['deploymentId']
data = api(
    'query($id:String!,$limit:Int!,$filter:String)'
    '{deploymentLogs(deploymentId:$id,limit:$limit,filter:$filter){timestamp message severity}}',
    {'id': deployment, 'limit': limite, 'filter': filtre or None},
)
lignes = data.get('deploymentLogs') or []
print(f'déploiement {deployment} — {len(lignes)} ligne(s)' + (f' filtrées sur « {filtre} »' if filtre else ''))
for l in lignes:
    print(f"   {str(l.get('timestamp'))[11:19]}  {l.get('message', '')[:230]}")
