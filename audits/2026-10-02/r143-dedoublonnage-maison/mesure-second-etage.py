"""R-143 §4 — le second étage déterministe (même Maison, intitulé exact, même ville, même date de publication, même
empreinte de description) fusionnerait-il deux vrais recrutements ? Mesure à blanc, sans écriture.

Population où la vérité est connue : les publications RMK de jobs.sephora.com qui déclarent leur réquisition SAP
(« Job ID: N », relue par la redirection native job-invite, 80/80 puis 1 884/1 884). Deux publications de clé
« second étage » identique mais de réquisitions DIFFÉRENTES sont deux recrutements réels que l'étage fusionnerait.
Rejouer : python3 mesure-second-etage.py <publications.jsonl>   (extraction-publications.sql)
"""
import hashlib, json, re, sys
from collections import defaultdict
groups = defaultdict(set)
total = 0
for line in open(sys.argv[1], encoding='utf-8'):
    p = json.loads(line)
    if p['kind'] != 'successfactors' or not p['url'].startswith('https://jobs.sephora.com/'):
        continue
    desc = ((p['raw'] or {}).get('successfactorsDetail') or {}).get('description') or ''
    ids = set(re.findall(r'\bJob ID ?: ?(\d{4,12})\b', desc))
    if len(ids) != 1:
        continue
    total += 1
    # L'empreinte de description retire la ligne d'identifiant : sinon l'étage serait la preuve native elle-même.
    body = re.sub(r'\bJob ID ?: ?\d+', '', desc)
    fp = hashlib.sha256(re.sub(r'\s+', ' ', body).strip().lower().encode()).hexdigest()
    key = (p['companyId'], p['title'].strip().lower(), (p['city'] or '').lower(), (p['postedAt'] or '')[:10], fp)
    groups[key].add(ids.pop())
collisions = [k for k, v in groups.items() if len(v) > 1]
print(json.dumps({'publications_avec_requisition': total, 'cles_second_etage': len(groups),
  'cles_portant_plusieurs_requisitions': len(collisions),
  'publications_concernees': sum(len(groups[k]) for k in collisions),
  'exemples': [{'intitule': k[1], 'ville': k[2], 'publiee': k[3], 'requisitions': sorted(groups[k])} for k in collisions[:5]]},
  ensure_ascii=False, indent=2))
