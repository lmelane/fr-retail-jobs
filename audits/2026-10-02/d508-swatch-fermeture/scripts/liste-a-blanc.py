"""D-508 §6 — la liste À BLANC des offres Swatch Group que la fermeture automatique retirerait à la réouverture.

Entrées (committées, rejouables) :
  - lecture-site.json            : la lecture réelle du site par le code de l'adaptateur (scripts/lecture-a-blanc.live.ts)
  - catalogue-swatch-20261002.csv : les représentations actives au catalogue de production (scripts/catalogue-swatch.sql)
Sortie : fermetures-a-blanc.csv (une ligne par offre que le refresh fermerait), et le résumé sur la sortie standard.

Règle reproduite (pipeline/refreshEvidence.ts, refreshPlan.ts) : représentation ACTIVE dont l'identifiant n'est pas dans
l'ensemble canonique d'une énumération PROUVÉE ; l'offre ne ferme que si aucune autre source active ne la porte.
"""
import csv, json, pathlib, sys
here = pathlib.Path(__file__).resolve().parent.parent
site = json.loads((here / 'lecture-site.json').read_text())
if not (site['complete'] and site['termination'] == 'PARTITIONS_RECONCILED' and site['canonicalContractDeclared'] and not site['canonicalContractBroken']):
    sys.exit('lecture non prouvée : aucune fermeture possible')
observed = set(site['canonicalSet'])
rows = list(csv.DictReader((here / 'catalogue-swatch-20261002.csv').open()))
absent = [r for r in rows if r['externalId'] not in observed]
present = len(rows) - len(absent)
fields = ['externalId', 'title', 'company', 'city', 'countryCode', 'lastSeenAt', 'jobActive', 'otherActiveSources', 'consequence', 'url']
with (here / 'fermetures-a-blanc.csv').open('w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
    w.writeheader()
    for r in absent:
        r['consequence'] = 'JOB_KEPT_BY_ANOTHER_SOURCE' if int(r['otherActiveSources']) > 0 else 'JOB_CANDIDATE_FOR_CLOSURE'
        w.writerow(r)
closing = sum(1 for r in absent if r['consequence'] == 'JOB_CANDIDATE_FOR_CLOSURE')
# Une offre absente dont le même intitulé, dans la même ville, est encore en ligne sous un autre identifiant : une
# republication. La fermer retire le doublon que le catalogue montre aujourd'hui.
import re
cle = lambda r: (re.sub(r'\W+', ' ', r['title'].lower()).strip(), (r['city'] or '').lower().strip())
presentes = {}
for r in rows:
    if r['externalId'] in observed: presentes.setdefault(cle(r), []).append(r['externalId'])
republiees = {r['externalId']: presentes[cle(r)] for r in absent if cle(r) in presentes}
with (here / 'republications.csv').open('w', newline='') as f:
    w = csv.writer(f); w.writerow(['externalIdFerme', 'externalIdEnLigne', 'title', 'city'])
    for r in absent:
        for autre in republiees.get(r['externalId'], []): w.writerow([r['externalId'], autre, r['title'], r['city']])
online_closing = sum(1 for r in absent if r['consequence'] == 'JOB_CANDIDATE_FOR_CLOSURE' and r['jobActive'] == 't' and r['notMerged'] == 't')
print(json.dumps({'siteRead': [site['startedAt'], site['endedAt']], 'siteTotal': len(observed), 'activeRepresentations': len(rows),
  'present': present, 'absent': len(absent), 'republishedUnderNewId': len(republiees), 'jobsClosing': closing, 'onlineJobsClosing': online_closing,
  'onSiteNotInCatalogue': len(observed - {r['externalId'] for r in rows})}, ensure_ascii=False))
