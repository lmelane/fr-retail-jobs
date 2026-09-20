"""RÉCUPÈRE LES VERDICTS DE TOUS LES DÉPLOIEMENTS — LECTURE SEULE.

    python3 apps/aggregator/scripts/ops/recuperer-tous-verdicts.py [<nb de déploiements>]

── POURQUOI CE SCRIPT EXISTE ──────────────────────────────────────────────────────────────────

`lire-logs-deploiement.py` ne lit que le déploiement COURANT. J'en ai conclu, à tort, que les
verdicts des vagues précédentes avaient « partiellement disparu » et j'ai bâti un archivage en
continu pour les rattraper au vol — un dispositif inutile qui a perdu des verdicts.

Le CEO l'a relevé le 19/09/2026 : Railway garde les logs de CHAQUE déploiement, interrogeables
par son identifiant, y compris quand son statut est REMOVED. Vérifié sur le déploiement
`3d133fc9` (vague 7, statut REMOVED) : 11 lignes rendues sans difficulté.

Ce script liste donc les déploiements du service et relit les verdicts de chacun. Rien n'est
perdu, et le bilan d'une campagne se reconstitue après coup, à froid.
"""
import json
import re
import sys

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from railway_api import api  # noqa: E402

SERVICE = '203613c5-701f-4013-a2c0-66c8de147c34'  # catwalks-aggregator
VERDICTS = ('QUALIFIEE', 'REFUSEE', 'INACCESSIBLE', 'COLLECTE_NON_VALIDEE', 'IDENTITE_NON_PROUVEE',
            'DOMAINE_OFFICIEL_DIVERGENT', 'DOMAINE_OFFICIEL_MANQUANT', 'BLOCAGE_EXTERNE',
            'HORS_PARCOURS', 'RETIREE')
LIGNE = re.compile(r'^\s*\d+/\d+\s+([A-Z_]+)\s+(\S+)\s+\((\S+) offres?, ([\d.]+) s\)(?:\s+—\s+(.*))?')

combien = int(sys.argv[1]) if len(sys.argv) > 1 else 40

deploiements = api(
    'query($id:String!,$n:Int!){deployments(first:$n,input:{serviceId:$id})'
    '{edges{node{id status createdAt}}}}',
    {'id': SERVICE, 'n': combien},
)
noeuds = [e['node'] for e in (deploiements.get('deployments') or {}).get('edges', [])]
print(f'{len(noeuds)} déploiement(s) à relire\n')

vus = {}
for n in noeuds:
    try:
        logs = api('query($id:String!,$limit:Int!){deploymentLogs(deploymentId:$id,limit:$limit)'
                   '{timestamp message}}', {'id': n['id'], 'limit': 500})
    except RuntimeError as e:
        print(f"   {n['createdAt'][:19]}  illisible ({e})")
        continue
    lignes = logs.get('deploymentLogs') or []
    trouves = 0
    for l in lignes:
        m = LIGNE.match(l.get('message', ''))
        if not m or m.group(1) not in VERDICTS:
            continue
        verdict, cle, offres, duree, raison = m.groups()
        # La même source peut apparaître dans plusieurs déploiements (reprise) : le dernier
        # verdict rendu est le bon, et les déploiements arrivent du plus récent au plus ancien.
        if cle not in vus:
            vus[cle] = {'verdict': verdict, 'offres': offres, 'duree': float(duree),
                        'raison': (raison or '').strip(), 'quand': n['createdAt'][:19]}
        trouves += 1
    if trouves:
        print(f"   {n['createdAt'][:19]}  {trouves:3} verdict(s)")

par_type = {}
for cle, v in vus.items():
    par_type.setdefault(v['verdict'], []).append((cle, v))

print(f'\n═══ {len(vus)} SOURCE(S) AVEC UN VERDICT ═══\n')
for t, xs in sorted(par_type.items(), key=lambda kv: -len(kv[1])):
    print(f'   {t.ljust(30)} {len(xs)}')

for t, xs in sorted(par_type.items(), key=lambda kv: -len(kv[1])):
    if t == 'QUALIFIEE':
        continue
    print(f'\n── {t} ({len(xs)}) ──\n')
    for cle, v in sorted(xs, key=lambda kv: -(int(kv[1]['offres']) if kv[1]['offres'].isdigit() else 0)):
        print(f"   {cle.ljust(28)} {v['offres'].rjust(5)} offre(s)  {v['raison'][:110]}")

with open('backups/verdicts-campagne.json', 'w', encoding='utf-8') as f:
    json.dump(vus, f, ensure_ascii=False, indent=1)
print('\n   écrit dans backups/verdicts-campagne.json\n')
