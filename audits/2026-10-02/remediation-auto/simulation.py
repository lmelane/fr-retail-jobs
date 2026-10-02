"""D-520 — rejoue la règle de `ordinaryCauses.ts` (après audit) sur les RUN réels (`catalogue.csv`).
Avant : chaque source bloquante appelait une enquête. Après : une panne passagère par sa CLASSE (base Prisma, transport,
hors Avature et amorçage anti-robot), à sa première occurrence, est reprise dans le RUN (comptée ici comme absorbée :
borne haute, la reprise peut échouer) ; toute autre source bloquante reste une intervention, désormais nommée avec ce
qui est attendu. Colonne « option CEO » : ce que donnerait, EN PLUS, l'attente d'un RUN avant d'instruire la première
occurrence d'une régression de santé, d'une liste non prouvée ou d'une qualification rejetée (question métier, D-453 §1).
Rejouable : python3 simulation.py > simulation.out"""
import csv, pathlib, collections
rows = list(csv.DictReader(open(pathlib.Path(__file__).with_name('catalogue.csv'))))
EXCLUDED = {'ralph-lauren-avature', 'l-oreal-professionnel'}  # lecteur avature ; ralph-lauren : amorçage anti-robot
def cause(r):
    k = r['classe'].split(' ')[0]
    if r['code'] == 'DATABASE_FAILURE' or 'Transaction' in r['msg']: return 'TRANSIENT_DATABASE'
    if r['code'].startswith('TRANSPORT_') or (k == 'C1' and r['msg'] == 'fetch failed'): return 'TRANSIENT_NETWORK'
    return {'A0': 'NORMAL', 'D2': 'HEALTH', 'D1': 'ENUMERATION', 'B1': 'QUALIFICATION'}.get(k, 'OTHER:' + k)
WAITABLE = {'HEALTH', 'ENUMERATION', 'QUALIFICATION'}
runs = sorted({(r['startedAt'], r['run']) for r in rows})
prev = {runs[i][1]: runs[i - 1][1] if i else None for i in range(len(runs))}
seen = collections.defaultdict(set)
for r in rows: seen[r['run']].add((r['src'], cause(r)))
print('RUN | bloquantes avant | reprises dans le RUN (borne haute) | interventions après, nommées | option CEO : interventions si la 1re occurrence attend un RUN')
acc = collections.Counter()
for t, run in runs:
    src = collections.defaultdict(list)
    for r in rows:
        if r['run'] == run and cause(r) != 'NORMAL' and r['connu'] != 't': src[r['src']].append(cause(r))
    retried = after = option = 0
    for s, causes in src.items():
        first = lambda c: not (prev[run] and (s, c) in seen[prev[run]])
        if all(c.startswith('TRANSIENT') and first(c) for c in causes) and s not in EXCLUDED: retried += 1; continue
        after += 1
        if not all(c in WAITABLE and first(c) for c in causes): option += 1
    print(f"{t[:10]} | {len(src)} | {retried} | {after} | {option}{' (pas de RUN précédent dans la fenêtre)' if not prev[run] else ''}")
    if prev[run]: acc.update(b=len(src), r=retried, a=after, o=option, n=1)
n = acc['n']
print(f"\nMoyenne des {n} RUN qui ont un précédent : {acc['b'] / n:.1f} bloquantes ; {acc['r'] / n:.1f} reprises ; {acc['a'] / n:.1f} interventions nommées ; option CEO {acc['o'] / n:.1f}.")
