"""R-143 §4 — ce que l'offre conservée (règle d'autorité existante, selectApplySource) change pour le candidat : date de
publication et ville portées par la publication qui garde l'offre, face à celles de l'autre publication fusionnée.
Rejouer : python3 mesure-offre-conservee.py <publications.jsonl> <fusions.jsonl>   (mesure-dedoublonnage.mts --fusions=)"""
import json, sys
from datetime import datetime
pubs = {(p['sourceKey'], p['externalId']): p for p in map(json.loads, open(sys.argv[1]))}
d = lambda s: datetime.fromisoformat(s[:19]) if s else None
older7 = older30 = lost = changed = 0; owners = {}
for m in map(json.loads, open(sys.argv[2])):
    members = [pubs[(p['sourceKey'], p['externalId'])] for p in m['publications']]
    owner = next(p for p in members if p['jobId'] == m['survivor']); other = next(p for p in members if p is not owner)
    owners[owner['sourceKey']] = owners.get(owner['sourceKey'], 0) + 1
    a, b = d(owner['postedAt']), d(other['postedAt'])
    if a and b and (b - a).days >= 7: older7 += 1
    if a and b and (b - a).days >= 30: older30 += 1
    if not owner['city'] and other['city']: lost += 1
    elif owner['city'] and other['city'] and owner['city'].lower() != other['city'].lower(): changed += 1
print(json.dumps({'offre_conservee_par_source': owners, 'date_plus_ancienne_7j': older7, 'date_plus_ancienne_30j': older30,
  'ville_perdue': lost, 'ville_changee': changed}, ensure_ascii=False, indent=2))
