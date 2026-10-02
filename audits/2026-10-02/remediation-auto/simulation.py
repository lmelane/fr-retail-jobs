"""D-520 — rejoue la règle de `ordinaryCauses.ts` sur les RUN réels (`catalogue.csv`) : combien de sources bloquantes
demandaient une intervention avant (toutes), combien en demandent après (à réparer, revue humaine, cause inconnue).
Une cause qui revient seule à sa 1re occurrence n'appelle personne ; présente au RUN précédent, elle passe à réparer.
Rejouable : python3 simulation.py > simulation.out"""
import csv, pathlib, collections
rows = list(csv.DictReader(open(pathlib.Path(__file__).with_name('catalogue.csv'))))
CAUSE = {'A0': 'NATIVE_RETENTION', 'F1': 'IDENTITY_REVIEW', 'D2': 'HEALTH_REGRESSION', 'D1': 'ENUMERATION_INCOMPLETE',
         'B1': 'QUALIFICATION_REJECTED', 'C2': 'PUBLISHER_REFUSAL', 'C3': 'PUBLISHER_REFUSAL', 'A6': 'ACCESS_DENIED',
         'A5': 'SCOPE_OUTGROWN', 'A1': 'ACCESS_RENEWAL', 'A2': 'ACCESS_RENEWAL', 'A3': 'ACCESS_RENEWAL', 'A4': 'ACCESS_RENEWAL',
         'E2': 'CODE_DEFECT', 'B2': 'UNCLASSIFIED', 'C4': 'UNCLASSIFIED', 'G1': 'UNCLASSIFIED', 'Z': 'UNCLASSIFIED'}
def cause(r):
    k = r['classe'].split(' ')[0]
    if k == 'E1': return 'TRANSIENT_DATABASE' if 'Transaction' in r['msg'] else 'TRANSIENT_CAPTURE'
    if k == 'C1': return 'TIMEOUT' if r['msg'].startswith('__TIMEOUT__') else 'TRANSIENT_NETWORK'
    return CAUSE.get(k, CAUSE['Z'])
HUMAN_FIRST = {'IDENTITY_REVIEW', 'ACCESS_DENIED', 'CODE_DEFECT', 'UNCLASSIFIED'}
RETRY = {'TRANSIENT_CAPTURE', 'TRANSIENT_DATABASE', 'TRANSIENT_NETWORK'}
runs = sorted({(r['startedAt'], r['run']) for r in rows})
prev = {runs[i][1]: runs[i - 1][1] if i else None for i in range(len(runs))}
seen = collections.defaultdict(set)  # run -> {(src, cause)}
for r in rows: seen[r['run']].add((r['src'], cause(r)))
print('RUN | bloquantes avant (une enquête chacune) | reprises dans le RUN | attendent le RUN suivant (1re occurrence) | à réparer (2e RUN) | revue humaine ou cause inconnue | interventions après')
tot_b = tot_h = n = 0
for t, run in runs:
    src = collections.defaultdict(list)
    for r in rows:
        if r['run'] == run and cause(r) != 'NATIVE_RETENTION' and r['connu'] != 't': src[r['src']].append(cause(r))
    retry = wait = repair = human = 0
    for s, causes in src.items():
        kinds = []
        for c in causes:
            if c in HUMAN_FIRST: kinds.append('human')
            elif prev[run] and (s, c) in seen[prev[run]]: kinds.append('repair')
            elif c in RETRY: kinds.append('retry')
            else: kinds.append('wait')
        k = 'human' if 'human' in kinds else 'repair' if 'repair' in kinds else 'wait' if 'wait' in kinds else 'retry'
        retry += k == 'retry'; wait += k == 'wait'; repair += k == 'repair'; human += k == 'human'
    after = repair + human
    print(f'{t[:10]} | {len(src)} | {retry} | {wait} | {repair} | {human} | {after}{" (pas de RUN précédent dans la fenêtre)" if not prev[run] else ""}')
    if prev[run]: tot_b += len(src); tot_h += after; n += 1
print(f'\nMoyenne sur les {n} RUN qui ont un précédent : {tot_b / n:.1f} sources bloquantes par RUN avant, {tot_h / n:.1f} interventions attendues après.')
print('Une intervention « à réparer » ou « revue humaine » est nommée avec ce qui est attendu ; elle ne demande plus d’enquête pour être classée.')
