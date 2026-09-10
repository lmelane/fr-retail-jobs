"""Per-source table before bounded runs (owner brief 2026-09-10): one row per ACTIVE source.

Columns: identity & perimeter certified · configuration verified (receipt for the current config) · collection complete or
remaining gap · expected correction · planned production control. One row per active source; the CSV is the working sheet, the Markdown the readable copy.

Usage: per-source-table.py tracker-v7/sources-proof-dimensions.csv decisions.json output.csv output.md
decisions.json: {"<sourceKey>": {"correction": "...", "control": "..."}} — corrections written by the lots and the control (B1…B6) that proves them.
"""
import csv, json, sys
from collections import Counter

src_csv, decisions_path, out_csv, out_md = sys.argv[1:5]
rows = list(csv.DictReader(open(src_csv)))
decisions = json.load(open(decisions_path))
cols = rows[0].keys()

def pick(r, *names, default=''):
    for n in names:
        if n in r and r[n] != '':
            return r[n]
    return default

out = []
for r in rows:
    key = r.get('sourceKey') or r.get('key')
    identity = pick(r, 'identity', 'identityStatus')
    scope = pick(r, 'portalScope', 'scope', default='—')
    receipt_current = pick(r, 'receiptForCurrentConfig', 'currentReceipt')
    enumeration = pick(r, 'enumeration', 'enumerationStatus')
    collection = pick(r, 'collection', 'collectionStatus')
    gap = pick(r, 'gap', default='0')
    deficit_kind = pick(r, 'deficit', default='')
    issues = pick(r, 'issues', default='')
    details = pick(r, 'details', 'detailsStatus')
    ingestion = pick(r, 'ingestion', 'ingestionStatus')
    touched = key in decisions
    fully = identity.startswith('CERTIFIED') and receipt_current in ('True', 'true', '1', 'yes') and collection.startswith('COMPLETE') and details.startswith('COMPLETE')
    d = decisions.get(key, {})
    if collection.startswith('COMPLETE'):
        coll = 'complète'
    elif enumeration.startswith('PROVEN') or enumeration.startswith('COMPLETE'):
        coll = f'écart {gap} ({"expliqué : " + issues if deficit_kind == "EXPLAINED" and issues else "cause à nommer"})'
    else:
        coll = f'énumération non prouvée ({enumeration or "sans reçu"})' + (f', écart {gap}' if gap not in ('', '0') else '')
    control = d.get('control') or ('A1 re-sondage (reçu courant)' if receipt_current not in ('True', 'true', '1', 'yes') else 'B6 passe complète contrôlée')
    out.append({
        'source': key,
        'identité & périmètre': f"{identity}{'' if scope in ('', '—') else ' · ' + scope}",
        'configuration vérifiée': 'oui (reçu courant)' if receipt_current in ('True', 'true', '1', 'yes') else 'non (reçu d’une configuration antérieure ou run de prod seul)',
        'collecte': coll,
        'détails / ingestion': f"{details or '—'} / {ingestion or '—'}",
        'correction attendue': d.get('correction', '—' if fully else 'aucune correction de code : preuve à rejouer'),
        'contrôle de production prévu': control,
    })

with open(out_csv, 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()), delimiter=';')
    w.writeheader(); w.writerows(out)
with open(out_md, 'w') as f:
    f.write(f"# Tableau compact par source avant les runs bornés ({len(out)} sources sur {len(rows)} actives)\n\n")
    f.write('| ' + ' | '.join(out[0].keys()) + ' |\n|' + '---|' * len(out[0]) + '\n')
    for o in out:
        f.write('| ' + ' | '.join(str(v).replace('|', '/') for v in o.values()) + ' |\n')
print(json.dumps({'rows': len(out), 'active': len(rows), 'byControl': Counter(o['contrôle de production prévu'].split(' ')[0] for o in out)}, ensure_ascii=False))
